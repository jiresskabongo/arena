import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { cancelAtPeriodEnd } from '@/server/services/billing';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** POST /api/billing/cancel — résiliation en fin de période (billing:manage). */
export async function POST(req: Request) {
  try {
    const ctx = await requireTenant('billing:manage');
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    const res = await cancelAtPeriodEnd(ctx, ip);
    return NextResponse.json(res);
  } catch (e) {
    return apiError(e);
  }
}

