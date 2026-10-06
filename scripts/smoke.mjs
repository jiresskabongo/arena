#!/usr/bin/env node
/**
 * Smoke test HTTP — TOUTE LA PLATEFORME (EventFlow MVP).
 *
 * Prérequis : serveur de dev lancé (`npm run dev`) + base seedée
 * (`npx prisma db push && npx prisma seed`).
 *
 * Couvre (conditions réelles : cookies, middleware, pages, webhooks) :
 *   A. Public & santé          B. Auth & sessions        C. Événements
 *   D. Invités & tables        E. Designs, médias, exports
 *   F. Invitations, QR, RSVP   G. Scan & hors ligne      H. Communications
 *   I. Billing (critère O)     J. Stats, rapports, livre d'or
 *   K. IA & crédits            L. Super admin            M. i18n & erreurs
 *
 * Usage : node scripts/smoke.mjs [baseUrl]   (défaut http://127.0.0.1:3000)
 */
import crypto from 'node:crypto';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';

const BASE = process.argv[2] ?? process.env.SMOKE_BASE ?? 'http://127.0.0.1:3000';
const WEBHOOK_SECRET = process.env.MOCK_WEBHOOK_SECRET || 'mock-webhook-secret-dev';
const stamp = Date.now().toString(36);

/** Lectures DB ponctuelles (champs non exposés par l'API, lecture seule). */
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
const failures = [];

