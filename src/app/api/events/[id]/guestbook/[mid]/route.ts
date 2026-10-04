import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { moderateGuestbook } from '@/server/services/statistics';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/events/[id]/guestbook/[mid] — modération (event:update) :
 * { status: 'approved' | 'hidden' | 'rejected' }.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; mid: string }> },
) {
  try {
    const { id, mid } = await params;
    const ctx = await requireTenant('event:update');
    const body = await req.json().catch(() => null);
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    const res = await moderateGuestbook(ctx, id, mid, typeof body?.status === 'string' ? body.status : '', ip);
    return NextResponse.json(res);
  } catch (e) {
    return apiError(e);
  }
}
