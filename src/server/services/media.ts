import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { prisma } from '@/lib/prisma';
import { tenantWhere, TenantError, type TenantContext } from '@/server/services/tenant';
import { assertQuota } from '@/server/services/quotas';
import { logActivity } from '@/server/services/activity';

/**
 * Médias (CDC §28) — stockage local `storage/media/` (STORAGE_PROVIDER=local).
 * Compression : photos redimensionnées ≤ 2048 px (qualité 82) + vignette 320 px.
 * S3 : même interface en P3 (provider config).
 */

const ROOT = path.join(process.cwd(), 'storage', 'media');
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // MAX_UPLOAD_MB
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']);
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/svg+xml': 'svg',
  'text/csv': 'csv', 'application/json': 'json',
};
/** MIME par extension (service des fichiers — `resolveStorageFile`). */
const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.csv': 'text/csv', '.json': 'application/json',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function absKey(key: string): string {
  const k = key.replace(/^\/+/, '');
  const full = path.join(ROOT, k);
  if (!full.startsWith(ROOT)) throw new TenantError(400, 'bad_storage_key', 'Clé de stockage invalide.');
  return full;
}

export function mediaUrl(storageKey: string): string {
  return `/api/storage/${storageKey.split('/').map(encodeURIComponent).join('/')}`;
}

function thumbnailKey(key: string): string {
  const i = key.lastIndexOf('.');
  return i === -1 ? `${key}-thumb` : `${key.slice(0, i)}-thumb${key.slice(i)}`;
}

export interface MediaUploadResult {
  id: string;
  storageKey: string;
  url: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  compressed: boolean;
}

export async function uploadMedia(
  ctx: TenantContext,
  buffer: Buffer,
  meta: { originalName: string; mimeType: string; eventId?: string; kind?: string },
  ip: string | null = null,
): Promise<MediaUploadResult> {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  if (buffer.byteLength === 0) throw new TenantError(400, 'empty_file', 'Fichier vide.');
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new TenantError(400, 'file_too_large', 'Fichier trop volumineux (max 8 Mo).');
  }

  let out = buffer;
  let width: number | null = null;
  let height: number | null = null;
  let compressed = false;
  let thumbBuf: Buffer | null = null;

  if (IMAGE_TYPES.has(meta.mimeType) && meta.mimeType !== 'image/svg+xml') {
    try {
      const metaInfo = await sharp(buffer).metadata();
      width = metaInfo.width ?? null;
      height = metaInfo.height ?? null;
      const needResize = (width ?? 0) > 2048 || (height ?? 0) > 2048;
      if (needResize) {
        out = await sharp(buffer)
          .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82 })
          .toBuffer();
        compressed = true;
        meta.mimeType = 'image/jpeg';
      }
      // Vignette 320 px (photos et logos)
      thumbBuf = await sharp(buffer)
        .resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer();
    } catch {
      // Image illisible → stockée telle quelle
    }
  }

  // Quota stockage (Mo)
  const mb = Math.max(0.001, out.byteLength / (1024 * 1024));
  await assertQuota(ctx, 'storageMb', mb);

  const ext = EXT[meta.mimeType] ?? 'bin';
  const storageKey = `orgs/${orgId}/${randomBytes(10).toString('hex')}.${ext}`;
  fs.mkdirSync(path.dirname(absKey(storageKey)), { recursive: true });
  fs.writeFileSync(absKey(storageKey), out);
  if (thumbBuf) {
    fs.writeFileSync(absKey(thumbnailKey(storageKey)), thumbBuf);
  }

  const file = await prisma.mediaFile.create({
    data: {
      organizationId: orgId,
      uploadedBy: ctx.user.id,
      eventId: meta.eventId ?? null,
      kind: meta.kind ?? 'photo',
      storageKey,
      originalName: meta.originalName.slice(0, 255),
      mimeType: meta.mimeType,
      sizeBytes: out.byteLength,
      width,
      height,
    },
  });

  await logActivity({
    organizationId: orgId, userId: ctx.user.id, action: 'media.upload',
    entity: 'media_file', entityId: file.id, meta: { name: meta.originalName, size: out.byteLength }, ip,
  });

  return {
    id: file.id,
    storageKey: file.storageKey,
    url: mediaUrl(file.storageKey),
    thumbnailUrl: thumbBuf ? mediaUrl(thumbnailKey(file.storageKey)) : null,
    width,
    height,
    sizeBytes: file.sizeBytes,
    compressed,
  };
}

