import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { uploadMedia, listMedia } from '@/server/services/media';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/media — upload multipart (champ `file` + eventId/kind),
 * quota storageMb + compression ≤2048px + vignette 320px (media:write).
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireTenant('media:write');
    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json(
        { error: { code: 'no_file', message: 'Payload multipart attendu (champ « file »).' } },
        { status: 400 },
      );
    }
    const file = form.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: { code: 'no_file', message: 'Fichier manquant (champ « file »).' } },
        { status: 400 },
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    const result = await uploadMedia(ctx, buffer, {
      originalName: file.name || 'fichier',
      mimeType: file.type || 'application/octet-stream',
      eventId: (form.get('eventId') as string) || undefined,
      kind: (form.get('kind') as string) || 'photo',
    }, ip);
    return NextResponse.json({ ok: true, media: result }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}

/** GET /api/media — médiathèque paginée. */
export async function GET(req: Request) {
  try {
    const ctx = await requireTenant();
    const url = new URL(req.url);
    const res = await listMedia(ctx, {
      page: Number(url.searchParams.get('page') ?? 1),
      pageSize: Number(url.searchParams.get('pageSize') ?? 24),
      kind: url.searchParams.get('kind') ?? undefined,
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}
