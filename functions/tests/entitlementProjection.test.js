'use strict';
jest.mock('firebase-admin');
const admin = require('firebase-admin');
const { assignment } = require('./helpers/entitlementFixtures');
const { effectivePlan } = require('../services/workspaceEntitlements');
const adminApi = require('../api/admin');
const stripeApi = require('../api/stripe');
function response() { return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() }; }
beforeEach(() => { admin._resetMockData(); admin._mockData.collections.users = { subject: { plan: 'enterprise' } }; });
test('unresolved subscription projection does not invent Starter capacity', async () => {
 const res=response(); await stripeApi.getSubscription({ userId: 'subject' },res);
 expect(res.status).toHaveBeenCalledWith(200);
 expect(res.json.mock.calls[0][0].data).toMatchObject({ plan: 'unresolved', entitlementStatus: 'unresolved', planDetails: null });
});
test('legacy operator PATCH cannot silently report a downgrade without changing authority', async () => {
 admin._mockData.collections.accountPlanAssignments={subject:assignment('subject','enterprise')};
 const res=response(); await adminApi.updateUser({ params: {userId:'subject'}, body:{plan:'starter'}, adminEmail:'fixture@example.test' },res);
 expect(res.status).toHaveBeenCalledWith(409);
 expect(res.json.mock.calls[0][0].error).toBe('CANONICAL_PLAN_ENDPOINT_REQUIRED');
 expect(await effectivePlan('subject')).toBe('enterprise');
 expect(admin._mockData.collections.users.subject.plan).toBe('enterprise');
});
