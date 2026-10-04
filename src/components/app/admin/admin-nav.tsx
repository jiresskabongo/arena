'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  LayoutDashboard, Users, Building2, CalendarDays, CreditCard, Receipt,
  Layers, Palette, Cpu, ScrollText, BarChart3,
} from 'lucide-react';

const NAV = [
  { href: '', label: 'nav.dashboard', icon: LayoutDashboard },
  { href: 'users', label: 'nav.users', icon: Users },
  { href: 'organizations', label: 'nav.organizations', icon: Building2 },
  { href: 'events', label: 'nav.events', icon: CalendarDays },
  { href: 'subscriptions', label: 'nav.subscriptions', icon: CreditCard },
  { href: 'payments', label: 'nav.payments', icon: Receipt },
  { href: 'plans', label: 'nav.plans', icon: Layers },
  { href: 'templates', label: 'nav.templates', icon: Palette },
  { href: 'ai-credits', label: 'nav.aiCredits', icon: Cpu },
  { href: 'logs', label: 'nav.logs', icon: ScrollText },
  { href: 'analytics', label: 'nav.analytics', icon: BarChart3 },
] as const;

export function AdminNav({ locale }: { locale: string }) {
  const t = useTranslations('admin');
  const pathname = usePathname();
  const base = `/${locale}/admin`;

  return (
    <aside className="hidden w-52 shrink-0 border-r border-border/60 bg-muted/30 md:block">
      <nav className="sticky top-16 flex flex-col gap-0.5 p-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === ''
            ? pathname === base
            : pathname === `${base}/${href}` || pathname.startsWith(`${base}/${href}/`);
          return (
            <Link
              key={href}
              href={`${base}/${href}`.replace(/\/$/, '')}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                active
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              <Icon className="size-4" aria-hidden />
              {t(label as never)}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
