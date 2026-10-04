import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import sharp from 'sharp';
import { prisma } from '@/lib/prisma';
import { tenantWhere, TenantError, type TenantContext } from '@/server/services/tenant';
import { getEventForOrg } from '@/server/services/event';
import { getSubscriptionView, planHasFeature } from '@/server/services/subscription';
import { assertQuota } from '@/server/services/quotas';
import { logActivity } from '@/server/services/activity';
import { normalizeContent, type DesignContent } from '@/lib/design-elements';
import { designToSvg } from '@/server/render/design-svg';
import { renderDesignPdf } from '@/server/render/design-pdf';
import { readMediaById, uploadMedia, type MediaUploadResult } from '@/server/services/media';
import type { Prisma } from '@prisma/client';

const DESIGN_TYPES = [
  'save_the_date', 'invitation', 'vip_invitation', 'access_card', 'poster',
  'badge', 'program', 'thank_you_card', 'facebook_post', 'instagram_post',
  'story', 'whatsapp_visual', 'custom',
] as const;
const FORMATS = ['portrait', 'square', 'landscape', 'story', 'print'] as const;

export const createDesignSchema = z.object({
  eventId: z.string().optional(),
  type: z.enum(DESIGN_TYPES).default('invitation'),
  templateId: z.string().optional(),
  name: z.string().min(2).max(120),
  format: z.enum(FORMATS).default('portrait'),
  width: z.number().int().min(200).max(3000).default(1080),
  height: z.number().int().min(200).max(4000).default(1350),
});
export type CreateDesignInput = z.input<typeof createDesignSchema>;

export const updateDesignSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  type: z.enum(DESIGN_TYPES).optional(),
  width: z.number().int().min(200).max(3000).optional(),
  height: z.number().int().min(200).max(4000).optional(),
  background: z.object({ type: z.enum(['color', 'gradient', 'image', 'pattern']), value: z.string() }).optional(),
  elements: z.array(z.record(z.unknown())).max(200).optional(),
  coverMediaId: z.string().nullable().optional(),
});
export type UpdateDesignInput = z.input<typeof updateDesignSchema>;

function ownDesignWhere(ctx: TenantContext, designId: string) {
  return { id: designId, organizationId: ctx.organization!.id };
}

async function getOwnedDesign(ctx: TenantContext, designId: string) {
  if (!ctx.organization) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const design = await prisma.design.findFirst({ where: ownDesignWhere(ctx, designId) });
  if (!design) throw new TenantError(404, 'design_not_found', 'Design introuvable.');
  return design;
}

/** Cloner le contenu d'un template (nouveaux ids d'éléments). */
function cloneTemplateContent(content: unknown, w: number, h: number): DesignContent {
  const base = normalizeContent(content);
  return {
    ...base,
    elements: base.elements.map((el) => ({
      ...el,
      id: `e${randomBytes(6).toString('hex')}`,
      // Recadrage proportionnel si le format diffère
      x: (el.x as number) * (w / 1080),
      y: (el.y as number) * (h / 1350),
      width: (el.width as number) * (w / 1080),
      height: (el.height as number) * (h / 1350),
    })),
  };
}

export async function listDesigns(
  ctx: TenantContext,
  q: { eventId?: string; page?: number; pageSize?: number },
) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  if (q.eventId) {
    const ev = await getEventForOrg(q.eventId, orgId);
    if (!ev) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');
  }
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, q.pageSize ?? 12));
  const where = { organizationId: orgId, ...(q.eventId ? { eventId: q.eventId } : {}) };
  const [items, total] = await Promise.all([
    prisma.design.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { template: { select: { name: true } }, event: { select: { name: true, slug: true } } },
    }),
    prisma.design.count({ where }),
  ]);
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getDesign(ctx: TenantContext, designId: string) {
  return getOwnedDesign(ctx, designId);
}

export async function createDesign(ctx: TenantContext, input: CreateDesignInput, ip: string | null = null) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const d = createDesignSchema.parse(input);

  if (d.eventId) {
    const ev = await getEventForOrg(d.eventId, orgId);
    if (!ev) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');
  }

  let content: DesignContent = {
    background: { type: 'color', value: '#FFFFFF' },
    elements: [],
  };
  let templateId: string | null = null;
  let width = d.width;
  let height = d.height;

  if (d.templateId) {
    const tpl = await prisma.designTemplate.findFirst({
      where: { id: d.templateId, status: 'published', OR: [{ organizationId: null }, { organizationId: orgId }] },
    });
    if (!tpl) throw new TenantError(404, 'template_not_found', 'Template introuvable.');
    // Gate premium (CDC §13 : feature premiumTemplates)
    const sub = await getSubscriptionView(orgId);
    if (tpl.isPremium && sub && !planHasFeature(sub.plan, 'premiumTemplates')) {
      throw new TenantError(
        403,
        'premium_required',
        `Le template « ${tpl.name} » est premium (plan ${tpl.requiredPlan ?? 'Pro'} et plus).`,
      );
    }
    templateId = tpl.id;
    content = cloneTemplateContent(tpl.contentJson, d.width, d.height);
  }

  const design = await prisma.design.create({
    data: {
      organizationId: orgId,
      eventId: d.eventId ?? null,
      type: d.type,
      templateId,
      name: d.name,
      format: d.format,
      width,
      height,
      backgroundJson: content.background,
      elementsJson: content.elements,
      status: 'draft',
      createdById: ctx.user.id,
    },
  });

  await logActivity({
    organizationId: orgId, userId: ctx.user.id, action: 'design.create',
    entity: 'design', entityId: design.id, meta: { type: d.type, templateId }, ip,
  });
  return design;
}

