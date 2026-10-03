import { prisma } from '@/lib/prisma';

/**
 * Assistant d'onboarding 7 étapes (CDC — flux A : nouveau user → premier
 * événement en < 5 min). Persisté dans OnboardingState, skippable, retour
 * arrière autorisé.
 */

export const ONBOARDING_STEPS = 7;

export const ONBOARDING_STEP_KEYS = [
  'welcome',
  'organization',
  'first_event',
  'guests',
  'team',
  'plan',
  'done',
] as const;
export type OnboardingStepKey = (typeof ONBOARDING_STEP_KEYS)[number];

export interface OnboardingView {
  currentStep: number; // 1..7
  stepKey: OnboardingStepKey;
  completed: boolean;
  completedAt: Date | null;
}

export async function getOnboarding(userId: string): Promise<OnboardingView> {
  let state = await prisma.onboardingState.findUnique({ where: { userId } });
  if (!state) {
    // Rattrapage : l'inscription le crée normalement (transaction Phase 2)
    const activeOrg = await prisma.userActiveOrg.findUnique({ where: { userId } });
    if (!activeOrg) throw new Error('onboarding_no_org');
    state = await prisma.onboardingState.create({
      data: { userId, organizationId: activeOrg.organizationId },
    });
  }
  return toView(state);
}

function toView(state: { currentStep: number; completedAt: Date | null; userId: string }) {
  const currentStep = Math.min(Math.max(state.currentStep, 1), ONBOARDING_STEPS);
  return {
    currentStep,
    stepKey: ONBOARDING_STEP_KEYS[currentStep - 1],
    completed: state.completedAt !== null,
    completedAt: state.completedAt,
  };
}

export async function setOnboardingStep(userId: string, step: number): Promise<OnboardingView> {
  if (!Number.isInteger(step) || step < 1 || step > ONBOARDING_STEPS) {
    throw new Error('onboarding_step_invalid');
  }
  const state = await prisma.onboardingState.update({
    where: { userId },
    data: { currentStep: step },
  });
  return toView(state);
}

export async function completeOnboarding(userId: string): Promise<OnboardingView> {
  const state = await prisma.onboardingState.update({
    where: { userId },
    data: { completedAt: new Date(), currentStep: ONBOARDING_STEPS },
  });
  return toView(state);
}
