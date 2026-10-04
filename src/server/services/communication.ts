import { prisma } from '@/lib/prisma';
import { tenantWhere, TenantError, type TenantContext } from '@/server/services/tenant';
import { getEventForOrg } from '@/server/services/event';
import { logActivity } from '@/server/services/activity';
import { getQuotas } from '@/server/services/quotas';
import { getSubscriptionView } from '@/server/services/subscription';
import { renderTemplate, getTemplate } from '@/server/providers/email';
import { smsProvider } from '@/server/providers/sms';
import type { Prisma } from '@prisma/client';

/**
 * Communications (CDC §26, §30) : templates {{…}}, campagnes (invitation /
 * confirmation / rappel / changement / custom), audience, quotas e-mail/SMS,
 * outbox démo (mock identifié), automatisations (les 3 exemples §30).
 * - Email/SMS/WhatsApp = providers mock en sandbox → MessageLog + badge « Démo »
 * - Quota mensuel e-mail/SMS par plan (réel, vérifié à l'envoi)
 */

export const CHANNELS = ['email', 'sms', 'whatsapp'] as const;
export type Channel = (typeof CHANNELS)[number];
export const CAMPAIGN_TYPES = ['invitation', 'confirmation', 'reminder', 'change', 'custom'] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];
export const AUDIENCES = ['all', 'rsvp_pending', 'confirmed', 'declined', 'ids'] as const;
export type Audience = (typeof AUDIENCES)[number];

/** Notification in-app (périmètre « notifications produit » CDC §26). */
export async function notifyOrg(
  organizationId: string,
  input: { type: string; title: string; body: string },
): Promise<void> {
  try {
    await prisma.notification.create({
      data: { organizationId, userId: null, channel: 'in_app', ...input },
    });
  } catch {
    /* non bloquant */
  }
}

// ─────────────────────────── Templates ───────────────────────────

export async function listTemplates(ctx: TenantContext) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');

  const [platform, org] = await Promise.all([
    prisma.notificationTemplate.findMany({ where: { organizationId: null, active: true } }),
    prisma.notificationTemplate.findMany({ where: { organizationId: orgId } }),
  ]);
  const orgByKey = new Map(org.map((t) => [`${t.key}:${t.channel}`, t] as const));

  // Les deux lignes (plateforme + surcharge) sont retournées : la plateforme
  // est marquée « surchargée », la surcharge est éditable. Le fallback à
  // l'envoi est géré par getTemplate (org → plateforme).
  const rows = [
    ...platform.map((t) => ({ ...t, isPlatform: true, isOverridden: orgByKey.has(`${t.key}:${t.channel}`) })),
    ...org.map((t) => ({ ...t, isPlatform: false, isOverridden: false })),
  ].sort((a, b) => a.key.localeCompare(b.key) || a.channel.localeCompare(b.channel));

  return rows.map((t) => ({
    id: t.id,
    key: t.key,
    channel: t.channel,
    subjectFr: t.subjectFr,
    subjectEn: t.subjectEn,
    bodyFr: t.bodyFr,
    bodyEn: t.bodyEn,
    active: t.active,
    isPlatform: t.isPlatform,
    isOverridden: t.isOverridden,
  }));
}

