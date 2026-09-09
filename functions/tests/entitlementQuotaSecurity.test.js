'use strict';
jest.mock('firebase-admin');
const admin = require('firebase-admin');
const { checkPitchLimit } = require('../api/pitch/validators');
const { checkAndUpdateUsage } = require('../services/pitchMetrics');
const { canGenerateNarrative, canRegenerate } = require('../config/claude');
beforeEach(() => admin._resetMockData());
test('missing profile and assignment cannot gain free pitch quota', async () => {
 await expect(checkPitchLimit('missing-user')).rejects.toMatchObject({ code: 'ENTITLEMENT_UNRESOLVED' });
});
test('unresolved account cannot initialize paid usage quota', async () => {
 await expect(checkAndUpdateUsage('missing-user')).rejects.toMatchObject({ code: 'ENTITLEMENT_UNRESOLVED' });
 expect(Object.keys(admin._mockData.collections.usage || {})).toHaveLength(0);
});
test('unresolved narratives and regeneration are denied', () => {
 expect(canGenerateNarrative('unresolved', 0)).toBe(false);
 expect(canRegenerate('unresolved', 0)).toBe(false);
});
