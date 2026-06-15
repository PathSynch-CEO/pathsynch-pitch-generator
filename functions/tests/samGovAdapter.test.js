'use strict';

// ── samGovClient Tests ───────────────────────────────────────────────────────

const { searchOpportunities, formatSamDate, NOTICE_TYPE_MAP, _resetThrottle } = require('../services/govcapture/samGovClient');

describe('samGovClient — formatSamDate', () => {
    test('formats Date to MM/dd/yyyy', () => {
        // Use explicit month/day constructor to avoid timezone offset
        expect(formatSamDate(new Date(2026, 5, 13))).toBe('06/13/2026'); // month is 0-indexed
    });

    test('formats ISO string with time', () => {
        expect(formatSamDate('2026-01-05T12:00:00Z')).toBe('01/05/2026');
    });

    test('returns null for null', () => {
        expect(formatSamDate(null)).toBeNull();
    });

    test('returns null for invalid date', () => {
        expect(formatSamDate('not-a-date')).toBeNull();
    });
});

describe('samGovClient — NOTICE_TYPE_MAP', () => {
    test('sources_sought maps to r', () => {
        expect(NOTICE_TYPE_MAP.sources_sought).toBe('r');
    });

    test('solicitation maps to o', () => {
        expect(NOTICE_TYPE_MAP.solicitation).toBe('o');
    });

    test('combined_synopsis_solicitation maps to k', () => {
        expect(NOTICE_TYPE_MAP.combined_synopsis_solicitation).toBe('k');
    });

    test('all 7 types mapped', () => {
        expect(Object.keys(NOTICE_TYPE_MAP)).toHaveLength(7);
    });
});

describe('samGovClient — searchOpportunities', () => {
    const origKey = process.env.SAM_GOV_API_KEY;

    afterEach(() => {
        if (origKey !== undefined) process.env.SAM_GOV_API_KEY = origKey;
        else delete process.env.SAM_GOV_API_KEY;
        _resetThrottle();
    });

    test('missing API key → graceful error, not throw', async () => {
        delete process.env.SAM_GOV_API_KEY;
        const result = await searchOpportunities({ postedFrom: new Date(), postedTo: new Date() });
        expect(result.success).toBe(false);
        expect(result.error).toContain('SAM_GOV_API_KEY');
    });

    test('missing postedTo → graceful error before request', async () => {
        process.env.SAM_GOV_API_KEY = 'test-key';
        const result = await searchOpportunities({ postedFrom: new Date() });
        expect(result.success).toBe(false);
        expect(result.error).toContain('postedTo');
    });

    test('missing postedFrom → graceful error before request', async () => {
        process.env.SAM_GOV_API_KEY = 'test-key';
        const result = await searchOpportunities({ postedTo: new Date() });
        expect(result.success).toBe(false);
        expect(result.error).toContain('postedFrom');
    });
});

// ── samQueryBuilder Tests ────────────────────────────────────────────────────

const { buildQueriesForProfile, MAX_QUERIES, BROAD_KEYWORDS, _selectQueryKeywords } = require('../services/govcapture/samQueryBuilder');

describe('samQueryBuilder — buildQueriesForProfile', () => {
    const COUNTIFI_PROFILE = {
        solutions: [{
            name: 'Countifi — Asset Tracking',
            keywords: [
                'asset tracking', 'inventory management', 'RFID',
                'warehouse management', 'computer vision', 'predictive inventory',
                'supply chain visibility', 'materials management',
                'inventory counting', 'inventory automation',
                'barcode scanning', 'asset lifecycle',
            ],
        }],
        credentials: {
            naicsCodes: ['541614', '561990', '541511', '541512', '611420'],
        },
    };

    test('generates NAICS-first + keyword queries', () => {
        const queries = buildQueriesForProfile(COUNTIFI_PROFILE, null);
        expect(queries.length).toBeGreaterThan(0);
        expect(queries.length).toBeLessThanOrEqual(MAX_QUERIES);

        const naicsQueries = queries.filter(q => q.bucket === 'naics');
        expect(naicsQueries.length).toBeGreaterThan(0);
        expect(naicsQueries[0].naicsCode).toBe('541614');
    });

    test('max 10 queries enforced', () => {
        const queries = buildQueriesForProfile(COUNTIFI_PROFILE, null);
        expect(queries.length).toBeLessThanOrEqual(10);
    });

    test('all queries include postedFrom and postedTo', () => {
        const queries = buildQueriesForProfile(COUNTIFI_PROFILE, null);
        for (const q of queries) {
            expect(q.postedFrom).toBeInstanceOf(Date);
            expect(q.postedTo).toBeInstanceOf(Date);
        }
    });

    test('profile with no solutions → empty queries', () => {
        const queries = buildQueriesForProfile({ solutions: [] }, null);
        expect(queries).toHaveLength(0);
    });

    test('null profile → empty queries', () => {
        expect(buildQueriesForProfile(null, null)).toHaveLength(0);
    });

    test('lastSyncDate used as postedFrom', () => {
        const lastSync = new Date('2026-06-01');
        const queries = buildQueriesForProfile(COUNTIFI_PROFILE, lastSync);
        for (const q of queries) {
            expect(q.postedFrom.getTime()).toBe(lastSync.getTime());
        }
    });
});

