'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Camera, CameraOff, Check, History, Loader2, Search, ScanLine, User, Wifi, WifiOff, X,
} from 'lucide-react';

export interface ScannerInit {
  agentToken: string;
  agent: {
    id: string;
    name: string;
    entryPoint: string;
    permissions: { canViewPhoto: boolean; canSearch: boolean; canSeeHistory: boolean };
  };
  event: {
    id: string;
    name: string;
    status: string;
    allowMultipleEntries: boolean;
    welcomeMessage: string | null;
    date: string;
    startTime: string;
    endTime: string | null;
    venue: string;
  };
}

type ScanStatus = 'valid' | 'already_used' | 'invalid' | 'expired';

interface ScanOutcome {
  status: ScanStatus;
  reason?: string;
  guest?: { name: string; category: string; tableName: string | null };
  welcome: string | null;
  meta?: { checkedInAt: string; first: boolean; entryPoint: string; offline?: boolean };
  at: string; // heure d'affichage locale
  offline: boolean;
}

interface CacheInvitation {
  token: string;
  guest: { name: string; category: string; rsvpStatus: string; companions: number };
  checkedInAt: string | null;
  expiresAt: string | null;
}

interface Cache {
  syncedAt: string;
  allowMultipleEntries: boolean;
  eventPublished: boolean;
  invitations: CacheInvitation[];
}

interface LogEntry {
  clientUuid: string;
  token: string;
  entryPoint: string;
  deviceId: string;
  clientAt: string;
  status: ScanStatus;
}

const cacheKey = (t: string) => `ef_scan_cache_${t}`;
const logKey = (t: string) => `ef_scan_log_${t}`;
const histKey = (t: string) => `ef_scan_hist_${t}`;

