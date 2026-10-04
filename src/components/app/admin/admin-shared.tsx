'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Loader2 } from 'lucide-react';

export function SearchBox({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div className="relative w-full sm:w-64">
      <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-8"
      />
    </div>
  );
}

export function AdminPagination({ page, totalPages, onPage }: {
  page: number; totalPages: number; onPage: (p: number) => void;
}) {
  const t = useTranslations('admin');
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 text-sm">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t('prev')}
      </Button>
      <span className="text-muted-foreground">
        {t('pageOf', { page, total: totalPages })}
      </span>
      <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        {t('next')}
      </Button>
    </div>
  );
}

export function LoadingRows({ cols }: { cols: number }) {
  const t = useTranslations('admin');
  return (
    <tr>
      <td colSpan={cols} className="px-3 py-10 text-center text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> {t('loading')}
        </span>
      </td>
    </tr>
  );
}

export function EmptyRow({ cols, label }: { cols: number; label: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-3 py-10 text-center text-sm text-muted-foreground">{label}</td>
    </tr>
  );
}

export function ErrorRow({ cols, label }: { cols: number; label: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-3 py-10 text-center text-sm text-destructive">{label}</td>
    </tr>
  );
}

export function Pill({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'green' | 'red' | 'amber' | 'blue' | 'purple' }) {
  const tones: Record<string, string> = {
    muted: 'bg-muted text-muted-foreground',
    green: 'bg-emerald-100 text-emerald-800',
    red: 'bg-red-100 text-red-800',
    amber: 'bg-amber-100 text-amber-800',
    blue: 'bg-sky-100 text-sky-800',
    purple: 'bg-violet-100 text-violet-800',
  };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

/** Ton de pilule par statut courant (abonnements, paiements, plans…). */
export function statusTone(status: string): 'muted' | 'green' | 'red' | 'amber' | 'blue' | 'purple' {
  switch (status) {
    case 'active':
    case 'succeeded':
    case 'paid':
    case 'published':
    case 'confirmed':
      return 'green';
    case 'canceled':
    case 'failed':
    case 'void':
    case 'archived':
      return 'red';
    case 'trialing':
    case 'pending':
    case 'open':
    case 'past_due':
      return 'amber';
    case 'expired':
    case 'paused':
      return 'muted';
    case 'refunded':
      return 'blue';
    case 'draft':
      return 'purple';
    default:
      return 'muted';
  }
}
