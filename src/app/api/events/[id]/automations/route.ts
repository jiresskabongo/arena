import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { listAutomations, saveAutomation } from '@/server/services/communication';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** GET /api/events/[id]/automations — automatisations de l'événement. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    const automations = await listAutomations(ctx, id);
    return NextResponse.json({ ok: true, automations });
  } catch (e) {
    return apiError(e);
  }
}

/** POST /api/events/[id]/automations — crée/mets à jour (par trigger) (comm:send). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant('comm:send');
    const body = await req.json().catch(() => null);
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    const automation = await saveAutomation(ctx, id, body ?? {}, ip);
    return NextResponse.json({ ok: true, automation });
  } catch (e) {
    return apiError(e);
  }
}
