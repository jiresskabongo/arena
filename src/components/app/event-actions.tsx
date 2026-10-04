'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiFetch } from '@/lib/api';
import {
  CheckCircle2, Archive, Copy, Trash2, Loader2, ExternalLink, Undo2,
} from 'lucide-react';

export function EventActions({
  eventId, status, slug, canUpdate, canDelete,
}: {
  eventId: string;
  status: string;
  slug: string;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations('events.detail');
  const locale = useLocale();
  const router = useRouter();
  // localePrefix « as-needed » : FR (défaut) sans préfixe, EN → /en/…
  const publicHref = locale === 'fr' ? `/e/${slug}` : `/${locale}/e/${slug}`;
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function run(action: string, fn: () => Promise<void>) {
    setBusy(action);
    try {
      await fn();
    } finally {
      setBusy(null);
      setConfirmDelete(false);
    }
  }

  async function setStatus(status: string) {
    const res = await apiFetch(`/api/events/${eventId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      toast.success(res.status === 200 ? t(`done.${status}`) : t('updated'));
      router.refresh();
    } else {
      toast.error(res.error?.message ?? t('actionError'));
    }
  }

  async function duplicate() {
    const res = await apiFetch(`/api/events/${eventId}/duplicate`, { method: 'POST' });
    if (res.ok) {
      const d = res.data as { event?: { slug: string } } | null;
      toast.success(t('duplicated'));
      if (d?.event?.slug) router.push(`/events?dup=${d.event.slug}`);
      router.refresh();
    } else {
      toast.error(res.error?.message ?? t('actionError'));
    }
  }

  async function remove() {
    const res = await apiFetch(`/api/events/${eventId}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success(t('deleted'));
      router.push('/events');
      router.refresh();
    } else if (res.error?.code === 'archive_required') {
      setConfirmDelete(false);
      toast.error(res.error.message);
    } else {
      toast.error(res.error?.message ?? t('actionError'));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={status === 'published' ? 'success' : status === 'archived' ? 'secondary' : 'outline'}>
          {t(`status.${status}`)}
        </Badge>
        {status === 'published' && (
          <Button variant="outline" size="sm" asChild>
            <Link href={publicHref} target="_blank">
              <ExternalLink className="size-4" aria-hidden />
              {t('viewPublic')}
            </Link>
          </Button>
        )}
      </div>

      {canUpdate && (
        <div className="flex flex-wrap gap-2">
          {status === 'draft' && (
            <Button size="sm" onClick={() => run('publish', () => setStatus('published'))} disabled={busy !== null} className="gap-1.5">
              {busy === 'publish' ? <Loader2 className="animate-spin size-4" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}
              {t('publish')}
            </Button>
          )}
          {status === 'published' && (
            <Button size="sm" variant="outline" onClick={() => run('unpublish', () => setStatus('draft'))} disabled={busy !== null} className="gap-1.5">
              {busy === 'unpublish' ? <Loader2 className="animate-spin size-4" aria-hidden /> : <Undo2 className="size-4" aria-hidden />}
              {t('unpublish')}
            </Button>
          )}
          {status !== 'archived' ? (
            <Button size="sm" variant="outline" onClick={() => run('archive', () => setStatus('archived'))} disabled={busy !== null} className="gap-1.5">
              {busy === 'archive' ? <Loader2 className="animate-spin size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
              {t('archive')}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => run('restore', () => setStatus('draft'))} disabled={busy !== null} className="gap-1.5">
              {busy === 'restore' ? <Loader2 className="animate-spin size-4" aria-hidden /> : <Undo2 className="size-4" aria-hidden />}
              {t('restore')}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => run('duplicate', duplicate)} disabled={busy !== null} className="gap-1.5">
            {busy === 'duplicate' ? <Loader2 className="animate-spin size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            {t('duplicate')}
          </Button>
        </div>
      )}

      {canDelete && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {confirmDelete ? (
            <>
              <p className="text-xs text-destructive">{t('deleteConfirm')}</p>
              <Button size="sm" variant="destructive" onClick={() => run('delete', remove)} disabled={busy !== null} className="gap-1.5">
                {busy === 'delete' ? <Loader2 className="animate-spin size-4" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
                {t('deleteConfirmBtn')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy !== null}>
                {t('cancel')}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
              disabled={busy !== null}
            >
              <Trash2 className="size-4" aria-hidden />
              {t('delete')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
