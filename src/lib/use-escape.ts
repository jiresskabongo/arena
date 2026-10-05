'use client';

import { useEffect, useRef } from 'react';

/**
 * Ferme au clavier : Échap quand `active` (accessibilité — les dialogs
 * custom doivent être quittables au clavier). Le callback passe par ref
 * (aucune re-subscription à chaque render).
 */
export function useEscape(active: boolean, onEscape: () => void) {
  const cb = useRef(onEscape);
  cb.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cb.current();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [active]);
}
