import { NextResponse } from 'next/server';
import { resolveStorageFile } from '@/server/services/media';

export const dynamic = 'force-dynamic';

/**
 * Service des fichiers médias : GET /api/storage/<clé> (multi-segments, ex.
 * orgs/<orgId>/<hex>.jpg). Public par nature (§13.17 : les médias partagés via
 * les invitations le sont ; clés non devinables = cuid + 10 octets aléatoires).
 * URLs signées temporisées : réservées prod (§13.49).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;
  const k = (key ?? [])
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .join('/');

  const file = resolveStorageFile(k);
  if (!file) {
    return new NextResponse('Not found', { status: 404 });
  }
  return new NextResponse(new Uint8Array(file.buffer), {
    headers: {
      'Content-Type': file.mimeType,
      'Content-Length': String(file.buffer.byteLength),
      // Clés non devinables + contenu immuable → cache long OK.
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
