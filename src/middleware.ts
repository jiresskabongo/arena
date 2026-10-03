import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Applique la négociation de locale à tout chemin hors API et hors assets
  matcher: ['/((?!api|_next|_vercel|storage|.*\\..*).*)'],
};
