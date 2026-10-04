'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, FlaskConical, Loader2,
  Mail, MessageSquare, Send, Sparkles, Zap,
} from 'lucide-react';

type Tab = 'campaigns' | 'templates' | 'automations' | 'outbox';

interface Campaign {
  id: string; type: string; channel: string; templateKey: string;
  audience: { scope: string; ids?: string[] };
  status: string; sentCount: number; failedCount: number;
  scheduledAt: string | null; createdAt: string;
}

interface Template {
  id: string; key: string; channel: string;
  subjectFr: string | null; subjectEn: string | null;
  bodyFr: string; bodyEn: string;
  active: boolean; isPlatform: boolean; isOverridden: boolean;
}

interface Automation {
  id: string; name: string; trigger: string;
  condition: Record<string, unknown> | null;
  action: Record<string, unknown>;
  active: boolean; lastRunAt: string | null;
}

interface OutboxItem {
  id: string; channel: string; recipient: string; guest: string | null;
  templateKey: string | null; subject: string | null; body: string;
  status: string; provider: string; error: string | null; createdAt: string;
}

const CHANNELS = ['email', 'sms', 'whatsapp'] as const;
const TYPES = ['invitation', 'confirmation', 'reminder', 'change', 'custom'] as const;
const TRIGGERS = ['rsvp_confirmed', 'event_48h', 'event_24h'] as const;

