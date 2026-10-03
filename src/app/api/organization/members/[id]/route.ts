import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { changeMemberRole, removeMember } from '@/server/services/team';
import { changeMemberRoleSchema } from '@/lib/schemas/event';
import { apiError } from '@/server/http';
import { isOrgRole } from '@/server/services/permissions';

export const dynamic = 'force-dynamic';

/** PATCH /api/organization/members/[id] — changement de rôle (members:change_role = owner). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: memberId } = await params;
    const ctx = await requireTenant('members:change_role');

    const body = await req.json().catch(() => null);
    const parsed = changeMemberRoleSchema.safeParse(body);
    if (!parsed.success || !isOrgRole(parsed.data.role)) {
      return NextResponse.json(
        { error: { code: 'validation', message: 'Rôle invalide.' } },
        { status: 400 },
      );
    }

    await changeMemberRole(ctx, memberId, parsed.data.role);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

/** DELETE /api/organization/members/[id] — retrait (members:remove). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: memberId } = await params;
    const ctx = await requireTenant('members:remove');

    await removeMember(ctx, memberId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
