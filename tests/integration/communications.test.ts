/**
 * Tests d'intégration Phase 10 : communications & rappels (CDC §26, §30).
 * - Templates {{…}} : liste plateforme, surcharge organisation, validation
 * - Campagnes : invitation e-mail (→ invitations « sent »), SMS/WhatsApp,
 *   audience (all / declined vide → 400 / ids), contenu custom
 * - Quotas mensuels e-mail/SMS réels (plan low → 403 quota_exceeded)
 * - Automatisations §30 : rsvp_confirmed (QR à la soumission), event_48h /
 *   event_24h (fenêtre temporelle + anti-relance 24 h via lastRunAt)
 * - Outbox démo : pagination, filtre canal, recherche, isolation inter-tenants
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { register } from '@/server/services/account';
import { createEvent, setEventStatus } from '@/server/services/event';
import { addGuest } from '@/server/services/guest';
import { generateInvitations, submitRsvp } from '@/server/services/invitation';
import {
  listTemplates, saveTemplate,
  createCampaign, listCampaigns, sendCampaign,
  listOutbox,
  listAutomations, saveAutomation, runEventAutomations,
} from '@/server/services/communication';
import { TenantError } from '@/server/services/tenant';
import type { TenantContext } from '@/server/services/tenant';

const stamp = Date.now().toString(36);
const email = `p10own.${stamp}@exemple.cd`;
const email2 = `p10other.${stamp}@exemple.cd`;

let ownerId: string;
let orgId: string;
let otherOwnerId: string;
let otherOrgId: string;
let lowPlanId: string;

let eventId: string;     // E1 : publié, 3 invités (aya e+tel, bob e, chaka tel)
let eventTimeId: string; // E2 : date manipulable pour les fenêtres 48h/24h
let otherEventId: string;
let ayaId: string;
let bobId: string;
let chakaId: string;
let ayaToken: string;

function ctx(o = { id: orgId, slug: 'p10', name: 'P10' }, u = { id: ownerId }): TenantContext {
  return {
    user: { id: u.id, email, firstName: 'P10', lastName: 'Own', passwordHash: '', locale: 'fr', currency: 'USD', timezone: 'Africa/Kinshasa', isSuperAdmin: false, emailVerifiedAt: null } as never,
    isSuperAdmin: false,
    organization: { id: o.id, name: o.name, slug: o.slug, currency: 'USD', locale: 'fr', timezone: 'Africa/Kinshasa', isActive: true },
    role: 'owner',
  };
}
function otherCtx(): TenantContext {
  return {
    user: { id: otherOwnerId, email: email2, firstName: 'P10', lastName: 'Oth', passwordHash: '', locale: 'fr', currency: 'USD', timezone: 'Africa/Kinshasa', isSuperAdmin: false, emailVerifiedAt: null } as never,
    isSuperAdmin: false,
    organization: { id: otherOrgId, name: 'P10 Other', slug: `p10o${stamp}`, currency: 'USD', locale: 'fr', timezone: 'Africa/Kinshasa', isActive: true },
    role: 'owner',
  };
}

/** Fixe la date de début d'un événement à now + h heures (deterministe). */
async function setStartInHours(eventIdArg: string, hours: number) {
  const d = new Date(Date.now() + hours * 3600 * 1000);
  await prisma.event.update({
    where: { id: eventIdArg },
    data: { date: d, startTime: d.toISOString().slice(11, 16) },
  });
}

async function msgCount(where: { [k: string]: unknown }): Promise<number> {
  return prisma.messageLog.count({ where });
}

