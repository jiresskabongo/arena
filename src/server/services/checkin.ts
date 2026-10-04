import { prisma } from '@/lib/prisma';
import { tenantWhere, TenantError, type TenantContext } from '@/server/services/tenant';
import { getEventForOrg } from '@/server/services/event';
import { logActivity } from '@/server/services/activity';
import { generateSecureToken } from '@/lib/crypto';
import type { Prisma } from '@prisma/client';

/**
 * Check-in & contrôle d'accès (CDC §25–28).
 * - Agent de scan (`ScannerAgent` + token opaque) : autorisé sur UN événement
 * - `scan(token, agent, entryPoint, clientUuid)` transactionnel, idempotent par clientUuid
 * - Anti-réutilisation : 2e scan = already_used (sauf allowMultipleEntries)
 * - Hors ligne : pré-sync (GET /api/scanner/sync) + replay batch (POST), même règles
 */

export type ScanStatus = 'valid' | 'already_used' | 'invalid' | 'expired';

export interface ScanGuestInfo {
  firstName: string;
  lastName: string;
  name: string;
  category: string;
  tableName: string | null;
  photoUrl: string | null;
}

export interface ScanResult {
  status: ScanStatus;
  reason?: string; // unknown_token | token_revoked | token_expired | agent_denied | event_not_published
  guest?: ScanGuestInfo;
  welcome: string | null;
  meta?: {
    checkedInAt: string;
    firstCheckedInAt?: string;
    entryPoint: string;
    first: boolean;
    allowMultipleEntries: boolean;
    offline?: boolean;
  };
}

export const ENTRY_POINTS = ['entrance', 'vip', 'staff', 'family', 'custom'] as const;
export type EntryPoint = (typeof ENTRY_POINTS)[number];

export interface AgentPermissions {
  canViewPhoto: boolean;
  canSearch: boolean;
  canSeeHistory: boolean;
}

function parsePermissions(json: string): AgentPermissions {
  try {
    const p = JSON.parse(json) as Partial<AgentPermissions>;
    return {
      canViewPhoto: Boolean(p.canViewPhoto),
      canSearch: Boolean(p.canSearch),
      canSeeHistory: Boolean(p.canSeeHistory),
    };
  } catch {
    return { canViewPhoto: false, canSearch: false, canSeeHistory: false };
  }
}

// ─────────────────────────── Agents (tenant) ───────────────────────────

export async function createScannerAgent(
  ctx: TenantContext,
  eventId: string,
  input: {
    name: unknown;
    entryPoint?: unknown;
    permissions?: Partial<AgentPermissions>;
    userId?: string | null;
  },
  ip: string | null = null,
) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length < 2 || name.length > 60) {
    throw new TenantError(400, 'agent_name_invalid', 'Nom de l’agent invalide (2–60 caractères).');
  }
  const entryPoint = ENTRY_POINTS.includes(input.entryPoint as EntryPoint)
    ? (input.entryPoint as EntryPoint)
    : 'entrance';
  const permissions: AgentPermissions = {
    canViewPhoto: Boolean(input.permissions?.canViewPhoto),
    canSearch: Boolean(input.permissions?.canSearch),
    canSeeHistory: Boolean(input.permissions?.canSeeHistory),
  };

  const agent = await prisma.scannerAgent.create({
    data: {
      eventId: event.id,
      organizationId: orgId,
      userId: input.userId ?? null,
      name,
      entryPoint,
      permissionsJson: JSON.stringify(permissions),
      token: generateSecureToken(32),
      active: true,
    },
  });

  await logActivity({
    organizationId: orgId,
    userId: ctx.user.id,
    action: 'scanner_agent.create',
    entity: 'event',
    entityId: event.id,
    meta: { agentId: agent.id, entryPoint },
    ip,
  });

  return {
    id: agent.id,
    name: agent.name,
    entryPoint: agent.entryPoint,
    permissions,
    active: agent.active,
    token: agent.token,
    scannerUrl: `/scanner/${agent.token}`,
  };
}

