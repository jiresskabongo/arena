import { NextResponse } from 'next/server';
import { verifyEmailSchema } from '@/lib/schemas/auth';
import { consumeEmailToken } from '@/server/auth/tokens';
import { rateLimit, rlKey, limits } from '@/server/auth/rate-limit';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;

  const rl = rateLimit(rlKey('verify', ip), 10, 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Trop de tentatives.' } },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = verifyEmailSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: 'invalid' }, { status: 400 });
  }

  const result = await consumeEmailToken(parsed.data.token, 'verify_email');
  if (!result.ok) {
    const status = result.reason === 'invalid' ? 400 : 410;
    return NextResponse.json({ ok: false, reason: result.reason }, { status });
  }

  return NextResponse.json({ ok: true });
}