beforeAll(async () => {
  const reg = await register({ email, password: 'Event1234', firstName: 'P10', lastName: 'Own', organizationName: `P10 Org ${stamp}` }, null);
  expect(reg.ok).toBe(true);
  if (!reg.ok) return;
  ownerId = reg.data.userId;
  orgId = reg.data.organizationId;

  const reg2 = await register({ email: email2, password: 'Event1234', firstName: 'P10', lastName: 'Oth', organizationName: `P10 Other ${stamp}` }, null);
  expect(reg2.ok).toBe(true);
  if (!reg2.ok) return;
  otherOwnerId = reg2.data.userId;
  otherOrgId = reg2.data.organizationId;

  const pro = await prisma.plan.findUnique({ where: { code: 'pro' } });
  if (pro) {
    await prisma.subscription.updateMany({ where: { organizationId: { in: [orgId, otherOrgId] } }, data: { planId: pro.id, status: 'active' } });
  }

  // Nettoyage du message « welcome » de l'inscription (compté dans le quota mensuel)
  await prisma.messageLog.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });

  // Plan « low » dédié aux tests de quota (emails: 1 / mois, sms: 1 / mois)
  const proRow = await prisma.plan.findUnique({ where: { code: 'pro' } });
  lowPlanId = (
    await prisma.plan.create({
      data: {
        code: `p10low_${stamp}`,
        name: `P10 Low ${stamp}`,
        description: 'Plan low pour tests de quota',
        limitsJson: { events: 10, guestsPerEvent: 50, storageMb: 100, members: 5, emailsPerMonth: 1, smsPerMonth: 1, aiCreditsPerMonth: 10 } as never,
        featuresJson: {} as never,
        ...(proRow ? { trialDays: proRow.trialDays } : {}),
      },
    })
  ).id;

  // E1 : gala publié, 3 invités
  const ev = await createEvent(ctx(), { name: `Gala P10 ${stamp}`, typeCode: 'gala', date: '2028-06-01', startTime: '19:00', endTime: '23:00', timezone: 'Africa/Kinshasa', optionsJson: { rsvp: true }, venue: 'Salle K', city: 'KIN' });
  eventId = ev.id;
  await setEventStatus(ctx(), eventId, 'published');
  const aya = await addGuest(ctx(), eventId, { firstName: 'Aya', lastName: 'Mbala', email: `aya.${stamp}@p10.cd`, phone: '+243810000001' });
  ayaId = aya.id;
  const bob = await addGuest(ctx(), eventId, { firstName: 'Bob', lastName: 'Kanzi', email: `bob.${stamp}@p10.cd` });
  bobId = bob.id;
  const chaka = await addGuest(ctx(), eventId, { firstName: 'Chaka', lastName: 'Mbala', phone: '+243810000002' });
  chakaId = chaka.id;
  await generateInvitations(ctx(), eventId, null);
  const inv = await prisma.invitation.findFirst({ where: { eventId, guestId: ayaId }, include: { token: true } });
  ayaToken = inv!.token!.token;

  // E2 : événement à date manipulable (fenêtres 48h / 24h)
  const ev2 = await createEvent(ctx(), { name: `Concert P10 ${stamp}`, typeCode: 'concert', date: '2028-07-01', startTime: '20:00', timezone: 'Africa/Kinshasa', optionsJson: { rsvp: true }, venue: 'Arena', city: 'KIN' });
  eventTimeId = ev2.id;
  await setEventStatus(ctx(), eventTimeId, 'published');
  await addGuest(ctx(), eventTimeId, { firstName: 'Nina', lastName: 'Kaya', email: `nina.${stamp}@p10.cd` });
  await generateInvitations(ctx(), eventTimeId, null);

  // Org « other » : événement + 2 invités (pour quota + isolation)
  const evO = await createEvent(otherCtx(), { name: `Autre P10 ${stamp}`, typeCode: 'gala', date: '2028-08-01', startTime: '19:00', timezone: 'Africa/Kinshasa', optionsJson: { rsvp: true }, venue: 'Salle O', city: 'KIN' });
  otherEventId = evO.id;
  await setEventStatus(otherCtx(), otherEventId, 'published');
  await addGuest(otherCtx(), otherEventId, { firstName: 'Zino', lastName: 'A', email: `zino1.${stamp}@p10.cd`, phone: '+24382000001' });
  await addGuest(otherCtx(), otherEventId, { firstName: 'Zina', lastName: 'B', email: `zina1.${stamp}@p10.cd`, phone: '+24382000002' });
  await generateInvitations(otherCtx(), otherEventId, null);
});

afterAll(async () => {
  for (const org of [orgId, otherOrgId]) {
    const eventIds = (await prisma.event.findMany({ where: { organizationId: org }, select: { id: true } })).map((e) => e.id);
    await prisma.automation.deleteMany({ where: { organizationId: org } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { organizationId: org } }).catch(() => {});
    await prisma.messageLog.deleteMany({ where: { organizationId: org } }).catch(() => {});
    await prisma.notificationCampaign.deleteMany({ where: { organizationId: org } }).catch(() => {});
    await prisma.notificationTemplate.deleteMany({ where: { organizationId: org } }).catch(() => {});
    await prisma.rsvp.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => {});
    await prisma.invitation.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => {});
    await prisma.guest.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => {});
    await prisma.event.deleteMany({ where: { organizationId: org } }).catch(() => {});
  }
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherOwnerId] } } }).catch(() => {});
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } }).catch(() => {});
  if (lowPlanId) await prisma.plan.delete({ where: { id: lowPlanId } }).catch(() => {});
  await prisma.$disconnect();
});

