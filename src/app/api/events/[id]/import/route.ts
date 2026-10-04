import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { listImportJobs } from '@/server/services/guest';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';

/** GET /api/events/[id]/import — historique des imports de l'événement (guest:import). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: eventId } = await params;
    const ctx = await requireTenant('guest:import');
    const jobs = await listImportJobs(ctx, eventId);
    return NextResponse.json({
      ok: true,
      jobs: jobs.map((j) => ({
        id: j.id,
        fileName: j.fileName,
        status: j.status,
        totalRows: j.totalRows,
        validRows: j.validRows,
        errorRows: j.errorRows,
        duplicateRows: j.duplicateRows,
        createdAt: j.createdAt,
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}
