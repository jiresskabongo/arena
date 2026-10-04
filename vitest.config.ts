import { defineConfig } from 'vitest/config';
import path from 'node:path';
import fs from 'node:fs';

/** Charge .env dans l'environnement des tests (le client Prisma ne le fait pas). */
function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of ['.env', '.env.local']) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const i = trimmed.indexOf('=');
      if (i === -1) continue;
      const key = trimmed.slice(0, i).trim();
      const value = trimmed.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in out)) out[key] = value;
    }
  }
  return out;
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    globals: true,
    testTimeout: 20000,
    env: { ...loadEnv(), ...process.env } as Record<string, string>,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
