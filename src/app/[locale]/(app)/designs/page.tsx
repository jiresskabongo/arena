import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireTenant } from '@/server/services/tenant';
import { listDesigns, listTemplates } from '@/server/services/design';
import { listEvents } from '@/server/services/event';
import { NewDesignDialog } from '@/components/app/designs/new-design-dialog';
import { AiDialog } from '@/components/app/designs/ai-dialog';
import { DesignsList } from '@/components/app/designs/designs-list';
import { Card, CardContent } from '@/components/ui/card';
import { Palette, Sparkles } from 'lucide-react';

export default async function DesignsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('designs');

  const ctx = await requireTenant();
  if (!ctx.organization) notFound();

  const [designs, templates, events] = await Promise.all([
    listDesigns(ctx, { page: 1, pageSize: 24 }),
    listTemplates(ctx),
    listEvents(ctx.organization!.id, 1, 50),
  ]);

  // Sérialisation client (dates → ISO, noms de relations)
  const items = designs.items.map((d) => ({
    id: d.id,
    name: d.name,
    type: d.type,
    format: d.format,
    status: d.status,
    version: d.version,
    templateName: d.template?.name ?? null,
    eventName: d.event?.name ?? null,
    coverUrl: null as string | null,
    updatedAt: d.updatedAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 font-display text-3xl font-semibold tracking-tight">
            <Palette className="size-6 text-primary" aria-hidden />
            {t('title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AiDialog
            events={events.items.map((e) => ({ id: e.id, name: e.name }))}
          />
          <NewDesignDialog templates={templates} />
        </div>
      </div>

      {/* Bibliothèque de templates */}
      <Card>
        <CardContent className="pt-6">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden />
            <h2 className="text-sm font-semibold">{t('library.title')}</h2>
            <span className="text-xs text-muted-foreground">{t('library.hint')}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {templates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                className="group relative aspect-[4/5] overflow-hidden rounded-lg border bg-muted text-left transition hover:ring-2 hover:ring-primary/50"
                title={tpl.locked ? t('library.lockedTip') : t('library.use', { name: tpl.name })}
              >
                {tpl.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={tpl.thumbnailUrl}
                    alt={tpl.name}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    {tpl.name}
                  </div>
                )}
                {tpl.locked && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 text-white">
                    <Sparkles className="size-5" aria-hidden />
                    <span className="px-2 text-center text-[11px] font-medium">
                      {t('library.locked', { plan: tpl.requiredPlan ?? 'Pro' })}
                    </span>
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-4">
                  <p className="truncate text-[11px] font-medium text-white">{tpl.name}</p>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <DesignsList items={items} total={designs.total} locale={locale} />
    </div>
  );
}
