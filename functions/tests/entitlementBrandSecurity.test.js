'use strict';
jest.mock('firebase-admin');
const admin = require('firebase-admin');
const { resolveBrand, invalidateCache, PATHSYNCH_DEFAULT_BRAND } = require('../services/brandResolver');
const { writeBrandGrantAtomically } = require('../services/brandGrantSeed');
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
test('Starter authority cannot apply paid identity fields while an independent grant can', async () => {
 const { seed } = require('./helpers/entitlementFixtures');
 seed(admin._mockData.collections, { ownerUid: 'owner', plan: 'starter' });
 admin._setMockCollection('agencyBrandOverrides', { owner: {
  companyName: 'Client supplied', agencyName: 'Agency', contactEmail: 'contact@example.test',
  contactPhone: '555-0100', websiteUrl: 'https://example.test', footerText: 'Client footer',
 } });
 const starter = await resolveBrand('owner');
 expect(starter).toMatchObject({ companyName: PATHSYNCH_DEFAULT_BRAND.companyName, agencyName: null,
  contactEmail: null, contactPhone: null, websiteUrl: null, showPoweredByPathSynch: true });
 expect(starter.footerText).not.toContain('Client footer');

 admin._setMockCollection('accountFeatureGrants/owner/grants', { brand: {
  schemaVersion: 1, grantId: 'brand', scopeType: 'account', scopeId: 'owner', feature: 'custom_branding',
  source: 'operator', actorUid: 'operator', reason: 'fixture', grantedAt: admin.firestore.Timestamp.now(),
  expiresAt: null, revokedAt: null,
 } });
 const granted = await resolveBrand('owner');
 expect(granted).toMatchObject({ companyName: 'Client supplied', agencyName: 'Agency',
  contactEmail: 'contact@example.test', websiteUrl: 'https://example.test', showPoweredByPathSynch: false });
});

test('atomic branding grant write leaves existing overrides untouched when the create-only grant exists', async () => {
 const db = admin.firestore();
 admin._setMockCollection('agencyBrandOverrides', { owner: { companyName: 'Existing' } });
 admin._setMockCollection('accountFeatureGrants/owner/grants', { brand: { grantId: 'brand' } });
 const overridesRef = db.collection('agencyBrandOverrides').doc('owner');
 const grantRef = db.collection('accountFeatureGrants').doc('owner').collection('grants').doc('brand');
 await expect(writeBrandGrantAtomically(db, overridesRef, grantRef, { companyName: 'Replacement' }, { grantId: 'brand' }))
  .rejects.toThrow('BRANDING_GRANT_ALREADY_EXISTS');
 expect(admin._mockData.collections.agencyBrandOverrides.owner).toEqual({ companyName: 'Existing' });
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