export async function listScannerAgents(ctx: TenantContext, eventId: string) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');

  const agents = await prisma.scannerAgent.findMany({
    where: { eventId: event.id },
    orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
  });
  return agents.map((a) => ({
    id: a.id,
    name: a.name,
    entryPoint: a.entryPoint,
    permissions: parsePermissions(a.permissionsJson),
    active: a.active,
    userId: a.userId,
    createdAt: a.createdAt.toISOString(),
    scannerUrl: `/scanner/${a.token}`,
  }));
}

export async function setScannerAgentActive(
  ctx: TenantContext,
  agentId: string,
  active: boolean,
  ip: string | null = null,
) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const agent = await prisma.scannerAgent.findFirst({
    where: { id: agentId, ...tenantWhere(orgId) },
  });
  if (!agent) throw new TenantError(404, 'agent_not_found', 'Agent introuvable.');
  const updated = await prisma.scannerAgent.update({
    where: { id: agent.id },
    data: { active },
  });
  await logActivity({
    organizationId: orgId,
    userId: ctx.user.id,
    action: active ? 'scanner_agent.activate' : 'scanner_agent.deactivate',
    entity: 'scanner_agent',
    entityId: agent.id,
    meta: { eventId: agent.eventId },
    ip,
  });
  return { id: updated.id, active: updated.active };
}

// ─────────────────────────── Cœur du scan (§9.4) ───────────────────────────

interface ScanCoreArgs {
  agent: { id: string; eventId: string; entryPoint: string; active: boolean; permissions: AgentPermissions };
  token: string;
  entryPoint: string;
  deviceId: string | null;
  clientUuid: string;
  clientAt: Date;
}

function guestInfo(guest: {
  firstName: string; lastName: string; category: string;
  table?: { name: string } | null;
}): ScanGuestInfo {
  return {
    firstName: guest.firstName,
    lastName: guest.lastName,
    name: `${guest.firstName} ${guest.lastName}`,
    category: guest.category,
    tableName: guest.table?.name ?? null,
    photoUrl: null, // champ photo absent du modèle Guest (réservation §13)
  };
}

/**
 * Exécute les règles de scan (CDC §9.4). Idempotent par `clientUuid`.
 * `clientAt` = heure du scan côté agent (préserve l'horodatage en replay hors ligne).
 */
