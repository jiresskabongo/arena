'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, MonitorSmartphone, Check, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/api';

interface SessionRow {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

function deviceLabel(ua: string | null): { label: string; hint: string } {
  if (!ua) return { label: '—', hint: '' };
  const isMac = /macintosh|mac os x/i.test(ua);
  const isWin = /windows/i.test(ua);
  const isLinux = /linux/i.test(ua) && !isMac;
  const isAndroid = /android/i.test(ua);
  const isIos = /iphone|ipad|ipod/i.test(ua);
  const isMobile = /mobile|android|iphone/i.test(ua);

  let os = 'Inconnu';
  if (isWin) os = 'Windows';
  else if (isMac) os = 'macOS';
  else if (isIos) os = 'iOS';
  else if (isAndroid) os = 'Android';
  else if (isLinux) os = 'Linux';

  let browser = 'Inconnu';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/chrome|crios/i.test(ua)) browser = 'Chrome';
  else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
  else if (/firefox/i.test(ua)) browser = 'Firefox';

  return {
    label: `${browser} · ${os}`,
    hint: isMobile ? 'mobile' : 'desktop',
  };
}

export function SessionsTable() {
  const t = useTranslations('app.sessions');
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await apiFetch<{ sessions: SessionRow[] }>('/api/account/sessions');
    if (!result.ok) {
      setError(true);
      return;
    }
    setRows(result.data!.sessions);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string) {
    setBusyId(id);
    const result = await apiFetch<{ revokedCurrent?: boolean }>(`/api/account/sessions/${id}`, {
      method: 'DELETE',
    });
    setBusyId(null);
    if (!result.ok) {
      toast.error(t('revokeError'));
      return;
    }
    if (result.data?.revokedCurrent) {
      toast.success(t('loggedOut'));
      window.location.href = '/';
      return;
    }
    toast.success(t('revoked'));
    void load();
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-danger/40 bg-danger/5 p-6 text-center">
        <p className="text-sm text-danger">{t('loadError')}</p>
      </div>
    );
  }

  if (!rows) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted-foreground">{t('empty')}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 font-medium">{t('device')}</th>
            <th className="px-4 py-3 font-medium">{t('ip')}</th>
            <th className="px-4 py-3 font-medium">{t('lastSeen')}</th>
            <th className="px-4 py-3 font-medium">{t('expires')}</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const dev = deviceLabel(s.userAgent);
            return (
              <tr key={s.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <MonitorSmartphone className="size-4 text-muted-foreground" aria-hidden />
                    <div>
                      <p className="font-medium">
                        {dev.label}
                        {s.isCurrent && (
                          <Badge variant="success" className="ml-2">
                            {t('current')}
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">{dev.hint}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{s.ip ?? '—'}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(s.lastSeenAt).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(s.expiresAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  {!s.isCurrent ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger hover:bg-danger/10 hover:text-danger"
                      onClick={() => revoke(s.id)}
                      disabled={busyId === s.id}
                    >
                      {busyId === s.id ? (
                        <Loader2 className="animate-spin" aria-hidden />
                      ) : (
                        <Trash2 className="size-4" aria-hidden />
                      )}
                      {t('revoke')}
                    </Button>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-success">
                      <Check className="size-4" aria-hidden />
                      {t('active')}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