describe('templates', () => {
  it('liste les templates plateforme (invitation/confirmation/reminder…)', async () => {
    const tpls = await listTemplates(ctx());
    const keys = tpls.map((t: { key: string }) => t.key);
    for (const k of ['invitation', 'confirmation', 'reminder', 'change']) {
      expect(keys).toContain(k);
    }
    expect(tpls.every((t: { isPlatform: boolean }) => t.isPlatform)).toBe(true);
  });

  it('surcharge org : création, badge isOverridden, validation', async () => {
    const saved = await saveTemplate(ctx(), {
      key: 'reminder', channel: 'email',
      subjectFr: 'Rappel P10 {{event_name}}',
      bodyFr: 'Cher {{guest_name}}, rappel de {{event_name}} le {{event_date}} à {{event_location}}.',
    });
    expect(saved.key).toBe('reminder');

    const tpls = await listTemplates(ctx());
    const override = tpls.find((t) => t.key === 'reminder' && t.channel === 'email' && t.isPlatform === false);
    expect(override).toBeTruthy();
    expect(override!.subjectFr).toBe('Rappel P10 {{event_name}}');
    // Le template plateforme reminder:email doit être marqué « surchargé »
    const platformRow = tpls.find((t) => t.key === 'reminder' && t.channel === 'email' && t.isPlatform === true);
    expect(platformRow?.isOverridden).toBe(true);

    await expect(saveTemplate(ctx(), { key: 'BAD KEY!', channel: 'email', bodyFr: 'corps valide long' })).rejects.toThrow(TenantError);
    await expect(saveTemplate(ctx(), { key: 'short_key', channel: 'email', bodyFr: 'court' })).rejects.toThrow(TenantError);
    await expect(saveTemplate(ctx(), { key: 'ok_key', channel: 'pigeon', bodyFr: 'corps valide long' })).rejects.toThrow(TenantError);
  });
});

