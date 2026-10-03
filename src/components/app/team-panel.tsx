'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import { Mail, Loader2, Trash2, UserRound } from 'lucide-react';

interface Member {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  isSelf: boolean;
  canEdit: boolean;
}

const ROLE_SELECT = ['manager', 'designer', 'scanner', 'viewer'];

export function TeamPanel({
  members: initial, canInvite, canChangeRole, locale,
}: {
  members: Member[];
  canInvite: boolean;
  canChangeRole: boolean;
  locale: string;
}) {
  const t = useTranslations('app.team');
  const [members, setMembers] = useState(initial);
  const [invite, setInvite] = useState({ email: '', role: 'designer' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  async function run(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    try {
      await fn();
    } finally {
      setBusyId(null);
    }
  }

  async function sendInvite() {
    setInviting(true);
    const res = await apiFetch<{ member?: Member }>('/api/organization/members', {
      method: 'POST',
      body: JSON.stringify(invite),
    }).finally(() => setInviting(false));
    if (res.ok) {
      if (res.data?.member) {
        setMembers((m) => [
          ...m,
          {
            id: res.data!.member!.id, email: res.data!.member!.email, name: null, role: res.data!.member!.role,
            status: 'invited', isSelf: false, canEdit: canChangeRole,
          },
        ]);
      }
      setInvite({ email: '', role: 'designer' });
      toast.success(t('inviteSent', { email: invite.email }));
    } else {
      toast.error(res.error?.message ?? t('inviteError'));
    }
  }

  async function changeRole(id: string, role: string) {
    await run(id, async () => {
      const res = await apiFetch(`/api/organization/members/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      if (res.ok) {
        setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, role } : m)));
        toast.success(t('roleUpdated'));
      } else {
        toast.error(res.error?.message ?? t('roleError'));
      }
    });
  }

  async function remove(id: string) {
    await run(id, async () => {
      const res = await apiFetch(`/api/organization/members/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setMembers((ms) => ms.filter((m) => m.id !== id));
        toast.success(t('removed'));
      } else {
        toast.error(res.error?.message ?? t('removeError'));
      }
    });
  }

  const selectCls =
    'h-9 rounded-lg border border-input bg-surface px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60';

  return (
    <div className="space-y-4">
      {canInvite && (
        <Card>
          <CardContent className="pt-6">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <div>
                <Label htmlFor="team-invite-email">{t('inviteEmail')}</Label>
                <Input
                  id="team-invite-email"
                  type="email"
                  placeholder="prenom@exemple.cd"
                  value={invite.email}
                  onChange={(e) => setInvite({ ...invite, email: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="team-invite-role">{t('inviteRole')}</Label>
                <select
                  id="team-invite-role"
                  className={selectCls + ' h-10'}
                  value={invite.role}
                  onChange={(e) => setInvite({ ...invite, role: e.target.value })}
                >
                  {ROLE_SELECT.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
                </select>
              </div>
              <div className="flex items-end">
                <Button onClick={sendInvite} disabled={inviting || !invite.email}>
                  {inviting ? <Loader2 className="animate-spin size-4" aria-hidden /> : <Mail className="size-4" aria-hidden />}
                  {t('invite')}
                </Button>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t('inviteNote')}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="divide-y pt-2">
          {members.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <UserRound className="size-4" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-medium">
                    {m.name ?? m.email}
                    {m.isSelf && <span className="ml-2 text-xs text-muted-foreground">({t('you')})</span>}
                  </p>
                  {m.name && <p className="text-xs text-muted-foreground">{m.email}</p>}
                </div>
                {m.status === 'invited' && <Badge variant="outline">{t('invitedBadge')}</Badge>}
              </div>
              <div className="flex items-center gap-2">
                {m.role === 'owner' ? (
                  <Badge variant="premium">{t('role.owner')}</Badge>
                ) : m.isSelf || !m.canEdit ? (
                  <Badge variant="secondary">{t(`role.${m.role}`)}</Badge>
                ) : canChangeRole ? (
                  <select
                    className={selectCls}
                    value={m.role}
                    disabled={busyId === m.id}
                    onChange={(e) => changeRole(m.id, e.target.value)}
                  >
                    {ROLE_SELECT.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
                  </select>
                ) : (
                  <Badge variant="secondary">{t(`role.${m.role}`)}</Badge>
                )}
                {m.canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={busyId === m.id}
                    onClick={() => remove(m.id)}
                  >
                    {busyId === m.id ? <Loader2 className="animate-spin size-4" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
