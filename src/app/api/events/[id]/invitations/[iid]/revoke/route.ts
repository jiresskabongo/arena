import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { revokeInvitation } from '@/server/services/invitation';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** POST /api/events/[id]/invitations/[iid]/revoke — révocation du token (guest:update). */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; iid: string }> },
) {
  try {
    const { iid } = await params;
    const ctx = await requireTenant('guest:update');
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    const res = await revokeInvitation(ctx, iid, ip);
    return NextResponse.json(res);
  } catch (e) {
    return apiError(e);
  }
}
