import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { duplicateDesign } from '@/server/services/design';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** POST /api/designs/[id]/duplicate — copie (design:create). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant('design:create');
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    const copy = await duplicateDesign(ctx, id, ip);
    return NextResponse.json({ ok: true, design: { id: copy.id, name: copy.name } }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
