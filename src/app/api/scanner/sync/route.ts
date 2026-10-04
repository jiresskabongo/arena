import { NextResponse } from 'next/server';
import { z } from 'zod';
import { scannerSyncOut, syncScans } from '@/server/services/checkin';
import { rateLimit, rlKey } from '@/server/auth/rate-limit';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/scanner/sync?agentToken=...&since=...
 * Pré-synchronisation hors ligne (CDC §28.1) : tokens autorisés de l'événement
 * de l'agent + infos minimales (plafond 2000 invitations).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const agentToken = url.searchParams.get('agentToken') ?? '';
  const since = url.searchParams.get('since') ?? undefined;

  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
  const rl = rateLimit(rlKey('scanner_sync', ip), 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Trop de requêtes.' } },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const data = await scannerSyncOut(agentToken, since);
  if (!data) {
    return NextResponse.json(
      { error: { code: 'agent_denied', message: 'Agent inconnu ou désactivé.' } },
      { status: 403 },
    );
  }
  return NextResponse.json(data);
}

const syncSchema = z.object({
  agentToken: z.string().min(16).max(80),
  scans: z
    .array(
      z.object({
        clientUuid: z.string().min(8).max(64),
        token: z.string().min(1).max(120),
        entryPoint: z.string().max(20).optional(),
        deviceId: z.string().max(64).optional(),
        clientAt: z.string().datetime({ offset: true }).optional(),
      }),
    )
    .max(200),
});

/**
 * POST /api/scanner/sync — replay hors ligne (CDC §28.5) : rejoue chaque scan
 * avec les mêmes règles que l'online (idempotent par clientUuid, max 200/batch).
 */
export async function POST(req: Request) {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
  const rl = rateLimit(rlKey('scanner_sync', ip), 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Trop de requêtes.' } },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }
  const body = await req.json().catch(() => null);
  const parsed = syncSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation',
          message: 'Batch de synchronisation invalide.',
          details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        },
      },
      { status: 400 },
    );
  }
  try {
    const res = await syncScans(parsed.data.agentToken, parsed.data, ip);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    const { apiError } = await import('@/server/http');
    return apiError(e);
  }
}
