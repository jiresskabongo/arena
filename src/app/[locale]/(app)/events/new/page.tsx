import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NewEventForm } from '@/components/app/new-event-form';

export default async function NewEventPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('events');

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t('newTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('newBody')}</p>
      </div>
      <NewEventForm locale={locale} />
    </div>
  );
}
