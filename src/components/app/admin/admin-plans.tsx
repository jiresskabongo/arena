'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Pill } from './admin-shared';
import { Loader2, Pencil, Plus, Archive } from 'lucide-react';

interface PlanPrice { id?: string; currency: string; amountMinor: number; interval: string }
interface PlanRow {
  id: string;
  code: string;
  name: string;
  description: string;
  trialDays: number;
  limits: Record<string, number>;
  features: Record<string, boolean>;
  isActive: boolean;
  isArchived: boolean;
  prices: PlanPrice[];
}

const LIMIT_KEYS = ['events', 'guestsPerEvent', 'collaborators', 'storageMb', 'emailsPerMonth', 'smsPerMonth', 'aiCreditsPerMonth'] as const;
const FEATURE_KEYS = ['premiumTemplates', 'communications', 'advancedStats', 'team', 'whiteLabel'] as const;

interface Draft {
  code: string;
  name: string;
  description: string;
  trialDays: string;
  limits: Record<string, string>;
  features: Record<string, boolean>;
  prices: { currency: string; monthly: string; yearly: string }[];
}

function emptyDraft(): Draft {
  return {
    code: '', name: '', description: '', trialDays: '7',
    limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, ''])),
    features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])),
    prices: ['USD', 'EUR', 'CDF'].map((c) => ({ currency: c, monthly: '', yearly: '' })),
  };
}

function toDraft(p: PlanRow): Draft {
  const priceOf = (currency: string, interval: string) => {
    const row = p.prices.find((x) => x.currency === currency && x.interval === interval);
    return row ? String(row.amountMinor) : '';
  };
  return {
    code: p.code, name: p.name, description: p.description, trialDays: String(p.trialDays),
    limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, p.limits[k] !== undefined ? String(p.limits[k]) : ''])),
    features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, Boolean(p.features[k])])),
    prices: ['USD', 'EUR', 'CDF'].map((c) => ({ currency: c, monthly: priceOf(c, 'monthly'), yearly: priceOf(c, 'yearly') })),
  };
}

