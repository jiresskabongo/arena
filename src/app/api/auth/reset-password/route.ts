import { NextResponse } from 'next/server';
import { resetPasswordSchema } from '@/lib/schemas/auth';
import { consumeEmailToken } from '@/server/auth/tokens';
import { hashPassword } from '@/server/auth/password';
import { destroyAllSessionsForUser } from '@/server/auth/session';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/server/services/activity';
import { rateLimit, rlKey, limits } from '@/server/auth/rate-limit';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;

  const rl = rateLimit(rlKey('reset', ip), limits.authPerMin, 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json({ error: { code: 'rate_limited', message: 'Trop de tentatives.' } }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = resetPasswordSchema.safeParse(body);
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

  const result = await consumeEmailToken(parsed.data.token, 'reset_password');
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: 'invalid_token', message: 'Lien invalide ou expiré. Demandez un nouveau lien.' } },
      { status: result.reason === 'invalid' ? 400 : 410 },
    );
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await prisma.user.update({ where: { id: result.userId }, data: { passwordHash } });
  // Sécurité : révoquer toutes les sessions du compte
  await destroyAllSessionsForUser(result.userId);
  await logActivity({ userId: result.userId, action: 'auth.password_reset', ip });

  return NextResponse.json({ ok: true });
}
