import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { getSubscriptionView } from '@/server/services/subscription';
import { listInvoices } from '@/server/services/billing';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/billing/subscription — état d'abonnement + factures (billing:read).
 * Sert l'écran Plan & factures (rechargement après checkout/résiliation).
 */
export async function GET() {
  try {
    const ctx = await requireTenant('billing:read');
    const orgId = ctx.organization?.id;
    if (!orgId) return NextResponse.json({ ok: false, error: { code: 'no_active_org' } }, { status: 409 });

    const sub = await getSubscriptionView(orgId);
    const invoices = await listInvoices(ctx, { page: 1, pageSize: 25 });
    return NextResponse.json({ ok: true, mock: true, subscription: sub, invoices });
  } catch (e) {
    return apiError(e);
  }
}
