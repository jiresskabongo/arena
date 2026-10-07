import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  // pdfkit charge des métriques de polices (.afm) et des assets depuis le disque :
  // à laisser en require natif côté server (sinon le bundling perd les chemins relatifs).
  serverExternalPackages: ['pdfkit', 'fontkit', 'restructure', 'iconv-lite'],
  async headers() {
    // L'app est prévisualisée dans un IFRAME cross-origin (preview Arena).
    // En dev/preview on autorise l'imbrication ; en production on protège
    // contre le clickjacking (X-Frame-Options: SAMEORIGIN).
    const isProduction = process.env.NODE_ENV === 'production';
    const headers: { key: string; value: string }[] = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ];
    if (isProduction) {
      headers.unshift({ key: 'X-Frame-Options', value: 'SAMEORIGIN' });
    }
    return [{ source: '/(.*)', headers }];
  },
};

export default withNextIntl(nextConfig);
