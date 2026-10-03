'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CalendarDays, Users, CreditCard, LayoutDashboard } from 'lucide-react';

export function AppNav({ canSeeTeam }: { canSeeTeam: boolean }) {
  const t = useTranslations('nav');
  const pathname = usePathname();

  const links = [
    { href: '/dashboard', label: t('dashboard'), icon: LayoutDashboard, show: true },
    { href: '/events', label: t('events'), icon: CalendarDays, show: true },
    { href: '/settings/team', label: t('team'), icon: Users, show: canSeeTeam },
    { href: '/settings/plan', label: t('plan'), icon: CreditCard, show: true },
  ].filter((l) => l.show);

  return (
    <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
      {links.map(({ href, label, icon: Icon }) => {
        const active = href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            }`}
            aria-current={active ? 'page' : undefined}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
