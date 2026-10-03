import { NextResponse } from 'next/server';
import { registerSchema } from '@/lib/schemas/auth';
import { register } from '@/server/services/account';
import { createSession, sessionCookieOptions } from '@/server/auth/session';
import { rateLimit, rlKey, limits } from '@/server/auth/rate-limit';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;

  const rl = rateLimit(rlKey('register', ip), limits.authPerMin, 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Trop de tentatives. Réessayez dans une minute.' } },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
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

  const result = await register(parsed.data, ip);
  if (!result.ok) {
    const status = result.error.code === 'email_taken' ? 409 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  const token = await createSession(result.data.userId);
  const res = NextResponse.json({
    ok: true,
    user: { id: result.data.userId, organizationId: result.data.organizationId },
  });
  res.cookies.set('ef_session', token, sessionCookieOptions());
  return res;
}
