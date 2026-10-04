import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import {
  getDesign, updateDesign, deleteDesign, duplicateDesign,
  saveDesignAsTemplate, exportDesign,
} from '@/server/services/design';
import { updateDesignSchema } from '@/server/services/design';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** GET /api/designs/[id] — détail complet (éléments + fond). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    const design = await getDesign(ctx, id);
    return NextResponse.json({ ok: true, design });
  } catch (e) {
    return apiError(e);
  }
}

/** PATCH /api/designs/[id] — mise à jour (design:update) : nom, format, éléments, fond. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant('design:update');
    const body = await req.json().catch(() => null);
    const parsed = updateDesignSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'validation',
            message: 'Veuillez corriger les champs indiqués.',
            details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
          },
        },
        { status: 400 },
      );
    }
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    const design = await updateDesign(ctx, id, parsed.data, ip);
    return NextResponse.json({ ok: true, design: { id: design.id, name: design.name, version: design.version } });
  } catch (e) {
    return apiError(e);
  }
}

/** DELETE /api/designs/[id] — suppression (design:delete). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant('design:delete');
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    await deleteDesign(ctx, id, ip);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
