#!/usr/bin/env node
/**
 * Bascule le provider de la base dans prisma/schema.prisma.
 *
 * Usage :
 *   node scripts/switch-db-provider.mjs sqlite        # sandbox / dev local
 *   node scripts/switch-db-provider.mjs postgresql    # production
 *
 * Le repo committe le provider sqlite (réalité du sandbox Arena).
 * Pour une image/DB PostgreSQL, basculer AVANT `prisma generate`.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];
if (!['sqlite', 'postgresql'].includes(target)) {
  console.error('Usage : node scripts/switch-db-provider.mjs <sqlite|postgresql>');
  process.exit(1);
}

const file = new URL('../prisma/schema.prisma', import.meta.url);
const src = readFileSync(file, 'utf8');
const re = /(datasource\s+db\s*\{\s*provider\s*=\s*)"(sqlite|postgresql)"/;
if (!re.test(src)) {
  console.error('Bloc datasource introuvable dans prisma/schema.prisma');
  process.exit(1);
}
const current = src.match(re)?.[2];
if (current === target) {
  console.log(`✔ provider déjà "${target}" — rien à faire`);
  process.exit(0);
}
const out = src.replace(re, `$1"${target}"`);
writeFileSync(file, out);
console.log(`✔ prisma/schema.prisma : provider "${current}" → "${target}"`);
console.log('Étapes suivantes : npx prisma generate && npx prisma db push');
if (target === 'postgresql') {
  console.log('⚠ Les migrations commitées sont SQLite : sur une base Postgres fraîche,');
  console.log('  `prisma db push` suffit (MVP). Pour l\'hygiène de migration, générer une');
  console.log('  migration initiale Postgres (prisma migrate dev --name init) et basculer');
  console.log('  le deploy sur `prisma migrate deploy`.');
}
