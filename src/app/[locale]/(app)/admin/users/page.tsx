import { getTranslations, setRequestLocale } from 'next-intl/server';
import { UsersAdmin } from '@/components/app/admin/admin-users';

export default async function AdminPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('admin');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{t('users.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('users.subtitle')}</p>
      </div>
      <UsersAdmin />
    </div>
  );
}
