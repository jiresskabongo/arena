import { NextResponse } from 'next/server';
import { postGuestbook } from '@/server/services/event';
import { guestbookMessageSchema } from '@/lib/schemas/event';
import { apiError } from '@/server/http';
import { rateLimit, rlKey, limits } from '@/server/auth/rate-limit';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/public/events/[slug]/guestbook — livre d'or public (aucune
 * auth ; rate limiting IP + validation stricte).
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;

  const rl = rateLimit(rlKey('guestbook', ip), limits.publicRsvpPerMin, 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Trop de messages. Réessayez dans une minute.' } },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  try {
    const { slug } = await params;
    const body = await req.json().catch(() => null);
    const parsed = guestbookMessageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'validation',
            message: 'Veuillez corriger les champs indiqués.',
            details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
          },
        },
        { status: 400 },
      );
    }

    const msg = await postGuestbook(slug, parsed.data, ip);
    return NextResponse.json({ ok: true, message: msg }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
