'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';

type State = 'checking' | 'ok' | 'error' | 'expired' | 'invalid';

function VerifyEmailForm() {
  const t = useTranslations('auth.verify');
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [state, setState] = useState<State>(token ? 'checking' : 'invalid');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !token) return;
    ran.current = true;
    (async () => {
      const result = await apiFetch<{ ok: boolean }>('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      if (result.ok) setState('ok');
      else if (result.status === 410) setState('expired');
      else if (result.error?.code === 'rate_limited') setState('checking');
      else setState('invalid');
    })();
  }, [token]);

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          {state === 'checking' && <Loader2 className="size-10 animate-spin text-primary" aria-hidden />}
          {state === 'ok' && <CheckCircle2 className="size-10 text-success" aria-hidden />}
          {(state === 'error' || state === 'expired' || state === 'invalid') && (
            <XCircle className="size-10 text-danger" aria-hidden />
          )}
          <CardTitle className="mt-3 font-display text-xl">
            {state === 'checking' && t('checking')}
            {state === 'ok' && t('success')}
            {state === 'expired' && t('expired')}
            {(state === 'error' || state === 'invalid') && t('invalid')}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center">
          {state === 'ok' && (
            <Link href="/dashboard">
              <Button className="w-full">{t('goDashboard')}</Button>
            </Link>
          )}
          {state === 'expired' && (
            <Link href="/forgot-password">
              <Button variant="outline" className="w-full">
                {t('newLink')}
              </Button>
            </Link>
          )}
          {state === 'invalid' && (
            <Link href="/login">
              <Button variant="outline" className="w-full">{t('backLogin')}</Button>
            </Link>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailForm />
    </Suspense>
  );
}