function ok(cond, label, extra) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    failures.push(label + (extra ? ` — ${extra}` : ''));
    console.log(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`);
  }
}
function section(name) {
  console.log(`\n■ ${name}`);
}

/** Cookie jar minimaliste (parsage Set-Cookie, en-tête Cookie sortant). */
function makeJar() {
  const map = new Map();
  return {
    cookieHeader() {
      return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    apply(headers) {
      const sc = headers.getSetCookie ? headers.getSetCookie() : [];
      for (const c of sc) {
        const [pair, ...attrs] = c.split(';');
        const i = pair.indexOf('=');
        const name = pair.slice(0, i).trim();
        const value = pair.slice(i + 1).trim();
        const expired = attrs.some((a) => a.startsWith('Max-Age=0') || (a.startsWith('Expires=') && new Date(a.slice(8)) < new Date()));
        if (expired || value === '') map.delete(name);
        else map.set(name, value);
      }
    },
  };
}

async function raw(jar, method, p, { body, rawBody, form, headers = {} } = {}) {
  const init = { method, headers: { ...headers }, redirect: 'manual' };
  if (jar && jar.cookieHeader()) init.headers['cookie'] = jar.cookieHeader();
  if (form) init.body = form;
  else if (rawBody !== undefined) {
    init.headers['content-type'] = init.headers['content-type'] ?? 'application/json';
    init.body = rawBody;
  } else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(BASE + p, init);
  } catch (e) {
    // Le dev server Next 15.5 peut se relancer seul (seuil mémoire) en pleine
    // requête : on attend la remise en service puis on retente UNE fois (le
    // reset survient avant toute réponse → aucun effet de bord côté serveur).
    if (e?.cause?.code === 'ECONNRESET' || e?.name === 'TypeError') {
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        try {
          const probe = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(2000) });
          if (probe.ok) break;
        } catch {
          /* pas encore prêt */
        }
      }
      res = await fetch(BASE + p, init);
    } else throw e;
  }
  if (jar) jar.apply(res.headers);
  return res;
}

async function api(jar, method, p, body) {
  const res = await raw(jar, method, p, { body });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers };
}

/** GET d'une page HTML avec suivi des redirections (locales `as-needed` → 307). */
async function page(jar, p) {
  let url = p;
  let res = null;
  for (let i = 0; i < 5; i++) {
    res = await raw(jar, 'GET', url);
    if (res.status === 307 || res.status === 308 || res.status === 302) {
      const loc = res.headers.get('location') ?? '';
      const abs = new URL(loc, BASE);
      url = abs.pathname + abs.search;
      continue;
    }
    break;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, ct, len: buf.length, html: buf.toString('utf8') };
}



const uuid = () => crypto.randomUUID();
const dateIn = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const email = (p) => `${p}.${stamp}@exemple.cd`;

/* ──────────────────────────────────────────────────────────────────────── */
console.log(`SMOKE EventFlow — ${BASE}`);

/* ── A. Public & santé ─────────────────────────────────────────────────── */
section('A. Public & santé');
{
  const h = await api(null, 'GET', '/api/health');
  ok(h.status === 200 && h.json?.status === 'ok' && h.json?.db === 'ok' && h.json?.providers, 'GET /api/health (providers identifiés mock)');

  const landing = await page(null, '/fr');
  ok(landing.status === 200 && landing.len > 500, 'GET / (landing FR, 307 as-needed suivi)', `status=${landing.status} len=${landing.len}`);
  const en = await page(null, '/en');
  ok(en.status === 200, 'GET /en (landing EN)', `status=${en.status}`);
  const login = await page(null, '/fr/login');
  ok(login.status === 200 && /login|identifiant/i.test(login.html), 'GET /login rendue (FR)');
}

/* ── B. Auth & sessions (utilisateur A) ────────────────────────────────── */
section('B. Auth & sessions');
const jarA = makeJar();
const emailA = email('owner');
{
  const r = await api(jarA, 'POST', '/api/auth/register', {
    email: emailA, password: 'Event1234', firstName: 'Ama', lastName: 'Owner',
    organizationName: `Smoke Org ${stamp}`, currency: 'USD', locale: 'fr',
  });
  const registered = r.status === 201 || r.status === 200;
  const emailTaken = r.status === 409 && r.json?.error?.code === 'email_taken';
  if (!registered && emailTaken) {
    // Cas ambigu : la 1ʳᵉ tentative a créé l'user mais la réponse s'est perdue
    // (redémarrage dev server) → on se connecte avec les mêmes identifiants.
    const lb = await api(jarA, 'POST', '/api/auth/login', { email: emailA, password: 'Event1234' });
    ok(lb.status === 200, 'register (déjà présent après reset réseau) → login', `status=${lb.status}`);
  } else {
    ok(registered, 'POST /api/auth/register (A)', `status=${r.status} ${JSON.stringify(r.json?.error ?? '').slice(0, 100)}`);
  }
  ok(jarA.cookieHeader().includes('ef_session'), 'cookie de session posé (ef_session)');

  const ses = await api(jarA, 'GET', '/api/account/sessions');
  ok(ses.status === 200, 'GET /api/account/sessions', `status=${ses.status}`);

  const logout = await api(jarA, 'POST', '/api/auth/logout');
  ok(logout.status === 200, 'POST /api/auth/logout', `status=${logout.status}`);
  const after = await api(jarA, 'GET', '/api/account/sessions');
  ok(after.status === 401, 'session révoquée après logout (401)', `status=${after.status}`);

  const re = await api(jarA, 'POST', '/api/auth/login', { email: emailA, password: 'Event1234' });
  ok(re.status === 200 && re.json?.ok, 're-login (A)', `status=${re.status}`);

  const bad = await api(makeJar(), 'POST', '/api/auth/login', { email: emailA, password: 'mauvais-mot-de-passe' });
  ok(bad.status === 401, 'mot de passe erroné → 401', `status=${bad.status}`);

  const org = await api(jarA, 'GET', '/api/organization');
  const sub = org.json?.subscription;
  ok(org.status === 200 && sub?.status === 'trialing' && org.json?.quotas, `organisation trial + quotas (status=${sub?.status})`);
}

/* ── C. Événements ─────────────────────────────────────────────────────── */
section('C. Événements');
let eventId, eventSlug;
{
  const r = await api(jarA, 'POST', '/api/events', {
    name: `Mariage Smoke ${stamp}`, typeCode: 'wedding', date: dateIn(30),
    startTime: '17:00', endTime: '23:00', venue: 'Hôtel du Centre', city: 'Kinshasa',
  });
  ok(r.status === 201, 'POST /api/events (création)', `status=${r.status} ${JSON.stringify(r.json?.error ?? '').slice(0, 120)}`);
  eventId = r.json?.event?.id ?? r.json?.data?.id;
  eventSlug = r.json?.event?.slug ?? r.json?.data?.slug;
  ok(Boolean(eventId) && Boolean(eventSlug), 'id/slug retournés', `id=${eventId}`);

  const st = await api(jarA, 'POST', `/api/events/${eventId}/status`, { status: 'published' });
  ok(st.status === 200, 'publication (published)', `status=${st.status} ${JSON.stringify(st.json?.error ?? '')}`);

  const list = await api(jarA, 'GET', '/api/events?page=1');
  const found = (list.json?.events ?? list.json?.items ?? []).some((e) => e.id === eventId);
  ok(list.status === 200 && found, 'GET /api/events (pagination, événement listé)');

  const pub = await page(null, `/e/${eventSlug}`);
  ok(pub.status === 200 && pub.len > 500, 'page publique /e/[slug] (sans session)', `status=${pub.status} len=${pub.len}`);

  const dup = await api(jarA, 'POST', `/api/events/${eventId}/duplicate`);
  // Starter trial = 1 événement : la duplication peut légitimement buter sur le quota.
  const quotaOk = dup.status === 403 && dup.json?.error?.code === 'quota_exceeded';
  ok(dup.status === 201 || quotaOk, `duplication (201 — ou quota starter appliqué : ${dup.status})`, JSON.stringify(dup.json?.error ?? '').slice(0, 120));

  const pageEv = await page(jarA, '/fr/events');
  ok(pageEv.status === 200, 'page /events (client, 307 suivi)', `status=${pageEv.status}`);
}

/* ── D. Invités & tables ───────────────────────────────────────────────── */
section('D. Invités & tables');
let guestId;
{
  const g = await api(jarA, 'POST', `/api/events/${eventId}/guests`, {
    firstName: 'Jeanne', lastName: 'Invitée', email: email('inv1'), phone: '+243811111111',
    category: 'famille', companions: 1,
  });
  ok(g.status === 201, 'POST invité', `status=${g.status} ${JSON.stringify(g.json?.error ?? '').slice(0, 120)}`);
  guestId = g.json?.guest?.id ?? g.json?.data?.id;

  const list = await api(jarA, 'GET', `/api/events/${eventId}/guests?page=1&pageSize=10`);
  const found = (list.json?.guests ?? list.json?.items ?? []).some((x) => x.id === guestId);
  ok(list.status === 200 && found, 'liste paginée invités');

  const exp = await raw(jarA, 'GET', `/api/events/${eventId}/guests/export?format=csv`);
  const expText = (await exp.text()).slice(0, 300);
  ok(exp.status === 200 && (exp.headers.get('content-type') ?? '').includes('csv') && expText.includes('Jeanne'), 'export CSV invités', exp.headers.get('content-type'));

  const t = await api(jarA, 'POST', `/api/events/${eventId}/tables`, { name: 'Table 1', capacity: 8 });
  ok(t.status === 201, 'création table', `status=${t.status} ${JSON.stringify(t.json?.error ?? '').slice(0, 120)}`);

  // Critère P : isolement cross-tenant
  const jarB = makeJar();
  await api(jarB, 'POST', '/api/auth/register', {
    email: email('other'), password: 'Event1234', firstName: 'Bob', lastName: 'Autre',
    organizationName: `Smoke Org B ${stamp}`, currency: 'USD', locale: 'fr',
  });
  const cross = await api(jarB, 'GET', `/api/events/${eventId}/guests?page=1`);
  ok(cross.status === 404, 'critère P : invités d’une autre org → 404', `status=${cross.status}`);
  const crossEv = await api(jarB, 'GET', '/api/events');
  ok(crossEv.status === 200 && (crossEv.json?.events ?? crossEv.json?.items ?? []).length === 0, 'critère P : liste événements de B vide');
}

/* ── E. Designs, médias, exports ───────────────────────────────────────── */
section('E. Designs, médias, exports');
let designId;
{
  const tpl = await api(jarA, 'GET', '/api/templates');
  const tplCount = (tpl.json?.templates ?? tpl.json?.items ?? []).length;
  ok(tpl.status === 200 && tplCount >= 9, `catalogue templates plateforme (n=${tplCount})`);

  // Un template non-premium (le premier du catalogue est premium : verrou pro vérifié en +).
  const tplRow = await prisma.designTemplate.findFirst({
    where: { isPremium: false, status: 'published', organizationId: null },
    select: { id: true },
  });
  const tplId = tplRow?.id;
  const d = await api(jarA, 'POST', '/api/designs', {
    name: `Design Smoke ${stamp}`, type: 'invitation', templateId: tplId, eventId,
  });
  ok(d.status === 201, 'création design (template standard)', `status=${d.status} ${JSON.stringify(d.json?.error ?? '').slice(0, 120)}`);
  designId = d.json?.design?.id;

  const premiumTpl = (tpl.json?.templates ?? tpl.json?.items ?? []).find((t) => t.isPremium)
    ?? await prisma.designTemplate.findFirst({ where: { isPremium: true }, select: { id: true } });
  const dPremium = await api(jarA, 'POST', '/api/designs', {
    name: 'Design premium', type: 'invitation', templateId: premiumTpl?.id, eventId,
  });
  ok(dPremium.status === 403 && dPremium.json?.error?.code === 'premium_required', 'template premium bloqué en trial (403 premium_required)', `status=${dPremium.status}`);

  // Upload media : vraie image 400×300 (sharp) → vignette 320px obligatoire.
  const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 30, g: 60, b: 120 } } }).png().toBuffer();
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'photo.png');
  form.append('eventId', eventId);
  const up = await raw(jarA, 'POST', '/api/media', { form });
  const upj = await up.json().catch(() => null);
  ok(up.status === 201 && upj?.media?.url, 'upload média (multipart PNG 400×300)', `status=${up.status}`);
  const mediaUrl = upj?.media?.url;
  const thumbUrl = upj?.media?.thumbnailUrl;

  const serve = mediaUrl ? await raw(null, 'GET', mediaUrl) : null;
  ok(serve && serve.status === 200 && (serve.headers.get('content-type') ?? '').includes('png'),
    'service /api/storage/* (PNG 200)', serve ? `status=${serve.status}` : 'n/a');
  const thumb = thumbUrl ? await raw(null, 'GET', thumbUrl) : null;
  ok(Boolean(thumbUrl) && thumb && thumb.status === 200, 'vignette générée et servie (200)', thumb ? `status=${thumb.status}` : `n/a (${JSON.stringify(upj?.media ?? {}).slice(0, 120)})`);
  const trav = await raw(null, 'GET', '/api/storage/..%2f..%2fenv');
  ok(trav.status === 404, 'traversal bloqué (404)');

  const pngOut = designId ? await raw(jarA, 'GET', `/api/designs/${designId}/export?format=png`) : null;
  ok(pngOut && pngOut.status === 200 && (pngOut.headers.get('content-type') ?? '').includes('png'), 'export design PNG (SVG → canvas)', pngOut ? `status=${pngOut.status}` : 'n/a');
  const pdfOut = designId ? await raw(jarA, 'GET', `/api/designs/${designId}/export?format=pdf`) : null;
  ok(pdfOut && pdfOut.status === 200 && (pdfOut.headers.get('content-type') ?? '').includes('pdf'), 'export design PDF', pdfOut ? `status=${pdfOut.status}` : 'n/a');

  const upd = designId ? await api(jarA, 'PATCH', `/api/designs/${designId}`, { name: `Design Smoke ${stamp} v2` }) : null;
  ok(upd && upd.status === 200, 'mise à jour design (PATCH + autosave)', upd ? `status=${upd.status}` : 'n/a');
  const dup = designId ? await api(jarA, 'POST', `/api/designs/${designId}/duplicate`) : null;
  ok(dup && dup.status === 201, 'duplication design (v2)', dup ? `status=${dup.status}` : 'n/a');
}

/* ── F. Invitations, QR, RSVP ──────────────────────────────────────────── */
section('F. Invitations, QR, RSVP');
let invToken, invId;
{
  const gen = await api(jarA, 'POST', `/api/events/${eventId}/invitations`);
  ok(gen.status === 200 || gen.status === 201, 'génération en lot des invitations (QR)', `status=${gen.status} ${JSON.stringify(gen.json?.error ?? '').slice(0, 120)}`);

  const list = await api(jarA, 'GET', `/api/events/${eventId}/invitations?page=1`);
  const items = list.json?.invitations ?? list.json?.items ?? [];
  invId = items[0]?.id;
  invToken = (items[0]?.tokens ?? [])[0]?.token ?? items[0]?.token;
  ok(Boolean(invId) && Boolean(invToken), 'invitation + token QR retournés', JSON.stringify(items[0] ?? {}).slice(0, 200));

  const pub = invToken ? await page(null, `/i/${invToken}`) : null;
  ok(pub && pub.status === 200, 'page publique /i/[token] (sans session)', pub ? `status=${pub.status} len=${pub.len}` : 'n/a');

  const rsvp = invToken
    ? await api(null, 'POST', `/api/invitations/${invToken}/rsvp`, { status: 'confirmed', companions: 1, guests: [{ name: 'Compagnon' }] })
    : null;
  ok(rsvp && (rsvp.status === 200 || rsvp.status === 201), 'RSVP confirmé (page publique)', rsvp ? `status=${rsvp.status} ${JSON.stringify(rsvp.json?.error ?? '').slice(0, 120)}` : 'n/a');

  const bogus = await page(null, `/i/${'x'.repeat(32)}`);
  ok(bogus.status === 404, 'anti-énumération : token inconnu → 404', `status=${bogus.status}`);

  const rev = invId ? await api(jarA, 'POST', `/api/events/${eventId}/invitations/${invId}/revoke`) : null;
  ok(rev && rev.status === 200, 'révocation d’invitation', rev ? `status=${rev.status}` : 'n/a');
  const after = invToken ? await page(null, `/i/${invToken}`) : null;
  ok(after && after.status === 404, 'token révoqué → 404 (même code que inconnu)', after ? `status=${after.status}` : 'n/a');
}

/* ── G. Scan & mode hors ligne ─────────────────────────────────────────── */
section('G. Scan & mode hors ligne');
let agentToken, liveToken;
{
  const ag = await api(jarA, 'POST', `/api/events/${eventId}/scanner-agents`, {
    name: 'Agent Portail', entryPoint: 'Entrée A', permissions: ['scan'],
  });
  ok(ag.status === 201, 'création agent de scan (token opaque)', `status=${ag.status} ${JSON.stringify(ag.json?.error ?? '').slice(0, 120)}`);
  agentToken = ag.json?.agent?.token ?? ag.json?.token;

  // La seule invitation a été révoquée en F : on crée un invité frais + sa
  // propre invitation (non révoquée) pour le scan.
  const g2 = await api(jarA, 'POST', `/api/events/${eventId}/guests`, {
    firstName: 'Marc', lastName: 'Scan', email: email('scan'), category: 'amis',
  });
  await api(jarA, 'POST', `/api/events/${eventId}/invitations`);
  const list2 = await api(jarA, 'GET', `/api/events/${eventId}/invitations?page=1`);
  const items2 = list2.json?.invitations ?? list2.json?.items ?? [];
  const active = items2.find((x) => !x.tokenRevoked) ?? items2[0];
  ok(Boolean(active?.token) && !active?.tokenRevoked, `invitation non révoquée trouvée (invité n°2, ${items2.length} invitations)`, `statut=${g2.status}`);
  liveToken = (active?.tokens ?? [])[0]?.token ?? active?.token;

  const scan = agentToken && liveToken
    ? await api(null, 'POST', '/api/checkin/scan', { agentToken, token: liveToken, clientUuid: uuid() })
    : null;
  const res1 = scan?.json?.result ?? scan?.json;
  ok(scan && res1?.status === 'valid', 'scan VALIDE (1ʳᵉ entrée, bienvenue)', scan ? JSON.stringify(res1 ?? scan.json).slice(0, 150) : 'n/a');

  const scan2 = agentToken && liveToken
    ? await api(null, 'POST', '/api/checkin/scan', { agentToken, token: liveToken, clientUuid: uuid() })
    : null;
  const res2 = scan2?.json?.result ?? scan2?.json;
  ok(scan2 && (res2?.status === 'already_used' || res2?.status === 'alreadyUsed'), 'scan DÉJÀ UTILISÉ (anti double-entrée)', scan2 ? JSON.stringify(res2).slice(0, 120) : 'n/a');

  const scanBad = agentToken
    ? await api(null, 'POST', '/api/checkin/scan', { agentToken, token: 'token-inexistant-000', clientUuid: uuid() })
    : null;
  const res3 = scanBad?.json?.result ?? scanBad?.json;
  ok(scanBad && res3?.status === 'invalid', 'scan INVALIDE (token inconnu)', scanBad ? JSON.stringify(res3).slice(0, 120) : 'n/a');

  const sync = agentToken && liveToken
    ? await api(null, 'POST', '/api/scanner/sync', {
        agentToken,
        scans: [{ clientUuid: uuid(), token: liveToken, clientAt: new Date().toISOString() }],
      })
    : null;
  ok(sync && sync.status === 200, 'sync hors ligne (replay batch → dédupli par UUID)', sync ? `status=${sync.status} ${JSON.stringify(sync.json?.error ?? '').slice(0, 120)}` : 'n/a');

  const scanPage = agentToken ? await page(null, `/fr/scanner/${agentToken}`) : null;
  ok(scanPage && scanPage.status === 200, 'page /scanner/[token] rendue (pWA)', scanPage ? `status=${scanPage.status}` : 'n/a');
}

/* ── H. Communications & rappels ───────────────────────────────────────── */
section('H. Communications & rappels');
{
  const t = await api(jarA, 'GET', '/api/notifications/templates');
  const count = (t.json?.templates ?? t.json?.items ?? []).length;
  ok(t.status === 200 && count >= 10, `templates de notification (n=${count})`);

  const obBefore = (await api(jarA, 'GET', '/api/outbox?page=1&pageSize=100')).json;
  const before = obBefore?.total ?? (obBefore?.messages ?? obBefore?.items ?? []).length;

  const c = await api(jarA, 'POST', `/api/events/${eventId}/campaigns`, {
    type: 'reminder', channel: 'email', audience: 'all',
    subject: `Rappel mariage ${stamp}`, body: 'Votre présence est attendue — rappel automatique.',
  });
  ok(c.status === 201, 'création campagne (rappel email)', `status=${c.status} ${JSON.stringify(c.json?.error ?? '').slice(0, 120)}`);
  const cid = c.json?.campaign?.id;

  const send = cid ? await api(jarA, 'POST', `/api/events/${eventId}/campaigns/${cid}/send`) : null;
  ok(send && send.status === 200, 'envoi de campagne (→ outbox démo)', send ? `status=${send.status} ${JSON.stringify(send.json?.error ?? '').slice(0, 120)}` : 'n/a');

  const ob = await api(jarA, 'GET', '/api/outbox?page=1&pageSize=100');
  const after = ob.json?.total ?? (ob.json?.messages ?? ob.json?.items ?? []).length;
  ok(ob.status === 200 && after > before, `outbox démo : ${before} → ${after} messages (aucun vrai envoi)`, `après=${after}`);

  const dash = await page(jarA, '/fr/dashboard');
  ok(dash.status === 200, 'page /dashboard (client, 307 suivi)', `status=${dash.status}`);
}

/* ── I. Billing (critère O) ────────────────────────────────────────────── */
section('I. Billing (critère O : webhook signé + idempotent)');
{
  const plans = await api(jarA, 'GET', '/api/organization/plans');
  const planCount = (plans.json?.plans ?? plans.json?.items ?? []).length;
  ok(plans.status === 200 && planCount >= 3, `catalogue plans publics (n=${planCount})`);

  const co = await api(jarA, 'POST', '/api/billing/checkout', { planCode: 'pro', interval: 'monthly' });
  ok(co.status === 201 && co.json?.checkout?.mock === true, 'création checkout (mode mock identifié)', `status=${co.status} ${JSON.stringify(co.json?.error ?? '').slice(0, 120)}`);
  const paymentId = co.json?.checkout?.paymentId;

  const confirm = paymentId ? await api(jarA, 'POST', `/api/billing/checkout/${paymentId}/confirm`) : null;
  ok(confirm && (confirm.status === 200 || confirm.status === 201), 'paiement simulé (confirm → provider)', confirm ? `status=${confirm.status} ${JSON.stringify(confirm.json?.error ?? '').slice(0, 120)}` : 'n/a');

  const payRow = paymentId ? await prisma.payment.findUnique({ where: { id: paymentId }, select: { providerPaymentId: true } }) : null;
  const providerPaymentId = payRow?.providerPaymentId;
  const evtId = `evt_smoke_${stamp}_${crypto.randomBytes(4).toString('hex')}`;
  const payload = JSON.stringify({
    id: evtId, type: 'checkout.succeeded',
    data: { providerPaymentId, planCode: 'pro', interval: 'monthly' },
  });
  const sign = (body) => crypto.createHmac('sha256', WEBHOOK_SECRET).update(body, 'utf8').digest('hex');

  const wh = await raw(null, 'POST', '/api/webhooks/mock', { rawBody: payload, headers: { 'x-mock-signature': sign(payload) } });
  const whj = await wh.json().catch(() => null);
  ok(wh.status === 200, 'webhook signé accepté (HMAC-SHA256)', `status=${wh.status} ${JSON.stringify(whj ?? '').slice(0, 150)}`);

  const whDup = await raw(null, 'POST', '/api/webhooks/mock', { rawBody: payload, headers: { 'x-mock-signature': sign(payload) } });
  const whDupj = await whDup.json().catch(() => null);
  ok(whDup.status === 200 && whDupj?.duplicate === true, 'webhook idempotent (2ᵉ livraison → duplicate:true)', JSON.stringify(whDupj ?? '').slice(0, 120));

  const badSign = await raw(null, 'POST', '/api/webhooks/mock', { rawBody: payload, headers: { 'x-mock-signature': 'faux'.repeat(16) } });
  ok(badSign.status === 401 || badSign.status === 400, 'webhook mal signé → 400 invalid_signature', `status=${badSign.status}`);

  const after = await api(jarA, 'GET', '/api/organization');
  const stAfter = after.json?.subscription?.status;
  ok(stAfter === 'active', `abonnement activé : trialing → active (via webhook seul)`, `après=${stAfter}`);

  const inv = await api(jarA, 'GET', '/api/billing/invoices');
  const invItems = inv.json?.invoices ?? inv.json?.items ?? [];
  ok(inv.status === 200 && invItems.length >= 1, `facture émise par le webhook (n=${invItems.length})`);
  const invPdf = invItems[0] ? await raw(jarA, 'GET', `/api/billing/invoices/${invItems[0].id}/pdf`) : null;
  ok(invPdf && invPdf.status === 200 && (invPdf.headers.get('content-type') ?? '').includes('pdf'), 'facture PDF', invPdf ? `status=${invPdf.status}` : 'n/a');

  const cancel = await api(jarA, 'POST', '/api/billing/cancel', {});
  ok(cancel.status === 200, 'annulation (fin de période)', `status=${cancel.status} ${JSON.stringify(cancel.json?.error ?? '').slice(0, 120)}`);
  // CDC §60 : le statut reste « active » jusqu'à la fin de la période ; le flag cancelAtPeriodEnd porte la décision.
  // L'écran billing lit la vue COMPLÈTE via /api/billing/subscription (l'endpoint /api/organization est allégé).
  const subCancel = (await api(jarA, 'GET', '/api/billing/subscription')).json?.subscription;
  ok(subCancel?.cancelAtPeriodEnd === true && subCancel?.status === 'active', `flag cancelAtPeriodEnd posé, actif jusqu'au ${String(subCancel?.currentPeriodEnd).slice(0, 10)}`);

  const react = await api(jarA, 'POST', '/api/billing/reactivate', {});
  const subReact = (await api(jarA, 'GET', '/api/billing/subscription')).json?.subscription;
  ok(react.status === 200 && subReact?.cancelAtPeriodEnd === false && subReact?.status === 'active', 'réactivation (flag levé, active)');
}

