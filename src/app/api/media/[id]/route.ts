import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { deleteMedia, getMedia } from '@/server/services/media';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** GET /api/media/[id] — détail (url + thumbnail). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    const media = await getMedia(ctx, id);
    return NextResponse.json({ ok: true, media });
  } catch (e) {
    return apiError(e);
  }
}

/** DELETE /api/media/[id] — suppression douce (media:write). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant('media:write');
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    await deleteMedia(ctx, id, ip);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
