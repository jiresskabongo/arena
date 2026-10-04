import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Compass } from 'lucide-react';

export default async function NotFoundPage({
  params,
}: {
  params: Promise<{ locale?: string }>;
}) {
  const p = (await params) ?? {};
  const locale = p.locale ?? 'fr';
  setRequestLocale(locale);
  const t = await getTranslations('notFound');

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
        <Compass className="size-7" aria-hidden />
      </span>
      <p className="mt-6 text-sm font-semibold uppercase tracking-widest text-primary">{t('code')}</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{t('body')}</p>
      <div className="mt-6 flex gap-3">
        <Button asChild>
          <Link href="/">{t('home')}</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/dashboard">{t('dashboard')}</Link>
        </Button>
      </div>
    </div>
  );
}
