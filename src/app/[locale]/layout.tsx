import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { Toaster } from '@/components/ui/sonner';
import { ThemeToggle } from '@/components/theme-toggle';
import '@fontsource-variable/inter';
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/500.css';
import '@fontsource/playfair-display/600.css';
import '@fontsource/playfair-display/700.css';
import '../globals.css';

export const metadata: Metadata = {
  title: {
    default: 'EventFlow — Invitations & événements',
    template: '%s — EventFlow',
  },
  description:
    'Créez des invitations élégantes, invitez vos participants et gérez votre événement de A à Z depuis une seule plateforme.',
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const messages = await getMessages();

  return (
    // `suppressHydrationWarning` : le script inline ci-dessous ajoute la classe
    // `dark` sur <html> AVANT l'hydratation (anti-flash). React ne rend donc
    // jamais de `className` sur <html> — la classe du thème est hors de sa
    // réconciliation (pas de mismatch, et aucune réécriture au re-render).
    <html lang={locale} suppressHydrationWarning>
      <body className="flex min-h-dvh flex-col">
        {/* Applique le thème avant le premier paint (évite le flash) */}
        <script
          id="theme-init"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
        <div className="fixed right-4 top-4 z-50">
          <ThemeToggle />
        </div>
        <Toaster />
      </body>
    </html>
  );
}
