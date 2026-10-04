'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Loader2, Copy, Check } from 'lucide-react';

interface EventOpt { id: string; name: string }

interface UsageItem {
  id: string;
  operation: string;
  creditsCost: number;
  creditsRefunded: number;
  status: string;
  inputSummary: string | null;
  createdAt: string;
  user: { firstName: string; lastName: string } | null;
}

interface Monthly { consumed: number; cost: number; refunded: number }

export function AiDialog({ events }: { events: EventOpt[] }) {
  const t = useTranslations('designs');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'generate' | 'history'>('generate');
  const [kind, setKind] = useState<'design' | 'text'>('design');
  const [prompt, setPrompt] = useState('');
  const [eventRef, setEventRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultText, setResultText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Historique
  const [history, setHistory] = useState<UsageItem[] | null>(null);
  const [monthly, setMonthly] = useState<Monthly | null>(null);
  const [hPage, setHPage] = useState(1);
  const [hTotalPages, setHTotalPages] = useState(1);
  const [hLoading, setHLoading] = useState(false);

  const loadHistory = useCallback(async (page = 1) => {
    setHLoading(true);
    const res = await apiFetch<{ items: UsageItem[]; totalPages: number; month: Monthly }>(
      `/api/ai/usage?pageSize=10&page=${page}`,
    );
    setHLoading(false);
    if (res.ok && res.data) {
      setHistory(res.data.items);
      setMonthly(res.data.month);
      setHTotalPages(res.data.totalPages);
      setHPage(page);
    }
  }, []);

  useEffect(() => {
    if (open && tab === 'history') void loadHistory(1);
  }, [open, tab, loadHistory]);

  function close() {
    setOpen(false);
    setError(null);
    setResultText(null);
    setTab('generate');
    setCopied(false);
  }

  async function generate() {
    if (prompt.trim().length < 3) {
      setError(t('ai.promptRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    setResultText(null);
    const res = await apiFetch<{
      usage: { status: string; creditsCost: number };
      designId: string | null;
      text: string | null;
      remainingCredits: number;
    }>('/api/ai/generate', {
      method: 'POST',
      body: JSON.stringify({
        kind,
        prompt: prompt.trim(),
        eventRef: eventRef || undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error?.message ?? t('ai.error'));
      if (res.data?.usage?.status === 'failed') void loadHistory(1);
      return;
    }
    if (res.data?.designId) {
      close();
      router.push(`/designs/${res.data.designId}`);
      router.refresh();
    } else if (res.data?.text) {
      setResultText(res.data.text);
      void loadHistory(1);
    }
  }

  function copyText() {
    if (!resultText) return;
    void navigator.clipboard.writeText(resultText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => { setOpen(true); setError(null); setResultText(null); }}
        className="gap-2"
      >
        <Sparkles className="size-4 text-primary" aria-hidden />
        {t('ai.open')}
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-12"
          onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <div className="w-full max-w-xl rounded-xl border bg-background p-6 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{t('ai.title')}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('ai.subtitle')}</p>
              </div>
              <Badge variant="warning">{t('ai.demoBadge')}</Badge>
            </div>

            {/* Onglets */}
            <div className="mt-4 flex gap-1 border-b">
              {(['generate', 'history'] as const).map((tb) => (
                <button
                  key={tb}
                  type="button"
                  onClick={() => setTab(tb)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
                    tab === tb
                      ? 'border-primary font-medium text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tb === 'generate' ? t('ai.tabGenerate') : t('ai.tabHistory')}
                </button>
              ))}
            </div>

            {tab === 'generate' ? (
              <div className="mt-4 space-y-4">
                {monthly && (
                  <p className="text-xs text-muted-foreground">
                    {t('ai.credits', { used: monthly.consumed })}
                  </p>
                )}
                <div className="flex gap-2">
                  {(['design', 'text'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      className={`flex-1 rounded-md border px-3 py-2 text-sm transition ${
                        kind === k
                          ? 'border-primary bg-primary/10 font-medium text-primary'
                          : 'text-muted-foreground hover:border-primary/40'
                      }`}
                    >
                      {k === 'design' ? t('ai.kindDesign') : t('ai.kindText')}
                      <span className="ml-1.5 text-xs opacity-70">
                        ({k === 'design' ? t('ai.costDesign') : t('ai.costText')})
                      </span>
                    </button>
                  ))}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ai-prompt">{t('ai.prompt')}</Label>
                  <textarea
                    id="ai-prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={3}
                    maxLength={1000}
                    placeholder={t('ai.promptPlaceholder')}
                    className="w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ai-event">{t('ai.event')}</Label>
                  <select
                    id="ai-event"
                    value={eventRef}
                    onChange={(e) => setEventRef(e.target.value)}
                    className="h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-sm"
                  >
                    <option value="">{t('ai.eventNone')}</option>
                    {events.map((ev) => (
                      <option key={ev.id} value={ev.id}>{ev.name}</option>
                    ))}
                  </select>
                </div>
                {resultText && (
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">{t('ai.result')}</span>
                      <Button variant="ghost" size="sm" onClick={copyText} className="gap-1 h-7 text-xs">
                        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                        {t('ai.copy')}
                      </Button>
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{resultText}</p>
                  </div>
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={close}>{t('cancel')}</Button>
                  <Button onClick={generate} disabled={busy} className="gap-2">
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    {busy ? t('ai.generating') : t('ai.generate')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-4">
                {hLoading ? (
                  <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> {t('ai.historyLoading')}
                  </div>
                ) : history && history.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">{t('ai.historyEmpty')}</p>
                ) : history ? (
                  <>
                    <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
                      {history.map((u) => (
                        <li key={u.id} className="rounded-lg border p-3 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">
                              {u.operation === 'design' ? t('ai.kindDesign') : t('ai.kindText')}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                u.status === 'success'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : u.status === 'failed'
                                    ? 'bg-red-100 text-red-800'
                                    : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {u.status === 'success' ? t('ai.statusSuccess')
                                : u.status === 'failed' ? t('ai.statusFailed') : t('ai.statusPending')}
                            </span>
                          </div>
                          {u.inputSummary && (
                            <p className="mt-1 truncate text-xs text-muted-foreground">« {u.inputSummary} »</p>
                          )}
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t('ai.usageCost', { cost: u.creditsCost })}
                            {u.creditsRefunded > 0 && (
                              <span className="text-emerald-700"> · {t('ai.usageRefunded', { r: u.creditsRefunded })}</span>
                            )}
                            {' · '}
                            {new Date(u.createdAt).toLocaleString()}
                          </p>
                        </li>
                      ))}
                    </ul>
                    {hTotalPages > 1 && (
                      <div className="mt-3 flex items-center justify-center gap-2 text-sm">
                        <Button variant="outline" size="sm" disabled={hPage <= 1} onClick={() => void loadHistory(hPage - 1)}>
                          {t('ai.prev')}
                        </Button>
                        <span className="text-muted-foreground">
                          {t('ai.page', { page: hPage, total: hTotalPages })}
                        </span>
                        <Button variant="outline" size="sm" disabled={hPage >= hTotalPages} onClick={() => void loadHistory(hPage + 1)}>
                          {t('ai.next')}
                        </Button>
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
