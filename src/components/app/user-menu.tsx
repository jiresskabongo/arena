'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import Link from 'next/link';
import { LogOut, Loader2, ShieldCheck, User, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';

export function UserMenu({
  firstName,
  email,
  isSuperAdmin,
}: {
  firstName: string;
  email: string;
  isSuperAdmin: boolean;
}) {
  const t = useTranslations('nav');
  const [tApp] = [useTranslations('app')];
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    await apiFetch('/api/auth/logout', { method: 'POST' });
    toast.success(tApp('loggedOut'));
    router.push('/');
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      {isSuperAdmin && (
        <span className="hidden items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary sm:inline-flex">
          <ShieldCheck className="size-3.5" aria-hidden />
          {tApp('superAdmin')}
        </span>
      )}
      <div className="hidden text-right sm:block">
        <p className="text-sm font-medium leading-tight">{firstName}</p>
        <p className="text-xs text-muted-foreground leading-tight">{email}</p>
      </div>
      <span className="flex size-9 items-center justify-center rounded-full bg-accent text-accent-foreground" aria-hidden>
        <User className="size-4" />
      </span>
      {!isSuperAdmin && (
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link href="/settings/plan">
            <CreditCard className="size-4" aria-hidden />
            <span className="hidden md:inline">{t('plan')}</span>
          </Link>
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={logout} disabled={busy} className="gap-1.5">
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut className="size-4" aria-hidden />}
        <span className="hidden md:inline">{t('logout')}</span>
      </Button>
    </div>
  );
}
