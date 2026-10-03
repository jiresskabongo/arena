import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Check, X, Hourglass, AlertTriangle, CreditCard, Sparkles } from 'lucide-react';
import { requireTenant } from '@/server/services/tenant';
import { getSubscriptionView } from '@/server/services/subscription';
import { listPlans } from '@/server/services/subscription';
import { getQuotas, type QuotaState } from '@/server/services/quotas';
import type { PlanPrice } from '@prisma/client';

const QUOTA_ORDER = [
  'events',
  'guestsPerEvent',
  'members',
  'storageMb',
  'emailsPerMonth',
  'smsPerMonth',
  'aiCreditsPerMonth',
] as const;

function money(amountMinor: number, currency: string, locale: string): string {
  const value = currency === 'CDF' ? amountMinor : amountMinor / 100; // CDF : pas de centimes (CDC §59)
  return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'fr-FR', {
    style: 'currency',
    currency,
    minimumFractionDigits: currency === 'CDF' ? 0 : 2,
    maximumFractionDigits: currency === 'CDF' ? 0 : 2,
  }).format(value);
}

function priceLabel(prices: PlanPrice[], currency: string, locale: string, interval: 'monthly' | 'yearly') {
  const p = prices.find((x) => x.currency === currency && x.interval === interval);
  return p ? money(p.amountMinor, p.currency, locale) : null;
}