async function runScanCore(args: ScanCoreArgs): Promise<ScanResult> {
  const { agent, token, entryPoint, clientUuid, clientAt } = args;

  // Idempotence offline : même clientUuid → même résultat, aucune écriture
  const replay = await prisma.checkIn.findUnique({
    where: { clientUuid },
    include: { guest: { include: { table: true } }, invitation: { include: { event: true } } },
  });
  if (replay) {
    return {
      status: replay.result as ScanStatus,
      guest: guestInfo(replay.guest),
      welcome: replay.invitation.event.welcomeMessage,
      meta: {
        checkedInAt: replay.checkedInAt.toISOString(),
        entryPoint: replay.entryPoint ?? entryPoint,
        first: replay.result === 'valid',
        allowMultipleEntries: replay.invitation.event.allowMultipleEntries,
        offline: true,
      },
    };
  }

  const resultBase = { welcome: null as string | null };

  // 1. Agent actif sur l'événement concerné
  if (!agent.active) {
    await logScan('scan.invalid', agent, null, { reason: 'agent_denied' }, args.deviceId);
    return { status: 'invalid', reason: 'agent_denied', welcome: null };
  }

  // 2. Résolution du token → invitation → événement
  const row = await prisma.invitationToken.findUnique({
    where: { token },
    include: {
      invitation: {
        include: {
          guest: { include: { table: true } },
          event: true,
        },
      },
    },
  });
  if (!row) {
    await logScan('scan.invalid', agent, null, { reason: 'unknown_token' }, args.deviceId);
    return { status: 'invalid', reason: 'unknown_token', welcome: null };
  }
  const invitation = row.invitation;
  const event = invitation.event;

  // 3. L'agent doit être autorisé sur CE événement
  if (agent.eventId !== event.id) {
    await logScan('scan.invalid', agent, invitation.id, { reason: 'agent_denied' }, args.deviceId);
    return { status: 'invalid', reason: 'agent_denied', welcome: null };
  }
  resultBase.welcome = event.welcomeMessage;

  // 4. Statut / expiration
  if (row.revokedAt) {
    await upsertCheckIn({
      eventId: event.id, organizationId: event.organizationId, invitationId: invitation.id,
      guestId: invitation.guestId, scannerAgentId: agent.id, entryPoint,
      deviceId: args.deviceId, result: 'invalid', clientUuid, checkedInAt: clientAt,
    });
    return { status: 'invalid', reason: 'token_revoked', guest: guestInfo(invitation.guest), welcome: event.welcomeMessage };
  }
  if (row.expiresAt && row.expiresAt < new Date()) {
    await upsertCheckIn({
      eventId: event.id, organizationId: event.organizationId, invitationId: invitation.id,
      guestId: invitation.guestId, scannerAgentId: agent.id, entryPoint,
      deviceId: args.deviceId, result: 'expired', clientUuid, checkedInAt: clientAt,
    });
    return { status: 'expired', reason: 'token_expired', guest: guestInfo(invitation.guest), welcome: event.welcomeMessage };
  }
  if (event.status !== 'published') {
    await upsertCheckIn({
      eventId: event.id, organizationId: event.organizationId, invitationId: invitation.id,
      guestId: invitation.guestId, scannerAgentId: agent.id, entryPoint,
      deviceId: args.deviceId, result: 'invalid', clientUuid, checkedInAt: clientAt,
    });
    return { status: 'invalid', reason: 'event_not_published', guest: guestInfo(invitation.guest), welcome: event.welcomeMessage };
  }

  const guest = invitation.guest;
  const now = clientAt < new Date() ? clientAt : new Date();

  // 5. Anti-réutilisation
  if (guest.checkedInAt) {
    if (event.allowMultipleEntries) {
      await prisma.$transaction([
        prisma.guest.update({ where: { id: guest.id }, data: { checkedInAt: now, presenceStatus: 'present' } }),
      ]);
      await upsertCheckIn({
        eventId: event.id, organizationId: event.organizationId, invitationId: invitation.id,
        guestId: guest.id, scannerAgentId: agent.id, entryPoint,
        deviceId: args.deviceId, result: 'valid', clientUuid, checkedInAt: now,
      });
      await logScan('scan.valid', agent, invitation.id, { entryPoint, multi: true }, args.deviceId);
      return {
        status: 'valid',
        guest: guestInfo(guest),
        welcome: event.welcomeMessage,
        meta: {
          checkedInAt: now.toISOString(),
          firstCheckedInAt: guest.checkedInAt.toISOString(),
          entryPoint,
          first: false,
          allowMultipleEntries: true,
        },
      };
    }
    // Pas d'écriture CheckIn (guestId @unique) : l'audit passe par ActivityLog.
    // Re-scan = même résultat → idempotence sans état.
    await logScan('scan.already_used', agent, invitation.id, { entryPoint }, args.deviceId);
    return {
      status: 'already_used',
      guest: guestInfo(guest),
      welcome: event.welcomeMessage,
      meta: {
        checkedInAt: now.toISOString(),
        firstCheckedInAt: guest.checkedInAt.toISOString(),
        entryPoint,
        first: false,
        allowMultipleEntries: false,
      },
    };
  }

  // 6. Premier passage : check-in
  await prisma.guest.update({
    where: { id: guest.id },
    data: { checkedInAt: now, presenceStatus: 'present' },
  });
  await upsertCheckIn({
    eventId: event.id, organizationId: event.organizationId, invitationId: invitation.id,
    guestId: guest.id, scannerAgentId: agent.id, entryPoint,
    deviceId: args.deviceId, result: 'valid', clientUuid, checkedInAt: now,
  });
  await logScan('scan.valid', agent, invitation.id, { entryPoint }, args.deviceId);
  return {
    status: 'valid',
    guest: guestInfo(guest),
    welcome: event.welcomeMessage,
    meta: {
      checkedInAt: now.toISOString(),
      entryPoint,
      first: true,
      allowMultipleEntries: false,
    },
  };
}

/**
 * Une seule ligne CheckIn par invité (`guestId @unique`) = état courant.
 * Chaque scan écrit (ou met à jour) cette ligne ; les « déjà utilisé » sont
 * audités via ActivityLog uniquement (résultat stable au replay : re-scan →
 * déjà utilisé, aucune écriture).
 */
