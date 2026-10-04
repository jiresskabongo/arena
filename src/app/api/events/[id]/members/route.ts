import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import {
  listEventMembers, addEventMember, getEventForOrg,
} from '@/server/services/event';
import { eventMemberSchema } from '@/lib/schemas/event';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** GET /api/events/[id]/members — personnes principales. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    if (!ctx.organization) return NextResponse.json({ ok: true, members: [] });

    const event = await getEventForOrg(id, ctx.organization.id);
    if (!event) return NextResponse.json({ ok: false, error: { code: 'event_not_found', message: 'Événement introuvable.' } }, { status: 404 });

    const members = (await listEventMembers(id, ctx.organization.id)) ?? [];
    return NextResponse.json({ ok: true, members });
  } catch (e) {
    return apiError(e);
  }
}

/** POST /api/events/[id]/members — ajout (event:update). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant('event:update');

    const body = await req.json().catch(() => null);
    const parsed = eventMemberSchema.safeParse(body);
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
    const member = await addEventMember(ctx, id, parsed.data, ip);
    return NextResponse.json({ ok: true, member }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
