'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import {
  Building2, CalendarDays, Users, UserPlus, CreditCard, Check,
  ChevronLeft, ChevronRight, Sparkles, Loader2, Mail,
} from 'lucide-react';

const STEPS = ['welcome', 'organization', 'first_event', 'guests', 'team', 'plan', 'done'] as const;
const EVENT_TYPES = [
  'wedding', 'engagement', 'birthday', 'baptism', 'anniversary', 'gala',
  'conference', 'concert', 'sport', 'party', 'reunion', 'other',
] as const;
const TIMEZONES = [
  'Africa/Kinshasa', 'Africa/Lubumbashi', 'Europe/Brussels', 'Europe/Paris',
  'America/New_York', 'UTC',
] as const;

interface WizardProps {
  initialStep: number;
  org: {
    name: string; currency: string; locale: string; timezone: string;
    email: string; phone: string; address: string;
  };
  events: { id: string; name: string }[];
  planName: string | null;
  inTrial: boolean;
  daysLeft: number;
  role: string;
  locale: string;
}

export function OnboardingWizard({
  initialStep, org: initialOrg, events: initialEvents,
  planName, inTrial, daysLeft, role, locale,
}: WizardProps) {
  const t = useTranslations('app.onboarding');
  const tEvent = useTranslations('events');
  const router = useRouter();

  const [step, setStep] = useState(Math.min(Math.max(initialStep, 1), STEPS.length));
  const [busy, setBusy] = useState(false);
  const [org, setOrg] = useState(initialOrg);
  const [events, setEvents] = useState(initialEvents);
  const [eventId, setEventId] = useState<string | null>(initialEvents[0]?.id ?? null);
  const [eventName, setEventName] = useState(initialEvents[0]?.name ?? '');
  const [guestsAdded, setGuestsAdded] = useState(0);

  // Formulaires
  const [ev, setEv] = useState({
    name: '', typeCode: 'wedding', date: '', startTime: '15:00', venue: '', city: '',
  });
  const [guest, setGuest] = useState({ firstName: '', lastName: '', email: '' });
  const [invite, setInvite] = useState({ email: '', role: 'designer' });

  const canManageTeam = role === 'owner' || role === 'manager';

  function go(n: number) {
    const next = Math.min(Math.max(n, 1), STEPS.length);
    setStep(next);
    apiFetch('/api/onboarding', {
      method: 'POST',
      body: JSON.stringify({ step: next }),
    }).catch(() => {});
  }

  async function handleOrgNext() {
    setBusy(true);
    const res = await apiFetch('/api/organization', {
      method: 'PATCH',
      body: JSON.stringify({
        name: org.name, currency: org.currency, locale: org.locale,
        timezone: org.timezone, email: org.email, phone: org.phone, address: org.address,
      }),
    }).finally(() => setBusy(false));
    if (res.ok) {
      toast.success(t('orgSaved'));
      go(step + 1);
    } else {
      toast.error(res.error?.details?.map((x) => x.message).join(' · ') ?? res.error?.message ?? t('orgSaveError'));
    }
  }

  async function handleEventNext() {
    if (events.length > 0) {
      go(step + 1);
      return;
    }
    setBusy(true);
    const res = await apiFetch<{ event?: { id: string } }>('/api/events', {
      method: 'POST',
      body: JSON.stringify(ev),
    }).finally(() => setBusy(false));
    if (res.ok) {
      if (res.data?.event?.id) {
        setEventId(res.data.event.id);
        setEventName(ev.name);
        setEvents((prev) => [{ id: res.data!.event!.id, name: ev.name }, ...prev]);
      }
      toast.success(t('eventCreated'));
      go(step + 1);
    } else {
      toast.error(res.error?.message ?? t('eventCreateError'));
    }
  }

  async function handleAddGuest() {
    if (!eventId) return;
    setBusy(true);
    const res = await apiFetch(`/api/events/${eventId}/guests`, {
      method: 'POST',
      body: JSON.stringify({
        firstName: guest.firstName,
        lastName: guest.lastName,
        email: guest.email,
        category: 'famille',
      }),
    }).finally(() => setBusy(false));
    if (res.ok) {
      setGuestsAdded((n) => n + 1);
      setGuest({ firstName: '', lastName: '', email: '' });
      toast.success(t('guestAdded'));
    } else {
      toast.error(res.error?.message ?? t('guestAddError'));
    }
  }

  async function handleInvite() {
    setBusy(true);
    const res = await apiFetch('/api/organization/members', {
      method: 'POST',
      body: JSON.stringify(invite),
    }).finally(() => setBusy(false));
    if (res.ok) {
      toast.success(t('inviteSent', { email: invite.email }));
    } else {
      toast.error(res.error?.message ?? t('inviteError'));
    }
  }

  async function handleFinish() {
    setBusy(true);
    await apiFetch('/api/onboarding', { method: 'POST', body: JSON.stringify({ complete: true }) })
      .finally(() => setBusy(false));
    router.push('/dashboard');
    router.refresh();
  }

  const stepKey = STEPS[step - 1];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Progression */}
      <div>
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">{t('title')}</span>
          <span className="text-muted-foreground">{step} / {STEPS.length}</span>
        </div>
        <div className="mt-2 flex gap-1.5" role="presentation">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i + 1 < step ? 'bg-primary' : i + 1 === step ? 'bg-primary/60' : 'bg-muted'
              }`}
            />
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t(`stepLabels.${stepKey}`)}</p>
      </div>

      <Card>
        <CardHeader>
          {stepKey === 'welcome' && (
            <>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="size-5 text-primary" aria-hidden />
                {t('welcomeTitle', { name: org.name })}
              </CardTitle>
              <CardDescription>{t('welcomeBody')}</CardDescription>
            </>
          )}
          {stepKey === 'organization' && (
            <>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Building2 className="size-5 text-primary" aria-hidden />
                {t('orgTitle')}
              </CardTitle>
              <CardDescription>{t('orgBody')}</CardDescription>
            </>
          )}
          {stepKey === 'first_event' && (
            <>
              <CardTitle className="flex items-center gap-2 text-lg">
                <CalendarDays className="size-5 text-primary" aria-hidden />
                {t('eventTitle')}
              </CardTitle>
              <CardDescription>{t('eventBody')}</CardDescription>
            </>
          )}
          {stepKey === 'guests' && (
            <>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="size-5 text-primary" aria-hidden />
                {t('guestsTitle')}
              </CardTitle>
              <CardDescription>{t('guestsBody')}</CardDescription>
            </>
          )}
          {stepKey === 'team' && (
            <>
              <CardTitle className="flex items-center gap-2 text-lg">
                <UserPlus className="size-5 text-primary" aria-hidden />
                {t('teamTitle')}
              </CardTitle>
              <CardDescription>{t('teamBody')}</CardDescription>
            </>
          )}
          {stepKey === 'plan' && (
            <>
              <CardTitle className="flex items-center gap-2 text-lg">
                <CreditCard className="size-5 text-primary" aria-hidden />
                {t('planTitle')}
              </CardTitle>
              <CardDescription>
                {inTrial
                  ? t('planTrialBody', { plan: planName ?? '—', days: daysLeft })
                  : t('planBody')}
              </CardDescription>
            </>
          )}
          {stepKey === 'done' && (
            <>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Check className="size-5 text-primary" aria-hidden />
                {t('doneTitle')}
              </CardTitle>
              <CardDescription>{t('doneBody')}</CardDescription>
            </>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 1. Accueil */}
          {stepKey === 'welcome' && (
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2"><Check className="size-4 text-primary" aria-hidden />{t('welcomePoint1')}</li>
              <li className="flex items-center gap-2"><Check className="size-4 text-primary" aria-hidden />{t('welcomePoint2')}</li>
              <li className="flex items-center gap-2"><Check className="size-4 text-primary" aria-hidden />{t('welcomePoint3')}</li>
            </ul>
          )}

          {/* 2. Organisation */}
          {stepKey === 'organization' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="org-name">{t('orgName')}</Label>
                <Input id="org-name" value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="org-currency">{t('orgCurrency')}</Label>
                <select
                  id="org-currency"
                  className="flex h-10 w-full rounded-xl border border-input bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  value={org.currency}
                  onChange={(e) => setOrg({ ...org, currency: e.target.value })}
                >
                  <option value="USD">USD — $</option>
                  <option value="CDF">CDF — FC</option>
                  <option value="EUR">EUR — €</option>
                </select>
              </div>
              <div>
                <Label htmlFor="org-locale">{t('orgLocale')}</Label>
                <select
                  id="org-locale"
                  className="flex h-10 w-full rounded-xl border border-input bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  value={org.locale}
                  onChange={(e) => setOrg({ ...org, locale: e.target.value })}
                >
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div>
                <Label htmlFor="org-tz">{t('orgTimezone')}</Label>
                <select
                  id="org-tz"
                  className="flex h-10 w-full rounded-xl border border-input bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  value={org.timezone}
                  onChange={(e) => setOrg({ ...org, timezone: e.target.value })}
                >
                  {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="org-email">{t('orgEmail')}</Label>
                <Input id="org-email" type="email" value={org.email} onChange={(e) => setOrg({ ...org, email: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="org-phone">{t('orgPhone')}</Label>
                <Input id="org-phone" value={org.phone} onChange={(e) => setOrg({ ...org, phone: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="org-address">{t('orgAddress')}</Label>
                <Input id="org-address" value={org.address} onChange={(e) => setOrg({ ...org, address: e.target.value })} />
              </div>
            </div>
          )}

          {/* 3. Premier événement */}
          {stepKey === 'first_event' && (
            events.length > 0 ? (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <Check className="size-4 text-primary" aria-hidden />
                  {t('eventExists', { name: events[0].name, count: events.length })}
                </p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="ev-name">{tEvent('name')}</Label>
                  <Input id="ev-name" value={ev.name} placeholder={t('eventPlaceholder')} onChange={(e) => setEv({ ...ev, name: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="ev-type">{tEvent('type')}</Label>
                  <select
                    id="ev-type"
                    className="flex h-10 w-full rounded-xl border border-input bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                    value={ev.typeCode}
                    onChange={(e) => setEv({ ...ev, typeCode: e.target.value })}
                  >
                    {EVENT_TYPES.map((code) => (
                      <option key={code} value={code}>{tEvent(`type.${code}`)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="ev-date">{tEvent('date')}</Label>
                  <Input id="ev-date" type="date" value={ev.date} onChange={(e) => setEv({ ...ev, date: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="ev-time">{tEvent('startTime')}</Label>
                  <Input id="ev-time" type="time" value={ev.startTime} onChange={(e) => setEv({ ...ev, startTime: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="ev-venue">{tEvent('venue')}</Label>
                  <Input id="ev-venue" value={ev.venue} onChange={(e) => setEv({ ...ev, venue: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="ev-city">{tEvent('city')}</Label>
                  <Input id="ev-city" value={ev.city} onChange={(e) => setEv({ ...ev, city: e.target.value })} />
                </div>
              </div>
            )
          )}

          {/* 4. Invités */}
          {stepKey === 'guests' && (
            !eventId ? (
              <p className="text-sm text-muted-foreground">{t('guestsNoEvent')}</p>
            ) : (
              <div className="space-y-4">
                {guestsAdded > 0 && (
                  <p className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
                    <Check className="size-4 text-primary" aria-hidden />
                    {t('guestsAdded', { count: guestsAdded, event: eventName })}
                  </p>
                )}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label htmlFor="g-first">{t('guestFirst')}</Label>
                    <Input id="g-first" value={guest.firstName} onChange={(e) => setGuest({ ...guest, firstName: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="g-last">{t('guestLast')}</Label>
                    <Input id="g-last" value={guest.lastName} onChange={(e) => setGuest({ ...guest, lastName: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="g-email">{t('guestEmail')}</Label>
                    <Input id="g-email" type="email" value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} />
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={handleAddGuest} disabled={busy || !guest.firstName || !guest.lastName}>
                  <UserPlus className="size-4" aria-hidden />
                  {t('guestAdd')}
                </Button>
              </div>
            )
          )}

          {/* 5. Équipe */}
          {stepKey === 'team' && (
            !canManageTeam ? (
              <p className="text-sm text-muted-foreground">{t('teamNoPermission')}</p>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <Label htmlFor="inv-email">{t('teamEmail')}</Label>
                    <Input id="inv-email" type="email" placeholder="prenom@exemple.cd" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="inv-role">{t('teamRole')}</Label>
                    <select
                      id="inv-role"
                      className="flex h-10 w-full rounded-xl border border-input bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      value={invite.role}
                      onChange={(e) => setInvite({ ...invite, role: e.target.value })}
                    >
                      <option value="manager">{t('role.manager')}</option>
                      <option value="designer">{t('role.designer')}</option>
                      <option value="scanner">{t('role.scanner')}</option>
                      <option value="viewer">{t('role.viewer')}</option>
                    </select>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={handleInvite} disabled={busy || !invite.email}>
                  <Mail className="size-4" aria-hidden />
                  {t('teamInvite')}
                </Button>
                <p className="text-xs text-muted-foreground">{t('teamInviteNote')}</p>
              </div>
            )
          )}

          {/* 6. Plan */}
          {stepKey === 'plan' && (
            <div className="space-y-3 text-sm">
              <p>{inTrial ? t('planTrialLine', { days: daysLeft }) : t('planLine')}</p>
              <Button variant="outline" size="sm" asChild>
                <Link href="/settings/plan">{t('planSee')}</Link>
              </Button>
            </div>
          )}

          {/* 7. Fin */}
          {stepKey === 'done' && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">{t('doneEventLine', { event: eventName || '—' })}</p>
              <p className="text-muted-foreground">{t('doneNextLine')}</p>
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between border-t pt-4">
            <Button variant="ghost" size="sm" onClick={() => go(step - 1)} disabled={step === 1 || busy}>
              <ChevronLeft className="size-4" aria-hidden />
              {t('back')}
            </Button>
            <div className="flex items-center gap-2">
              {stepKey !== 'welcome' && stepKey !== 'done' && (
                <Button variant="ghost" size="sm" onClick={() => go(step + 1)} disabled={busy}>
                  {t('skip')}
                </Button>
              )}
              {stepKey === 'welcome' && (
                <Button onClick={() => go(2)}>{t('start')}<ChevronRight className="size-4" aria-hidden /></Button>
              )}
              {stepKey === 'organization' && (
                <Button onClick={handleOrgNext} disabled={busy || org.name.trim().length < 2}>
                  {busy ? <Loader2 className="animate-spin size-4" aria-hidden /> : null}
                  {t('continue')}
                </Button>
              )}
              {stepKey === 'first_event' && (
                <Button onClick={handleEventNext} disabled={busy || events.length === 0 || !ev.name || !ev.date || !ev.venue}>
                  {busy ? <Loader2 className="animate-spin size-4" aria-hidden /> : null}
                  {events.length === 0 ? t('createEvent') : t('continue')}
                </Button>
              )}
              {stepKey === 'guests' && (
                <Button onClick={() => go(step + 1)} disabled={busy}>{t('continue')}</Button>
              )}
              {stepKey === 'team' && (
                <Button onClick={() => go(step + 1)} disabled={busy}>{t('continue')}</Button>
              )}
              {stepKey === 'plan' && (
                <Button onClick={() => go(step + 1)} disabled={busy}>{t('continue')}</Button>
              )}
              {stepKey === 'done' && (
                <Button onClick={handleFinish} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin size-4" aria-hidden /> : <Check className="size-4" aria-hidden />}
                  {t('finish')}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">{t('skippableNote')}</p>
    </div>
  );
}
