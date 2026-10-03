import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { prisma } from '@/lib/prisma';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Mail, FlaskConical } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * Boîte d'envoi (démo) — CDC : « mode mock clairement identifié ».
 * Affiche les e-mails générés par le provider mock (table MessageLog).
 */
export default async function DemoOutboxPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('outbox');

  const messages = await prisma.messageLog.findMany({
    where: { channel: 'email' },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });

  // Extraction des liens (verify-email / reset-password / dashboard)
  const extractLinks = (body: string): string[] => {
    const re = /https?:\/\/[^\s"'<>]+/g;
    return Array.from(new Set(body.match(re) ?? []));
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 font-display text-3xl font-semibold tracking-tight">
            {t('title')}
            <Badge variant="warning">
              <FlaskConical className="size-3" aria-hidden />
              {t('demoBadge')}
            </Badge>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/">{t('back')}</Link>
        </Button>
      </div>

      {messages.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-sm text-muted-foreground">
            {t('empty')}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {messages.map((m) => (
            <Card key={m.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Mail className="size-4 text-primary" aria-hidden />
                    {m.subject || '—'}
                  </CardTitle>
                  <span className="text-xs text-muted-foreground">
                    {new Date(m.createdAt).toLocaleString()}
                  </span>
                </div>
                <CardDescription>
                  {t('to')} <span className="font-medium text-foreground">{m.recipient}</span>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-surface-2 p-3 text-xs text-foreground">
                  {m.body}
                </pre>
                {extractLinks(m.body).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {extractLinks(m.body).map((url) => (
                      <Button key={url} variant="outline" size="sm" asChild>
                        <Link href={url}>{t('open')}</Link>
                      </Button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
