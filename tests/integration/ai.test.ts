/**
 * Tests d'intégration Phase 13 : IA (critère de sortie : « prompt →
 * proposition éditable au studio ; provider failure = credit refund »).
 * - génération design : Design créé (isAiGenerated, éléments canvas, données
 *   événement intégrées), AiUsage success, coût 10, quota consommé
 * - DÉTERMINISME : même prompt+événement ⇒ même composition
 * - génération texte : texte non vide, coût 5
 * - échec provider (prompt `#fail`) : 502, ligne failed + creditsRefunded,
 *   quota non consommé (remboursé)
 * - quota dépassé → 403 quota_exceeded
 * - isolation / 404 (événement ou design d'une autre org)
 * - historique paginé + total mensuel
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { register } from '@/server/services/account';
import { createEvent } from '@/server/services/event';
import { aiGenerate, getAiUsage, AI_COSTS } from '@/server/services/ai';
import { generateDesign, generateText } from '@/server/providers/ai';
import { getQuotas } from '@/server/services/quotas';
import { getPlanByCode } from '@/server/services/subscription';
import { TenantError } from '@/server/services/tenant';
import type { TenantContext } from '@/server/services/tenant';

const stamp = Date.now().toString(36);
const email = `p13own.${stamp}@exemple.cd`;
const email2 = `p13other.${stamp}@exemple.cd`;

let ownerId: string;
let orgId: string;
let otherOwnerId: string;
let otherOrgId: string;
let eventId: string;
let genDesignId: string;

function ctx(o = { id: orgId, slug: 'p13', name: 'P13' }, u = { id: ownerId }): TenantContext {
  return {
    user: { id: u.id, email, firstName: 'P13', lastName: 'Own', passwordHash: '', locale: 'fr', currency: 'USD', timezone: 'Africa/Kinshasa', isSuperAdmin: false, emailVerifiedAt: null } as never,
    isSuperAdmin: false,
    organization: { id: o.id, name: o.name, slug: o.slug, currency: 'USD', locale: 'fr', timezone: 'Africa/Kinshasa', isActive: true },
    role: 'owner',
  };
}
function otherCtx(): TenantContext {
  return {
    user: { id: otherOwnerId, email: email2, firstName: 'P13', lastName: 'Oth', passwordHash: '', locale: 'fr', currency: 'USD', timezone: 'Africa/Kinshasa', isSuperAdmin: false, emailVerifiedAt: null } as never,
    isSuperAdmin: false,
    organization: { id: otherOrgId, name: 'P13 Other', slug: `p13o${stamp}`, currency: 'USD', locale: 'fr', timezone: 'Africa/Kinshasa', isActive: true },
    role: 'owner',
  };
}

beforeAll(async () => {
  const reg = await register({ email, password: 'Event1234', firstName: 'P13', lastName: 'Own', organizationName: `P13 Org ${stamp}` }, null);
  expect(reg.ok).toBe(true);
  if (!reg.ok) return;
  ownerId = reg.data.userId;
  orgId = reg.data.organizationId;

  const reg2 = await register({ email: email2, password: 'Event1234', firstName: 'P13', lastName: 'Oth', organizationName: `P13 Other ${stamp}` }, null);
  expect(reg2.ok).toBe(true);
  if (!reg2.ok) return;
  otherOwnerId = reg2.data.userId;
  otherOrgId = reg2.data.organizationId;

  const pro = await prisma.plan.findUnique({ where: { code: 'pro' } });
  if (pro) {
    await prisma.subscription.updateMany({ where: { organizationId: { in: [orgId, otherOrgId] } }, data: { planId: pro.id, status: 'active' } });
  }

  const d = new Date(Date.now() + 21 * 24 * 3600 * 1000);
  const ev = await createEvent(ctx(), {
    name: `Mariage P13 ${stamp}`, typeCode: 'wedding',
    date: d.toISOString().slice(0, 10), startTime: '18:30', timezone: 'Africa/Kinshasa',
    optionsJson: { rsvp: true }, venue: 'Salle des Étoiles', city: 'KIN',
  });
  eventId = ev.id;
});

afterAll(async () => {
  for (const org of [orgId, otherOrgId]) {
    await prisma.design.deleteMany({ where: { organizationId: org } }).catch(() => {});
    await prisma.aiUsage.deleteMany({ where: { organizationId: org } }).catch(() => {});
    const eventIds = (await prisma.event.findMany({ where: { organizationId: org }, select: { id: true } })).map((e) => e.id);
    await prisma.guest.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => {});
    await prisma.event.deleteMany({ where: { organizationId: org } }).catch(() => {});
  }
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherOwnerId] } } }).catch(() => {});
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } }).catch(() => {});
  await prisma.$disconnect();
});

describe('génération design (proposition éditable au studio)', () => {
  it('crée un Design isAiGenerated avec la composition canvas + données événement', async () => {
    const res = await aiGenerate(ctx(), {
      kind: 'design',
      prompt: 'invitation élégante, tons dorés sur fond sombre',
      eventRef: eventId,
    });
    genDesignId = res.designId!;
    expect(res.usage.status).toBe('success');
    expect(res.usage.creditsCost).toBe(AI_COSTS.design);
    expect(res.remainingCredits).toBeGreaterThanOrEqual(0);

    const design = await prisma.design.findUnique({ where: { id: genDesignId! } });
    expect(design!.isAiGenerated).toBe(true);
    expect(design!.organizationId).toBe(orgId);
    expect(design!.eventId).toBe(eventId);
    expect(design!.status).toBe('draft');
    const els = design!.elementsJson as Record<string, unknown>[];
    expect(els.length).toBeGreaterThanOrEqual(6);
    const texts = els.filter((e) => e.type === 'text').map((e) => e.text as string).join(' | ');
    expect(texts).toContain(`Mariage P13 ${stamp}`);
    expect(texts).toContain('Salle des Étoiles');
    // Fond non vide + type de background valide
    const bg = design!.backgroundJson as { type: string; value: string };
    expect(['color', 'gradient', 'image', 'pattern']).toContain(bg.type);
  });

  it('DÉTERMINISME : même prompt+événement ⇒ même composition (palettes/positions)', async () => {
    const a = generateDesign({
      prompt: 'invitation élégante, tons dorés sur fond sombre',
      type: 'invitation', width: 1080, height: 1350,
      event: { name: `Mariage P13 ${stamp}`, date: '2026-11-01', startTime: '18:30', venue: 'Salle des Étoiles', city: 'KIN' },
    });
    const b = generateDesign({
      prompt: 'invitation élégante, tons dorés sur fond sombre',
      type: 'invitation', width: 1080, height: 1350,
      event: { name: `Mariage P13 ${stamp}`, date: '2026-11-01', startTime: '18:30', venue: 'Salle des Étoiles', city: 'KIN' },
    });
    // Même fond, mêmes attributs d'éléments (les ids sont régénérés)
    expect(a.background).toEqual(b.background);
    const stripIds = (els: typeof a.elements) => els.map(({ id, ...rest }) => rest);
    expect(stripIds(a.elements)).toEqual(stripIds(b.elements));
    // Prompt différent ⇒ (presque sûrement) composition différente
    const c = generateDesign({
      prompt: 'affiche dynamique néon rose électrique',
      type: 'poster', width: 1350, height: 1080,
      event: null,
    });
    const sameBg = JSON.stringify(stripIds(a.elements)) === JSON.stringify(stripIds(c.elements));
    expect(sameBg).toBe(false);
  });

  it('variante depuis designId : hérite de l’événement du design', async () => {
    const res = await aiGenerate(ctx(), {
      kind: 'design',
      prompt: 'variante pastel de l’invitation',
      designId: genDesignId!,
    });
    expect(res.designId).toBeTruthy();
    const d = await prisma.design.findUnique({ where: { id: res.designId! } });
    expect(d!.eventId).toBe(eventId);
    expect(d!.name).toContain('variante');
    expect(d!.isAiGenerated).toBe(true);
  });
});

describe('génération texte', () => {
  it('renvoie un texte composé avec les infos événement', async () => {
    const before = (await prisma.aiUsage.count({ where: { organizationId: orgId } }));
    const res = await aiGenerate(ctx(), {
      kind: 'text',
      prompt: 'message de confirmation pour les confirmés',
      eventRef: eventId,
    });
    expect(res.designId).toBeNull();
    expect(typeof res.text).toBe('string');
    expect(res.text!.length).toBeGreaterThan(80);
    expect(res.text).toContain('Mariage P13');
    expect(res.usage.creditsCost).toBe(AI_COSTS.text);
    expect(await prisma.aiUsage.count({ where: { organizationId: orgId } })).toBe(before + 1);
  });

  it('texte sans événement : toujours un texte valide', async () => {
    const out = generateText({ prompt: 'caption réseaux sociaux pour un lancement' });
    expect(out.length).toBeGreaterThan(40);
  });
});

describe('cycle de crédits : échec = remboursement', () => {
  it('prompt `#fail` → 502 provider, ligne failed + creditsRefunded = coût, quota libéré', async () => {
    const plan = (await getSubscriptionViewPlan());
    const before = (await getQuotas(orgId, plan)).find((q) => q.key === 'aiCreditsPerMonth')!;

    const err = await aiGenerate(ctx(), {
      kind: 'design',
      prompt: 'composition #fail pour tester l’échec du provider',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(TenantError);
    expect((err as TenantError).code).toBe('ai_provider_error');
    expect((err as TenantError).status).toBe(502);
    expect(String((err as TenantError).message)).toContain('rembours');

    const row = await prisma.aiUsage.findFirst({
      where: { organizationId: orgId, status: 'failed', operation: 'design' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();
    expect(row!.creditsCost).toBe(AI_COSTS.design);
    expect(row!.creditsRefunded).toBe(AI_COSTS.design);
    expect(row!.outputDesignId).toBeNull();

    const after = (await getQuotas(orgId, plan)).find((q) => q.key === 'aiCreditsPerMonth')!;
    expect(after.used).toBe(before.used); // remboursé → pas de consommation
  });

  it('le quota consomme les succès : génération ok = used+coût', async () => {
    const plan = await getSubscriptionViewPlan();
    const before = (await getQuotas(orgId, plan)).find((q) => q.key === 'aiCreditsPerMonth')!;
    await aiGenerate(ctx(), { kind: 'text', prompt: 'mot de remerciement court et chaleureux' });
    const after = (await getQuotas(orgId, plan)).find((q) => q.key === 'aiCreditsPerMonth')!;
    expect(after.used).toBe(before.used + AI_COSTS.text);
  });
});

describe('quota & isolation', () => {
  it('quota mensuel dépassé → 403 quota_exceeded (aucune ligne créée)', async () => {
    const plan = await getSubscriptionViewPlan();
    const state = (await getQuotas(orgId, plan)).find((q) => q.key === 'aiCreditsPerMonth')!;
    expect(state.limit).toBeGreaterThan(0);
    // Pré-remplir : le mois est à (limit-3) → design (10) impossible, text (5) non plus
    const already = state.used;
    const topUp = Math.max(0, state.limit - 3 - already);
    if (topUp > 0) {
      await prisma.aiUsage.create({
        data: { organizationId: orgId, userId: ownerId, operation: 'text', creditsCost: topUp, status: 'success' },
      });
    }
    const beforeCount = await prisma.aiUsage.count({ where: { organizationId: orgId } });

    const err1 = await aiGenerate(ctx(), { kind: 'design', prompt: 'design qui doit être refusé par le quota' }).catch((e) => e);
    expect(err1).toBeInstanceOf(TenantError);
    expect((err1 as TenantError).code).toBe('quota_exceeded');
    expect((err1 as TenantError).status).toBe(403);

    const err2 = await aiGenerate(ctx(), { kind: 'text', prompt: 'texte refusé par le quota' }).catch((e) => e);
    expect((err2 as TenantError).code).toBe('quota_exceeded');

    // Ni design ni texte n'ont créé de ligne (refusés au quota) ; seul le top-up existe
    expect(await prisma.aiUsage.count({ where: { organizationId: orgId } })).toBe(beforeCount);
  });

  it('événement d’une autre org → 404 ; design d’une autre org → 404', async () => {
    const ev = await createEvent(otherCtx(), {
      name: `Événement P13 autrui ${stamp}`, typeCode: 'conference',
      date: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
      startTime: '09:00', timezone: 'Africa/Kinshasa', optionsJson: {}, venue: 'X', city: 'BJA',
    });
    await expect(aiGenerate(ctx(), { kind: 'design', prompt: 'voler un événement', eventRef: ev.id }))
      .rejects.toThrow(TenantError);
    await expect(aiGenerate(otherCtx(), { kind: 'design', prompt: 'variante sur design autrui', designId: genDesignId! }))
      .rejects.toThrow(TenantError);
  });

  it('isolation : autre org ne voit pas l’historique de la première', async () => {
    const res = await getAiUsage(otherCtx(), { page: 1, pageSize: 50 });
    expect(res.items.length).toBe(0);
    expect(res.month.consumed).toBe(0);
  });
});

describe('historique des crédits', () => {
  it('liste paginée (desc) avec total mensuel cost/refunded', async () => {
    const res = await getAiUsage(ctx(), { page: 1, pageSize: 5 });
    expect(res.items.length).toBeLessThanOrEqual(5);
    expect(res.total).toBeGreaterThanOrEqual(4);
    // Ligne failed remboursée bien visible
    const failed = res.items.find((u) => u.status === 'failed');
    expect(failed).toBeTruthy();
    expect(failed!.creditsRefunded).toBe(failed!.creditsCost);
    // Tri décroissant
    for (let i = 1; i < res.items.length; i++) {
      expect(res.items[i].createdAt.getTime()).toBeLessThanOrEqual(res.items[i - 1].createdAt.getTime());
    }
    expect(res.month.refunded).toBeGreaterThanOrEqual(AI_COSTS.design);
    expect(res.month.consumed).toBeGreaterThanOrEqual(0);
    expect(res.month.consumed).toBe(res.month.cost - res.month.refunded);
  });
});

// Plan de l'org (Pro — quota aiCreditsPerMonth = 1000)
async function getSubscriptionViewPlan() {
  const { getSubscriptionView } = await import('@/server/services/subscription');
  const sub = await getSubscriptionView(orgId);
  return sub?.plan ?? (await getPlanByCode('starter'))!;
}
