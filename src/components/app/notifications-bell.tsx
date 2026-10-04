'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/api';
import { Bell, CheckCheck } from 'lucide-react';

interface InAppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

/**
 * Cloche « notifications produit » (CDC §26) : badge non-lues, liste des 30
 * dernières, action « tout marquer lu ». Chargement paresseux au clic.
 */
export function NotificationsBell() {
  const t = useTranslations('notifications');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InAppNotification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await apiFetch<{ notifications: InAppNotification[]; unreadCount: number }>(
      '/api/notifications',
    );
    if (res.ok && res.data) {
      setItems(res.data.notifications);
      setUnread(res.data.unreadCount);
    } else if (res.status === 409) {
      // Super admin (hors organisation) : aucune notification produit
      setItems([]);
      setUnread(0);
    }
  }, []);

  // Comptage initial léger + rechargement à l'ouverture
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    void load();
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, load]);

  async function markAllRead() {
    const res = await apiFetch('/api/notifications', { method: 'POST', body: JSON.stringify({ action: 'read_all' }) });
    if (res.ok) {
      setUnread(0);
      setItems((prev) => prev?.map((n) => ({ ...n, read: true })) ?? null);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        aria-label={t('title')}
        aria-expanded={open}
      >
        <Bell className="size-5" aria-hidden />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-80 rounded-xl border bg-background p-2 shadow-lg">
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="text-sm font-semibold">{t('title')}</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <CheckCheck className="size-3.5" aria-hidden />
                {t('markAllRead')}
              </button>
            )}
          </div>
          {items === null ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">{t('loading')}</p>
          ) : items.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="max-h-96 space-y-0.5 overflow-y-auto">
              {items.map((n) => (
                <li
                  key={n.id}
                  className={`rounded-lg px-2 py-2 text-xs ${n.read ? 'text-muted-foreground' : 'bg-accent/50 text-foreground'}`}
                >
                  <p className="font-medium">{n.title}</p>
                  <p className="mt-0.5 leading-snug">{n.body}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground/70">
                    {new Date(n.createdAt).toLocaleString('fr-FR')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
