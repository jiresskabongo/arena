import { NextResponse } from 'next/server';
import { z } from 'zod';
import { submitRsvp } from '@/server/services/invitation';
import { rateLimit, rlKey } from '@/server/auth/rate-limit';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  status: z.enum(['confirmed', 'declined', 'maybe']),
  companions: z.number().int().min(0).max(30).default(0),
  answers: z.record(z.union([z.string(), z.number()])).optional(),
});

/**
 * POST /api/invitations/[token]/rsvp — RSVP public (sans auth).
 * Rate limiting par IP + token (RATE_LIMIT_PUBLIC_RSVP_PER_MIN, défaut 10).
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
  const rl = rateLimit(
    rlKey('rsvp', ip),
    Number(process.env.RATE_LIMIT_PUBLIC_RSVP_PER_MIN ?? 10),
    60_000,
  );
  if (!rl.ok) {
    return new NextResponse(
      JSON.stringify({ error: { code: 'rate_limited', message: 'Trop de requêtes. Réessayez dans une minute.' } }),
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
          message: 'Requête RSVP invalide.',
          details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        },
      },
      { status: 400 },
    );
  }
  try {
    const res = await submitRsvp(token, parsed.data, ip);
    return NextResponse.json(res);
  } catch (e) {
    const { apiError } = await import('@/server/http');
    return apiError(e);
  }
}
