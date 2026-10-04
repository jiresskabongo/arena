'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import {
  type DesignContent, type DesignElement, DesignBackground,
  FONT_FAMILIES, ICONS, ICON_LIST, newElementId,
  makeTextElement, makeShapeElement, makeImageElement, makeQrElement,
} from '@/lib/design-elements';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import {
  ArrowLeft, ChevronDown, Copy, Download, FilePlus2, Image as ImageIcon,
  LayoutTemplate, Maximize2, Minus, Pencil, QrCode, Redo2, RotateCcw,
  Save, Shapes, Trash2, Type, Undo2, ZoomIn, ZoomOut, Sparkles,
  ArrowUp, ArrowDown,
} from 'lucide-react';

export interface SerializedDesign {
  id: string;
  name: string;
  type: string;
  format: string;
  width: number;
  height: number;
  version: number;
  background: DesignBackground;
  elements: DesignElement[];
}

const HISTORY_MAX = 50;
const MIN_SIZE = 8;

const SHAPES = ['rect', 'circle', 'ring', 'line', 'triangle'] as const;

interface Snapshot {
  background: DesignBackground;
  elements: DesignElement[];
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function DesignEditor({ design, locale }: { design: SerializedDesign; locale: string }) {
  const t = useTranslations('designs.editor');
  const [content, setContent] = useState<Snapshot>({
    background: design.background,
    elements: deepClone(design.elements),
  });
  const [name, setName] = useState(design.name);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [zoom, setZoom] = useState(0.5);
  const [fitMode, setFitMode] = useState(true);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [mediaModalFor, setMediaModalFor] = useState<null | { target: 'element' | 'background' }>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [exporting, setExporting] = useState<'png' | 'png2' | 'pdf' | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

  const selected = content.elements.find((e) => e.id === selectedId) ?? null;

  // ── Fit à l'écran ─────────────────────────────────────────────
  useEffect(() => {
    function onResize() {
      const el = containerRef.current;
      if (!el || !fitMode) return;
      const z = Math.min((el.clientWidth - 48) / design.width, (el.clientHeight - 48) / design.height);
      setZoom(clamp(z, 0.05, 2));
    }
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fitMode, design.width, design.height]);

  // ── Résolution des mediaId → URL (aperçu images) ─────────────
  useEffect(() => {
    const srcs = new Set<string>();
    for (const el of content.elements) {
      if (el.type === 'image' && !el.src.startsWith('data:')) srcs.add(el.src);
    }
    if (content.background.type === 'image' && !content.background.value.startsWith('data:')) {
      srcs.add(content.background.value);
    }
    for (const src of srcs) {
      if (imageUrls[src]) continue;
      let cancelled = false;
      apiFetch<{ media: { url: string } }>(`/api/media/${src}`)
        .then((res) => {
          if (cancelled) return;
          if (res.ok && res.data) {
            const url = res.data.media.url;
            setImageUrls((m) => ({ ...m, [src]: url }));
          }
        })
        .catch(() => {});
      // eslint-disable-next-line no-loop-func
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content.elements, content.background]);

  // ── Historique undo/redo ──────────────────────────────────────
  const pushHistory = useCallback((snap?: Snapshot) => {
    const s = snap ?? content;
    setPast((p) => [...p.slice(-HISTORY_MAX + 1), deepClone(s)]);
    setFuture([]);
  }, [content]);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [...f, deepClone(content)]);
      setContent(prev);
      return p.slice(0, -1);
    });
  }, [content]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[f.length - 1];
      setPast((p) => [...p, deepClone(content)]);
      setContent(next);
      return f.slice(0, -1);
    });
  }, [content]);

  // ── Mutation + autosave (debounce 1s) ────────────────────────
  const dirtyRef = useRef(false);
  const commit = useCallback((updater: (c: Snapshot) => Snapshot) => {
    pushHistory();
    setContent((c) => updater(deepClone(c)));
    dirtyRef.current = true;
  }, [pushHistory]);

  const mutate = useCallback((updater: (c: Snapshot) => Snapshot) => {
    setContent((c) => updater(c));
    dirtyRef.current = true;
  }, []);

  useEffect(() => {
    if (!dirtyRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState('saving');
    saveTimer.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/designs/${design.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name, background: content.background, elements: content.elements }),
        });
        dirtyRef.current = false;
        setSaveState(res.ok ? 'saved' : 'error');
        if (!res.ok) toast.error(res.error?.message ?? t('saveError'));
      } catch {
        setSaveState('error');
        toast.error(t('saveError'));
      }
    }, 1000);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [content, name, design.id, t]);

  // ── Drag / resize / rotation ─────────────────────────────────
  type DragState =
    | { mode: 'move'; id: string; startX: number; startY: number; origX: number; origY: number }
    | { mode: 'resize'; id: string; dir: string; startX: number; startY: number; orig: { x: number; y: number; w: number; h: number } }
    | { mode: 'rotate'; id: string; cx: number; cy: number };

  const startElementDrag = (e: React.PointerEvent, el: DesignElement) => {
    e.stopPropagation();
    if (editingTextId === el.id) return;
    setSelectedId(el.id);
    pushHistory();
    dragRef.current = { mode: 'move', id: el.id, startX: e.clientX, startY: e.clientY, origX: el.x, origY: el.y };
  };

  const startResize = (e: React.PointerEvent, el: DesignElement, dir: string) => {
    e.stopPropagation();
    pushHistory();
    dragRef.current = {
      mode: 'resize', id: el.id, dir, startX: e.clientX, startY: e.clientY,
      orig: { x: el.x, y: el.y, w: el.width, h: el.height },
    };
  };

  const startRotate = (e: React.PointerEvent, el: DesignElement) => {
    e.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    pushHistory();
    dragRef.current = {
      mode: 'rotate', id: el.id,
      cx: rect.left + (el.x + el.width / 2) * zoom,
      cy: rect.top + (el.y + el.height / 2) * zoom,
    };
  };

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      if (d.mode === 'move') {
        const dx = (e.clientX - d.startX) / zoom;
        const dy = (e.clientY - d.startY) / zoom;
        mutate((c) => ({
          ...c,
          elements: c.elements.map((el) =>
            el.id === d.id ? { ...el, x: Math.round(d.origX + dx), y: Math.round(d.origY + dy) } : el),
        }));
      } else if (d.mode === 'resize') {
        const dx = (e.clientX - d.startX) / zoom;
        const dy = (e.clientY - d.startY) / zoom;
        mutate((c) => ({
          ...c,
          elements: c.elements.map((el) => {
            if (el.id !== d.id) return el;
            const { orig, dir } = d;
            let x = orig.x, y = orig.y, w = orig.w, h = orig.h;
            if (dir.includes('e')) w = orig.w + dx;
            if (dir.includes('s')) h = orig.h + dy;
            if (dir.includes('w')) { x = orig.x + dx; w = orig.w - dx; }
            if (dir.includes('n')) { y = orig.y + dy; h = orig.h - dy; }
            if (w < MIN_SIZE) { if (dir.includes('w')) x = orig.x + orig.w - MIN_SIZE; w = MIN_SIZE; }
            if (h < MIN_SIZE) { if (dir.includes('n')) y = orig.y + orig.h - MIN_SIZE; h = MIN_SIZE; }
            return { ...el, x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
          }),
        }));
      } else if (d.mode === 'rotate') {
        mutate((c) => ({
          ...c,
          elements: c.elements.map((el) => {
            if (el.id !== d.id) return el;
            let deg = Math.round(Math.atan2(e.clientY - d.cy, e.clientX - d.cx) * 180 / Math.PI + 90);
            // Snap 0/90/180/270 à ±4°
            for (const snap of [0, 90, 180, 270, -90, -180]) {
              if (Math.abs(deg - snap) <= 4) deg = snap;
            }
            return { ...el, rotation: ((deg + 540) % 360) - 180 };
          }),
        }));
      }
    }
    function onUp() {
      dragRef.current = null;
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [zoom, mutate]);

  // ── Clavier ───────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault(); redo(); return;
      }
      if (!selectedId) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteElement(selectedId);
      } else if (e.key === 'Escape') {
        setSelectedId(null);
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const d = {
          ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step },
          ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
        }[e.key]!;
        mutate((c) => ({
          ...c,
          elements: c.elements.map((el) => el.id === selectedId ? { ...el, x: el.x + d.x, y: el.y + d.y } : el),
        }));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, undo, redo, mutate]);

  // ── Actions éléments ──────────────────────────────────────────
  function deleteElement(id: string) {
    commit((c) => ({ ...c, elements: c.elements.filter((e) => e.id !== id) }));
    setSelectedId(null);
  }

  function addElement(el: DesignElement) {
    commit((c) => ({ ...c, elements: [...c.elements, el] }));
    setSelectedId(el.id);
  }

  function updateSelected(patch: Partial<DesignElement>) {
    if (!selectedId) return;
    commit((c) => ({
      ...c,
      elements: c.elements.map((e) => (e.id === selectedId ? ({ ...e, ...patch } as DesignElement) : e)),
    }));
  }

  function updateBackground(bg: DesignBackground) {
    commit((c) => ({ ...c, background: bg }));
  }

  function bringForward() {
    if (!selected) return;
    const maxZ = Math.max(0, ...content.elements.map((e) => e.z));
    updateSelected({ z: Math.min(1000, maxZ + 1) });
  }
  function sendBackward() {
    if (!selected) return;
    commit((c) => {
      const minZ = Math.min(...c.elements.map((e) => e.z));
      const el = c.elements.find((e) => e.id === selected.id);
      if (!el) return c;
      if (minZ > 0) {
        return {
          ...c,
          elements: c.elements.map((e) => (e.id === el.id ? { ...e, z: Math.max(0, minZ - 1) } : e)),
        };
      }
      // Déjà au minimum : on remonte les autres
      return {
        ...c,
        elements: c.elements.map((e) => (e.id === el.id ? { ...e, z: 0 } : { ...e, z: e.z + 1 })),
      };
    });
  }

  // ── Ajouts rapides ────────────────────────────────────────────
  function addText() {
    addElement(makeTextElement({
      x: design.width / 2 - 200, y: design.height / 2 - 40,
      width: 400, height: 80, text: t('addTextPlaceholder'),
    }));
  }
  function addShape(shape: (typeof SHAPES)[number]) {
    addElement(makeShapeElement({
      x: design.width / 2 - 150, y: design.height / 2 - 150, width: 300, height: 300, shape,
    }));
  }
  function addIcon(icon: string) {
    const el = {
      id: newElementId(), type: 'icon' as const, icon, iconColor: '#C4956A',
      x: design.width / 2 - 60, y: design.height / 2 - 60, width: 120, height: 120,
      opacity: 1, rotation: 0, z: 0,
    };
    commit((c) => ({ ...c, elements: [...c.elements, el] }));
    setSelectedId(el.id);
  }
  function addQr() {
    addElement(makeQrElement({
      x: design.width / 2 - 150, y: design.height / 2 - 150,
      width: 300, height: 300, value: 'https://example.cd',
    }));
  }

  // ── Export ────────────────────────────────────────────────────
  async function doExport(kind: 'png' | 'png2' | 'pdf') {
    setExporting(kind);
    const url = `/api/designs/${design.id}/export?format=${kind === 'pdf' ? 'pdf' : 'png'}&scale=${kind === 'png2' ? 2 : 1}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast.error(err?.error?.message ?? t('exportError'));
        return;
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      const obj = URL.createObjectURL(blob);
      a.href = obj;
      a.download = `${design.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${kind === 'pdf' ? 'pdf' : kind === 'png2' ? '2x' : '1x'}.${kind === 'pdf' ? 'pdf' : 'png'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(obj);
      toast.success(t('exported'));
    } catch {
      toast.error(t('exportError'));
    }
    setExporting(null);
  }

  async function saveAsTemplate() {
    setSavingTemplate(true);
    const res = await apiFetch(`/api/designs/${design.id}/template`, {
      method: 'POST',
      body: JSON.stringify({ name: `${design.name} (template)`, category: 'mariage', style: 'moderne' }),
    });
    setSavingTemplate(false);
    if (res.ok) toast.success(t('templateSaved'));
    else toast.error(res.error?.message ?? t('templateSaveError'));
  }

  async function duplicate() {
    const res = await apiFetch<{ design: { id: string } }>(`/api/designs/${design.id}/duplicate`, { method: 'POST' });
    if (res.ok && res.data) {
      window.location.href = `/${locale}/designs/${res.data.design.id}`;
    } else {
      toast.error(res.error?.message ?? t('error'));
    }
  }

  async function removeDesign() {
    if (!confirm(t('deleteConfirm'))) return;
    const res = await apiFetch(`/api/designs/${design.id}`, { method: 'DELETE' });
    if (res.ok) window.location.href = `/${locale}/designs`;
    else toast.error(res.error?.message ?? t('error'));
  }

  const bgStyle = backgroundCss(content.background, imageUrls);
  const sorted = useMemo(
    () => [...content.elements].sort((a, b) => a.z - b.z),
    [content.elements],
  );

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-[540px] flex-col">
      {/* Barre d'outils */}
      <div className="flex flex-wrap items-center gap-2 rounded-t-lg border bg-card px-3 py-2">
        <Link
          href={`/${locale}/designs`}
          className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t('back')}
        </Link>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 w-52 text-sm font-medium"
          maxLength={120}
          aria-label={t('name')}
        />
        <span className={`text-xs ${saveState === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
          {saveState === 'saving' && t('saving')}
          {saveState === 'saved' && t('saved')}
          {saveState === 'error' && t('saveError')}
          {saveState === 'idle' && `v${design.version}`}
        </span>

        <div className="mx-1 h-5 w-px bg-border" aria-hidden />
        <IconBtn label={t('undo')} onClick={undo} disabled={past.length === 0}><Undo2 className="size-4" /></IconBtn>
        <IconBtn label={t('redo')} onClick={redo} disabled={future.length === 0}><Redo2 className="size-4" /></IconBtn>

        <div className="mx-1 h-5 w-px bg-border" aria-hidden />
        <span className="text-xs text-muted-foreground">{t('add')} :</span>
        <IconBtn label={t('addText')} onClick={addText}><Type className="size-4" /></IconBtn>
        <ShapePicker onPick={(s) => addShape(s)} label={t('addShape')} />
        <IconPicker onPick={addIcon} label={t('addIcon')} />
        <IconBtn label={t('addImage')} onClick={() => setMediaModalFor({ target: 'element' })}><ImageIcon className="size-4" /></IconBtn>
        <IconBtn label={t('addQr')} onClick={addQr}><QrCode className="size-4" /></IconBtn>

        <div className="mx-1 h-5 w-px bg-border" aria-hidden />
        <IconBtn label={t('zoomOut')} onClick={() => { setFitMode(false); setZoom((z) => clamp(z - 0.1, 0.05, 3)); }}><ZoomOut className="size-4" /></IconBtn>
        <span className="w-10 text-center text-xs text-muted-foreground">{Math.round(zoom * 100)}%</span>
        <IconBtn label={t('zoomIn')} onClick={() => { setFitMode(false); setZoom((z) => clamp(z + 0.1, 0.05, 3)); }}><ZoomIn className="size-4" /></IconBtn>
        <IconBtn label={t('zoomFit')} onClick={() => setFitMode(true)}><Maximize2 className="size-4" /></IconBtn>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={saveAsTemplate} disabled={savingTemplate} className="gap-1.5">
            <Save className="size-3.5" aria-hidden />
            {t('saveTemplate')}
          </Button>
          <Button size="sm" variant="outline" onClick={duplicate} className="gap-1.5">
            <Copy className="size-3.5" aria-hidden />
            {t('duplicate')}
          </Button>
          <div className="flex items-center gap-1">
            <Button size="sm" onClick={() => doExport('png')} disabled={exporting !== null} className="gap-1.5">
              <Download className="size-3.5" aria-hidden />
              {exporting === 'png' ? '…' : `${t('exportPng')} 1x`}
            </Button>
            <Button size="sm" variant="outline" onClick={() => doExport('png2')} disabled={exporting !== null}>
              {exporting === 'png2' ? '…' : '2x'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => doExport('pdf')} disabled={exporting !== null}>
              {exporting === 'pdf' ? '…' : t('exportPdf')}
            </Button>
          </div>
          <IconBtn label={t('delete')} onClick={removeDesign} danger><Trash2 className="size-4" /></IconBtn>
        </div>
      </div>

      {/* Corps : canvas + panneau */}
      <div className="flex min-h-0 flex-1">
        <div
          ref={containerRef}
          className="relative flex-1 overflow-auto border-x bg-muted/60"
          onPointerDown={() => { setSelectedId(null); setEditingTextId(null); }}
        >
          <div
            ref={canvasRef}
            className="absolute left-1/2 top-1/2 shadow-xl ring-1 ring-black/10"
            style={{
              width: design.width * zoom,
              height: design.height * zoom,
              transform: `translate(-50%, -50%)`,
              background: bgStyle,
            }}
          >
            {sorted.map((el) => (
              <ElementView
                key={el.id}
                el={el}
                zoom={zoom}
                selected={el.id === selectedId}
                editing={el.id === editingTextId}
                imageUrl={imageUrls[el.type === 'image' ? el.src : '']}
                onPointerDown={(e) => startElementDrag(e, el)}
                onDoubleClick={() => { if (el.type === 'text') { setSelectedId(el.id); setEditingTextId(el.id); } }}
                onTextChange={(text) => {
                  updateSelected({ text });
                  setEditingTextId(null);
                }}
              />
            ))}
            {selected && (
              <SelectionOverlay
                el={selected}
                zoom={zoom}
                onResizeStart={(e, dir) => startResize(e, selected, dir)}
                onRotateStart={(e) => startRotate(e, selected)}
              />
            )}
          </div>
        </div>

        {/* Panneau propriétés */}
        <aside className="w-72 shrink-0 overflow-y-auto border-r bg-card p-3">
          {selected ? (
            <PropertiesPanel
              el={selected}
              onUpdate={updateSelected}
              onDelete={() => deleteElement(selected.id)}
              onBringForward={bringForward}
              onSendBackward={sendBackward}
              onPickImage={() => setMediaModalFor({ target: 'element' })}
              imageUrls={imageUrls}
            />
          ) : (
            <BackgroundPanel
              background={content.background}
              onChange={updateBackground}
              onPickImage={() => setMediaModalFor({ target: 'background' })}
              imageUrls={imageUrls}
            />
          )}
        </aside>
      </div>

      {mediaModalFor && (
        <MediaLibraryModal
          eventId={undefined}
          onClose={() => setMediaModalFor(null)}
          onPick={(media) => {
            if (mediaModalFor.target === 'background') {
              updateBackground({ type: 'image', value: media.id });
            } else if (selected && selected.type === 'image') {
              updateSelected({ src: media.id });
            } else {
              // aucun élément image sélectionné → crée un élément
              addElement(makeImageElement({
                x: design.width / 2 - 300, y: design.height / 2 - 300,
                width: 600, height: 600, src: media.id,
              }));
            }
            setMediaModalFor(null);
          }}
        />
      )}
    </div>
  );
}

// ────────────────────────────── Rendu élément ──────────────────────────────

function backgroundCss(bg: DesignBackground, imageUrls: Record<string, string>): string {
  if (bg.type === 'color') return bg.value;
  if (bg.type === 'gradient' || bg.type === 'pattern') return bg.value; // CSS linear-gradient
  if (bg.type === 'image') {
    const url = imageUrls[bg.value];
    if (url) return `url(${url}) center / cover no-repeat`;
    return '#e5e7eb';
  }
  return '#ffffff';
}

function ElementView({
  el, zoom, selected, editing, imageUrl, onPointerDown, onDoubleClick, onTextChange,
}: {
  el: DesignElement;
  zoom: number;
  selected: boolean;
  editing: boolean;
  imageUrl?: string;
  onPointerDown: (e: React.PointerEvent) => void;
  onDoubleClick: () => void;
  onTextChange: (text: string) => void;
}) {
  const t = useTranslations('designs.editor');
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const qrEl = el.type === 'qr' ? el : null;

  useEffect(() => {
    if (!qrEl) return;
    let cancelled = false;
    import('qrcode')
      .then((QR) => ((QR as { default?: { toDataURL: (t: string, o: object) => Promise<string> } }).default ?? QR as { toDataURL: (t: string, o: object) => Promise<string> }).toDataURL(qrEl.value, {
        errorCorrectionLevel: 'M', margin: qrEl.margin,
        color: qrEl.color === 'white'
          ? { dark: '#FFFFFF', light: '#000000' }
          : { dark: '#000000', light: '#FFFFFF' },
      }))
      .then((u) => { if (!cancelled) setQrUrl(u); })
      .catch(() => { if (!cancelled) setQrUrl(null); });
    return () => { cancelled = true; };
  }, [qrEl]);

  const style: React.CSSProperties = {
    position: 'absolute',
    left: el.x * zoom,
    top: el.y * zoom,
    width: el.width * zoom,
    height: el.height * zoom,
    opacity: el.opacity,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    zIndex: el.z,
    cursor: 'move',
  };

  let inner: React.ReactNode = null;
  if (el.type === 'text') {
    if (editing) {
      inner = (
        <textarea
          autoFocus
          defaultValue={el.text}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => onTextChange(e.target.value)}
          className="absolute inset-0 w-full resize-none bg-transparent p-0 outline-none ring-2 ring-primary"
          style={{
            fontFamily: editorFont(el.fontFamily),
            fontSize: el.fontSize * zoom,
            fontWeight: el.fontWeight,
            fontStyle: el.italic ? 'italic' : 'normal',
            color: el.color,
            textAlign: el.align,
            letterSpacing: el.letterSpacing * zoom,
            lineHeight: el.lineHeight,
            textTransform: el.uppercase ? 'uppercase' : 'none',
          }}
        />
      );
    } else {
      inner = (
        <div
          className="w-full select-none whitespace-pre-wrap"
          style={{
            fontFamily: editorFont(el.fontFamily),
            fontSize: el.fontSize * zoom,
            fontWeight: el.fontWeight,
            fontStyle: el.italic ? 'italic' : 'normal',
            color: el.color,
            textAlign: el.align,
            letterSpacing: el.letterSpacing * zoom,
            lineHeight: el.lineHeight,
            textTransform: el.uppercase ? 'uppercase' : 'none',
          }}
        >
          {el.text}
        </div>
      );
    }
  } else if (el.type === 'shape') {
    if (el.shape === 'line') {
      inner = (
        <div
          className="w-full"
          style={{
            height: Math.max(1, el.strokeWidth * zoom),
            background: el.stroke === 'none' ? '#999' : el.stroke,
            borderRadius: 999,
          }}
        />
      );
    } else if (el.shape === 'triangle') {
      inner = (
        <div
          className="h-full w-full"
          style={{
            background: el.fill === 'none' ? 'transparent' : el.fill,
            clipPath: 'polygon(50% 0, 100% 100%, 0 100%)',
          }}
        />
      );
    } else if (el.shape === 'ring') {
      inner = (
        <div
          className="h-full w-full rounded-full"
          style={{
            border: `${Math.max(1, el.strokeWidth * zoom)}px solid ${el.stroke === 'none' ? '#999' : el.stroke}`,
          }}
        />
      );
    } else {
      inner = (
        <div
          className="h-full w-full"
          style={{
            background: el.fill === 'none' ? 'transparent' : el.fill,
            border: el.stroke !== 'none' && el.strokeWidth > 0
              ? `${el.strokeWidth * zoom}px solid ${el.stroke}`
              : undefined,
            borderRadius: el.shape === 'circle' ? '50%' : el.borderRadius * zoom,
          }}
        />
      );
    }
  } else if (el.type === 'icon') {
    const glyph = ICONS[el.icon] ?? '•';
    inner = (
      <div
        className="flex h-full w-full select-none items-center justify-center"
        style={{ fontSize: el.height * 0.7 * zoom, color: el.iconColor }}
      >
        {glyph}
      </div>
    );
  } else if (el.type === 'image') {
    inner = (
      <div className="h-full w-full" style={{ borderRadius: el.borderRadius * zoom, overflow: 'hidden' }}>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            draggable={false}
            className="h-full w-full"
            style={{ objectFit: el.fit }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted text-xs text-muted-foreground">
            {t('imageLoading')}
          </div>
        )}
      </div>
    );
  } else if (el.type === 'qr') {
    inner = (
      <div
        className="relative h-full w-full overflow-hidden rounded-md"
        style={el.color === 'white' ? { background: '#FFFFFF' } : undefined}
      >
        {qrUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrUrl} alt="" draggable={false} className="h-full w-full" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            {t('qr')}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      style={style}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      className={selected ? 'outline outline-2 outline-primary' : ''}
    >
      {inner}
    </div>
  );
}

function editorFont(family: 'display' | 'sans'): string {
  return family === 'display' ? 'var(--font-display)' : 'var(--font-sans)';
}


// ────────────────────────────── Sélection / handles ────────────────────────

function SelectionOverlay({
  el, zoom, onResizeStart, onRotateStart,
}: {
  el: DesignElement;
  zoom: number;
  onResizeStart: (e: React.PointerEvent, dir: string) => void;
  onRotateStart: (e: React.PointerEvent) => void;
}) {
  const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const pos: Record<string, React.CSSProperties> = {
    nw: { left: 0, top: 0, cursor: 'nwse-resize' },
    n: { left: '50%', top: 0, cursor: 'ns-resize', transform: 'translateX(-50%)' },
    ne: { right: 0, top: 0, cursor: 'nesw-resize' },
    e: { right: 0, top: '50%', cursor: 'ew-resize', transform: 'translateY(-50%)' },
    se: { right: 0, bottom: 0, cursor: 'nwse-resize' },
    s: { left: '50%', bottom: 0, cursor: 'ns-resize', transform: 'translateX(-50%)' },
    sw: { left: 0, bottom: 0, cursor: 'nesw-resize' },
    w: { left: 0, top: '50%', cursor: 'ew-resize', transform: 'translateY(-50%)' },
  };
  const size = Math.max(8, 10 * zoom);
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: el.x * zoom - 1,
        top: el.y * zoom - 1,
        width: el.width * zoom + 2,
        height: el.height * zoom + 2,
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
        border: '1px solid hsl(var(--primary))',
      }}
    >
      {/* Poignée de rotation */}
      <div
        className="pointer-events-auto absolute left-1/2 h-3.5 w-3.5 -translate-x-1/2 cursor-grab rounded-full border border-primary bg-background"
        style={{ top: -22 }}
        onPointerDown={onRotateStart}
        title="Rotation"
      />
      <div
        className="absolute left-1/2 w-px -translate-x-1/2 bg-primary"
        style={{ top: -12, height: 12 }}
      />
      {handles.map((h) => (
        <div
          key={h}
          className="pointer-events-auto absolute rounded-sm border border-primary bg-background"
          style={{ width: size, height: size, ...pos[h] }}
          onPointerDown={(e) => onResizeStart(e, h)}
        />
      ))}
    </div>
  );
}

// ────────────────────────────── Panneaux ───────────────────────────────────

function PropertiesPanel({
  el, onUpdate, onDelete, onBringForward, onSendBackward, onPickImage, imageUrls,
}: {
  el: DesignElement;
  onUpdate: (patch: Partial<DesignElement>) => void;
  onDelete: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onPickImage: () => void;
  imageUrls: Record<string, string>;
}) {
  const t = useTranslations('designs.editor');
  return (
    <div className="space-y-4">
      <PanelTitle label={t(`prop.${el.type}` as never)} />
      <div className="space-y-3">
        {el.type === 'text' && (
          <>
            <Field label={t('p.text')}>
              <textarea
                value={el.text}
                onChange={(e) => onUpdate({ text: e.target.value })}
                rows={3}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label={t('p.font')}>
              <div className="flex gap-1">
                {FONT_FAMILIES.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => onUpdate({ fontFamily: f })}
                    className={`flex-1 rounded-md border px-2 py-1.5 text-xs ${el.fontFamily === f ? 'border-primary bg-primary/10 font-medium' : 'text-muted-foreground'}`}
                    style={f === 'display' ? { fontFamily: 'var(--font-display)' } : undefined}
                  >
                    {f === 'display' ? t('p.fontDisplay') : t('p.fontSans')}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <NumField label={t('p.size')} value={el.fontSize} min={6} max={400} onChange={(v) => onUpdate({ fontSize: v })} />
              <Field label={t('p.weight')}>
                <select
                  value={el.fontWeight}
                  onChange={(e) => onUpdate({ fontWeight: Number(e.target.value) })}
                  className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                >
                  <option value={300}>300</option>
                  <option value={400}>400</option>
                  <option value={600}>600</option>
                  <option value={700}>700</option>
                  <option value={900}>900</option>
                </select>
              </Field>
              <NumField label={t('p.letterSpacing')} value={el.letterSpacing} min={-10} max={40} onChange={(v) => onUpdate({ letterSpacing: v })} />
              <NumField label={t('p.lineHeight')} value={el.lineHeight} min={0.8} max={3} step={0.05} onChange={(v) => onUpdate({ lineHeight: v })} />
            </div>
            <Field label={t('p.color')}>
              <ColorInput value={el.color} onChange={(v) => onUpdate({ color: v })} />
            </Field>
            <Field label={t('p.align')}>
              <div className="flex gap-1">
                {(['left', 'center', 'right'] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => onUpdate({ align: a })}
                    className={`flex-1 rounded-md border px-2 py-1.5 text-xs ${el.align === a ? 'border-primary bg-primary/10 font-medium' : 'text-muted-foreground'}`}
                  >
                    {t(`p.align${a[0].toUpperCase()}${a.slice(1)}` as never)}
                  </button>
                ))}
              </div>
            </Field>
            <div className="flex gap-4 text-xs">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={el.uppercase} onChange={(e) => onUpdate({ uppercase: e.target.checked })} />
                {t('p.uppercase')}
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={el.italic} onChange={(e) => onUpdate({ italic: e.target.checked })} />
                {t('p.italic')}
              </label>
            </div>
          </>
        )}

        {el.type === 'shape' && (
          <>
            <Field label={t('p.shape')}>
              <select
                value={el.shape}
                onChange={(e) => onUpdate({ shape: e.target.value as never })}
                className="h-8 w-full rounded-md border bg-background px-2 text-xs"
              >
                {SHAPES.map((s) => (
                  <option key={s} value={s}>{t(`p.shape${s[0].toUpperCase()}${s.slice(1)}` as never)}</option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('p.fill')}>
                <ColorInput value={el.fill === 'none' ? '#ffffff' : el.fill} onChange={(v) => onUpdate({ fill: v })} allowNone />
              </Field>
              <Field label={t('p.stroke')}>
                <ColorInput value={el.stroke === 'none' ? '#ffffff' : el.stroke} onChange={(v) => onUpdate({ stroke: v })} allowNone />
              </Field>
              {el.shape !== 'line' && (
                <>
                  <NumField label={t('p.strokeWidth')} value={el.strokeWidth} min={0} max={100} onChange={(v) => onUpdate({ strokeWidth: v })} />
                  {(el.shape === 'rect') && (
                    <NumField label={t('p.radius')} value={el.borderRadius} min={0} max={500} onChange={(v) => onUpdate({ borderRadius: v })} />
                  )}
                </>
              )}
            </div>
          </>
        )}

        {el.type === 'icon' && (
          <>
            <Field label={t('p.icon')}>
              <div className="grid grid-cols-5 gap-1">
                {ICON_LIST.map((ic) => (
                  <button
                    key={ic}
                    type="button"
                    onClick={() => onUpdate({ icon: ic })}
                    className={`flex h-8 items-center justify-center rounded-md border text-sm ${el.icon === ic ? 'border-primary bg-primary/10' : 'text-muted-foreground hover:border-primary/40'}`}
                  >
                    {ICONS[ic] ?? '•'}
                  </button>
                ))}
              </div>
            </Field>
            <Field label={t('p.iconColor')}>
              <ColorInput value={el.iconColor} onChange={(v) => onUpdate({ iconColor: v })} />
            </Field>
          </>
        )}

        {el.type === 'image' && (
          <>
            <Button variant="outline" size="sm" onClick={onPickImage} className="w-full gap-1.5">
              <ImageIcon className="size-3.5" aria-hidden />
              {t('p.changeImage')}
            </Button>
            <Field label={t('p.fit')}>
              <div className="flex gap-1">
                {(['cover', 'contain', 'fill'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => onUpdate({ fit: f })}
                    className={`flex-1 rounded-md border px-2 py-1.5 text-xs ${el.fit === f ? 'border-primary bg-primary/10 font-medium' : 'text-muted-foreground'}`}
                  >
                    {t(`p.fit${f[0].toUpperCase()}${f.slice(1)}` as never)}
                  </button>
                ))}
              </div>
            </Field>
            <NumField label={t('p.radius')} value={el.borderRadius} min={0} max={500} onChange={(v) => onUpdate({ borderRadius: v })} />
            {imageUrls[el.src] && (
              <p className="text-[11px] text-muted-foreground">{t('p.mediaUsed')}</p>
            )}
          </>
        )}

        {el.type === 'qr' && (
          <>
            <Field label={t('p.qrValue')}>
              <Input value={el.value} onChange={(e) => onUpdate({ value: e.target.value })} className="h-8 text-xs" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('p.qrColor')}>
                <select
                  value={el.color}
                  onChange={(e) => onUpdate({ color: e.target.value as never })}
                  className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                >
                  <option value="black">{t('p.qrBlack')}</option>
                  <option value="white">{t('p.qrWhite')}</option>
                </select>
              </Field>
              <NumField label={t('p.qrMargin')} value={el.margin} min={0} max={8} onChange={(v) => onUpdate({ margin: v })} />
            </div>
          </>
        )}

        {/* Communs */}
        <NumField label={t('p.opacity')} value={Math.round(el.opacity * 100)} min={0} max={100} onChange={(v) => onUpdate({ opacity: v / 100 })} suffix="%" />
        <NumField label={t('p.rotation')} value={el.rotation} min={-180} max={180} onChange={(v) => onUpdate({ rotation: v })} suffix="°" />
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={onBringForward} className="flex-1 gap-1 text-xs">
            <ArrowUp className="size-3.5" aria-hidden />
            {t('p.bringForward')}
          </Button>
          <Button variant="outline" size="sm" onClick={onSendBackward} className="flex-1 gap-1 text-xs">
            <ArrowDown className="size-3.5" aria-hidden />
            {t('p.sendBack')}
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={onDelete} className="w-full gap-1.5 text-destructive hover:bg-destructive/10">
          <Trash2 className="size-3.5" aria-hidden />
          {t('deleteElement')}
        </Button>
      </div>
    </div>
  );
}

function BackgroundPanel({
  background, onChange, onPickImage, imageUrls,
}: {
  background: DesignBackground;
  onChange: (bg: DesignBackground) => void;
  onPickImage: () => void;
  imageUrls: Record<string, string>;
}) {
  const t = useTranslations('designs.editor');
  const GRADIENTS = [
    'linear-gradient(160deg, #0f172a 0%, #1e293b 55%, #334155 100%)',
    'linear-gradient(160deg, #fdf6ec 0%, #f3e5d8 100%)',
    'linear-gradient(200deg, #f8f1ff 0%, #e9d5ff 100%)',
    'linear-gradient(160deg, #ecfdf5 0%, #d1fae5 100%)',
    'linear-gradient(135deg, #1c1917 0%, #44403c 60%, #78716c 100%)',
    'linear-gradient(180deg, #fefce8 0%, #fef9c3 100%)',
  ];
  return (
    <div className="space-y-4">
      <PanelTitle label={t('bg.title')} />
      <Field label={t('bg.type')}>
        <div className="grid grid-cols-3 gap-1">
          {(['color', 'gradient', 'image'] as const).map((ty) => (
            <button
              key={ty}
              type="button"
              onClick={() => onChange({ type: ty, value: ty === 'color' ? '#FFFFFF' : ty === 'gradient' ? GRADIENTS[0] : '' })}
              className={`rounded-md border px-2 py-1.5 text-xs ${background.type === ty ? 'border-primary bg-primary/10 font-medium' : 'text-muted-foreground'}`}
            >
              {t(`bg.${ty}` as never)}
            </button>
          ))}
        </div>
      </Field>
      {background.type === 'color' && (
        <Field label={t('bg.color')}>
          <ColorInput value={background.value} onChange={(v) => onChange({ type: 'color', value: v })} />
        </Field>
      )}
      {background.type === 'gradient' && (
        <div className="grid grid-cols-3 gap-2">
          {GRADIENTS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => onChange({ type: 'gradient', value: g })}
              className={`h-12 rounded-md border-2 ${background.value === g ? 'border-primary' : 'border-transparent'}`}
              style={{ background: g }}
            />
          ))}
        </div>
      )}
      {background.type === 'image' && (
        <div className="space-y-2">
          {background.value ? (
            imageUrls[background.value] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrls[background.value]} alt="" className="h-24 w-full rounded-md object-cover" />
            )
          ) : (
            <p className="text-xs text-muted-foreground">{t('bg.imagePick')}</p>
          )}
          <Button variant="outline" size="sm" onClick={onPickImage} className="w-full gap-1.5">
            <ImageIcon className="size-3.5" aria-hidden />
            {t('bg.pickImage')}
          </Button>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────── Petits contrôles ───────────────────────────

function PanelTitle({ label }: { label: string }) {
  return (
    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      <Pencil className="size-3.5" aria-hidden />
      {label}
    </h3>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function NumField({
  label, value, min, max, step = 1, onChange, suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <Field label={label + (suffix ? ` (${suffix})` : '')}>
      <input
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(clamp(v, min, max));
        }}
        className="h-8 w-full rounded-md border bg-background px-2 text-xs"
      />
    </Field>
  );
}

function ColorInput({ value, onChange, allowNone }: { value: string; onChange: (v: string) => void; allowNone?: boolean }) {
  const isNone = value === 'none';
  const hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={isNone ? '#000000' : hex}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-10 cursor-pointer rounded-md border bg-background p-0.5"
      />
      <Input
        value={isNone ? 'aucun' : value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 flex-1 text-xs"
      />
      {allowNone && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={() => onChange(isNone ? '#000000' : 'none')}
        >
          {isNone ? '#' : '∅'}
        </Button>
      )}
    </div>
  );
}

function IconBtn({
  children, label, onClick, disabled, danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40 ${
        danger ? 'hover:bg-destructive/10 hover:text-destructive' : ''
      }`}
    >
      {children}
    </button>
  );
}

