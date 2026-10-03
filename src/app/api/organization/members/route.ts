import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { inviteMember, listMembers } from '@/server/services/team';
import { inviteMemberSchema } from '@/lib/schemas/event';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** GET /api/organization/members — équipe + invitations (members:read). */
export async function GET() {
  try {
    const ctx = await requireTenant('members:read');
    const members = await listMembers(ctx);
    return NextResponse.json({ ok: true, members });
  } catch (e) {
    return apiError(e);
  }
}

/** POST /api/organization/members — invitation e-mail (members:invite, mock outbox). */
export async function POST(req: Request) {
  try {
    const ctx = await requireTenant('members:invite');

    const body = await req.json().catch(() => null);
    const parsed = inviteMemberSchema.safeParse(body);
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
    const member = await inviteMember(ctx, parsed.data, ip);
    return NextResponse.json({ ok: true, member }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
