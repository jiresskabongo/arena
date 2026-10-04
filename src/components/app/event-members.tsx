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
import { Loader2, Trash2, UserPlus, Users } from 'lucide-react';

interface Person {
  id: string;
  roleLabel: string;
  firstName: string;
  lastName: string;
  sortOrder: number;
}

export function EventMembersPanel({
  eventId, people, canEdit,
}: {
  eventId: string;
  people: Person[];
  canEdit: boolean;
}) {
  const t = useTranslations('events.detail');
  const router = useRouter();
  const [form, setForm] = useState({ roleLabel: '', firstName: '', lastName: '' });
  const [busy, setBusy] = useState<string | null>(null);

  async function add() {
    setBusy('add');
    const res = await apiFetch<{ member?: { id: string } }>(`/api/events/${eventId}/members`, {
      method: 'POST',
      body: JSON.stringify(form),
    }).finally(() => setBusy(null));
    if (res.ok) {
      setForm({ roleLabel: '', firstName: '', lastName: '' });
      toast.success(t('personAdded'));
      router.refresh();
    } else {
      toast.error(res.error?.details?.map((d) => d.message).join(' · ') ?? res.error?.message ?? t('personAddError'));
    }
  }

  async function remove(id: string) {
    setBusy(id);
    const res = await apiFetch(`/api/events/${eventId}/members/${id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success(t('personRemoved'));
      router.refresh();
    } else {
      toast.error(res.error?.message ?? t('personRemoveError'));
    }
    setBusy(null);
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {people.length === 0 && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="size-4" aria-hidden />
            {t('noPeople')}
          </p>
        )}
        <ul className="space-y-2">
          {people.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 rounded-xl border p-3">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-accent text-sm font-medium text-accent-foreground">
                  {p.firstName[0]}{p.lastName[0]}
                </span>
                <div>
                  <p className="text-sm font-medium">{p.firstName} {p.lastName}</p>
                  <p className="text-xs text-muted-foreground">{p.roleLabel}</p>
                </div>
              </div>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={busy !== null}
                  onClick={() => remove(p.id)}
                >
                  {busy === p.id ? <Loader2 className="animate-spin size-4" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
                </Button>
              )}
            </li>
          ))}
        </ul>

        {canEdit && (
          <div className="grid gap-3 border-t pt-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="pm-role">{t('personRole')}</Label>
              <Input id="pm-role" placeholder={t('personRolePlaceholder')} value={form.roleLabel} onChange={(e) => setForm({ ...form, roleLabel: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="pm-first">{t('personFirst')}</Label>
              <Input id="pm-first" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="pm-last">{t('personLast')}</Label>
              <Input id="pm-last" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
            </div>
            <div className="sm:col-span-3">
              <Button
                size="sm"
                variant="outline"
                onClick={add}
                disabled={busy !== null || !form.roleLabel || !form.firstName || !form.lastName}
                className="gap-1.5"
              >
                {busy === 'add' ? <Loader2 className="animate-spin size-4" aria-hidden /> : <UserPlus className="size-4" aria-hidden />}
                {t('personAdd')}
              </Button>
            </div>
          </div>
        )}
        {canEdit && (
          <p className="text-xs text-muted-foreground">{t('peoplePhotosSoon')}</p>
        )}
      </CardContent>
    </Card>
  );
}
