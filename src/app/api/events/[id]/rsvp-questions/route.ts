import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { listRsvpQuestions, saveRsvpQuestions } from '@/server/services/invitation';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** GET /api/events/[id]/rsvp-questions — questions RSVP (rsvp:read). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant('rsvp:read');
    const questions = await listRsvpQuestions(ctx, id);
    return NextResponse.json({ ok: true, questions });
  } catch (e) {
    return apiError(e);
  }
}

/** PUT /api/events/[id]/rsvp-questions — remplace la liste (guest:update, max 10). */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant('guest:update');
    const body = await req.json().catch(() => null);
    const questions = Array.isArray(body) ? body : body?.questions;
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    const saved = await saveRsvpQuestions(ctx, id, questions ?? [], ip);
    return NextResponse.json({ ok: true, questions: saved });
  } catch (e) {
    return apiError(e);
  }
}
