'use strict';

/**
 * Workspace role normalization — the latent "fail-closed on an unrecognized role"
 * landmine. The guard ranks {contributor,manager,admin}; teamRoutes historically
 * wrote 'viewer' (a dead role) and workspaceResolver stored membership.role
 * unnormalized, so any legacy/miscased value made requireRole() return false and
 * denied an ACTIVE member every gated action.
 *
 * normalizeRole() collapses unknown/legacy values to least-privilege 'contributor'
 * so an active member is never locked out; requireRole() applies it defensively.
 */

const { normalizeRole, requireRole, canAccessResource } = require('../middleware/workspaceRoleGuard');

describe('normalizeRole', () => {
    test('canonical roles pass through unchanged', () => {
        expect(normalizeRole('contributor')).toBe('contributor');
        expect(normalizeRole('manager')).toBe('manager');
        expect(normalizeRole('admin')).toBe('admin');
    });

    test('legacy "viewer" collapses to contributor (least privilege, not fail-closed)', () => {
        expect(normalizeRole('viewer')).toBe('contributor');
    });

    test('miscasing and whitespace are normalized', () => {
        expect(normalizeRole('Contributor')).toBe('contributor');
        expect(normalizeRole('  ADMIN ')).toBe('admin');
        expect(normalizeRole('Manager')).toBe('manager');
    });

    test('null / undefined / unknown → contributor', () => {
        expect(normalizeRole(null)).toBe('contributor');
        expect(normalizeRole(undefined)).toBe('contributor');
        expect(normalizeRole('')).toBe('contributor');
        expect(normalizeRole('superuser')).toBe('contributor');
    });
});

describe('requireRole normalizes the caller role (no fail-closed on legacy values)', () => {
    test('legacy "viewer" member can still act as a contributor', () => {
        const req = { workspaceId: 'ws1', workspaceRole: 'viewer' };
        expect(requireRole(req, 'contributor')).toBe(true);
        expect(requireRole(req, 'manager')).toBe(false); // still least-privilege
    });

    test('miscased "Manager" is honored as manager', () => {
        const req = { workspaceId: 'ws1', workspaceRole: 'Manager' };
        expect(requireRole(req, 'manager')).toBe(true);
        expect(requireRole(req, 'admin')).toBe(false);
    });

    test('admin outranks everything', () => {
        const req = { workspaceId: 'ws1', workspaceRole: 'admin' };
        expect(requireRole(req, 'contributor')).toBe(true);
        expect(requireRole(req, 'manager')).toBe(true);
        expect(requireRole(req, 'admin')).toBe(true);
    });

    test('solo user (no workspaceId) is never granted a workspace role', () => {
        expect(requireRole({ workspaceId: null, workspaceRole: 'admin' }, 'contributor')).toBe(false);
    });
});

describe('canAccessResource with normalized roles', () => {
    test('contributor (incl. legacy viewer) sees only own resources', () => {
        const req = { workspaceId: 'ws1', workspaceRole: 'viewer', userId: 'u1' };
        expect(canAccessResource(req, 'u1')).toBe(true);   // own
        expect(canAccessResource(req, 'u2')).toBe(false);  // someone else's
    });

    test('manager/admin see all resources in the workspace', () => {
        const mgr = { workspaceId: 'ws1', workspaceRole: 'manager', userId: 'u1' };
        expect(canAccessResource(mgr, 'u2')).toBe(true);
        const admin = { workspaceId: 'ws1', workspaceRole: 'admin', userId: 'u1' };
        expect(canAccessResource(admin, 'u2')).toBe(true);
    });
});
