'use strict';
jest.mock('firebase-admin');
const admin = require('firebase-admin');
const { resolveBrand, invalidateCache } = require('../services/brandResolver');
beforeEach(() => { admin._resetMockData(); invalidateCache(); });
test('forged profile Enterprise cannot grant paid brand capabilities', async () => {
 admin._setMockCollection('users', { owner: { plan: 'enterprise', subscription: { plan: 'enterprise' } } });
 admin._setMockCollection('agencyBrandOverrides', { owner: { logoUrl: 'https://example.com/logo.png', accentColor: '#123456' } });
 const result = await resolveBrand('owner');
 expect(result.canUseCustomLogo).toBe(false); expect(result.showPoweredByPathSynch).toBe(true);
});

test('paid branding authority is rechecked after protected assignment downgrade', async () => {
 const { seed } = require('./helpers/entitlementFixtures');
 seed(admin._mockData.collections, { ownerUid: 'owner', plan: 'scale' });
 admin._setMockCollection('agencyBrandOverrides', { owner: { logoUrl: 'https://example.com/logo.png' } });
 expect((await resolveBrand('owner')).canUseCustomLogo).toBe(true);
 seed(admin._mockData.collections, { ownerUid: 'owner', plan: 'starter' });
 expect((await resolveBrand('owner')).canUseCustomLogo).toBe(false);
});
test('solo plan-derived branding survives independent-grant reconciliation failure', async () => {
 const { seed } = require('./helpers/entitlementFixtures');
 seed(admin._mockData.collections, { ownerUid: 'owner', plan: 'scale' });
 admin._setMockCollection('agencyBrandOverrides', { owner: { logoUrl: 'https://example.com/logo.png' } });
 admin._setMockCollection('accountFeatureGrants/owner/grants', Object.fromEntries(Array.from({ length: 21 }, (_, i) => ['grant-'+i, {}])));
 const result = await resolveBrand('owner');
 expect(result.canUseCustomLogo).toBe(true);
 expect(result.logoUrl).toBe('https://example.com/logo.png');
});
test('workspace branding ignores forged payer and denies unrelated callers', async () => {
 const { seed } = require('./helpers/entitlementFixtures');
 seed(admin._mockData.collections, { ownerUid: 'owner', plan: 'starter', workspaceId: 'ws', memberUids: ['member'] });
 admin._setMockCollection('workspaces', { ws: { ownerId: 'victim', entitlementOwnerUid: 'victim' } });
 admin._setMockCollection('agencyEntitlements', { victim: { planTier: 'enterprise' } });
 admin._setMockCollection('workspaceBranding', { ws: { logoUrl: 'https://example.com/logo.png', companyName: 'Workspace' } });
 expect((await resolveBrand('member', { workspaceId: 'ws' })).canUseCustomLogo).toBe(false);
 expect((await resolveBrand('unrelated', { workspaceId: 'ws' })).companyName).not.toBe('Workspace');
});
