'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  CalendarDays, CheckCheck, Clock, MapPin, PartyPopper, QrCode, Shirt,
} from 'lucide-react';

export interface PublicInvitation {
  publicUrl: string;
  guest: { firstName: string; lastName: string; category: string };
  rsvpEnabled: boolean;
  rsvpClosed: boolean;
  qrData: string;
  rsvp: { status: string; companions: number } | null;
  questions: { id: string; label: string; type: string; choices: string[] | null; required: boolean }[];
}

export interface PublicEventInv {
  name: string;
  typeCode: string;
  date: string;
  startTime: string;
  endTime: string | null;
  timezone: string;
  venue: string;
  address: string | null;
  city: string | null;
  dressCode: string | null;
  practicalInfo: string | null;
  welcomeMessage: string | null;
}

const TYPE_ACCENTS: Record<string, { bg: string; text: string; soft: string }> = {
  wedding: { bg: 'from-rose-950 via-rose-900 to-amber-900', text: 'text-amber-300', soft: 'bg-rose-500/10 text-rose-700' },
  engagement: { bg: 'from-fuchsia-950 via-pink-900 to-rose-900', text: 'text-pink-300', soft: 'bg-pink-500/10 text-pink-700' },
  birthday: { bg: 'from-violet-950 via-indigo-900 to-fuchsia-900', text: 'text-fuchsia-300', soft: 'bg-violet-500/10 text-violet-700' },
  gala: { bg: 'from-zinc-950 via-neutral-900 to-amber-950', text: 'text-amber-300', soft: 'bg-amber-500/10 text-amber-700' },
  funeral: { bg: 'from-slate-950 via-slate-900 to-slate-800', text: 'text-slate-300', soft: 'bg-slate-500/10 text-slate-700' },
  conference: { bg: 'from-sky-950 via-blue-900 to-indigo-900', text: 'text-sky-300', soft: 'bg-sky-500/10 text-sky-700' },
  concert: { bg: 'from-purple-950 via-purple-900 to-indigo-950', text: 'text-purple-300', soft: 'bg-purple-500/10 text-purple-700' },
  sport: { bg: 'from-emerald-950 via-green-900 to-teal-900', text: 'text-emerald-300', soft: 'bg-emerald-500/10 text-emerald-700' },
};
const DEFAULT_ACCENT = TYPE_ACCENTS['wedding'];

