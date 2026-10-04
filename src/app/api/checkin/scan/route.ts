import { NextResponse } from 'next/server';
import { z } from 'zod';
import { scanCheckIn } from '@/server/services/checkin';
import { rateLimit, rlKey } from '@/server/auth/rate-limit';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  agentToken: z.string().min(16).max(80),
  token: z.string().min(1).max(120),
  entryPoint: z.string().max(20).optional(),
  deviceId: z.string().max(64).optional(),
  clientUuid: z.string().min(8).max(64).optional(),
  clientAt: z.string().datetime({ offset: true }).optional(),
});

/**
 * POST /api/checkin/scan — scan en ligne (agent authentifié par token opaque).
 * Résultat : { status: valid|already_used|invalid|expired, guest?, welcome, meta? }.
 * Rate limit par IP (RATE_LIMIT_SCAN_PER_MIN, défaut 60).
 */
export async function POST(req: Request) {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
  const rl = rateLimit(
    rlKey('checkin_scan', ip),
    Number(process.env.RATE_LIMIT_SCAN_PER_MIN ?? 60),
    60_000,
  );
  if (!rl.ok) {
    return new NextResponse(
      JSON.stringify({ error: { code: 'rate_limited', message: 'Trop de scans. Réessayez dans une minute.' } }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)),
        },
      },
    );
  }
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation',
          message: 'Requête de scan invalide.',
          details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        },
      },
      { status: 400 },
    );
  }
  const result = await scanCheckIn(parsed.data.agentToken, parsed.data, ip);
  return NextResponse.json(result);
}
