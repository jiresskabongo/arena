/**
 * Tests d'intégration Phase 6 : invités (CRUD, pagination, filtres, tris),
 * tables (capacité/occupation), import CSV (300 lignes, 3 erreurs, doublons,
 * quota « toute ou rien »), export CSV (critères E/F).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { register } from '@/server/services/account';
import { createEvent } from '@/server/services/event';
import {
  addGuest, updateGuest, removeGuest, listGuests,
  createTable, updateTable, removeTable, listTables,
  createImportJob, confirmImport, exportGuestsCsv,
} from '@/server/services/guest';
import { TenantError, type TenantContext } from '@/server/services/tenant';

const stamp = Date.now().toString(36);
const email = `p6own.${stamp}@exemple.cd`;

let ownerId: string;
let orgId: string;
let eventId: string;

function ctx(): TenantContext {
  return {
    user: {
      id: ownerId, email, firstName: 'P6', lastName: 'Own', passwordHash: '',
      locale: 'fr', currency: 'USD', timezone: 'Africa/Kinshasa', isSuperAdmin: false,
      emailVerifiedAt: null,
    } as never,
    isSuperAdmin: false,
    organization: {
      id: orgId, name: 'P6', slug: 'p6', currency: 'USD', locale: 'fr',
      timezone: 'Africa/Kinshasa', isActive: true,
    },
    role: 'owner',
  };
}

beforeAll(async () => {
  const reg = await register(
    { email, password: 'Event1234', firstName: 'P6', lastName: 'Own', organizationName: `P6 Org ${stamp}` },
    null,
  );
  expect(reg.ok).toBe(true);
  if (!reg.ok) return;
  ownerId = reg.data.userId;
  orgId = reg.data.organizationId;
  const ev = await createEvent(ctx(), {
    name: `Événement Invités ${stamp}`, typeCode: 'gala', date: '2027-09-10',
    startTime: '18:00', timezone: 'Africa/Kinshasa', optionsJson: {},
    venue: 'Salle Test', city: 'Kinshasa',
  });
  eventId = ev.id;
});

afterAll(async () => {
  await prisma.event.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
  await prisma.user.delete({ where: { id: ownerId } }).catch(() => {});
  await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
  await prisma.$disconnect();
});

describe('tables (capacité + occupation)', () => {
  it('CRUD tables ; occupation ; suppression → invités sans table', async () => {
    const t1 = await createTable(ctx(), eventId, { name: 'Table 1', capacity: 4 });
    const t2 = await createTable(ctx(), eventId, { name: 'Famille', capacity: 6 });

    let list = await listTables(ctx(), eventId);
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe('Famille'); // tri par nom (sortOrder égal)

    // Occupation
    const g = await addGuest(ctx(), eventId, { firstName: 'A', lastName: 'Un', tableId: t1.id });
    await addGuest(ctx(), eventId, { firstName: 'B', lastName: 'Deux', tableId: t1.id });
    list = await listTables(ctx(), eventId);
    expect(list.find((t) => t.id === t1.id)?._count.guests).toBe(2);

    // Mise à jour capacité
    await updateTable(ctx(), eventId, t2.id, { capacity: 8, name: 'Grande Famille' });
    list = await listTables(ctx(), eventId);
    expect(list.find((t) => t.id === t2.id)?.capacity).toBe(8);

    // Suppression → invités « sans table »
    await removeTable(ctx(), eventId, t1.id);
    const row = await prisma.guest.findUnique({ where: { id: g.id } });
    expect(row?.tableId).toBeNull();
    list = await listTables(ctx(), eventId);
    expect(list).toHaveLength(1);
  });
});

describe('CRUD + liste paginée / filtres / tris', () => {
  it('ajout avec préférences, mise à jour partielle, suppression', async () => {
    const g = await addGuest(ctx(), eventId, {
      firstName: 'Kin', lastName: 'Banga', phone: '+243 99 111 222', email: 'kin@test.cd',
      category: 'vip', companions: 2,
      preference: { meal: 'Poulet', allergies: 'Fruits de mer' },
    });
    expect(g.id).toBeTruthy();

    await updateGuest(ctx(), eventId, g.id, {
      lastName: 'Banga-Mokolo',
      preference: { meal: 'Bœuf' },
      rsvpStatus: 'confirmed',
    });
    const row = await prisma.guest.findUnique({ where: { id: g.id }, include: { preference: true } });
    expect(row?.lastName).toBe('Banga-Mokolo');
    expect(row?.rsvpStatus).toBe('confirmed');
    expect(row?.preference?.meal).toBe('Bœuf');
    expect(row?.preference?.allergies).toBe('Fruits de mer'); // préservé (upsert partiel)

    const other = await addGuest(ctx(), eventId, { firstName: 'Z', lastName: 'Temp' });
    await removeGuest(ctx(), eventId, other.id);
    expect(await prisma.guest.findUnique({ where: { id: other.id } })).toBeNull();
  });

  it('pagination, recherche, filtres et tris (30+ invités)', async () => {
    for (let i = 0; i < 30; i++) {
      await prisma.guest.create({
        data: {
          eventId, organizationId: orgId,
          firstName: `Importe`, lastName: `N${String(i).padStart(2, '0')}`,
          phone: `+243 90 ${String(1000 + i)}`,
          category: i % 3 === 0 ? 'amis' : 'autres',
          rsvpStatus: i % 4 === 0 ? 'confirmed' : 'pending',
        },
      });
    }

    const page1 = await listGuests(ctx(), eventId, { page: 1, pageSize: 10, sort: 'name', dir: 'asc' });
    expect(page1.total).toBeGreaterThanOrEqual(32);
    expect(page1.items).toHaveLength(10);
    expect(page1.totalPages).toBe(Math.ceil(page1.total / 10));

    const page3 = await listGuests(ctx(), eventId, {
      page: page1.totalPages, pageSize: 10, sort: 'name', dir: 'asc',
    });
    expect(page3.items.length).toBe(page1.total - 10 * (page1.totalPages - 1));

    // Recherche (nom, téléphone, e-mail)
    const byName = await listGuests(ctx(), eventId, { search: 'N1' });
    expect(byName.items).toHaveLength(10); // N10..N19
    expect(byName.items.every((g) => g.lastName.startsWith('N1'))).toBe(true);
    const byPhone = await listGuests(ctx(), eventId, { search: '90 1021' });
    expect(byPhone.items).toHaveLength(1);
    expect(byPhone.items[0].lastName).toBe('N21');
    const byEmail = await listGuests(ctx(), eventId, { search: 'kin@test.cd' });
    expect(byEmail.items[0].firstName).toBe('Kin');

    // Filtres
    const vip = await listGuests(ctx(), eventId, { category: 'vip' });
    expect(vip.items.every((g) => g.category === 'vip')).toBe(true);
    const confirmed = await listGuests(ctx(), eventId, { rsvpStatus: 'confirmed' });
    expect(confirmed.items.every((g) => g.rsvpStatus === 'confirmed')).toBe(true);
    expect(confirmed.counts.confirmed).toBe(confirmed.items.length);
    const noTable = await listGuests(ctx(), eventId, { noTable: true });
    expect(noTable.items.every((g) => g.tableId === null)).toBe(true);

    // Tri desc
    const desc = await listGuests(ctx(), eventId, { sort: 'name', dir: 'desc' });
    expect(desc.items.length).toBeGreaterThan(0);
    const names = desc.items.map((g) => g.firstName + g.lastName);
    expect(names[0]).not.toBe(names[names.length - 1]);
  });
});

describe('import CSV (300 lignes, erreurs + doublons + quota)', () => {
  it('import validé : 300 lignes → 297 créées, 3 erreurs, doublons gérés', async () => {
    // Passage au plan Pro (guestsPerEvent 1000) pour l'import de masse
    const pro = await prisma.plan.findUnique({ where: { code: 'pro' } });
    if (pro) {
      await prisma.subscription.updateMany({
        where: { organizationId: orgId },
        data: { planId: pro.id, status: 'active' },
      });
    }

    // Table cible pour certaines lignes
    await createTable(ctx(), eventId, { name: 'Import T1', capacity: 200 });

    // Doublons préexistants (déjà dans la base)
    await addGuest(ctx(), eventId, { firstName: 'Doublon', lastName: 'Existant', phone: '+243 88 000 001' });

    const rows: { row: number; data: Record<string, string> }[] = [];
    for (let i = 0; i < 300; i++) {
      const r = i + 2; // ligne 1 = en-tête
      if (i === 10) rows.push({ row: r, data: { '0': '', '1': 'SansPrénom' } }); // erreur 1 : prénom manquant
      else if (i === 30) rows.push({ row: r, data: { '0': 'Mauvais', '1': 'Mail', '2': 'pas-un-email' } }); // erreur 2 : e-mail
      else if (i === 60) rows.push({ row: r, data: { '0': 'Table', '1': 'Inconnue', '4': 'NoTable' } }); // erreur 3 : table
      else if (i === 40) rows.push({ row: r, data: { '0': 'Doublon', '1': 'Existant', '3': '+243 88 000 001' } }); // doublon existant
      else if (i === 50) rows.push({ row: r, data: { '0': 'Intra', '1': 'Fichier', '3': '+243 77 555 555' } });
      else if (i === 51) rows.push({ row: r, data: { '0': 'Intra', '1': 'Fichier', '3': '+24377555555' } }); // doublon intra-fichier (même numéro, sans espaces)
      else if (i % 7 === 0) rows.push({ row: r, data: { '0': `Massif`, '1': `M${i}`, '3': `+243 89 ${1000 + i}`, '4': 'Import T1', '5': i % 3 === 0 ? 'amis' : 'vip', '6': i % 5 === 0 ? '1' : '' } });
      else rows.push({ row: r, data: { '0': `Massif`, '1': `M${i}`, '3': `+243 89 ${1000 + i}` } });
    }

    const job = await createImportJob(ctx(), eventId, {
      fileName: 'invites-300.csv', mimeType: 'text/csv', totalRows: 300,
    });
    const mapping = {
      '0': 'firstName', '1': 'lastName', '2': 'email', '3': 'phone', '4': 'table', '5': 'category', '6': 'companions',
    } as Record<string, 'firstName' | 'lastName' | 'email' | 'phone' | 'category' | 'companions' | 'table'>;

    const before = await prisma.guest.count({ where: { eventId } });
    const res = await confirmImport(ctx(), eventId, { jobId: job.id, mapping, rows });

    const after = await prisma.guest.count({ where: { eventId } });
    expect(res.errors.length).toBe(3);
    expect(res.errors.map((e) => e.row).sort((a, b) => a - b)).toEqual([12, 32, 62]);
    expect(res.created).toBe(after - before);
    // 300 - 3 erreurs - 2 doublons (existant + intra) = 295
    expect(res.created).toBe(295);
    expect(res.duplicates).toBe(2);

    // Job archivé avec les comptes
    const jobRow = await prisma.importJob.findUnique({ where: { id: job.id } });
    expect(jobRow?.status).toBe('confirmed');
    expect(jobRow?.validRows).toBe(295);
    expect(jobRow?.errorRows).toBe(3);
    expect(jobRow?.duplicateRows).toBe(2);

    // Attribution table + catégories honorées
    const seated = await prisma.guest.count({ where: { eventId, table: { isNot: null } } });
    expect(seated).toBe(43); // 43 lignes avec « Import T1 » (i%7===0, 43 valeurs dans 0..299)
    const vipCount = await prisma.guest.count({
      where: { eventId, category: 'vip' },
    });
    expect(vipCount).toBeGreaterThan(0);
  });

  it('import déjà confirmé → 409 ; job inconnu → 404', async () => {
    const job = await prisma.importJob.findFirst({ where: { eventId } });
    expect(job).toBeTruthy();
    await expect(
      confirmImport(ctx(), eventId, {
        jobId: job!.id,
        mapping: { '0': 'firstName', '1': 'lastName' },
        rows: [{ row: 2, data: { '0': 'X', '1': 'Y' } }],
      }),
    ).rejects.toMatchObject({ code: 'import_already_confirmed' });

    await expect(
      confirmImport(ctx(), eventId, {
        jobId: 'job-inconnu',
        mapping: { '0': 'firstName', '1': 'lastName' },
        rows: [{ row: 2, data: { '0': 'X', '1': 'Y' } }],
      }),
    ).rejects.toMatchObject({ code: 'import_job_not_found' });
  });

  it('quota « toute ou rien » : sous le plan Pro→Starter (100), un import de masse est refusé SANS création', async () => {
    const starter = await prisma.plan.findUnique({ where: { code: 'starter' } });
    if (starter) {
      await prisma.subscription.updateMany({
        where: { organizationId: orgId },
        data: { planId: starter.id, status: 'active' },
      });
    }
    const before = await prisma.guest.count({ where: { eventId } });
    const job = await createImportJob(ctx(), eventId, {
      fileName: 'trop.csv', mimeType: 'text/csv', totalRows: 50,
    });
    const rows = Array.from({ length: 50 }, (_, i) => ({
      row: i + 2,
      data: { '0': `Refus`, '1': `R${i}`, '3': `+243 81 ${2000 + i}` },
    }));
    await expect(
      confirmImport(ctx(), eventId, {
        jobId: job.id,
        mapping: { '0': 'firstName', '1': 'lastName', '3': 'phone' },
        rows,
      }),
    ).rejects.toMatchObject({ code: 'quota_exceeded' });
    const after = await prisma.guest.count({ where: { eventId } });
    expect(after).toBe(before); // aucune création
    const jobRow = await prisma.importJob.findUnique({ where: { id: job.id } });
    expect(jobRow?.status).toBe('failed');
  });
});

describe('export CSV', () => {
  it('exporte les invités avec en-têtes et contenu UTF-8 (BOM)', async () => {
    const { fileName, content } = await exportGuestsCsv(ctx(), eventId, {});
    expect(fileName).toContain('.csv');
    const lines = content.replace(/^\uFEFF/, '').split('\n');
    expect(lines[0]).toContain('Prénom');
    expect(lines[0]).toContain('Table');
    expect(lines.length).toBeGreaterThan(300);
    expect(content).toContain('Kin');
  });
});
