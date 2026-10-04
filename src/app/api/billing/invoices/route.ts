import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { listInvoices } from '@/server/services/billing';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';

/** GET /api/billing/invoices — factures paginées (billing:read). */
export async function GET(req: Request) {
  try {
    const ctx = await requireTenant('billing:read');
    const url = new URL(req.url);
    const res = await listInvoices(ctx, {
      page: Number(url.searchParams.get('page') ?? 1),
      pageSize: Number(url.searchParams.get('pageSize') ?? 25),
    });
    return NextResponse.json({ ok: true, mock: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}
