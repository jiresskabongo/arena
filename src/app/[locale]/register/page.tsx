'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Sparkles, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';

export default function RegisterPage() {
  const t = useTranslations('auth.register');
  const tc = useTranslations('common');
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    organizationName: '',
    password: '',
    confirm: '',
  });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (form.password !== form.confirm) errs.confirm = t('passwordMismatch');
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    const result = await apiFetch<{ user: { id: string } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        organizationName: form.organizationName,
        password: form.password,
      }),
    });
    setBusy(false);

    if (!result.ok) {
      if (result.error?.code === 'validation' && result.error.details) {
        const e2: Record<string, string> = {};
        for (const d of result.error.details) e2[d.field] = d.message;
        setErrors(e2);
      }
      toast.error(result.error?.message ?? tc('error'));
      return;
    }

    toast.success(t('success'));
    toast.info(t('checkEmail'), { icon: <CheckCircle2 className="size-4" /> });
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <Card className="w-full max-w-lg">
        <CardHeader className="items-center text-center">
          <span className="mb-2 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="size-5" aria-hidden />
          </span>
          <CardTitle className="font-display text-2xl">{t('title')}</CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="firstName">{t('firstName')}</Label>
                <Input id="firstName" required minLength={2} maxLength={50} value={form.firstName} onChange={set('firstName')} aria-invalid={!!errors.firstName} />
                {errors.firstName && <p className="text-xs text-danger">{errors.firstName}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">{t('lastName')}</Label>
                <Input id="lastName" required minLength={2} maxLength={50} value={form.lastName} onChange={set('lastName')} aria-invalid={!!errors.lastName} />
                {errors.lastName && <p className="text-xs text-danger">{errors.lastName}</p>}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{t('email')}</Label>
              <Input id="email" type="email" required value={form.email} onChange={set('email')} placeholder="vous@exemple.com" aria-invalid={!!errors.email} />
              {errors.email && <p className="text-xs text-danger">{errors.email}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="organizationName">{t('organization')}</Label>
              <Input id="organizationName" required minLength={2} maxLength={80} value={form.organizationName} onChange={set('organizationName')} placeholder={t('organizationPlaceholder')} aria-invalid={!!errors.organizationName} />
              {errors.organizationName && <p className="text-xs text-danger">{errors.organizationName}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="password">{t('password')}</Label>
                <Input id="password" type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={set('password')} aria-invalid={!!errors.password} />
                {errors.password && <p className="text-xs text-danger">{errors.password}</p>}
                <p className="text-xs text-muted-foreground">{t('passwordHint')}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">{t('confirm')}</Label>
                <Input id="confirm" type="password" required autoComplete="new-password" value={form.confirm} onChange={set('confirm')} aria-invalid={!!errors.confirm} />
                {errors.confirm && <p className="text-xs text-danger">{errors.confirm}</p>}
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('submit')}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t('hasAccount')}{' '}
            <Link href="/login" className="text-primary hover:underline">
              {tc('signIn')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
