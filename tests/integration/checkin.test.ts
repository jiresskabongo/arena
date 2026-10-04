/**
 * Tests d'intégration Phase 9 : check-in & contrôle d'accès (CDC §25–28).
 * - Création/activation agent (token opaque), permissions
 * - Scan : valid → présence, anti-réutilisation (déjà utilisé), multi-entrée
 * - Idempotence clientUuid (replay offline → même résultat, aucune écriture)
 * - Statuts invalid / expired / agent_denied / event_not_published
 * - Replay batch hors ligne (conflit → déjà utilisé)
 * - Sync out (pré-sync offline), historique paginé
 * - Isolation inter-tenants
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { register } from '@/server/services/account';
import { createEvent, setEventStatus } from '@/server/services/event';
import { addGuest } from '@/server/services/guest';
import { generateInvitations } from '@/server/services/invitation';
import {
  createScannerAgent, listScannerAgents, setScannerAgentActive,
  scanCheckIn, scannerSyncOut, syncScans, listCheckIns,
} from '@/server/services/checkin';
import type { TenantContext } from '@/server/services/tenant';

const stamp = Date.now().toString(36);
const email = `p9own.${stamp}@exemple.cd`;
const email2 = `p9other.${stamp}@exemple.cd`;

let ownerId: string;
let orgId: string;
let otherOwnerId: string;
let otherOrgId: string;
let eventId: string;      // futur, publié, multi-entrée OFF
let multiEventId: string; // futur, publié, multi-entrée ON
let draftEventId: string; // non publié
let guestId: string;
let token: string;

function ctx(o = { id: orgId, slug: 'p9', name: 'P9' }, u = { id: ownerId }): TenantContext {
  return {
    user: { id: u.id, email, firstName: 'P9', lastName: 'Own', passwordHash: '', locale: 'fr', currency: 'USD', timezone: 'Africa/Kinshasa', isSuperAdmin: false, emailVerifiedAt: null } as never,
    isSuperAdmin: false,
    organization: { id: o.id, name: o.name, slug: o.slug, currency: 'USD', locale: 'fr', timezone: 'Africa/Kinshasa', isActive: true },
    role: 'owner',
  };
}

beforeAll(async () => {
  const reg = await register({ email, password: 'Event1234', firstName: 'P9', lastName: 'Own', organizationName: `P9 Org ${stamp}` }, null);
  expect(reg.ok).toBe(true);
  if (!reg.ok) return;
  ownerId = reg.data.userId;
  orgId = reg.data.organizationId;

  const reg2 = await register({ email: email2, password: 'Event1234', firstName: 'P9', lastName: 'Oth', organizationName: `P9 Other ${stamp}` }, null);
  expect(reg2.ok).toBe(true);
  if (!reg2.ok) return;
  otherOwnerId = reg2.data.userId;
  otherOrgId = reg2.data.organizationId;

  const pro = await prisma.plan.findUnique({ where: { code: 'pro' } });
  if (pro) {
    await prisma.subscription.updateMany({ where: { organizationId: { in: [orgId, otherOrgId] } }, data: { planId: pro.id, status: 'active' } });
  }

  const ev = await createEvent(ctx(), { name: `Gala P9 ${stamp}`, typeCode: 'gala', date: '2028-06-01', startTime: '19:00', endTime: '23:00', timezone: 'Africa/Kinshasa', optionsJson: { rsvp: true }, venue: 'Salle', city: 'KIN' });
  eventId = ev.id;
  await setEventStatus(ctx(), eventId, 'published');
  await addGuest(ctx(), eventId, { firstName: 'Aya', lastName: 'Mbala', email: 'aya@p9.cd', category: 'vip' });
  const g = await prisma.guest.findFirst({ where: { eventId, firstName: 'Aya' } });
  guestId = g!.id;
  await generateInvitations(ctx(), eventId, null);
  const inv = await prisma.invitation.findFirst({ where: { eventId }, include: { token: true } });
  token = inv!.token!.token;

  const evMulti = await createEvent(ctx(), { name: `Multi P9 ${stamp}`, typeCode: 'gala', date: '2028-06-02', startTime: '19:00', timezone: 'Africa/Kinshasa', optionsJson: {}, venue: 'Salle', city: 'KIN', allowMultipleEntries: true });
  multiEventId = evMulti.id;
  await setEventStatus(ctx(), multiEventId, 'published');

  const evDraft = await createEvent(ctx(), { name: `Draft P9 ${stamp}`, typeCode: 'gala', date: '2028-06-03', startTime: '19:00', timezone: 'Africa/Kinshasa', optionsJson: {}, venue: 'Salle', city: 'KIN' });
  draftEventId = evDraft.id;
});

afterAll(async () => {
  for (const org of [orgId, otherOrgId]) {
    const eventIds = (await prisma.event.findMany({ where: { organizationId: org }, select: { id: true } })).map((e) => e.id);
    await prisma.checkIn.deleteMany({ where: { organizationId: org } }).catch(() => {});
    await prisma.scannerAgent.deleteMany({ where: { organizationId: org } }).catch(() => {});
    await prisma.rsvp.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => {});
    await prisma.invitation.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => {});
    await prisma.guest.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => {});
    await prisma.event.deleteMany({ where: { organizationId: org } }).catch(() => {});
  }
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherOwnerId] } } }).catch(() => {});
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } }).catch(() => {});
  await prisma.$disconnect();
});

let agentToken: string;
let agentId: string;

async function makeAgent(eventIdArg: string, name = 'Agent P9', entryPoint: 'entrance' | 'vip' = 'entrance') {
  const a = await createScannerAgent(ctx(), eventIdArg, { name, entryPoint, permissions: { canSearch: true, canSeeHistory: true } });
  return a;
}

describe('agents de scan', () => {
  it('crée un agent avec token opaque + liste + permissions', async () => {
    const a = await makeAgent(eventId);
    agentToken = a.token;
    agentId = a.id;
    expect(a.token.length).toBeGreaterThanOrEqual(32);
    expect(a.scannerUrl).toBe(`/scanner/${a.token}`);
    expect(a.permissions.canSearch).toBe(true);

    const list = await listScannerAgents(ctx(), eventId);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(a.id);
  });

  it('désactivation → scan refusé (agent_denied)', async () => {
    await setScannerAgentActive(ctx(), agentId, false);
    const res = await scanCheckIn(agentToken, { token, clientUuid: 'deact-01' });
    expect(res.status).toBe('invalid');
    expect(res.reason).toBe('agent_denied');
    await setScannerAgentActive(ctx(), agentId, true);
  });

  it('isolation : un agent d’une autre org ne peut pas scanner cet événement', async () => {
    const other = ctx({ id: otherOrgId, slug: 'p9o', name: 'P9 Other' }, { id: otherOwnerId });
    const evOther = await createEvent(other, { name: `Other P9 ${stamp}`, typeCode: 'gala', date: '2028-06-09', startTime: '19:00', timezone: 'Africa/Kinshasa', optionsJson: {}, venue: 'S', city: 'K' });
    const ag = await createScannerAgent(other, evOther.id, { name: 'Agent Other' });
    const res = await scanCheckIn(ag.token, { token, clientUuid: 'cross-01' });
    expect(res.status).toBe('invalid');
    expect(res.reason).toBe('agent_denied'); // l'agent n'est pas sur CET événement
  });
});

describe('scan & anti-réutilisation', () => {
  it('1er scan → valid : présence marquée + CheckIn + résultat riche', async () => {
    const res = await scanCheckIn(agentToken, { token, entryPoint: 'vip', clientUuid: 'c-first-01', clientAt: new Date().toISOString() });
    expect(res.status).toBe('valid');
    expect(res.guest?.name).toBe('Aya Mbala');
    expect(res.guest?.category).toBe('vip');
    expect(res.meta?.first).toBe(true);
    expect(res.meta?.entryPoint).toBe('vip');

    const guest = await prisma.guest.findUnique({ where: { id: guestId } });
    expect(guest!.presenceStatus).toBe('present');
    expect(guest!.checkedInAt).not.toBeNull();

    const checkin = await prisma.checkIn.findUnique({ where: { guestId } });
    expect(checkin!.result).toBe('valid');
    expect(checkin!.entryPoint).toBe('vip');
  });

  it('2e scan → déjà utilisé (heure du 1er), aucune nouvelle présence', async () => {
    const res = await scanCheckIn(agentToken, { token, entryPoint: 'entrance', clientUuid: 'c-second-01' });
    expect(res.status).toBe('already_used');
    expect(res.meta?.first).toBe(false);
    // Une seule ligne CheckIn par invité (guestId @unique)
    const count = await prisma.checkIn.count({ where: { guestId } });
    expect(count).toBe(1);
  });

  it('multi-entrée : 2e scan → valid (horodatage mis à jour)', async () => {
    const a2 = await makeAgent(multiEventId, 'Agent Multi');
    await addGuest(ctx(), multiEventId, { firstName: 'Bob', lastName: 'Kanzi', category: 'amis' });
    await generateInvitations(ctx(), multiEventId, null);
    const inv = await prisma.invitation.findFirst({ where: { eventId: multiEventId }, include: { token: true } });
    const t2 = inv!.token!.token;
    const g2 = await prisma.guest.findFirst({ where: { eventId: multiEventId, firstName: 'Bob' } });

    const r1 = await scanCheckIn(a2.token, { token: t2, clientUuid: 'm-entry-01' });
    expect(r1.status).toBe('valid');
    const r2 = await scanCheckIn(a2.token, { token: t2, clientUuid: 'm-entry-02' });
    expect(r2.status).toBe('valid'); // multi autorisé
    expect(r2.meta?.first).toBe(false);
    expect(r2.meta?.allowMultipleEntries).toBe(true);
    const checkin = await prisma.checkIn.findUnique({ where: { guestId: g2!.id } });
    expect(checkin!.result).toBe('valid');
  });

  it('idempotence clientUuid : replay → même résultat, aucune écriture', async () => {
    const before = await prisma.checkIn.count({ where: { guestId } });
    const r1 = await scanCheckIn(agentToken, { token, entryPoint: 'vip', clientUuid: 'c-first-01' });
    const after = await prisma.checkIn.count({ where: { guestId } });
    expect(r1.status).toBe('valid'); // rejoue le 1er scan
    expect(after).toBe(before);
    expect(r1.meta?.offline).toBe(true);
  });

  it('token inconnu → invalid ; événement non publié → invalid', async () => {
    const r = await scanCheckIn(agentToken, { token: 'inexistant'.padEnd(40, 'x'), clientUuid: 'uuid-001' });
    expect(r.status).toBe('invalid');
    expect(r.reason).toBe('unknown_token');

    // événement draft : invitation + token ; l'agent est lié à CET événement
    await addGuest(ctx(), draftEventId, { firstName: 'Draft', lastName: 'G' });
    await generateInvitations(ctx(), draftEventId, null);
    const inv = await prisma.invitation.findFirst({ where: { eventId: draftEventId }, include: { token: true } });
    const agDraft = await createScannerAgent(ctx(), draftEventId, { name: 'Agent Draft' });
    const rd = await scanCheckIn(agDraft.token, { token: inv!.token!.token, clientUuid: 'draft-001' });
    expect(rd.status).toBe('invalid');
    expect(rd.reason).toBe('event_not_published');
  });

  it('token révoqué → invalid ; token expiré → expired', async () => {
    // révoqué
    const inv = await prisma.invitation.findFirst({ where: { eventId }, include: { token: true } });
    await prisma.invitationToken.update({ where: { id: inv!.token!.id }, data: { revokedAt: new Date() } });
    const rr = await scanCheckIn(agentToken, { token, clientUuid: 'revok-001' });
    expect(rr.status).toBe('invalid');
    expect(rr.reason).toBe('token_revoked');
    await prisma.invitationToken.update({ where: { id: inv!.token!.id }, data: { revokedAt: null } });

    // expiré
    const inv2 = await prisma.invitation.findFirst({ where: { eventId }, include: { token: true } });
    await prisma.invitationToken.update({ where: { id: inv2!.token!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const re = await scanCheckIn(agentToken, { token, clientUuid: 'expir-001' });
    expect(re.status).toBe('expired');
    expect(re.reason).toBe('token_expired');
    await prisma.invitationToken.update({ where: { id: inv2!.token!.id }, data: { expiresAt: null } });
  });

  it('agent inconnu / malformé → invalid (agent_denied)', async () => {
    const r = await scanCheckIn('totally-unknown-token-000000000000', { token, clientUuid: 'agent-001' });
    expect(r.status).toBe('invalid');
    expect(r.reason).toBe('agent_denied');
  });
});

describe('hors ligne : pré-sync + replay batch', () => {
  it('sync out renvoie les tokens autorisés + infos minimales', async () => {
    const data = await scannerSyncOut(agentToken);
    expect(data).not.toBeNull();
    expect(data!.eventId).toBe(eventId);
    expect(data!.allowMultipleEntries).toBe(false);
    expect(data!.invitations.length).toBeGreaterThanOrEqual(1);
    const row = data!.invitations.find((i) => i.token === token)!;
    expect(row.guest.name).toBe('Aya Mbala');
    expect(row.guest.rsvpStatus).toBeDefined();
  });

  it('agent désactivé → sync out null', async () => {
    await setScannerAgentActive(ctx(), agentId, false);
    expect(await scannerSyncOut(agentToken)).toBeNull();
    await setScannerAgentActive(ctx(), agentId, true);
  });

  it('replay batch : rejoue les scans (idempotent), conflit → déjà utilisé', async () => {
    const a2List = (await listScannerAgents(ctx(), multiEventId)).find((a) => a.name === 'Agent Multi')!;
    const a2Token = a2List.scannerUrl.split('/')[2];
    const inv = await prisma.invitation.findFirst({ where: { eventId: multiEventId }, include: { token: true } });
    const t2 = inv!.token!.token;

    // Conflit : Aya est déjà checkée en ligne → le scan hors ligne rejoué = déjà utilisé
    const res = await syncScans(agentToken, {
      scans: [
        { clientUuid: 'batch-001', token, entryPoint: 'entrance', clientAt: new Date(Date.now() - 5000).toISOString() },
      ],
    });
    expect(res.synced).toBe(1);
    expect(res.results[0].status).toBe('already_used');

    // Bob (multi-entrée) → valid via son agent
    const resBob = await syncScans(a2Token, {
      scans: [
        { clientUuid: 'batch-002', token: t2, entryPoint: 'vip', clientAt: new Date().toISOString() },
      ],
    });
    expect(resBob.results[0].status).toBe('valid');

    // Re-replay identique → idempotent, mêmes résultats
    const res2 = await syncScans(agentToken, {
      scans: [
        { clientUuid: 'batch-001', token, entryPoint: 'entrance', clientAt: new Date(Date.now() - 5000).toISOString() },
      ],
    });
    expect(res2.results[0].status).toBe('already_used');
  });

  it('replay batch : trop de scans → 400 ; agent inconnu → 403', async () => {
    const big = Array.from({ length: 201 }, (_, i) => ({ clientUuid: `big-uuid-${i}`, token: 'x'.repeat(32) }));
    await expect(syncScans(agentToken, { scans: big })).rejects.toMatchObject({ code: 'sync_batch_invalid' });
    await expect(syncScans('totally-unknown-token-000000000000', { scans: [] })).rejects.toMatchObject({ code: 'agent_denied' });
  });
});

describe('historique', () => {
  it('liste les check-ins (pagination, recherche, filtre résultat)', async () => {
    const all = await listCheckIns(ctx(), eventId, { page: 1, pageSize: 10 });
    expect(all.total).toBeGreaterThanOrEqual(1);
    expect(all.presentCount).toBeGreaterThanOrEqual(1);

    const found = await listCheckIns(ctx(), eventId, { page: 1, pageSize: 10, search: 'Aya' });
    expect(found.total).toBeGreaterThanOrEqual(1);
    expect(found.items[0].guest.firstName).toBe('Aya');

    const validOnly = await listCheckIns(ctx(), eventId, { page: 1, pageSize: 10, result: 'valid' });
    for (const c of validOnly.items) expect(c.result).toBe('valid');
  });
});
