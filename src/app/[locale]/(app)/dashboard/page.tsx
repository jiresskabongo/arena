import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { prisma } from '@/lib/prisma';
import { getAuth } from '@/server/auth/session';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, MailWarning, Settings, Hourglass, CalendarDays, Users, LayoutGrid } from 'lucide-react';

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('dashboard');
  const tNav = await getTranslations('nav');

  // Le layout (app) garantit déjà l'authentification ; garde défensive (défense en profondeur)
  const auth = await getAuth();
  if (!auth) redirect('/login');

  const isSuperAdmin = auth.user.isSuperAdmin;

  // Organisation active (CDC §6 : dérivée de la session, jamais du client)
  const activeOrg = isSuperAdmin
    ? null
    : await prisma.userActiveOrg.findUnique({
        where: { userId: auth.user.id },
        include: { organization: true },
      });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {t('hello', { name: auth.user.firstName })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isSuperAdmin
            ? t('adminSubtitle')
            : t('orgSubtitle', { org: activeOrg?.organization.name ?? '—' })}
        </p>
      </div>

      {!auth.user.emailVerifiedAt && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex items-start gap-3 pt-6">
            <MailWarning className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
            <div>
              <CardTitle className="text-sm">{t('verifyTitle')}</CardTitle>
              <CardDescription className="mt-1">
                {t('verifyBody')}{' '}
                <Link href="/demo/outbox" className="text-primary underline underline-offset-2">
                  {t('verifyOutbox')}
                </Link>
              </CardDescription>
            </div>
          </CardContent>
        </Card>
      )}

      {isSuperAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-primary" aria-hidden />
              {t('adminCardTitle')}
            </CardTitle>
            <CardDescription>{t('adminCardBody')}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CalendarDays className="size-4" aria-hidden />
                  <span className="text-sm">{t('statEvents')}</span>
                </div>
                <p className="mt-2 text-3xl font-semibold">—</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('statSoon')}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Users className="size-4" aria-hidden />
                  <span className="text-sm">{t('statGuests')}</span>
                </div>
                <p className="mt-2 text-3xl font-semibold">—</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('statSoon')}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <LayoutGrid className="size-4" aria-hidden />
                  <span className="text-sm">{t('statSubscription')}</span>
                </div>
                <p className="mt-2 text-3xl font-semibold">
                  <Badge variant="warning">{t('statSoonShort')}</Badge>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{t('statSoon')}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Hourglass className="size-5 text-primary" aria-hidden />
                {t('nextTitle')}
              </CardTitle>
              <CardDescription>{t('nextBody')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/settings/sessions">{t('sessions')}</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/demo/outbox">{t('outbox')}</Link>
              </Button>
              <Button variant="ghost" asChild>
                <Link href="/settings">
                  <Settings className="size-4" aria-hidden />
                  {tNav('settings')}
                </Link>
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
