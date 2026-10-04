import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { listOutbox } from '@/server/services/communication';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';

/** GET /api/outbox — boîte d'envoi (démo mock) : messages de l'organisation. */
export async function GET(req: Request) {
  try {
    const ctx = await requireTenant();
    const url = new URL(req.url);
    const res = await listOutbox(ctx, {
      page: Number(url.searchParams.get('page') ?? 1),
      pageSize: Number(url.searchParams.get('pageSize') ?? 25),
      channel: url.searchParams.get('channel') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
    });
    return NextResponse.json({ ok: true, mock: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}