/* ── J. Stats, rapports, livre d’or ────────────────────────────────────── */
section('J. Stats, rapports, livre d’or');
{
  const st = await api(jarA, 'GET', `/api/events/${eventId}/statistics`);
  const k = st.json?.statistics ?? st.json;
  ok(st.status === 200 && k, 'statistiques événement (KPIs)', `status=${st.status}`);

  const gbOff = await api(null, 'POST', `/api/public/events/${eventSlug}/guestbook`, {
    authorName: 'Famille Test', message: 'Bravo aux mariés !',
  });
  ok(gbOff.status === 403 && gbOff.json?.error?.code === 'guestbook_disabled', 'livre d’or désactivé par défaut → 403 explicite (pas d’erreur muette)');

  const gbOn = await api(jarA, 'PATCH', `/api/events/${eventId}`, { optionsJson: { guestbook: true } });
  ok(gbOn.status === 200, 'activation livre d’or (PATCH options, merge)', `status=${gbOn.status} ${JSON.stringify(gbOn.json?.error ?? '').slice(0, 120)}`);

  const gb = await api(null, 'POST', `/api/public/events/${eventSlug}/guestbook`, {
    authorName: 'Famille Test', message: 'Bravo aux mariés !',
  });
  ok(gb.status === 201, 'dépôt livre d’or (public)', `status=${gb.status} ${JSON.stringify(gb.json?.error ?? '').slice(0, 120)}`);

  const gbl = await api(jarA, 'GET', `/api/events/${eventId}/guestbook?page=1`);
  const msgs = gbl.json?.messages ?? gbl.json?.items ?? [];
  ok(gbl.status === 200 && msgs.length >= 1, 'liste livre d’or (modération)', `n=${msgs.length}`);
  const mod = msgs[0] ? await api(jarA, 'PATCH', `/api/events/${eventId}/guestbook/${msgs[0].id}`, { status: 'hidden' }) : null;
  ok(mod && mod.status === 200, 'modération (masqué)', mod ? `status=${mod.status}` : 'n/a');

  const rep = await raw(jarA, 'GET', `/api/events/${eventId}/reports/guests?format=csv`);
  ok(rep.status === 200, 'rapport invités CSV', `status=${rep.status}`);
  const repPdf = await raw(jarA, 'GET', `/api/events/${eventId}/reports/guests?format=pdf`);
  ok(repPdf.status === 200 && (repPdf.headers.get('content-type') ?? '').includes('pdf'), 'rapport invités PDF', `status=${repPdf.status}`);
}

