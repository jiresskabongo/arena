'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  AlertTriangle, Check, CreditCard, FlaskConical, Hourglass, Loader2,
  ReceiptText, Sparkles, X,
} from 'lucide-react';

interface PlanPrice { currency: string; amountMinor: number; interval: string }
interface PlanRow {
  code: string; name: string; description: string; trialDays: number;
  limits: Record<string, number>; features: Record<string, boolean>;
  prices: PlanPrice[];
}
interface InvoiceRow {
  id: string; number: string; amountMinor: number; currency: string;
  status: string; planName: string | null; issuedAt: string;
}
interface SubView {
  status: string;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  inTrial: boolean;
  trialExpired: boolean;
  daysLeft: number;
  plan: PlanRow & { id: string };
}

function money(minor: number, currency: string, locale: string): string {
  const value = currency === 'CDF' ? minor : minor / 100; // CDF : pas de centimes
  return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'fr-FR', {
    style: 'currency',
    currency,
    minimumFractionDigits: currency === 'CDF' ? 0 : 2,
    maximumFractionDigits: currency === 'CDF' ? 0 : 2,
  }).format(value);
}

export function PlanBillingClient({
  orgCurrency, locale, canManage,
}: {
  orgCurrency: string;
  locale: string;
  canManage: boolean;
}) {
  const t = useTranslations('app.plan');
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [sub, setSub] = useState<SubView | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [interval, setIntervalMode] = useState<'monthly' | 'yearly'>('monthly');
  const [currency, setCurrency] = useState(orgCurrency);
  const [checkoutPlan, setCheckoutPlan] = useState<PlanRow | null>(null);
  const [paying, setPaying] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([
      apiFetch<{ plans: PlanRow[] }>('/api/organization/plans'),
      apiFetch<{ subscription: SubView | null; invoices: { items: InvoiceRow[] } }>('/api/billing/subscription'),
    ]);
    if (p.ok && p.data) setPlans(p.data.plans);
    if (s.ok && s.data) {
      setSub(s.data.subscription);
      setInvoices(s.data.invoices.items);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function doCheckout(plan: PlanRow) {
    setCheckoutPlan(null);
    setPaying(true);
    const co = await apiFetch<{ checkout: { paymentId: string } }>('/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ planCode: plan.code, interval, currency }),
    });
    if (!co.ok || !co.data) {
      setPaying(false);
      toast.error(co.error?.message ?? t('error'));
      return;
    }
    const conf = await apiFetch(`/api/billing/checkout/${co.data.checkout.paymentId}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ result: 'succeeded' }),
    });
    setPaying(false);
    if (conf.ok) {
      toast.success(t('paymentOk', { plan: plan.name }));
      await load();
    } else {
      toast.error(conf.error?.message ?? t('error'));
    }
  }

  async function toggleCancel() {
    setCanceling(true);
    const res = await apiFetch(
      sub?.cancelAtPeriodEnd ? '/api/billing/reactivate' : '/api/billing/cancel',
      { method: 'POST' },
    );
    setCanceling(false);
    if (res.ok) {
      toast.success(sub?.cancelAtPeriodEnd ? t('reactivated') : t('cancelScheduled'));
      await load();
    } else {
      toast.error(res.error?.message ?? t('error'));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
        {t('loading')}
      </div>
    );
  }

  const dFmt = (iso: string) => new Date(iso).toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR');

  return (
    <div className="space-y-8">
      {/* État de l'abonnement */}
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <CreditCard className="size-5" aria-hidden />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-lg font-semibold leading-tight">{sub?.plan?.name ?? t('noSubscription')}</p>
                {sub?.inTrial && !sub.trialExpired && <Badge variant="warning">{t('trialBadge')}</Badge>}
                {sub && !sub.inTrial && !sub.trialExpired && <Badge variant="secondary">{t('activeBadge')}</Badge>}
                {sub?.trialExpired && <Badge variant="danger">{t('expiredBadge')}</Badge>}
                {sub?.cancelAtPeriodEnd && !sub.inTrial && <Badge variant="danger">{t('cancelingBadge')}</Badge>}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {sub?.inTrial
                  ? sub.trialExpired
                    ? t('trialOverBody')
                    : t('trialBody', { days: sub.daysLeft, until: dFmt(sub.trialEndsAt!) })
                  : t('currentBody', { plan: sub?.plan?.name ?? '—' })}
              </p>
              {sub?.cancelAtPeriodEnd && !sub.inTrial && (
                <p className="mt-1 flex items-center gap-1 text-xs text-warning">
                  <Hourglass className="size-3.5" aria-hidden />
                  {t('cancelingBody')}
                </p>
              )}
            </div>
          </div>
          {canManage && sub && !sub.inTrial && (
            <Button
              variant={sub.cancelAtPeriodEnd ? 'default' : 'outline'}
              onClick={toggleCancel}
              disabled={canceling}
              className="gap-2"
            >
              {canceling && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {sub.cancelAtPeriodEnd ? t('reactivate') : t('cancelPlan')}
            </Button>
          )}
          {sub?.inTrial && (
            <p className="text-xs text-muted-foreground">{t('trialPickHint')}</p>
          )}
        </CardContent>
      </Card>

      {/* Factures */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ReceiptText className="size-4" aria-hidden />
              {t('invoicesTitle')}
              <Badge variant="outline" className="gap-1 text-amber-600">
                <FlaskConical className="size-3" aria-hidden />
                {t('demoBadge')}
              </Badge>
            </h2>
          </div>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('invoicesEmpty')}</p>
          ) : (
            <div className="divide-y">
              {invoices.map((inv) => (
                <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p className="text-sm font-medium">{inv.number}</p>
                    <p className="text-xs text-muted-foreground">
                      {dFmt(inv.issuedAt)} · {inv.planName ?? '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm tabular-nums">{money(inv.amountMinor, inv.currency, locale)}</span>
                    <Badge variant={inv.status === 'paid' ? 'secondary' : 'outline'}>
                      {inv.status === 'paid' ? t('invoicePaid') : inv.status}
                    </Badge>
                    <a
                      href={`/api/billing/invoices/${inv.id}/pdf`}
                      className="text-xs font-medium text-primary hover:underline"
                      download
                    >
                      PDF
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Plans */}
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight">{t('plansTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('plansBody', { org_currency: currency })}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(['USD', 'CDF', 'EUR'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCurrency(c)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                currency === c ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {c}
            </button>
          ))}
          <div className="ml-2 flex rounded-lg border p-0.5 text-xs">
            {(['monthly', 'yearly'] as const).map((iv) => (
              <button
                key={iv}
                type="button"
                onClick={() => setIntervalMode(iv)}
                className={`rounded-md px-2.5 py-1 font-medium ${interval === iv ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}
              >
                {iv === 'monthly' ? t('perMonthShort') : t('perYearShort')}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {plans.map((p) => {
            const current = sub?.plan?.code === p.code;
            const price = p.prices.find((x) => x.currency === currency && x.interval === interval);
            const free = p.code === 'starter';
            return (
              <Card key={p.code} className={current ? 'border-primary/60' : undefined}>
                <CardContent className="space-y-4 pt-6">
                  <div className="flex items-center justify-between">
                    <p className="text-base font-semibold">{p.name}</p>
                    {current && <Badge variant="secondary">{t('currentPlan')}</Badge>}
                    {!current && p.code === 'pro' && (
                      <Badge variant="outline" className="gap-1">
                        <Sparkles className="size-3" aria-hidden />
                        {t('recommended')}
                      </Badge>
                    )}
                  </div>
                  <p className="min-h-8 text-xs text-muted-foreground">{p.description}</p>
                  <div>
                    {free ? (
                      <span className="text-2xl font-semibold">{t('free')}</span>
                    ) : price ? (
                      <>
                        <span className="text-2xl font-semibold">{money(price.amountMinor, currency, locale)}</span>
                        <span className="text-sm text-muted-foreground"> / {interval === 'monthly' ? t('perMonth') : t('perYearSuffix')}</span>
                      </>
                    ) : (
                      <span className="text-sm text-muted-foreground">{t('priceUnavailable')}</span>
                    )}
                  </div>
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
                    <li>{t('limit.events')}: <span className="font-medium text-foreground">{p.limits.events ?? '—'}</span></li>
                    <li>{t('limit.guestsPerEvent')}: <span className="font-medium text-foreground">{p.limits.guestsPerEvent ?? '—'}</span></li>
                    <li>{t('limit.collaborators')}: <span className="font-medium text-foreground">{p.limits.collaborators ?? '—'}</span></li>
                  </ul>
                  {free ? (
                    <p className="text-center text-xs text-muted-foreground">{t('starterNote')}</p>
                  ) : current ? (
                    <Button variant="outline" className="w-full" disabled>{t('currentPlan')}</Button>
                  ) : (
                    <Button className="w-full gap-2" disabled={!canManage || paying} onClick={() => setCheckoutPlan(p)}>
                      {canManage ? t('subscribe') : t('contactOwner')}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Modal checkout démo */}
      {checkoutPlan && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => !paying && setCheckoutPlan(null)}
        >
          <div className="w-full max-w-md rounded-2xl border bg-background p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-display text-lg font-semibold">{t('checkoutTitle')}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {checkoutPlan.name} · {interval === 'monthly' ? t('perMonth') : t('perYearSuffix')} · {currency}
                </p>
              </div>
              {!paying && (
                <button type="button" onClick={() => setCheckoutPlan(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="size-5" aria-hidden />
                </button>
              )}
            </div>

            <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                <FlaskConical className="size-3.5" aria-hidden />
                {t('demoPaymentTitle')}
              </p>
              <p className="mt-1 text-xs text-amber-700/80">{t('demoPaymentBody')}</p>
              <div className="mt-3 space-y-2">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">{t('mockCard')}</label>
                  <input readOnly value="4242 4242 4242 4242" className="h-9 w-full rounded-md border bg-muted/40 px-3 text-sm tabular-nums" />
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
              <span>{t('totalDue')}</span>
              <span className="font-semibold tabular-nums">
                {(() => {
                  const pr = checkoutPlan.prices.find((x) => x.currency === currency && x.interval === interval);
                  return pr ? money(pr.amountMinor, currency, locale) : '—';
                })()}
              </span>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCheckoutPlan(null)} disabled={paying}>{t('cancel')}</Button>
              <Button onClick={() => void doCheckout(checkoutPlan)} disabled={paying} className="gap-2">
                {paying ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CreditCard className="size-4" aria-hidden />}
                {paying ? t('paying') : t('payMock')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Erreur générique (jamais de page muette) */}
      {!loading && plans.length === 0 && (
        <Card>
          <CardContent className="flex items-center gap-2 pt-6 text-sm text-destructive">
            <AlertTriangle className="size-4" aria-hidden />
            {t('error')}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
