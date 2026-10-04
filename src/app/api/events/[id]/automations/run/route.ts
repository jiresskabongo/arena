import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { runEventAutomations } from '@/server/services/communication';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** POST /api/events/[id]/automations/run — évalue les triggers temporels (comm:send). */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = await requireTenant('comm:send');
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    const res = await runEventAutomations(ctx, id, ip);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}
