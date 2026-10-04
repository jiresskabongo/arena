'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Users, Building2, CalendarDays, CreditCard, DollarSign, Cpu, HardDrive,
  MessagesSquare, Layers, Sparkles,
} from 'lucide-react';

interface Dashboard {
  users: { total: number; new7d: number };
  organizations: { total: number; active: number };
  events: { total: number; published: number };
  subscriptions: { total: number; byStatus: Record<string, number>; plans: number };
  payments: { total: number; succeededAmountMinor: number };
  invoices: { paid: number; paidAmountMinor: number };
  designs: { total: number };
  templates: { platform: number };
  ai: { monthCost: number; monthRefunded: number; monthConsumed: number };
  storage: { usedMb: number };
  messages: { total: number };
}

function Stat({ icon: Icon, label, value, sub }: {
  icon: typeof Users; label: string; value: string; sub?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 pt-5">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums">{value}</p>
          {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminDashboardClient() {
  const t = useTranslations('admin');
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await apiFetch<{ dashboard: Dashboard }>('/api/admin/dashboard');
      if (!alive) return;
      if (res.ok && res.data) setData(res.data.dashboard);
      else setError(true);
    })();
    return () => { alive = false; };
  }, []);

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-destructive">{t('loadError')}</CardContent>
      </Card>
    );
  }
  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Stat icon={Users} label={t('dashboard.users')} value={String(data.users.total)} sub={`${t('dashboard.new7d')} ${data.users.new7d}`} />
      <Stat icon={Building2} label={t('dashboard.orgs')} value={String(data.organizations.total)} sub={`${t('dashboard.active')} ${data.organizations.active}`} />
      <Stat icon={CalendarDays} label={t('dashboard.events')} value={String(data.events.total)} sub={`${t('dashboard.published')} ${data.events.published}`} />
      <Stat icon={CreditCard} label={t('dashboard.subscriptions')} value={String(data.subscriptions.total)} sub={`${t('dashboard.plans')} ${data.subscriptions.plans}`} />
      <Stat icon={DollarSign} label={t('dashboard.revenuePaid')} value={`${Math.round(data.invoices.paidAmountMinor / 100)} $`} sub={`${t('dashboard.invoicesPaid')} ${data.invoices.paid}`} />
      <Stat icon={Sparkles} label={t('dashboard.designs')} value={String(data.designs.total)} />
      <Stat icon={Cpu} label={t('dashboard.aiMonth')} value={String(data.ai.monthConsumed)} sub={`${t('dashboard.aiRefunded')} ${data.ai.monthRefunded}`} />
      <Stat icon={HardDrive} label={t('dashboard.storage')} value={`${data.storage.usedMb} Mo`} />
      <Stat icon={MessagesSquare} label={t('dashboard.messages')} value={String(data.messages.total)} />
      <Stat icon={Layers} label={t('dashboard.platformTemplates')} value={String(data.templates.platform)} />
      <Stat icon={CreditCard} label={t('dashboard.payments')} value={String(data.payments.total)} />
      <Card>
        <CardContent className="pt-5">
          <p className="text-xs text-muted-foreground">{t('dashboard.subByStatus')}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.entries(data.subscriptions.byStatus).map(([st, n]) => (
              <span key={st} className="rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums">
                {st} · {n}
              </span>
            ))}
            {Object.keys(data.subscriptions.byStatus).length === 0 && (
              <span className="text-[11px] text-muted-foreground">—</span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
