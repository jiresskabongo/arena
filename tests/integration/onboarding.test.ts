/**
 * Tests d'intégration Phase 4 : onboarding, création d'événement (quotas),
 * invités, invitations équipe + acceptation à l'inscription (critère P).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { register } from '@/server/services/account';
import {
  getOnboarding, setOnboardingStep, completeOnboarding,
} from '@/server/services/onboarding';
import { createEvent, listEvents } from '@/server/services/event';
import { addGuest } from '@/server/services/guest';
import { inviteMember, listMembers, changeMemberRole, removeMember } from '@/server/services/team';
import { tenantWhere, TenantError, type TenantContext } from '@/server/services/tenant';

const stamp = Date.now().toString(36);
const emailOwner = `p4own.${stamp}@exemple.cd`;
const emailInvitee = `p4inv.${stamp}@exemple.cd`;
const emailStranger = `p4str.${stamp}@exemple.cd`;

let ownerId: string;
let orgId: string;
const createdEvents: string[] = [];
const createdGuests: string[] = [];
const createdMembers: string[] = [];
const createdUsers: string[] = [];

function ctxFor(orgId: string, userId: string): TenantContext {
  return {
    user: {
      id: userId, email: 'x@y.z', firstName: 'X', lastName: 'Y', passwordHash: '',
      locale: 'fr', currency: 'USD', timezone: 'Africa/Kinshasa', isSuperAdmin: false,
      emailVerifiedAt: null,
    } as never,
    isSuperAdmin: false,
    organization: {
      id: orgId, name: 'P4', slug: 'p4', currency: 'USD', locale: 'fr',
      timezone: 'Africa/Kinshasa', isActive: true,
    },
    role: 'owner',
  };
}

afterAll(async () => {
  for (const g of createdGuests) await prisma.guest.delete({ where: { id: g } }).catch(() => {});
  for (const e of createdEvents) await prisma.event.delete({ where: { id: e } }).catch(() => {});
  for (const u of createdUsers) await prisma.user.delete({ where: { id: u } }).catch(() => {});
  for (const o of [orgId]) await prisma.organization.delete({ where: { id: o } }).catch(() => {});
  await prisma.$disconnect();
});

describe('onboarding (flux A)', () => {
  it('inscription → état onboarding step 1, puis avancement et complétion', async () => {
    const res = await register(
      { email: emailOwner, password: 'Event1234', firstName: 'Owne', lastName: 'P4', organizationName: `P4 Org ${stamp}` },
      null,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    ownerId = res.data.userId;
    orgId = res.data.organizationId;
    createdUsers.push(ownerId);

    let state = await getOnboarding(ownerId);
    expect(state.currentStep).toBe(1);
    expect(state.stepKey).toBe('welcome');
    expect(state.completed).toBe(false);

    state = await setOnboardingStep(ownerId, 3);
    expect(state.currentStep).toBe(3);
    expect(state.stepKey).toBe('first_event');

    state = await setOnboardingStep(ownerId, 2); // retour arrière autorisé
    expect(state.currentStep).toBe(2);

    state = await completeOnboarding(ownerId);
    expect(state.completed).toBe(true);
    expect(state.currentStep).toBe(7);

    // Étape invalide → erreur
    await expect(setOnboardingStep(ownerId, 99)).rejects.toThrow('onboarding_step_invalid');
  });
});

describe('création d’événement + quotas (CDC §10/§59)', () => {
  it('crée le premier événement (starter = 1) et bloque le second', async () => {
    const first = await createEvent(ctxFor(orgId, ownerId), {
      name: `Test Wedding ${stamp}`,
      typeCode: 'wedding',
      date: '2027-06-12',
      startTime: '15:00',
      venue: 'Salle Test',
      city: 'Kinshasa',
    });
    expect(first.id).toBeTruthy();
    expect(first.slug).toContain('test-wedding');
    createdEvents.push(first.id);

    // Quota starter = 1 événement → le 2nd est bloqué (403 quota_exceeded)
    await expect(
      createEvent(ctxFor(orgId, ownerId), {
        name: 'Second Event', typeCode: 'party', date: '2027-07-12', startTime: '19:00', venue: 'X',
        timezone: 'Africa/Kinshasa', optionsJson: {},
      }),
    ).rejects.toMatchObject({ code: 'quota_exceeded' });
  });

  it('liste paginée : total, KPIs, page', async () => {
    const page1 = await listEvents(orgId, 1, 10);
    expect(page1.total).toBe(1);
    expect(page1.totalPages).toBe(1);
    expect(page1.items[0].name).toContain('Test Wedding');
    expect(page1.items[0].guests).toBe(0);

    // Autre org → 0 (isolement)
    const foreign = await listEvents('nonexistent-org-id', 1, 10);
    expect(foreign.total).toBe(0);
  });
});

describe('invités (quota par événement)', () => {
  it('ajoute un invité à l’événement du tenant', async () => {
    const event = await prisma.event.findFirst({ where: tenantWhere(orgId) });
    if (!event) throw new Error('event manquant');

    const g = await addGuest(ctxFor(orgId, ownerId), event.id, {
      firstName: 'Jean', lastName: 'Dupont', email: '', category: 'famille',
    });
    expect(g.id).toBeTruthy();
    createdGuests.push(g.id);

    // Événement d'une autre org → 404
    await expect(
      addGuest(ctxFor(orgId, ownerId), 'event-autre-org', { firstName: 'A', lastName: 'B' }),
    ).rejects.toMatchObject({ code: 'event_not_found' });
  });
});

describe('équipe : invitations & rôles (CDC §12)', () => {
  it('invite un membre (e-mail mock + quota collaborateurs)', async () => {
    const m = await inviteMember(ctxFor(orgId, ownerId), { email: emailInvitee, role: 'designer' });
    expect(m.role).toBe('designer');
    createdMembers.push(m.id);

    const log = await prisma.messageLog.findFirst({
      where: { organizationId: orgId, templateKey: 'invite_member' },
    });
    expect(log).not.toBeNull();

    const members = await listMembers(ctxFor(orgId, ownerId));
    expect(members).toHaveLength(2); // owner + invité
    expect(members.find((x) => x.email === emailInvitee)?.status).toBe('invited');
  });

  it('refuse : doublon, e-mail avec compte existant, rôle owner', async () => {
    // Doublon (même e-mail déjà invité)
    await expect(
      inviteMember(ctxFor(orgId, ownerId), { email: emailInvitee, role: 'viewer' }),
    ).rejects.toMatchObject({ code: 'member_exists' });

    // E-mail avec compte existant
    await expect(
      inviteMember(ctxFor(orgId, ownerId), { email: emailOwner, role: 'viewer' }),
    ).rejects.toMatchObject({ code: 'account_exists' });

    // Rôle owner interdit via l'API
    const parsed = { email: emailStranger, role: 'owner' as const };
    // (le schéma zod n'accepte pas owner — vérif au niveau service)
    await expect(changeMemberRole(ctxFor(orgId, ownerId), 'nimporte', 'owner')).rejects.toMatchObject({
      code: 'invalid_role',
    });
    void parsed;
  });

  it("acceptation de l'invitation À L'INSCRIPTION (une org par compte)", async () => {
    const before = await prisma.organization.count({
      where: { name: { startsWith: 'P4 Org' } },
    });

    const res = await register(
      { email: emailInvitee, password: 'Event1234', firstName: 'Invi', lastName: 'P4', organizationName: 'Ne doit pas être créée' },
      null,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.joinedInvite).toBe(true);
    expect(res.data.organizationId).toBe(orgId); // rejoint l'org invitante
    createdUsers.push(res.data.userId);

    const after = await prisma.organization.count({
      where: { name: { startsWith: 'P4 Org' } },
    });
    expect(after).toBe(before); // pas de 2e org créée

    // La membership a été transférée
    const member = await prisma.organizationMember.findUnique({ where: { userId: res.data.userId } });
    expect(member?.organizationId).toBe(orgId);
    expect(member?.role).toBe('designer');
    expect(member?.status).toBe('active');

    // L'org compte bien owner + invité actif (le quota collaborator starter = 2 est atteint)
    const members = await listMembers(ctxFor(orgId, ownerId));
    expect(members.length).toBe(2);

    // Quota collaborateurs atteint → une 3e invitation est bloquée (CDC §59)
    await expect(
      inviteMember(ctxFor(orgId, ownerId), { email: emailStranger, role: 'scanner' }),
    ).rejects.toMatchObject({ code: 'quota_exceeded' });
  });

  it('changement de rôle + retrait (protections owner/self)', async () => {
    // Le membre designer (l'invité qui a rejoint) → manager
    const inviteeMember = await prisma.organizationMember.findUnique({ where: { userId: createdUsers[1] } });
    expect(inviteeMember).not.toBeNull();

    await changeMemberRole(ctxFor(orgId, ownerId), inviteeMember!.id, 'manager');
    const updated = await prisma.organizationMember.findUnique({ where: { id: inviteeMember!.id } });
    expect(updated?.role).toBe('manager');

    // Propriétaire : rôle non modifiable (owner_protected)
    const owner = await prisma.organizationMember.findFirst({
      where: { organizationId: orgId, role: 'owner' },
    });
    await expect(changeMemberRole(ctxFor(orgId, ownerId), owner!.id, 'manager')).rejects.toMatchObject({
      code: 'owner_protected',
    });

    // Auto-retrait → interdit ici
    await expect(removeMember(ctxFor(orgId, ownerId), owner!.id)).rejects.toMatchObject({
      code: 'self_removal',
    });

    // Retrait normal (le manager) → libère une place de quota
    await removeMember(ctxFor(orgId, ownerId), inviteeMember!.id);
    const removed = await prisma.organizationMember.findUnique({ where: { id: inviteeMember!.id } });
    expect(removed?.status).toBe('removed');

    // Et une invitation redevient possible (quota libéré)
    const m3 = await inviteMember(ctxFor(orgId, ownerId), { email: emailStranger, role: 'scanner' });
    createdMembers.push(m3.id);
    expect(m3.role).toBe('scanner');
  });
});
