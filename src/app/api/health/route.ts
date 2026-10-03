import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  let db: 'ok' | 'error' = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = 'error';
  }
  return NextResponse.json(
    {
      status: db === 'ok' ? 'ok' : 'degraded',
      db,
      env: process.env.NODE_ENV ?? 'development',
      providers: {
        email: process.env.EMAIL_PROVIDER || 'mock',
        sms: process.env.SMS_PROVIDER || 'mock',
        whatsapp: process.env.WHATSAPP_PROVIDER || 'mock',
        payment: process.env.PAYMENT_PROVIDER || 'mock',
        ai: process.env.AI_PROVIDER || 'mock',
        storage: process.env.STORAGE_PROVIDER || 'local',
      },
      time: new Date().toISOString(),
    },
    { status: db === 'ok' ? 200 : 503 },
  );
}