function ShapePicker({ onPick, label }: { onPick: (s: (typeof SHAPES)[number]) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const t = useTranslations('designs.editor');
  return (
    <div className="relative">
      <IconBtn label={label} onClick={() => setOpen((o) => !o)}>
        <Shapes className="size-4" />
        <ChevronDown className="size-3" />
      </IconBtn>
      {open && (
        <div className="absolute left-0 top-8 z-50 w-40 rounded-lg border bg-background p-1 shadow-lg">
          {SHAPES.map((s) => (
            <button
              key={s}
              type="button"
              className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
              onClick={() => { onPick(s); setOpen(false); }}
            >
              {t(`p.shape${s[0].toUpperCase()}${s.slice(1)}` as never)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function IconPicker({ onPick, label }: { onPick: (icon: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <IconBtn label={label} onClick={() => setOpen((o) => !o)}>
        <Sparkles className="size-4" />
        <ChevronDown className="size-3" />
      </IconBtn>
      {open && (
        <div className="absolute left-0 top-8 z-50 grid w-44 grid-cols-5 gap-0.5 rounded-lg border bg-background p-1.5 shadow-lg">
          {ICON_LIST.map((ic) => (
            <button
              key={ic}
              type="button"
              className="flex h-7 items-center justify-center rounded-md text-sm hover:bg-muted"
              onClick={() => { onPick(ic); setOpen(false); }}
              title={ic}
            >
              {ICONS[ic] ?? '•'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────── Médiathèque ────────────────────────────────

interface MediaItem {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  originalName: string;
  sizeBytes: number;
}

function MediaLibraryModal({
  onClose, onPick,
}: {
  onClose: () => void;
  onPick: (m: MediaItem) => void;
  eventId?: string;
}) {
  const t = useTranslations('designs.editor.media');
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    const res = await apiFetch<{ items: MediaItem[] }>(`/api/media?page=1&pageSize=24`);
    if (res.ok && res.data) setItems(res.data.items);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', 'photo');
    const res = await fetch('/api/media', { method: 'POST', body: fd });
    const json = await res.json().catch(() => null);
    setUploading(false);
    if (!res.ok || !json?.ok) {
      setError(json?.error?.message ?? t('uploadError'));
      return;
    }
    toast.success(t('uploaded'));
    void load();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <Card className="w-full max-w-lg">
        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <LayoutTemplate className="size-4 text-primary" aria-hidden />
              {t('title')}
            </h3>
            <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">✕</button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = '';
            }}
          />
          <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <FilePlus2 className="size-3.5" aria-hidden />
            {uploading ? t('uploading') : t('upload')}
          </Button>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto">
            {loading && (
              <p className="col-span-3 py-6 text-center text-xs text-muted-foreground">{t('loading')}</p>
            )}
            {!loading && items.length === 0 && (
              <p className="col-span-3 py-6 text-center text-xs text-muted-foreground">{t('empty')}</p>
            )}
            {!loading && items.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onPick(m)}
                className="group relative aspect-square overflow-hidden rounded-lg border bg-muted"
                title={m.originalName}
              >
                {m.thumbnailUrl || m.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.thumbnailUrl ?? m.url} alt={m.originalName} className="h-full w-full object-cover" />
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
