import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { duplicateEvent } from '@/server/services/event';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** POST /api/events/[id]/duplicate — copie config (sans invités) → brouillon. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant('event:create');

    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    const copy = await duplicateEvent(ctx, id, ip);
    return NextResponse.json({ ok: true, event: copy }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