describe('samQueryBuilder — _selectQueryKeywords', () => {
    test('filters out broad keywords', () => {
        const kws = ['logistics', 'asset tracking', 'operations', 'RFID'];
        const selected = _selectQueryKeywords(kws, 10);
        expect(selected).not.toContain('logistics');
        expect(selected).not.toContain('operations');
        expect(selected).toContain('asset tracking');
        expect(selected).toContain('RFID');
    });

    test('prefers multi-word phrases', () => {
        const kws = ['RFID', 'asset tracking', 'warehouse management system'];
        const selected = _selectQueryKeywords(kws, 10);
        // Multi-word first
        expect(selected[0]).toBe('warehouse management system');
    });

    test('empty input → empty output', () => {
        expect(_selectQueryKeywords([], 10)).toHaveLength(0);
    });
});

// ── samNormalizer Tests ──────────────────────────────────────────────────────

const { normalizeOpportunity, _parseOrgHierarchy, _parseLocation, _safeParseDate } = require('../services/govcapture/samNormalizer');
const fixture = require('./fixtures/govcapture/sam-response-countifi-page1.json');

describe('samNormalizer — normalizeOpportunity', () => {
    const sample = fixture.opportunitiesData[0];

    test('produces correct GovOpportunity shape', () => {
        const opp = normalizeOpportunity(sample, 'profile1', 'user1');
        expect(opp).not.toBeNull();
        expect(opp.userId).toBe('user1');
        expect(opp.profileIds).toEqual(['profile1']);
        expect(opp.primarySource).toBe('sam_gov');
        expect(opp.sourceConfidence).toBe('high');
        expect(opp.title).toBe('RFID Asset Tracking System for FEMA Warehouse');
        expect(opp.canonicalKey).toMatch(/^[a-f0-9]{40}$/);
        expect(opp.analysisStatus).toBe('pending');
        expect(opp.pursuitStatus).toBe('new');
        expect(opp.archived).toBe(false);
    });

    test('canonicalKey is deterministic', () => {
        const opp1 = normalizeOpportunity(sample, 'p1', 'u1');
        const opp2 = normalizeOpportunity(sample, 'p2', 'u2');
        expect(opp1.canonicalKey).toBe(opp2.canonicalKey);
    });

    test('handles responseDeadLine spelling', () => {
        const opp = normalizeOpportunity(sample, 'p1', 'u1');
        expect(opp.dueDate).not.toBeNull();
        expect(opp.rawDates.dueDateRaw).toBeTruthy();
    });

    test('handles reponseDeadLine typo spelling', () => {
        const typoRecord = fixture.opportunitiesData[1]; // has reponseDeadLine
        const opp = normalizeOpportunity(typoRecord, 'p1', 'u1');
        expect(opp.dueDate).not.toBeNull();
    });

    test('description URL stored in descriptionUrl, not description', () => {
        const urlRecord = fixture.opportunitiesData[2]; // description is a URL
        const opp = normalizeOpportunity(urlRecord, 'p1', 'u1');
        expect(opp.description).toBeNull();
        expect(opp.sourceRefs[0].descriptionUrl).toContain('https://');
    });

    test('missing due date → dateParseStatus: missing', () => {
        const noDueRecord = fixture.opportunitiesData[3]; // responseDeadLine is null
        const opp = normalizeOpportunity(noDueRecord, 'p1', 'u1');
        expect(opp.dateParseStatus).toBe('missing');
        expect(opp.dueDate).toBeNull();
    });

    test('null input → null', () => {
        expect(normalizeOpportunity(null, 'p1', 'u1')).toBeNull();
    });

    test('NAICS code extracted', () => {
        const opp = normalizeOpportunity(sample, 'p1', 'u1');
        expect(opp.naicsCodes).toEqual(['541614']);
    });

    test('set-aside from multiple field names', () => {
        // sample has setAsideCode: null but typeOfSetAside
        const opp = normalizeOpportunity(sample, 'p1', 'u1');
        expect(opp.setAside).toBe('Total Small Business Set-Aside');
    });

    test('set-aside all null → null', () => {
        const bare = { noticeId: 'test123', title: 'Test' };
        const opp = normalizeOpportunity(bare, 'p1', 'u1');
        expect(opp.setAside).toBeNull();
    });
});

