import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { requireTenant } from '@/server/services/tenant';
import { getEventForOrg } from '@/server/services/event';
import { can } from '@/server/services/permissions';
import { StatisticsPageClient } from '@/components/app/statistics-page';

export default async function EventStatisticsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const ctx = await requireTenant();
  if (!ctx.organization) notFound();

  const event = await getEventForOrg(id, ctx.organization.id);
  if (!event) notFound();

  const role = ctx.role;
  const canModerate = ctx.isSuperAdmin || (role !== null && can(role, 'event:update'));

  return <StatisticsPageClient eventId={event.id} eventName={event.name} locale={locale} canModerate={canModerate} />;
}
