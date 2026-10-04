import { prisma } from '@/lib/prisma';
import { tenantWhere, TenantError, type TenantContext } from '@/server/services/tenant';
import { getEventForOrg } from '@/server/services/event';
import { logActivity } from '@/server/services/activity';
import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';

/**
 * Stats & rapports (CDC §36, critères M/N, périmètre P12) :
 * - KPIs événement complets + séries pour graphiques (évolution RSVP,
 *   arrivées/heure, présence/catégorie, occupation tables)
 * - Rapports exportables : guests | rsvp | present | absent | scans |
 *   tables | stats | guestbook — formats CSV (`;` + BOM), XLSX (SheetJS),
 *   PDF (PDFKit) — téléchargement `Content-Disposition: attachment`.
 * - Livr d'or : modération (approved/hidden/rejected) + export.
 */

const GUEST_CATEGORIES = ['famille', 'amis', 'vip', 'collegues', 'autres'] as const;

export async function getEventStatistics(ctx: TenantContext, eventId: string) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');

  const w = { eventId: event.id, organizationId: orgId };

  const [guests, invitations, checkIns, tables, guestbook, rsvps] = await Promise.all([
    prisma.guest.groupBy({ by: ['rsvpStatus', 'category', 'inviteStatus'], where: w, _count: { _all: true }, _sum: { companions: true } }),
    prisma.invitation.groupBy({ by: ['status'], where: w, _count: { _all: true } }),
    prisma.checkIn.groupBy({ by: ['entryPoint', 'result'], where: w, _count: { _all: true } }),
    prisma.table.findMany({ where: w, include: { guests: { select: { id: true } } }, orderBy: { name: 'asc' } }),
    prisma.guestBookMessage.groupBy({ by: ['status'], where: w, _count: { _all: true } }),
    prisma.rsvp.findMany({ where: w, select: { guestId: true, status: true, createdAt: true, companions: true } }),
  ]);

  // Invités par catégorie + totaux
  const catCount: Record<string, number> = {};
  for (const c of GUEST_CATEGORIES) catCount[c] = 0;
  let totalGuests = 0;
  const rsvpCount: Record<string, number> = { confirmed: 0, maybe: 0, declined: 0, pending: 0 };
  for (const g of guests) {
    totalGuests += g._count._all;
    const c = (g.category as (typeof GUEST_CATEGORIES)[number]) ?? 'autres';
    catCount[c] = (catCount[c] ?? 0) + g._count._all;
    const s = g.rsvpStatus as keyof typeof rsvpCount;
    rsvpCount[s] = (rsvpCount[s] ?? 0) + g._count._all;
  }
  // Perspectives = confirmés (×1) + accompagnants déclarés au RSVP (Rsvp.companions)
  const invitedCompanions = rsvps
    .filter((r) => r.status === 'confirmed')
    .reduce((n, r) => n + (r.companions ?? 0), 0);

  const invByStatus: Record<string, number> = {};
  for (const i of invitations) invByStatus[i.status] = i._count._all;

  // Check-ins : par heure (date de l'événement, fuseau de l'événement), par point d'entrée
  const checkInRows = await prisma.checkIn.findMany({
    where: w,
    select: { checkedInAt: true, entryPoint: true, guest: { select: { category: true } } },
  });
  const byHour: Record<string, number> = {};
  for (let h = 0; h < 24; h++) byHour[String(h).padStart(2, '0')] = 0;
  const byCategoryPresent: Record<string, number> = {};
  for (const c of GUEST_CATEGORIES) byCategoryPresent[c] = 0;
  const hourOffset = 0; // MVP : heure UTC de l'horodatage (réserves §13)
  for (const c of checkInRows) {
    const d = new Date(c.checkedInAt.getTime() + hourOffset * 3600_000);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    byHour[hh] = (byHour[hh] ?? 0) + 1;
    const cat = (c.guest.category as (typeof GUEST_CATEGORIES)[number]) ?? 'autres';
    byCategoryPresent[cat] = (byCategoryPresent[cat] ?? 0) + 1;
  }
  const byEntryPoint: Record<string, number> = {};
  for (const c of checkIns) {
    const ep = c.entryPoint ?? 'autre';
    byEntryPoint[ep] = (byEntryPoint[ep] ?? 0) + c._count._all;
  }
  const presentGuests = await prisma.guest.count({ where: { ...w, presenceStatus: 'present' } });

  // Évolution cumulative des RSVP (par date UTC)
  const daily: Record<string, Record<string, number>> = {};
  const bump = (iso: string, status: string) => {
    const day = iso.slice(0, 10);
    daily[day] = daily[day] ?? { confirmed: 0, maybe: 0, declined: 0 };
    if (status in daily[day]) daily[day][status] += 1;
  };
  for (const r of rsvps) {
    if (r.status !== 'pending') bump(r.createdAt.toISOString(), r.status);
  }
  const rsvpTimeline: { date: string; confirmed: number; maybe: number; declined: number }[] = [];
  let cumC = 0, cumM = 0, cumD = 0;
  for (const day of Object.keys(daily).sort()) {
    cumC += daily[day].confirmed;
    cumM += daily[day].maybe;
    cumD += daily[day].declined;
    rsvpTimeline.push({ date: day, confirmed: cumC, maybe: cumM, declined: cumD });
  }

  const tableStats = tables.map((t) => ({
    id: t.id,
    name: t.name,
    seats: t.guests.length,
    capacity: t.capacity,
  }));
  const totalSeats = tables.reduce((n, t) => n + t.capacity, 0);
  const assignedSeats = tables.reduce((n, t) => n + t.guests.length, 0);

  const gb: Record<string, number> = {};
  for (const g of guestbook) gb[g.status] = g._count._all;

  return {
    event: { id: event.id, name: event.name, date: event.date.toISOString(), startTime: event.startTime },
    guests: {
      total: totalGuests,
      byCategory: catCount,
      rsvp: {
        confirmed: rsvpCount.confirmed ?? 0,
        maybe: rsvpCount.maybe ?? 0,
        declined: rsvpCount.declined ?? 0,
        pending: rsvpCount.pending ?? 0,
        expected: (rsvpCount.confirmed ?? 0) + invitedCompanions,
        invitedCompanions,
      },
      invitations: {
        total: Object.values(invByStatus).reduce((a, b) => a + b, 0),
        sent: invByStatus['sent'] ?? 0,
        draft: invByStatus['draft'] ?? 0,
      },
    },
    checkins: {
      total: checkInRows.length,
      presentGuests,
      byHour: Object.entries(byHour).map(([hour, count]) => ({ hour, count })),
      byEntryPoint,
      byCategory: Object.entries(byCategoryPresent).map(([category, count]) => ({ category, count })),
    },
    tables: {
      count: tables.length,
      totalSeats,
      assignedSeats,
      occupancyPct: totalSeats > 0 ? Math.round((assignedSeats / totalSeats) * 100) : 0,
      rows: tableStats,
    },
    guestbook: {
      total: Object.values(gb).reduce((a, b) => a + b, 0),
      approved: gb['approved'] ?? 0,
      pending: gb['pending'] ?? 0,
      hidden: gb['hidden'] ?? 0,
      rejected: gb['rejected'] ?? 0,
    },
    rsvpTimeline,
  };
}

