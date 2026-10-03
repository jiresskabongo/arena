import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireTenant, TenantError } from '@/server/services/tenant';
import { listMembers } from '@/server/services/team';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TeamPanel } from '@/components/app/team-panel';

export default async function TeamPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('app.team');

  let ctx;
  try {
    ctx = await requireTenant('members:read');
  } catch (e) {
    if (e instanceof TenantError && e.code === 'forbidden') {
      return (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('noPermissionTitle')}</CardTitle>
            <CardDescription>{t('noPermissionBody')}</CardDescription>
          </CardHeader>
        </Card>
      );
    }
    throw e;
  }
  if (!ctx.organization) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">{t('noOrg')}</CardContent>
      </Card>
    );
  }

  const members = await listMembers(ctx);
  const canInvite = ctx.role === 'owner' || ctx.role === 'manager';
  const canChangeRole = ctx.role === 'owner';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle', { count: members.length })}</p>
      </div>

      <TeamPanel
        locale={locale}
        canInvite={canInvite}
        canChangeRole={canChangeRole}
        members={members.map((m) => ({ ...m }))}
      />
    </div>
  );
}
