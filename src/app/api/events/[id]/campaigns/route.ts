import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { createCampaign, listCampaigns } from '@/server/services/communication';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** GET /api/events/[id]/campaigns — campagnes de l'événement. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    const campaigns = await listCampaigns(ctx, id);
    return NextResponse.json({ ok: true, campaigns });
  } catch (e) {
    return apiError(e);
  }
}

/** POST /api/events/[id]/campaigns — crée une campagne (comm:send). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant('comm:send');
    const body = await req.json().catch(() => null);
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    const campaign = await createCampaign(ctx, id, body ?? {}, ip);
    return NextResponse.json({ ok: true, campaign }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
