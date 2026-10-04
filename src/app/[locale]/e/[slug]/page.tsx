import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getPublicEvent } from '@/server/services/event';
import { CalendarCountdown } from '@/components/public/countdown';
import { GuestbookPanel } from '@/components/public/guestbook-panel';
import {
  CalendarDays, MapPin, Clock, Users, Heart, Phone, Mail, Globe,
  Shirt, Info, QrCode, CheckCheck, Images, Sparkles,
} from 'lucide-react';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const event = await getPublicEvent(slug);
  return {
    title: event ? `${event.name} — EventFlow` : 'Événement — EventFlow',
    description:
      event?.description?.slice(0, 150) ??
      'Page événement EventFlow : date, lieu, RSVP et contrôle d’accès.',
  };
}

const TYPE_ACCENTS: Record<string, { bg: string; text: string; soft: string }> = {
  wedding: { bg: 'from-rose-950 via-rose-900 to-amber-900', text: 'text-amber-300', soft: 'bg-rose-500/10 text-rose-700' },
  engagement: { bg: 'from-fuchsia-950 via-pink-900 to-rose-900', text: 'text-pink-300', soft: 'bg-pink-500/10 text-pink-700' },
  birthday: { bg: 'from-violet-950 via-indigo-900 to-fuchsia-900', text: 'text-fuchsia-300', soft: 'bg-violet-500/10 text-violet-700' },
  gala: { bg: 'from-zinc-950 via-neutral-900 to-amber-950', text: 'text-amber-300', soft: 'bg-amber-500/10 text-amber-700' },
  funeral: { bg: 'from-slate-950 via-slate-900 to-slate-800', text: 'text-slate-300', soft: 'bg-slate-500/10 text-slate-700' },
  conference: { bg: 'from-sky-950 via-blue-900 to-indigo-900', text: 'text-sky-300', soft: 'bg-sky-500/10 text-sky-700' },
  concert: { bg: 'from-purple-950 via-violet-900 to-indigo-950', text: 'text-purple-300', soft: 'bg-purple-500/10 text-purple-700' },
  sport: { bg: 'from-emerald-950 via-green-900 to-teal-900', text: 'text-emerald-300', soft: 'bg-emerald-500/10 text-emerald-700' },
};
const DEFAULT_ACCENT = TYPE_ACCENTS['wedding'];

