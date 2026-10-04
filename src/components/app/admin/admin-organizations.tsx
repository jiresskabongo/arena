'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SearchBox, AdminPagination, LoadingRows, EmptyRow, ErrorRow, Pill, statusTone } from './admin-shared';

interface AdminOrg {
  id: string;
  name: string;
  slug: string;
  currency: string;
  locale: string;
  isActive: boolean;
  createdAt: string;
  subscription: { status: string; plan: { code: string; name: string } } | null;
  _count: { members: number; events: number; designs: number };
}

interface List { items: AdminOrg[]; total: number; page: number; pageSize: number; totalPages: number }

export function OrganizationsAdmin() {
  const t = useTranslations('admin');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<List | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => { setDebounced(search); setPage(1); }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch<List>(`/api/admin/organizations?page=${page}&search=${encodeURIComponent(debounced)}`);
    setLoading(false);
    if (res.ok && res.data) { setData(res.data); setError(false); }
    else setError(true);
  }, [page, debounced]);

  useEffect(() => { void load(); }, [load]);

  async function toggleActive(o: AdminOrg) {
    setBusyId(o.id);
    const res = await apiFetch(`/api/admin/organizations/${o.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !o.isActive }),
    });
    setBusyId(null);
    setFlash(res.ok ? t('orgs.saved') : (res.error?.message ?? t('loadError')));
    if (res.ok) void load();
  }

  async function removeOrg(o: AdminOrg) {
    if (!confirm(`${t('orgs.deleteConfirm')} (${o.name})`)) return;
    setBusyId(o.id);
    const res = await apiFetch(`/api/admin/organizations/${o.id}`, { method: 'DELETE' });
    setBusyId(null);
    setFlash(res.ok ? t('orgs.deleted') : (res.error?.message ?? t('loadError')));
    if (res.ok) void load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchBox value={search} onChange={setSearch} placeholder={t('orgs.searchPlaceholder')} />
        {flash && <p className="text-xs text-muted-foreground">{flash}</p>}
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">{t('orgs.colOrg')}</th>
                <th className="px-3 py-2.5 font-medium">{t('orgs.colPlan')}</th>
                <th className="px-3 py-2.5 font-medium">{t('orgs.colCounts')}</th>
                <th className="px-3 py-2.5 font-medium">{t('orgs.colState')}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && <LoadingRows cols={5} />}
              {!loading && error && <ErrorRow cols={5} label={t('loadError')} />}
              {!loading && !error && data && data.items.length === 0 && (
                <EmptyRow cols={5} label={t('orgs.empty')} />
              )}
              {!loading && !error && data?.items.map((o) => (
                <tr key={o.id} className="border-b last:border-0">
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{o.name}</p>
                    <p className="text-xs text-muted-foreground">/{o.slug} · {o.currency}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    {o.subscription ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span>{o.subscription.plan.name}</span>
                        <Pill tone={statusTone(o.subscription.status)}>{o.subscription.status}</Pill>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {t('orgs.counts', { members: o._count.members, events: o._count.events, designs: o._count.designs })}
                  </td>
                  <td className="px-3 py-2.5">
                    <Pill tone={o.isActive ? 'green' : 'red'}>{o.isActive ? t('orgs.active') : t('orgs.inactive')}</Pill>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      <Button variant="outline" size="sm" disabled={busyId === o.id} onClick={() => void toggleActive(o)}>
                        {o.isActive ? t('orgs.deactivate') : t('orgs.activate')}
                      </Button>
                      <Button
                        variant="ghost" size="sm" disabled={busyId === o.id}
                        className="text-destructive hover:text-destructive"
                        onClick={() => void removeOrg(o)}
                      >
                        {t('delete')}
                      </Button>
                    </div>
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
