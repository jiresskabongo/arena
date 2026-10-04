'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, BookHeart, Download, Eye, EyeOff, Hammer, Loader2,
  Users, CheckCircle2, XCircle, Clock,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid,
} from 'recharts';

interface Stats {
  event: { id: string; name: string };
  guests: {
    total: number;
    byCategory: Record<string, number>;
    rsvp: { confirmed: number; maybe: number; declined: number; pending: number; expected: number; invitedCompanions: number };
    invitations: { total: number; sent: number; draft: number };
  };
  checkins: {
    total: number; presentGuests: number;
    byHour: { hour: string; count: number }[];
    byEntryPoint: Record<string, number>;
    byCategory: { category: string; count: number }[];
  };
  tables: { count: number; totalSeats: number; assignedSeats: number; occupancyPct: number; rows: { id: string; name: string; seats: number; capacity: number }[] };
  guestbook: { total: number; approved: number; pending: number; hidden: number; rejected: number };
  rsvpTimeline: { date: string; confirmed: number; maybe: number; declined: number }[];
}

interface GBMessage {
  id: string; authorName: string; authorEmail: string | null;
  message: string; status: string; publishedAt: string | null; createdAt: string;
}

const PIE_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#94a3b8'];
const REPORTS = ['guests', 'rsvp', 'present', 'absent', 'scans', 'tables', 'stats', 'guestbook'] as const;

