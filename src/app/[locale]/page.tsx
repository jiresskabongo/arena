import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import {
  Palette,
  QrCode,
  LineChart,
  Sparkles,
  UserPlus,
  Wand2,
  Send,
  ScanLine,
} from 'lucide-react';

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('landing');
  const tc = await getTranslations('common');

  const features = [
    { icon: Palette, title: t('feature1Title'), body: t('feature1Body') },
    { icon: QrCode, title: t('feature2Title'), body: t('feature2Body') },
    { icon: LineChart, title: t('feature3Title'), body: t('feature3Body') },
  ];

  const steps = [t('howStep1'), t('howStep2'), t('howStep3'), t('howStep4')];
  const stepIcons = [UserPlus, Wand2, Send, ScanLine];

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Sparkles className="size-5" aria-hidden />
            </span>
            <span className="font-display text-xl font-semibold tracking-tight">{tc('appName')}</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/login">{tc('signIn')}</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/register">{tc('signUp')}</Link>
            </Button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,var(--accent)_0%,transparent_70%)] opacity-60"
        />
        <div className="relative mx-auto max-w-4xl px-4 pb-20 pt-20 text-center sm:px-6 sm:pt-28">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" aria-hidden />
            {t('heroBadge')}
          </span>
          <h1 className="mt-6 font-display text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
            {t('heroTitle')}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t('heroSubtitle')}
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="lg" asChild>
              <Link href="/register">{t('ctaPrimary')}</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="#how">{t('ctaSecondary')}</Link>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">7 jours d’essai · Sans carte bancaire</p>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-6 md:grid-cols-3">
          {features.map(({ icon: Icon, title, body }) => (
            <Card key={title} className="transition-shadow hover:shadow-md">
              <CardContent className="pt-6">
                <span className="inline-flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <Icon className="size-5" aria-hidden />
                </span>
                <CardTitle className="mt-4 text-base">{title}</CardTitle>
                <CardDescription className="mt-2 leading-relaxed">{body}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-t border-border/60 bg-surface/60">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-center font-display text-2xl font-semibold sm:text-3xl">{t('howTitle')}</h2>
          <ol className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((label, i) => {
              const Icon = stepIcons[i];
              return (
                <li key={label} className="relative rounded-2xl border border-border bg-surface p-5">
                  <span className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <p className="mt-3 text-sm font-medium">{label}</p>
                  <span className="absolute right-4 top-4 font-display text-3xl text-border" aria-hidden>
                    {i + 1}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <span>© 2026 {tc('appName')}</span>
          <span>{t('footerNote')}</span>
        </div>
      </footer>
    </div>
  );
}
