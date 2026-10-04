import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { buildReport, downloadResponse, REPORT_TYPES, type ReportType, type ReportFormat } from '@/server/services/statistics';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/events/[id]/reports/[type]?format=csv|pdf|xlsx — rapport
 * téléchargeable (attachment). Types : guests|rsvp|present|absent|scans|
 * tables|stats|guestbook. Export temp purgé : généré à la demande, rien de
 * persistant.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; type: string }> },
) {
  try {
    const { id, type } = await params;
    if (!REPORT_TYPES.includes(type as ReportType)) {
      return NextResponse.json(
        { ok: false, error: { code: 'invalid_report_type', message: `Type inconnu : ${type}.` } },
        { status: 400 },
      );
    }
    const url = new URL(req.url);
    const format = (url.searchParams.get('format') ?? 'csv') as ReportFormat;
    if (!['csv', 'pdf', 'xlsx'].includes(format)) {
      return NextResponse.json(
        { ok: false, error: { code: 'invalid_format', message: 'Format inconnu (csv | pdf | xlsx).' } },
        { status: 400 },
      );
    }
    const ctx = await requireTenant();
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    const res = await buildReport(ctx, id, type as ReportType, format, ip);
    return downloadResponse(res);
  } catch (e) {
    return apiError(e);
  }
}