async function upsertCheckIn(args: {
  eventId: string;
  organizationId: string;
  invitationId: string;
  guestId: string;
  scannerAgentId: string | null;
  entryPoint: string;
  deviceId: string | null;
  result: 'valid' | 'invalid' | 'expired';
  clientUuid: string;
  checkedInAt: Date;
}) {
  try {
    await prisma.checkIn.upsert({
      where: { guestId: args.guestId },
      create: { ...args },
      update: {
        result: args.result,
        checkedInAt: args.checkedInAt,
        entryPoint: args.entryPoint,
        scannerAgentId: args.scannerAgentId,
        deviceId: args.deviceId,
        clientUuid: args.clientUuid,
      },
    });
  } catch (e) {
    // Conflit d'unicité (clientUuid écrité entre-temps par un scan concurrent)
    // → on rejoue la lecture idempotente.
    if (e instanceof Error && 'code' in e && (e as { code?: string }).code === 'P2002') {
      await prisma.checkIn.findUnique({ where: { clientUuid: args.clientUuid } });
    } else {
      throw e;
    }
  }
}

async function logScan(
  action: string,
  agent: { id: string; eventId: string },
  invitationId: string | null,
  meta: Record<string, unknown>,
  deviceId: string | null,
) {
  const event = await prisma.event.findUnique({ where: { id: agent.eventId }, select: { organizationId: true } });
  if (!event) return;
  await logActivity({
    organizationId: event.organizationId,
    userId: null,
    action,
    entity: invitationId ? 'invitation' : 'event',
    entityId: invitationId ?? agent.eventId,
    meta: { scannerAgentId: agent.id, deviceId: deviceId ?? undefined, ...meta },
  }).catch(() => {});
}

// ─────────────────────────── Routes publiques (agent token) ───────────────────────────

async function resolveAgent(agentToken: string) {
  if (!/^[0-9A-Za-z]{16,80}$/.test(agentToken)) return null;
  const agent = await prisma.scannerAgent.findUnique({ where: { token: agentToken } });
  if (!agent || !agent.active) return null;
  return {
    id: agent.id,
    eventId: agent.eventId,
    entryPoint: agent.entryPoint,
    active: agent.active,
    permissions: parsePermissions(agent.permissionsJson),
    name: agent.name,
  };
}

/** Scan en ligne (agent authentifié par token opaque). */
export async function scanCheckIn(
  agentToken: string,
  input: {
    token: unknown;
    entryPoint?: unknown;
    deviceId?: unknown;
    clientUuid?: unknown;
    clientAt?: unknown;
  },
  ip: string | null = null,
): Promise<ScanResult> {
  const agent = await resolveAgent(agentToken);
  if (!agent) return { status: 'invalid', reason: 'agent_denied', welcome: null };

  const token = typeof input.token === 'string' ? input.token.trim() : '';
  const entryPoint =
    typeof input.entryPoint === 'string' && input.entryPoint.length <= 20
      ? input.entryPoint
      : agent.entryPoint;
  const clientUuid =
    typeof input.clientUuid === 'string' && input.clientUuid.length >= 8 && input.clientUuid.length <= 64
      ? input.clientUuid
      : generateSecureToken(24);
  const clientAt =
    typeof input.clientAt === 'string' && !Number.isNaN(Date.parse(input.clientAt))
      ? new Date(input.clientAt)
      : new Date();

  const result = await runScanCore({ agent, token, entryPoint, deviceId: typeof input.deviceId === 'string' ? input.deviceId.slice(0, 64) : null, clientUuid, clientAt });
  void ip;
  return result;
}

