import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { sendCampaign } from '@/server/services/communication';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** POST /api/events/[id]/campaigns/[cid]/send — envoie (provider mock, quota réel). */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; cid: string }> },
) {
  try {
    const { cid } = await params;
    const ctx = await requireTenant('comm:send');
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    const res = await sendCampaign(ctx, cid, ip);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}
