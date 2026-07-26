'use strict';

/**
 * PR-C7 — syncAllActiveProfiles: the shared loop behind the admin
 * run-daily-sync route and the govDailySamSync scheduled function.
 */

jest.mock('firebase-admin');

const admin = require('firebase-admin');
const { syncAllActiveProfiles } = require('../services/govcapture/samSyncService');

beforeEach(() => {
    admin._resetMockData();
    admin._setMockCollection('govProfiles', {
        'prof-a': { userId: 'user-a', status: 'active' },
        'prof-b': { userId: 'user-b', status: 'active' },
        'prof-c': { userId: 'user-c', status: 'archived' },
    });
});

test('syncs every ACTIVE profile sequentially with its own userId', async () => {
    const calls = [];
    const syncFn = jest.fn(async (profileId, userId) => {
        calls.push([profileId, userId]);
        return { status: 'completed', totalFetched: 5 };
    });

    const results = await syncAllActiveProfiles(syncFn);

    expect(calls).toEqual([['prof-a', 'user-a'], ['prof-b', 'user-b']]); // archived excluded
    expect(results).toEqual([
        { profileId: 'prof-a', status: 'completed', totalFetched: 5 },
        { profileId: 'prof-b', status: 'completed', totalFetched: 5 },
    ]);
});

test('one profile failing never blocks the rest', async () => {
    const syncFn = jest.fn()
        .mockRejectedValueOnce(new Error('SAM.gov request timed out (30s)'))
        .mockResolvedValueOnce({ status: 'completed', totalFetched: 3 });

    const results = await syncAllActiveProfiles(syncFn);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ profileId: 'prof-a', status: 'failed', error: 'SAM.gov request timed out (30s)' });
    expect(results[1]).toEqual({ profileId: 'prof-b', status: 'completed', totalFetched: 3 });
});

test('no active profiles → empty results, no sync calls', async () => {
    admin._setMockCollection('govProfiles', { 'prof-c': { userId: 'u', status: 'archived' } });
    const syncFn = jest.fn();
    expect(await syncAllActiveProfiles(syncFn)).toEqual([]);
    expect(syncFn).not.toHaveBeenCalled();
});

test('scheduled function registered in index.js with env gates (file-content convention)', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf-8');
    expect(src).toContain("exports.govDailySamSync = onSchedule({");
    expect(src).toContain("schedule: '0 6 * * *'");
    expect(src).toMatch(/govDailySamSync[\s\S]{0,600}GOVCAPTURE_SAM_ENABLED/);
});