/** Crée ou met à jour un template ORGANISATION (les templates plateforme sont en lecture seule). */
export async function saveTemplate(
  ctx: TenantContext,
  input: {
    key: unknown;
    channel: unknown;
    subjectFr?: unknown;
    subjectEn?: unknown;
    bodyFr: unknown;
    bodyEn?: unknown;
    active?: unknown;
  },
  ip: string | null = null,
) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');

  const key = typeof input.key === 'string' ? input.key.trim().toLowerCase() : '';
  const channel = typeof input.channel === 'string' ? input.channel : '';
  if (!/^[a-z0-9_]{2,40}$/.test(key)) throw new TenantError(400, 'template_key_invalid', 'Clé de template invalide.');
  if (!CHANNELS.includes(channel as Channel)) throw new TenantError(400, 'template_channel_invalid', 'Canal invalide (email, sms, whatsapp).');
  const bodyFr = typeof input.bodyFr === 'string' ? input.bodyFr.trim() : '';
  const bodyEn = typeof input.bodyEn === 'string' ? input.bodyEn.trim() : '';
  if (bodyFr.length < 10) throw new TenantError(400, 'template_body_invalid', 'Corps de template trop court (10 caractères min).');

  const existing = await prisma.notificationTemplate.findUnique({
    where: { organizationId_key_channel: { organizationId: orgId, key, channel } },
  });
  const data = {
    subjectFr: typeof input.subjectFr === 'string' ? input.subjectFr.slice(0, 160) : null,
    subjectEn: typeof input.subjectEn === 'string' ? input.subjectEn.slice(0, 160) : null,
    bodyFr,
    bodyEn: bodyEn || bodyFr,
    active: input.active === undefined ? true : Boolean(input.active),
  };
  const saved = existing
    ? await prisma.notificationTemplate.update({ where: { id: existing.id }, data })
    : await prisma.notificationTemplate.create({ data: { organizationId: orgId, key, channel, ...data } });

  await logActivity({
    organizationId: orgId,
    userId: ctx.user.id,
    action: existing ? 'template.update' : 'template.create',
    entity: 'template',
    entityId: saved.id,
    meta: { key, channel },
    ip,
  });

  return {
    id: saved.id, key: saved.key, channel: saved.channel,
    subjectFr: saved.subjectFr, subjectEn: saved.subjectEn,
    bodyFr: saved.bodyFr, bodyEn: saved.bodyEn, active: saved.active,
  };
}

// ─────────────────────────── Campagnes ───────────────────────────

export async function createCampaign(
  ctx: TenantContext,
  eventId: string,
  input: {
    type: unknown;
    channel: unknown;
    templateKey?: unknown;
    audience?: unknown;
    guestIds?: unknown;
    subject?: unknown;
    body?: unknown;
  },
  ip: string | null = null,
) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');

  const type = CAMPAIGN_TYPES.includes(input.type as CampaignType) ? (input.type as CampaignType) : null;
  if (!type) throw new TenantError(400, 'campaign_type_invalid', 'Type de campagne invalide.');
  const channel = CHANNELS.includes(input.channel as Channel) ? (input.channel as Channel) : null;
  if (!channel) throw new TenantError(400, 'campaign_channel_invalid', 'Canal invalide.');
  const audience: Audience = AUDIENCES.includes(input.audience as Audience)
    ? (input.audience as Audience)
    : 'all';
  const guestIds = Array.isArray(input.guestIds) ? (input.guestIds as unknown[]).map(String).slice(0, 5000) : [];
  if (audience === 'ids' && guestIds.length === 0) {
    throw new TenantError(400, 'campaign_audience_invalid', 'Audience « sélection » vide.');
  }
  const templateKey = typeof input.templateKey === 'string' && input.templateKey.length > 0
    ? input.templateKey.slice(0, 60)
    : defaultTemplateKey(type, channel);
  const subject = typeof input.subject === 'string' ? input.subject.slice(0, 160) : null;
  const body = typeof input.body === 'string' ? input.body.slice(0, 4000) : null;

  // MVP : le contenu custom (subject/body) voyage dans audienceJson (pas de
  // champ dédié au schéma P1) — { scope, ids, subject?, body? }
  const audienceData: Record<string, unknown> = { scope: audience };
  if (guestIds.length > 0) audienceData.ids = guestIds;
  if (subject) audienceData.subject = subject;
  if (body) audienceData.body = body;

  const campaign = await prisma.notificationCampaign.create({
    data: {
      organizationId: orgId,
      eventId: event.id,
      type,
      channel,
      templateKey,
      audienceJson: audienceData as Prisma.InputJsonValue,
      status: 'draft',
      sentCount: 0,
      failedCount: 0,
      createdById: ctx.user.id,
    },
  });

  await logActivity({
    organizationId: orgId,
    userId: ctx.user.id,
    action: 'campaign.create',
    entity: 'campaign',
    entityId: campaign.id,
    meta: { type, channel, audience },
    ip,
  });

  return { id: campaign.id, type: campaign.type, channel: campaign.channel, status: campaign.status };
}

/** Les campagnes custom / change portent sujet+corps directement. */
function defaultTemplateKey(type: CampaignType, channel: Channel): string {
  if (channel === 'sms' || channel === 'whatsapp') {
    return type === 'reminder' ? 'reminder' : type === 'invitation' ? 'invitation' : 'change';
  }
  return type === 'custom' ? 'change' : type;
}