// ─────────────────────────── Livr d'or (modération) ───────────────────────────

export async function listGuestbook(
  ctx: TenantContext,
  eventId: string,
  q: { page?: number; pageSize?: number; status?: string },
) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');

  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 25));
  const where: Prisma.GuestBookMessageWhereInput = {
    eventId: event.id,
    organizationId: orgId,
    ...(q.status && q.status !== 'all' ? { status: q.status } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.guestBookMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.guestBookMessage.count({ where }),
  ]);
  return {
    items: items.map((m) => ({
      id: m.id,
      authorName: m.authorName,
      authorEmail: m.authorEmail,
      message: m.message,
      status: m.status,
      publishedAt: m.publishedAt ? m.publishedAt.toISOString() : null,
      createdAt: m.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Modération : approved (visible publiquement) | hidden (masqué) | rejected (rejeté). */
export async function moderateGuestbook(
  ctx: TenantContext,
  eventId: string,
  messageId: string,
  status: string,
  ip: string | null = null,
) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');
  if (!['approved', 'hidden', 'rejected'].includes(status)) {
    throw new TenantError(400, 'invalid_status', 'Statut invalide (approved | hidden | rejected).');
  }

  const msg = await prisma.guestBookMessage.findFirst({
    where: { id: messageId, eventId: event.id, organizationId: orgId },
  });
  if (!msg) throw new TenantError(404, 'message_not_found', 'Message introuvable.');

  const saved = await prisma.guestBookMessage.update({
    where: { id: msg.id },
    data: { status, ...(status === 'approved' && !msg.publishedAt ? { publishedAt: new Date() } : {}) },
  });
  await logActivity({
    organizationId: orgId,
    userId: ctx.user.id,
    action: 'guestbook.moderate',
    entity: 'guest_book_message',
    entityId: saved.id,
    meta: { status },
    ip,
  });
  return { ok: true as const, message: { id: saved.id, status: saved.status } };
}

// ─────────────────────────── Rapports ───────────────────────────

export const REPORT_TYPES = ['guests', 'rsvp', 'present', 'absent', 'scans', 'tables', 'stats', 'guestbook'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
const REPORT_FORMATS = ['csv', 'pdf', 'xlsx'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

type Row = (string | number)[];

async function collectReport(
  ctx: TenantContext,
  eventId: string,
  type: ReportType,
): Promise<{ title: string; headers: string[]; rows: Row[] }> {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');
  const w = { eventId: event.id, organizationId: orgId };
  const g2f = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace('T', ' ') : '');
  const full2f = (d: Date) => d.toISOString().slice(0, 10);

  switch (type) {
    case 'guests': {
      const rows = await prisma.guest.findMany({
        where: w,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        include: { table: { select: { name: true } } },
      });
      return {
        title: `Invités — ${event.name}`,
        headers: ['Prénom', 'Nom', 'E-mail', 'Téléphone', 'Catégorie', 'Invitation', 'RSVP', 'Table', 'Accompagnants'],
        rows: rows.map((g) => [
          g.firstName, g.lastName, g.email ?? '', g.phone ?? '', g.category,
          g.inviteStatus, g.rsvpStatus, g.table?.name ?? '', g.companions,
        ]),
      };
    }
    case 'rsvp': {
      const rows = await prisma.guest.findMany({
        where: { ...w, rsvpStatus: { not: 'pending' } },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        include: { rsvp: true, table: { select: { name: true } } },
      });
      return {
        title: `RSVP — ${event.name}`,
        headers: ['Prénom', 'Nom', 'E-mail', 'Statut', 'Accompagnants', 'Table'],
        rows: rows.map((g) => [
          g.firstName, g.lastName, g.email ?? '', g.rsvpStatus,
          g.rsvp?.companions ?? g.companions, g.table?.name ?? '',
        ]),
      };
    }
    case 'present': {
      const rows = await prisma.guest.findMany({
        where: { ...w, presenceStatus: 'present' },
        orderBy: { checkedInAt: 'asc' },
        include: { checkIns: { orderBy: { checkedInAt: 'asc' } } },
      });
      return {
        title: `Présents — ${event.name}`,
        headers: ['Prénom', 'Nom', 'Catégorie', 'Première entrée', 'Dernière entrée', 'Passages', 'Point d’entrée'],
        rows: rows.map((g) => [
          g.firstName, g.lastName, g.category,
          g2f(g.checkIns[0]?.checkedInAt ?? g.checkedInAt ?? null),
          g2f(g.checkIns[g.checkIns.length - 1]?.checkedInAt ?? null),
          g.checkIns.length,
          g.checkIns[0]?.entryPoint ?? '',
        ]),
      };
    }
    case 'absent': {
      const rows = await prisma.guest.findMany({
        where: { ...w, rsvpStatus: 'confirmed', presenceStatus: { not: 'present' } },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        include: { table: { select: { name: true } } },
      });
      return {
        title: `Confirmés absents — ${event.name}`,
        headers: ['Prénom', 'Nom', 'E-mail', 'Table', 'Accompagnants'],
        rows: rows.map((g) => [g.firstName, g.lastName, g.email ?? '', g.table?.name ?? '', g.companions]),
      };
    }
    case 'scans': {
      const rows = await prisma.checkIn.findMany({
        where: w,
        orderBy: { checkedInAt: 'asc' },
        include: { guest: { select: { firstName: true, lastName: true } } },
      });
      return {
        title: `Historique des scans — ${event.name}`,
        headers: ['Date/heure (UTC)', 'Invité', 'Point d’entrée', 'Résultat'],
        rows: rows.map((c) => [
          g2f(c.checkedInAt),
          `${c.guest?.firstName ?? ''} ${c.guest?.lastName ?? ''}`.trim(),
          c.entryPoint ?? '',
          c.result ?? '',
        ]),
      };
    }
    case 'tables': {
      const tables = await prisma.table.findMany({
        where: w,
        include: { guests: { select: { id: true } } },
        orderBy: { name: 'asc' },
      });
      const totalCap = tables.reduce((n, t) => n + t.capacity, 0);
      return {
        title: `Tables — ${event.name}`,
        headers: ['Table', 'Capacité', 'Occupée', 'Taux (%)'],
        rows: [
          ...tables.map((t) => [
            t.name, t.capacity, t.guests.length,
            t.capacity > 0 ? Math.round((t.guests.length / t.capacity) * 100) : 0,
          ]),
          ['TOTAL', totalCap, tables.reduce((n, t) => n + t.guests.length, 0),
            totalCap > 0 ? Math.round((tables.reduce((n, t) => n + t.guests.length, 0) / totalCap) * 100) : 0],
        ],
      };
    }
    case 'stats': {
      const s = await getEventStatistics(ctx, eventId);
      const r = s.guests.rsvp;
      return {
        title: `Statistiques — ${event.name}`,
        headers: ['Indicateur', 'Valeur'],
        rows: [
          ['Invités (total)', s.guests.total],
          ['RSVP confirmés', r.confirmed],
          ['RSVP peut-être', r.maybe],
          ['RSVP déclinés', r.declined],
          ['RSVP en attente', r.pending],
          ['Perspectives (confirmés + accompagnants)', r.expected],
          ['Invitations générées', s.guests.invitations.total],
          ['Invitations envoyées', s.guests.invitations.sent],
          ['Passages (check-ins)', s.checkins.total],
          ['Invités présents', s.checkins.presentGuests],
          ['Tables (sièges)', `${s.tables.assignedSeats}/${s.tables.totalSeats}`],
          ['Occupation tables (%)', s.tables.occupancyPct],
          ['Livre d’or (approuvés)', s.guestbook.approved],
        ],
      };
    }
    case 'guestbook': {
      const rows = await prisma.guestBookMessage.findMany({
        where: w,
        orderBy: { createdAt: 'desc' },
      });
      return {
        title: `Livre d’or — ${event.name}`,
        headers: ['Auteur', 'E-mail', 'Message', 'Statut', 'Publié le'],
        rows: rows.map((m) => [m.authorName, m.authorEmail ?? '', m.message, m.status, full2f(m.createdAt)]),
      };
    }
    default:
      throw new TenantError(400, 'invalid_report_type', 'Type de rapport invalide.');
  }
}

/** Génère le rapport (Buffer + filename + content type). Export temp purgé = généré à la demande. */
export async function buildReport(
  ctx: TenantContext,
  eventId: string,
  type: ReportType,
  format: ReportFormat,
  ip: string | null = null,
): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  const { title, headers, rows } = await collectReport(ctx, eventId, type);
  const safeName = `${type}_${eventSlug(eventId)}_${new Date().toISOString().slice(0, 10)}`;
  void ip;

  if (format === 'csv') {
    const esc = (v: string | number) => {
      const s = String(v ?? '');
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = '\uFEFF' + [headers, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
    return { buffer: Buffer.from(csv, 'utf8'), filename: `${safeName}.csv`, contentType: 'text/csv; charset=utf-8' };
  }

  if (format === 'xlsx') {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map((h, i) => ({
      wch: Math.min(60, Math.max(h.length, ...rows.slice(0, 50).map((r) => String(r[i] ?? '').length)) + 2),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, type.slice(0, 31));
    const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return { buffer: out, filename: `${safeName}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }

  // PDF
  const PDFDocument = (await import('pdfkit')).default;
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  doc.rect(0, 0, doc.page.width, 64).fill('#1c1917');
  doc.fill('#ffffff').font('Helvetica-Bold').fontSize(16).text('EventFlow', 40, 22);
  doc.font('Helvetica').fontSize(9).fillColor('#d6d3d1').text('Rapport d’événement', 40, 44);
  doc.fillColor('#fbbf24').font('Helvetica-Bold').fontSize(8)
    .text('Généré le ' + new Date().toLocaleDateString('fr-FR'), doc.page.width - 190, 30);

  doc.fillColor('#1c1917').font('Helvetica-Bold').fontSize(13).text(title, 40, 84);

  const colWidths = computeColWidths(doc.page.width - 80, headers.length);
  let y = 108;
  const drawRow = (cells: (string | number)[], header = false) => {
    if (y > doc.page.height - 60) {
      doc.addPage();
      y = 50;
    }
    let x = 40;
    cells.forEach((c, i) => {
      doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(header ? '#57534e' : '#292524');
      const text = String(c ?? '');
      const lines = doc.heightOfString(text, { width: colWidths[i] - 8 }) > 14
        ? text.slice(0, Math.floor((colWidths[i] - 8) / 4.5) * 2) + '…'
        : text;
      doc.text(lines, x + 4, y, { width: colWidths[i] - 8, lineBreak: false });
      x += colWidths[i];
    });
    doc.moveTo(40, y - 3).lineTo(doc.page.width - 40, y - 3).strokeColor('#e7e5e4').stroke();
    y += 18;
  };
  drawRow(headers, true);
  for (const r of rows) drawRow(r);
  if (rows.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor('#a8a29e').text('Aucune donnée pour ce rapport.', 40, y + 8);
  }

  doc.end();
  const buffer = await done;
  return { buffer, filename: `${safeName}.pdf`, contentType: 'application/pdf' };
}

function computeColWidths(total: number, n: number): number[] {
  const w = total / n;
  return Array.from({ length: n }, () => w);
}

async function eventSlug(eventId: string): Promise<string> {
  const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { slug: true } });
  return ev?.slug ?? eventId.slice(0, 12);
}

/** Réponse HTTP de téléchargement (attachment) — partagé par les routes de rapport. */
export function downloadResponse(res: { buffer: Buffer; filename: string; contentType: string }) {
  return new NextResponse(new Uint8Array(res.buffer), {
    headers: {
      'Content-Type': res.contentType,
      'Content-Disposition': `attachment; filename="${res.filename}"`,
    },
  });
}