describe('campagnes', () => {
  it('invitation e-mail → envoi, invitations « sent », variables rendues', async () => {
    const c = await createCampaign(ctx(), eventId, { type: 'invitation', channel: 'email', audience: 'all' });
    expect(c.type).toBe('invitation');

    const res = await sendCampaign(ctx(), c.id);
    // 2 invités avec e-mail (Aya, Bob) ; Chaka (téléphone seul) non éligible
    expect(res.sent).toBe(2);
    expect(res.failed).toBe(0);

    const invs = await prisma.invitation.findMany({ where: { eventId }, include: { token: true } });
    const ayaInv = invs.find((i) => i.guestId === ayaId)!;
    const bobInv = invs.find((i) => i.guestId === bobId)!;
    expect(ayaInv.status).toBe('sent');
    expect(ayaInv.sentAt).toBeInstanceOf(Date);
    expect(bobInv.status).toBe('sent');
    const chakaInv = invs.find((i) => i.guestId === chakaId)!;
    expect(chakaInv.status).not.toBe('sent');

    const guest = await prisma.guest.findUnique({ where: { id: ayaId } });
    expect(guest!.inviteStatus).toBe('sent');

    // Variables {{…}} rendues (nom de l'invité présent dans le corps)
    const logs = await prisma.messageLog.findMany({ where: { campaignId: c.id }, include: { guest: true } });
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.provider === 'mock')).toBe(true);
    const ayaLog = logs.find((l) => l.guestId === ayaId)!;
    expect(ayaLog.body).toContain('Aya Mbala');
    expect(ayaLog.body).not.toContain('{{guest_name}}');
    expect(ayaLog.subject).not.toContain('{{');

    // Notification produit (in-app) de campagne envoyée
    const notif = await prisma.notification.findFirst({
      where: { organizationId: orgId, type: 'campaign.sent' },
      orderBy: { createdAt: 'desc' },
    });
    expect(notif).toBeTruthy();
    expect(notif!.title).toContain('invitation');
  });

  it('campagne déjà envoyée → 409', async () => {
    const c = await prisma.notificationCampaign.findFirst({
      where: { eventId, status: 'sent' },
      orderBy: { createdAt: 'asc' },
    });
    await expect(sendCampaign(ctx(), c!.id)).rejects.toThrow(TenantError);
  });

  it('audience « declined » vide → 400 campaign_no_recipients', async () => {
    const c = await createCampaign(ctx(), eventId, { type: 'reminder', channel: 'email', audience: 'declined' });
    await expect(sendCampaign(ctx(), c.id)).rejects.toThrow(/destinataire/i);
  });

  it('audience ids → un seul destinataire', async () => {
    const c = await createCampaign(ctx(), eventId, { type: 'reminder', channel: 'email', audience: 'ids', guestIds: [bobId] });
    const res = await sendCampaign(ctx(), c.id);
    expect(res.sent).toBe(1);
    const logs = await prisma.messageLog.findMany({ where: { campaignId: c.id } });
    expect(logs[0].guestId).toBe(bobId);
  });

  it('campagne SMS : éligibles par téléphone, canal sms, quota sms compté', async () => {
    const before = await prisma.messageLog.count({ where: { organizationId: orgId, channel: 'sms' } });
    const c = await createCampaign(ctx(), eventId, { type: 'reminder', channel: 'sms', audience: 'all' });
    const res = await sendCampaign(ctx(), c.id);
    expect(res.sent).toBe(2); // Aya + Chaka
    const logs = await prisma.messageLog.findMany({ where: { campaignId: c.id } });
    expect(logs.every((l) => l.channel === 'sms' && l.provider === 'mock')).toBe(true);
    const after = await prisma.messageLog.count({ where: { organizationId: orgId, channel: 'sms' } });
    expect(after - before).toBe(2);
  });

  it('campagne WhatsApp : mock identifié (réserve §13)', async () => {
    const c = await createCampaign(ctx(), eventId, { type: 'reminder', channel: 'whatsapp', audience: 'all' });
    const res = await sendCampaign(ctx(), c.id);
    expect(res.sent).toBe(2);
    const logs = await prisma.messageLog.findMany({ where: { campaignId: c.id } });
    expect(logs.every((l) => l.channel === 'whatsapp' && l.provider === 'mock')).toBe(true);
  });

  it('campagne custom : sujet + corps rendus depuis la campagne', async () => {
    const c = await createCampaign(ctx(), eventId, {
      type: 'custom', channel: 'email', audience: 'all',
      subject: 'Sujet custom {{event_name}}',
      body: 'Message spécial pour {{guest_name}} ({{event_date}}).',
    });
    const res = await sendCampaign(ctx(), c.id);
    expect(res.sent).toBe(2);
    const log = (await prisma.messageLog.findMany({ where: { campaignId: c.id } })).find((l) => l.guestId === ayaId)!;
    expect(log.subject).toContain('Gala P10');
    expect(log.subject).not.toContain('{{');
    expect(log.body).toContain('Aya Mbala');
  });

  it('quota e-mail mensuel (plan low) → 403 quota_exceeded', async () => {
    const sub = await prisma.subscription.findUnique({ where: { organizationId: otherOrgId } });
    await prisma.subscription.update({ where: { id: sub!.id }, data: { planId: lowPlanId } });

    const c = await createCampaign(otherCtx(), otherEventId, { type: 'invitation', channel: 'email', audience: 'all' });
    await expect(sendCampaign(otherCtx(), c.id)).rejects.toThrow(/quota/i);

    // 2 destinataires > limite 1 → refusé avant envoi
    expect(await msgCount({ organizationId: otherOrgId, campaignId: c.id })).toBe(0);

    // Limite respectée : 1 destinataire passe (limite 1, utilisé 0)
    const c1 = await createCampaign(otherCtx(), otherEventId, { type: 'reminder', channel: 'email', audience: 'ids', guestIds: [(await prisma.guest.findFirst({ where: { eventId: otherEventId } }))!.id] });
    const res = await sendCampaign(otherCtx(), c1.id);
    expect(res.sent).toBe(1);

    // 2e envoi → quota atteint (1/1)
    const c2 = await createCampaign(otherCtx(), otherEventId, { type: 'reminder', channel: 'email', audience: 'all' });
    await expect(sendCampaign(otherCtx(), c2.id)).rejects.toThrow(/quota/i);
  });

  it('quota SMS mensuel (plan low) → 403', async () => {
    const c = await createCampaign(otherCtx(), otherEventId, { type: 'reminder', channel: 'sms', audience: 'all' });
    await expect(sendCampaign(otherCtx(), c.id)).rejects.toThrow(/quota/i);
  });

  it('historique des campagnes paginé', async () => {
    const list = await listCampaigns(ctx(), eventId);
    expect(list.length).toBeGreaterThanOrEqual(5);
    expect(list[0].createdAt).toBeDefined();
    const sent = list.filter((c) => c.status === 'sent');
    expect(sent.length).toBeGreaterThanOrEqual(5);
  });
});