export async function listCampaigns(ctx: TenantContext, eventId: string) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');

  const rows = await prisma.notificationCampaign.findMany({
    where: { eventId: event.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { _count: { select: { messageLogs: true } } },
  });
  return rows.map((c) => ({
    id: c.id,
    type: c.type,
    channel: c.channel,
    templateKey: c.templateKey,
    audience: (c.audienceJson as { scope: string; ids?: string[] }) ?? { scope: 'all' },
    status: c.status,
    sentCount: c.sentCount,
    failedCount: c.failedCount,
    scheduledAt: c.scheduledAt ? c.scheduledAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
  }));
}

async function resolveAudience(event: { id: string; organizationId: string }, audience: { scope: string; ids?: string[] }): Promise<Prisma.GuestWhereInput> {
  const base: Prisma.GuestWhereInput = { eventId: event.id, organizationId: event.organizationId };
  switch (audience.scope) {
    case 'confirmed':
      return { ...base, rsvpStatus: 'confirmed' };
    case 'declined':
      return { ...base, rsvpStatus: 'declined' };
    case 'rsvp_pending':
      return { ...base, rsvpStatus: { in: ['pending', 'maybe'] } };
    case 'ids':
      return { ...base, id: { in: audience.ids ?? [] } };
    case 'all':
    default:
      return base;
  }
}

