import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { listTemplates, saveTemplate } from '@/server/services/communication';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/** GET /api/notifications/templates — templates (plateforme + surcharges org). */
export async function GET() {
  try {
    const ctx = await requireTenant();
    const templates = await listTemplates(ctx);
    return NextResponse.json({ ok: true, templates });
  } catch (e) {
    return apiError(e);
  }
}

/** PUT /api/notifications/templates — crée/mets à jour un template ORGANISATION (comm:send). */
export async function PUT(req: Request) {
  try {
    const ctx = await requireTenant('comm:send');
    const body = await req.json().catch(() => null);
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    const template = await saveTemplate(ctx, body ?? {}, ip);
    return NextResponse.json({ ok: true, template });
  } catch (e) {
    return apiError(e);
  }
}
