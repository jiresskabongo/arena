/**
 * Tests d'intégration Phase 8 : invitations + QR + RSVP.
 * - Génération en lot (invitation + token opaque + QR unique par invité), idempotence
 * - Isolation inter-tenants
 * - Vue publique + anti-énumération (token inconnu / expiré / révoqué / événement non publié)
 * - RSVP : statuts, accompagnants, questions (requises, choix, nombre), sync invité
 * - Questions RSVP : CRUD + bornes (10 max, choix 2-10)
 * - RSVP désactivé (options) et fermé (événement terminé)
 * - Révocation
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { register } from '@/server/services/account';
import { createEvent, setEventStatus, getEventForOrg } from '@/server/services/event';
import { addGuest } from '@/server/services/guest';
import {
  generateInvitations, listInvitations, listRsvpQuestions, saveRsvpQuestions,
  getPublicInvitation, submitRsvp, revokeInvitation,
} from '@/server/services/invitation';
import { TenantError, type TenantContext } from '@/server/services/tenant';

const stamp = Date.now().toString(36);
const email = `p8own.${stamp}@exemple.cd`;
const email2 = `p8other.${stamp}@exemple.cd`;

let ownerId: string;
let orgId: string;
let eventId: string;
let closedEventId: string;
let draftEventId: string;
let otherOwnerId: string;
let otherOrgId: string;

function makeCtx(org: { id: string; slug: string; name: string }, user: { id: string }, role: 'owner' = 'owner'): TenantContext {
  return {
    user: {
      id: user.id, email, firstName: 'P8', lastName: 'Own', passwordHash: '',
      locale: 'fr', currency: 'USD', timezone: 'Africa/Kinshasa', isSuperAdmin: false,
      emailVerifiedAt: null,
    } as never,
    isSuperAdmin: false,
    organization: {
      id: org.id, name: org.name, slug: org.slug, currency: 'USD', locale: 'fr',
      timezone: 'Africa/Kinshasa', isActive: true,
    },
    role,
  };
}

function ctx(): TenantContext {
  return makeCtx({ id: orgId, slug: 'p8', name: 'P8' }, { id: ownerId });
}

function otherCtx(): TenantContext {
  return makeCtx({ id: otherOrgId, slug: 'p8other', name: 'P8 Other' }, { id: otherOwnerId });
}

beforeAll(async () => {
  const reg = await register(
    { email, password: 'Event1234', firstName: 'P8', lastName: 'Own', organizationName: `P8 Org ${stamp}` },
    null,
  );
  expect(reg.ok).toBe(true);
  if (!reg.ok) return;
  ownerId = reg.data.userId;
  orgId = reg.data.organizationId;

  const reg2 = await register(
    { email: email2, password: 'Event1234', firstName: 'P8', lastName: 'Other', organizationName: `P8 Other ${stamp}` },
    null,
  );
  expect(reg2.ok).toBe(true);
  if (!reg2.ok) return;
  otherOwnerId = reg2.data.userId;
  otherOrgId = reg2.data.organizationId;

  // Passage au plan Pro (équivalent d'une souscription, Phase 13) : quota 10 événements
  const pro = await prisma.plan.findUnique({ where: { code: 'pro' } });
  if (pro) {
    await prisma.subscription.updateMany({
      where: { organizationId: { in: [orgId, otherOrgId] } },
      data: { planId: pro.id, status: 'active' },
    });
  }

  // Événement principal (futur, RSVP activé)
  const ev = await createEvent(ctx(), {
    name: `Gala P8 ${stamp}`, typeCode: 'gala', date: '2027-12-31',
    startTime: '19:00', endTime: '23:00', timezone: 'Africa/Kinshasa',
    optionsJson: { rsvp: true }, venue: 'Grand Hôtel', city: 'Kinshasa',
  });
  eventId = ev.id;
  await setEventStatus(ctx(), eventId, 'published');

  // 3 invités
  await addGuest(ctx(), eventId, { firstName: 'Aya', lastName: 'Mbala', email: 'aya@test.cd', phone: '+243 99 000 001' });
  await addGuest(ctx(), eventId, { firstName: 'Bob', lastName: 'Kanzi', email: 'bob@test.cd' });
  await addGuest(ctx(), eventId, { firstName: 'Chloé', lastName: 'Ilunga', phone: '+243 99 000 003' });

  // Événement terminé (RSVP fermé)
  const evClosed = await createEvent(ctx(), {
    name: `Fermé P8 ${stamp}`, typeCode: 'gala', date: '2020-01-10',
    startTime: '18:00', timezone: 'Africa/Kinshasa', optionsJson: { rsvp: true },
    venue: 'Salle A', city: 'Kinshasa',
  });
  closedEventId = evClosed.id;
  await setEventStatus(ctx(), closedEventId, 'published');
  await addGuest(ctx(), closedEventId, { firstName: 'Old', lastName: 'Guest' });

  // Événement resté en draft (non publié)
  const evDraft = await createEvent(ctx(), {
    name: `Draft P8 ${stamp}`, typeCode: 'gala', date: '2028-05-05',
    startTime: '18:00', timezone: 'Africa/Kinshasa', optionsJson: { rsvp: true },
    venue: 'Salle B', city: 'Kinshasa',
  });
  draftEventId = evDraft.id;
  await addGuest(ctx(), draftEventId, { firstName: 'Draft', lastName: 'Guest' });
});

afterAll(async () => {
  for (const org of [orgId, otherOrgId]) {
    const eventIds = (await prisma.event.findMany({ where: { organizationId: org }, select: { id: true } })).map((e) => e.id);
    await prisma.rsvp.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => {});
    await prisma.invitation.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => {});
    await prisma.rsvpQuestion.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => {});
    await prisma.guest.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => {});
    await prisma.event.deleteMany({ where: { organizationId: org } }).catch(() => {});
  }
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherOwnerId] } } }).catch(() => {});
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } }).catch(() => {});
  await prisma.$disconnect();
});

describe('génération en lot', () => {
  it('crée 1 invitation + token + QR par invité (3), idempotent au 2e appel', async () => {
    const r1 = await generateInvitations(ctx(), eventId, '10.0.0.1');
    expect(r1).toEqual({ created: 3, already: 0, total: 3 });

    // Unicité guestId + token opaque + QR unique
    const rows = await prisma.invitation.findMany({
      where: { eventId },
      include: { token: true, qrCode: true },
    });
    expect(rows).toHaveLength(3);
    const tokens = rows.map((r) => r.token!.token);
    expect(new Set(tokens).size).toBe(3);
    for (const tk of tokens) expect(tk.length).toBeGreaterThanOrEqual(32);
    const qrs = rows.map((r) => r.qrCode!.data);
    expect(new Set(qrs).size).toBe(3);
    for (const q of qrs) expect(q).toMatch(/^https?:\/\/.*\/i\//);

    // inviteStatus synchronisé
    const guests = await prisma.guest.findMany({ where: { eventId } });
    expect(guests.every((g) => g.inviteStatus === 'created')).toBe(true);

    // Idempotence : pas de doublon
    const r2 = await generateInvitations(ctx(), eventId, '10.0.0.1');
    expect(r2).toEqual({ created: 0, already: 3, total: 3 });
    const count = await prisma.invitation.count({ where: { eventId } });
    expect(count).toBe(3);
  });
});

describe('questions RSVP (CRUD + bornes)', () => {
  it('sauvegarde et liste les questions (remplace la liste)', async () => {
    const saved = await saveRsvpQuestions(ctx(), eventId, [
      { label: 'Allergies', type: 'text', required: true },
      { label: 'Plat préféré', type: 'choice', choices: ['Poulet', 'Poisson', 'Végé'], required: false },
      { label: 'Verres de champagne', type: 'number', required: false },
    ], null);
    expect(saved).toHaveLength(3);

    const list = await listRsvpQuestions(ctx(), eventId);
    expect(list.map((q) => q.label)).toEqual(['Allergies', 'Plat préféré', 'Verres de champagne']);
    expect(list[0].sortOrder).toBe(0);
    expect(list[1].choices).toEqual(['Poulet', 'Poisson', 'Végé']);

    // Remplacement : nouvelle liste unique question
    const saved2 = await saveRsvpQuestions(ctx(), eventId, [
      { label: 'Allergies', type: 'text', required: true },
      { label: 'Plat préféré', type: 'choice', choices: ['Poulet', 'Poisson', 'Végé'], required: false },
    ], null);
    expect(saved2).toHaveLength(2);
  });

  it('rejette : plus de 10 questions, choix <2 ou >10, libellé vide', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({ label: `Q${i}`, type: 'text' as const }));
    await expect(saveRsvpQuestions(ctx(), eventId, eleven, null)).rejects.toMatchObject({
      status: 400, code: 'too_many_questions',
    });
    await expect(
      saveRsvpQuestions(ctx(), eventId, [{ label: 'C', type: 'choice', choices: ['Seule'] }], null),
    ).rejects.toMatchObject({ status: 400, code: 'question_choice_invalid' });
    await expect(
      saveRsvpQuestions(ctx(), eventId, [{ label: 'C', type: 'choice', choices: Array(11).fill('x') }], null),
    ).rejects.toMatchObject({ status: 400, code: 'question_choice_invalid' });
    await expect(
      saveRsvpQuestions(ctx(), eventId, [{ label: '  ', type: 'text' }], null),
    ).rejects.toMatchObject({ status: 400, code: 'question_label_invalid' });
  });
});

describe('listInvitations (recherche, filtres, stats, pagination)', () => {
  it('liste 3 invitations avec stats et pagination', async () => {
    const res = await listInvitations(ctx(), eventId, { page: 1, pageSize: 10 });
    expect(res.total).toBe(3);
    expect(res.items).toHaveLength(3);
    expect(res.stats).toEqual({ pending: 3, confirmed: 0, declined: 0, maybe: 0 });

    const page1 = await listInvitations(ctx(), eventId, { page: 1, pageSize: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.totalPages).toBe(2);

    // Recherche par nom
    const found = await listInvitations(ctx(), eventId, { page: 1, pageSize: 10, search: 'Bob' });
    expect(found.total).toBe(1);
    expect(found.items[0].guest.firstName).toBe('Bob');

    // Recherche par email
    const found2 = await listInvitations(ctx(), eventId, { page: 1, pageSize: 10, search: 'aya@test.cd' });
    expect(found2.total).toBe(1);

    // PageSize bornée à 50
    const big = await listInvitations(ctx(), eventId, { page: 1, pageSize: 500 });
    expect(big.pageSize).toBeLessThanOrEqual(50);
  });
});

describe('vue publique + anti-énumération', () => {
  it('retourne la vue pour un token valide (sans email/téléphone du invité)', async () => {
    const inv = await prisma.invitation.findFirst({ where: { eventId }, include: { token: true } });
    expect(inv).not.toBeNull();
    const view = await getPublicInvitation(inv!.token!.token);
    expect(view).not.toBeNull();
    expect(view!.invitation.guest.firstName).toBeDefined();
    expect(view!.invitation.event.name).toContain('Gala P8');
    expect(view!.invitation.rsvpEnabled).toBe(true);
    // Pas de fuite de contact
    expect(JSON.stringify(view)).not.toContain('aya@test.cd');
    expect(JSON.stringify(view)).not.toContain('99 000 001');
    // Questions exposées (pour le formulaire)
    expect(view!.invitation.questions.length).toBe(2);
  });

  it('token inconnu / trop court / événement non publié → null (même 404 générique)', async () => {
    expect(await getPublicInvitation('inexistant' + 'x'.repeat(24))).toBeNull();
    expect(await getPublicInvitation('abc')).toBeNull();

    const invDraft = await prisma.invitation.findFirst({ where: { eventId: draftEventId }, include: { token: true } });
    if (invDraft?.token) {
      expect(await getPublicInvitation(invDraft.token.token)).toBeNull();
    } else {
      const gen = await generateInvitations(ctx(), draftEventId, null);
      expect(gen.created).toBe(1);
      const inv = await prisma.invitation.findFirst({ where: { eventId: draftEventId }, include: { token: true } });
      expect(await getPublicInvitation(inv!.token!.token)).toBeNull();
    }
  });
});

describe('flux RSVP', () => {
  it('confirmed + accompagnants + réponses → synchronise guest.rsvpStatus et stats', async () => {
    const inv = await prisma.invitation.findFirst({
      where: { eventId, guest: { firstName: 'Aya' } },
      include: { token: true },
    });
    const token = inv!.token!.token;
    const questions = await listRsvpQuestions(ctx(), eventId);
    const allergie = questions.find((q) => q.label === 'Allergies')!;

    const res = await submitRsvp(token, {
      status: 'confirmed',
      companions: 2,
      answers: { [allergie.id]: 'crustacés' },
    }, '10.0.0.2');
    expect(res.ok).toBe(true);
    expect(res.rsvp).toEqual({ status: 'confirmed', companions: 2 });

    const guest = await prisma.guest.findFirst({ where: { eventId, firstName: 'Aya' } });
    expect(guest!.rsvpStatus).toBe('confirmed');

    const list = await listInvitations(ctx(), eventId, {});
    expect(list.stats.confirmed).toBe(1);
    expect(list.stats.pending).toBe(2);

    // Modification (upsert) : passage à maybe (les réponses requises sont resoumises par le formulaire)
    const res2 = await submitRsvp(token, {
      status: 'maybe', companions: 0, answers: { [allergie.id]: 'crustacés' },
    }, null);
    expect(res2.ok).toBe(true);
    const guest2 = await prisma.guest.findFirst({ where: { eventId, firstName: 'Aya' } });
    expect(guest2!.rsvpStatus).toBe('maybe');
  });

  it('questions : réponse requise manquante → 400 ; choix invalide → 400 ; nombre non fini → 400', async () => {
    const questions = await listRsvpQuestions(ctx(), eventId);
    const allergie = questions.find((q) => q.label === 'Allergies')!;
    const plat = questions.find((q) => q.label === 'Plat préféré')!;
    const inv = await prisma.invitation.findFirst({
      where: { eventId, guest: { firstName: 'Bob' } },
      include: { token: true },
    });
    const token = inv!.token!.token;

    // Requise manquante
    await expect(
      submitRsvp(token, { status: 'confirmed', companions: 0, answers: {} }, null),
    ).rejects.toMatchObject({ status: 400, code: 'rsvp_question_required' });

    // Choix hors liste (réponse requise fournie pour isoler l'erreur)
    await expect(
      submitRsvp(token, {
        status: 'confirmed', companions: 0,
        answers: { [allergie.id]: 'aucune', [plat.id]: 'Camembert' },
      }, null),
    ).rejects.toMatchObject({ status: 400, code: 'rsvp_answer_invalid' });

    // Réponse texte non string (NaN) → 400
    await expect(
      submitRsvp(token, { status: 'confirmed', companions: 0, answers: { [allergie.id]: Number('abc') as never } }, null),
    ).rejects.toMatchObject({ status: 400, code: 'rsvp_answer_invalid' });

    // Réponses valides → ok
    const res = await submitRsvp(token, {
      status: 'declined', companions: 0,
      answers: { [allergie.id]: 'aucune', [plat.id]: 'Poisson' },
    }, null);
    expect(res.ok).toBe(true);
    const guest = await prisma.guest.findFirst({ where: { eventId, firstName: 'Bob' } });
    expect(guest!.rsvpStatus).toBe('declined');
  });

  it('statut inconnu → 400', async () => {
    const inv = await prisma.invitation.findFirst({ where: { eventId }, include: { token: true } });
    await expect(
      submitRsvp(inv!.token!.token, { status: 'present' as never, companions: 0, answers: {} }, null),
    ).rejects.toMatchObject({ status: 400, code: 'rsvp_status_invalid' });
  });

  it('accompanied borné 0-30 → 400 en dehors', async () => {
    const inv = await prisma.invitation.findFirst({ where: { eventId }, include: { token: true } });
    await expect(
      submitRsvp(inv!.token!.token, { status: 'confirmed', companions: -1, answers: {} }, null),
    ).rejects.toMatchObject({ status: 400, code: 'rsvp_companions_invalid' });
    await expect(
      submitRsvp(inv!.token!.token, { status: 'confirmed', companions: 31, answers: {} }, null),
    ).rejects.toMatchObject({ status: 400, code: 'rsvp_companions_invalid' });
  });
});

describe('RSVP désactivé / fermé / événement non publié', () => {
  it('options.rsvp=false → 403 rsvp_disabled', async () => {
    // On repasse l'événement en draft pour désactiver les options, puis republie
    await setEventStatus(ctx(), eventId, 'draft');
    const ev = (await getEventForOrg(eventId, orgId))!;
    await prisma.event.update({
      where: { id: eventId },
      data: { optionsJson: { ...(ev.optionsJson as Record<string, unknown>), rsvp: false } as never },
    });
    await setEventStatus(ctx(), eventId, 'published');

    const inv = await prisma.invitation.findFirst({
      where: { eventId, guest: { firstName: 'Chloé' } },
      include: { token: true },
    });
    await expect(
      submitRsvp(inv!.token!.token, { status: 'confirmed', companions: 0, answers: {} }, null),
    ).rejects.toMatchObject({ status: 403, code: 'rsvp_disabled' });

    // Réactivation (pour la suite)
    const ev2 = (await getEventForOrg(eventId, orgId))!;
    await prisma.event.update({
      where: { id: eventId },
      data: { optionsJson: { ...(ev2.optionsJson as Record<string, unknown>), rsvp: true } as never },
    });
  });

  it('événement terminé → 403 rsvp_closed + vue publique marquée rsvpClosed', async () => {
    const gen = await generateInvitations(ctx(), closedEventId, null);
    expect(gen.created).toBe(1);
    const inv = await prisma.invitation.findFirst({ where: { eventId: closedEventId }, include: { token: true } });
    await expect(
      submitRsvp(inv!.token!.token, { status: 'confirmed', companions: 0, answers: {} }, null),
    ).rejects.toMatchObject({ status: 403, code: 'rsvp_closed' });

    // La page publique peut afficher l'état « clos »
    const view = await getPublicInvitation(inv!.token!.token);
    expect(view).not.toBeNull();
    expect(view!.invitation.rsvpClosed).toBe(true);
  });

  it('événement non publié → 404 (pas 403)', async () => {
    // (l'invitation du draft a déjà été générée dans le bloc anti-énumération ; idempotent)
    await generateInvitations(ctx(), draftEventId, null);
    const inv = await prisma.invitation.findFirst({ where: { eventId: draftEventId }, include: { token: true } });
    expect(inv).not.toBeNull();
    await expect(
      submitRsvp(inv!.token!.token, { status: 'confirmed', companions: 0, answers: {} }, null),
    ).rejects.toMatchObject({ status: 404, code: 'invitation_not_found' });
  });
});

describe('révocation', () => {
  it('révoque : token invalidé + invitation expirée + 404 public', async () => {
    const inv = await prisma.invitation.findFirst({
      where: { eventId, guest: { firstName: 'Chloé' } },
      include: { token: true },
    });
    const token = inv!.token!.token;

    const res = await revokeInvitation(ctx(), inv!.id, '10.0.0.3');
    expect(res.ok).toBe(true);

    const tk = await prisma.invitationToken.findUnique({ where: { id: inv!.token!.id } });
    expect(tk!.revokedAt).not.toBeNull();
    const after = await prisma.invitation.findUnique({ where: { id: inv!.id } });
    expect(after!.status).toBe('expired');

    // Plus de vue publique, plus de RSVP possible
    expect(await getPublicInvitation(token)).toBeNull();
    await expect(
      submitRsvp(token, { status: 'confirmed', companions: 0, answers: {} }, null),
    ).rejects.toMatchObject({ status: 404, code: 'invitation_not_found' });
  });
});

describe('isolation inter-tenants', () => {
  it('une autre org ne voit ni ne touche les invitations', async () => {
    await expect(listInvitations(otherCtx(), eventId, { page: 1, pageSize: 10 }))
      .rejects.toMatchObject({ status: 404, code: 'event_not_found' });
    await expect(generateInvitations(otherCtx(), eventId, null))
      .rejects.toMatchObject({ status: 404, code: 'event_not_found' });
    await expect(saveRsvpQuestions(otherCtx(), eventId, [{ label: 'X', type: 'text' }], null))
      .rejects.toMatchObject({ status: 404, code: 'event_not_found' });

    const inv = await prisma.invitation.findFirst({ where: { eventId }, include: { token: true } });
    await expect(revokeInvitation(otherCtx(), inv!.id, null))
      .rejects.toMatchObject({ status: 404 });
  });
});
