import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { createCheckout } from '@/server/services/billing';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** POST /api/billing/checkout — crée un checkout mock (billing:manage). */
export async function POST(req: Request) {
  try {
    const ctx = await requireTenant('billing:manage');
    const body = await req.json().catch(() => null);
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    const res = await createCheckout(ctx, body ?? {}, ip);
    return NextResponse.json({ ok: true, checkout: res }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
