import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { processWebhook } from '@/server/providers/payment';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';

/**
 * POST /api/webhooks/mock — webhook du fournisseur de paiement (mock).
 * Authentifié par signature HMAC (jamais par session) ; idempotent
 * (double livraison = 1 effet). C'est le SEUL chemin qui modifie le statut
 * d'abonnement (critère O).
 */
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const signature = req.headers.get('x-mock-signature');
    const res = await processWebhook(raw, signature);
    return NextResponse.json(res);
  } catch (e) {
    return apiError(e);
  }
}
