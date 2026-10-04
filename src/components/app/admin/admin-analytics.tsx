'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';

interface Analytics {
  months: string[];
  newOrganizations: number[];
  newUsers: number[];
  revenueByMonth: { label: string; invoices: Record<string, number>; payments: Record<string, number> }[];
  eventsByType: { type: string; count: number }[];
  designsByType: { type: string; count: number }[];
  subscriptionsByPlan: { plan: string; count: number }[];
  topOrganizations: { organization: string; paidMinor: number }[];
  aiCreditsByMonth: number[];
}

function money(minor: number) {
  return minor.toLocaleString();
}

export function AnalyticsAdmin() {
  const t = useTranslations('admin');
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await apiFetch<{ analytics: Analytics }>('/api/admin/analytics');
      if (!alive) return;
      if (res.ok && res.data) setData(res.data.analytics);
      else setError(true);
    })();
    return () => { alive = false; };
  }, []);

  if (error) {
    return (
      <Card><CardContent className="pt-6 text-sm text-destructive">{t('loadError')}</CardContent></Card>
    );
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-64" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      </div>
    );
  }

  const growth = data.months.map((m, i) => ({
    label: m,
    organisations: data.newOrganizations[i],
    utilisateurs: data.newUsers[i],
  }));
  const ai = data.months.map((m, i) => ({ label: m, credits: data.aiCreditsByMonth[i] }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-5">
            <h3 className="mb-3 text-sm font-semibold">{t('analytics.growth')}</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={growth}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis allowDecimals={false} fontSize={11} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="organisations" fill="#6366f1" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="utilisateurs" fill="#22c55e" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <h3 className="mb-3 text-sm font-semibold">{t('analytics.aiCredits')}</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ai}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis allowDecimals={false} fontSize={11} />
                  <Tooltip />
                  <Bar dataKey="credits" fill="#a855f7" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-5">
          <h3 className="mb-3 text-sm font-semibold">{t('analytics.revenue')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-2 py-2 font-medium">{t('analytics.month')}</th>
                  <th className="px-2 py-2 font-medium">{t('analytics.invoices')}</th>
                  <th className="px-2 py-2 font-medium">{t('analytics.payments')}</th>
                </tr>
              </thead>
              <tbody>
                {data.revenueByMonth.map((r) => (
                  <tr key={r.label} className="border-b last:border-0">
                    <td className="px-2 py-2 font-medium">{r.label}</td>
                    <td className="px-2 py-2 tabular-nums">
                      {Object.entries(r.invoices).map(([c, v]) => <span key={c}>{c}: {money(v / 100)} {c === 'CDF' ? '' : '$'} </span>) || '—'}
                    </td>
                    <td className="px-2 py-2 tabular-nums">
                      {Object.entries(r.payments).map(([c, v]) => <span key={c}>{c}: {money(v / 100)} {c === 'CDF' ? '' : '$'} </span>) || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardContent className="pt-5">
            <h3 className="mb-2 text-sm font-semibold">{t('analytics.eventsByType')}</h3>
            <ul className="space-y-1 text-sm">
              {data.eventsByType.length === 0 && <li className="text-xs text-muted-foreground">—</li>}
              {data.eventsByType.map((e) => (
                <li key={e.type} className="flex items-center justify-between">
                  <span>{e.type}</span>
                  <span className="tabular-nums text-muted-foreground">{e.count}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <h3 className="mb-2 text-sm font-semibold">{t('analytics.subsByPlan')}</h3>
            <ul className="space-y-1 text-sm">
              {data.subscriptionsByPlan.length === 0 && <li className="text-xs text-muted-foreground">—</li>}
              {data.subscriptionsByPlan.map((s) => (
                <li key={s.plan} className="flex items-center justify-between">
                  <span>{s.plan}</span>
                  <span className="tabular-nums text-muted-foreground">{s.count}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <h3 className="mb-2 text-sm font-semibold">{t('analytics.topOrgs')}</h3>
            <ul className="space-y-1 text-sm">
              {data.topOrganizations.length === 0 && <li className="text-xs text-muted-foreground">—</li>}
              {data.topOrganizations.map((o) => (
                <li key={o.organization} className="flex items-center justify-between gap-2">
                  <span className="truncate">{o.organization}</span>
                  <span className="whitespace-nowrap tabular-nums text-muted-foreground">{money(o.paidMinor / 100)} $</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
