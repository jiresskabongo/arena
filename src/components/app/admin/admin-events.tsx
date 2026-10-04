'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SearchBox, AdminPagination, LoadingRows, EmptyRow, ErrorRow, Pill, statusTone } from './admin-shared';

interface AdminEvent {
  id: string;
  name: string;
  date: string;
  status: string;
  organization: { id: string; name: string };
  _count: { guests: number; checkIns: number };
}

interface List { items: AdminEvent[]; total: number; page: number; pageSize: number; totalPages: number }

export function EventsAdmin() {
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
    const res = await apiFetch<List>(`/api/admin/events?page=${page}&search=${encodeURIComponent(debounced)}`);
    setLoading(false);
    if (res.ok && res.data) { setData(res.data); setError(false); }
    else setError(true);
  }, [page, debounced]);

  useEffect(() => { void load(); }, [load]);

  async function setStatus(e: AdminEvent, status: string) {
    setBusyId(e.id);
    const res = await apiFetch(`/api/admin/events/${e.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setBusyId(null);
    setFlash(res.ok ? t('events.saved') : (res.error?.message ?? t('loadError')));
    if (res.ok) void load();
  }

  async function removeEvent(e: AdminEvent) {
    if (!confirm(`${t('events.deleteConfirm')} (${e.name})`)) return;
    setBusyId(e.id);
    const res = await apiFetch(`/api/admin/events/${e.id}`, { method: 'DELETE' });
    setBusyId(null);
    setFlash(res.ok ? t('events.deleted') : (res.error?.message ?? t('loadError')));
    if (res.ok) void load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchBox value={search} onChange={setSearch} placeholder={t('events.searchPlaceholder')} />
        {flash && <p className="text-xs text-muted-foreground">{flash}</p>}
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">{t('events.colEvent')}</th>
                <th className="px-3 py-2.5 font-medium">{t('events.colOrg')}</th>
                <th className="px-3 py-2.5 font-medium">{t('events.colDate')}</th>
                <th className="px-3 py-2.5 font-medium">{t('events.colCounts')}</th>
                <th className="px-3 py-2.5 font-medium">{t('events.colStatus')}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && <LoadingRows cols={6} />}
              {!loading && error && <ErrorRow cols={6} label={t('loadError')} />}
              {!loading && !error && data && data.items.length === 0 && (
                <EmptyRow cols={6} label={t('events.empty')} />
              )}
              {!loading && !error && data?.items.map((e) => (
                <tr key={e.id} className="border-b last:border-0">
                  <td className="px-3 py-2.5 font-medium">{e.name}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{e.organization.name}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {new Date(e.date).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {t('events.counts', { guests: e._count.guests, checkins: e._count.checkIns })}
                  </td>
                  <td className="px-3 py-2.5">
                    <Pill tone={statusTone(e.status)}>{e.status}</Pill>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      {e.status !== 'published' && (
                        <Button variant="outline" size="sm" disabled={busyId === e.id} onClick={() => void setStatus(e, 'published')}>
                          {t('events.publish')}
                        </Button>
                      )}
                      {e.status !== 'archived' && (
                        <Button variant="outline" size="sm" disabled={busyId === e.id} onClick={() => void setStatus(e, 'archived')}>
                          {t('events.archive')}
                        </Button>
                      )}
                      <Button
                        variant="ghost" size="sm" disabled={busyId === e.id}
                        className="text-destructive hover:text-destructive"
                        onClick={() => void removeEvent(e)}
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
