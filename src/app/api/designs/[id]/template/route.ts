import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTenant } from '@/server/services/tenant';
import { saveDesignAsTemplate } from '@/server/services/design';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

const schema = z.object({
  name: z.string().min(2).max(120),
  category: z.string().min(2).max(60).optional(),
  style: z.string().min(2).max(60).optional(),
});

/** POST /api/designs/[id]/template — « enregistrer comme template » (design:create). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant('design:create');
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'validation',
            message: 'Nom de template invalide.',
            details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
          },
        },
        { status: 400 },
      );
    }
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    const tpl = await saveDesignAsTemplate(ctx, id, parsed.data, ip);
    return NextResponse.json({ ok: true, template: { id: tpl.id, name: tpl.name } }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
