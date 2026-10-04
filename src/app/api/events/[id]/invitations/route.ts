import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { generateInvitations, listInvitations } from '@/server/services/invitation';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** GET /api/events/[id]/invitations — liste paginée + stats RSVP (rsvp:read). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant('rsvp:read');
    const url = new URL(req.url);
    const res = await listInvitations(ctx, id, {
      page: Number(url.searchParams.get('page') ?? 1),
      pageSize: Number(url.searchParams.get('pageSize') ?? 25),
      search: url.searchParams.get('search') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}

/** POST /api/events/[id]/invitations — génération en lot (guest:invite). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant('guest:invite');
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    const res = await generateInvitations(ctx, id, ip);
    return NextResponse.json({ ok: true, ...res }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
