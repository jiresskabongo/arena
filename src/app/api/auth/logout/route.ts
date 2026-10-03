import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAuth, destroySession } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

export async function POST() {
  const auth = await getAuth();
  if (auth) {
    await destroySession(auth.session.id);
  }
  const store = await cookies();
  const res = NextResponse.json({ ok: true });
  store.delete('ef_session');
  return res;
}
