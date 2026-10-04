/**
 * Tests d'intégration Phase 7 : studio design.
 * - Bibliothèque de templates (plateforme + org, verrou premium)
 * - CRUD designs (création depuis template, mise à jour, duplication, suppression)
 * - Export PNG (sharp/SVG) et PDF (PDFKit) — buffers validés
 * - Médias : upload (compression ≤2048px + vignette), quota, suppression douce
 * - Isolation multi-tenant (design d'une autre org → 404)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { prisma } from '@/lib/prisma';
import { register } from '@/server/services/account';
import { createEvent } from '@/server/services/event';
import {
  listDesigns, getDesign, createDesign, updateDesign, deleteDesign,
  duplicateDesign, listTemplates, saveDesignAsTemplate, exportDesign,
} from '@/server/services/design';
import { uploadMedia, listMedia, deleteMedia } from '@/server/services/media';
import { TenantError, type TenantContext } from '@/server/services/tenant';

const stamp = Date.now().toString(36);
const emailA = `p7own.${stamp}@exemple.cd`;
const emailB = `p7other.${stamp}@exemple.cd`;

let ownerId: string;
let orgId: string;
let eventId: string;
let otherOwnerId: string;
let otherOrgId: string;

function ctx(user: { id: string; email: string }, org: { id: string }, role: TenantContext['role'] = 'owner'): TenantContext {
  return {
    user: {
      id: user.id, email: user.email, firstName: 'P7', lastName: 'Own', passwordHash: '',
      locale: 'fr', currency: 'USD', timezone: 'Africa/Kinshasa', isSuperAdmin: false,
      emailVerifiedAt: null,
    } as never,
    isSuperAdmin: false,
    organization: {
      id: org.id, name: 'P7', slug: 'p7', currency: 'USD', locale: 'fr',
      timezone: 'Africa/Kinshasa', isActive: true,
    },
    role,
  };
}

function otherCtx(): TenantContext {
  return ctx({ id: otherOwnerId, email: emailB }, { id: otherOrgId });
}

beforeAll(async () => {
  const a = await register(
    { email: emailA, password: 'Event1234', firstName: 'P7', lastName: 'Own', organizationName: `P7 Org ${stamp}` },
    null,
  );
  expect(a.ok).toBe(true);
  if (!a.ok) return;
  const b = await register(
    { email: emailB, password: 'Event1234', firstName: 'P7b', lastName: 'Autre', organizationName: `P7 Org B ${stamp}` },
    null,
  );
  expect(b.ok).toBe(true);
  if (!b.ok) return;
  ownerId = a.data.userId;
  orgId = a.data.organizationId;
  otherOwnerId = b.data.userId;
  otherOrgId = b.data.organizationId;
  const ev = await createEvent(ctx({ id: ownerId, email: emailA }, { id: orgId }), {
    name: `Gala P7 ${stamp}`, typeCode: 'gala', date: '2027-06-12',
    startTime: '19:00', timezone: 'Africa/Kinshasa', optionsJson: {},
    venue: 'Salle Test', city: 'Kinshasa',
  });
  eventId = ev.id;
});

afterAll(async () => {
  try {
    await prisma.design.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma.mediaFile.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma.designTemplate.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma.event.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma.activityLog.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherOwnerId] } } });
  } catch {
    // best-effort
  }
});

describe('Bibliothèque de templates', () => {
  it('liste les templates plateforme avec vignettes et verrou premium', async () => {
    const items = await listTemplates(ctx({ id: ownerId, email: emailA }, { id: orgId }));
    expect(items.length).toBeGreaterThanOrEqual(12);
    const premium = items.filter((t) => t.isPremium);
    expect(premium.length).toBeGreaterThanOrEqual(5);
    // Plan starter → premium verrouillé
    for (const t of premium) expect(t.locked).toBe(true);
    for (const t of items.filter((x) => !x.isPremium)) expect(t.locked).toBe(false);
    // Vignettes servies via /api/storage
    const withThumb = items.filter((t) => t.thumbnailUrl);
    expect(withThumb.length).toBeGreaterThanOrEqual(1);
    for (const t of withThumb) {
      expect(t.thumbnailUrl).toMatch(/^\/api\/storage\//);
      const key = decodeURIComponent(t.thumbnailUrl!.replace('/api/storage/', ''));
      const file = path.join(process.cwd(), 'storage', 'media', key);
      expect(fs.existsSync(file)).toBe(true);
    }
  });
});

describe('Designs : CRUD', () => {
  let designId: string;
  let baseElements: number;

  it('crée un design depuis un template (éléments clonés, nouveaux ids)', async () => {
    const tpl = await prisma.designTemplate.findFirst({ where: { id: 'tpl-jardin-romantique' } });
    expect(tpl).toBeTruthy();
    const tplContent = tpl!.contentJson as { elements: unknown[] };
    baseElements = tplContent.elements.length;

    const design = await createDesign(ctx({ id: ownerId, email: emailA }, { id: orgId }), {
      eventId,
      type: 'invitation',
      templateId: 'tpl-jardin-romantique',
      name: 'Invitation Gala P7',
      format: 'portrait',
      width: 1080,
      height: 1350,
    });
    designId = design.id;
    expect(design.templateId).toBe('tpl-jardin-romantique');
    expect(design.status).toBe('draft');
    expect(design.version).toBe(1);
    expect(design.eventId).toBe(eventId);

    const got = await getDesign(ctx({ id: ownerId, email: emailA }, { id: orgId }), designId);
    const els = got.elementsJson as unknown as { id: string }[];
    expect(els.length).toBe(baseElements);
    const ids = new Set(els.map((e) => e.id));
    expect(ids.size).toBe(baseElements); // ids uniques après clonage
  });

  it('met à jour éléments et fond (version incrémentée)', async () => {
    const got = await getDesign(ctx({ id: ownerId, email: emailA }, { id: orgId }), designId);
    const els = got.elementsJson as unknown as { id: string; type: string }[];
    const textIdx = els.findIndex((e) => e.type === 'text');
    expect(textIdx).toBeGreaterThanOrEqual(0);
    els[textIdx] = { ...els[textIdx], text: 'Nouveau texte' } as never;
    const updated = await updateDesign(
      ctx({ id: ownerId, email: emailA }, { id: orgId }),
      designId,
      { elements: els as never, background: { type: 'gradient', value: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)' } },
    );
    expect(updated.version).toBe(got.version + 1);
    const again = await getDesign(ctx({ id: ownerId, email: emailA }, { id: orgId }), designId);
    const againEls = again.elementsJson as unknown as { type: string; text?: string }[];
    const text2 = againEls.find((e) => e.type === 'text');
    expect(text2?.text).toBe('Nouveau texte');
    expect((again.backgroundJson as { type: string }).type).toBe('gradient');
  });

  it('duplique un design (nom + « (copie) », contenu identique)', async () => {
    const copy = await duplicateDesign(ctx({ id: ownerId, email: emailA }, { id: orgId }), designId);
    expect(copy.name).toContain('(copie)');
    expect(copy.id).not.toBe(designId);
    const orig = await getDesign(ctx({ id: ownerId, email: emailA }, { id: orgId }), designId);
    const copied = await getDesign(ctx({ id: ownerId, email: emailA }, { id: orgId }), copy.id);
    expect(JSON.stringify(copied.elementsJson)).toBe(JSON.stringify(orig.elementsJson));
    await deleteDesign(ctx({ id: ownerId, email: emailA }, { id: orgId }), copy.id);
  });

  it('liste paginée par événement', async () => {
    const res = await listDesigns(ctx({ id: ownerId, email: emailA }, { id: orgId }), { eventId });
    expect(res.total).toBeGreaterThanOrEqual(1);
    expect(res.items[0].eventId).toBe(eventId);
  });

  it('isolation : un design d\'une autre org est introuvable', async () => {
    await expect(
      getDesign(otherCtx(), designId),
    ).rejects.toMatchObject({ status: 404, code: 'design_not_found' });
    await expect(
      updateDesign(otherCtx(), designId, { name: 'Hack' }),
    ).rejects.toMatchObject({ status: 404 });
    // et invisible dans sa liste
    const res = await listDesigns(otherCtx(), {});
    expect(res.total).toBe(0);
  });
});

describe('Verrou premium (plan starter)', () => {
  it('refuse la création depuis un template premium (403 premium_required)', async () => {
    const premium = await prisma.designTemplate.findFirst({ where: { isPremium: true } });
    expect(premium).toBeTruthy();
    await expect(
      createDesign(ctx({ id: ownerId, email: emailA }, { id: orgId }), {
        name: 'Design premium',
        templateId: premium!.id,
      }),
    ).rejects.toMatchObject({ status: 403, code: 'premium_required' });
  });
});

describe('Enregistrer comme template', () => {
  it('crée un template org à partir d\'un design', async () => {
    const d = await createDesign(ctx({ id: ownerId, email: emailA }, { id: orgId }), {
      name: 'Base template',
      templateId: 'tpl-sttd-minimal',
    });
    const tpl = await saveDesignAsTemplate(
      ctx({ id: ownerId, email: emailA }, { id: orgId }),
      d.id,
      { name: 'Mon style P7', category: 'gala', style: 'minimaliste' },
    );
    expect(tpl.organizationId).toBe(orgId);
    const items = await listTemplates(ctx({ id: ownerId, email: emailA }, { id: orgId }));
    const mine = items.find((t) => t.id === tpl.id);
    expect(mine).toBeTruthy();
    expect(mine!.isOrg).toBe(true);
    expect(mine!.locked).toBe(false);
    // Réutilisable
    const d2 = await createDesign(ctx({ id: ownerId, email: emailA }, { id: orgId }), {
      name: 'Depuis mon template',
      templateId: tpl.id,
    });
    expect(d2.templateId).toBe(tpl.id);
    await deleteDesign(ctx({ id: ownerId, email: emailA }, { id: orgId }), d2.id);
  });
});

describe('Export PNG / PDF', () => {
  let designId: string;

  beforeAll(async () => {
    const d = await createDesign(ctx({ id: ownerId, email: emailA }, { id: orgId }), {
      name: 'Export P7',
      templateId: 'tpl-jardin-romantique',
    });
    designId = d.id;
  });

  it('exporte un PNG valide (dimensions respectées)', async () => {
    const { buffer, mimeType, fileName } = await exportDesign(
      ctx({ id: ownerId, email: emailA }, { id: orgId }),
      designId,
      'png',
      1,
    );
    expect(mimeType).toBe('image/png');
    expect(fileName).toContain('.png');
    expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1350);
    // 2x
    const x2 = await exportDesign(ctx({ id: ownerId, email: emailA }, { id: orgId }), designId, 'png', 2);
    const meta2 = await sharp(x2.buffer).metadata();
    expect(meta2.width).toBe(2160);
  });

  it('exporte un PDF valide (en-tête %PDF)', async () => {
    const { buffer, mimeType, fileName } = await exportDesign(
      ctx({ id: ownerId, email: emailA }, { id: orgId }),
      designId,
      'pdf',
    );
    expect(mimeType).toBe('application/pdf');
    expect(fileName).toContain('.pdf');
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(buffer.length).toBeGreaterThan(1500);
  });

  it('l\'export est journalisé (media kind=export)', async () => {
    const n = await prisma.mediaFile.count({ where: { organizationId: orgId, kind: 'export' } });
    expect(n).toBeGreaterThanOrEqual(3); // 1x, 2x, pdf
  });
});

describe('Médias', () => {
  let mediaId: string;

  it('upload : compression ≤2048px + vignette + metadata', async () => {
    // Image source 3000×2000
    const big = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 30, b: 30 } },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
    const res = await uploadMedia(
      ctx({ id: ownerId, email: emailA }, { id: orgId }),
      big,
      { originalName: 'photo-grosse.jpg', mimeType: 'image/jpeg', eventId, kind: 'photo' },
    );
    mediaId = res.id;
    expect(res.compressed).toBe(true);
    expect(res.sizeBytes).toBeLessThan(big.byteLength);
    const meta = await sharp(fs.readFileSync(path.join(process.cwd(), 'storage', 'media', res.storageKey))).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(2048);
    expect(res.thumbnailUrl).toMatch(/^\/api\/storage\//);
    const thumbKey = decodeURIComponent(res.thumbnailUrl!.replace('/api/storage/', ''));
    const thumb = await sharp(fs.readFileSync(path.join(process.cwd(), 'storage', 'media', thumbKey))).metadata();
    expect(Math.max(thumb.width!, thumb.height!)).toBeLessThanOrEqual(320);
  });

  it('refuse un fichier vide et un fichier > 8 Mo', async () => {
    await expect(
      uploadMedia(ctx({ id: ownerId, email: emailA }, { id: orgId }), Buffer.alloc(0), {
        originalName: 'vide.jpg', mimeType: 'image/jpeg',
      }),
    ).rejects.toMatchObject({ status: 400, code: 'empty_file' });
    await expect(
      uploadMedia(ctx({ id: ownerId, email: emailA }, { id: orgId }), Buffer.alloc(9 * 1024 * 1024), {
        originalName: 'gros.jpg', mimeType: 'image/jpeg',
      }),
    ).rejects.toMatchObject({ status: 400, code: 'file_too_large' });
  });

  it('liste paginée et supprime (doux)', async () => {
    const res = await listMedia(ctx({ id: ownerId, email: emailA }, { id: orgId }), { page: 1, pageSize: 10 });
    expect(res.total).toBeGreaterThanOrEqual(1);
    expect(res.items[0].url).toMatch(/^\/api\/storage\//);
    await deleteMedia(ctx({ id: ownerId, email: emailA }, { id: orgId }), mediaId);
    const file = await prisma.mediaFile.findUnique({ where: { id: mediaId } });
    expect(file!.deletedAt).toBeTruthy();
    // Plus listé
    const res2 = await listMedia(ctx({ id: ownerId, email: emailA }, { id: orgId }), { page: 1 });
    expect(res2.items.find((m) => m.id === mediaId)).toBeUndefined();
  });

  it('isolation : médias d\'une autre org invisibles', async () => {
    const res = await listMedia(otherCtx(), { page: 1 });
    expect(res.total).toBe(0);
    await expect(deleteMedia(otherCtx(), mediaId)).rejects.toMatchObject({ status: 404 });
  });
});
