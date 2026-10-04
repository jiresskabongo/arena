'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { ImageIcon, LayoutTemplate } from 'lucide-react';

export interface DesignListItem {
  id: string;
  name: string;
  type: string;
  format: string;
  status: string;
  version: number;
  templateName?: string | null;
  eventName?: string | null;
  coverUrl?: string | null;
  updatedAt: string;
}

export function DesignsList({
  items,
  total,
  locale,
}: {
  items: DesignListItem[];
  total: number;
  locale: string;
}) {
  const t = useTranslations('designs');
  const tf = useTypeLabel();

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">
        {t('myDesigns.title')} <span className="text-muted-foreground">({total})</span>
      </h2>
      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <ImageIcon className="size-8 text-muted-foreground/60" aria-hidden />
            <p className="text-sm text-muted-foreground">{t('myDesigns.empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((d) => (
            <Link
              key={d.id}
              href={`/${locale}/designs/${d.id}`}
              className="group rounded-lg border bg-card p-3 text-left transition hover:border-primary/50 hover:shadow-sm"
            >
              <div className="mb-2 flex aspect-[4/5] items-center justify-center overflow-hidden rounded-md bg-muted">
                {d.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.coverUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <LayoutTemplate className="size-8 text-muted-foreground/50" aria-hidden />
                )}
              </div>
              <p className="truncate text-sm font-medium">{d.name}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {tf(d.type)}
                {d.eventName ? ` · ${d.eventName}` : ''}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function useTypeLabel() {
  const t = useTranslations('designs.types');
  return (type: string) => {
    try {
      return t(type as never);
    } catch {
      return type;
    }
  };
}
