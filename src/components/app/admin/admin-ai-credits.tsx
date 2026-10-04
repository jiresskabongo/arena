'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { AdminPagination, Pill, statusTone } from './admin-shared';
import { Loader2, Cpu, Minus, Plus } from 'lucide-react';

interface Org { id: string; name: string; slug: string; isActive: boolean; subscription: { status: string; plan: { code: string; name: string } } | null }
interface UsageRow {
  id: string;
  operation: string;
  creditsCost: number;
  creditsRefunded: number;
  status: string;
  inputSummary: string | null;
  createdAt: string;
  user: { email: string; firstName: string } | null;
}
interface Hist { items: UsageRow[]; total: number; page: number; pageSize: number; totalPages: number; net: number }

export function AiCreditsAdmin() {
  const t = useTranslations('admin');
  const [search, setSearch] = useState('');
  const [org, setOrg] = useState<Org | null>(null);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [hist, setHist] = useState<Hist | null>(null);
  const [histErr, setHistErr] = useState(false);
  const [page, setPage] = useState(1);

  const searchOrgs = useCallback(async () => {
    if (search.trim().length < 2) { setOrg(null); setHist(null); return; }
    setOrgsLoading(true);
    const res = await apiFetch<{ items: Org[] }>(`/api/admin/organizations?search=${encodeURIComponent(search)}&pageSize=5`);
    setOrgsLoading(false);
    if (res.ok && res.data) setOrg(res.data.items[0] ?? null);
    else setOrg(null);
  }, [search]);

  useEffect(() => {
    const id = setTimeout(() => void searchOrgs(), 350);
    return () => clearTimeout(id);
  }, [searchOrgs]);

  const loadHist = useCallback(async (p: number) => {
    if (!org) return;
    const res = await apiFetch<Hist>(`/api/admin/ai/credits/${org.id}?page=${p}&pageSize=15`);
    if (res.ok && res.data) { setHist(res.data); setHistErr(false); }
    else setHistErr(true);
  }, [org]);

  useEffect(() => {
    setHist(null);
    if (org) { setPage(1); void loadHist(1); }
  }, [org, loadHist]);

  async function applyAdjustment(sign: 1 | -1) {
    if (!org) return;
    const n = Number(delta);
    if (!Number.isInteger(n) || n <= 0) { setMsg(t('aicredits.invalidDelta')); return; }
    setBusy(true);
    setMsg(null);
    const res = await apiFetch(`/api/admin/ai/credits/${org.id}`, {
      method: 'POST',
      body: JSON.stringify({ delta: sign * n, reason: reason.trim() || undefined }),
    });
    setBusy(false);
    setMsg(res.ok ? t('aicredits.applied') : (res.error?.message ?? t('loadError')));
    if (res.ok) {
      setDelta('');
      setReason('');
      void loadHist(page);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ai-org">{t('aicredits.org')}</Label>
              <Input
                id="ai-org"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setOrg(null); }}
                placeholder={t('aicredits.orgPlaceholder')}
              />
              {orgsLoading && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> {t('loading')}
                </p>
              )}
              {!orgsLoading && search.trim().length >= 2 && !org && (
                <p className="text-xs text-muted-foreground">{t('aicredits.orgNotFound')}</p>
              )}
            </div>
            {org && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="font-medium">{org.name} <span className="font-normal text-muted-foreground">/{org.slug}</span></p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {org.subscription ? `${org.subscription.plan.name} · ${org.subscription.status}` : t('aicredits.noSub')}
                </p>
                {hist && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs">
                    <Cpu className="size-3.5 text-primary" />
                    {t('aicredits.net', { net: hist.net })}
                  </p>
                )}
              </div>
            )}
          </div>

          {org && (
            <div className="flex flex-wrap items-end gap-3 border-t pt-4">
              <div className="space-y-1.5">
                <Label htmlFor="ai-delta">{t('aicredits.delta')}</Label>
                <Input id="ai-delta" type="number" min={1} value={delta} onChange={(e) => setDelta(e.target.value)} className="w-32" placeholder="50" />
              </div>
              <Button variant="outline" disabled={busy} onClick={() => void applyAdjustment(-1)} className="gap-1.5">
                <Plus className="size-4" /> {t('aicredits.grant')}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void applyAdjustment(1)} className="gap-1.5">
                <Minus className="size-4" /> {t('aicredits.charge')}
              </Button>
              <div className="min-w-40 flex-1 space-y-1.5">
                <Label htmlFor="ai-reason">{t('aicredits.reason')}</Label>
                <Input id="ai-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
              </div>
              {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            </div>
          )}
          {msg && <p className={`text-sm ${msg === t('aicredits.applied') ? 'text-emerald-700' : 'text-destructive'}`}>{msg}</p>}
        </CardContent>
      </Card>

      {org && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">{t('aicredits.colDate')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('aicredits.colOperation')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('aicredits.colCredits')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('aicredits.colStatus')}</th>
                  <th className="px-3 py-2.5 font-medium">{t('aicredits.colSummary')}</th>
                </tr>
              </thead>
              <tbody>
                {histErr && (
                  <tr><td colSpan={5} className="px-3 py-10 text-center text-sm text-destructive">{t('loadError')}</td></tr>
                )}
                {!histErr && hist && hist.items.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-10 text-center text-sm text-muted-foreground">{t('aicredits.empty')}</td></tr>
                )}
                {!histErr && hist?.items.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{new Date(u.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2.5">
                      {u.operation === 'admin_adjustment'
                        ? <Pill tone="purple">{t('aicredits.adminAdjustment')}</Pill>
                        : <span>{u.operation}</span>}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {u.creditsCost > 0 ? `+${u.creditsCost}` : u.creditsCost}
                      {u.creditsRefunded > 0 && (
                        <span className="text-emerald-700"> ({t('aicredits.refunded', { r: u.creditsRefunded })})</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5"><Pill tone={statusTone(u.status)}>{u.status}</Pill></td>
                    <td className="max-w-56 truncate px-3 py-2.5 text-xs text-muted-foreground">
                      {u.inputSummary ?? '—'}{u.user && <span className="opacity-60"> · {u.user.email}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      {hist && <AdminPagination page={hist.page} totalPages={hist.totalPages} onPage={(p) => { setPage(p); void loadHist(p); }} />}
    </div>
  );
}
