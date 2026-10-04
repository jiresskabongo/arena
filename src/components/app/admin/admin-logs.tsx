'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { AdminPagination, LoadingRows, EmptyRow, ErrorRow } from './admin-shared';

interface LogRow {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  ip: string | null;
  createdAt: string;
  user: { email: string } | null;
  organization: { name: string } | null;
}

interface List { items: LogRow[]; total: number; page: number; pageSize: number; totalPages: number }

export function LogsAdmin() {
  const t = useTranslations('admin');
  const [action, setAction] = useState('');
  const [orgSearch, setOrgSearch] = useState('');
  const [from, setFrom] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<List | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ page: String(page), pageSize: '30' });
    if (action.trim()) qs.set('action', action.trim());
    if (orgSearch.trim()) qs.set('orgId', orgSearch.trim());
    if (from) qs.set('from', `${from}T00:00:00`);
    const res = await apiFetch<List>(`/api/admin/logs?${qs}`);
    setLoading(false);
    if (res.ok && res.data) { setData(res.data); setError(false); }
    else setError(true);
  }, [page, action, orgSearch, from]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">{t('logs.colAction')}</label>
          <Input value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} placeholder="admin.plan.update" className="w-52" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">{t('logs.org')}</label>
          <Input value={orgSearch} onChange={(e) => { setOrgSearch(e.target.value); setPage(1); }} placeholder={t('logs.orgPlaceholder')} className="w-52" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">{t('logs.from')}</label>
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="w-40" />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">{t('logs.colDate')}</th>
                <th className="px-3 py-2.5 font-medium">{t('logs.colAction')}</th>
                <th className="px-3 py-2.5 font-medium">{t('logs.colUser')}</th>
                <th className="px-3 py-2.5 font-medium">{t('logs.colOrg')}</th>
                <th className="px-3 py-2.5 font-medium">{t('logs.colIp')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && <LoadingRows cols={5} />}
              {!loading && error && <ErrorRow cols={5} label={t('loadError')} />}
              {!loading && !error && data && data.items.length === 0 && (
                <EmptyRow cols={5} label={t('logs.empty')} />
              )}
              {!loading && !error && data?.items.map((l) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                    {new Date(l.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{l.action}</code>
                    {l.entity && <span className="ml-1.5 text-[11px] text-muted-foreground">{l.entity}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{l.user?.email ?? '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{l.organization?.name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{l.ip ?? '—'}</td>
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
