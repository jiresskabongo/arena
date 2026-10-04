import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { confirmCheckout } from '@/server/services/billing';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/checkout/[pid]/confirm — simule le retour du fournisseur.
 * L'effet passe par le webhook signé idempotent (jamais le navigateur).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ pid: string }> },
) {
  try {
    const { pid } = await params;
    const ctx = await requireTenant('billing:manage');
    const body = await req.json().catch(() => null);
    const result = body?.result === 'failed' ? 'failed' : 'succeeded';
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    const res = await confirmCheckout(ctx, pid, result, ip);
    return NextResponse.json(res);
  } catch (e) {
    return apiError(e);
  }
}