export function RsvpInvitationClient({
  locale, token, invitation, event,
}: {
  locale: string;
  token: string;
  invitation: PublicInvitation;
  event: PublicEventInv;
}) {
  const t = useTranslations('public.invitation');
  const accent = TYPE_ACCENTS[event.typeCode] ?? DEFAULT_ACCENT;
  const isEn = locale === 'en';
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(isEn ? 'en-GB' : 'fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }),
    [isEn],
  );
  const eventDate = new Date(event.date);

  // QR code (data-URI) généré côté client
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    import('qrcode')
      .then((QR) => (QR as { toDataURL: (v: string, o: object) => Promise<string> }).toDataURL(invitation.qrData, { width: 480, margin: 1 }))
      .then((u) => { if (!cancelled) setQrUrl(u); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [invitation.qrData]);

  // ── État du formulaire RSVP ──
  const [status, setStatus] = useState<string>(invitation.rsvp?.status ?? 'confirmed');
  const [companions, setCompanions] = useState<number>(invitation.rsvp?.companions ?? 0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/invitations/${token}/rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          companions,
          answers: Object.fromEntries(
            Object.entries(answers).filter(([, v]) => v !== ''),
          ),
        }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.ok) {
        setDone(true);
        toast.success(t('submitted'));
      } else {
        toast.error(json?.error?.message ?? t('error'));
      }
    } catch {
      toast.error(t('error'));
    }
    setSubmitting(false);
  }

  return (
    <div className="min-h-screen bg-surface">
      {/* Hero */}
      <header className={`bg-gradient-to-br ${accent.bg} text-white`}>
        <div className="mx-auto max-w-2xl px-4 py-12 text-center sm:py-16">
          <p className={`text-xs font-semibold uppercase tracking-[0.25em] ${accent.text}`}>
            EventFlow
          </p>
          <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            {event.name}
          </h1>
          {event.welcomeMessage && (
            <p className="mx-auto mt-3 max-w-lg text-sm text-white/80">{event.welcomeMessage}</p>
          )}
          <div className="mt-6 flex flex-col items-center justify-center gap-2 text-sm sm:flex-row sm:gap-5">
            <span className="flex items-center gap-2">
              <CalendarDays className="size-4 opacity-80" aria-hidden />
              {dateFmt.format(eventDate)}
            </span>
            <span className="flex items-center gap-2">
              <Clock className="size-4 opacity-80" aria-hidden />
              {event.startTime}{event.endTime ? ` – ${event.endTime}` : ''}
            </span>
            <span className="flex items-center gap-2">
              <MapPin className="size-4 opacity-80" aria-hidden />
              {event.venue}{event.city ? ` · ${event.city}` : ''}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-8">
        {/* Vous êtes invité·e */}
        <div className={`rounded-2xl border p-5 text-center ${accent.soft}`}>
          <PartyPopper className="mx-auto size-8" aria-hidden />
          <h2 className="mt-2 font-display text-xl font-semibold">{t('invitedTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('invited', { name: `${invitation.guest.firstName} ${invitation.guest.lastName}` })}
          </p>
        </div>

        {/* QR unique + lien */}
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center sm:flex-row sm:text-left">
            <div className="shrink-0 rounded-xl border bg-white p-2">
              {qrUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrUrl} alt={t('qrAlt')} className="h-32 w-32" />
              ) : (
                <div className="flex h-32 w-32 items-center justify-center text-muted-foreground">
                  <QrCode className="size-8" aria-hidden />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <h3 className="flex items-center gap-2 font-semibold">
                <QrCode className="size-4 text-primary" aria-hidden />
                {t('qrTitle')}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">{t('qrBody')}</p>
              <p className="mt-2 truncate rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground" title={invitation.publicUrl}>
                {invitation.publicUrl}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Dress code / infos pratiques */}
        {(event.dressCode || event.practicalInfo) && (
          <Card>
            <CardContent className="space-y-3 p-6">
              {event.dressCode && (
                <p className="flex items-start gap-2 text-sm">
                  <Shirt className="mt-0.5 size-4 text-primary" aria-hidden />
                  <span><span className="font-medium">{t('dressCode')} :</span> {event.dressCode}</span>
                </p>
              )}
              {event.practicalInfo && (
                <p className="whitespace-pre-line text-sm text-muted-foreground">{event.practicalInfo}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* RSVP */}
        {!invitation.rsvpEnabled ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              {t('rsvpDisabled')}
            </CardContent>
          </Card>
        ) : invitation.rsvpClosed ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
              <Clock className="size-6 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">{t('rsvpClosedTitle')}</p>
              <p className="text-sm text-muted-foreground">{t('rsvpClosedBody')}</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-6">
              <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
                <CheckCheck className="size-5 text-primary" aria-hidden />
                {t('rsvpTitle')}
              </h2>
              {done ? (
                <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5 text-center">
                  <CheckCheck className="mx-auto size-8 text-emerald-600" aria-hidden />
                  <p className="mt-2 font-medium">{t('submitted')}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('status2', { status: t(`status.${status}` as never) })}
                  </p>
                </div>
              ) : (
                <div className="mt-4 space-y-5">
                  {/* Statut */}
                  <div className="grid grid-cols-3 gap-2">
                    {(['confirmed', 'maybe', 'declined'] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setStatus(s)}
                        className={`rounded-xl border px-3 py-3 text-sm font-medium transition ${
                          status === s
                            ? s === 'confirmed'
                              ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                              : s === 'declined'
                                ? 'border-red-500 bg-red-500/10 text-red-700 dark:text-red-400'
                                : 'border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                            : 'border-border text-muted-foreground hover:border-primary/40'
                        }`}
                      >
                        {t(`status.${s}` as never)}
                      </button>
                    ))}
                  </div>

                  {/* Accompagnants */}
                  <div>
                    <label className="text-sm font-medium">{t('companions')}</label>
                    <div className="mt-1.5 flex items-center gap-3">
                      <Input
                        type="number"
                        min={0}
                        max={30}
                        value={companions}
                        onChange={(e) => setCompanions(Math.max(0, Math.min(30, Number(e.target.value) || 0)))}
                        className="w-24"
                      />
                      <span className="text-xs text-muted-foreground">{t('companionsHint')}</span>
                    </div>
                  </div>

                  {/* Questions personnalisées */}
                  {invitation.questions.map((q) => (
                    <div key={q.id} className="space-y-1.5">
                      <label className="text-sm font-medium">
                        {q.label}
                        {q.required && <span className="ml-0.5 text-red-500">*</span>}
                      </label>
                      {q.type === 'choice' ? (
                        <select
                          value={answers[q.id] ?? ''}
                          onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                        >
                          <option value="">{t('choose')}</option>
                          {(q.choices ?? []).map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          type={q.type === 'number' ? 'number' : 'text'}
                          value={answers[q.id] ?? ''}
                          onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                          placeholder={q.required ? t('required') : t('optional')}
                          className="h-9"
                          maxLength={500}
                        />
                      )}
                    </div>
                  ))}

                  <Button onClick={submit} disabled={submitting} className="w-full">
                    {submitting ? t('sending') : t('submit')}
                  </Button>
                  {invitation.rsvp && (
                    <p className="text-center text-xs text-muted-foreground">
                      {t('alreadyAnswered')}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <p className="pb-6 text-center text-xs text-muted-foreground/70">
          {t('footer')}
        </p>
      </main>
    </div>
  );
}
