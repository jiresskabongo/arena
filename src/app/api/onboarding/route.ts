import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { getOnboarding, setOnboardingStep, completeOnboarding, ONBOARDING_STEPS } from '@/server/services/onboarding';
import { apiError } from '@/server/http';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

/** GET /api/onboarding — état de l'assistant (reprise où l'on s'était arrêté). */
export async function GET() {
  try {
    const ctx = await requireTenant();
    const onboarding = await getOnboarding(ctx.user.id);
    return NextResponse.json({ ok: true, ...onboarding });
  } catch (e) {
    return apiError(e);
  }
}

const stepSchema = z.object({
  step: z.number().int().min(1).max(ONBOARDING_STEPS).optional(),
  complete: z.boolean().optional(),
});

/** POST /api/onboarding — avance l'étape (retour arrière inclus) ou complète. */
export async function POST(req: Request) {
  try {
    const ctx = await requireTenant();
    const body = await req.json().catch(() => null);
    const parsed = stepSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'validation', message: 'Demande invalide.' } },
        { status: 400 },
      );
    }

    if (parsed.data.complete) {
      const state = await completeOnboarding(ctx.user.id);
      return NextResponse.json({ ok: true, ...state });
    }
    if (parsed.data.step) {
      const state = await setOnboardingStep(ctx.user.id, parsed.data.step);
      return NextResponse.json({ ok: true, ...state });
    }
    return NextResponse.json(
      { error: { code: 'validation', message: 'step ou complete requis.' } },
      { status: 400 },
    );
  } catch (e) {
    return apiError(e);
  }
}
