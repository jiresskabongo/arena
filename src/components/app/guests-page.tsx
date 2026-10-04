'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { apiFetch } from '@/lib/api';
import {
  Loader2, UserPlus, Trash2, Search, Download, Users, ChevronLeft, ChevronRight,
  Save,
} from 'lucide-react';
import { TablesTab } from '@/components/app/tables-tab';
import { ImportTab } from '@/components/app/import-tab';

type Tab = 'guests' | 'tables' | 'import';

interface GuestRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  category: string;
  tableId: string | null;
  table: { id: string; name: string; capacity: number } | null;
  companions: number;
  internalNotes: string | null;
  rsvpStatus: string;
  presenceStatus: string;
  preference: { meal: string | null; drink: string | null; allergies: string | null } | null;
  createdAt: string;
}

interface TableOption {
  id: string;
  name: string;
  capacity: number;
  occupied: number;
}

interface ListRes {
  items: GuestRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  counts: { total: number; confirmed: number; declined: number; maybe: number; pending: number };
}

const CATEGORIES = ['famille', 'amis', 'vip', 'collegues', 'autres'] as const;

export function GuestsPageClient(props: {
  eventId: string;
  eventName: string;
  slug: string;
  locale: string;
  canInvite: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canImport: boolean;
  canTables: boolean;
}) {
  const { eventId, eventName, slug, locale, canInvite, canUpdate, canDelete, canImport, canTables } = props;
  const t = useTranslations('events.guests');
  const router = useRouter();
  const searchParams = useSearchParams();

  const [tab, setTab] = useState<Tab>('guests');
  const [search, setSearch] = useState(searchParams.get('q') ?? '');
  const [category, setCategory] = useState(searchParams.get('category') ?? '');
  const [rsvpStatus, setRsvpStatus] = useState(searchParams.get('rsvp') ?? '');
  const [tableId, setTableId] = useState(searchParams.get('table') ?? '');
  const [sort, setSort] = useState(searchParams.get('sort') ?? 'name');
  const [dir, setDir] = useState<'asc' | 'desc'>(
    searchParams.get('dir') === 'desc' ? 'desc' : 'asc',
  );
  const [page, setPage] = useState(Number(searchParams.get('page') ?? 1));

  const [data, setData] = useState<ListRes | null>(null);
  const [tables, setTables] = useState<TableOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Recherche débouncée → URL (état partageable / retour arrière)
  useEffect(() => {
    const id = setTimeout(() => {
      const sp = new URLSearchParams();
      if (search) sp.set('q', search);
      if (category) sp.set('category', category);
      if (rsvpStatus) sp.set('rsvp', rsvpStatus);
      if (tableId) sp.set('table', tableId);
      if (sort !== 'name') sp.set('sort', sort);
      if (dir !== 'asc') sp.set('dir', dir);
      if (page > 1) sp.set('page', String(page));
      router.replace(`${window.location.pathname}?${sp.toString()}`, { scroll: false });
    }, 300);
    return () => clearTimeout(id);
  }, [search, category, rsvpStatus, tableId, sort, dir, page, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const sp = new URLSearchParams();
    sp.set('page', String(page));
    sp.set('sort', sort);
    sp.set('dir', dir);
    if (search) sp.set('search', search);
    if (category) sp.set('category', category);
    if (rsvpStatus) sp.set('rsvpStatus', rsvpStatus);
    if (tableId) sp.set('tableId', tableId);
    const res = await apiFetch<ListRes>(`/api/events/${eventId}/guests?${sp.toString()}`);
    if (res.ok && res.data) {
      setData(res.data);
    } else {
      setError(res.error?.message ?? t('loadError'));
    }
    setLoading(false);
  }, [eventId, page, sort, dir, search, category, rsvpStatus, tableId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let alive = true;
    apiFetch<{ tables: TableOption[] }>(`/api/events/${eventId}/tables`).then((r) => {
      if (alive && r.ok && r.data) setTables(r.data.tables);
    });
    return () => {
      alive = false;
    };
  }, [eventId, tab, data]);

  const exportUrl = useMemo(() => {
    const sp = new URLSearchParams({ format: 'csv', sort, dir });
    if (search) sp.set('search', search);
    if (category) sp.set('category', category);
    if (rsvpStatus) sp.set('rsvpStatus', rsvpStatus);
    if (tableId) sp.set('tableId', tableId);
    return `/api/events/${eventId}/guests/export?${sp.toString()}`;
  }, [eventId, sort, dir, search, category, rsvpStatus, tableId]);

  async function removeGuest(gid: string) {
    setBusy(true);
    const res = await apiFetch(`/api/events/${eventId}/guests/${gid}`, {
      method: 'DELETE',
    }).finally(() => setBusy(false));
    if (res.ok) {
      toast.success(t('removed'));
      setExpanded(null);
      router.refresh();
      void load();
    } else {
      toast.error(res.error?.message ?? t('removeError'));
    }
  }

  const counts = data?.counts;
  const selectCls =
    'flex h-10 rounded-xl border border-input bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {t('title', { event: eventName })}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {counts ? t('subtitle', { total: counts.total, confirmed: counts.confirmed }) : '…'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.open(exportUrl, '_blank')}>
            <Download className="size-4" aria-hidden />
            {t('exportCsv')}
          </Button>
          {canInvite && !showAdd && (
            <Button size="sm" className="gap-1.5" onClick={() => setShowAdd(true)}>
              <UserPlus className="size-4" aria-hidden />
              {t('add')}
            </Button>
          )}
        </div>
      </div>

      {/* Onglets */}
      <div className="flex gap-1 rounded-xl bg-muted p-1">
        {([
          ['guests', t('tabGuests')],
          ['tables', t('tabTables')],
          ...(canImport ? ([[ 'import', t('tabImport') ]] as [Tab, string][]) : []),
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'guests' && (
        <>
          {/* KPIs RSVP (cliquables = filtres) */}
          {counts && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Chip label={t('kpiTotal')} value={counts.total} tone="default" active={rsvpStatus === ''} onClick={() => { setRsvpStatus(''); setPage(1); }} />
              <Chip label={t('rsvp.confirmed')} value={counts.confirmed} tone="success" active={rsvpStatus === 'confirmed'} onClick={() => { setRsvpStatus(rsvpStatus === 'confirmed' ? '' : 'confirmed'); setPage(1); }} />
              <Chip label={t('rsvp.maybe')} value={counts.maybe} tone="warning" active={rsvpStatus === 'maybe'} onClick={() => { setRsvpStatus(rsvpStatus === 'maybe' ? '' : 'maybe'); setPage(1); }} />
              <Chip label={t('rsvp.declined')} value={counts.declined} tone="danger" active={rsvpStatus === 'declined'} onClick={() => { setRsvpStatus(rsvpStatus === 'declined' ? '' : 'declined'); setPage(1); }} />
              <Chip label={t('rsvp.pending')} value={counts.pending} tone="muted" active={rsvpStatus === 'pending'} onClick={() => { setRsvpStatus(rsvpStatus === 'pending' ? '' : 'pending'); setPage(1); }} />
            </div>
          )}

          {/* Filtres / recherche / tri */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-52 flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                className="pl-9"
                placeholder={t('searchPlaceholder')}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <select className={selectCls} value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
              <option value="">{t('allCategories')}</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{t(`cat.${c}`)}</option>)}
            </select>
            <select className={selectCls} value={rsvpStatus} onChange={(e) => { setRsvpStatus(e.target.value); setPage(1); }}>
              <option value="">{t('allRsvp')}</option>
              <option value="confirmed">{t('rsvp.confirmed')}</option>
              <option value="maybe">{t('rsvp.maybe')}</option>
              <option value="declined">{t('rsvp.declined')}</option>
              <option value="pending">{t('rsvp.pending')}</option>
            </select>
            <select className={selectCls} value={tableId} onChange={(e) => { setTableId(e.target.value); setPage(1); }}>
              <option value="">{t('allTables')}</option>
              {tables.map((tb) => <option key={tb.id} value={tb.id}>{tb.name}</option>)}
            </select>
            <select
              className={selectCls}
              value={`${sort}:${dir}`}
              onChange={(e) => {
                const [s, d] = e.target.value.split(':') as [typeof sort, typeof dir];
                setSort(s);
                setDir(d);
              }}
            >
              <option value="name:asc">{t('sortNameAsc')}</option>
              <option value="name:desc">{t('sortNameDesc')}</option>
              <option value="createdAt:desc">{t('sortRecent')}</option>
              <option value="table:asc">{t('sortTable')}</option>
            </select>
          </div>

          {/* Ajout */}
          {showAdd && canInvite && (
            <AddGuestForm
              eventId={eventId}
              tables={tables}
              onCancel={() => setShowAdd(false)}
              onDone={() => {
                setShowAdd(false);
                setPage(1);
                router.refresh();
                void load();
              }}
            />
          )}

          {/* Liste */}
          <Card>
            {loading && !data ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="animate-spin size-4" aria-hidden />
                {t('loading')}
              </div>
            ) : error ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <p className="text-sm text-destructive">{error}</p>
                <Button variant="outline" size="sm" onClick={() => void load()}>{t('retry')}</Button>
              </div>
            ) : !data || data.items.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
                  <Users className="size-6" aria-hidden />
                </span>
                <p className="text-sm text-muted-foreground">
                  {search || category || rsvpStatus || tableId ? t('emptyFiltered') : t('empty')}
                </p>
                {canInvite && !search && !category && !rsvpStatus && !tableId && (
                  <Button size="sm" className="gap-1.5" onClick={() => setShowAdd(true)}>
                    <UserPlus className="size-4" aria-hidden />
                    {t('add')}
                  </Button>
                )}
              </div>
            ) : (
              <ul className="divide-y">
                {data.items.map((g) => (
                  <li key={g.id}>
                    <div
                      className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/40"
                      onClick={() => setExpanded(expanded === g.id ? null : g.id)}
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground">
                        {g.firstName[0]}{g.lastName[0]}
                      </span>
                      <div className="min-w-40 flex-1">
                        <p className="text-sm font-medium">
                          {g.firstName} {g.lastName}
                          {g.companions > 0 && (
                            <span className="ml-1 text-xs text-muted-foreground">+{g.companions}</span>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[g.phone, g.email].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </div>
                      <Badge variant="outline" className="hidden sm:inline-flex">{t(`cat.${g.category}`)}</Badge>
                      <span className="hidden w-24 text-sm text-muted-foreground md:inline">
                        {g.table?.name ?? t('noTable')}
                      </span>
                      <Badge
                        variant={g.rsvpStatus === 'confirmed' ? 'success' : g.rsvpStatus === 'declined' ? 'secondary' : 'outline'}
                        className="hidden sm:inline-flex"
                      >
                        {t(`rsvp.${g.rsvpStatus}`)}
                      </Badge>
                    </div>

                    {expanded === g.id && (
                      <div className="border-t bg-muted/20 px-4 py-4" onClick={(e) => e.stopPropagation()}>
                        <GuestEditor
                          eventId={eventId}
                          guest={g}
                          tables={tables}
                          canUpdate={canUpdate}
                          canDelete={canDelete}
                          busy={busy}
                          onDelete={() => void removeGuest(g.id)}
                          onSaved={() => {
                            setExpanded(null);
                            router.refresh();
                            void load();
                          }}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Pagination */}
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <p className="text-muted-foreground">
                {t('pageOf', { page: data.page, total: data.totalPages, totalItems: data.total })}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={data.page <= 1 || loading} onClick={() => setPage((p) => p - 1)} className="gap-1">
                  <ChevronLeft className="size-4" aria-hidden />
                  {t('prev')}
                </Button>
                <Button variant="outline" size="sm" disabled={data.page >= data.totalPages || loading} onClick={() => setPage((p) => p + 1)} className="gap-1">
                  {t('next')}
                  <ChevronRight className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'tables' && <TablesTab eventId={eventId} canManage={canTables} onChanged={() => void load()} />}
      {tab === 'import' && canImport && (
        <ImportTab eventId={eventId} onImported={() => { setPage(1); void load(); }} />
      )}
    </div>
  );
}

function Chip({
  label, value, tone, active, onClick,
}: {
  label: string;
  value: number;
  tone: 'default' | 'success' | 'warning' | 'danger' | 'muted';
  active?: boolean;
  onClick?: () => void;
}) {
  const tones: Record<string, string> = {
    default: 'border-border bg-background',
    success: 'border-emerald-500/30 bg-emerald-500/5',
    warning: 'border-amber-500/30 bg-amber-500/5',
    danger: 'border-rose-500/30 bg-rose-500/5',
    muted: 'border-border bg-background opacity-70',
  };
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border px-3 py-2 text-left transition-colors ${tones[tone]} ${active ? 'ring-2 ring-ring/50' : ''}`}
    >
      <p className="text-lg font-semibold leading-none">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </button>
  );
}

function AddGuestForm({
  eventId, tables, onCancel, onDone,
}: {
  eventId: string;
  tables: TableOption[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('events.guests');
  const [form, setForm] = useState({
    firstName: '', lastName: '', phone: '', email: '', category: 'autres', tableId: '', companions: 0,
  });
  const [busy, setBusy] = useState(false);
  const inputCls =
    'flex h-10 w-full rounded-xl border border-input bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60';

  async function submit() {
    setBusy(true);
    const res = await apiFetch<{ guest: { id: string } }>(`/api/events/${eventId}/guests`, {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        tableId: form.tableId || undefined,
        companions: Number(form.companions) || 0,
      }),
    }).finally(() => setBusy(false));
    if (res.ok) {
      toast.success(t('added'));
      onDone();
    } else {
      toast.error(
        res.error?.details?.map((d) => d.message).join(' · ') ?? res.error?.message ?? t('addError'),
      );
    }
  }

  return (
    <Card className="border-primary/40">
      <CardContent className="space-y-3 pt-6">
        <p className="text-sm font-medium">{t('addTitle')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>{t('firstName')}</Label>
            <Input className={inputCls} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          </div>
          <div>
            <Label>{t('lastName')}</Label>
            <Input className={inputCls} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </div>
          <div>
            <Label>{t('phone')}</Label>
            <Input className={inputCls} placeholder="+243 …" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <Label>{t('email')}</Label>
            <Input className={inputCls} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <Label>{t('category')}</Label>
            <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{t(`cat.${c}`)}</option>)}
            </select>
          </div>
          <div>
            <Label>{t('tableLabel')}</Label>
            <select className={inputCls} value={form.tableId} onChange={(e) => setForm({ ...form, tableId: e.target.value })}>
              <option value="">{t('noTable')}</option>
              {tables.map((tb) => (
                <option key={tb.id} value={tb.id} disabled={tb.occupied >= tb.capacity}>
                  {tb.name} ({tb.occupied}/{tb.capacity})
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>{t('companions')}</Label>
            <Input
              className={inputCls}
              type="number"
              min={0}
              max={50}
              value={form.companions}
              onChange={(e) => setForm({ ...form, companions: Number(e.target.value) || 0 })}
            />
          </div>
        </div>
        <div className="flex gap-2 border-t pt-3">
          <Button size="sm" disabled={busy || form.firstName.trim().length < 1 || form.lastName.trim().length < 1} onClick={submit}>
            {busy ? <Loader2 className="animate-spin size-4" aria-hidden /> : <Save className="size-4" aria-hidden />}
            {t('save')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>{t('cancel')}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function GuestEditor({
  eventId, guest, tables, canUpdate, canDelete, busy, onDelete, onSaved,
}: {
  eventId: string;
  guest: GuestRow;
  tables: TableOption[];
  canUpdate: boolean;
  canDelete: boolean;
  busy: boolean;
  onDelete: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('events.guests');
  const [form, setForm] = useState({
    firstName: guest.firstName,
    lastName: guest.lastName,
    phone: guest.phone ?? '',
    email: guest.email ?? '',
    category: guest.category,
    tableId: guest.tableId ?? '',
    companions: guest.companions,
    internalNotes: guest.internalNotes ?? '',
    rsvpStatus: guest.rsvpStatus,
    meal: guest.preference?.meal ?? '',
    drink: guest.preference?.drink ?? '',
    allergies: guest.preference?.allergies ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputCls =
    'flex h-10 w-full rounded-xl border border-input bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60';

  if (!canUpdate) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted-foreground">{t('readOnly')}</p>
        {canDelete && (
          <div className="flex items-center gap-2">
            {confirmDelete && <p className="text-xs text-destructive">{t('deleteConfirm')}</p>}
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))} disabled={busy}>
              <Trash2 className="size-4" aria-hidden />
              {confirmDelete ? t('deleteConfirmBtn') : t('delete')}
            </Button>
          </div>
        )}
      </div>
    );
  }

  async function submit() {
    setSaving(true);
    const preference: Record<string, unknown> = {};
    if (form.meal) preference.meal = form.meal;
    if (form.drink) preference.drink = form.drink;
    if (form.allergies) preference.allergies = form.allergies;
    const res = await apiFetch(`/api/events/${eventId}/guests/${guest.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...form,
        tableId: form.tableId || undefined,
        companions: Number(form.companions) || 0,
        preference: Object.keys(preference).length > 0 ? preference : undefined,
      }),
    }).finally(() => setSaving(false));
    if (res.ok) {
      toast.success(t('saved'));
      onSaved();
    } else {
      toast.error(
        res.error?.details?.map((d) => d.message).join(' · ') ?? res.error?.message ?? t('saveError'),
      );
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Label>{t('firstName')}</Label>
          <Input className={inputCls} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
        </div>
        <div>
          <Label>{t('lastName')}</Label>
          <Input className={inputCls} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
        </div>
        <div>
          <Label>{t('phone')}</Label>
          <Input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div>
          <Label>{t('email')}</Label>
          <Input className={inputCls} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <Label>{t('category')}</Label>
          <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{t(`cat.${c}`)}</option>)}
          </select>
        </div>
        <div>
          <Label>{t('tableLabel')}</Label>
          <select className={inputCls} value={form.tableId} onChange={(e) => setForm({ ...form, tableId: e.target.value })}>
            <option value="">{t('noTable')}</option>
            {tables.map((tb) => (
              <option key={tb.id} value={tb.id} disabled={tb.occupied >= tb.capacity && tb.id !== guest.tableId}>
                {tb.name} ({tb.occupied}/{tb.capacity})
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>{t('companions')}</Label>
          <Input
            className={inputCls}
            type="number"
            min={0}
            max={50}
            value={form.companions}
            onChange={(e) => setForm({ ...form, companions: Number(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label>{t('rsvpLabel')}</Label>
          <select className={inputCls} value={form.rsvpStatus} onChange={(e) => setForm({ ...form, rsvpStatus: e.target.value })}>
            <option value="pending">{t('rsvp.pending')}</option>
            <option value="confirmed">{t('rsvp.confirmed')}</option>
            <option value="maybe">{t('rsvp.maybe')}</option>
            <option value="declined">{t('rsvp.declined')}</option>
          </select>
        </div>
        <div>
          <Label>{t('meal')}</Label>
          <Input className={inputCls} value={form.meal} onChange={(e) => setForm({ ...form, meal: e.target.value })} />
        </div>
        <div>
          <Label>{t('drink')}</Label>
          <Input className={inputCls} value={form.drink} onChange={(e) => setForm({ ...form, drink: e.target.value })} />
        </div>
        <div>
          <Label>{t('allergies')}</Label>
          <Input className={inputCls} value={form.allergies} onChange={(e) => setForm({ ...form, allergies: e.target.value })} />
        </div>
      </div>
      <div>
        <Label>{t('notes')}</Label>
        <textarea
          className="min-h-16 w-full rounded-xl border border-input bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          value={form.internalNotes}
          onChange={(e) => setForm({ ...form, internalNotes: e.target.value })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <Button size="sm" disabled={saving || form.firstName.trim().length < 1 || form.lastName.trim().length < 1} onClick={submit}>
          {saving ? <Loader2 className="animate-spin size-4" aria-hidden /> : <Save className="size-4" aria-hidden />}
          {t('save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onSaved}>{t('cancel')}</Button>
        {canDelete && (
          <div className="ml-auto flex items-center gap-2">
            {confirmDelete && <p className="text-xs text-destructive">{t('deleteConfirm')}</p>}
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
              disabled={busy}
            >
              <Trash2 className="size-4" aria-hidden />
              {confirmDelete ? t('deleteConfirmBtn') : t('delete')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
