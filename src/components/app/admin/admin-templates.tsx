'use client';

import { useCallback, useEffect, useState } from 'react';
import { useEscape } from '@/lib/use-escape';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { SearchBox, AdminPagination, LoadingRows, EmptyRow, ErrorRow, Pill, statusTone } from './admin-shared';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';

interface Tpl {
  id: string;
  name: string;
  category: string;
  style: string;
  format: string;
  width: number;
  height: number;
  contentJson: unknown;
  isPremium: boolean;
  requiredPlan: string | null;
  isFeatured: boolean;
  status: string;
  _count: { designs: number };
}

interface List { items: Tpl[]; total: number; page: number; pageSize: number; totalPages: number }

const CATEGORIES = ['mariage', 'anniversaire', 'soutenance', 'conference', 'baptême', 'gala', 'entreprise', 'vip', 'save_the_date'];
const STYLES = ['romantique', 'luxe', 'moderne', 'minimaliste', 'classique', 'floral', 'africain contemporain', 'professionnel'];
const FORMATS = ['portrait', 'square', 'landscape', 'story', 'print'];
const SIZES: Record<string, [number, number]> = {
  portrait: [1080, 1350], square: [1080, 1080], landscape: [1350, 1080],
  story: [1080, 1920], print: [1587, 2245],
};

interface Draft {
  name: string; category: string; style: string; format: string;
  isPremium: boolean; requiredPlan: string; isFeatured: boolean;
  status: string; content: string;
}

function emptyDraft(): Draft {
  return {
    name: '', category: 'mariage', style: 'moderne', format: 'portrait',
    isPremium: false, requiredPlan: '', isFeatured: false, status: 'published',
    content: JSON.stringify({ background: { type: 'color', value: '#FFFFFF' }, elements: [] }, null, 2),
  };
}

function toDraft(t: Tpl): Draft {
  return {
    name: t.name, category: t.category, style: t.style, format: t.format,
    isPremium: t.isPremium, requiredPlan: t.requiredPlan ?? '', isFeatured: t.isFeatured,
    status: t.status, content: JSON.stringify(t.contentJson, null, 2),
  };
}

