'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import { Loader2, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, RotateCcw } from 'lucide-react';

interface RowData {
  row: number;
  data: Record<string, string>;
}

interface ColumnsInfo {
  columns: string[];
  rows: RowData[];
  fields: string[];
  jobId: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUGGESTIONS: Record<string, string[]> = {
  firstName: ['prénom', 'prenom', 'first name', 'firstname', 'forename', 'nom complet'],
  lastName: ['nom', 'last name', 'lastname', 'surname', 'family name'],
  phone: ['téléphone', 'telephone', 'phone', 'tel', 'mobile', 'whatsapp', 'contact'],
  email: ['e-mail', 'email', 'mail', 'courriel'],
  category: ['catégorie', 'categorie', 'category'],
  table: ['table', 'tableau'],
  companions: ['accompagnateurs', 'accompagnants', 'companions', 'convives'],
};

function suggestField(column: string): string | null {
  const c = column.toLowerCase().trim();
  for (const [field, aliases] of Object.entries(SUGGESTIONS)) {
    if (aliases.some((a) => c === a || c.startsWith(`${a} `) || c.includes(a))) return field;
  }
  return null;
}

type RowStatus = { state: 'valid' | 'error' | 'dup'; fields: string[] };

export function ImportTab({
  eventId, onImported,
}: {
  eventId: string;
  onImported: () => void;
}) {
  const t = useTranslations('events.guests.import');
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<{ name: string; kind: 'csv' | 'xlsx' } | null>(null);
  const [parsed, setParsed] = useState<ColumnsInfo | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({}); // colIndex → field
  const [corrections, setCorrections] = useState<Record<number, Record<string, string>>>({}); // row → {colIndex: value}
  const [result, setResult] = useState<{ created: number; duplicates: number; errors: { row: number; field: string; message: string }[] } | null>(null);

  const tableNames = useTableNames(eventId);

  function correctValue(row: number, col: string): string {
    return corrections[row]?.[col] ?? parsed?.rows.find((r) => r.row === row)?.data[col] ?? '';
  }

  const rowStatuses = useMemo(() => {
    if (!parsed) return new Map<number, RowStatus>();
    const byField = (field: string, data: Record<string, string>) => {
      const col = Object.entries(mapping).find(([, f]) => f === field)?.[0];
      return col !== undefined ? (data[col] ?? '').trim() : '';
    };
    const statuses = new Map<number, RowStatus>();
    const seenPhones = new Set<string>();
    const seenEmails = new Set<string>();
    for (const { row, data } of parsed.rows) {
      const fields: string[] = [];
      const eff = (col: string) => corrections[row]?.[col] ?? data[col] ?? '';
      const val = (field: string) => {
        const col = Object.entries(mapping).find(([, f]) => f === field)?.[0];
        return col !== undefined ? eff(col).trim() : '';
      };
      const firstName = val('firstName');
      const lastName = val('lastName');
      const phone = val('phone');
      const email = val('email');
      const table = val('table');
      const companions = val('companions');

      if (!firstName) fields.push('firstName');
      if (!lastName) fields.push('lastName');
      if (phone) {
        const digits = phone.replace(/[^\d+]/g, '');
        if (digits.length < 5 || phone.length > 30) fields.push('phone');
      }
      if (email && !EMAIL_RE.test(email)) fields.push('email');
      if (table && tableNames.length > 0 && !tableNames.some((n) => n.toLowerCase() === table.toLowerCase())) fields.push('table');
      if (table && tableNames.length === 0) fields.push('table');
      if (companions && (!Number.isInteger(Number(companions)) || Number(companions) < 0 || Number(companions) > 50)) fields.push('companions');

      if (fields.length > 0) {
        statuses.set(row, { state: 'error', fields });
        continue;
      }
      const pKey = phone ? phone.replace(/[^\d+]/g, '') : '';
      const eKey = email ? email.toLowerCase() : '';
      if ((pKey && seenPhones.has(pKey)) || (eKey && seenEmails.has(eKey))) {
        statuses.set(row, { state: 'dup', fields: [] });
        continue;
      }
      if (pKey) seenPhones.add(pKey);
      if (eKey) seenEmails.add(eKey);
      statuses.set(row, { state: 'valid', fields: [] });
    }
    return statuses;
  }, [parsed, mapping, corrections, tableNames]);

  const stats = useMemo(() => {
    let valid = 0, err = 0, dup = 0;
    for (const s of rowStatuses.values()) {
      if (s.state === 'valid') valid += 1;
      else if (s.state === 'error') err += 1;
      else dup += 1;
    }
    return { valid, err, dup };
  }, [rowStatuses]);

  async function handleFile(f: File) {
    setBusy(true);
    setError(null);
    const isCsv = f.name.toLowerCase().endsWith('.csv') || f.name.toLowerCase().endsWith('.txt') || (f.type ?? '').includes('csv');
    const kind = isCsv ? 'csv' : 'xlsx';
    if (!isCsv && !f.name.toLowerCase().endsWith('.xlsx')) {
      setBusy(false);
      setError(t('badType'));
      return;
    }
    const content = isCsv ? await f.text() : arrayBufferToBase64(await f.arrayBuffer());
    const res = await apiFetch<{ job: { id: string }; columns: string[]; rows: RowData[]; fields: string[] }>(
      `/api/events/${eventId}/import/upload`,
      { method: 'POST', body: JSON.stringify({ fileName: f.name, kind, content }) },
    ).finally(() => setBusy(false));

    if (!res.ok || !res.data) {
      setError(res.error?.message ?? t('uploadError'));
      return;
    }
    setFile({ name: f.name, kind });
    setParsed({ jobId: res.data.job.id, columns: res.data.columns, rows: res.data.rows, fields: res.data.fields });
    // Mapping auto par noms de colonnes
    const m: Record<string, string> = {};
    res.data.columns.forEach((c, i) => {
      const f2 = suggestField(c);
      if (f2 && !Object.values(m).includes(f2)) m[String(i)] = f2;
    });
    setMapping(m);
    setCorrections({});
    setStep(2);
  }

  async function confirm() {
    if (!parsed) return;
    setBusy(true);
    // Lignes corrigées
    const rows = parsed.rows.map((r) => ({
      row: r.row,
      data: { ...r.data, ...(corrections[r.row] ?? {}) },
    }));
    const res = await apiFetch<{
      created: number; duplicates: number; errors: { row: number; field: string; message: string }[];
    }>(`/api/events/${eventId}/import/confirm`, {
      method: 'POST',
      body: JSON.stringify({ jobId: parsed.jobId, mapping, rows }),
    }).finally(() => setBusy(false));

    if (!res.ok || !res.data) {
      setError(res.error?.message ?? t('confirmError'));
      if (res.error?.code === 'quota_exceeded') setStep(2);
      return;
    }
    setResult({ created: res.data.created, duplicates: res.data.duplicates, errors: res.data.errors });
    setStep(5);
    toast.success(t('doneToast', { created: res.data.created }));
    onImported();
  }

  function reset() {
    setStep(1);
    setFile(null);
    setParsed(null);
    setMapping({});
    setCorrections({});
    setResult(null);
    setError(null);
  }

  const [error, setError] = useState<string | null>(null);
  const stepIdx = step;

  return (
    <div className="space-y-4">
      {/* Fil d'ariane des étapes */}
      <ol className="flex flex-wrap gap-2 text-xs">
        {([
          [1, t('stepFile')],
          [2, t('stepMapping')],
          [3, t('stepPreview')],
          [4, t('stepConfirm')],
          [5, t('stepDone')],
        ] as [number, string][]).map(([n, label]) => (
          <li
            key={n}
            className={`rounded-full px-3 py-1 font-medium ${
              stepIdx === n ? 'bg-primary text-primary-foreground' : stepIdx > n ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'
            }`}
          >
            {n}. {label}
          </li>
        ))}
      </ol>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center justify-between gap-2 pt-6 text-sm text-destructive">
            <span className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              {error}
            </span>
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="size-4" aria-hidden />
              {t('retry')}
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 pt-6">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
              <FileSpreadsheet className="size-7" aria-hidden />
            </span>
            <div className="text-center">
              <p className="text-sm font-medium">{t('dropTitle')}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('dropBody')}</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.xlsx,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
            <Button onClick={() => fileRef.current?.click()} disabled={busy} className="gap-2">
              {busy ? <Loader2 className="animate-spin size-4" aria-hidden /> : <Upload className="size-4" aria-hidden />}
              {t('chooseFile')}
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 2 && parsed && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="text-sm font-medium">
              {t('mappingTitle')} — {file?.name} ({parsed.rows.length} {t('rows')})
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {parsed.columns.map((col, i) => (
                <div key={i}>
                  <Label className="truncate text-xs text-muted-foreground">{col || t('unnamedCol')}</Label>
                  <select
                    className="flex h-10 w-full rounded-xl border border-input bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                    value={mapping[String(i)] ?? ''}
                    onChange={(e) => {
                        const m = { ...mapping };
                        // Un champ ne peut être mappé qu'une seule fois
                        for (const k of Object.keys(m)) if (m[k] === e.target.value) delete m[k];
                        if (e.target.value) m[String(i)] = e.target.value;
                        else delete m[String(i)];
                        setMapping(m);
                    }}
                  >
                    <option value="">{t('ignore')}</option>
                    {parsed.fields.map((f) => (
                      <option key={f} value={f} disabled={Object.values(mapping).includes(f) && mapping[String(i)] !== f}>
                        {t(`field.${f}`)}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex gap-2 border-t pt-4">
              <Button variant="ghost" onClick={reset}>{t('back')}</Button>
              <div className="flex-1" />
              <Button disabled={!mapping['0'] && Object.values(mapping).length < 2} onClick={() => setStep(3)}>
                {t('next')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {(step === 3 || step === 4) && parsed && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{t('previewTitle')}</p>
              <div className="flex gap-2 text-xs">
                <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-600">{stats.valid} {t('valid')}</span>
                <span className="rounded-full bg-amber-500/10 px-2.5 py-1 font-medium text-amber-600">{stats.dup} {t('duplicates')}</span>
                <span className="rounded-full bg-rose-500/10 px-2.5 py-1 font-medium text-rose-600">{stats.err} {t('errors')}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {step === 4 ? t('correctionHint') : t('previewHint')}
            </p>
            <div className="max-h-96 overflow-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr className="text-left text-xs">
                    <th className="px-2 py-2 font-medium">Ligne</th>
                    {parsed.columns.map((c, i) => (
                      <th key={i} className="max-w-32 truncate px-2 py-2 font-medium">
                        {c || t('unnamedCol')}
                        {mapping[String(i)] ? <span className="ml-1 text-primary">{t(`field.${mapping[String(i)]}`)}</span> : null}
                      </th>
                    ))}
                    <th className="px-2 py-2 font-medium">{t('status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.map(({ row, data }) => {
                    const st = rowStatuses.get(row) ?? { state: 'valid', fields: [] };
                    return (
                      <tr key={row} className={`border-t ${st.state === 'error' ? 'bg-rose-500/5' : st.state === 'dup' ? 'bg-amber-500/5' : ''}`}>
                        <td className="px-2 py-1.5 text-xs text-muted-foreground">{row}</td>
                        {parsed.columns.map((_, i) => {
                          const col = String(i);
                          const editable = step === 4 && (st.state === 'error') && (mapping[col] !== undefined || st.fields.length > 0);
                          return (
                            <td key={i} className="max-w-36 px-2 py-1.5">
                              {editable ? (
                                <input
                                  className="w-full rounded-md border border-input bg-background px-2 py-0.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                  value={correctValue(row, col)}
                                  onChange={(e) =>
                                    setCorrections((c) => ({
                                      ...c,
                                      [row]: { ...(c[row] ?? {}), [col]: e.target.value },
                                    }))
                                  }
                                />
                              ) : (
                                <span className="block truncate">{correctValue(row, col)}</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-2 py-1.5">
                          {st.state === 'valid' && <span className="text-xs font-medium text-emerald-600">{t('valid')}</span>}
                          {st.state === 'dup' && <span className="text-xs font-medium text-amber-600">{t('duplicateRow')}</span>}
                          {st.state === 'error' && (
                            <span className="text-xs font-medium text-rose-600">
                              {st.fields.map((f) => t(`field.${f}`)).join(', ')}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 border-t pt-4">
              <Button variant="ghost" onClick={() => (step === 4 ? setStep(3) : reset)}>{t('back')}</Button>
              <div className="flex-1" />
              {step === 3 && (
                stats.err > 0 ? (
                  <Button variant="outline" onClick={() => setStep(4)}>{t('correctErrors')}</Button>
                ) : (
                  <Button onClick={() => setStep(4)}>{t('next')}</Button>
                )
              )}
              {step === 4 && (
                <Button onClick={confirm} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin size-4" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}
                  {t('confirmImport', { valid: stats.valid })}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {step === 5 && result && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 pt-10 pb-10 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600">
              <CheckCircle2 className="size-7" aria-hidden />
            </span>
            <div>
              <p className="font-display text-xl font-semibold">{t('doneTitle')}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('doneSummary', { created: result.created, duplicates: result.duplicates, errors: result.errors.length })}
              </p>
            </div>
            {result.errors.length > 0 && (
              <div className="w-full max-w-md rounded-xl border bg-muted/30 p-3 text-left">
                <p className="mb-2 text-xs font-medium text-muted-foreground">{t('errorList')}</p>
                <ul className="max-h-40 space-y-1 overflow-auto text-xs">
                  {result.errors.map((e, i) => (
                    <li key={i} className="text-rose-600">
                      {t('rowLabel', { row: e.row })} — {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button variant="outline" onClick={reset}>
              <Upload className="size-4" aria-hidden />
              {t('anotherImport')}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Noms des tables de l'événement (validation des mappings « table » côté aperçu). */
function useTableNames(eventId: string): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    apiFetch<{ tables: { name: string }[] }>(`/api/events/${eventId}/tables`).then((r) => {
      if (alive && r.ok && r.data) setNames(r.data.tables.map((t) => t.name));
    });
    return () => {
      alive = false;
    };
  }, [eventId]);
  return names;
}