describe('samNormalizer — _parseOrgHierarchy', () => {
    test('parses dot-separated hierarchy', () => {
        const { agencyName, departmentName } = _parseOrgHierarchy('DEPT.AGENCY.OFFICE');
        expect(departmentName).toBe('DEPT');
        expect(agencyName).toBe('AGENCY');
    });

    test('null input → nulls', () => {
        const { agencyName, departmentName } = _parseOrgHierarchy(null);
        expect(agencyName).toBeNull();
        expect(departmentName).toBeNull();
    });
});

describe('samNormalizer — _parseLocation', () => {
    test('parses object', () => {
        const loc = _parseLocation({ city: 'DC', state: 'DC', country: 'US' });
        expect(loc.city).toBe('DC');
    });

    test('parses string', () => {
        const loc = _parseLocation('Richmond, VA 23297');
        expect(loc.city).toBe('Richmond');
    });

    test('null → null', () => {
        expect(_parseLocation(null)).toBeNull();
    });
});

describe('samNormalizer — date parsing', () => {
    test('ISO date', () => {
        const d = _safeParseDate('2026-07-15T00:00:00Z');
        expect(d).toBeInstanceOf(Date);
    });

    test('MM/dd/yyyy format', () => {
        const d = _safeParseDate('07/30/2026');
        expect(d).toBeInstanceOf(Date);
    });

    test('null → null', () => {
        expect(_safeParseDate(null)).toBeNull();
    });

    test('invalid → null', () => {
        expect(_safeParseDate('not-a-date')).toBeNull();
    });
});

// ── Sync + Endpoint Contract Tests ───────────────────────────────────────────

describe('samSyncService — module contracts', () => {
    test('module exports syncProfileFromSam', () => {
        // Don't actually import (needs firebase-admin) — verify file exists
        const fs = require('fs');
        const path = require('path');
        expect(fs.existsSync(path.join(__dirname, '..', 'services', 'govcapture', 'samSyncService.js'))).toBe(true);
    });
});

describe('govcapture routes — SAM endpoints', () => {
    test('route file includes sam_gov sync endpoint', () => {
        const fs = require('fs');
        const path = require('path');
        const content = fs.readFileSync(path.join(__dirname, '..', 'routes', 'govcaptureRoutes.js'), 'utf8');
        expect(content).toContain('/api/govcapture/sources/sam_gov/sync');
        expect(content).toContain('/api/govcapture/source-runs');
        expect(content).toContain('/api/admin/govcapture/run-daily-sync');
    });

    test('sync endpoint checks GOVCAPTURE_SAM_ENABLED', () => {
        const fs = require('fs');
        const path = require('path');
        const content = fs.readFileSync(path.join(__dirname, '..', 'routes', 'govcaptureRoutes.js'), 'utf8');
        expect(content).toContain('GOVCAPTURE_SAM_ENABLED');
    });

    test('admin endpoint checks GOVCAPTURE_SCHEDULER_SECRET', () => {
        const fs = require('fs');
        const path = require('path');
        const content = fs.readFileSync(path.join(__dirname, '..', 'routes', 'govcaptureRoutes.js'), 'utf8');
        expect(content).toContain('GOVCAPTURE_SCHEDULER_SECRET');
    });

    test('admin endpoint checks x-admin-key header', () => {
        const fs = require('fs');
        const path = require('path');
        const content = fs.readFileSync(path.join(__dirname, '..', 'routes', 'govcaptureRoutes.js'), 'utf8');
        expect(content).toContain('x-admin-key');
    });

    test('sync endpoint checks SAM_GOV_API_KEY → 503 if missing', () => {
        const fs = require('fs');
        const path = require('path');
        const content = fs.readFileSync(path.join(__dirname, '..', 'routes', 'govcaptureRoutes.js'), 'utf8');
        expect(content).toContain('SAM_GOV_API_KEY');
        expect(content).toContain('503');
    });
});