export function StatisticsPageClient({
  eventId, eventName, locale, canModerate,
}: {
  eventId: string;
  eventName: string;
  locale: string;
  canModerate: boolean;
}) {
  const t = useTranslations('events.statistics');
  const [tab, setTab] = useState<'stats' | 'reports' | 'guestbook'>('stats');
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Livr d'or
  const [gb, setGb] = useState<GBMessage[]>([]);
  const [gbTotal, setGbTotal] = useState(0);
  const [gbPages, setGbPages] = useState(1);
  const [gbPage, setGbPage] = useState(1);
  const [gbStatus, setGbStatus] = useState('all');
  const [modId, setModId] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(false);
    const res = await apiFetch<{ stats: Stats }>(`/api/events/${eventId}/statistics`);
    if (res.ok && res.data) setStats(res.data.stats);
    else setError(true);
    setLoading(false);
  }, [eventId]);

  const loadGb = useCallback(async () => {
    const res = await apiFetch<{ items: GBMessage[]; total: number; totalPages: number }>(
      `/api/events/${eventId}/guestbook?page=${gbPage}&pageSize=15&status=${gbStatus}`,
    );
    if (res.ok && res.data) {
      setGb(res.data.items);
      setGbTotal(res.data.total);
      setGbPages(res.data.totalPages);
    }
  }, [eventId, gbPage, gbStatus]);

  useEffect(() => { void loadStats(); }, [loadStats]);
  useEffect(() => { if (tab === 'guestbook') void loadGb(); }, [tab, loadGb]);

  async function moderate(id: string, status: string) {
    setModId(id);
    const res = await apiFetch(`/api/events/${eventId}/guestbook/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setModId(null);
    if (res.ok) {
      void loadGb();
      void loadStats();
    } else {
      toast.error(res.error?.message ?? t('error'));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
        {t('loading')}
      </div>
    );
  }

  if (error || !stats) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-destructive">
          {t('error')}
        </CardContent>
      </Card>
    );
  }

  const r = stats.guests.rsvp;
  const kpis = [
    { label: t('kpi.guests'), value: stats.guests.total, icon: Users, color: 'text-indigo-600' },
    { label: t('kpi.confirmed'), value: r.confirmed, icon: CheckCircle2, color: 'text-emerald-600' },
    { label: t('kpi.expected'), value: r.expected, icon: Clock, color: 'text-amber-600' },
    { label: t('kpi.present'), value: stats.checkins.presentGuests, icon: Hammer, color: 'text-sky-600' },
    { label: t('kpi.tables'), value: `${stats.tables.occupancyPct}%`, icon: Users, color: 'text-violet-600' },
  ];

  return (
    <div className="space-y-5">
      <div>
        <Link
          href={`/${locale}/events/${eventId}`}
          className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {eventName}
        </Link>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{t('title')}</h1>
      </div>

      {/* Onglets */}
      <div className="flex w-fit flex-wrap gap-1 rounded-lg border p-1 text-sm">
        {(['stats', 'reports', 'guestbook'] as const).map((tb) => (
          <button
            key={tb}
            type="button"
            onClick={() => setTab(tb)}
            className={`rounded-md px-3 py-1.5 font-medium transition ${tab === tb ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >
            {t(`tab.${tb}`)}
          </button>
        ))}
      </div>

      {tab === 'stats' && (
        <div className="space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {kpis.map((k) => (
              <Card key={k.label}>
                <CardContent className="pt-5">
                  <div className="flex items-center gap-2">
                    <k.icon className={`size-4 ${k.color}`} aria-hidden />
                    <span className="text-xs text-muted-foreground">{k.label}</span>
                  </div>
                  <p className="mt-1.5 text-2xl font-semibold tabular-nums">{k.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Évolution RSVP */}
            <Card>
              <CardContent className="pt-6">
                <h2 className="mb-3 text-sm font-semibold">{t('chart.rsvp')}</h2>
                {stats.rsvpTimeline.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">{t('empty.rsvp')}</p>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={stats.rsvpTimeline} margin={{ left: -20, right: 8, top: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="confirmed" name={t('rsvp.confirmed')} stroke="#22c55e" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="maybe" name={t('rsvp.maybe')} stroke="#f59e0b" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="declined" name={t('rsvp.declined')} stroke="#ef4444" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Arrivées / heure */}
            <Card>
              <CardContent className="pt-6">
                <h2 className="mb-3 text-sm font-semibold">{t('chart.arrivals')}</h2>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={stats.checkins.byHour} margin={{ left: -20, right: 8, top: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={1} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" name={t('kpi.present')} fill="#0ea5e9" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Présence / catégorie */}
            <Card>
              <CardContent className="pt-6">
                <h2 className="mb-3 text-sm font-semibold">{t('chart.category')}</h2>
                {stats.checkins.byCategory.every((c) => c.count === 0) ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">{t('empty.present')}</p>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie
                        data={stats.checkins.byCategory}
                        dataKey="count"
                        nameKey="category"
                        cx="50%"
                        cy="50%"
                        outerRadius={85}
                        label={(p) => p.name}
                      >
                        {stats.checkins.byCategory.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Occupation tables */}
            <Card>
              <CardContent className="pt-6">
                <h2 className="mb-3 text-sm font-semibold">{t('chart.tables')}</h2>
                {stats.tables.rows.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">{t('empty.tables')}</p>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={stats.tables.rows} layout="vertical" margin={{ left: 16, right: 12, top: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.4} />
                      <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={70} />
                      <Tooltip />
                      <Bar dataKey="seats" name={t('chart.seats')} fill="#8b5cf6" radius={[0, 3, 3, 0]} barSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {tab === 'reports' && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div>
              <h2 className="text-sm font-semibold">{t('reports.title')}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('reports.body')}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {REPORTS.map((ty) => (
                <div key={ty} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{t(`report.${ty}`)}</p>
                    <p className="text-xs text-muted-foreground">{t(`reportBody.${ty}`)}</p>
                  </div>
                  <div className="flex gap-1.5">
                    {(['csv', 'xlsx', 'pdf'] as const).map((f) => (
                      <a
                        key={f}
                        href={`/api/events/${eventId}/reports/${ty}?format=${f}`}
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
                      >
                        <Download className="size-3" aria-hidden />
                        {f.toUpperCase()}
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'guestbook' && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <BookHeart className="size-4" aria-hidden />
                {t('guestbook.title')}
              </h2>
              <select
                value={gbStatus}
                onChange={(e) => { setGbStatus(e.target.value); setGbPage(1); }}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="all">{t('guestbook.all')}</option>
                <option value="approved">{t('status.approved')}</option>
                <option value="pending">{t('status.pending')}</option>
                <option value="hidden">{t('status.hidden')}</option>
                <option value="rejected">{t('status.rejected')}</option>
              </select>
            </div>

            {gb.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t('guestbook.empty')}</p>
            ) : (
              <div className="divide-y">
                {gb.map((m) => (
                  <div key={m.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{m.authorName}</p>
                        <GBBadge status={m.status} t={t} />
                      </div>
                      {m.authorEmail && <p className="text-xs text-muted-foreground">{m.authorEmail}</p>}
                      <p className="mt-1 text-sm text-foreground/90">{m.message}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {new Date(m.createdAt).toLocaleString(locale === 'en' ? 'en-GB' : 'fr-FR')}
                      </p>
                    </div>
                    {canModerate && (
                      <div className="flex gap-1.5">
                        {m.status !== 'approved' && (
                          <Button variant="outline" size="sm" disabled={modId === m.id} onClick={() => void moderate(m.id, 'approved')}>
                            <Eye className="mr-1 size-3.5" aria-hidden />
                            {t('guestbook.approve')}
                          </Button>
                        )}
                        {m.status !== 'hidden' && (
                          <Button variant="outline" size="sm" disabled={modId === m.id} onClick={() => void moderate(m.id, 'hidden')}>
                            <EyeOff className="mr-1 size-3.5" aria-hidden />
                            {t('guestbook.hide')}
                          </Button>
                        )}
                        {m.status !== 'rejected' && (
                          <Button variant="ghost" size="sm" disabled={modId === m.id} onClick={() => void moderate(m.id, 'rejected')}>
                            <XCircle className="mr-1 size-3.5 text-destructive" aria-hidden />
                            {t('guestbook.reject')}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {gbPages > 1 && (
              <div className="flex items-center justify-between pt-1 text-sm">
                <p className="text-muted-foreground">{t('guestbook.page', { page: gbPage, total: gbPages, count: gbTotal })}</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={gbPage <= 1} onClick={() => setGbPage(gbPage - 1)}>{t('guestbook.prev')}</Button>
                  <Button variant="outline" size="sm" disabled={gbPage >= gbPages} onClick={() => setGbPage(gbPage + 1)}>{t('guestbook.next')}</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function GBBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const map: Record<string, { variant: 'secondary' | 'outline' | 'danger'; label: string }> = {
    approved: { variant: 'secondary', label: t('status.approved') },
    pending: { variant: 'outline', label: t('status.pending') },
    hidden: { variant: 'outline', label: t('status.hidden') },
    rejected: { variant: 'danger', label: t('status.rejected') },
  };
  const m = map[status] ?? map.pending;
  return <Badge variant={m.variant}>{m.label}</Badge>;
}