describe('outbox (démo)', () => {
  it('liste les messages de l’organisation : canal, sujet, corps, badge mock', async () => {
    const res = await listOutbox(ctx(), { pageSize: 50 });
    expect(res.total).toBeGreaterThan(0);
    expect(res.items.every((m) => m.provider === 'mock')).toBe(true);
    expect(res.totalPages).toBeGreaterThanOrEqual(1);
  });

  it('filtre par canal', async () => {
    const sms = await listOutbox(ctx(), { channel: 'sms', pageSize: 50 });
    expect(sms.items.every((m) => m.channel === 'sms')).toBe(true);
    expect(sms.total).toBeGreaterThanOrEqual(2);
  });

  it('recherche par destinataire / corps', async () => {
    const res = await listOutbox(ctx(), { search: `aya.${stamp}@p10.cd`, pageSize: 50 });
    expect(res.total).toBeGreaterThanOrEqual(1);
    expect(res.items.every((m) => m.recipient.includes(`aya.${stamp}`))).toBe(true);
  });

  it('pagination : pageSize respecte la limite', async () => {
    const p1 = await listOutbox(ctx(), { page: 1, pageSize: 3 });
    expect(p1.items.length).toBeLessThanOrEqual(3);
    expect(p1.totalPages).toBeGreaterThanOrEqual(1);
    if (p1.totalPages > 1) {
      const last = await listOutbox(ctx(), { page: p1.totalPages, pageSize: 3 });
      expect(last.items.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('isolation inter-tenants : outbox/accès croisés refusés', async () => {
    const other = await listOutbox(otherCtx(), { pageSize: 50 });
    // L'org other n'a que ses propres messages (1 e-mail envoyé dans le test quota)
    expect(other.total).toBeLessThanOrEqual(2);
    expect(other.items.every((m) => m.recipient.includes('zino') || m.recipient.includes('zina'))).toBe(true);

    // Campagne de l'org own invisible / inenvoyable pour l'org other
    const ownCampaign = await prisma.notificationCampaign.findFirst({ where: { eventId } });
    await expect(sendCampaign(otherCtx(), ownCampaign!.id)).rejects.toThrow(TenantError);
    await expect(listCampaigns(otherCtx(), eventId)).rejects.toThrow(TenantError);
  });
});

describe('automatisations (CDC §30)', () => {
  it('upsert par trigger + liste', async () => {
    await saveAutomation(ctx(), eventId, { trigger: 'rsvp_confirmed', active: true });
    const list = await listAutomations(ctx(), eventId);
    expect(list.map((a) => a.trigger)).toContain('rsvp_confirmed');

    await expect(saveAutomation(ctx(), eventId, { trigger: 'nope', active: true })).rejects.toThrow(TenantError);
  });

  it('rsvp_confirmed : RSVP confirmé → e-mail de confirmation avec lien QR', async () => {
    const before = await msgCount({ organizationId: orgId, templateKey: 'confirmation', guestId: ayaId });
    const res = await submitRsvp(ayaToken, { status: 'confirmed' }, '1.2.3.4');
    expect(res.ok).toBe(true);
    expect(res.rsvp.status).toBe('confirmed');

    const after = await msgCount({ organizationId: orgId, templateKey: 'confirmation', guestId: ayaId });
    expect(after).toBe(before + 1);
    const log = await prisma.messageLog.findFirst({
      where: { organizationId: orgId, templateKey: 'confirmation', guestId: ayaId },
      orderBy: { createdAt: 'desc' },
    });
    expect(log!.status).toBe('sent');
    expect(log!.provider).toBe('mock');

    // Notification produit (in-app) du RSVP confirmé
    const notif = await prisma.notification.findFirst({
      where: { organizationId: orgId, type: 'rsvp.confirmed' },
      orderBy: { createdAt: 'desc' },
    });
    expect(notif).toBeTruthy();
    expect(notif!.title).toContain('Aya Mbala');
    // Le corps inclut le lien d'invitation (= page QR) : /i/{token}
    expect(log!.body).toMatch(/\/i\/[a-z0-9]{16,}/i);
  });

  it('event_48h : hors fenêtre (J-30) → rien', async () => {
    await saveAutomation(ctx(), eventTimeId, { trigger: 'event_48h', active: true });
    await saveAutomation(ctx(), eventTimeId, { trigger: 'event_24h', active: true });
    await setStartInHours(eventTimeId, 720); // J-30 jours
    const res = await runEventAutomations(ctx(), eventTimeId);
    expect(res.ran).toHaveLength(0);
    const nina = await prisma.guest.findFirst({ where: { eventId: eventTimeId } });
    expect(await msgCount({ organizationId: orgId, guestId: nina!.id })).toBe(0);
  });

  it('event_48h : dans la fenêtre (J-2j) → rappel aux pending uniquement', async () => {
    const nina = await prisma.guest.findFirst({ where: { eventId: eventTimeId } });
    await setStartInHours(eventTimeId, 46); // J-2 jours ≈
    const res = await runEventAutomations(ctx(), eventTimeId);
    const triggers = res.ran.map((r) => r.trigger);
    expect(triggers).toContain('event_48h');
    expect(triggers).not.toContain('event_24h'); // hors fenêtre 24 h

    const logs = await prisma.messageLog.findMany({ where: { organizationId: orgId, templateKey: 'reminder', guestId: nina!.id } });
    expect(logs.length).toBe(1);
    expect(logs[0].channel).toBe('email');

    // Anti-relance : 2e run < 24 h → rien de nouveau
    const again = await runEventAutomations(ctx(), eventTimeId);
    expect(again.ran).toHaveLength(0);
    const logs2 = await prisma.messageLog.findMany({ where: { organizationId: orgId, templateKey: 'reminder', guestId: nina!.id } });
    expect(logs2.length).toBe(1);
  });

  it('event_24h : décalage de l’événement (J-1j) → 2e rappel', async () => {
    const nina = await prisma.guest.findFirst({ where: { eventId: eventTimeId } });
    // Le trigger 48h a couru il y a < 24 h → il doit rester bloqué ; 24h peut courir
    const res = await runEventAutomations(ctx(), eventTimeId);
    const triggers = res.ran.map((r) => r.trigger);
    expect(triggers).not.toContain('event_48h');
    expect(triggers).not.toContain('event_24h'); // encore hors fenêtre 24 h

    await setStartInHours(eventTimeId, 10); // J-1 jour
    const res2 = await runEventAutomations(ctx(), eventTimeId);
    const triggers2 = res2.ran.map((r) => r.trigger);
    expect(triggers2).toContain('event_24h');
    expect(triggers2).not.toContain('event_48h'); // anti-relance 24 h

    const logs = await prisma.messageLog.findMany({ where: { organizationId: orgId, templateKey: 'reminder', guestId: nina!.id } });
    expect(logs.length).toBe(2);
  });

  it('invité confirmé → exclut des rappels 48h/24h', async () => {
    const ev3 = await createEvent(ctx(), { name: `Soiree P10 ${stamp}`, typeCode: 'wedding', date: '2028-09-01', startTime: '20:00', timezone: 'Africa/Kinshasa', optionsJson: { rsvp: true }, venue: 'Salle D', city: 'KIN' });
    await setEventStatus(ctx(), ev3.id, 'published');
    const g = await addGuest(ctx(), ev3.id, { firstName: 'Sof', lastName: 'C', email: `sof.${stamp}@p10.cd` });
    await prisma.guest.update({ where: { id: g.id }, data: { rsvpStatus: 'confirmed' } });
    await saveAutomation(ctx(), ev3.id, { trigger: 'event_48h', active: true });
    await setStartInHours(ev3.id, 40);
    const res = await runEventAutomations(ctx(), ev3.id);
    const r48 = res.ran.find((r) => r.trigger === 'event_48h');
    expect(r48?.sent ?? 0).toBe(0);
  });
});
