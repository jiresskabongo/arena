import { NextResponse } from 'next/server';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { requireTenant, TenantError } from '@/server/services/tenant';
import { createImportJob } from '@/server/services/guest';
import { importUploadSchema, IMPORT_FIELDS } from '@/lib/schemas/guest';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';

/**
 * POST /api/events/[id]/import/upload — étape 1 : lecture du fichier
 * (CSV texte ou XLSX base64) → colonnes + lignes numérotées pour l'étape
 * de mapping côté client. Crée un ImportJob « pending » (audit).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: eventId } = await params;
    const ctx = await requireTenant('guest:import');
    const body = await req.json().catch(() => null);
    const parsed = importUploadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'validation',
            message: 'Fichier illisible. Utilisez un CSV ou un XLSX.',
            details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
          },
        },
        { status: 400 },
      );
    }
    const { fileName, kind, content } = parsed.data;

    let rows: string[][];
    if (kind === 'csv') {
      const res = Papa.parse<string[]>(content, { skipEmptyLines: 'greedy' });
      rows = res.data;
    } else {
      const wb = XLSX.read(Buffer.from(content, 'base64'), { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new TenantError(400, 'import_empty_file', 'Aucune feuille trouvée dans le fichier.');
      rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as string[][];
    }

    rows = rows.map((r) => (r ?? []).map((c) => (c === null ? '' : String(c).trim())));
    // Retire les lignes totalement vides
    rows = rows.filter((r) => r.some((c) => c !== ''));
    if (rows.length < 2) {
      throw new TenantError(400, 'import_no_rows', 'Le fichier doit contenir un en-tête et au moins une ligne.');
    }
    if (rows.length - 1 > 5000) {
      throw new TenantError(400, 'import_too_large', 'Import limité à 5 000 lignes par fichier.');
    }

    const columns = rows[0];
    const dataRows = rows.slice(1).map((r, i) => ({
      row: i + 2,
      data: Object.fromEntries(r.map((v, ci) => [String(ci), v])),
    }));

    const job = await createImportJob(ctx, eventId, {
      fileName,
      mimeType: kind === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      totalRows: dataRows.length,
    });

    return NextResponse.json({
      ok: true,
      job: { id: job.id },
      columns,
      rows: dataRows,
      fields: IMPORT_FIELDS,
    });
  } catch (e) {
    return apiError(e);
  }
}
