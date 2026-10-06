import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { prisma } from '@/lib/prisma';
import { getAuth } from '@/server/auth/session';
import { getSubscriptionView } from '@/server/services/subscription';
import { getDashboardStats } from '@/server/services/dashboard';
import { getQuotas } from '@/server/services/quotas';
import { listEvents } from '@/server/services/event';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ShieldCheck, MailWarning, CreditCard, Hourglass, CalendarDays, Users,
  CheckCheck, LogIn, Send, Sparkles, AlertTriangle, Plus, ArrowRight,
} from 'lucide-react';

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('dashboard');

  // Le layout (app) garantit déjà l'authentification ; garde défensive
  const auth = await getAuth();
  if (!auth) redirect('/login');

  const isSuperAdmin = auth.user.isSuperAdmin;

  const activeOrg = isSuperAdmin
    ? null
    : await prisma.userActiveOrg.findUnique({
        where: { userId: auth.user.id },
        include: { organization: true },
      });
  const orgActive = activeOrg?.organization.isActive ?? false;

  const subscription = orgActive ? await getSubscriptionView(activeOrg!.organization.id) : null;
  const stats = orgActive ? await getDashboardStats(activeOrg!.organization.id) : null;
  const quotas = subscription && orgActive ? await getQuotas(activeOrg!.organization.id, subscription.plan) : [];
  const recentEvents = orgActive
    ? (await listEvents(activeOrg!.organization.id, 1, 3)).items
    : [];

  const trialEndingSoon = subscription?.inTrial && !subscription.trialExpired && subscription.daysLeft <= 3;

  const fmtDate = (d: Date) =>
    new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'medium' }).format(d);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t('hello', { name: auth.user.firstName })}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isSuperAdmin
              ? t('adminSubtitle')
              : t('orgSubtitle', { org: activeOrg?.organization.name ?? '—' })}
          </p>
        </div>
        {!isSuperAdmin && (
          <Button asChild>
            <Link href="/events/new">
              <Plus className="size-4" aria-hidden />
              {t('newEvent')}
            </Link>
          </Button>
        )}
      </div>

      {!auth.user.emailVerifiedAt && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex items-start gap-3 pt-6">
            <MailWarning className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
            <div>
              <CardTitle className="text-sm">{t('verifyTitle')}</CardTitle>
              <CardDescription className="mt-1">
                {t('verifyBody')}{' '}
                <Link href="/demo/outbox" className="text-primary underline underline-offset-2">
                  {t('verifyOutbox')}
                </Link>
              </CardDescription>
            </div>
          </CardContent>
        </Card>
      )}

      {subscription && (subscription.trialExpired || (subscription.inTrial && subscription.daysLeft <= 3)) && (
        <Card
          className={
            subscription.trialExpired
              ? 'border-destructive/40 bg-destructive/5'
              : 'border-warning/40 bg-warning/5'
          }
        >
          <CardContent className="flex items-start gap-3 pt-6">
            {subscription.trialExpired ? (
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
            ) : (
              <Hourglass className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
            )}
            <div className="flex-1">
              <CardTitle className="text-sm">
                {subscription.trialExpired
                  ? t('trialOverTitle')
                  : t('trialEndsTitle', { days: subscription.daysLeft })}
              </CardTitle>
              <CardDescription className="mt-1">
                {subscription.trialExpired ? t('trialOverBody') : t('trialEndsBody')}
              </CardDescription>
            </div>
            <Button variant={subscription.trialExpired ? 'default' : 'outline'} size="sm" asChild>
              <Link href="/settings/plan">
                <CreditCard className="size-4" aria-hidden />
                {t('goPlan')}
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {isSuperAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-primary" aria-hidden />
              {t('adminCardTitle')}
            </CardTitle>
            <CardDescription>{t('adminCardBody')}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard icon={CalendarDays} label={t('kpiEvents')} value={String(stats?.events ?? 0)} />
            <KpiCard icon={Users} label={t('kpiGuests')} value={String(stats?.guests ?? 0)} />
            <KpiCard
              icon={CheckCheck}
              label={t('kpiRsvp')}
              value={
                stats && stats.rsvpTotal > 0
                  ? `${stats.rsvpConfirmed}/${stats.rsvpTotal}`
                  : '0'
              }
              hint={stats && stats.rsvpTotal > 0 ? t('kpiRsvpHint', { total: stats.rsvpTotal }) : undefined}
            />
            <KpiCard icon={LogIn} label={t('kpiCheckins')} value={String(stats?.checkins ?? 0)} />
            <KpiCard icon={Send} label={t('kpiSent')} value={String(stats?.sentThisMonth ?? 0)} />
            <KpiCard
              icon={Sparkles}
              label={t('kpiAiCredits')}
              value={String(stats?.aiCreditsUsed ?? 0)}
              hint={t('kpiAiHint')}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Abonnement + quotas */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('subTitle')}</CardTitle>
                <CardDescription>{t('subBody')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CreditCard className="size-4 text-muted-foreground" aria-hidden />
                    <span className="font-medium">{subscription?.plan.name ?? t('noSubscription')}</span>
                    {subscription?.inTrial && !subscription.trialExpired && (
                      <Badge variant="warning">{t('trialBadge')}</Badge>
                    )}
                    {subscription?.trialExpired && <Badge variant="danger">{t('expiredBadge')}</Badge>}
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/settings/plan">
                      {t('managePlan')}
                      <ArrowRight className="size-3.5" aria-hidden />
                    </Link>
                  </Button>
                </div>
                {subscription?.inTrial && !subscription.trialExpired && (
                  <p className="text-xs text-muted-foreground">
                    {t('trialUntil', { until: subscription.trialEndsAt ? fmtDate(subscription.trialEndsAt) : '—', days: subscription.daysLeft })}
                  </p>
                )}
                <div className="space-y-2.5 border-t pt-4">
                  {quotas.slice(0, 4).map((q) => (
                    <div key={q.key}>
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="text-muted-foreground">{t(`quota.${q.key}`)}</span>
                        <span className="tabular-nums">
                          {q.limit > 0 ? `${q.used} / ${q.limit}` : t('unlimited')}
                        </span>
                      </div>
                      {q.limit > 0 && (
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full ${q.used >= q.limit ? 'bg-destructive' : q.pct >= 80 ? 'bg-warning' : 'bg-primary'}`}
                            style={{ width: `${Math.min(100, q.pct)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Événements récents */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('recentTitle')}</CardTitle>
                <CardDescription>{t('recentBody')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {recentEvents.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-4 text-center">
                    <p className="text-sm text-muted-foreground">{t('recentEmpty')}</p>
                    <div className="mt-3 flex justify-center gap-2">
                      <Button size="sm" asChild>
                        <Link href="/onboarding">{t('startOnboarding')}</Link>
                      </Button>
                      <Button size="sm" variant="outline" asChild>
                        <Link href="/events/new">{t('newEvent')}</Link>
                      </Button>
                    </div>
                  </div>
                ) : (
                  recentEvents.map((e) => (
                    <div key={e.id} className="flex items-center justify-between gap-2 rounded-xl border p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{e.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {fmtDate(e.date)} · {e.startTime} — {e.venue}
                        </p>
                      </div>
                      <Badge variant={e.status === 'published' ? 'success' : 'secondary'} className="shrink-0">
                        {e.guests}
                      </Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* Actions rapides */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('quickTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/events/new">
                  <Plus className="size-4" aria-hidden />
                  {t('newEvent')}
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/settings/plan">
                  <CreditCard className="size-4" aria-hidden />
                  {t('plan')}
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/demo/outbox">
                  <Send className="size-4" aria-hidden />
                  {t('outbox')}
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/settings/sessions">{t('sessions')}</Link>
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function KpiCard({
  icon: Icon, label, value, hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="size-4" aria-hidden />
          <span className="text-sm">{label}</span>
        </div>
        <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
