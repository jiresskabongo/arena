import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { aiGenerate, AI_COSTS } from '@/server/services/ai';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ai/generate — génération IA (design ou texte).
 * Cycle : quota → réservation AiUsage(pending) → exécution → success |
 * failed+remboursement. Permission `design:create` (espace créatif).
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireTenant('design:create');
    const body = await req.json().catch(() => null);
    const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const res = await aiGenerate(ctx, body as never, ip);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}

/** GET /api/ai/generate (sans corps) — coûts par opération (info UI). */
export async function GET() {
  return NextResponse.json({ ok: true, costs: AI_COSTS, provider: 'mock-démo' });
}