/* ── K. IA & crédits ───────────────────────────────────────────────────── */
section('K. IA & crédits');
{
  const u0 = await api(jarA, 'GET', '/api/ai/usage?page=1');
  ok(u0.status === 200 && (u0.json?.items !== undefined), 'GET /api/ai/usage (historique + mois)', `status=${u0.status}`);

  const txt = await api(jarA, 'POST', '/api/ai/generate', { kind: 'text', prompt: 'Écris un texte d’invitation romantique pour un mariage' });
  ok(txt.status === 200 && Boolean(txt.json?.text || txt.json?.copy), 'génération texte IA (mock déterministe)', `status=${txt.status} ${JSON.stringify(txt.json?.error ?? '').slice(0, 120)}`);

  const des = await api(jarA, 'POST', '/api/ai/generate', { kind: 'design', prompt: 'une palette dorée et bordeaux', eventId });
  ok(des.status === 200, 'génération design IA (proposition éditée)', `status=${des.status} ${JSON.stringify(des.json?.error ?? '').slice(0, 120)}`);

  const failGen = await api(jarA, 'POST', '/api/ai/generate', { kind: 'text', prompt: '#fail test d’échec fournisseur' });
  ok(failGen.status === 502, 'échec fournisseur simulé → 502', `status=${failGen.status}`);

  const u1 = await api(jarA, 'GET', '/api/ai/usage?page=1');
  const m = u1.json?.month;
  ok(u1.status === 200 && Number(m?.refunded) > 0, `crédit remboursé après échec (month.refunded=${m?.refunded}, consumed=${m?.consumed})`);
}

