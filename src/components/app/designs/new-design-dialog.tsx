'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Sparkles } from 'lucide-react';

const TYPES = [
  'save_the_date', 'invitation', 'vip_invitation', 'access_card', 'poster',
  'badge', 'program', 'thank_you_card', 'facebook_post', 'instagram_post',
  'story', 'whatsapp_visual', 'custom',
] as const;

const SIZES: Record<string, { width: number; height: number }> = {
  portrait: { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 },
  landscape: { width: 1350, height: 1080 },
  story: { width: 1080, height: 1920 },
  print: { width: 1587, height: 2245 },
};

export interface TemplateSummary {
  id: string;
  name: string;
  isPremium: boolean;
  locked: boolean;
  requiredPlan: string | null;
  thumbnailUrl: string | null;
  width: number;
  height: number;
}

export function NewDesignDialog({ templates }: { templates: TemplateSummary[] }) {
  const t = useTranslations('designs');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('invitation');
  const [format, setFormat] = useState<string>('portrait');
  const [templateId, setTemplateId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const size = SIZES[format] ?? SIZES.portrait;

  async function submit() {
    if (!name.trim()) {
      setError(t('create.nameRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    const res = await apiFetch<{ design: { id: string } }>('/api/designs', {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim(),
        type,
        format,
        width: templateId ? undefined : size.width,
        height: templateId ? undefined : size.height,
        templateId: templateId || undefined,
      }),
    });
    setBusy(false);
    if (!res.ok || !res.data) {
      setError(res.error?.message ?? t('create.error'));
      return;
    }
    setOpen(false);
    router.push(`/designs/${res.data.design.id}`);
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => { setOpen(true); setError(null); }} className="gap-2">
        <Plus className="size-4" aria-hidden />
        {t('create.new')}
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-12"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="w-full max-w-2xl rounded-xl border bg-background p-6 shadow-lg">
            <h2 className="text-lg font-semibold">{t('create.title')}</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="nd-name">{t('create.name')}</Label>
                <Input
                  id="nd-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('create.namePlaceholder')}
                  maxLength={120}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nd-type">{t('create.type')}</Label>
                <select
                  id="nd-type"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-sm"
                >
                  {TYPES.map((tp) => (
                    <option key={tp} value={tp}>{t(`types.${tp}` as never)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="nd-format">{t('create.format')}</Label>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(SIZES).map(([fmt, s]) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setFormat(fmt)}
                      className={`rounded-md border px-3 py-1.5 text-xs transition ${
                        format === fmt
                          ? 'border-primary bg-primary/10 text-primary font-medium'
                          : 'text-muted-foreground hover:border-primary/40'
                      }`}
                    >
                      {t(`formats.${fmt}` as never)}
                      <span className="ml-1 text-muted-foreground">({s.width}×{s.height})</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <span className="text-sm font-medium">{t('create.from')}</span>
                <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
                  <button
                    type="button"
                    onClick={() => setTemplateId('')}
                    className={`flex aspect-[4/5] items-center justify-center rounded-lg border-2 text-xs ${
                      templateId === '' ? 'border-primary' : 'border-transparent'
                    }`}
                  >
                    <span className="px-2 text-center text-muted-foreground">{t('create.blank')}</span>
                  </button>
                  {templates.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      disabled={tpl.locked}
                      onClick={() => setTemplateId(tpl.id)}
                      className={`relative aspect-[4/5] overflow-hidden rounded-lg border-2 ${
                        templateId === tpl.id ? 'border-primary' : 'border-transparent'
                      } ${tpl.locked ? 'opacity-60' : ''}`}
                      title={tpl.locked ? t('library.locked', { plan: tpl.requiredPlan ?? 'Pro' }) : tpl.name}
                    >
                      {tpl.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={tpl.thumbnailUrl} alt={tpl.name} className="h-full w-full object-cover" />
                      ) : null}
                      {tpl.locked && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                          <Sparkles className="size-4 text-white" aria-hidden />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>{t('cancel')}</Button>
              <Button onClick={submit} disabled={busy}>
                {busy ? t('creating') : t('create')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