export function TemplatesAdmin() {
  const t = useTranslations('admin');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [scope, setScope] = useState<'platform' | 'all'>('platform');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<List | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => { setDebounced(search); setPage(1); }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ page: String(page), scope, search: debounced });
    const res = await apiFetch<List>(`/api/admin/templates?${qs}`);
    setLoading(false);
    if (res.ok && res.data) { setData(res.data); setError(false); }
    else setError(true);
  }, [page, scope, debounced]);

  useEffect(() => { void load(); }, [load]);

  useEscape(Boolean(draft), () => setDraft(null));

  function openCreate() { setDraft(emptyDraft()); setIsNew(true); setEditId(null); setErr(null); }
  function openEdit(x: Tpl) { setDraft(toDraft(x)); setIsNew(false); setEditId(x.id); setErr(null); }

  async function save() {
    if (!draft) return;
    if (draft.name.trim().length < 2) { setErr(t('templates.nameRequired')); return; }
    let content: Record<string, unknown>;
    try {
      content = JSON.parse(draft.content);
    } catch {
      setErr(t('templates.invalidJson'));
      return;
    }
    const [w, h] = SIZES[draft.format] ?? SIZES.portrait;
    setBusy(true);
    setErr(null);
    const body = {
      name: draft.name.trim(), category: draft.category, style: draft.style, format: draft.format,
      width: w, height: h, contentJson: content, isPremium: draft.isPremium,
      requiredPlan: draft.requiredPlan || null, isFeatured: draft.isFeatured, status: draft.status,
    };
    const res = await apiFetch(isNew ? '/api/admin/templates' : `/api/admin/templates/${editId}`, {
      method: isNew ? 'POST' : 'PATCH',
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) { setErr(res.error?.message ?? t('loadError')); return; }
    setDraft(null);
    void load();
  }

  async function remove(x: Tpl) {
    if (!confirm(t('templates.deleteConfirm', { name: x.name }))) return;
    setBusy(true);
    const res = await apiFetch<{ deleted: boolean; archived: boolean; usedByDesigns: number }>(`/api/admin/templates/${x.id}`, { method: 'DELETE' });
    setBusy(false);
    setFlash(res.ok && res.data
      ? (res.data.archived ? t('templates.archivedInstead', { n: res.data.usedByDesigns }) : t('templates.deleted'))
      : (res.error?.message ?? t('loadError')));
    if (res.ok) void load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchBox value={search} onChange={setSearch} placeholder={t('templates.searchPlaceholder')} />
          <div className="flex gap-1">
            {(['platform', 'all'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setScope(s); setPage(1); }}
                className={`rounded-full px-3 py-1 text-xs transition ${
                  scope === s ? 'bg-primary font-medium text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {s === 'platform' ? t('templates.scopePlatform') : t('templates.scopeAll')}
              </button>
            ))}
          </div>
        </div>
        <Button size="sm" onClick={openCreate} className="gap-1.5">
          <Plus className="size-4" /> {t('templates.new')}
        </Button>
      </div>
      {flash && <p className="text-xs text-muted-foreground">{flash}</p>}

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">{t('templates.colName')}</th>
                <th className="px-3 py-2.5 font-medium">{t('templates.colMeta')}</th>
                <th className="px-3 py-2.5 font-medium">{t('templates.colFlags')}</th>
                <th className="px-3 py-2.5 font-medium">{t('templates.colStatus')}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && <LoadingRows cols={5} />}
              {!loading && error && <ErrorRow cols={5} label={t('loadError')} />}
              {!loading && !error && data && data.items.length === 0 && (
                <EmptyRow cols={5} label={t('templates.empty')} />
              )}
              {!loading && !error && data?.items.map((x) => (
                <tr key={x.id} className="border-b last:border-0">
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{x.name}</p>
                    <p className="text-xs text-muted-foreground">{x.width}×{x.height} · {x._count.designs} {t('templates.usages')}</p>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{x.category} · {x.style} · {x.format}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {x.isFeatured && <Pill tone="purple">{t('templates.featured')}</Pill>}
                      {x.isPremium && <Pill tone="amber">{t('templates.premium')}</Pill>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5"><Pill tone={statusTone(x.status)}>{x.status}</Pill></td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => openEdit(x)}>
                        <Pencil className="size-3.5" /> {t('edit')}
                      </Button>
                      <Button variant="ghost" size="sm" disabled={busy} className="text-destructive hover:text-destructive" onClick={() => void remove(x)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {data && <AdminPagination page={data.page} totalPages={data.totalPages} onPage={setPage} />}

      {draft && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-10"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setDraft(null); }}>
          <div role="dialog" aria-modal="true" aria-label="Template" className="w-full max-w-2xl rounded-xl border bg-background p-6 shadow-lg">
            <h2 className="text-lg font-semibold">{isNew ? t('templates.new') : `${t('edit')} — ${draft.name}`}</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="tpl-name">{t('templates.name')}</Label>
                <Input id="tpl-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={120} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-status">{t('templates.colStatus')}</Label>
                <select id="tpl-status" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                  className="h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-sm">
                  <option value="published">published</option>
                  <option value="draft">draft</option>
                  <option value="archived">archived</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-cat">{t('templates.category')}</Label>
                <select id="tpl-cat" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                  className="h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-sm">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-style">{t('templates.style')}</Label>
                <select id="tpl-style" value={draft.style} onChange={(e) => setDraft({ ...draft, style: e.target.value })}
                  className="h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-sm">
                  {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-format">{t('templates.format')}</Label>
                <select id="tpl-format" value={draft.format} onChange={(e) => setDraft({ ...draft, format: e.target.value })}
                  className="h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-sm">
                  {FORMATS.map((f) => <option key={f} value={f}>{f} ({SIZES[f][0]}×{SIZES[f][1]})</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.isFeatured} onChange={(e) => setDraft({ ...draft, isFeatured: e.target.checked })} />
                {t('templates.featured')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.isPremium} onChange={(e) => setDraft({ ...draft, isPremium: e.target.checked })} />
                {t('templates.premium')}
              </label>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-plan">{t('templates.requiredPlan')}</Label>
                <select id="tpl-plan" value={draft.requiredPlan} onChange={(e) => setDraft({ ...draft, requiredPlan: e.target.value })}
                  className="h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-sm">
                  <option value="">{t('templates.allPlans')}</option>
                  {['starter', 'pro', 'business'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1.5 sm:col-span-3">
                <Label htmlFor="tpl-content">{t('templates.content')}</Label>
                <textarea
                  id="tpl-content"
                  value={draft.content}
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                  rows={10}
                  className="w-full rounded-md border bg-transparent p-3 font-mono text-xs shadow-sm"
                />
              </div>
            </div>
            {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDraft(null)}>{t('cancel')}</Button>
              <Button onClick={() => void save()} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                {t('save')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
