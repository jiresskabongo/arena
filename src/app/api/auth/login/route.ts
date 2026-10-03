import { NextResponse } from 'next/server';
import { loginSchema } from '@/lib/schemas/auth';
import { login } from '@/server/services/account';
import { createSession, sessionCookieOptions } from '@/server/auth/session';
import { rateLimit, rlKey, limits } from '@/server/auth/rate-limit';
import { prisma } from '@/lib/prisma';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;

  const rl = rateLimit(rlKey('login', ip), limits.authPerMin, 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Trop de tentatives. Réessayez dans une minute.' } },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation', message: 'E-mail ou mot de passe invalide.' } },
      { status: 400 },
    );
  }

  const result = await login(parsed.data, ip);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { id: result.data.userId } });
  const token = await createSession(result.data.userId);
  const res = NextResponse.json({
    ok: true,
    redirect: user?.isSuperAdmin ? '/admin' : '/dashboard',
  });
  res.cookies.set('ef_session', token, sessionCookieOptions());
  return res;
}
