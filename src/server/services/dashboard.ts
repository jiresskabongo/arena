import { prisma } from '@/lib/prisma';
import { tenantWhere } from '@/server/services/tenant';

/**
 * KPIs du dashboard client (CDC §36 — version globale, agrégée sur l'org).
 * Les chiffres sont comptés côté serveur sur les données réelles.
 */

export interface DashboardStats {
  events: number;
  guests: number;
  rsvpConfirmed: number;
  rsvpTotal: number;
  checkins: number;
  sentThisMonth: number;
  aiCreditsUsed: number;
}

function monthStartUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function getDashboardStats(organizationId: string): Promise<DashboardStats> {
  const where = tenantWhere(organizationId);
  const since = monthStartUtc();

  const [events, guests, rsvpAgg, checkins, emails, sms, aiRows] = await Promise.all([
    prisma.event.count({ where: { ...where, status: { not: 'archived' } } }),
    prisma.guest.count({ where }),
    prisma.rsvp.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.checkIn.count({ where }),
    prisma.messageLog.count({ where: { ...where, channel: 'email', createdAt: { gte: since } } }),
    prisma.messageLog.count({ where: { ...where, channel: 'sms', createdAt: { gte: since } } }),
    prisma.aiUsage.aggregate({
      where: { ...where, createdAt: { gte: since } },
      _sum: { creditsCost: true, creditsRefunded: true },
    }),
  ]);

  let rsvpConfirmed = 0;
  let rsvpTotal = 0;
  for (const g of rsvpAgg) {
    rsvpTotal += g._count._all;
    if (g.status === 'confirmed') rsvpConfirmed += g._count._all;
  }

  return {
    events,
    guests,
    rsvpConfirmed,
    rsvpTotal,
    checkins,
    sentThisMonth: emails + sms,
    aiCreditsUsed: Math.max(0, (aiRows._sum.creditsCost ?? 0) - (aiRows._sum.creditsRefunded ?? 0)),
  };
}
