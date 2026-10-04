'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  ArrowLeft, Copy, History, Loader2, QrCode, ScanLine, Search, UserPlus, Wifi, WifiOff,
} from 'lucide-react';

interface Agent {
  id: string;
  name: string;
  entryPoint: string;
  permissions: { canViewPhoto: boolean; canSearch: boolean; canSeeHistory: boolean };
  active: boolean;
  createdAt: string;
  scannerUrl: string;
}

interface CheckInItem {
  id: string;
  guest: { firstName: string; lastName: string; category: string };
  result: string;
  entryPoint: string | null;
  scannerAgent: string | null;
  checkedInAt: string;
}

const ENTRY_POINTS = ['entrance', 'vip', 'staff', 'family', 'custom'] as const;

export function CheckinPageClient({
  eventId, eventName, locale, allowMultipleEntries, canManage,
}: {
  eventId: string;
  eventName: string;
  locale: string;
  allowMultipleEntries: boolean;
  canManage: boolean;
}) {
  const t = useTranslations('events.checkin');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [items, setItems] = useState<CheckInItem[]>([]);
  const [total, setTotal] = useState(0);
  const [presentCount, setPresentCount] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [result, setResult] = useState('all');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEntry, setNewEntry] = useState<string>('entrance');
  const [perms, setPerms] = useState({ canViewPhoto: false, canSearch: true, canSeeHistory: true });
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (p = page, s = search, r = result) => {
    setLoading(true);
    const res = await apiFetch<{
      items: CheckInItem[]; total: number; totalPages: number; presentCount: number;
    }>(
      `/api/events/${eventId}/checkins?page=${p}&pageSize=25&search=${encodeURIComponent(s)}&result=${r}`,
    );
    if (res.ok && res.data) {
      setItems(res.data.items);
      setTotal(res.data.total);
      setTotalPages(res.data.totalPages);
      setPresentCount(res.data.presentCount);
    }
    setLoading(false);
  }, [eventId, page, search, result]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    apiFetch<{ agents: Agent[] }>(`/api/events/${eventId}/scanner-agents`)
      .then((res) => { if (res.ok && res.data) setAgents(res.data.agents); })
      .catch(() => {});
  }, [eventId]);

  function onSearch(v: string) {
    setSearch(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(1); void load(1, v, result); }, 350);
  }

  async function createAgent() {
    setCreating(true);
    const res = await apiFetch<{ agent: Agent }>(
      `/api/events/${eventId}/scanner-agents`,
      { method: 'POST', body: JSON.stringify({ name: newName, entryPoint: newEntry, permissions: perms }) },
    );
    setCreating(false);
    if (res.ok && res.data) {
      toast.success(t('agentCreated', { name: res.data.agent.name }));
      setNewName('');
      apiFetch<{ agents: Agent[] }>(`/api/events/${eventId}/scanner-agents`)
        .then((r2) => { if (r2.ok && r2.data) setAgents(r2.data.agents); })
        .catch(() => {});
    } else {
      toast.error(res.error?.message ?? t('error'));
    }
  }

  async function copyLink(url: string) {
    const full = url.startsWith('http') ? url : `${window.location.origin}${url}`;
    try {
      await navigator.clipboard.writeText(full);
      toast.success(t('linkCopied'));
    } catch {
      toast.error(t('copyError'));
    }
  }

  async function toggleAgent(a: Agent) {
    const res = await apiFetch(`/api/events/${eventId}/scanner-agents/${a.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !a.active }),
    });
    if (res.ok) {
      setAgents((prev) => prev.map((x) => (x.id === a.id ? { ...x, active: !a.active } : x)));
      toast.success(a.active ? t('agentDeactivated') : t('agentActivated'));
    } else {
      toast.error(res.error?.message ?? t('error'));
    }
  }

  const badge = (r: string) => {
    const map: Record<string, string> = {
      valid: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
      already_used: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
      invalid: 'bg-red-500/10 text-red-700 dark:text-red-400',
      expired: 'bg-muted text-muted-foreground',
    };
    return (
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${map[r] ?? 'bg-muted'}`}>
        {t(`result.${r}` as never)}
      </span>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/${locale}/events/${eventId}`}
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            {eventName}
          </Link>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
            <ScanLine className="size-5 text-primary" aria-hidden />
            {t('title')}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()} className="gap-2">
            <History className="size-4" aria-hidden />
            {t('refresh')}
          </Button>
        </div>
      </div>

      {!allowMultipleEntries && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-6 text-sm text-muted-foreground">{t('singleEntry')}</CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="rounded-lg border p-3">
          <p className="text-2xl font-semibold tabular-nums">{presentCount}</p>
          <p className="text-xs text-muted-foreground">{t('stat.present')}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-2xl font-semibold tabular-nums">{total}</p>
          <p className="text-xs text-muted-foreground">{t('stat.scans')}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-2xl font-semibold tabular-nums">{agents.filter((a) => a.active).length}</p>
          <p className="text-xs text-muted-foreground">{t('stat.activeAgents')}</p>
        </div>
      </div>

      {/* Agents */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <QrCode className="size-4 text-primary" aria-hidden />
            {t('agents.title')}
          </h2>

          {canManage && (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
              <div className="min-w-40 flex-1">
                <label className="mb-1 block text-xs text-muted-foreground">{t('agents.name')}</label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} className="h-8 text-xs" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{t('agents.entryPoint')}</label>
                <select value={newEntry} onChange={(e) => setNewEntry(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs">
                  {ENTRY_POINTS.map((e) => <option key={e} value={e}>{t(`entry.${e}` as never)}</option>)}
                </select>
              </div>
              <label className="flex h-8 items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" checked={perms.canSearch} onChange={(e) => setPerms((p) => ({ ...p, canSearch: e.target.checked }))} />
                {t('agents.permSearch')}
              </label>
              <label className="flex h-8 items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" checked={perms.canSeeHistory} onChange={(e) => setPerms((p) => ({ ...p, canSeeHistory: e.target.checked }))} />
                {t('agents.permHistory')}
              </label>
              <Button size="sm" onClick={createAgent} disabled={creating || newName.trim().length < 2} className="gap-1">
                {creating ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <UserPlus className="size-3.5" aria-hidden />}
                {t('agents.create')}
              </Button>
            </div>
          )}

          {agents.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('agents.empty')}</p>
          ) : (
            <div className="space-y-2">
              {agents.map((a) => (
                <div key={a.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 ${a.active ? '' : 'opacity-60'}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {a.name}
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        {t(`entry.${a.entryPoint}` as never)}
                      </span>
                      {!a.active && (
                        <span className="ml-2 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-600">
                          {t('agents.inactive')}
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {t('agents.perms', {
                        search: a.permissions.canSearch ? '✓' : '✗',
                        history: a.permissions.canSeeHistory ? '✓' : '✗',
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <a href={a.scannerUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:underline">
                      <ScanLine className="size-3.5" aria-hidden />
                      {t('agents.openScanner')}
                    </a>
                    <button type="button" onClick={() => void copyLink(a.scannerUrl)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title={t('agents.copyLink')}>
                      <Copy className="size-3.5" aria-hidden />
                    </button>
                    {canManage && (
                      <Button variant="outline" size="sm" onClick={() => void toggleAgent(a)} className="h-7 text-xs">
                        {a.active ? <WifiOff className="mr-1 size-3.5" aria-hidden /> : <Wifi className="mr-1 size-3.5" aria-hidden />}
                        {a.active ? t('agents.deactivate') : t('agents.activate')}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Historique */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <History className="size-4 text-primary" aria-hidden />
            {t('history.title')}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={search} onChange={(e) => onSearch(e.target.value)} placeholder={t('history.searchPlaceholder')} className="pl-8" />
            </div>
            <select value={result} onChange={(e) => { setResult(e.target.value); setPage(1); void load(1, search, e.target.value); }} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="all">{t('filter.all')}</option>
              <option value="valid">{t('result.valid')}</option>
              <option value="already_used">{t('result.already_used')}</option>
              <option value="invalid">{t('result.invalid')}</option>
              <option value="expired">{t('result.expired')}</option>
            </select>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
              {t('loading')}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <ScanLine className="size-8 text-muted-foreground/50" aria-hidden />
              <p className="max-w-sm text-sm text-muted-foreground">{t('history.empty')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">{t('history.th.guest')}</th>
                    <th className="py-2 pr-3 font-medium">{t('history.th.result')}</th>
                    <th className="py-2 pr-3 font-medium">{t('history.th.entry')}</th>
                    <th className="py-2 pr-3 font-medium">{t('history.th.agent')}</th>
                    <th className="py-2 font-medium">{t('history.th.time')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        <p className="font-medium">{c.guest.firstName} {c.guest.lastName}</p>
                        <p className="text-xs text-muted-foreground">{c.guest.category}</p>
                      </td>
                      <td className="py-2 pr-3">{badge(c.result)}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {c.entryPoint ? t(`entry.${c.entryPoint}` as never) : '—'}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{c.scannerAgent ?? '—'}</td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {new Date(c.checkedInAt).toLocaleString(locale === 'en' ? 'en-GB' : 'fr-FR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-1 text-sm">
              <p className="text-muted-foreground">{t('pageOf', { page, total: totalPages })}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => { setPage(page - 1); void load(page - 1); }}>
                  {t('prev')}
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => { setPage(page + 1); void load(page + 1); }}>
                  {t('next')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
