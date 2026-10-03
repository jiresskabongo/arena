import { NextResponse } from 'next/server';
import { forgotPasswordSchema } from '@/lib/schemas/auth';
import { forgotPassword } from '@/server/services/account';
import { rateLimit, rlKey, limits } from '@/server/auth/rate-limit';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;

  const rl = rateLimit(rlKey('forgot', ip), limits.authPerMin, 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Trop de tentatives.' } },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation', message: 'Adresse e-mail invalide.' } },
      { status: 400 },
    );
  }

  // Toujours 200 (anti-énumération) : on ne révèle jamais si l'e-mail existe
  await forgotPassword(parsed.data.email);
  return NextResponse.json({ ok: true, sent: true });
}
