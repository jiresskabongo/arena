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
  ArrowLeft, BadgeCheck, ChevronLeft, ChevronRight, Copy, Link as LinkIcon,
  ListPlus, Loader2, QrCode, RefreshCcw, Search, Trash2, X,
} from 'lucide-react';

interface InvitationItem {
  id: string;
  publicUrl: string;
  invitationStatus: string;
  guest: { firstName: string; lastName: string; email: string | null; phone: string | null; category: string };
  token: string | null;
  tokenExpired: boolean;
  tokenRevoked: boolean;
  qrData: string;
  rsvp: { status: string; companions: number; updatedAt: string } | null;
}

interface Questions {
  id: string;
  label: string;
  type: 'text' | 'number' | 'choice';
  choices: string[] | null;
  required: boolean;
  sortOrder: number;
}

interface DraftQuestion {
  key: string;
  label: string;
  type: 'text' | 'number' | 'choice';
  choices: string;
  required: boolean;
}

let draftKey = 0;

export function InvitationsPageClient({
  eventId, eventName, locale, rsvpEnabled, canInvite, canUpdate,
}: {
  eventId: string;
  eventName: string;
  slug: string;
  locale: string;
  rsvpEnabled: boolean;
  canInvite: boolean;
  canUpdate: boolean;
}) {
  const t = useTranslations('events.invitations');
  const [items, setItems] = useState<InvitationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [questions, setQuestions] = useState<Questions[]>([]);
  const [drafts, setDrafts] = useState<DraftQuestion[] | null>(null);
  const [savingQuestions, setSavingQuestions] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [qrUrls, setQrUrls] = useState<Record<string, string>>({});

  const load = useCallback(async (p = page, s = search, st = status) => {
    setLoading(true);
    const res = await apiFetch<{
      items: InvitationItem[]; total: number; page: number; totalPages: number;
      stats: Record<string, number>;
    }>(
      `/api/events/${eventId}/invitations?page=${p}&pageSize=25&search=${encodeURIComponent(s)}&status=${st}`,
    );
    if (res.ok && res.data) {
      setItems(res.data.items);
      setTotal(res.data.total);
      setTotalPages(res.data.totalPages);
      setStats(res.data.stats);
    }
    setLoading(false);
  }, [eventId, page, search, status]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    apiFetch<{ questions: Questions[] }>(`/api/events/${eventId}/rsvp-questions`)
      .then((res) => { if (res.ok && res.data) setQuestions(res.data.questions); })
      .catch(() => {});
  }, [eventId]);

  // QR miniatures (data-URI) — lazy par lot
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const it of items) {
        if (qrUrls[it.id] || !it.qrData) continue;
        try {
          const QR = await import('qrcode');
          const mod = QR as { toDataURL: (v: string, o: object) => Promise<string> };
          const url = await mod.toDataURL(it.qrData, { width: 96, margin: 0 });
          if (cancelled) return;
          setQrUrls((m) => ({ ...m, [it.id]: url }));
        } catch {
          /* placeholder */
        }
      }
    })();
    return () => { cancelled = true; };
  }, [items, qrUrls]);

  function onSearch(v: string) {
    setSearch(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(1); void load(1, v, status); }, 350);
  }

  async function generate() {
    setGenerating(true);
    const res = await apiFetch<{ created: number; already: number; total: number }>(
      `/api/events/${eventId}/invitations`,
      { method: 'POST' },
    );
    setGenerating(false);
    if (res.ok && res.data) {
      toast.success(
        res.data.created > 0
          ? t('generated', { created: res.data.created, total: res.data.total })
          : t('alreadyAll'),
      );
      void load();
    } else {
      toast.error(res.error?.message ?? t('error'));
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('linkCopied'));
    } catch {
      toast.error(t('copyError'));
    }
  }

  async function revoke(item: InvitationItem) {
    const fullName = item.guest.firstName + ' ' + item.guest.lastName;
    if (!window.confirm(t('revokeConfirm', { name: fullName }))) return;
    const res = await apiFetch(`/api/events/${eventId}/invitations/${item.id}/revoke`, { method: 'POST' });
    if (res.ok) {
      toast.success(t('revoked'));
      void load();
    } else {
      toast.error(res.error?.message ?? t('error'));
    }
  }

  // ── Questions RSVP (édition) ──
  const d = drafts ?? questions.map((q) => ({
    key: q.id, label: q.label, type: q.type,
    choices: (q.choices ?? []).join(', '), required: q.required,
  }));

  function addDraft() {
    setDrafts([
      ...d,
      { key: `new${draftKey++}`, label: '', type: 'text', choices: '', required: false },
    ]);
  }
  function patchDraft(i: number, patch: Partial<DraftQuestion>) {
    setDrafts(d.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  }
  function removeDraft(i: number) {
    setDrafts(d.filter((_, j) => j !== i));
  }

  async function saveQuestions() {
    setSavingQuestions(true);
    const payload = d
      .filter((q) => q.label.trim().length >= 2)
      .map((q) => ({
        label: q.label.trim(),
        type: q.type,
        choices: q.type === 'choice' ? q.choices.split(',').map((c) => c.trim()).filter(Boolean) : undefined,
        required: q.required,
      }));
    const res = await apiFetch<{ questions: Questions[] }>(
      `/api/events/${eventId}/rsvp-questions`,
      { method: 'PUT', body: JSON.stringify(payload) },
    );
    setSavingQuestions(false);
    if (res.ok && res.data) {
      setQuestions(res.data.questions);
      setDrafts(null);
      toast.success(t('questionsSaved'));
    } else {
      toast.error(res.error?.message ?? t('error'));
    }
  }

  const badge = (s: string | null) => {
    if (!s) return <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{t('stat.pending')}</span>;
    const map: Record<string, string> = {
      confirmed: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
      declined: 'bg-red-500/10 text-red-700 dark:text-red-400',
      maybe: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    };
    return (
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${map[s] ?? 'bg-muted text-muted-foreground'}`}>
        {t(`stat.${s}` as never)}
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
            <QrCode className="size-5 text-primary" aria-hidden />
            {t('title')}
          </h1>
        </div>
        <div className="flex gap-2">
          {canInvite && (
            <Button onClick={generate} disabled={generating} className="gap-2">
              {generating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ListPlus className="size-4" aria-hidden />}
              {t('generate')}
            </Button>
          )}
          <Button variant="outline" onClick={() => void load()} className="gap-2">
            <RefreshCcw className="size-4" aria-hidden />
            {t('refresh')}
          </Button>
        </div>
      </div>

      {!rsvpEnabled && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-6 text-sm text-muted-foreground">{t('rsvpDisabled')}</CardContent>
        </Card>
      )}

      {/* Stats RSVP */}
      {stats && total > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <StatCard label={t('stat.total')} value={total} />
          <StatCard label={t('stat.pending')} value={stats.pending} tone="muted" />
          <StatCard label={t('stat.confirmed')} value={stats.confirmed} tone="ok" />
          <StatCard label={t('stat.maybe')} value={stats.maybe} tone="warn" />
          <StatCard label={t('stat.declined')} value={stats.declined} tone="bad" />
        </div>
      )}

      {/* Liste */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-52">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="pl-8"
              />
            </div>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); void load(1, search, e.target.value); }}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="all">{t('filter.all')}</option>
              <option value="pending">{t('stat.pending')}</option>
              <option value="confirmed">{t('stat.confirmed')}</option>
              <option value="maybe">{t('stat.maybe')}</option>
              <option value="declined">{t('stat.declined')}</option>
            </select>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
              {t('loading')}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <QrCode className="size-8 text-muted-foreground/50" aria-hidden />
              <p className="max-w-sm text-sm text-muted-foreground">{t('empty')}</p>
              {canInvite && (
                <Button variant="outline" size="sm" onClick={generate} disabled={generating}>
                  {t('generate')}
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">{t('th.guest')}</th>
                    <th className="py-2 pr-3 font-medium">{t('th.contact')}</th>
                    <th className="py-2 pr-3 font-medium">{t('th.link')}</th>
                    <th className="py-2 pr-3 font-medium">QR</th>
                    <th className="py-2 pr-3 font-medium">{t('th.rsvp')}</th>
                    {canUpdate && <th className="py-2 font-medium" />}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-b last:border-0">
                      <td className="py-2.5 pr-3">
                        <p className="font-medium">{it.guest.firstName} {it.guest.lastName}</p>
                        <p className="text-xs text-muted-foreground">{it.guest.category}</p>
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                        {it.guest.email ?? '—'}
                        <br />
                        {it.guest.phone ?? ''}
                      </td>
                      <td className="py-2.5 pr-3">
                        {it.token ? (
                          <div className="flex items-center gap-1">
                            <a
                              href={it.publicUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              <LinkIcon className="size-3.5" aria-hidden />
                              {t('openLink')}
                            </a>
                            <button
                              type="button"
                              onClick={() => void copyLink(it.publicUrl)}
                              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                              title={t('copyLink')}
                            >
                              <Copy className="size-3.5" aria-hidden />
                            </button>
                            {(it.tokenRevoked || it.tokenExpired) && (
                              <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-600">
                                {it.tokenRevoked ? t('revoked') : t('expired')}
                              </span>
                            )}
                          </div>
                        ) : '—'}
                      </td>
                      <td className="py-2.5 pr-3">
                        {qrUrls[it.id] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={qrUrls[it.id]} alt="" className="h-12 w-12 rounded border bg-white p-0.5" />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded border bg-white">
                            <QrCode className="size-4 text-muted-foreground/40" aria-hidden />
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex flex-col gap-0.5">
                          {badge(it.rsvp?.status ?? null)}
                          {it.rsvp && it.rsvp.companions > 0 && (
                            <span className="text-[11px] text-muted-foreground">
                              {t('companions', { n: it.rsvp.companions })}
                            </span>
                          )}
                        </div>
                      </td>
                      {canUpdate && (
                        <td className="py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => void revoke(it)}
                            className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            title={t('revoke')}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </button>
                        </td>
                      )}
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
                <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => { setPage(page - 1); void load(page - 1); }} className="gap-1">
                  <ChevronLeft className="size-4" aria-hidden />{t('prev')}
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => { setPage(page + 1); void load(page + 1); }} className="gap-1">
                  {t('next')}<ChevronRight className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Questions RSVP */}
      {canUpdate && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                <BadgeCheck className="mr-1.5 inline size-4 text-primary" aria-hidden />
                {t('questions.title')}
              </h2>
              <Button variant="outline" size="sm" onClick={addDraft} disabled={d.length >= 10}>
                {t('questions.add')}
              </Button>
            </div>
            {d.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('questions.empty')}</p>
            )}
            {d.map((q, i) => (
              <div key={q.key} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                <Input
                  value={q.label}
                  onChange={(e) => patchDraft(i, { label: e.target.value })}
                  placeholder={t('questions.labelPlaceholder')}
                  className="h-8 min-w-44 flex-1 text-xs"
                  maxLength={80}
                />
                <select
                  value={q.type}
                  onChange={(e) => patchDraft(i, { type: e.target.value as DraftQuestion['type'] })}
                  className="h-8 rounded-md border bg-background px-2 text-xs"
                >
                  <option value="text">{t('questions.typeText')}</option>
                  <option value="number">{t('questions.typeNumber')}</option>
                  <option value="choice">{t('questions.typeChoice')}</option>
                </select>
                {q.type === 'choice' && (
                  <Input
                    value={q.choices}
                    onChange={(e) => patchDraft(i, { choices: e.target.value })}
                    placeholder={t('questions.choicesPlaceholder')}
                    className="h-8 w-52 text-xs"
                  />
                )}
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={q.required}
                    onChange={(e) => patchDraft(i, { required: e.target.checked })}
                  />
                  {t('questions.required')}
                </label>
                <button
                  type="button"
                  onClick={() => removeDraft(i)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            ))}
            {drafts && (
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setDrafts(null)}>{t('cancel')}</Button>
                <Button size="sm" onClick={saveQuestions} disabled={savingQuestions}>
                  {savingQuestions ? t('saving') : t('questions.save')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'muted' | 'ok' | 'warn' | 'bad' }) {
  const tones = {
    default: 'border',
    muted: 'border bg-muted/40',
    ok: 'border-emerald-500/30 bg-emerald-500/5',
    warn: 'border-amber-500/30 bg-amber-500/5',
    bad: 'border-red-500/30 bg-red-500/5',
  } as const;
  return (
    <div className={`rounded-lg p-3 ${tones[tone]}`}>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
