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
  'wedding', 'engagement', 'birthday', 'baptism', 'communion', 'anniversary',
  'funeral', 'graduation', 'retirement', 'company', 'conference', 'concert',
  'sport', 'gala', 'launch', 'party', 'reunion', 'fundraiser', 'expo', 'other',
] as const;
const TIMEZONES = [
  'Africa/Kinshasa', 'Africa/Lubumbashi', 'Europe/Brussels', 'Europe/Paris',
  'America/New_York', 'UTC',
] as const;
const OPTIONS = [
  'qr', 'rsvp', 'countdown', 'email', 'sms', 'whatsapp',
  'guestbook', 'preferences', 'tables', 'gallery',
] as const;

interface EventDraft {
  name: string;
  typeCode: string;
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
  venue: string;
  address: string;
  city: string;
  country: string;
  description: string;
  contactPhone: string;
  contactEmail: string;
  website: string;
  dressCode: string;
  practicalInfo: string;
  welcomeMessage: string;
  allowMultipleEntries: boolean;
  options: Record<string, boolean>;
}

export function EventEditForm({ eventId, event, locale }: { eventId: string; event: any; locale: string }) {
  const t = useTranslations('events.detail');
  const tEv = useTranslations('events');
  const router = useRouter();

  const [form, setForm] = useState<EventDraft>({
    name: event.name,
    typeCode: event.typeCode,
    date: event.date?.slice(0, 10) ?? '',
    startTime: event.startTime,
    endTime: event.endTime ?? '',
    timezone: event.timezone,
    venue: event.venue,
    address: event.address ?? '',
    city: event.city ?? '',
    country: event.country ?? '',
    description: event.description ?? '',
    contactPhone: event.contactPhone ?? '',
    contactEmail: event.contactEmail ?? '',
    website: event.website ?? '',
    dressCode: event.dressCode ?? '',
    practicalInfo: event.practicalInfo ?? '',
    welcomeMessage: event.welcomeMessage ?? '',
    allowMultipleEntries: event.allowMultipleEntries ?? false,
    options: {
      qr: true, rsvp: true, countdown: true, email: false, sms: false, whatsapp: false,
      guestbook: false, preferences: false, tables: false, gallery: false,
      ...(event.optionsJson ?? {}),
    },
  });
  const [busy, setBusy] = useState(false);

  const set = (k: keyof EventDraft, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const selectCls =
    'flex h-10 w-full rounded-xl border border-input bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60';
  const taCls =
    'min-h-20 w-full rounded-xl border border-input bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60';

  async function submit() {
    setBusy(true);
    const res = await apiFetch(`/api/events/${eventId}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...form, optionsJson: form.options }),
    }).finally(() => setBusy(false));
    if (res.ok) {
      toast.success(t('saved'));
      router.refresh();
    } else {
      toast.error(res.error?.details?.map((d) => d.message).join(' · ') ?? res.error?.message ?? t('saveError'));
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div>
          <Label htmlFor="ed-name">{tEv('name')} *</Label>
          <Input id="ed-name" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="ed-type">{tEv('type')} *</Label>
            <select id="ed-type" className={selectCls} value={form.typeCode} onChange={(e) => set('typeCode', e.target.value)}>
              {EVENT_TYPES.map((c) => <option key={c} value={c}>{tEv(`type.${c}`)}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="ed-tz">{tEv('timezone')}</Label>
            <select id="ed-tz" className={selectCls} value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="ed-date">{tEv('date')} *</Label>
            <Input id="ed-date" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ed-start">{tEv('startTime')} *</Label>
              <Input id="ed-start" type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ed-end">{tEv('endTime')}</Label>
              <Input id="ed-end" type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="ed-venue">{tEv('venue')} *</Label>
            <Input id="ed-venue" value={form.venue} onChange={(e) => set('venue', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ed-address">{tEv('address')}</Label>
            <Input id="ed-address" value={form.address} onChange={(e) => set('address', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ed-city">{tEv('city')}</Label>
            <Input id="ed-city" value={form.city} onChange={(e) => set('city', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ed-country">{tEv('country')}</Label>
            <Input id="ed-country" value={form.country} onChange={(e) => set('country', e.target.value)} />
          </div>
        </div>

        <div>
          <Label htmlFor="ed-desc">{tEv('description')}</Label>
          <textarea id="ed-desc" className={taCls} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="ed-phone">{t('contactPhone')}</Label>
            <Input id="ed-phone" value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} placeholder="+243 …" />
          </div>
          <div>
            <Label htmlFor="ed-email">{t('contactEmail')}</Label>
            <Input id="ed-email" type="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ed-website">{t('website')}</Label>
            <Input id="ed-website" value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://…" />
          </div>
          <div>
            <Label htmlFor="ed-dress">{tEv('dressCode')}</Label>
            <Input id="ed-dress" value={form.dressCode} onChange={(e) => set('dressCode', e.target.value)} />
          </div>
        </div>

        <div>
          <Label htmlFor="ed-welcome">{t('welcomeMessage')}</Label>
          <Input id="ed-welcome" value={form.welcomeMessage} onChange={(e) => set('welcomeMessage', e.target.value)} />
        </div>

        <div>
          <Label htmlFor="ed-info">{tEv('practicalInfo')}</Label>
          <textarea id="ed-info" className={taCls} value={form.practicalInfo} onChange={(e) => set('practicalInfo', e.target.value)} />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">{tEv('optionsTitle')}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {OPTIONS.map((opt) => (
              <label
                key={opt}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  form.options[opt] ? 'border-primary/50 bg-primary/5' : 'border-border'
                }`}
              >
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={Boolean(form.options[opt])}
                  onChange={(e) => setForm((f) => ({ ...f, options: { ...f.options, [opt]: e.target.checked } }))}
                />
                {tEv(`option.${opt}`)}
              </label>
            ))}
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={form.allowMultipleEntries}
            onChange={(e) => set('allowMultipleEntries', e.target.checked)}
          />
          {t('multipleEntries')}
        </label>

        <div className="flex justify-end border-t pt-4">
          <Button onClick={submit} disabled={busy || form.name.trim().length < 2 || !form.date || form.venue.trim().length < 2}>
            {busy ? <Loader2 className="animate-spin size-4" aria-hidden /> : null}
            {t('save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
