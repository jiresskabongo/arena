import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { prisma } from '@/lib/prisma';
import { getAuth } from '@/server/auth/session';
import { UserMenu } from '@/components/app/user-menu';
import { Sparkles } from 'lucide-react';

export const metadata: Metadata = { title: 'Espace client' };

/**
 * Layout protégé du côté client (CDC §7 : protection des routes).
 * Sans session → redirige vers /login (le `next` est reconstruit par l'utilisateur
 * via le bouton « retour » si nécessaire).
 */
export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('common');

  const auth = await getAuth();
  if (!auth) redirect('/login');

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Sparkles className="size-5" aria-hidden />
            </span>
            <span className="font-display text-lg font-semibold tracking-tight">{t('appName')}</span>
            <span className="ml-2 hidden rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground sm:inline">
              {t('tagline')}
            </span>
          </Link>
          <UserMenu
            firstName={auth.user.firstName}
            email={auth.user.email}
            isSuperAdmin={auth.user.isSuperAdmin}
          />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
