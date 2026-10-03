import { NextResponse } from 'next/server';
import { TenantError } from '@/server/services/tenant';

/** Convertit une erreur serveur en réponse JSON normalisée. */
export function apiError(e: unknown, fallbackCode = 'internal_error'): NextResponse {
  if (e instanceof TenantError) {
    return NextResponse.json(
      { error: { code: e.code, message: e.message } },
      { status: e.status },
    );
  }
  console.error('[api]', e);
  return NextResponse.json(
    { error: { code: fallbackCode, message: 'Erreur interne. Réessayez dans un instant.' } },
    { status: 500 },
  );
}
