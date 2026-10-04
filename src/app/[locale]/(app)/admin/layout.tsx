import type { ReactNode } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { prisma } from '@/lib/prisma';
import { getAuth } from '@/server/auth/session';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { AdminNav } from '@/components/app/admin/admin-nav';

export const metadata = { title: 'Administration' };

/**
 * Layout super admin (CDC : espace plateforme, drapeau isSuperAdmin).
 * Tout compte sans le drapeau → écran 403 explicite (jamais de page blanche).
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('admin');

  const auth = await getAuth();
  if (!auth) {
    // Non authentifié → le login (le next sera reconstruit par l'écran login)
    const next = encodeURIComponent(`/${locale}/admin`);
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <p className="text-sm text-muted-foreground">{t('needLogin')}</p>
          <a href={`/login?next=${next}`} className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
            {t('goLogin')}
          </a>
        </div>
      </div>
    );
  }

  if (!auth.user.isSuperAdmin) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-sm rounded-xl border bg-card p-8 text-center shadow-sm">
          <ShieldAlert className="mx-auto size-10 text-destructive" aria-hidden />
          <h1 className="mt-3 font-display text-xl font-semibold">{t('forbidden')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('forbiddenBody')}</p>
          <a href={`/${locale}/dashboard`} className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
            {t('backDashboard')}
          </a>
        </div>
      </div>
    );
  }

  // Compteur rapide d'alertes (orgs inactives avec sub active) pour la nav
  const alerts = await prisma.subscription.findFirst({
    where: { status: 'active', organization: { isActive: false } },
    select: { id: true },
  }).then((r) => (r ? 1 : 0));

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 bg-primary/5 px-4 py-2 text-xs text-muted-foreground sm:px-6">
        <ShieldCheck className="size-3.5 text-primary" aria-hidden />
        {t('platformBadge')}
        {alerts > 0 && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">{t('alertsBadge')}</span>}
      </div>
      <div className="flex flex-1">
        <AdminNav locale={locale} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
