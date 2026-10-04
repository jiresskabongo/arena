import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { setScannerAgentActive } from '@/server/services/checkin';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** PATCH /api/events/[id]/scanner-agents/[aid] — activer/désactiver (checkin:manage). */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; aid: string }> },
) {
  try {
    const { aid } = await params;
    const ctx = await requireTenant('checkin:manage');
    const body = await req.json().catch(() => null);
    const active = Boolean(body?.active);
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    const res = await setScannerAgentActive(ctx, aid, active, ip);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}