export function PlansAdmin() {
  const t = useTranslations('admin');
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch<{ plans: PlanRow[] }>('/api/admin/plans?all=1');
    if (res.ok && res.data) { setPlans(res.data.plans); setError(false); }
    else setError(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  function openCreate() {
    setEditing(emptyDraft());
    setIsNew(true);
    setEditErr(null);
  }
  function openEdit(p: PlanRow) {
    setEditing(toDraft(p));
    setIsNew(false);
    setEditErr(null);
  }

  async function save() {
    if (!editing) return;
    if (editing.name.trim().length < 2) { setEditErr(t('plans.nameRequired')); return; }
    if (isNew && !/^[a-z0-9_]{2,30}$/.test(editing.code)) { setEditErr(t('plans.codeRequired')); return; }
    setBusy(true);
    setEditErr(null);
    const limits: Record<string, number> = {};
    for (const [k, v] of Object.entries(editing.limits)) {
      if (v !== '') {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0) { setBusy(false); setEditErr(t('plans.invalidLimits')); return; }
        limits[k] = n;
      }
    }
    const prices: PlanPrice[] = [];
    for (const p of editing.prices) {
      for (const [interval, raw] of [['monthly', p.monthly], ['yearly', p.yearly]] as const) {
        if (raw === '') continue;
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0) { setBusy(false); setEditErr(t('plans.invalidPrices')); return; }
        prices.push({ currency: p.currency, amountMinor: n, interval });
      }
    }
    const body = {
      code: editing.code,
      name: editing.name.trim(),
      description: editing.description.trim(),
      trialDays: Number(editing.trialDays) || 0,
      limits, features: editing.features, prices,
    };
    const res = await apiFetch<{ plan: PlanRow }>(isNew ? '/api/admin/plans' : `/api/admin/plans/${editing.code === '' ? '' : plans?.find((x) => x.name === editing.name && x.code === editing.code)?.id ?? ''}`, {
      method: isNew ? 'POST' : 'PUT',
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) { setEditErr(res.error?.message ?? t('loadError')); return; }
    setEditing(null);
    await load();
  }

  async function archive(p: PlanRow) {
    if (!confirm(t('plans.archiveConfirm', { name: p.name }))) return;
    setBusy(true);
    const res = await apiFetch(`/api/admin/plans/${p.id}/archive`, { method: 'POST' });
    setBusy(false);
    if (res.ok) await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{t('plans.hint')}</p>
        <Button size="sm" onClick={openCreate} className="gap-1.5">
          <Plus className="size-4" /> {t('plans.new')}
        </Button>
      </div>

      {error ? (
        <Card><CardContent className="pt-6 text-sm text-destructive">{t('loadError')}</CardContent></Card>
      ) : !plans ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {plans.map((p) => (
            <Card key={p.id} className={p.isArchived ? 'opacity-60' : ''}>
              <CardContent className="space-y-3 pt-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{p.name}</h3>
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{p.code}</span>
                      {p.isArchived && <Pill tone="red">{t('plans.archived')}</Pill>}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(p)} title={t('edit')}>
                      <Pencil className="size-3.5" />
                    </Button>
                    {!p.isArchived && (
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void archive(p)} title={t('plans.archive')}>
                        <Archive className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{t('plans.trial', { days: p.trialDays })}</p>
                <div className="flex flex-wrap gap-1.5">
                  {LIMIT_KEYS.map((k) => p.limits[k] !== undefined && (
                    <span key={k} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                      {t(`plans.limit.${k}` as never)}: <span className="font-medium text-foreground">{p.limits[k] === 0 ? t('plans.unlimited') : p.limits[k]}</span>
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {p.prices.map((pr) => (
                    <span key={`${pr.currency}-${pr.interval}`} className="tabular-nums text-muted-foreground">
                      {pr.currency}: {(pr.amountMinor / 100).toLocaleString()} {pr.interval === 'yearly' ? t('plans.yearly') : t('plans.monthly')}
                    </span>
                  ))}
                  {p.prices.length === 0 && <span className="text-muted-foreground">—</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog édition/création */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-10"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="w-full max-w-2xl rounded-xl border bg-background p-6 shadow-lg">
            <h2 className="text-lg font-semibold">{isNew ? t('plans.new') : `${t('edit')} — ${editing.name}`}</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {isNew && (
                <div className="space-y-1.5">
                  <Label htmlFor="pl-code">{t('plans.code')}</Label>
                  <Input id="pl-code" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.toLowerCase() })} placeholder="premium" pattern="[a-z0-9_]+" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="pl-name">{t('plans.name')}</Label>
                <Input id="pl-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={60} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pl-trial">{t('plans.trialDays')}</Label>
                <Input id="pl-trial" type="number" min={0} max={90} value={editing.trialDays} onChange={(e) => setEditing({ ...editing, trialDays: e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="pl-desc">{t('plans.description')}</Label>
                <Input id="pl-desc" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} maxLength={300} />
              </div>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-sm font-medium">{t('plans.limits')}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {LIMIT_KEYS.map((k) => (
                  <div key={k} className="space-y-1">
                    <Label htmlFor={`lim-${k}`} className="text-xs text-muted-foreground">{t(`plans.limit.${k}` as never)}</Label>
                    <Input
                      id={`lim-${k}`} type="number" min={0}
                      value={editing.limits[k] ?? ''}
                      onChange={(e) => setEditing({ ...editing, limits: { ...editing.limits, [k]: e.target.value } })}
                    />
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{t('plans.limitHint')}</p>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-sm font-medium">{t('plans.features')}</p>
              <div className="flex flex-wrap gap-3">
                {FEATURE_KEYS.map((k) => (
                  <label key={k} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={editing.features[k] ?? false}
                      onChange={(e) => setEditing({ ...editing, features: { ...editing.features, [k]: e.target.checked } })}
                    />
                    {t(`plans.feature.${k}` as never)}
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-sm font-medium">{t('plans.prices')}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {editing.prices.map((p, i) => (
                  <div key={p.currency} className="space-y-1 rounded-lg border p-3">
                    <p className="text-xs font-semibold">{p.currency}</p>
                    <Input
                      type="number" min={0} placeholder="monthly"
                      value={p.monthly}
                      onChange={(e) => {
                        const prices = [...editing.prices];
                        prices[i] = { ...prices[i], monthly: e.target.value };
                        setEditing({ ...editing, prices });
                      }}
                    />
                    <Input
                      type="number" min={0} placeholder="yearly"
                      value={p.yearly}
                      onChange={(e) => {
                        const prices = [...editing.prices];
                        prices[i] = { ...prices[i], yearly: e.target.value };
                        setEditing({ ...editing, prices });
                      }}
                    />
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{t('plans.priceHint')}</p>
            </div>

            {editErr && <p className="mt-3 text-sm text-destructive">{editErr}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>{t('cancel')}</Button>
              <Button onClick={() => void save()} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                {t('save')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
