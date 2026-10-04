/**
 * Tests d'intégration Phase 5 : CRUD événement, machine à états,
 * politique de suppression, duplication + quota, personnes, page
 * publique, livre d'or (critère C).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { register } from '@/server/services/account';
import {
  createEvent, updateEvent, setEventStatus, deleteEvent, duplicateEvent,
  addEventMember, updateEventMember, removeEventMember, listEventMembers,
  getPublicEvent, postGuestbook,
} from '@/server/services/event';
import { TenantError, type TenantContext } from '@/server/services/tenant';

const stamp = Date.now().toString(36);
const email = `p5own.${stamp}@exemple.cd`;

let ownerId: string;
let orgId: string;
let eventId: string;
let eventSlug: string;

function ctx(): TenantContext {
  return {
    user: {
      id: ownerId, email, firstName: 'P5', lastName: 'Own', passwordHash: '',
      locale: 'fr', currency: 'USD', timezone: 'Africa/Kinshasa', isSuperAdmin: false,
      emailVerifiedAt: null,
    } as never,
    isSuperAdmin: false,
    organization: {
      id: orgId, name: 'P5', slug: 'p5', currency: 'USD', locale: 'fr',
      timezone: 'Africa/Kinshasa', isActive: true,
    },
    role: 'owner',
  };
}

afterAll(async () => {
  await prisma.event.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
  await prisma.user.delete({ where: { id: ownerId } }).catch(() => {});
  await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
  await prisma.$disconnect();
});

describe('CRUD événement (CDC §10)', () => {
  it('crée, met à jour (nom → nouveau slug, options fusionnées)', async () => {
    const reg = await register(
      { email, password: 'Event1234', firstName: 'P5', lastName: 'Own', organizationName: `P5 Org ${stamp}` },
      null,
    );
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;
    ownerId = reg.data.userId;
    orgId = reg.data.organizationId;

    const created = await createEvent(ctx(), {
      name: `Événement P5 ${stamp}`, typeCode: 'wedding', date: '2027-06-12',
      startTime: '15:00', timezone: 'Africa/Kinshasa', optionsJson: {},
      venue: 'Salle P5', city: 'Kinshasa',
    });
    eventId = created.id;
    eventSlug = created.slug;

    const updated = await updateEvent(ctx(), eventId, {
      name: `Mariage P5 ${stamp}`,
      venue: 'Hôtel Grand P5',
      optionsJson: { guestbook: true },
    });
    expect(updated.slug).not.toBe(eventSlug);
    expect(updated.slug).toContain('mariage-p5');
    eventSlug = updated.slug;

    const ev = await prisma.event.findUnique({ where: { id: eventId } });
    expect(ev?.name).toBe(`Mariage P5 ${stamp}`);
    expect((ev!.optionsJson as Record<string, boolean>).guestbook).toBe(true);
    expect((ev!.optionsJson as Record<string, boolean>).qr).toBe(true); // fusion, pas écrasement
  });

  it('machine à états : transitions valides et invalides', async () => {
    await setEventStatus(ctx(), eventId, 'published');
    let ev = await prisma.event.findUnique({ where: { id: eventId } });
    expect(ev?.status).toBe('published');

    // Même statut → 409 ; publié → archivé OK ; archivé → publié interdit (→ draft d'abord)
    await expect(setEventStatus(ctx(), eventId, 'published')).rejects.toMatchObject({
      code: 'invalid_status_change',
    });
    await setEventStatus(ctx(), eventId, 'archived');
    await expect(setEventStatus(ctx(), eventId, 'published')).rejects.toMatchObject({
      code: 'invalid_status_change',
    });
    await setEventStatus(ctx(), eventId, 'draft');
    ev = await prisma.event.findUnique({ where: { id: eventId } });
    expect(ev?.status).toBe('draft');
  });
});

describe('personnes principales (CDC §10)', () => {
  it('ajout, listing trié, modification, retrait', async () => {
    const a = await addEventMember(ctx(), eventId, { roleLabel: 'Mariée', firstName: 'Sara', lastName: 'P5' });
    const b = await addEventMember(ctx(), eventId, { roleLabel: 'Marié', firstName: 'Paul', lastName: 'P5', sortOrder: -1 });

    let list = await listEventMembers(eventId, orgId);
    expect(list).toHaveLength(2);
    expect(list![0].firstName).toBe('Paul'); // sortOrder 0 d'abord

    await updateEventMember(ctx(), eventId, a.id, { roleLabel: 'Bride', firstName: 'Sara', lastName: 'P5', sortOrder: 5 });
    list = await listEventMembers(eventId, orgId);
    expect(list!.find((m) => m.id === a.id)?.roleLabel).toBe('Bride');

    await removeEventMember(ctx(), eventId, b.id);
    list = await listEventMembers(eventId, orgId);
    expect(list).toHaveLength(1);

    await expect(removeEventMember(ctx(), eventId, 'id-inconnu')).rejects.toMatchObject({
      code: 'member_not_found',
    });
  });
});

describe('duplication (config + options, sans invités)', () => {
  it('respecte le quota du plan, puis copie en brouillon avec nouveau slug', async () => {
    // Starter = 1 événement → la duplication doit être refusée d'abord
    await expect(duplicateEvent(ctx(), eventId)).rejects.toMatchObject({
      code: 'quota_exceeded',
    });

    // Passage au plan Pro (équivalent d'une souscription, phase 13)
    const pro = await prisma.plan.findUnique({ where: { code: 'pro' } });
    if (pro) {
      await prisma.subscription.updateMany({
        where: { organizationId: orgId },
        data: { planId: pro.id, status: 'active' },
      });
    }

    // Un invité présent sur l'original ne doit PAS être copié
    const guest = await prisma.guest.create({
      data: { eventId, organizationId: orgId, firstName: 'G', lastName: 'Hôte' },
    });

    const copy = await duplicateEvent(ctx(), eventId);
    const copyRow = await prisma.event.findUnique({ where: { id: copy.id } });
    expect(copyRow?.status).toBe('draft');
    expect(copyRow?.slug).not.toBe(eventSlug);
    expect(copyRow?.name).toContain('(copie)');
    expect((copyRow!.optionsJson as Record<string, boolean>).guestbook).toBe(true);
    expect(copyRow?.venue).toBe('Hôtel Grand P5');

    const guests = await prisma.guest.count({ where: { eventId: copy.id } });
    expect(guests).toBe(0);
    await prisma.guest.delete({ where: { id: guest.id } });
    await prisma.event.delete({ where: { id: copy.id } });
  });
});

describe('page publique /e/[slug] (critère C)', () => {
  it('draft/archivé invisible, publié visible, sections selon options', async () => {
    expect(await getPublicEvent('slug-inexistant-xyz')).toBeNull();
    expect(await getPublicEvent(eventSlug)).toBeNull(); // encore en brouillon

    await setEventStatus(ctx(), eventId, 'published');
    const pub = await getPublicEvent(eventSlug);
    expect(pub).not.toBeNull();
    expect(pub!.name).toContain('Mariage P5');
    expect(pub!.options.guestbook).toBe(true);
    expect(pub!.members).toHaveLength(1); // Sara (Paul retiré plus haut)
    expect(pub!.members[0].initials).toBe('SP');

    // Options off → sections absentes ; options non listées préservées
    await updateEvent(ctx(), eventId, { optionsJson: { countdown: false, gallery: false } });
    const pub2 = await getPublicEvent(eventSlug);
    expect(pub2!.options.countdown).toBe(false);
    expect(pub2!.options.rsvp).toBe(true);
    expect(pub2!.guestbookMessages).toHaveLength(0);

    // Repasser en brouillon masque à nouveau la page
    await setEventStatus(ctx(), eventId, 'draft');
    expect(await getPublicEvent(eventSlug)).toBeNull();
    await setEventStatus(ctx(), eventId, 'published');
  });

  it('livre d’or : dépôt auto-validé, désactivé → 403, inconnu → 404', async () => {
    const msg = await postGuestbook(
      eventSlug,
      { authorName: 'Cliente Témoin', authorEmail: '', message: 'Bravo aux mariés !' },
      null,
    );
    expect(msg.id).toBeTruthy();

    const pub = await getPublicEvent(eventSlug);
    expect(pub!.guestbookMessages.some((m) => m.message === 'Bravo aux mariés !')).toBe(true);
    expect(pub!.guestbookCount).toBe(1);

    await updateEvent(ctx(), eventId, { optionsJson: { guestbook: false } });
    await expect(
      postGuestbook(eventSlug, { authorName: 'X', message: 'message' }, null),
    ).rejects.toMatchObject({ code: 'guestbook_disabled' });

    await expect(
      postGuestbook('slug-inexistant-xyz', { authorName: 'X', message: 'message' }, null),
    ).rejects.toMatchObject({ code: 'event_not_found' });
  });
});

describe('politique de suppression (CDC §10) — dernier', () => {
  it('publié protégé (archive_required) ; brouillon supprimé physiquement en cascade', async () => {
    const before = await prisma.guest.count({ where: { eventId } });
    await prisma.guest.createMany({
      data: [
        { eventId, organizationId: orgId, firstName: 'Casc', lastName: 'A' },
        { eventId, organizationId: orgId, firstName: 'Casc', lastName: 'B' },
      ],
    });

    await expect(deleteEvent(ctx(), eventId)).rejects.toMatchObject({ code: 'archive_required' });

    await setEventStatus(ctx(), eventId, 'archived');
    await setEventStatus(ctx(), eventId, 'draft');
    await deleteEvent(ctx(), eventId);

    expect(await prisma.event.findUnique({ where: { id: eventId } })).toBeNull();
    const guestsLeft = await prisma.guest.count({ where: { eventId } });
    expect(guestsLeft).toBe(0);
    expect(before).toBe(0);
  });
});