export default async function PublicEventPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('public.event');

  const event = await getPublicEvent(slug);
  if (!event) notFound();

  const accent = TYPE_ACCENTS[event.typeCode] ?? DEFAULT_ACCENT;
  const isEn = locale === 'en';
  const dateFmt = new Intl.DateTimeFormat(isEn ? 'en-GB' : 'fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const opt = (k: string) => Boolean(event.options[k]);

  return (
    <div className="bg-surface">
      {/* Hero */}
      <header className={`bg-gradient-to-br ${accent.bg} text-white`}>
        <div className="mx-auto max-w-3xl px-4 py-14 text-center sm:py-20">
          <p className={`text-xs font-semibold uppercase tracking-[0.25em] ${accent.text}`}>
            EventFlow
          </p>
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            {event.name}
          </h1>
          {event.welcomeMessage && (
            <p className="mx-auto mt-4 max-w-xl text-sm text-white/80 sm:text-base">
              {event.welcomeMessage}
            </p>
          )}
          <div className="mt-8 flex flex-col items-center justify-center gap-3 text-sm sm:flex-row sm:gap-6">
            <span className="flex items-center gap-2">
              <CalendarDays className="size-4 opacity-80" aria-hidden />
              {dateFmt.format(event.date)}
            </span>
            <span className="flex items-center gap-2">
              <Clock className="size-4 opacity-80" aria-hidden />
              {event.startTime}
              {event.endTime ? ` – ${event.endTime}` : ''}
            </span>
            <span className="flex items-center gap-2">
              <MapPin className="size-4 opacity-80" aria-hidden />
              {event.venue}
              {event.city ? ` · ${event.city}` : ''}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-10 px-4 py-10">
        {/* Compte à rebours */}
        {opt('countdown') && (
          <section aria-label={t('countdownTitle')}>
            <h2 className="sr-only">{t('countdownTitle')}</h2>
            <CalendarCountdown
              dateIso={event.date.toISOString()}
              time={event.startTime}
              labels={{ days: t('cdDays'), hours: t('cdHours'), minutes: t('cdMinutes'), seconds: t('cdSeconds'), passed: t('cdPassed') }}
            />
          </section>
        )}

        {/* Description */}
        {event.description && (
          <section>
            <h2 className="font-display text-xl font-semibold tracking-tight">{t('about')}</h2>
            <p className="mt-3 whitespace-pre-line leading-relaxed text-foreground/90">
              {event.description}
            </p>
          </section>
        )}

        {/* Personnes principales */}
        {event.members.length > 0 && (
          <section>
            <h2 className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight">
              <Heart className={`size-5 ${accent.text}`} aria-hidden />
              {t('peopleTitle')}
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {event.members.map((m, i) => (
                <div key={i} className="flex items-center gap-3 rounded-2xl border bg-background p-4">
                  <span className={`flex size-12 shrink-0 items-center justify-center rounded-full font-display text-lg ${accent.soft}`}>
                    {m.initials || '•'}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{m.firstName} {m.lastName}</p>
                    <p className="text-xs text-muted-foreground">{m.roleLabel}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t('peoplePhotosSoon')}</p>
          </section>
        )}

        {/* Infos pratiques */}
        {(event.address || event.contactPhone || event.contactEmail || event.website || event.dressCode) && (
          <section>
            <h2 className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight">
              <Info className={`size-5 ${accent.text}`} aria-hidden />
              {t('practicalTitle')}
            </h2>
            <div className="mt-4 space-y-3 text-sm">
              {(event.address || event.city || event.country) && (
                <a
                  className="flex items-start gap-3 rounded-2xl border bg-background p-4 hover:border-foreground/30"
                  href={
                    event.address || event.city
                      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([event.venue, event.address, event.city, event.country].filter(Boolean).join(', '))}`
                      : undefined
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span>
                    {event.venue}
                    {event.address ? <br /> : null}
                    {event.address}
                    {event.city ? ` — ${event.city}` : ''}
                    {event.country ? `, ${event.country}` : ''}
                  </span>
                </a>
              )}
              {event.contactPhone && (
                <a className="flex items-center gap-3 rounded-2xl border bg-background p-4 hover:border-foreground/30" href={`tel:${event.contactPhone.replace(/\s+/g, '')}`}>
                  <Phone className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  {event.contactPhone}
                </a>
              )}
              {event.contactEmail && (
                <a className="flex items-center gap-3 rounded-2xl border bg-background p-4 hover:border-foreground/30" href={`mailto:${event.contactEmail}`}>
                  <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  {event.contactEmail}
                </a>
              )}
              {event.website && (
                <a className="flex items-center gap-3 rounded-2xl border bg-background p-4 hover:border-foreground/30" href={event.website} target="_blank" rel="noreferrer">
                  <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  {event.website.replace(/^https?:\/\//, '')}
                </a>
              )}
              {event.dressCode && (
                <p className="flex items-center gap-3 rounded-2xl border bg-background p-4">
                  <Shirt className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  {t('dressCode')}: <span className="font-medium">{event.dressCode}</span>
                </p>
              )}
            </div>
          </section>
        )}

        {/* Programme / infos complémentaires */}
        {event.practicalInfo && (
          <section>
            <h2 className="font-display text-xl font-semibold tracking-tight">{t('programTitle')}</h2>
            <p className="mt-3 whitespace-pre-line leading-relaxed text-foreground/90">
              {event.practicalInfo}
            </p>
          </section>
        )}

        {/* RSVP (via invitation personnelle — phase 8) */}
        {opt('rsvp') && (
          <section className={`rounded-2xl border p-6 text-center ${accent.soft}`}>
            <CheckCheck className="mx-auto size-8" aria-hidden />
            <h2 className="mt-2 font-display text-lg font-semibold">{t('rsvpTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('rsvpBody')}</p>
          </section>
        )}

        {/* QR (via invitation personnelle — phase 8) */}
        {opt('qr') && (
          <section className={`rounded-2xl border p-6 text-center ${accent.soft}`}>
            <QrCode className="mx-auto size-8" aria-hidden />
            <h2 className="mt-2 font-display text-lg font-semibold">{t('qrTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('qrBody')}</p>
          </section>
        )}

        {/* Galerie (médias — phase 7) */}
        {opt('gallery') && (
          <section>
            <h2 className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight">
              <Images className={`size-5 ${accent.text}`} aria-hidden />
              {t('galleryTitle')}
            </h2>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex aspect-square items-center justify-center rounded-xl border border-dashed bg-background text-muted-foreground">
                  <Images className="size-5" aria-hidden />
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t('galleryEmpty')}</p>
          </section>
        )}

        {/* Livre d'or */}
        {opt('guestbook') && (
          <section>
            <h2 className="font-display text-xl font-semibold tracking-tight">{t('guestbookTitle')}</h2>
            <GuestbookPanel slug={event.slug} locale={locale} messages={event.guestbookMessages} />
          </section>
        )}
      </main>

      <footer className="border-t py-8 text-center text-xs text-muted-foreground">
        <p className="flex items-center justify-center gap-1.5">
          <Sparkles className="size-3.5" aria-hidden />
          {t('poweredBy')}{' '}
          <Link href={`/${isEn ? 'en' : ''}`} className="font-medium text-foreground underline underline-offset-2">
            EventFlow
          </Link>
        </p>
      </footer>
    </div>
  );
}