export async function updateDesign(ctx: TenantContext, designId: string, input: UpdateDesignInput, ip: string | null = null) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const existing = await getOwnedDesign(ctx, designId);
  const u = updateDesignSchema.parse(input);

  let backgroundJson: unknown = existing.backgroundJson;
  let elementsJson: unknown = existing.elementsJson;
  if (u.background !== undefined || u.elements !== undefined) {
    const content = normalizeContent({
      background: u.background ?? (existing.backgroundJson as DesignContent['background']),
      elements: u.elements ?? (existing.elementsJson as DesignContent['elements']),
    });
    backgroundJson = content.background;
    elementsJson = content.elements;
  }

  const design = await prisma.design.update({
    where: { id: existing.id },
    data: {
      ...(u.name !== undefined ? { name: u.name } : {}),
      ...(u.type !== undefined ? { type: u.type } : {}),
      ...(u.width !== undefined ? { width: u.width } : {}),
      ...(u.height !== undefined ? { height: u.height } : {}),
      ...(u.coverMediaId !== undefined ? { coverMediaId: u.coverMediaId } : {}),
      ...(backgroundJson !== existing.backgroundJson ? { backgroundJson: backgroundJson as Prisma.InputJsonValue } : {}),
      ...(elementsJson !== existing.elementsJson ? { elementsJson: elementsJson as Prisma.InputJsonValue } : {}),
      version: { increment: 1 },
    },
  });

  await logActivity({
    organizationId: orgId, userId: ctx.user.id, action: 'design.update',
    entity: 'design', entityId: design.id, meta: { fields: Object.keys(input), version: design.version }, ip,
  });
  return design;
}

export async function deleteDesign(ctx: TenantContext, designId: string, ip: string | null = null): Promise<void> {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const existing = await getOwnedDesign(ctx, designId);
  await prisma.design.delete({ where: { id: existing.id } });
  await logActivity({
    organizationId: orgId, userId: ctx.user.id, action: 'design.delete',
    entity: 'design', entityId: existing.id, meta: { name: existing.name }, ip,
  });
}

export async function duplicateDesign(ctx: TenantContext, designId: string, ip: string | null = null) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const existing = await getOwnedDesign(ctx, designId);
  const copy = await prisma.design.create({
    data: {
      organizationId: orgId,
      eventId: existing.eventId,
      type: existing.type,
      templateId: null,
      name: `${existing.name} (copie)`.slice(0, 120),
      format: existing.format,
      width: existing.width,
      height: existing.height,
      backgroundJson: JSON.parse(JSON.stringify(existing.backgroundJson)),
      elementsJson: JSON.parse(JSON.stringify(existing.elementsJson)),
      status: 'draft',
      createdById: ctx.user.id,
    },
  });
  await logActivity({
    organizationId: orgId, userId: ctx.user.id, action: 'design.duplicate',
    entity: 'design', entityId: copy.id, meta: { source: existing.id }, ip,
  });
  return copy;
}

// ─────────────────────────── Templates ───────────────────────────

export async function listTemplates(ctx: TenantContext, q: { category?: string; search?: string } = {}) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const sub = await getSubscriptionView(orgId);
  const hasPremium = sub ? planHasFeature(sub.plan, 'premiumTemplates') : false;

  const where = {
    status: 'published' as const,
    OR: [{ organizationId: null }, { organizationId: orgId }],
    ...(q.category ? { category: q.category } : {}),
    ...(q.search ? { name: { contains: q.search } } : {}),
  };
  const rows = await prisma.designTemplate.findMany({
    where,
    orderBy: [{ isFeatured: 'desc' }, { createdAt: 'asc' }],
    include: { _count: { select: { designs: true } } },
  });
  const thumbKeys = rows
    .map((t) => t.thumbnailMediaId)
    .filter((k): k is string => Boolean(k));
  const thumbs = new Map(
    (await prisma.mediaFile.findMany({
      where: { id: { in: thumbKeys } },
      select: { id: true, storageKey: true },
    })).map((m) => [m.id, m.storageKey]),
  );
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    style: t.style,
    format: t.format,
    width: t.width,
    height: t.height,
    isPlatform: t.organizationId === null,
    isOrg: t.organizationId === orgId,
    isPremium: t.isPremium,
    requiredPlan: t.requiredPlan,
    isFeatured: t.isFeatured,
    locked: t.isPremium && !hasPremium,
    thumbnailUrl: t.thumbnailMediaId && thumbs.get(t.thumbnailMediaId)
      ? `/api/storage/${thumbs.get(t.thumbnailMediaId)!.split('/').map(encodeURIComponent).join('/')}`
      : null,
    designsCount: t._count.designs,
  }));
}

