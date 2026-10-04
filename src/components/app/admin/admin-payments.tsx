'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { AdminPagination, LoadingRows, EmptyRow, ErrorRow, Pill, statusTone } from './admin-shared';

interface AdminPayment {
  id: string;
  provider: string;
  providerPaymentId: string | null;
  amountMinor: number;
  currency: string;
  status: string;
  description: string | null;
  createdAt: string;
  organization: { id: string; name: string };
}

interface List { items: AdminPayment[]; total: number; page: number; pageSize: number; totalPages: number }

const STATUS_FILTERS = ['all', 'pending', 'succeeded', 'failed', 'refunded'] as const;

function fmtMoney(minor: number, currency: string) {
  if (currency === 'CDF') return `${minor.toLocaleString()} CDF`;
  return `${(minor / 100).toLocaleString()} ${currency}`;
}

export function PaymentsAdmin() {
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
    const res = await apiFetch<List>(`/api/admin/payments?${qs}`);
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
            {s === 'all' ? t('payments.all') : s}
          </button>
        ))}
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">{t('payments.colDate')}</th>
                <th className="px-3 py-2.5 font-medium">{t('payments.colOrg')}</th>
                <th className="px-3 py-2.5 font-medium">{t('payments.colAmount')}</th>
                <th className="px-3 py-2.5 font-medium">{t('payments.colProvider')}</th>
                <th className="px-3 py-2.5 font-medium">{t('payments.colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && <LoadingRows cols={5} />}
              {!loading && error && <ErrorRow cols={5} label={t('loadError')} />}
              {!loading && !error && data && data.items.length === 0 && (
                <EmptyRow cols={5} label={t('payments.empty')} />
              )}
              {!loading && !error && data?.items.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {new Date(p.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 font-medium">{p.organization.name}</td>
                  <td className="px-3 py-2.5 tabular-nums">{fmtMoney(p.amountMinor, p.currency)}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{p.provider}</td>
                  <td className="px-3 py-2.5">
                    <Pill tone={statusTone(p.status)}>{p.status}</Pill>
                  </td>
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
