import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { createScannerAgent, listScannerAgents } from '@/server/services/checkin';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** GET /api/events/[id]/scanner-agents — agents de scan (tout membre). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    const agents = await listScannerAgents(ctx, id);
    return NextResponse.json({ ok: true, agents });
  } catch (e) {
    return apiError(e);
  }
}

/** POST /api/events/[id]/scanner-agents — créer un agent (checkin:manage). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant('checkin:manage');
    const body = await req.json().catch(() => null);
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    const agent = await createScannerAgent(
      ctx,
      id,
      {
        name: body?.name,
        entryPoint: body?.entryPoint,
        permissions: body?.permissions,
        userId: ctx.user.id,
      },
      ip,
    );
    return NextResponse.json({ ok: true, agent }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