function deviceId(): string {
  try {
    let d = localStorage.getItem('ef_device_id');
    if (!d) {
      d = `dev-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem('ef_device_id', d);
    }
    return d;
  } catch {
    return 'dev-unknown';
  }
}

function extractToken(input: string): string {
  const v = input.trim();
  if (!v) return '';
  // URL complète (QR) → dernier segment du chemin
  if (v.includes('/')) {
    const seg = v.split('/').filter(Boolean);
    return seg[seg.length - 1] ?? '';
  }
  return v;
}

export function ScannerAppClient({ locale, init }: { locale: string; init: ScannerInit }) {
  const t = useTranslations('scanner');
  const [online, setOnline] = useState(true);
  const [input, setInput] = useState('');
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<ScanOutcome[]>([]);
  const [search, setSearch] = useState('');
  const [cache, setCache] = useState<Cache | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [cameraOn, setCameraOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<{ detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } | null>(null);
  const scanningRef = useRef(false);

  const dtFmt = useCallback(
    (iso: string) =>
      new Date(iso).toLocaleTimeString(locale === 'en' ? 'en-GB' : 'fr-FR', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }),
    [locale],
  );

  // ── Online / offline ──
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // ── Pré-sync (cache offline) ──
  const doSync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch(`/api/scanner/sync?agentToken=${encodeURIComponent(init.agentToken)}`);
      if (res.ok) {
        const data = (await res.json()) as Omit<Cache, 'syncedAt'> & { syncedAt: string };
        const c: Cache = { ...data, syncedAt: new Date().toISOString() };
        setCache(c);
        try { localStorage.setItem(cacheKey(init.agentToken), JSON.stringify(c)); } catch { /* quota */ }
      }
    } catch {
      /* hors ligne : on garde l'ancien cache */
    }
    setSyncing(false);
  }, [init.agentToken]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(cacheKey(init.agentToken));
      if (raw) {
        setCache(JSON.parse(raw) as Cache);
        const log = JSON.parse(localStorage.getItem(logKey(init.agentToken)) ?? '[]') as LogEntry[];
        setPendingCount(log.length);
        const hist = JSON.parse(localStorage.getItem(histKey(init.agentToken)) ?? '[]') as ScanOutcome[];
        setHistory(hist.slice(0, 50));
      }
    } catch { /* corrompu */ }
    void doSync();
    return () => {
      try { localStorage.removeItem(cacheKey(init.agentToken)); } catch { /* ok */ }
    };
  }, [init.agentToken, doSync]);

  // ── Replay au retour du réseau ──
  const replayLog = useCallback(async () => {
    let log: LogEntry[] = [];
    try {
      log = JSON.parse(localStorage.getItem(logKey(init.agentToken)) ?? '[]') as LogEntry[];
    } catch { /* vide */ }
    if (log.length === 0) return;
    try {
      const res = await fetch('/api/scanner/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentToken: init.agentToken,
          scans: log.map((l) => ({
            clientUuid: l.clientUuid, token: l.token, entryPoint: l.entryPoint,
            deviceId: l.deviceId, clientAt: l.clientAt,
          })),
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { results: { clientUuid: string; status: ScanStatus }[] };
        // Conflits : le serveur a déjà traité (scan en ligne entre-temps) → déjà utilisé
        const conflicts = data.results.filter((r) => r.status === 'already_used');
        if (conflicts.length > 0) {
          setHistory((h) => [
            ...h.map((x) => {
              if (x.meta?.offline && conflicts.some((c) => c.clientUuid === (x as ScanOutcome & { clientUuid?: string }).clientUuid)) {
                return { ...x, status: 'already_used' as ScanStatus };
              }
              return x;
            }),
          ]);
        }
        try { localStorage.removeItem(logKey(init.agentToken)); } catch { /* ok */ }
        setPendingCount(0);
        void doSync();
      }
    } catch {
      /* restera en attente */
    }
  }, [init.agentToken, doSync]);

  useEffect(() => {
    if (online) void replayLog();
  }, [online, replayLog]);

  // ── Résolution locale (offline) — mêmes règles que le serveur (§9.4) ──
  const resolveLocal = useCallback((token: string, clientAt: Date): ScanOutcome => {
    const now = clientAt.toISOString();
    const base = { at: now, offline: true };
    if (!cache) return { ...base, status: 'invalid', reason: 'no_cache', welcome: null };
    const row = cache.invitations.find((r) => r.token === token);
    if (!row) return { ...base, status: 'invalid', reason: 'unknown_token', welcome: null };
    if (!cache.eventPublished) return { ...base, status: 'invalid', reason: 'event_not_published', welcome: init.event.welcomeMessage, guest: { name: row.guest.name, category: row.guest.category, tableName: null } };
    if (row.expiresAt && new Date(row.expiresAt) < clientAt) {
      return { ...base, status: 'expired', reason: 'token_expired', welcome: init.event.welcomeMessage, guest: { name: row.guest.name, category: row.guest.category, tableName: null } };
    }
    const guest = { name: row.guest.name, category: row.guest.category, tableName: null };
    if (row.checkedInAt) {
      if (cache.allowMultipleEntries) {
        return { ...base, status: 'valid', guest, welcome: init.event.welcomeMessage, meta: { checkedInAt: now, first: false, entryPoint: init.agent.entryPoint, offline: true } };
      }
      return { ...base, status: 'already_used', guest, welcome: init.event.welcomeMessage, meta: { checkedInAt: row.checkedInAt, first: false, entryPoint: init.agent.entryPoint, offline: true } };
    }
    return { ...base, status: 'valid', guest, welcome: init.event.welcomeMessage, meta: { checkedInAt: now, first: true, entryPoint: init.agent.entryPoint, offline: true } };
  }, [cache, init]);

  // ── Scan (online ou offline) ──
  const runScan = useCallback(async (rawInput: string, viaCamera = false) => {
    const token = extractToken(rawInput);
    if (!token) return;
    setBusy(true);
    const clientAt = new Date();
    let outcome: ScanOutcome;
    let offline = !navigator.onLine;

    if (offline) {
      outcome = resolveLocal(token, clientAt);
      // Journal local append-only (replay plus tard)
      try {
        const log = JSON.parse(localStorage.getItem(logKey(init.agentToken)) ?? '[]') as LogEntry[];
        const clientUuid = crypto.randomUUID();
        log.push({ clientUuid, token, entryPoint: init.agent.entryPoint, deviceId: deviceId(), clientAt: clientAt.toISOString(), status: outcome.status });
        localStorage.setItem(logKey(init.agentToken), JSON.stringify(log));
        setPendingCount(log.length);
      } catch { /* plein */ }
    } else {
      try {
        const res = await fetch('/api/checkin/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentToken: init.agentToken,
            token,
            entryPoint: init.agent.entryPoint,
            deviceId: deviceId(),
            clientUuid: crypto.randomUUID(),
            clientAt: clientAt.toISOString(),
          }),
        });
        if (!res.ok) {
          // 429 / erreur réseau → bascule offline
          offline = true;
          outcome = resolveLocal(token, clientAt);
          if (offline) {
            try {
              const log = JSON.parse(localStorage.getItem(logKey(init.agentToken)) ?? '[]') as LogEntry[];
              const clientUuid = crypto.randomUUID();
              log.push({ clientUuid, token, entryPoint: init.agent.entryPoint, deviceId: deviceId(), clientAt: clientAt.toISOString(), status: outcome.status });
              localStorage.setItem(logKey(init.agentToken), JSON.stringify(log));
              setPendingCount(log.length);
            } catch { /* plein */ }
          }
        } else {
          const d = (await res.json()) as Omit<ScanOutcome, 'at' | 'offline'>;
          outcome = { ...d, at: new Date().toISOString(), offline: false };
        }
      } catch {
        offline = true;
        outcome = resolveLocal(token, clientAt);
      }
    }

    void viaCamera;
    setOutcome(outcome);
    setHistory((h) => {
      const next = [outcome, ...h].slice(0, 50);
      try { localStorage.setItem(histKey(init.agentToken), JSON.stringify(next)); } catch { /* plein */ }
      return next;
    });
    setInput('');
    setBusy(false);
  }, [init, resolveLocal]);

  // ── Caméra (BarcodeDetector natif, sinon saisie manuelle) ──
  const canCamera = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  const toggleCamera = useCallback(async () => {
    if (cameraOn) {
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
      scanningRef.current = false;
      setCameraOn(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
      const Det = (window as unknown as { BarcodeDetector: new (o?: object) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
      detectorRef.current = new Det({ formats: ['qr_code'] });
      setCameraOn(true);
      scanningRef.current = true;
    } catch {
      setCameraOn(false);
    }
  }, [cameraOn]);

  useEffect(() => {
    if (!cameraOn) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const loop = async () => {
      if (stopped || !scanningRef.current) return;
      const video = videoRef.current;
      const det = detectorRef.current;
      if (video && det && video.readyState === 4) {
        try {
          const codes = await det.detect(video);
          if (codes.length > 0 && codes[0].rawValue) {
            scanningRef.current = false; // 1 scan à la fois
            void runScan(codes[0].rawValue, true);
          }
        } catch { /* frame manquante */ }
      }
      timer = setTimeout(loop, 250);
    };
    void loop();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
  }, [cameraOn, runScan]);

  // ── Recherche invité (dans le cache sync) ──
  const results = cache && search.trim().length >= 2
    ? cache.invitations
      .filter((r) => r.guest.name.toLowerCase().includes(search.trim().toLowerCase()))
      .slice(0, 10)
    : [];

  const statusStyles: Record<ScanStatus, { ring: string; icon: React.ReactNode; label: string }> = {
    valid: {
      ring: 'border-emerald-500/60 bg-emerald-500/10',
      icon: <Check className="size-10 text-emerald-500" aria-hidden />,
      label: t('result.valid'),
    },
    already_used: {
      ring: 'border-amber-500/60 bg-amber-500/10',
      icon: <History className="size-10 text-amber-500" aria-hidden />,
      label: t('result.already_used'),
    },
    invalid: {
      ring: 'border-red-500/60 bg-red-500/10',
      icon: <X className="size-10 text-red-500" aria-hidden />,
      label: t('result.invalid'),
    },
    expired: {
      ring: 'border-muted bg-muted/40',
      icon: <X className="size-10 text-muted-foreground" aria-hidden />,
      label: t('result.expired'),
    },
  };

  return (
    <div className="min-h-screen bg-surface pb-10">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-2 px-4 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-primary">
              <ScanLine className="size-3.5" aria-hidden />
              EventFlow
            </p>
            <h1 className="truncate font-display text-lg font-semibold leading-tight">{init.event.name}</h1>
            <p className="text-[11px] text-muted-foreground">
              {init.agent.name} · {t(`entry.${init.agent.entryPoint}` as never)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                online ? 'bg-emerald-500/10 text-emerald-700' : 'bg-red-500/10 text-red-700'
              }`}
            >
              {online ? <Wifi className="size-3" aria-hidden /> : <WifiOff className="size-3" aria-hidden />}
              {online ? t('online') : t('offline')}
            </span>
            {pendingCount > 0 && (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                {t('pendingSync', { n: pendingCount })}
              </span>
            )}
            {syncing && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg space-y-4 px-4 pt-4">
        {/* Saisie */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void runScan(input); }}
                  placeholder={t('inputPlaceholder')}
                  className="h-11"
                  autoFocus
                />
              </div>
              <Button onClick={() => void runScan(input)} disabled={busy || !input.trim()} className="h-11 gap-2">
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ScanLine className="size-4" aria-hidden />}
                {t('scan')}
              </Button>
              {canCamera && (
                <Button variant={cameraOn ? 'default' : 'outline'} onClick={() => void toggleCamera()} className="h-11 px-3" title={t('camera')}>
                  {cameraOn ? <CameraOff className="size-4" aria-hidden /> : <Camera className="size-4" aria-hidden />}
                </Button>
              )}
            </div>
            <video ref={videoRef} className={`h-40 w-full rounded-lg bg-black object-cover ${cameraOn ? '' : 'hidden'}`} muted playsInline />
            {!canCamera && (
              <p className="text-[11px] text-muted-foreground">{t('noCamera')}</p>
            )}
          </CardContent>
        </Card>

        {/* Résultat */}
        {outcome && (
          <div className={`rounded-2xl border p-5 text-center ${statusStyles[outcome.status].ring}`}>
            <div className="flex flex-col items-center">
              {statusStyles[outcome.status].icon}
              <p className="mt-2 text-xl font-semibold">{statusStyles[outcome.status].label}</p>
              {outcome.guest && (
                <div className="mt-2 text-sm text-muted-foreground">
                  <p className="flex items-center justify-center gap-1.5 font-medium text-foreground">
                    <User className="size-4" aria-hidden />
                    {outcome.guest.name}
                  </p>
                  <p className="mt-0.5 text-xs">
                    {t(`category.${outcome.guest.category}` as never)}
                    {outcome.guest.tableName ? ` · ${t('table')} ${outcome.guest.tableName}` : ''}
                  </p>
                </div>
              )}
              {outcome.meta?.offline && (
                <p className="mt-2 flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  <WifiOff className="size-3" aria-hidden />
                  {t('offlineScan')}
                </p>
              )}
              {outcome.welcome && outcome.status === 'valid' && (
                <p className="mt-3 rounded-lg bg-background/60 px-3 py-2 text-xs italic text-muted-foreground">
                  « {outcome.welcome} »
                </p>
              )}
              {outcome.meta && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {dtFmt(outcome.meta.checkedInAt)} · {t(`entry.${outcome.meta.entryPoint}` as never)}
                  {!outcome.meta.first && ` · ${t('firstEntryAt')}`}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Recherche invité */}
        {init.agent.permissions.canSearch && (
          <Card>
            <CardContent className="space-y-2 p-4">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchPlaceholder')} className="pl-8" />
              </div>
              {results.length > 0 && (
                <ul className="divide-y text-sm">
                  {results.map((r) => (
                    <li key={r.token} className="flex items-center justify-between py-2">
                      <div>
                        <p className="font-medium">{r.guest.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {t(`category.${r.guest.category}` as never)} · RSVP {t(`rsvp.${r.guest.rsvpStatus}` as never)}
                          {r.guest.companions > 0 ? ` · +${r.guest.companions}` : ''}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          r.checkedInAt
                            ? 'bg-emerald-500/10 text-emerald-700'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {r.checkedInAt ? t('present') : t('notPresent')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {/* Historique session */}
        {init.agent.permissions.canSeeHistory && history.length > 0 && (
          <Card>
            <CardContent className="space-y-2 p-4">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <History className="size-4 text-primary" aria-hidden />
                {t('historyTitle')}
              </h2>
              <ul className="max-h-64 divide-y overflow-y-auto text-sm">
                {history.map((h, i) => (
                  <li key={`${h.at}-${i}`} className="flex items-center justify-between py-1.5">
                    <span className={`h-2 w-2 rounded-full ${h.status === 'valid' ? 'bg-emerald-500' : h.status === 'already_used' ? 'bg-amber-500' : 'bg-red-500'}`} aria-hidden />
                    <span className="ml-2 flex-1 truncate">
                      {h.guest?.name ?? t('unknownGuest')}
                    </span>
                    <span className="text-xs text-muted-foreground">{dtFmt(h.at)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-[11px] text-muted-foreground/60">{t('footer')}</p>
      </main>
    </div>
  );
}