export default async function PlanPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('app.plan');

  const ctx = await requireTenant();
  if (!ctx.organization) {
    // Super admin : pas d'organisation — état explicite (CDC : jamais de page vide muette)
    return (
      <div className="space-y-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">{t('superAdminNote')}</CardContent>
        </Card>
      </div>
    );
  }

  const org = ctx.organization;
  const sub = await getSubscriptionView(org.id);
  const quotas: QuotaState[] = sub ? await getQuotas(org.id, sub.plan) : [];
  const plans = (await listPlans()).filter((p) => p.code !== 'starter' || sub?.plan.code === 'starter' || true);

  const trialEndingSoon = sub?.inTrial && !sub.trialExpired && sub.daysLeft <= 3;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('subtitle', { org: org.name })}
        </p>
      </div>

      {/* État de l'abonnement */}
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <CreditCard className="size-5" aria-hidden />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-lg font-semibold leading-tight">{sub?.plan.name ?? t('noSubscription')}</p>
                {sub?.inTrial && !sub.trialExpired && (
                  <Badge variant="warning">{t('trialBadge')}</Badge>
                )}
                {sub && !sub.inTrial && !sub.trialExpired && (
                  <Badge variant="secondary">{t('activeBadge')}</Badge>
                )}
                {sub?.trialExpired && <Badge variant="danger">{t('expiredBadge')}</Badge>}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {sub?.inTrial
                  ? sub.trialExpired
                    ? t('trialOverBody')
                    : t('trialBody', { days: sub.daysLeft, until: sub.trialEndsAt?.toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR') ?? '—' })
                  : t('currentBody', { plan: sub?.plan.name ?? '—' })}
              </p>
            </div>
          </div>
          {sub?.inTrial && (
            <Button variant={sub.trialExpired ? 'default' : 'outline'} asChild>
              <Link href="#plans">{t('choosePlan')}</Link>
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Alerte essai qui finit */}
      {trialEndingSoon && sub && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="flex items-start gap-3 pt-6">
            <Hourglass className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
            <div>
              <CardTitle className="text-sm">{t('endingSoonTitle', { days: sub.daysLeft })}</CardTitle>
              <CardDescription className="mt-1">
                {t('endingSoonBody')}{' '}
                <Link href="#plans" className="text-primary underline underline-offset-2">
                  {t('choosePlan')}
                </Link>
              </CardDescription>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quotas d'usage */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('usageTitle')}</CardTitle>
          <CardDescription>{t('usageBody')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {quotas.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('noUsage')}</p>
          )}
          {quotas
            .filter((q) => QUOTA_ORDER.includes(q.key as (typeof QUOTA_ORDER)[number]))
            .sort((a, b) => QUOTA_ORDER.indexOf(a.key as (typeof QUOTA_ORDER)[number]) - QUOTA_ORDER.indexOf(b.key as (typeof QUOTA_ORDER)[number]))
            .map((q) => {
              const over = q.limit > 0 && q.used >= q.limit;
              const warn = q.limit > 0 && q.pct >= 80 && !over;
              return (
                <div key={q.key}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span>{t(`quota.${q.key}`)}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {q.limit > 0 ? (
                        <>{q.used} / {q.limit}</>
                      ) : (
                        t('unlimited')
                      )}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" role="presentation">
                    {q.limit > 0 && (
                      <div
                        className={`h-full rounded-full ${over ? 'bg-destructive' : warn ? 'bg-warning' : 'bg-primary'}`}
                        style={{ width: `${Math.min(100, q.pct)}%` }}
                      />
                    )}
                  </div>
                  {over && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                      <AlertTriangle className="size-3.5" aria-hidden />
                      {t('quotaReached', { label: t(`quota.${q.key}`) })}
                    </p>
                  )}
                </div>
              );
            })}
        </CardContent>
      </Card>

      {/* Comparaison des plans */}
      <div id="plans" className="scroll-mt-24">
        <h2 className="font-display text-2xl font-semibold tracking-tight">{t('plansTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('plansBody', { org_currency: org.currency })}</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {plans.map((p) => {
            const current = sub?.plan.code === p.code;
            const monthly = priceLabel(p.prices, org.currency, locale, 'monthly');
            const yearly = priceLabel(p.prices, org.currency, locale, 'yearly');
            return (
              <Card key={p.code} className={current ? 'border-primary/60' : undefined}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    {current && <Badge variant="secondary">{t('currentPlan')}</Badge>}
                    {!current && p.code === 'pro' && (
                      <Badge variant="outline" className="gap-1">
                        <Sparkles className="size-3" aria-hidden />
                        {t('recommended')}
                      </Badge>
                    )}
                  </div>
                  <CardDescription>{p.description}</CardDescription>
                  <div className="pt-2">
                    {monthly ? (
                      <>
                        <span className="text-2xl font-semibold">{monthly}</span>
                        <span className="text-sm text-muted-foreground"> / {t('perMonth')}</span>
                        {yearly && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {t('perYear', { amount: yearly })}
                          </p>
                        )}
                      </>
                    ) : (
                      <span className="text-sm text-muted-foreground">{t('priceUnavailable')}</span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="space-y-1.5 text-sm">
                    {(
                      [
                        ['premiumTemplates', 'premiumTemplates'],
                        ['communications', 'communications'],
                        ['advancedStats', 'advancedStats'],
                        ['team', 'team'],
                        ['whiteLabel', 'whiteLabel'],
                      ] as const
                    ).map(([key, label]) => {
                      const has = Boolean(p.features[key]);
                      return (
                        <li key={key} className="flex items-center gap-2">
                          {has ? (
                            <Check className="size-4 shrink-0 text-primary" aria-hidden />
                          ) : (
                            <X className="size-4 shrink-0 text-muted-foreground/50" aria-hidden />
                          )}
                          <span className={has ? '' : 'text-muted-foreground'}>{t(`feature.${label}`)}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <Separator />
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    <li>
                      {t('limit.events')}: <span className="font-medium text-foreground">{p.limits.events ?? '—'}</span>
                    </li>
                    <li>
                      {t('limit.guestsPerEvent')}: <span className="font-medium text-foreground">{p.limits.guestsPerEvent ?? '—'}</span>
                    </li>
                    <li>
                      {t('limit.collaborators')}: <span className="font-medium text-foreground">{p.limits.collaborators ?? '—'}</span>
                    </li>
                    <li>
                      {t('limit.aiCreditsPerMonth')}: <span className="font-medium text-foreground">{p.limits.aiCreditsPerMonth ?? '—'}</span>
                    </li>
                    <li>
                      {t('limit.storageMb')}: <span className="font-medium text-foreground">{p.limits.storageMb ?? '—'} Mo</span>
                    </li>
                  </ul>
                  <Button
                    variant={current ? 'outline' : 'default'}
                    className="w-full"
                    disabled
                    title={t('changeSoon')}
                  >
                    {current ? t('currentPlan') : t('changePlan')}
                  </Button>
                  <p className="text-center text-[11px] text-muted-foreground">{t('changeSoon')}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
