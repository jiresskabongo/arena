import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireTenant, TenantError } from '@/server/services/tenant';
import { getEventForOrg, listEventMembers } from '@/server/services/event';
import { can } from '@/server/services/permissions';
import Link from 'next/link';
import { EventActions } from '@/components/app/event-actions';
import { EventEditForm } from '@/components/app/event-edit-form';
import { EventMembersPanel } from '@/components/app/event-members';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRight, CalendarDays, MapPin, Users } from 'lucide-react';

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('events.detail');

  const ctx = await requireTenant();
  if (!ctx.organization) notFound();

  const event = await getEventForOrg(id, ctx.organization.id);
  if (!event) notFound();

  const members = (await listEventMembers(id, ctx.organization.id)) ?? [];
  // Date → chaîne : un Date sérialisé RSC arrive comme Date côté client
  const eventForForm = { ...event, date: event.date.toISOString().slice(0, 10) };
  const canUpdate = ctx.isSuperAdmin || (ctx.role !== null && can(ctx.role, 'event:update'));
  const canDelete = ctx.isSuperAdmin || (ctx.role !== null && can(ctx.role, 'event:delete'));
  const isEn = locale === 'en';
  const dateFmt = new Intl.DateTimeFormat(isEn ? 'en-GB' : 'fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{event.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="size-4" aria-hidden />
              {dateFmt.format(event.date)} · {event.startTime}
              {event.endTime ? ` – ${event.endTime}` : ''}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="size-4" aria-hidden />
              {event.venue}
              {event.city ? ` · ${event.city}` : ''}
            </span>
          </p>
        </div>
      </div>

      {!canUpdate && !canDelete && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="pt-6 text-sm text-muted-foreground">{t('readOnly')}</CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Colonne gauche : statut + actions */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('statusTitle')}</CardTitle>
              <CardDescription>{t('statusBody')}</CardDescription>
            </CardHeader>
            <CardContent>
              <EventActions
                eventId={event.id}
                status={event.status}
                slug={event.slug}
                canUpdate={canUpdate}
                canDelete={canDelete}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('guestsLink')}</CardTitle>
              <CardDescription>{t('guestsLinkBody')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href={`/events/${event.id}/guests`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                {t('guestsLink')}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('invitationsLink')}</CardTitle>
              <CardDescription>{t('invitationsLinkBody')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href={`/events/${event.id}/invitations`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                {t('invitationsLink')}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('checkinLink')}</CardTitle>
              <CardDescription>{t('checkinLinkBody')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href={`/events/${event.id}/checkin`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                {t('checkinLink')}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </CardContent>
          </Card>
          <EventMembersPanel eventId={event.id} people={members} canEdit={canUpdate} />
        </div>

        {/* Colonne droite : édition */}
        {canUpdate ? (
          <EventEditForm eventId={event.id} event={eventForForm} locale={locale} />
        ) : (
          <Card>
            <CardContent className="space-y-2 pt-6 text-sm text-muted-foreground">
              <p className="flex items-center gap-2">
                <Users className="size-4" aria-hidden />
                {t('readOnlyBody')}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
