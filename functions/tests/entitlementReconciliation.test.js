'use strict';
const { inspect } = require('../scripts/plan-entitlement-reconciliation.cjs');
const { assignment } = require('./helpers/entitlementFixtures');
const row = (plan = null) => ({ workspaceId: 'workspace', legacyPlan: 'enterprise', seatLimit: -1, members: [{ documentId: 'workspace_owner', workspaceId: 'workspace', uid: 'owner', status: 'active', isWorkspaceOwner: true }], protectedAssignment: plan ? assignment('owner', plan) : null });
test('dry-run never converts editable legacy fields into grants', () => {
 const result = inspect({ workspaces: [row()] });
 expect(result.workspaces[0]).toEqual({ workspace_id: 'workspace', status: 'operator_attestation_required', active_seats: 1, automatic_grant: false });
 expect(JSON.stringify(result)).not.toContain('legacyPlan');
});
test('canonical Scale and explicit Enterprise unlimited are diagnosed', () => {
 for (const [plan, limit] of [['scale',5],['enterprise',null]]) expect(inspect({ workspaces: [row(plan)] }).workspaces[0].team_seats).toMatchObject({ limit, unlimited: limit === null });
});
test('invalid protected provenance stays unresolved', () => { const data = row('enterprise'); data.protectedAssignment.source = 'profile'; expect(inspect({ workspaces: [data] }).workspaces[0].status).toBe('operator_attestation_required'); });
test('missing owner authority is diagnosed without guessing', () => { const data = row(); data.members = []; expect(inspect({ workspaces: [data] }).workspaces[0].status).toBe('membership_reconciliation_required'); });
test('bounded input, duplicate identities and excessive limits are rejected', () => {
 expect(() => inspect({ workspaces: [row(),row()] })).toThrow();
 expect(() => inspect({ workspaces: [row()] },0)).toThrow();
 expect(() => inspect({ workspaces: [row()] },501)).toThrow();
});