/** « Enregistrer comme template » (organisation). */
export async function saveDesignAsTemplate(
  ctx: TenantContext,
  designId: string,
  meta: { name: string; category?: string; style?: string },
  ip: string | null = null,
) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const design = await getOwnedDesign(ctx, designId);
  const content = normalizeContent({
    background: design.backgroundJson,
    elements: design.elementsJson,
  });
  const tpl = await prisma.designTemplate.create({
    data: {
      organizationId: orgId,
      name: meta.name.slice(0, 120),
      category: meta.category ?? 'mariage',
      style: meta.style ?? 'moderne',
      format: design.format,
      width: design.width,
      height: design.height,
      contentJson: JSON.parse(JSON.stringify(content)),
      status: 'published',
      publishedAt: new Date(),
    },
  });
  await logActivity({
    organizationId: orgId, userId: ctx.user.id, action: 'template.create',
    entity: 'design_template', entityId: tpl.id, meta: { from: design.id }, ip,
  });
  return tpl;
}

// ─────────────────────────── Export PNG / PDF ───────────────────

const EXPORT_ROOT = path.join(process.cwd(), 'storage', 'media', 'exports');

function resolveImageSrcFor(_orgId: string) {
  return async (src: string): Promise<string | null> => {
    if (src.startsWith('data:')) return src;
    const buf = await readMediaById(src);
    if (!buf) return null;
    const mime =
      buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' ? 'image/png'
      : buf.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'image/jpeg'
      : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  };
}

export async function exportDesign(
  ctx: TenantContext,
  designId: string,
  format: 'png' | 'pdf',
  scale = 1,
  ip: string | null = null,
): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const design = await getOwnedDesign(ctx, designId);
  const content = normalizeContent({ background: design.backgroundJson, elements: design.elementsJson });
  const safeName = design.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60) || 'design';
  const resolve = resolveImageSrcFor(orgId);

  let buffer: Buffer;
  let mimeType: string;
  let fileName: string;

  if (format === 'png') {
    const svg = await designToSvg(design, content, resolve);
    const outW = design.width * scale;
    const outH = design.height * scale;
    buffer = await sharp(Buffer.from(svg))
      .resize({ width: outW, height: outH })
      .png({ quality: 90 })
      .toBuffer();
    mimeType = 'image/png';
    fileName = `${safeName}-${scale}x.png`;
  } else {
    const doc = new PDFDocument({
      size: [design.width, design.height],
      margin: 0,
      bufferPages: false,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<void>((res, rej) => {
      doc.on('end', () => res());
      doc.on('error', rej);
    });
    await renderDesignPdf(doc, design, content, async (src) => {
      if (src.startsWith('data:')) return Buffer.from(src.split(',')[1], 'base64');
      return readMediaById(src);
    });
    doc.end();
    await done;
    buffer = Buffer.concat(chunks);
    mimeType = 'application/pdf';
    fileName = `${safeName}.pdf`;
  }

  // Sauvegarde en export (accessible via /api/storage, journalisé)
  const storageKey = `exports/${orgId}/${randomBytes(10).toString('hex')}-${fileName}`;
  fs.mkdirSync(path.dirname(path.join(EXPORT_ROOT, storageKey.slice('exports/'.length))), { recursive: true });
  fs.writeFileSync(path.join(EXPORT_ROOT, storageKey.slice('exports/'.length)), buffer);
  await prisma.mediaFile.create({
    data: {
      organizationId: orgId,
      uploadedBy: ctx.user.id,
      kind: 'export',
      storageKey,
      originalName: fileName,
      mimeType,
      sizeBytes: buffer.byteLength,
    },
  }).catch(() => {});

  await logActivity({
    organizationId: orgId, userId: ctx.user.id, action: 'design.export',
    entity: 'design', entityId: design.id, meta: { format, scale }, ip,
  });

  return { buffer, mimeType, fileName };
}

export { uploadMedia, type MediaUploadResult };
