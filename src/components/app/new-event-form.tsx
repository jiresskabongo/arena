'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import { Loader2 } from 'lucide-react';

const EVENT_TYPES = [
  'wedding', 'engagement', 'birthday', 'baptism', 'anniversary', 'gala',
  'conference', 'concert', 'sport', 'party', 'reunion', 'other',
] as const;
const TIMEZONES = [
  'Africa/Kinshasa', 'Africa/Lubumbashi', 'Europe/Brussels', 'Europe/Paris',
  'America/New_York', 'UTC',
] as const;
const OPTIONS = [
  'qr', 'rsvp', 'countdown', 'email', 'sms', 'whatsapp',
  'guestbook', 'preferences', 'tables', 'gallery',
] as const;

export function NewEventForm({ locale }: { locale: string }) {
  const t = useTranslations('events');
  const td = useTranslations('events.detail');
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: '',
    typeCode: 'wedding',
    date: '',
    startTime: '15:00',
    endTime: '',
    timezone: 'Africa/Kinshasa',
    venue: '',
    address: '',
    city: '',
    country: '',
    description: '',
    contactPhone: '',
    contactEmail: '',
    website: '',
    dressCode: '',
    practicalInfo: '',
    welcomeMessage: '',
  });
  const [allowMultipleEntries, setAllowMultipleEntries] = useState(false);
  const [options, setOptions] = useState<Record<string, boolean>>({
    qr: true, rsvp: true, countdown: true,
    email: false, sms: false, whatsapp: false,
    guestbook: false, preferences: false, tables: false, gallery: false,
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    setBusy(true);
    const res = await apiFetch('/api/events', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        endTime: form.endTime || undefined,
        contactPhone: form.contactPhone || undefined,
        contactEmail: form.contactEmail || undefined,
        website: form.website || undefined,
        welcomeMessage: form.welcomeMessage || undefined,
        allowMultipleEntries,
        optionsJson: options,
      }),
    }).finally(() => setBusy(false));

    if (res.ok) {
      toast.success(t('created'));
      router.push('/events');
      router.refresh();
      return;
    }
    if (res.error?.code === 'quota_exceeded' || res.error?.code === 'trial_expired') {
      toast.error(res.error.message);
    } else {
      toast.error(res.error?.details?.map((x) => x.message).join(' · ') ?? res.error?.message ?? t('createError'));
    }
  }

  const selectCls =
    'flex h-10 w-full rounded-xl border border-input bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60';

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div>
          <Label htmlFor="ev-name">{t('name')} *</Label>
          <Input id="ev-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={t('namePlaceholder')} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="ev-type">{t('type')} *</Label>
            <select id="ev-type" className={selectCls} value={form.typeCode} onChange={(e) => set('typeCode', e.target.value)}>
              {EVENT_TYPES.map((c) => <option key={c} value={c}>{t(`type.${c}`)}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="ev-tz">{t('timezone')}</Label>
            <select id="ev-tz" className={selectCls} value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="ev-date">{t('date')} *</Label>
            <Input id="ev-date" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ev-start">{t('startTime')} *</Label>
              <Input id="ev-start" type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ev-end">{t('endTime')}</Label>
              <Input id="ev-end" type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="ev-venue">{t('venue')} *</Label>
            <Input id="ev-venue" value={form.venue} onChange={(e) => set('venue', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ev-address">{t('address')}</Label>
            <Input id="ev-address" value={form.address} onChange={(e) => set('address', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ev-city">{t('city')}</Label>
            <Input id="ev-city" value={form.city} onChange={(e) => set('city', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ev-country">{t('country')}</Label>
            <Input id="ev-country" value={form.country} onChange={(e) => set('country', e.target.value)} />
          </div>
        </div>

        <div>
          <Label htmlFor="ev-desc">{t('description')}</Label>
          <textarea
            id="ev-desc"
            className="min-h-20 w-full rounded-xl border border-input bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="ev-phone">{td('contactPhone')}</Label>
            <Input id="ev-phone" value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} placeholder="+243 …" />
          </div>
          <div>
            <Label htmlFor="ev-cemail">{td('contactEmail')}</Label>
            <Input id="ev-cemail" type="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ev-website">{td('website')}</Label>
            <Input id="ev-website" value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://…" />
          </div>
          <div>
            <Label htmlFor="ev-dress">{t('dressCode')}</Label>
            <Input id="ev-dress" value={form.dressCode} onChange={(e) => set('dressCode', e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="ev-welcome">{td('welcomeMessage')}</Label>
            <Input id="ev-welcome" value={form.welcomeMessage} onChange={(e) => set('welcomeMessage', e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="ev-info">{t('practicalInfo')}</Label>
            <Input id="ev-info" value={form.practicalInfo} onChange={(e) => set('practicalInfo', e.target.value)} />
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={allowMultipleEntries}
            onChange={(e) => setAllowMultipleEntries(e.target.checked)}
          />
          {td('multipleEntries')}
        </label>

        <div>
          <p className="mb-2 text-sm font-medium">{t('optionsTitle')}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {OPTIONS.map((opt) => (
              <label
                key={opt}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  options[opt] ? 'border-primary/50 bg-primary/5' : 'border-border'
                }`}
              >
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={options[opt]}
                  onChange={(e) => setOptions((o) => ({ ...o, [opt]: e.target.checked }))}
                />
                {t(`option.${opt}`)}
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end border-t pt-4">
          <Button onClick={submit} disabled={busy || form.name.trim().length < 2 || !form.date || form.venue.trim().length < 2}>
            {busy ? <Loader2 className="animate-spin size-4" aria-hidden /> : null}
            {t('create')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
