import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { invoicePdf } from '@/server/services/billing';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';

/** GET /api/billing/invoices/[iid]/pdf — facture PDF (billing:read). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ iid: string }> },
) {
  try {
    const { iid } = await params;
    const ctx = await requireTenant('billing:read');
    const { buffer, number } = await invoicePdf(ctx, iid);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${number}.pdf"`,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