export function CommunicationsPageClient({
  eventId, eventName, locale, canSend,
}: {
  eventId: string;
  eventName: string;
  locale: string;
  canSend: boolean;
}) {
  const t = useTranslations('events.communications');
  const [tab, setTab] = useState<Tab>('campaigns');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [outboxTotal, setOutboxTotal] = useState(0);
  const [outboxPage, setOutboxPage] = useState(1);
  const [outboxPages, setOutboxPages] = useState(1);
  const [outboxChannel, setOutboxChannel] = useState('all');
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Formulaire campagne
  const [form, setForm] = useState({
    type: 'invitation', channel: 'email', templateKey: 'invitation',
    audience: 'all', subject: '', body: '',
  });
  const [creating, setCreating] = useState(false);
  // Édition template
  const [editTpl, setEditTpl] = useState<Template | null>(null);
  const [tplForm, setTplForm] = useState({ subjectFr: '', bodyFr: '', active: true });
  const [savingTpl, setSavingTpl] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, a, o] = await Promise.all([
      apiFetch<{ campaigns: Campaign[] }>(`/api/events/${eventId}/campaigns`),
      apiFetch<{ automations: Automation[] }>(`/api/events/${eventId}/automations`),
      apiFetch<{ items: OutboxItem[]; total: number; totalPages: number }>(
        `/api/outbox?page=${outboxPage}&pageSize=25&channel=${outboxChannel}`,
      ),
    ]);
    if (c.ok && c.data) setCampaigns(c.data.campaigns);
    if (a.ok && a.data) setAutomations(a.data.automations);
    if (o.ok && o.data) {
      setOutbox(o.data.items);
      setOutboxTotal(o.data.total);
      setOutboxPages(o.data.totalPages);
    }
    setLoading(false);
  }, [eventId, outboxPage, outboxChannel]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    apiFetch<{ templates: Template[] }>('/api/notifications/templates')
      .then((res) => { if (res.ok && res.data) setTemplates(res.data.templates); })
      .catch(() => {});
  }, []);

  async function createCampaign() {
    setCreating(true);
    const res = await apiFetch<{ campaign: Campaign }>(`/api/events/${eventId}/campaigns`, {
      method: 'POST',
      body: JSON.stringify({
        type: form.type,
        channel: form.channel,
        templateKey: form.type === 'custom' ? undefined : form.templateKey,
        audience: form.audience,
        subject: form.type === 'custom' ? form.subject : undefined,
        body: form.type === 'custom' ? form.body : undefined,
      }),
    });
    setCreating(false);
    if (res.ok && res.data) {
      toast.success(t('campaignCreated'));
      const cid = res.data.campaign.id;
      // Envoi immédiat (mock)
      setSendingId(cid);
      const send = await apiFetch<{ sent: number; failed: number }>(
        `/api/events/${eventId}/campaigns/${cid}/send`,
        { method: 'POST' },
      );
      setSendingId(null);
      if (send.ok && send.data) {
        toast.success(t('campaignSent', { sent: send.data.sent }));
      } else {
        toast.error(send.error?.message ?? t('error'));
      }
      void load();
    } else {
      toast.error(res.error?.message ?? t('error'));
    }
  }

  async function sendCampaign(cid: string) {
    setSendingId(cid);
    const res = await apiFetch<{ sent: number; failed: number }>(
      `/api/events/${eventId}/campaigns/${cid}/send`,
      { method: 'POST' },
    );
    setSendingId(null);
    if (res.ok && res.data) {
      toast.success(t('campaignSent', { sent: res.data.sent }));
      void load();
    } else {
      toast.error(res.error?.message ?? t('error'));
    }
  }

  async function toggleAutomation(a: Automation) {
    const res = await apiFetch(`/api/events/${eventId}/automations`, {
      method: 'POST',
      body: JSON.stringify({ trigger: a.trigger, active: !a.active }),
    });
    if (res.ok && res.data) {
      setAutomations((prev) => prev.map((x) => (x.trigger === a.trigger ? { ...x, active: !x.active } : x)));
      toast.success(!a.active ? t('automationOn') : t('automationOff'));
    } else {
      toast.error(res.error?.message ?? t('error'));
    }
  }

  async function saveTemplate() {
    if (!editTpl) return;
    setSavingTpl(true);
    const res = await apiFetch('/api/notifications/templates', {
      method: 'PUT',
      body: JSON.stringify({
        key: editTpl.key,
        channel: editTpl.channel,
        subjectFr: tplForm.subjectFr,
        bodyFr: tplForm.bodyFr,
        active: tplForm.active,
      }),
    });
    setSavingTpl(false);
    if (res.ok && res.data) {
      toast.success(t('templateSaved'));
      setEditTpl(null);
      apiFetch<{ templates: Template[] }>('/api/notifications/templates')
        .then((r) => { if (r.ok && r.data) setTemplates(r.data.templates); })
        .catch(() => {});
    } else {
      toast.error(res.error?.message ?? t('error'));
    }
  }

  const channelIcon = (c: string) =>
    c === 'email' ? <Mail className="size-4" aria-hidden /> :
    c === 'sms' ? <MessageSquare className="size-4" aria-hidden /> :
    <Zap className="size-4" aria-hidden />;

  const dtFmt = (iso: string) =>
    new Date(iso).toLocaleString(locale === 'en' ? 'en-GB' : 'fr-FR');

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
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
          <Send className="size-5 text-primary" aria-hidden />
          {t('title')}
        </h1>
      </div>

      {/* Badges démo */}
      <div className="flex flex-wrap gap-2">
        {['email', 'sms', 'whatsapp'].map((c) => (
          <span key={c} className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/5 px-2.5 py-1 text-[11px] font-medium text-amber-700">
            <FlaskConical className="size-3.5" aria-hidden />
            {t(`channel.${c}` as never)} — {t('demo')}
          </span>
        ))}
      </div>

      {/* Onglets */}
      <div className="flex flex-wrap gap-1 rounded-lg border p-1 text-sm w-fit">
        {(['campaigns', 'templates', 'automations', 'outbox'] as Tab[]).map((tb) => (
          <button
            key={tb}
            type="button"
            onClick={() => setTab(tb)}
            className={`rounded-md px-3 py-1.5 font-medium transition ${tab === tb ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >
            {t(`tab.${tb}` as never)}
            {tb === 'outbox' && outboxTotal > 0 && (
              <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] tabular-nums">{outboxTotal}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
          {t('loading')}
        </div>
      ) : (
        <>
          {/* ── Campagnes ── */}
          {tab === 'campaigns' && (
            <div className="space-y-4">
              {canSend && (
                <Card>
                  <CardContent className="space-y-3 pt-6">
                    <h2 className="text-sm font-semibold">{t('newCampaign')}</h2>
                    <div className="flex flex-wrap items-end gap-2">
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">{t('type')}</label>
                        <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="h-9 rounded-md border bg-background px-2 text-sm">
                          {TYPES.map((ty) => <option key={ty} value={ty}>{t(`type.${ty}` as never)}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">{t('channel')}</label>
                        <select value={form.channel} onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))} className="h-9 rounded-md border bg-background px-2 text-sm">
                          {CHANNELS.map((c) => <option key={c} value={c}>{t(`channel.${c}` as never)}</option>)}
                        </select>
                      </div>
                      {form.type !== 'custom' && (
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">{t('template')}</label>
                          <select
                            value={form.templateKey}
                            onChange={(e) => setForm((f) => ({ ...f, templateKey: e.target.value }))}
                            className="h-9 rounded-md border bg-background px-2 text-sm"
                          >
                            {(() => {
                              // Dé-dup par clé (la surcharge org prime sur la plateforme)
                              const byKey = new Map<string, Template>();
                              for (const tp of templates) {
                                if (tp.channel !== form.channel || !tp.active) continue;
                                const prev = byKey.get(tp.key);
                                if (!prev || !tp.isPlatform) byKey.set(tp.key, tp);
                              }
                              return [...byKey.values()].map((tp) => (
                                <option key={`${tp.key}:${tp.channel}`} value={tp.key}>
                                  {tp.key}{!tp.isPlatform ? ' (surcharge)' : ''}
                                </option>
                              ));
                            })()}
                          </select>
                        </div>
                      )}
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">{t('audience')}</label>
                        <select value={form.audience} onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value }))} className="h-9 rounded-md border bg-background px-2 text-sm">
                          <option value="all">{t('audience.all')}</option>
                          <option value="rsvp_pending">{t('audience.rsvp_pending')}</option>
                          <option value="confirmed">{t('audience.confirmed')}</option>
                          <option value="declined">{t('audience.declined')}</option>
                        </select>
                      </div>
                      <Button onClick={createCampaign} disabled={creating || sendingId !== null} className="gap-2">
                        {creating || sendingId ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
                        {t('createAndSend')}
                      </Button>
                    </div>
                    {form.type === 'custom' && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input
                          value={form.subject}
                          onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                          placeholder={t('subjectPlaceholder')}
                          className="h-9 text-sm"
                          maxLength={160}
                        />
                        <Input
                          value={form.body}
                          onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                          placeholder={t('bodyPlaceholder')}
                          className="h-9 text-sm"
                          maxLength={4000}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardContent className="space-y-2 pt-6">
                  <h2 className="text-sm font-semibold">{t('campaignHistory')}</h2>
                  {campaigns.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('noCampaigns')}</p>
                  ) : (
                    <div className="divide-y">
                      {campaigns.map((c) => (
                        <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                          <div className="flex items-center gap-2.5">
                            {channelIcon(c.channel)}
                            <div>
                              <p className="text-sm font-medium">
                                {t(`type.${c.type}` as never)}
                                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                                  {t(`channel.${c.channel}` as never)}
                                </span>
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {t(`audience.${c.audience.scope}` as never)} · {dtFmt(c.createdAt)}
                                {c.status === 'sent' && (
                                  <span className="ml-2 text-emerald-600">
                                    {t('sent', { sent: c.sentCount, failed: c.failedCount })}
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                          {canSend && c.status !== 'sent' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void sendCampaign(c.id)}
                              disabled={sendingId === c.id}
                            >
                              {sendingId === c.id ? <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden /> : <Send className="mr-1 size-3.5" aria-hidden />}
                              {t('send')}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* ── Templates ── */}
          {tab === 'templates' && (
            <Card>
              <CardContent className="space-y-2 pt-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">{t('templatesTitle')}</h2>
                  <p className="text-xs text-muted-foreground">
                    {t('variablesHint', { vars: '{{guest_name}} {{event_name}} {{event_date}} {{event_location}} {{rsvp_url}} {{invitation_url}}' })}
                  </p>
                </div>
                {editTpl && (
                  <div className="space-y-2 rounded-lg border p-3">
                    <p className="text-sm font-medium">{editTpl.key} · {t(`channel.${editTpl.channel}` as never)}</p>
                    <Input
                      value={tplForm.subjectFr}
                      onChange={(e) => setTplForm((f) => ({ ...f, subjectFr: e.target.value }))}
                      placeholder={t('subjectPlaceholder')}
                      className="h-9 text-sm"
                      maxLength={160}
                    />
                    <textarea
                      value={tplForm.bodyFr}
                      onChange={(e) => setTplForm((f) => ({ ...f, bodyFr: e.target.value }))}
                      rows={5}
                      className="w-full rounded-md border bg-background p-2 text-sm"
                    />
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <input type="checkbox" checked={tplForm.active} onChange={(e) => setTplForm((f) => ({ ...f, active: e.target.checked }))} />
                        {t('templateActive')}
                      </label>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setEditTpl(null)}>{t('cancel')}</Button>
                        <Button size="sm" onClick={saveTemplate} disabled={savingTpl}>
                          {savingTpl ? <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden /> : null}
                          {t('save')}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                <div className="divide-y">
                  {templates.map((tp) => (
                    <div key={`${tp.key}:${tp.channel}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        {channelIcon(tp.channel)}
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {tp.key}
                            <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                              {t(`channel.${tp.channel}` as never)}
                            </span>
                            {tp.isPlatform && (
                              <span className="ml-2 rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                                {t('platform')}
                              </span>
                            )}
                            {tp.isOverridden && (
                              <span className="ml-2 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                                {t('overridden')}
                              </span>
                            )}
                          </p>
                          <p className="truncate text-xs text-muted-foreground" title={tp.bodyFr}>
                            {tp.subjectFr ?? tp.bodyFr.slice(0, 80)}
                          </p>
                        </div>
                      </div>
                      {canSend && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditTpl(tp);
                            setTplForm({
                              subjectFr: tp.subjectFr ?? '',
                              bodyFr: tp.bodyFr,
                              active: tp.active,
                            });
                          }}
                        >
                          {t('edit')}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Automatisations ── */}
          {tab === 'automations' && (
            <Card>
              <CardContent className="space-y-2 pt-6">
                <h2 className="text-sm font-semibold">{t('automationsTitle')}</h2>
                {TRIGGERS.map((tr) => {
                  const a = automations.find((x) => x.trigger === tr);
                  return (
                    <div key={tr} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                      <div className="flex items-center gap-2.5">
                        <Sparkles className="size-4 text-primary" aria-hidden />
                        <div>
                          <p className="text-sm font-medium">{t(`trigger.${tr}` as never)}</p>
                          <p className="text-xs text-muted-foreground">{t(`triggerBody.${tr}` as never)}</p>
                          {a?.lastRunAt && (
                            <p className="text-[11px] text-muted-foreground/70">{t('lastRun', { at: dtFmt(a.lastRunAt) })}</p>
                          )}
                        </div>
                      </div>
                      {canSend && (
                        <button
                          type="button"
                          onClick={() => a ? void toggleAutomation(a) : void (async () => {
                            const res = await apiFetch<{ automation: Automation }>(
                              `/api/events/${eventId}/automations`,
                              {
                                method: 'POST',
                                body: JSON.stringify({ trigger: tr, active: true }),
                              },
                            );
                            const data = res.data;
                            if (res.ok && data) {
                              setAutomations((prev) => [...prev, data.automation]);
                              toast.success(t('automationOn'));
                            }
                          })()}
                          className={`relative h-6 w-11 rounded-full transition ${a?.active ? 'bg-emerald-500' : 'bg-muted-foreground/30'}`}
                          role="switch"
                          aria-checked={a?.active ?? false}
                        >
                          <span
                            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${a?.active ? 'left-[22px]' : 'left-0.5'}`}
                          />
                        </button>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* ── Outbox ── */}
          {tab === 'outbox' && (
            <Card>
              <CardContent className="space-y-3 pt-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-sm font-semibold">
                    {t('outboxTitle')}
                    <span className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/5 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                      <FlaskConical className="size-3" aria-hidden />
                      {t('demo')}
                    </span>
                  </h2>
                  <select
                    value={outboxChannel}
                    onChange={(e) => { setOutboxChannel(e.target.value); setOutboxPage(1); }}
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                  >
                    <option value="all">{t('filter.all')}</option>
                    <option value="email">{t('channel.email')}</option>
                    <option value="sms">{t('channel.sms')}</option>
                    <option value="whatsapp">{t('channel.whatsapp')}</option>
                  </select>
                </div>
                {outbox.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">{t('outboxEmpty')}</p>
                ) : (
                  <div className="divide-y">
                    {outbox.map((m) => (
                      <div key={m.id} className="py-2.5">
                        <button
                          type="button"
                          onClick={() => setExpanded(expanded === m.id ? null : m.id)}
                          className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            {channelIcon(m.channel)}
                            <span className="min-w-0">
                              <span className="block truncate text-sm">
                                {m.subject ?? m.body.slice(0, 60)}
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                {m.recipient}
                                {m.guest ? ` · ${m.guest}` : ''} · {dtFmt(m.createdAt)}
                              </span>
                            </span>
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                              {m.status}
                            </span>
                            {expanded === m.id ? <ChevronDown className="size-4 text-muted-foreground" aria-hidden /> : <ChevronRight className="size-4 text-muted-foreground" aria-hidden />}
                          </span>
                        </button>
                        {expanded === m.id && (
                          <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-xs text-foreground">
                            {m.body}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {outboxPages > 1 && (
                  <div className="flex items-center justify-between pt-1 text-sm">
                    <p className="text-muted-foreground">{t('pageOf', { page: outboxPage, total: outboxPages })}</p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={outboxPage <= 1} onClick={() => setOutboxPage(outboxPage - 1)}>
                        {t('prev')}
                      </Button>
                      <Button variant="outline" size="sm" disabled={outboxPage >= outboxPages} onClick={() => setOutboxPage(outboxPage + 1)}>
                        {t('next')}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
