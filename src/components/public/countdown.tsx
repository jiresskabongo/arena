'use client';

import { useEffect, useState } from 'react';

function diff(target: Date): { d: number; h: number; m: number; s: number; passed: boolean } {
  const now = Date.now();
  const delta = target.getTime() - now;
  if (delta <= 0) return { d: 0, h: 0, m: 0, s: 0, passed: true };
  return {
    d: Math.floor(delta / 86_400_000),
    h: Math.floor(delta / 3_600_000) % 24,
    m: Math.floor(delta / 60_000) % 60,
    s: Math.floor(delta / 1_000) % 60,
    passed: false,
  };
}

/** Compte à rebours (section optionnelle de la page publique). */
export function CalendarCountdown({
  dateIso, time, labels,
}: {
  dateIso: string;
  time: string;
  labels: { days: string; hours: string; minutes: string; seconds: string; passed: string };
}) {
  const [state, setState] = useState(() => diff(new Date(`${dateIso.slice(0, 10)}T${time}:00`)));

  useEffect(() => {
    const id = setInterval(() => setState(diff(new Date(`${dateIso.slice(0, 10)}T${time}:00`))), 1000);
    return () => clearInterval(id);
  }, [dateIso, time]);

  if (state.passed) {
    return (
      <div className="rounded-2xl border bg-background p-6 text-center">
        <p className="font-display text-xl font-semibold">{labels.passed}</p>
      </div>
    );
  }

  const cells = [
    { value: state.d, label: labels.days },
    { value: state.h, label: labels.hours },
    { value: state.m, label: labels.minutes },
    { value: state.s, label: labels.seconds },
  ];

  return (
    <div className="grid grid-cols-4 gap-2" role="timer" aria-label={labels.passed}>
      {cells.map((c) => (
        <div key={c.label} className="rounded-2xl border bg-background p-3 text-center sm:p-4">
          <p className="font-display text-2xl font-semibold tabular-nums sm:text-3xl">
            {String(c.value).padStart(2, '0')}
          </p>
          <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">{c.label}</p>
        </div>
      ))}
    </div>
  );
}
