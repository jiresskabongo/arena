import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { exportDesign } from '@/server/services/design';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/designs/[id]/export?format=png|pdf&scale=1|2 — export (design:export).
 * L'export est aussi journalisé (MediaFile kind=export, rétention §33).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant('design:export');
    const url = new URL(req.url);
    const format = (url.searchParams.get('format') ?? 'png') as 'png' | 'pdf';
    const scale = Math.min(3, Math.max(1, Number(url.searchParams.get('scale') ?? 1)));
    if (format !== 'png' && format !== 'pdf') {
      return NextResponse.json(
        { error: { code: 'export_format_unsupported', message: 'Format : png ou pdf.' } },
        { status: 400 },
      );
    }
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    const { buffer, mimeType, fileName } = await exportDesign(ctx, id, format, scale, ip);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(buffer.byteLength),
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
