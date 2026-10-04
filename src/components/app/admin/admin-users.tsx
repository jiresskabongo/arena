'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SearchBox, AdminPagination, LoadingRows, EmptyRow, ErrorRow, Pill } from './admin-shared';

interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isSuperAdmin: boolean;
  createdAt: string;
  memberships: { role: string; organization: { id: string; name: string; isActive: boolean } }[];
}

interface List {
  items: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function UsersAdmin() {
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
    const res = await apiFetch<List>(`/api/admin/users?page=${page}&search=${encodeURIComponent(debounced)}`);
    setLoading(false);
    if (res.ok && res.data) { setData(res.data); setError(false); }
    else setError(true);
  }, [page, debounced]);

  useEffect(() => { void load(); }, [load]);

  async function toggleSuperAdmin(u: AdminUser) {
    if (!confirm(`${u.isSuperAdmin ? t('users.revokeConfirm') : t('users.grantConfirm')} (${u.email})`)) return;
    setBusyId(u.id);
    const res = await apiFetch(`/api/admin/users/${u.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isSuperAdmin: !u.isSuperAdmin }),
    });
    setBusyId(null);
    setFlash(res.ok ? t('users.saved') : (res.error?.message ?? t('loadError')));
    if (res.ok) void load();
  }

  async function removeUser(u: AdminUser) {
    if (!confirm(`${t('users.deleteConfirm')} (${u.email})`)) return;
    setBusyId(u.id);
    const res = await apiFetch(`/api/admin/users/${u.id}`, { method: 'DELETE' });
    setBusyId(null);
    setFlash(res.ok ? t('users.deleted') : (res.error?.message ?? t('loadError')));
    if (res.ok) void load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchBox value={search} onChange={setSearch} placeholder={t('users.searchPlaceholder')} />
        {flash && <p className="text-xs text-muted-foreground">{flash}</p>}
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">{t('users.colUser')}</th>
                <th className="px-3 py-2.5 font-medium">{t('users.colOrgs')}</th>
                <th className="px-3 py-2.5 font-medium">{t('users.colRolePlatform')}</th>
                <th className="px-3 py-2.5 font-medium">{t('users.colCreated')}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && <LoadingRows cols={5} />}
              {!loading && error && <ErrorRow cols={5} label={t('loadError')} />}
              {!loading && !error && data && data.items.length === 0 && (
                <EmptyRow cols={5} label={t('users.empty')} />
              )}
              {!loading && !error && data?.items.map((u) => (
                <tr key={u.id} className="border-b last:border-0">
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{u.firstName} {u.lastName}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {u.memberships.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                      {u.memberships.map((m, i) => (
                        <span key={i} className={`rounded-full px-2 py-0.5 text-[11px] ${m.organization.isActive ? 'bg-muted' : 'bg-muted opacity-50'}`}>
                          {m.organization.name} <span className="opacity-60">({m.role})</span>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {u.isSuperAdmin ? <Pill tone="purple">{t('users.superAdmin')}</Pill> : <Pill>{t('users.member')}</Pill>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      <Button
                        variant="outline" size="sm" disabled={busyId === u.id}
                        onClick={() => void toggleSuperAdmin(u)}
                      >
                        {u.isSuperAdmin ? t('users.revokeSuper') : t('users.grantSuper')}
                      </Button>
                      <Button
                        variant="ghost" size="sm" disabled={busyId === u.id}
                        className="text-destructive hover:text-destructive"
                        onClick={() => void removeUser(u)}
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
