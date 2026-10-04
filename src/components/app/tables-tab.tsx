'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import { Loader2, Plus, Trash2, Armchair } from 'lucide-react';

interface TableItem {
  id: string;
  name: string;
  capacity: number;
  sortOrder: number;
  occupied: number;
}

export function TablesTab({
  eventId, canManage, onChanged,
}: {
  eventId: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations('events.guests');
  const [tables, setTables] = useState<TableItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', capacity: 8 });
  const [editing, setEditing] = useState<TableItem | null>(null);
  const [editForm, setEditForm] = useState({ name: '', capacity: 8 });
  const inputCls =
    'flex h-10 w-full rounded-xl border border-input bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60';

  const load = useCallback(async () => {
    setError(null);
    const res = await apiFetch<{ tables: TableItem[] }>(`/api/events/${eventId}/tables`);
    if (res.ok && res.data) setTables(res.data.tables);
    else setError(res.error?.message ?? t('loadError'));
  }, [eventId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    const res = await apiFetch<{ table: TableItem }>(`/api/events/${eventId}/tables`, {
      method: 'POST',
      body: JSON.stringify(form),
    }).finally(() => setBusy(false));
    if (res.ok) {
      toast.success(t('tableAdded'));
      setForm({ name: '', capacity: 8 });
      void load();
      onChanged();
    } else {
      toast.error(res.error?.message ?? t('tableError'));
    }
  }

  async function update(tb: TableItem) {
    setBusy(true);
    const res = await apiFetch(`/api/events/${eventId}/tables/${tb.id}`, {
      method: 'PATCH',
      body: JSON.stringify(editForm),
    }).finally(() => setBusy(false));
    if (res.ok) {
      toast.success(t('saved'));
      setEditing(null);
      void load();
      onChanged();
    } else {
      toast.error(res.error?.message ?? t('tableError'));
    }
  }

  async function remove(tb: TableItem) {
    setBusy(true);
    const res = await apiFetch(`/api/events/${eventId}/tables/${tb.id}`, {
      method: 'DELETE',
    }).finally(() => setBusy(false));
    if (res.ok) {
      toast.success(t('tableRemoved'));
      void load();
      onChanged();
    } else {
      toast.error(res.error?.message ?? t('tableError'));
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center justify-between pt-6 text-sm text-destructive">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>{t('retry')}</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        {tables === null && !error ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="animate-spin size-4" aria-hidden />
            {t('loading')}
          </div>
        ) : tables && tables.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
              <Armchair className="size-6" aria-hidden />
            </span>
            <p className="text-sm text-muted-foreground">{t('noTables')}</p>
          </div>
        ) : (
          <ul className="divide-y">
            {tables?.map((tb) => {
              const full = tb.occupied >= tb.capacity;
              return (
                <li key={tb.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  {editing?.id === tb.id ? (
                    <div className="flex flex-1 flex-wrap items-end gap-3">
                      <div className="min-w-40 flex-1">
                        <Label>{t('tableName')}</Label>
                        <Input className={inputCls} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                      </div>
                      <div className="w-28">
                        <Label>{t('tableCapacity')}</Label>
                        <Input
                          className={inputCls}
                          type="number"
                          min={1}
                          max={200}
                          value={editForm.capacity}
                          onChange={(e) => setEditForm({ ...editForm, capacity: Number(e.target.value) || 1 })}
                        />
                      </div>
                      <Button size="sm" disabled={busy || editForm.name.trim().length < 1} onClick={() => void update(tb)}>
                        {t('save')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
                        {t('cancel')}
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="min-w-32 flex-1">
                        <p className="text-sm font-medium">{tb.name}</p>
                        <div className="mt-1 h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full ${full ? 'bg-rose-500' : 'bg-primary'}`}
                            style={{ width: `${Math.min(100, Math.round((tb.occupied / tb.capacity) * 100))}%` }}
                          />
                        </div>
                      </div>
                      <BadgeOccupancy occupied={tb.occupied} capacity={tb.capacity} full={full} />
                      {canManage && (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditing(tb);
                              setEditForm({ name: tb.name, capacity: tb.capacity });
                            }}
                          >
                            {t('edit')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => void remove(tb)}
                            disabled={busy}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {canManage && (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 pt-6">
            <div className="min-w-40 flex-1">
              <Label>{t('tableName')}</Label>
              <Input
                className={inputCls}
                placeholder={t('tablePlaceholder')}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="w-28">
              <Label>{t('tableCapacity')}</Label>
              <Input
                className={inputCls}
                type="number"
                min={1}
                max={200}
                value={form.capacity}
                onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) || 1 })}
              />
            </div>
            <Button size="sm" className="gap-1.5" disabled={busy || form.name.trim().length < 1} onClick={create}>
              {busy ? <Loader2 className="animate-spin size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
              {t('addTable')}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BadgeOccupancy({ occupied, capacity, full }: { occupied: number; capacity: number; full: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
        full ? 'bg-rose-500/10 text-rose-600' : 'bg-accent text-accent-foreground'
      }`}
    >
      {occupied}/{capacity}
    </span>
  );
}
