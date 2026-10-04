'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { AdminPagination, LoadingRows, EmptyRow, ErrorRow, Pill, statusTone } from './admin-shared';

interface AdminSub {
  id: string;
  status: string;
  trialEndsAt: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  organization: { id: string; name: string; slug: string; isActive: boolean };
  plan: { code: string; name: string };
  _count: { payments: number };
}

interface List { items: AdminSub[]; total: number; page: number; pageSize: number; totalPages: number }

const STATUS_FILTERS = ['all', 'trialing', 'active', 'past_due', 'canceled', 'expired'] as const;

export function SubscriptionsAdmin() {
  const t = useTranslations('admin');
  const [status, setStatus] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<List | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (status !== 'all') qs.set('status', status);
    const res = await apiFetch<List>(`/api/admin/subscriptions?${qs}`);
    setLoading(false);
    if (res.ok && res.data) { setData(res.data); setError(false); }
    else setError(true);
  }, [page, status]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { setStatus(s); setPage(1); }}
            className={`rounded-full px-3 py-1 text-xs transition ${
              status === s ? 'bg-primary font-medium text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {s === 'all' ? t('subs.all') : s}
          </button>
        ))}
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">{t('subs.colOrg')}</th>
                <th className="px-3 py-2.5 font-medium">{t('subs.colPlan')}</th>
                <th className="px-3 py-2.5 font-medium">{t('subs.colStatus')}</th>
                <th className="px-3 py-2.5 font-medium">{t('subs.colPeriod')}</th>
                <th className="px-3 py-2.5 font-medium">{t('subs.colPayments')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && <LoadingRows cols={5} />}
              {!loading && error && <ErrorRow cols={5} label={t('loadError')} />}
              {!loading && !error && data && data.items.length === 0 && (
                <EmptyRow cols={5} label={t('subs.empty')} />
              )}
              {!loading && !error && data?.items.map((s) => (
                <tr key={s.id} className="border-b last:border-0">
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{s.organization.name}</p>
                    <p className="text-xs text-muted-foreground">/{s.organization.slug}</p>
                  </td>
                  <td className="px-3 py-2.5">{s.plan.name}</td>
                  <td className="px-3 py-2.5">
                    <Pill tone={statusTone(s.status)}>{s.status}</Pill>
                    {s.cancelAtPeriodEnd && <Pill tone="amber">{t('subs.cancelAtPeriodEnd')}</Pill>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {new Date(s.currentPeriodStart).toLocaleDateString()} → {new Date(s.currentPeriodEnd).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{s._count.payments}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {data && <AdminPagination page={data.page} totalPages={data.totalPages} onPage={setPage} />}
    </div>
  );
}
