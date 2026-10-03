import { NextResponse } from 'next/server';
import { changePasswordSchema } from '@/lib/schemas/auth';
import { changePassword } from '@/server/services/account';
import { getAuth } from '@/server/auth/session';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await getAuth();
  if (!auth) {
    return NextResponse.json({ error: { code: 'unauthorized', message: 'Session expirée.' } }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = changePasswordSchema.safeParse(body);
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

  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
  const result = await changePassword(auth.user.id, parsed.data, ip);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error.code === 'invalid_credentials' ? 401 : 404 });
  }

  // La session courante est révoquée par le service : on répond ok, le client se déconnecte
  return NextResponse.json({ ok: true, loggedOut: true });
}
