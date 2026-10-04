import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { exportGuestsCsv } from '@/server/services/guest';
import { listGuestsQuerySchema } from '@/lib/schemas/guest';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';

/** GET /api/events/[id]/guests/export?format=csv — export CSV (guest:read). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: eventId } = await params;
    const ctx = await requireTenant('guest:read');
    const url = new URL(req.url);
    const format = url.searchParams.get('format') ?? 'csv';
    if (format !== 'csv') {
      return NextResponse.json(
        {
          error: {
            code: 'export_format_unsupported',
            message: 'Format non pris en charge. Utilisez format=csv (PDF/XLSX : phase 12).',
          },
        },
        { status: 400 },
      );
    }
    const query = listGuestsQuerySchema.parse(Object.fromEntries(url.searchParams.entries()));
    const { fileName, content } = await exportGuestsCsv(ctx, eventId, query);
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
