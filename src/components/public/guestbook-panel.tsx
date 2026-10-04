'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import { Loader2, Send, MessageSquareHeart } from 'lucide-react';

interface Msg {
  authorName: string;
  message: string;
  createdAt: string | Date;
}

export function GuestbookPanel({
  slug, locale, messages,
}: {
  slug: string;
  locale: string;
  messages: Msg[];
}) {
  const t = useTranslations('public.event');
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', message: '' });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await apiFetch<{ message?: { id: string } }>(
      `/api/public/events/${slug}/guestbook`,
      {
        method: 'POST',
        body: JSON.stringify({
          authorName: form.name,
          authorEmail: form.email,
          message: form.message,
        }),
      },
    ).finally(() => setBusy(false));

    if (res.ok) {
      setForm({ name: '', email: '', message: '' });
      toast.success(t('guestbookSent'));
      router.refresh();
    } else {
      toast.error(
        res.error?.details?.map((d) => d.message).join(' · ') ?? res.error?.message ?? t('guestbookError'),
      );
    }
  }

  const fmt = (v: string | Date) =>
    new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'medium' }).format(
      new Date(v),
    );

  return (
    <div className="mt-4 space-y-6">
      <form onSubmit={submit} className="space-y-3 rounded-2xl border bg-background p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="gb-name">{t('guestbookName')}</Label>
            <Input
              id="gb-name"
              required
              minLength={1}
              maxLength={100}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="gb-email">{t('guestbookEmail')}</Label>
            <Input
              id="gb-email"
              type="email"
              maxLength={160}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="gb-msg">{t('guestbookMessage')}</Label>
          <textarea
            id="gb-msg"
            required
            minLength={2}
            maxLength={2000}
            className="min-h-24 w-full rounded-xl border border-input bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
          />
        </div>
        <Button type="submit" disabled={busy} className="gap-2">
          {busy ? <Loader2 className="animate-spin size-4" aria-hidden /> : <Send className="size-4" aria-hidden />}
          {t('guestbookSend')}
        </Button>
      </form>

      {messages.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          <MessageSquareHeart className="size-4" aria-hidden />
          {t('guestbookEmpty')}
        </p>
      ) : (
        <ul className="space-y-3">
          {messages.map((m, i) => (
            <li key={i} className="rounded-2xl border bg-background p-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium">{m.authorName}</p>
                <p className="shrink-0 text-xs text-muted-foreground">{fmt(m.createdAt)}</p>
              </div>
              <p className="mt-1 whitespace-pre-line text-sm text-foreground/90">{m.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
