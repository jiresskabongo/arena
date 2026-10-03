import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireTenant } from '@/server/services/tenant';
import { listEvents } from '@/server/services/event';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CalendarDays, Plus, MapPin, Users } from 'lucide-react';

export default async function EventsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('events');

  const ctx = await requireTenant();
  if (!ctx.organization) {
    return <Card><CardContent className="pt-6 text-sm text-muted-foreground">{t('noOrg')}</CardContent></Card>;
  }

  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const result = await listEvents(ctx.organization.id, page, 10);

  const EVENT_TYPE_CODES = [
    'wedding', 'engagement', 'birthday', 'baptism', 'anniversary', 'gala',
    'conference', 'concert', 'sport', 'party', 'reunion', 'other',
  ] as const;
  const evtT = await getTranslations('events.type');
  const typeLabels: Record<string, string> = {};
  for (const code of EVENT_TYPE_CODES) typeLabels[code] = evtT(code);

  const fmtDate = (d: Date) =>
    new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
      dateStyle: 'long',
    }).format(d);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('subtitle', { count: result.total })}
          </p>
        </div>
        <Button asChild>
          <Link href="/events/new">
            <Plus className="size-4" aria-hidden />
            {t('new')}
          </Link>
        </Button>
      </div>

      {result.items.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader className="items-center text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
              <CalendarDays className="size-6" aria-hidden />
            </span>
            <CardTitle className="text-lg">{t('emptyTitle')}</CardTitle>
            <CardDescription>{t('emptyBody')}</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center gap-3">
            <Button asChild>
              <Link href="/onboarding">{t('startOnboarding')}</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/events/new">{t('new')}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {result.items.map((e) => (
            <Card key={e.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{e.name}</CardTitle>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {typeLabels[e.typeCode] ?? e.typeCode}
                    </p>
                  </div>
                  <Badge variant={e.status === 'published' ? 'success' : 'secondary'}>
                    {e.status === 'published' ? t('statusPublished') : t('statusDraft')}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p className="flex items-center gap-2">
                  <CalendarDays className="size-4 shrink-0" aria-hidden />
                  {fmtDate(e.date)} · {e.startTime}
                </p>
                <p className="flex items-center gap-2">
                  <MapPin className="size-4 shrink-0" aria-hidden />
                  {e.venue}
                  {e.city ? ` — ${e.city}` : ''}
                </p>
                <p className="flex items-center gap-2">
                  <Users className="size-4 shrink-0" aria-hidden />
                  {t('guestsCount', { guests: e.guests, confirmed: e.rsvpConfirmed, total: e.rsvpTotal })}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {result.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          {Array.from({ length: result.totalPages }, (_, i) => i + 1).map((p) => (
            <Button key={p} variant={p === page ? 'default' : 'outline'} size="sm" asChild>
              <Link href={`/events?page=${p}`}>{p}</Link>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
