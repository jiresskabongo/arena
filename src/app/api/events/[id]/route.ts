import { NextResponse } from 'next/server';
import { requireTenant, TenantError } from '@/server/services/tenant';
import {
  getEventForOrg, updateEvent, deleteEvent, listEventMembers,
} from '@/server/services/event';
import { updateEventSchema } from '@/lib/schemas/event';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** GET /api/events/[id] — détail (tous rôles de l'org). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    if (!ctx.organization) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');

    const event = await getEventForOrg(id, ctx.organization.id);
    if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');

    const members = (await listEventMembers(id, ctx.organization.id)) ?? [];

    return NextResponse.json({ ok: true, event: { ...event, members } });
  } catch (e) {
    return apiError(e);
  }
}

/** PATCH /api/events/[id] — mise à jour complète (event:update). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant('event:update');

    const body = await req.json().catch(() => null);
    const parsed = updateEventSchema.safeParse(body);
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
    const updated = await updateEvent(ctx, id, parsed.data, ip);
    return NextResponse.json({ ok: true, event: updated });
  } catch (e) {
    return apiError(e);
  }
}

/** DELETE /api/events/[id] — suppression avec politique (event:delete). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant('event:delete');

    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    await deleteEvent(ctx, id, ip);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
