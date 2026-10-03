import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/server/services/tenant';
import { getOnboarding } from '@/server/services/onboarding';
import { listEvents } from '@/server/services/event';
import { getSubscriptionView } from '@/server/services/subscription';
import { OnboardingWizard } from '@/components/app/onboarding-wizard';

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await requireTenant();
  if (ctx.isSuperAdmin || !ctx.organization) redirect('/dashboard');

  const [onboarding, events, sub, org] = await Promise.all([
    getOnboarding(ctx.user.id),
    listEvents(ctx.organization.id, 1, 3),
    getSubscriptionView(ctx.organization.id),
    prisma.organization.findUnique({ where: { id: ctx.organization.id } }),
  ]);
  if (!org) redirect('/dashboard');

  return (
    <OnboardingWizard
      initialStep={onboarding.currentStep}
      org={{
        name: org.name,
        currency: org.currency,
        locale: org.locale,
        timezone: org.timezone,
        email: org.email ?? '',
        phone: org.phone ?? '',
        address: org.address ?? '',
      }}
      events={events.items.map((e) => ({ id: e.id, name: e.name }))}
      planName={sub?.plan.name ?? null}
      inTrial={sub?.inTrial ?? false}
      daysLeft={sub?.daysLeft ?? 0}
      role={ctx.role!}
      locale={locale}
    />
  );
}
