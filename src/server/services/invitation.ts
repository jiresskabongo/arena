import { prisma } from '@/lib/prisma';
import { tenantWhere, TenantError, type TenantContext } from '@/server/services/tenant';
import { getEventForOrg } from '@/server/services/event';
import { logActivity } from '@/server/services/activity';
import { generateSecureToken } from '@/lib/crypto';
import type { Prisma } from '@prisma/client';

/**
 * Invitations & RSVP (CDC §22–24, 28).
 * - 1 invitation + token opaque (32B base62, sans PII) + QR unique par invité
 * - Anti-énumération : même réponse 404 pour token inconnu, révoqué ou expiré
 * - RSVP public (page /i/[token]) : statuts + questions personnalisées + accompagnants
 */

const RSVP_STATUSES = ['confirmed', 'declined', 'maybe'] as const;

function appUrl(): string {
  return (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export function publicInvitationUrl(token: string): string {
  return `${appUrl()}/i/${token}`;
}

// ─────────────────────────── Génération (tenant) ───────────────────────────

/**
 * Génère en lot une invitation + token + QR pour chaque invité sans invitation.
 * Idempotent : les invités déjà créés sont sautés (aucun doublon possible —
 * `guestId @unique` sur Invitation).
 */
export async function generateInvitations(
  ctx: TenantContext,
  eventId: string,
  ip: string | null = null,
): Promise<{ created: number; already: number; total: number }> {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');

  const guests = await prisma.guest.findMany({
    where: { eventId, organizationId: orgId },
    select: { id: true },
  });

  let created = 0;
  let already = 0;
  const base = publicInvitationUrl('').replace(/\/$/, ''); // host + /i

  for (const g of guests) {
    const existing = await prisma.invitation.findUnique({
      where: { guestId: g.id },
      select: { id: true },
    });
    if (existing) {
      already += 1;
      continue;
    }
    const token = generateSecureToken(32);
    const publicUrl = `${base}/${token}`;
    const invitation = await prisma.invitation.create({
      data: {
        eventId: event.id,
        organizationId: orgId,
        guestId: g.id,
        publicUrl,
        status: 'draft', // « sent » dès l'envoi par communication (Phase 10)
        token: {
          create: {
            organizationId: orgId,
            token,
            expiresAt: null,
          },
        },
        qrCode: {
          create: {
            organizationId: orgId,
            data: publicUrl,
            format: 'png',
            size: 512,
          },
        },
      },
    });
    await prisma.guest.update({
      where: { id: g.id },
      data: { inviteStatus: 'created' },
    });
    void invitation;
    created += 1;
  }

  await logActivity({
    organizationId: orgId,
    userId: ctx.user.id,
    action: 'invitations.generate',
    entity: 'event',
    entityId: event.id,
    meta: { created, already, total: guests.length },
    ip,
  });

  return { created, already, total: guests.length };
}

// ─────────────────────────── Liste (tenant) ───────────────────────────

export async function listInvitations(
  ctx: TenantContext,
  eventId: string,
  q: { page?: number; pageSize?: number; search?: string; status?: string },
) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');

  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, q.pageSize ?? 25));
  const where = {
    eventId: event.id,
    organizationId: orgId,
    ...(q.status && q.status !== 'all' ? { rsvp: { status: q.status } } : {}),
    ...(q.search
      ? {
          guest: {
            OR: [
              { firstName: { contains: q.search } },
              { lastName: { contains: q.search } },
              { email: { contains: q.search } },
              { phone: { contains: q.search } },
            ],
          },
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.invitation.findMany({
      where: where as Prisma.InvitationWhereInput,
      include: {
        guest: { select: { firstName: true, lastName: true, email: true, phone: true, category: true } },
        token: { select: { token: true, expiresAt: true, revokedAt: true } },
        qrCode: { select: { data: true } },
        rsvp: { select: { status: true, companions: true, updatedAt: true } },
      },
      orderBy: { id: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.invitation.count({ where: where as Prisma.InvitationWhereInput }),
  ]);

  return {
    items: items.map((i) => ({
      id: i.id,
      publicUrl: i.publicUrl,
      invitationStatus: i.status,
      guest: i.guest,
      token: i.token?.token ?? null,
      tokenExpired: Boolean(i.token?.expiresAt && i.token.expiresAt < new Date()),
      tokenRevoked: Boolean(i.token?.revokedAt),
      qrData: i.qrCode?.data ?? i.publicUrl,
      rsvp: i.rsvp
        ? { status: i.rsvp.status, companions: i.rsvp.companions, updatedAt: i.rsvp.updatedAt.toISOString() }
        : null,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    stats: await rsvpStats(event.id, orgId),
  };
}

async function rsvpStats(eventId: string, orgId: string) {
  const [rows, totalInvites] = await Promise.all([
    prisma.rsvp.groupBy({
      by: ['status'],
      where: { eventId, organizationId: orgId },
      _count: { _all: true },
    }),
    prisma.invitation.count({ where: { eventId, organizationId: orgId } }),
  ]);
  const stats: Record<string, number> = { pending: 0, confirmed: 0, declined: 0, maybe: 0 };
  for (const r of rows) stats[r.status] = r._count._all;
  // « En attente » = invitations sans RSVP
  stats.pending = Math.max(0, totalInvites - stats.confirmed - stats.declined - stats.maybe);
  return stats;
}

// ─────────────────────────── Questions RSVP ───────────────────────────

const questionSchema = {
  label: (v: unknown) => {
    if (typeof v !== 'string' || v.trim().length < 2 || v.trim().length > 80) {
      throw new TenantError(400, 'question_label_invalid', 'Libellé de question invalide (2–80 caractères).');
    }
    return v.trim();
  },
};

export async function listRsvpQuestions(ctx: TenantContext, eventId: string) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');
  const questions = await prisma.rsvpQuestion.findMany({
    where: { eventId: event.id },
    orderBy: { sortOrder: 'asc' },
  });
  return questions.map((q) => ({
    id: q.id,
    label: q.label,
    type: q.type,
    choices: q.choicesJson ? (q.choicesJson as string[]) : null,
    required: q.required,
    sortOrder: q.sortOrder,
  }));
}

/** Remplace la liste des questions (max 10). */
export async function saveRsvpQuestions(
  ctx: TenantContext,
  eventId: string,
  questions: unknown[],
  ip: string | null = null,
) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');
  if (!Array.isArray(questions) || questions.length > 10) {
    throw new TenantError(400, 'too_many_questions', 'Maximum 10 questions.');
  }
  const parsed = questions.map((q, i) => {
    if (typeof q !== 'object' || q === null) throw new TenantError(400, 'question_invalid', 'Question invalide.');
    const obj = q as Record<string, unknown>;
    const type = obj.type;
    if (type !== 'text' && type !== 'number' && type !== 'choice') {
      throw new TenantError(400, 'question_type_invalid', `Type de question invalide (index ${i}).`);
    }
    let choices: string[] | null = null;
    if (type === 'choice') {
      if (!Array.isArray(obj.choices) || obj.choices.length < 2 || obj.choices.length > 10) {
        throw new TenantError(400, 'question_choice_invalid', `Choix invalides (index ${i}) : 2 à 10 valeurs.`);
      }
      choices = obj.choices.map((c) => String(c).slice(0, 60));
    }
    return {
      label: questionSchema.label(obj.label),
      type,
      choices,
      required: Boolean(obj.required),
      sortOrder: i,
    };
  });

  await prisma.$transaction([
    prisma.rsvpQuestion.deleteMany({ where: { eventId: event.id } }),
    ...parsed.map((q, i) =>
      prisma.rsvpQuestion.create({
        data: {
          eventId: event.id,
          label: q.label,
          type: q.type,
          choicesJson: q.choices ? (q.choices as Prisma.InputJsonValue) : undefined,
          required: q.required,
          sortOrder: i,
        },
      }),
    ),
  ]);

  await logActivity({
    organizationId: orgId,
    userId: ctx.user.id,
    action: 'rsvp.questions_save',
    entity: 'event',
    entityId: event.id,
    meta: { count: parsed.length },
    ip,
  });

  return listRsvpQuestions(ctx, eventId);
}

// ─────────────────────────── Public (token) ───────────────────────────

export interface PublicInvitationView {
  ok: true;
  invitation: {
    id: string;
    publicUrl: string;
    guest: { firstName: string; lastName: string; category: string };
    event: {
      name: string;
      typeCode: string;
      date: Date;
      startTime: string;
      endTime: string | null;
      timezone: string;
      venue: string;
      address: string | null;
      city: string | null;
      dressCode: string | null;
      practicalInfo: string | null;
      welcomeMessage: string | null;
    };
    rsvpEnabled: boolean;
    rsvpClosed: boolean;
    qrData: string;
    rsvp: { status: string; companions: number } | null;
    questions: { id: string; label: string; type: string; choices: string[] | null; required: boolean }[];
  };
}

/** Fin de l'événement (date + endTime, UTC — approximation, voir ARCHITECTURE §13). */
function eventEndDate(event: { date: Date; endTime: string | null }): Date {
  return event.endTime
    ? new Date(`${event.date.toISOString().slice(0, 10)}T${event.endTime}:00Z`)
    : new Date(event.date);
}

async function findPublicInvitation(token: string) {
  const row = await prisma.invitationToken.findUnique({
    where: { token },
    include: {
      invitation: {
        include: {
          guest: { select: { firstName: true, lastName: true, category: true } },
          qrCode: { select: { data: true } },
          rsvp: { select: { status: true, companions: true } },
          event: true,
        },
      },
    },
  });
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt < new Date())) return null;
  return row;
}

/** Vue publique de l'invitation. `null` = inconnu/expiré/révoqué (404 générique). */
export async function getPublicInvitation(token: string): Promise<PublicInvitationView | null> {
  const row = await findPublicInvitation(token);
  if (!row) return null;
  const event = row.invitation.event;
  if (event.status !== 'published') return null; // pas d'info leak sur un événement brouillon
  const options = (event.optionsJson ?? {}) as Record<string, boolean>;
  const questions = await prisma.rsvpQuestion.findMany({
    where: { eventId: event.id },
    orderBy: { sortOrder: 'asc' },
    take: 10,
  });
  return {
    ok: true,
    invitation: {
      id: row.invitation.id,
      publicUrl: row.invitation.publicUrl,
      guest: {
        firstName: row.invitation.guest.firstName,
        lastName: row.invitation.guest.lastName,
        category: row.invitation.guest.category,
      },
      event: {
        name: event.name,
        typeCode: event.typeCode,
        date: event.date,
        startTime: event.startTime,
        endTime: event.endTime,
        timezone: event.timezone,
        venue: event.venue,
        address: event.address,
        city: event.city,
        dressCode: event.dressCode,
        practicalInfo: event.practicalInfo,
        welcomeMessage: event.welcomeMessage,
      },
      rsvpEnabled: Boolean(options.rsvp),
      rsvpClosed: eventEndDate(event).getTime() < Date.now(),
      qrData: row.invitation.qrCode?.data ?? row.invitation.publicUrl,
      rsvp: row.invitation.rsvp
        ? { status: row.invitation.rsvp.status, companions: row.invitation.rsvp.companions }
        : null,
      questions: questions.map((q) => ({
        id: q.id,
        label: q.label,
        type: q.type,
        choices: q.choicesJson ? (q.choicesJson as string[]) : null,
        required: q.required,
      })),
    },
  };
}

export const rsvpInputSchema = {
  status: (v: unknown) => {
    if (!RSVP_STATUSES.includes(v as (typeof RSVP_STATUSES)[number])) {
      throw new TenantError(400, 'rsvp_status_invalid', 'Statut invalide.');
    }
    return v as string;
  },
};

/**
 * Soumet (ou met à jour) le RSVP via le token.
 * `ip` pour rate limiting (route) + journal.
 */
export async function submitRsvp(
  token: string,
  input: { status: unknown; companions?: unknown; answers?: unknown },
  ip: string | null,
): Promise<{ ok: true; rsvp: { status: string; companions: number }; eventId: string }> {
  const row = await findPublicInvitation(token);
  if (!row) throw new TenantError(404, 'invitation_not_found', 'Invitation introuvable ou expirée.');
  const invitation = row.invitation;
  const event = invitation.event;
  if (event.status !== 'published') throw new TenantError(404, 'invitation_not_found', 'Invitation introuvable ou expirée.');

  const options = (event.optionsJson ?? {}) as Record<string, boolean>;
  if (!options.rsvp) throw new TenantError(403, 'rsvp_disabled', 'Le RSVP est fermé pour cet événement.');

  // RSVP impossible après la fin de l'événement
  const end = eventEndDate(event);
  if (end.getTime() < Date.now()) {
    throw new TenantError(403, 'rsvp_closed', 'Le RSVP est clos (événement terminé).');
  }

  const status = rsvpInputSchema.status(input.status);
  let companions = 0;
  if (input.companions !== undefined) {
    const n = Number(input.companions);
    if (!Number.isInteger(n) || n < 0 || n > 30) {
      throw new TenantError(400, 'rsvp_companions_invalid', 'Nombre d’accompagnants invalide (0–30).');
    }
    companions = n;
  }

  // Validation des réponses (questions obligatoires + types)
  const questions = await prisma.rsvpQuestion.findMany({
    where: { eventId: event.id },
    orderBy: { sortOrder: 'asc' },
    take: 10,
  });
  const answersRaw =
    input.answers && typeof input.answers === 'object' && !Array.isArray(input.answers)
      ? (input.answers as Record<string, unknown>)
      : {};
  const answers: Record<string, string | number> = {};
  for (const q of questions) {
    const v = answersRaw[q.id];
    if (v === undefined || v === null || v === '') {
      if (q.required) {
        throw new TenantError(400, 'rsvp_question_required', `Réponse obligatoire : ${q.label}`);
      }
      continue;
    }
    if (q.type === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new TenantError(400, 'rsvp_answer_invalid', `Réponse numérique invalide : ${q.label}`);
      answers[q.id] = n;
    } else if (q.type === 'choice') {
      const choices = (q.choicesJson as string[] | null) ?? [];
      if (typeof v !== 'string' || !choices.includes(v)) {
        throw new TenantError(400, 'rsvp_answer_invalid', `Choix invalide : ${q.label}`);
      }
      answers[q.id] = v;
    } else {
      if (typeof v !== 'string') throw new TenantError(400, 'rsvp_answer_invalid', `Réponse invalide : ${q.label}`);
      answers[q.id] = v.slice(0, 500);
    }
  }

  const [rsvp] = await prisma.$transaction([
    prisma.rsvp.upsert({
      where: { invitationId: invitation.id },
      create: {
        invitationId: invitation.id,
        guestId: invitation.guestId,
        organizationId: row.organizationId,
        eventId: event.id,
        status,
        companions,
        answersJson: Object.keys(answers).length ? (answers as Prisma.InputJsonValue) : undefined,
      },
      update: {
        status,
        companions,
        answersJson: Object.keys(answers).length ? (answers as Prisma.InputJsonValue) : undefined,
      },
    }),
    prisma.guest.update({
      where: { id: invitation.guestId },
      data: { rsvpStatus: status },
    }),
  ]);
  void rsvp;

  await logActivity({
    organizationId: row.organizationId,
    userId: null,
    action: 'rsvp.submit',
    entity: 'invitation',
    entityId: invitation.id,
    meta: { status, companions },
    ip,
  });

  return {
    ok: true,
    rsvp: { status, companions },
    eventId: event.id,
  };
}

/** Révocation d'un token (tenant). */
export async function revokeInvitation(ctx: TenantContext, invitationId: string, ip: string | null = null) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const invitation = await prisma.invitation.findFirst({
    where: { id: invitationId, ...tenantWhere(orgId) },
    include: { token: true },
  });
  if (!invitation) throw new TenantError(404, 'invitation_not_found', 'Invitation introuvable.');
  if (invitation.token && !invitation.token.revokedAt) {
    await prisma.invitationToken.update({
      where: { id: invitation.token.id },
      data: { revokedAt: new Date() },
    });
  }
  await prisma.invitation.update({ where: { id: invitation.id }, data: { status: 'expired' } });
  await logActivity({
    organizationId: orgId,
    userId: ctx.user.id,
    action: 'invitation.revoke',
    entity: 'invitation',
    entityId: invitation.id,
    ip,
  });
  return { ok: true };
}