/** Pré-synchronisation hors ligne (CDC §28.1). */
export async function scannerSyncOut(agentToken: string, since?: string) {
  const agent = await resolveAgent(agentToken);
  if (!agent) return null;
  const event = await prisma.event.findUnique({ where: { id: agent.eventId } });
  if (!event) return null;

  const sinceDate = since ? new Date(since) : null;
  // Invitations actives de l'événement (plafond 2000 pour la sync initiale)
  const rows = await prisma.invitation.findMany({
    where: { eventId: event.id, token: { revokedAt: null } },
    include: {
      token: { select: { token: true, expiresAt: true } },
      guest: { select: { firstName: true, lastName: true, category: true, rsvpStatus: true, checkedInAt: true, companions: true } },
    },
    orderBy: { id: 'asc' },
    take: 2000,
  });

  return {
    eventId: event.id,
    eventName: event.name,
    entryPoint: agent.entryPoint,
    allowMultipleEntries: event.allowMultipleEntries,
    eventPublished: event.status === 'published',
    eventEnd: (event.endTime
      ? new Date(`${event.date.toISOString().slice(0, 10)}T${event.endTime}:00Z`)
      : event.date).toISOString(),
    syncedAt: new Date().toISOString(),
    invitations: rows
      .filter((r) => {
        if (sinceDate) {
          const touched = r.guest.checkedInAt ?? new Date(0);
          return touched >= sinceDate;
        }
        return true;
      })
      .map((r) => ({
        token: r.token!.token,
        invitationId: r.id,
        guest: {
          name: `${r.guest.firstName} ${r.guest.lastName}`,
          category: r.guest.category,
          rsvpStatus: r.guest.rsvpStatus,
          companions: r.guest.companions,
        },
        checkedInAt: r.guest.checkedInAt ? r.guest.checkedInAt.toISOString() : null,
        expiresAt: r.token!.expiresAt ? r.token!.expiresAt.toISOString() : null,
      })),
  };
}

/** Replay hors ligne (CDC §28.5) : rejoue chaque scan en ligne (idempotent par clientUuid). */
export async function syncScans(
  agentToken: string,
  input: {
    scans?: unknown;
  },
  ip: string | null = null,
): Promise<{ synced: number; results: { clientUuid: string; status: ScanStatus }[] }> {
  const agent = await resolveAgent(agentToken);
  if (!agent) throw new TenantError(403, 'agent_denied', 'Agent inconnu ou désactivé.');

  const scans = Array.isArray(input.scans) ? input.scans : [];
  if (scans.length > 200) throw new TenantError(400, 'sync_batch_invalid', 'Maximum 200 scans par batch.');

  const results: { clientUuid: string; status: ScanStatus }[] = [];
  for (const s of scans) {
    if (typeof s !== 'object' || s === null) continue;
    const o = s as Record<string, unknown>;
    const clientUuid =
      typeof o.clientUuid === 'string' && o.clientUuid.length >= 8 && o.clientUuid.length <= 64
        ? o.clientUuid
        : generateSecureToken(24);
    const res = await scanCheckIn(agentToken, {
      token: o.token,
      entryPoint: o.entryPoint,
      deviceId: o.deviceId,
      clientUuid,
      clientAt: o.clientAt,
    });
    void ip;
    results.push({ clientUuid, status: res.status });
  }
  return { synced: results.length, results };
}

// ─────────────────────────── Historique (tenant) ───────────────────────────

export async function listCheckIns(
  ctx: TenantContext,
  eventId: string,
  q: { page?: number; pageSize?: number; search?: string; result?: string; entryPoint?: string },
) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');

  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, q.pageSize ?? 25));
  const where: Prisma.CheckInWhereInput = {
    eventId: event.id,
    organizationId: orgId,
    ...(q.result && q.result !== 'all' ? { result: q.result } : {}),
    ...(q.entryPoint ? { entryPoint: q.entryPoint } : {}),
    ...(q.search
      ? {
          guest: {
            OR: [
              { firstName: { contains: q.search } },
              { lastName: { contains: q.search } },
              { email: { contains: q.search } },
              { phone: { contains: q.search } },
            ],
          },
        }
      : {}),
  };

  const [items, total, presentCount] = await Promise.all([
    prisma.checkIn.findMany({
      where,
      include: {
        guest: { select: { firstName: true, lastName: true, category: true } },
        scannerAgent: { select: { name: true, entryPoint: true } },
      },
      orderBy: { checkedInAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.checkIn.count({ where }),
    prisma.guest.count({ where: { eventId: event.id, presenceStatus: 'present' } }),
  ]);

  return {
    items: items.map((c) => ({
      id: c.id,
      guest: {
        firstName: c.guest.firstName,
        lastName: c.guest.lastName,
        category: c.guest.category,
      },
      result: c.result,
      entryPoint: c.entryPoint,
      scannerAgent: c.scannerAgent ? c.scannerAgent.name : null,
      checkedInAt: c.checkedInAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    presentCount,
  };
}