export async function listMedia(
  ctx: TenantContext,
  q: { page?: number; pageSize?: number; kind?: string },
) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 24));
  const where = { organizationId: orgId, deletedAt: null, ...(q.kind ? { kind: q.kind } : {}) };
  const [items, total] = await Promise.all([
    prisma.mediaFile.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.mediaFile.count({ where }),
  ]);
  return {
    items: items.map((m) => ({
      id: m.id,
      kind: m.kind,
      originalName: m.originalName,
      mimeType: m.mimeType,
      sizeBytes: m.sizeBytes,
      width: m.width,
      height: m.height,
      url: mediaUrl(m.storageKey),
      thumbnailUrl: fs.existsSync(absKey(thumbnailKey(m.storageKey))) ? mediaUrl(thumbnailKey(m.storageKey)) : null,
      createdAt: m.createdAt,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getMedia(ctx: TenantContext, mediaId: string) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const file = await prisma.mediaFile.findFirst({
    where: { id: mediaId, ...tenantWhere(orgId), deletedAt: null },
  });
  if (!file) throw new TenantError(404, 'media_not_found', 'Fichier introuvable.');
  return {
    id: file.id,
    kind: file.kind,
    originalName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    width: file.width,
    height: file.height,
    url: mediaUrl(file.storageKey),
    thumbnailUrl: fs.existsSync(absKey(thumbnailKey(file.storageKey))) ? mediaUrl(thumbnailKey(file.storageKey)) : null,
    createdAt: file.createdAt,
  };
}

/** Suppression douce (les fichiers exportés restent accessibles jusqu'au ménage). */
export async function deleteMedia(ctx: TenantContext, mediaId: string, ip: string | null = null): Promise<void> {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const file = await prisma.mediaFile.findFirst({ where: { id: mediaId, ...tenantWhere(orgId) } });
  if (!file) throw new TenantError(404, 'media_not_found', 'Fichier introuvable.');
  await prisma.mediaFile.update({ where: { id: file.id }, data: { deletedAt: new Date() } });
  await logActivity({
    organizationId: orgId, userId: ctx.user.id, action: 'media.delete',
    entity: 'media_file', entityId: file.id, ip,
  });
}

/** Buffer d'un média par clé de stockage (rendu exports). */
export function readMediaBuffer(storageKey: string): Buffer | null {
  try {
    const full = absKey(storageKey);
    return fs.existsSync(full) ? fs.readFileSync(full) : null;
  } catch {
    return null;
  }
}

/** mediaId → buffer (images des designs). */
export async function readMediaById(mediaId: string): Promise<Buffer | null> {
  const file = await prisma.mediaFile.findUnique({ where: { id: mediaId } });
  if (!file || file.deletedAt) return null;
  return readMediaBuffer(file.storageKey);
}

/**
 * Résout une clé de stockage (multi-segments, ex. `orgs/<orgId>/<hex>.jpg`)
 * vers le fichier à servir : `null` = 404 (inconnu, traversal, hors répertoire).
 * Le service de fichiers `/api/storage/*` est public par nature (§13.17) —
 * la protection = clés non devinables ; URLs signées = prod (§13.49).
 */
export function resolveStorageFile(
  key: string,
): { buffer: Buffer; mimeType: string } | null {
  const k = key.replace(/^\/+/, '');
  if (!k || k.split('/').some((s) => s === '..' || s === '.')) return null;
  let full: string;
  try {
    full = absKey(k);
  } catch {
    return null;
  }
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  let st: fs.Stats;
  try {
    st = fs.statSync(full);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  const mimeType = EXT_TO_MIME[path.extname(full).toLowerCase()] ?? 'application/octet-stream';
  return { buffer: fs.readFileSync(full), mimeType };
}