/* ── L. Super admin ────────────────────────────────────────────────────── */
section('L. Super admin (panneau complet)');
const jarAdmin = makeJar();
{
  const lg = await api(jarAdmin, 'POST', '/api/auth/login', { email: 'admin@eventflow.app', password: 'EventFlow#2026!' });
  ok(lg.status === 200 && lg.json?.redirect === '/admin', 'login super admin → redirect /admin', `status=${lg.status}`);

  const dash = await api(jarAdmin, 'GET', '/api/admin/dashboard');
  ok(dash.status === 200 && dash.json?.ok, 'GET /api/admin/dashboard (KPIs plateforme)');
  const ana = await api(jarAdmin, 'GET', '/api/admin/analytics');
  ok(ana.status === 200, 'GET /api/admin/analytics (6 mois)');

  for (const [p, label] of [
    ['/api/admin/users?page=1', 'utilisateurs'],
    ['/api/admin/organizations?page=1', 'organisations'],
    ['/api/admin/events?page=1', 'événements'],
    ['/api/admin/subscriptions?page=1', 'abonnements'],
    ['/api/admin/payments?page=1', 'paiements'],
    ['/api/admin/templates?page=1', 'templates plateforme'],
    ['/api/admin/logs?page=1', 'journal d’activité'],
  ]) {
    const r = await api(jarAdmin, 'GET', p);
    ok(r.status === 200, `GET ${label}`, `status=${r.status}`);
  }

  const code = `smoke_${stamp}`;
  const pc = await api(jarAdmin, 'POST', '/api/admin/plans', {
    code, name: 'Plan Smoke', description: 'plan de test', trialDays: 3,
    limits: { events: 2, guestsPerEvent: 50 },
    features: { premiumTemplates: false },
    prices: [{ currency: 'USD', amountMinor: 1999, interval: 'monthly' }],
  });
  ok(pc.status === 201 || pc.status === 200, 'POST plan (création)', `status=${pc.status} ${JSON.stringify(pc.json?.error ?? '').slice(0, 120)}`);
  const pid = pc.json?.plan?.id;
  const pu = pid ? await api(jarAdmin, 'PUT', `/api/admin/plans/${pid}`, { name: 'Plan Smoke modifié' }) : null;
  ok(pu && pu.status === 200, 'PUT plan (édition — quotas immédiats)', pu ? `status=${pu.status}` : 'n/a');
  const pa = pid ? await api(jarAdmin, 'POST', `/api/admin/plans/${pid}/archive`) : null;
  ok(pa && pa.status === 200, 'archivage plan', pa ? `status=${pa.status}` : 'n/a');
  const conflict = await api(jarAdmin, 'POST', '/api/admin/plans', {
    code, name: 'Doublon', description: 'x', trialDays: 1, limits: {}, features: {}, prices: [],
  });
  ok(conflict.status === 409, 'code de plan déjà pris → 409 plan_exists', `status=${conflict.status}`);

  const pages = ['admin', 'admin/users', 'admin/organizations', 'admin/events', 'admin/subscriptions', 'admin/payments', 'admin/plans', 'admin/templates', 'admin/ai-credits', 'admin/logs', 'admin/analytics'];
  const badPages = [];
  for (const p of pages) {
    const r = await page(jarAdmin, `/fr/${p}`);
    if (r.status !== 200) badPages.push(`${p}=${r.status}`);
  }
  ok(badPages.length === 0, `11 pages /admin/* rendues (200, 307 suivis)`, badPages.join(', '));

  const forbidden = await api(jarA, 'GET', '/api/admin/dashboard');
  ok(forbidden.status === 403, 'garde super admin : user normal → 403', `status=${forbidden.status}`);
}

/* ── M. i18n & pages d’erreur ──────────────────────────────────────────── */
section('M. i18n & pages d’erreur');
{
  const enLogin = await page(null, '/en/login');
  ok(enLogin.status === 200 && /login|sign in/i.test(enLogin.html), 'page login EN rendue', `status=${enLogin.status}`);
  const enDash = await page(jarA, '/en/dashboard');
  ok(enDash.status === 200, 'page /en/dashboard (client EN)', `status=${enDash.status}`);
  const nf = await page(jarA, '/une-page-inexistante');
  ok(nf.status === 404 && nf.len > 200, '404 explicite (pas de page blanche)', `status=${nf.status} len=${nf.len}`);
  const nfRoot = await page(null, '/zz/quoi');
  ok(nfRoot.status === 404, 'locale inconnue → 404', `status=${nfRoot.status}`);
}

/* ── Résumé ────────────────────────────────────────────────────────────── */
console.log(`\n════════════════ RÉSUMÉ ════════════════`);
console.log(`✅ ${pass} succès   ❌ ${fail} échecs`);
if (failures.length) {
  console.log('\nÉchecs :');
  for (const f of failures) console.log(`  • ${f}`);
}
await prisma.$disconnect();
process.exit(fail > 0 ? 1 : 0);
