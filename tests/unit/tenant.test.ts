import { describe, expect, it } from 'vitest';
import { can, isOrgRole, rolesFor, ROLES } from '@/server/services/permissions';
import { tenantWhere } from '@/server/services/tenant';

describe('matrice de permissions (CDC §9-12)', () => {
  it('l’owner a toutes les permissions', () => {
    for (const perm of [
      'event:create', 'event:delete', 'guest:invite', 'guest:import', 'guest:delete',
      'checkin:scan', 'checkin:manage', 'design:create', 'design:use_premium_template',
      'stats:read', 'stats:advanced', 'stats:export', 'comm:send', 'ai:use',
      'billing:read', 'billing:manage', 'members:read', 'members:invite',
      'members:remove', 'members:change_role', 'settings:org',
    ] as const) {
      expect(can('owner', perm), perm).toBe(true);
    }
  });

  it('le manager gère l’opérationnel mais pas la facturation ni les rôles', () => {
    expect(can('manager', 'event:create')).toBe(true);
    expect(can('manager', 'comm:send')).toBe(true);
    expect(can('manager', 'billing:read')).toBe(true);
    expect(can('manager', 'billing:manage')).toBe(false);
    expect(can('manager', 'members:change_role')).toBe(false);
    expect(can('manager', 'settings:org')).toBe(false);
  });

  it('le designer crée mais ne supprime pas, ne scanne pas, ne gère pas l’équipe', () => {
    expect(can('designer', 'design:create')).toBe(true);
    expect(can('designer', 'design:delete')).toBe(false);
    expect(can('designer', 'event:create')).toBe(true);
    expect(can('designer', 'checkin:scan')).toBe(false);
    expect(can('designer', 'guest:import')).toBe(false);
    expect(can('designer', 'members:read')).toBe(false);
  });

  it('le scanner ne fait que le contrôle d’accès', () => {
    expect(can('scanner', 'checkin:scan')).toBe(true);
    expect(can('scanner', 'checkin:manage')).toBe(false);
    expect(can('scanner', 'guest:read')).toBe(true);
    expect(can('scanner', 'guest:invite')).toBe(false);
    expect(can('scanner', 'event:create')).toBe(false);
    expect(can('scanner', 'billing:read')).toBe(false);
  });

  it('le viewer est en lecture seule', () => {
    expect(can('viewer', 'stats:read')).toBe(true);
    expect(can('viewer', 'guest:read')).toBe(true);
    expect(can('viewer', 'event:create')).toBe(false);
    expect(can('viewer', 'guest:invite')).toBe(false);
    expect(can('viewer', 'billing:read')).toBe(false);
  });

  it('permission inconnue → false ; rôles cohérents', () => {
    expect(can('owner', 'nope:nope' as never)).toBe(false);
    expect(rolesFor('billing:manage')).toEqual(['owner']);
    expect(isOrgRole('owner')).toBe(true);
    expect(isOrgRole('superadmin')).toBe(false);
    expect(ROLES).toHaveLength(5);
  });
});

describe('multi-tenancy (CDC §6)', () => {
  it('tenantWhere force toujours l’organisation', () => {
    const w = tenantWhere('org_123');
    expect(w).toEqual({ organizationId: 'org_123' });
    expect(Object.keys(w)).toHaveLength(1);
  });
});
