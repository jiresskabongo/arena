import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { requireTenant } from '@/server/services/tenant';
import { getEventForOrg } from '@/server/services/event';
import { can } from '@/server/services/permissions';
import { InvitationsPageClient } from '@/components/app/invitations-page';

export default async function EventInvitationsPage({
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
  const has = (p: Parameters<typeof can>[1]) =>
    ctx.isSuperAdmin || (role !== null && can(role, p));

  const options = (event.optionsJson ?? {}) as Record<string, boolean>;

  return (
    <InvitationsPageClient
      eventId={event.id}
      eventName={event.name}
      slug={event.slug}
      locale={locale}
      rsvpEnabled={Boolean(options.rsvp)}
      canInvite={has('guest:invite')}
      canUpdate={has('guest:update')}
    />
  );
}
