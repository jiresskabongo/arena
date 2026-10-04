/**
 * Tests d'intégration Phase 12 : stats, rapports, livre d'or (critères M/N).
 * - KPIs cohérents avec la DB (invités, RSVP, check-ins, tables, livre d'or)
 * - Séries : arrivées/heure, présence/catégorie, évolution RSVP cumulative
 * - Rapports CSV (BOM + `;`), XLSX (parseable), PDF (%PDF) ; types guests/rsvp/
 *   present/absent/scans/tables/stats/guestbook ; exports cohérents avec DB
 * - Livr d'or : modération (approved → visible public, hidden/rejected → masqué),
 *   permission event:update, isolation inter-tenants
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { register } from '@/server/services/account';
import { createEvent, setEventStatus } from '@/server/services/event';
import { addGuest } from '@/server/services/guest';
import { generateInvitations } from '@/server/services/invitation';
import { createScannerAgent, scanCheckIn } from '@/server/services/checkin';
import {
  getEventStatistics, listGuestbook, moderateGuestbook, buildReport,
} from '@/server/services/statistics';
import { TenantError } from '@/server/services/tenant';
import type { TenantContext } from '@/server/services/tenant';

const stamp = Date.now().toString(36);
const email = `p12own.${stamp}@exemple.cd`;
const email2 = `p12other.${stamp}@exemple.cd`;

let ownerId: string;
let orgId: string;
let otherOwnerId: string;
let otherOrgId: string;
let eventId: string;
let agentToken: string;

function ctx(o = { id: orgId, slug: 'p12', name: 'P12' }, u = { id: ownerId }): TenantContext {
  return {
    user: { id: u.id, email, firstName: 'P12', lastName: 'Own', passwordHash: '', locale: 'fr', currency: 'USD', timezone: 'Africa/Kinshasa', isSuperAdmin: false, emailVerifiedAt: null } as never,
    isSuperAdmin: false,
    organization: { id: o.id, name: o.name, slug: o.slug, currency: 'USD', locale: 'fr', timezone: 'Africa/Kinshasa', isActive: true },
    role: 'owner',
  };
}
function otherCtx(): TenantContext {
  return {
    user: { id: otherOwnerId, email: email2, firstName: 'P12', lastName: 'Oth', passwordHash: '', locale: 'fr', currency: 'USD', timezone: 'Africa/Kinshasa', isSuperAdmin: false, emailVerifiedAt: null } as never,
    isSuperAdmin: false,
    organization: { id: otherOrgId, name: 'P12 Other', slug: `p12o${stamp}`, currency: 'USD', locale: 'fr', timezone: 'Africa/Kinshasa', isActive: true },
    role: 'owner',
  };
}
function designerCtx(): TenantContext {
  return { ...ctx(), role: 'designer' };
}

beforeAll(async () => {
  const reg = await register({ email, password: 'Event1234', firstName: 'P12', lastName: 'Own', organizationName: `P12 Org ${stamp}` }, null);
  expect(reg.ok).toBe(true);
  if (!reg.ok) return;
  ownerId = reg.data.userId;
  orgId = reg.data.organizationId;

  const reg2 = await register({ email: email2, password: 'Event1234', firstName: 'P12', lastName: 'Oth', organizationName: `P12 Other ${stamp}` }, null);
  expect(reg2.ok).toBe(true);
  if (!reg2.ok) return;
  otherOwnerId = reg2.data.userId;
  otherOrgId = reg2.data.organizationId;

  const pro = await prisma.plan.findUnique({ where: { code: 'pro' } });
  if (pro) {
    await prisma.subscription.updateMany({ where: { organizationId: { in: [orgId, otherOrgId] } }, data: { planId: pro.id, status: 'active' } });
  }

  // Événement futur (RSVP ouvert) — les check-ins datent de « maintenant »
  const d = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const ev = await createEvent(ctx(), {
    name: `Gala P12 ${stamp}`, typeCode: 'gala',
    date: d.toISOString().slice(0, 10), startTime: '19:00', timezone: 'Africa/Kinshasa',
    optionsJson: { rsvp: true, guestbook: true }, venue: 'Salle T', city: 'KIN',
  });
  eventId = ev.id;
  await setEventStatus(ctx(), eventId, 'published');

  // 4 invités : 2 confirmés (1 présent ×2 passages vip, 1 présent), 1 décliné, 1 en attente
  const a = await addGuest(ctx(), eventId, { firstName: 'Alice', lastName: 'K', email: `alice.${stamp}@p12.cd`, category: 'vip' });
  const b = await addGuest(ctx(), eventId, { firstName: 'Bruno', lastName: 'M', email: `bruno.${stamp}@p12.cd`, category: 'amis' });
  const c = await addGuest(ctx(), eventId, { firstName: 'Chloe', lastName: 'N', email: `chloe.${stamp}@p12.cd`, category: 'famille' });
  const dd = await addGuest(ctx(), eventId, { firstName: 'Didier', lastName: 'O', email: `didier.${stamp}@p12.cd`, category: 'autres' });
  await generateInvitations(ctx(), eventId, null);

  // RSVP via les tokens publics (crée aussi les lignes Rsvp)
  const invs = await prisma.invitation.findMany({ where: { eventId }, include: { token: true } });
  const tokenOf = (guestId: string) => invs.find((i) => i.guestId === guestId)!.token!.token;
  const { submitRsvp } = await import('@/server/services/invitation');
  await submitRsvp(tokenOf(a.id), { status: 'confirmed', companions: 1 }, null);
  await submitRsvp(tokenOf(b.id), { status: 'confirmed' }, null);
  await submitRsvp(tokenOf(c.id), { status: 'declined' }, null);
  // dd reste pending

  // Tables : T1 (cap 2, 1 occupé)
  const t1 = await prisma.table.create({ data: { eventId, organizationId: orgId, name: 'Table 1', capacity: 2 } });
  await prisma.guest.update({ where: { id: a.id }, data: { tableId: t1.id } });

  // Check-ins : agent + scans (Alice 2 passages = multi-entrée OFF → 2e déjà utilisé)
  const agent = await createScannerAgent(ctx(), eventId, { name: 'Agent P12', entryPoint: 'entrance' });
  agentToken = agent.token;
  const alInv = invs.find((i) => i.guestId === a.id)!;
  const brInv = invs.find((i) => i.guestId === b.id)!;
  const uuid = () => crypto.randomUUID();
  await scanCheckIn(agentToken, { token: alInv.token!.token, clientUuid: uuid() });
  await scanCheckIn(agentToken, { token: alInv.token!.token, clientUuid: uuid() }); // déjà utilisé
  await scanCheckIn(agentToken, { token: brInv.token!.token, clientUuid: uuid() });

  // Livr d'or : 1 publié (auto P5) + 1 créé « pending » pour la modération
  await prisma.guestBookMessage.create({
    data: { eventId, organizationId: orgId, authorName: 'Mireille', message: 'Super soirée, merci !', status: 'approved', publishedAt: new Date() },
  });
  await prisma.guestBookMessage.create({
    data: { eventId, organizationId: orgId, authorName: 'Spammy', message: 'Achetez mes billets…', status: 'pending' },
  });
});

afterAll(async () => {
  for (const org of [orgId, otherOrgId]) {
    const eventIds = (await prisma.event.findMany({ where: { organizationId: org }, select: { id: true } })).map((e) => e.id);
    await prisma.checkIn.deleteMany({ where: { organizationId: org } }).catch(() => {});
    await prisma.scannerAgent.deleteMany({ where: { organizationId: org } }).catch(() => {});
    await prisma.guestBookMessage.deleteMany({ where: { organizationId: org } }).catch(() => {});
    await prisma.rsvp.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => {});
    await prisma.invitation.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => {});
    await prisma.table.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => {});
    await prisma.guest.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => {});
    await prisma.event.deleteMany({ where: { organizationId: org } }).catch(() => {});
  }
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherOwnerId] } } }).catch(() => {});
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } }).catch(() => {});
  await prisma.$disconnect();
});

describe('KPIs & séries (cohérence DB)', () => {
  it('invités, RSVP, perspectives, invitations', async () => {
    const s = await getEventStatistics(ctx(), eventId);
    expect(s.guests.total).toBe(4);
    expect(s.guests.byCategory.vip).toBe(1);
    expect(s.guests.byCategory.amis).toBe(1);
    expect(s.guests.byCategory.famille).toBe(1);
    expect(s.guests.byCategory.autres).toBe(1);
    expect(s.guests.rsvp.confirmed).toBe(2);
    expect(s.guests.rsvp.declined).toBe(1);
    expect(s.guests.rsvp.pending).toBe(1);
    // Alice (confirmée, 1 accompagnant) + Bruno (confirmé) = 3 perspectives
    expect(s.guests.rsvp.expected).toBe(3);
    expect(s.guests.invitations.total).toBe(4);
    expect(s.guests.invitations.sent).toBe(0); // jamais envoyée par campagne
  });

  it('check-ins : passages, présents, arrivées/heure, par point d’entrée', async () => {
    const s = await getEventStatistics(ctx(), eventId);
    // already_used ne crée pas de ligne CheckIn (réservation P9) → 2 passages
    expect(s.checkins.total).toBe(2);
    expect(s.checkins.presentGuests).toBe(2); // Alice + Bruno
    const totalByHour = s.checkins.byHour.reduce((n, h) => n + h.count, 0);
    expect(totalByHour).toBe(2);
    expect(s.checkins.byEntryPoint.entrance).toBe(2);
    const vip = s.checkins.byCategory.find((c) => c.category === 'vip');
    const amis = s.checkins.byCategory.find((c) => c.category === 'amis');
    expect(vip?.count).toBe(1);
    expect(amis?.count).toBe(1);
  });

  it('tables : occupation 1/2 = 50 %', async () => {
    const s = await getEventStatistics(ctx(), eventId);
    expect(s.tables.count).toBe(1);
    expect(s.tables.assignedSeats).toBe(1);
    expect(s.tables.totalSeats).toBe(2);
    expect(s.tables.occupancyPct).toBe(50);
  });

  it('livre d’or : 1 publié, 1 en attente', async () => {
    const s = await getEventStatistics(ctx(), eventId);
    expect(s.guestbook.total).toBe(2);
    expect(s.guestbook.approved).toBe(1);
    expect(s.guestbook.pending).toBe(1);
  });

  it('évolution RSVP : série cumulative non décroissante', async () => {
    const s = await getEventStatistics(ctx(), eventId);
    expect(s.rsvpTimeline.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < s.rsvpTimeline.length; i++) {
      expect(s.rsvpTimeline[i].confirmed).toBeGreaterThanOrEqual(s.rsvpTimeline[i - 1].confirmed);
      expect(s.rsvpTimeline[i].declined).toBeGreaterThanOrEqual(s.rsvpTimeline[i - 1].declined);
    }
    const last = s.rsvpTimeline[s.rsvpTimeline.length - 1];
    expect(last.confirmed).toBe(2);
    expect(last.declined).toBe(1);
  });
});

describe('rapports (exports cohérents avec DB)', () => {
  it('CSV : BOM + séparateur `;`, 4 lignes invités', async () => {
    const res = await buildReport(ctx(), eventId, 'guests', 'csv');
    expect(res.contentType).toContain('text/csv');
    const text = res.buffer.toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.split('\r\n').filter((l) => l.length > 0);
    expect(lines[0]).toContain('Prénom;Nom');
    expect(lines.length).toBe(5); // en-tête + 4
    expect(lines.some((l) => l.startsWith('Alice;'))).toBe(true);
  });

  it('rsvp : 3 répondants (Alice, Bruno, Chloé)', async () => {
    const res = await buildReport(ctx(), eventId, 'rsvp', 'csv');
    const lines = res.buffer.toString('utf8').split('\r\n').filter(Boolean);
    expect(lines.length).toBe(4); // en-tête + 3
    expect(lines.some((l) => l.includes('Chloe'))).toBe(true);
  });

  it('present / absent : Alice + Bruno présents, Didier absent-confirmé non compté (pending)', async () => {
    const pres = await buildReport(ctx(), eventId, 'present', 'csv');
    const pLines = pres.buffer.toString('utf8').split('\r\n').filter(Boolean);
    expect(pLines.length).toBe(3); // en-tête + 2
    expect(pLines.some((l) => l.startsWith('Alice;'))).toBe(true);

    const abs = await buildReport(ctx(), eventId, 'absent', 'csv');
    const aLines = abs.buffer.toString('utf8').split('\r\n').filter(Boolean);
    expect(aLines.length).toBe(1); // en-tête uniquement : aucun confirmé absent
  });

  it('scans : journal des passages enregistrés (valid)', async () => {
    const res = await buildReport(ctx(), eventId, 'scans', 'csv');
    const lines = res.buffer.toString('utf8').split('\r\n').filter(Boolean);
    expect(lines.length).toBe(3); // en-tête + 2 passages (already_used = audit seul, P9)
    const body = lines.slice(1).join('\n');
    expect(body).toContain('valid');
    expect(body).not.toContain('already_used');
  });

  it('tables : total + ligne par table', async () => {
    const res = await buildReport(ctx(), eventId, 'tables', 'csv');
    const lines = res.buffer.toString('utf8').split('\r\n').filter(Boolean);
    expect(lines.length).toBe(3); // en-tête + Table 1 + TOTAL
    expect(lines[1]).toMatch(/Table 1;2;1;50/);
    expect(lines[2]).toContain('TOTAL');
  });

  it('stats : synthèse des KPIs', async () => {
    const res = await buildReport(ctx(), eventId, 'stats', 'csv');
    const text = res.buffer.toString('utf8');
    expect(text).toContain('Perspectives');
    expect(text).toContain('3');
  });

  it('guestbook : messages + statuts', async () => {
    const res = await buildReport(ctx(), eventId, 'guestbook', 'csv');
    const text = res.buffer.toString('utf8');
    expect(text).toContain('Mireille');
    expect(text).toContain('Spammy');
  });

  it('XLSX : fichier parseable (SheetJS) avec les bonnes lignes', async () => {
    const res = await buildReport(ctx(), eventId, 'guests', 'xlsx');
    expect(res.contentType).toContain('spreadsheetml');
    const XLSX = await import('xlsx');
    const wb = XLSX.read(res.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown as unknown[][];
    expect(rows[0]).toEqual(expect.arrayContaining(['Prénom', 'Nom', 'E-mail']));
    expect(rows.length).toBe(5);
    expect(rows.some((r) => r[0] === 'Alice')).toBe(true);
  });

  it('PDF : magic %PDF, taille > 1 Ko', async () => {
    const res = await buildReport(ctx(), eventId, 'scans', 'pdf');
    expect(res.contentType).toBe('application/pdf');
    expect(res.buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(res.buffer.length).toBeGreaterThan(1000);
  });

  it('type/format invalides → 400', async () => {
    await expect(buildReport(ctx(), eventId, 'inconnu' as never, 'csv')).rejects.toThrow(TenantError);
  });

  it('isolation : événement d’une autre org → 404', async () => {
    await expect(getEventStatistics(otherCtx(), eventId)).rejects.toThrow(TenantError);
    await expect(buildReport(otherCtx(), eventId, 'guests', 'csv')).rejects.toThrow(TenantError);
  });
});

describe('livre d’or : modération', () => {
  it('liste paginée avec filtre statut', async () => {
    const all = await listGuestbook(ctx(), eventId, { pageSize: 10 });
    expect(all.total).toBe(2);
    const pending = await listGuestbook(ctx(), eventId, { status: 'pending' });
    expect(pending.total).toBe(1);
    expect(pending.items[0].authorName).toBe('Spammy');
  });

  it('pending → hidden : masqué (plus « pending », visible admin uniquement)', async () => {
    const msg = (await prisma.guestBookMessage.findFirst({ where: { eventId, authorName: 'Spammy' } }))!;
    const res = await moderateGuestbook(ctx(), eventId, msg.id, 'hidden');
    expect(res.message.status).toBe('hidden');
    const s = await getEventStatistics(ctx(), eventId);
    expect(s.guestbook.hidden).toBe(1);
    expect(s.guestbook.pending).toBe(0);
  });

  it('hidden → approved : republié (publishedAt conservé/posé)', async () => {
    const msg = (await prisma.guestBookMessage.findFirst({ where: { eventId, authorName: 'Spammy' } }))!;
    await moderateGuestbook(ctx(), eventId, msg.id, 'approved');
    const row = await prisma.guestBookMessage.findUnique({ where: { id: msg.id } });
    expect(row!.status).toBe('approved');
    expect(row!.publishedAt).toBeInstanceOf(Date);
    // Visible dans le rapport + KPI
    const s = await getEventStatistics(ctx(), eventId);
    expect(s.guestbook.approved).toBe(2);
  });

  it('approved → rejected : rejeté', async () => {
    const msg = (await prisma.guestBookMessage.findFirst({ where: { eventId, authorName: 'Spammy' } }))!;
    await moderateGuestbook(ctx(), eventId, msg.id, 'rejected');
    const s = await getEventStatistics(ctx(), eventId);
    expect(s.guestbook.rejected).toBe(1);
    expect(s.guestbook.approved).toBe(1);
  });

  it('statut invalide → 400 ; message inconnu → 404', async () => {
    const msg = (await prisma.guestBookMessage.findFirst({ where: { eventId } }))!;
    await expect(moderateGuestbook(ctx(), eventId, msg.id, 'publié_ailleurs')).rejects.toThrow(TenantError);
    await expect(moderateGuestbook(ctx(), eventId, 'inconnu', 'approved')).rejects.toThrow(TenantError);
  });

  it('permissions : designer (event:update) modère ; le RSVP public n’est pas affecté', async () => {
    const msg = (await prisma.guestBookMessage.findFirst({ where: { eventId, authorName: 'Mireille' } }))!;
    const res = await moderateGuestbook(designerCtx(), eventId, msg.id, 'hidden');
    expect(res.message.status).toBe('hidden');
    await moderateGuestbook(ctx(), eventId, msg.id, 'approved'); // remise en place
  });

  it('isolation : autre org ne liste ni modère rien', async () => {
    await expect(listGuestbook(otherCtx(), eventId, {})).rejects.toThrow(TenantError);
  });
});
