import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';
import { requireTenant } from '@/server/services/tenant';
import { getSubscriptionView } from '@/server/services/subscription';
import { getQuotas, type QuotaState } from '@/server/services/quotas';
import { can } from '@/server/services/permissions';
import { PlanBillingClient } from '@/components/app/plan-billing';

const QUOTA_ORDER = [
  'events',
  'guestsPerEvent',
  'members',
  'storageMb',
  'emailsPerMonth',
  'smsPerMonth',
  'aiCreditsPerMonth',
] as const;

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
  const canManage = ctx.isSuperAdmin || (ctx.role !== null && can(ctx.role, 'billing:manage'));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('subtitle', { org: org.name })}
        </p>
      </div>

      {/* Abonnements, factures, plans (démo) */}
      <PlanBillingClient orgCurrency={org.currency} locale={locale} canManage={canManage} />

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
    </div>
  );
}