/** Envoie la campagne (provider mock → MessageLog) ; applique les quotas réels. */
export async function sendCampaign(
  ctx: TenantContext,
  campaignId: string,
  ip: string | null = null,
): Promise<{ sent: number; failed: number; skipped: number; campaignId: string }> {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const campaign = await prisma.notificationCampaign.findFirst({
    where: { id: campaignId, ...tenantWhere(orgId) },
    include: { event: true },
  });
  if (!campaign) throw new TenantError(404, 'campaign_not_found', 'Campagne introuvable.');
  if (campaign.status === 'sent') throw new TenantError(409, 'campaign_already_sent', 'Campagne déjà envoyée.');
  const event = campaign.event;

  const audience = (campaign.audienceJson as { scope: string; ids?: string[]; subject?: string; body?: string }) ?? { scope: 'all' };
  const guests = await prisma.guest.findMany({
    where: await resolveAudience(event, audience),
    include: { invitation: true },
  });
  // Canal déterminé par le contact disponible
  const eligible = guests.filter((g) =>
    campaign.channel === 'email' ? Boolean(g.email) : Boolean(g.phone),
  );
  if (eligible.length === 0) {
    throw new TenantError(400, 'campaign_no_recipients', 'Aucun destinataire avec un contact sur ce canal.');
  }

  // Quota mensuel réel (e-mail ou SMS par plan)
  const sub = await getSubscriptionView(orgId);
  if (!sub) throw new TenantError(409, 'no_subscription', 'Aucun abonnement pour cette organisation.');
  const quotaKey = campaign.channel === 'email' ? 'emailsPerMonth' : 'smsPerMonth';
  const quotas = await getQuotas(orgId, sub.plan);
  const q = quotas.find((x) => x.key === quotaKey);
  if (q && q.limit > 0 && q.used + eligible.length > q.limit) {
    throw new TenantError(403, 'quota_exceeded', `Quota ${quotaKey === 'emailsPerMonth' ? 'e-mails' : 'SMS'} mensuel atteint (${q.used}/${q.limit}).`);
  }

  // Template : override org → plateforme → sujet/corps custom de la campagne
  const tpl = await getTemplate(campaign.templateKey, campaign.channel, orgId, 'fr');
  const isSms = campaign.channel !== 'email';
  const sentCount = { n: 0 };
  const failedCount = { n: 0 };
  const skipped = eligible.length;

  const now = new Date();
  for (const g of eligible) {
    const vars = {
      guest_name: `${g.firstName} ${g.lastName}`,
      event_name: event.name,
      event_date: new Date(event.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      event_location: [event.venue, event.city].filter(Boolean).join(', '),
      rsvp_url: g.invitation?.publicUrl ?? '',
      invitation_url: g.invitation?.publicUrl ?? '',
    };
    try {
      if (campaign.channel === 'email') {
        const subject = renderTemplate(audience.subject ?? tpl?.subject ?? 'EventFlow', vars);
        const text = renderTemplate(audience.body ?? tpl?.body ?? 'EventFlow', vars);
        await prisma.messageLog.create({
          data: {
            organizationId: orgId,
            campaignId: campaign.id,
            guestId: g.id,
            channel: 'email',
            recipient: g.email!,
            templateKey: campaign.templateKey,
            subject,
            body: text,
            status: 'sent',
            provider: 'mock',
          },
        });
      } else {
        const text = renderTemplate(audience.body ?? tpl?.body ?? 'EventFlow', vars);
        await smsProvider.send({
          to: g.phone!,
          text,
          organizationId: orgId,
          guestId: g.id,
          campaignId: campaign.id,
          templateKey: campaign.templateKey,
          channel: campaign.channel as 'sms' | 'whatsapp',
        });
      }
      sentCount.n += 1;
    } catch {
      failedCount.n += 1;
    }
  }

  // Invitation envoyée → statut « sent » (réservation P8 : le passage sent est ici, pas à la génération)
  if (campaign.type === 'invitation') {
    await prisma.$transaction([
      prisma.invitation.updateMany({
        where: { eventId: event.id, organizationId: orgId, guestId: { in: eligible.map((g) => g.id) } },
        data: { status: 'sent', sentAt: now },
      }),
      prisma.guest.updateMany({
        where: { eventId: event.id, organizationId: orgId, id: { in: eligible.map((g) => g.id) } },
        data: { inviteStatus: 'sent' },
      }),
    ]);
  }

  await prisma.notificationCampaign.update({
    where: { id: campaign.id },
    data: { status: 'sent', sentCount: sentCount.n, failedCount: failedCount.n },
  });
  await notifyOrg(orgId, {
    type: 'campaign.sent',
    title: `Campagne ${campaign.type} envoyée`,
    body: `${sentCount.n} message(s) via ${campaign.channel} (démo).`,
  });
  await logActivity({
    organizationId: orgId,
    userId: ctx.user.id,
    action: 'campaign.send',
    entity: 'campaign',
    entityId: campaign.id,
    meta: { type: campaign.type, channel: campaign.channel, sent: sentCount.n, failed: failedCount.n },
    ip,
  });

  void skipped;
  void isSms;
  return { sent: sentCount.n, failed: failedCount.n, skipped: 0, campaignId: campaign.id };
}

// ─────────────────────────── Outbox (démo) ───────────────────────────

export async function listOutbox(
  ctx: TenantContext,
  q: { page?: number; pageSize?: number; channel?: string; status?: string; search?: string },
) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');

  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, q.pageSize ?? 25));
  const where: Prisma.MessageLogWhereInput = {
    organizationId: orgId,
    ...(q.channel && q.channel !== 'all' ? { channel: q.channel } : {}),
    ...(q.status && q.status !== 'all' ? { status: q.status } : {}),
    ...(q.search
      ? {
          OR: [
            { recipient: { contains: q.search } },
            { subject: { contains: q.search } },
            { body: { contains: q.search } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.messageLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { guest: { select: { firstName: true, lastName: true } } },
    }),
    prisma.messageLog.count({ where }),
  ]);

  return {
    items: items.map((m) => ({
      id: m.id,
      channel: m.channel,
      recipient: m.recipient,
      guest: m.guest ? `${m.guest.firstName} ${m.guest.lastName}` : null,
      templateKey: m.templateKey,
      subject: m.subject,
      body: m.body,
      status: m.status,
      provider: m.provider,
      error: m.error,
      createdAt: m.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// ─────────────────────────── Automatisations (§30) ───────────────────────────

export const AUTOMATION_TRIGGERS = ['rsvp_confirmed', 'event_48h', 'event_24h'] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export async function listAutomations(ctx: TenantContext, eventId: string) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');

  const rows = await prisma.automation.findMany({
    where: { eventId: event.id, organizationId: orgId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    trigger: a.trigger,
    condition: a.conditionJson as Record<string, unknown> | null,
    action: a.actionJson as Record<string, unknown>,
    active: a.active,
    lastRunAt: a.lastRunAt ? a.lastRunAt.toISOString() : null,
  }));
}

/** Upsert d'une automation par trigger (une par trigger par événement). */
export async function saveAutomation(
  ctx: TenantContext,
  eventId: string,
  input: { trigger: unknown; active: unknown; name?: unknown },
  ip: string | null = null,
) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');

  const trigger = AUTOMATION_TRIGGERS.includes(input.trigger as AutomationTrigger)
    ? (input.trigger as AutomationTrigger)
    : null;
  if (!trigger) throw new TenantError(400, 'automation_trigger_invalid', 'Trigger d’automatisation invalide.');
  const active = Boolean(input.active);
  const name = typeof input.name === 'string' && input.name.trim().length >= 2
    ? input.name.trim().slice(0, 60)
    : trigger;

  const existing = await prisma.automation.findFirst({
    where: { eventId: event.id, organizationId: orgId, trigger },
  });
  const action: Record<string, unknown> =
    trigger === 'rsvp_confirmed'
      ? { type: 'send_campaign', campaignType: 'confirmation' }
      : { type: 'send_campaign', campaignType: 'reminder' };
  const condition: Record<string, unknown> =
    trigger === 'event_48h' ? { rsvp: 'pending' } : {};

  const saved = existing
    ? await prisma.automation.update({
        where: { id: existing.id },
        data: { name, active, conditionJson: condition as Prisma.InputJsonValue, actionJson: action as Prisma.InputJsonValue },
      })
    : await prisma.automation.create({
        data: {
          organizationId: orgId,
          eventId: event.id,
          name,
          trigger,
          conditionJson: condition as Prisma.InputJsonValue,
          actionJson: action as Prisma.InputJsonValue,
          active,
        },
      });

  await logActivity({
    organizationId: orgId,
    userId: ctx.user.id,
    action: existing ? 'automation.update' : 'automation.create',
    entity: 'automation',
    entityId: saved.id,
    meta: { trigger, active },
    ip,
  });

  return { id: saved.id, name: saved.name, trigger: saved.trigger, active: saved.active };
}

/**
 * Évalue les automatisations d'un événement (appelée au RSVP confirmé et via
 * l'API « exécuter maintenant » ; les triggers temporels ne se relancent que
 * 24 h après leur dernier run — déterministe et testable, CDC §30).
 */
export async function runEventAutomations(
  ctx: TenantContext,
  eventId: string,
  ip: string | null = null,
): Promise<{ ran: { trigger: string; sent: number }[] }> {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');

  const rows = await prisma.automation.findMany({
    where: { eventId: event.id, organizationId: orgId, active: true },
  });
  const now = Date.now();
  const dayMs = 24 * 3600 * 1000;
  const out: { trigger: string; sent: number }[] = [];

  for (const a of rows) {
    // Anti-relance : un trigger temporel ne s'exécute qu'une fois par jour
    if (a.trigger.startsWith('event_') && a.lastRunAt && now - a.lastRunAt.getTime() < dayMs) continue;

    let campaignType: CampaignType = 'reminder';
    let guestWhere: Prisma.GuestWhereInput | null = null;

    if (a.trigger === 'event_48h') {
      const inWindow = hoursUntilStart(event) <= 48 && hoursUntilStart(event) >= 0;
      if (!inWindow) continue;
      campaignType = 'reminder';
      guestWhere = { eventId: event.id, organizationId: orgId, rsvpStatus: { in: ['pending', 'maybe'] } };
    } else if (a.trigger === 'event_24h') {
      const inWindow = hoursUntilStart(event) <= 24 && hoursUntilStart(event) >= 0;
      if (!inWindow) continue;
      campaignType = 'reminder';
      guestWhere = { eventId: event.id, organizationId: orgId, rsvpStatus: { in: ['pending', 'maybe'] } };
    } else {
      continue; // rsvp_confirmed se déclenche à la soumission (voir sendRsvpConfirmation)
    }

    const guests = await prisma.guest.findMany({ where: guestWhere! });
    const eligible = guests.filter((g) => g.email);
    if (eligible.length === 0) continue;

    let sent = 0;
    for (const g of eligible) {
      const ok = await sendRsvpMessage(event, g.id, 'reminder', 'email', ip);
      if (ok) sent += 1;
    }
    await prisma.automation.update({ where: { id: a.id }, data: { lastRunAt: new Date(now) } });
    out.push({ trigger: a.trigger, sent });
  }

  return { ran: out };
}

function hoursUntilStart(event: { date: Date; startTime: string }): number {
  const start = new Date(`${event.date.toISOString().slice(0, 10)}T${event.startTime}:00Z`);
  return (start.getTime() - Date.now()) / 3600000;
}

/**
 * Envoie un message RSVP à un invité (confirmation à la soumission, rappel,
 * invitation unitaire). Utilisé par les automatisations et la soumission RSVP.
 * Retourne true si un message a été journalisé.
 */
export async function sendRsvpMessage(
  event: { id: string; organizationId: string; name: string; date: Date; venue: string; city: string | null },
  guestId: string,
  templateKey: string,
  channel: Channel,
  ip: string | null = null,
): Promise<boolean> {
  const orgId = event.organizationId;
  const guest = await prisma.guest.findFirst({
    where: { id: guestId, eventId: event.id, organizationId: orgId },
    include: { invitation: true },
  });
  if (!guest) return false;
  if (channel === 'email' && !guest.email) return false;
  if (channel !== 'email' && !guest.phone) return false;

  // Quota (1 message)
  const sub = await getSubscriptionView(orgId);
  if (!sub) return false; // pas d'abonnement → pas de message auto
  const quotaKey = channel === 'email' ? 'emailsPerMonth' : 'smsPerMonth';
  const quotas = await getQuotas(orgId, sub.plan);
  const q = quotas.find((x) => x.key === quotaKey);
  if (q && q.limit > 0 && q.used + 1 > q.limit) {
    throw new TenantError(403, 'quota_exceeded', `Quota ${quotaKey === 'emailsPerMonth' ? 'e-mails' : 'SMS'} mensuel atteint (${q.used}/${q.limit}).`);
  }

  const tpl = await getTemplate(templateKey, channel, orgId, 'fr');
  const vars = {
    guest_name: `${guest.firstName} ${guest.lastName}`,
    event_name: event.name,
    event_date: new Date(event.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    event_location: [event.venue, event.city].filter(Boolean).join(', '),
    rsvp_url: guest.invitation?.publicUrl ?? '',
    invitation_url: guest.invitation?.publicUrl ?? '',
  };

  try {
    if (channel === 'email') {
      const subject = renderTemplate(tpl?.subject ?? 'EventFlow', vars);
      const text = renderTemplate(tpl?.body ?? 'EventFlow', vars);
      await prisma.messageLog.create({
        data: {
          organizationId: orgId,
          guestId: guest.id,
          channel: 'email',
          recipient: guest.email!,
          templateKey,
          subject,
          body: text,
          status: 'sent',
          provider: 'mock',
        },
      });
    } else {
      const text = renderTemplate(tpl?.body ?? 'EventFlow', vars);
      await smsProvider.send({
        to: guest.phone!,
        text,
        organizationId: orgId,
        guestId: guest.id,
        templateKey,
        channel: channel as 'sms' | 'whatsapp',
      });
    }
  } catch {
    return false;
  }

  // La confirmation automatique inclut le QR (lien d'invitation = page QR)
  await logActivity({
    organizationId: orgId,
    userId: null,
    action: `rsvp.message_${templateKey}`,
    entity: 'guest',
    entityId: guest.id,
    meta: { channel, eventId: event.id },
    ip,
  });

  // Notification produit (in-app)
  await notifyOrg(orgId, {
    type: templateKey === 'confirmation' ? 'rsvp.confirmed' : 'reminder.sent',
    title:
      templateKey === 'confirmation'
        ? `RSVP confirmé — ${guest.firstName} ${guest.lastName}`
        : `Rappel envoyé — ${guest.firstName} ${guest.lastName}`,
    body: `${event.name} · ${channel} (démo).`,
  });

  return true;
}

/**
 * Déclenchement `rsvp_confirmed` : appelé à la soumission d'un RSVP confirmé
 * (CDC §30 exemple 1 : « rsvp_confirmed → envoyer le QR »).
 */
export async function onRsvpConfirmed(
  event: { id: string; organizationId: string; name: string; date: Date; venue: string; city: string | null },
  guestId: string,
): Promise<boolean> {
  const orgId = event.organizationId;
  const automation = await prisma.automation.findFirst({
    where: { eventId: event.id, organizationId: orgId, trigger: 'rsvp_confirmed', active: true },
  });
  if (!automation) return false;
  const sent = await sendRsvpMessage(event, guestId, 'confirmation', 'email', null);
  if (sent) {
    await prisma.automation.update({ where: { id: automation.id }, data: { lastRunAt: new Date() } });
  }
  return sent;
}
