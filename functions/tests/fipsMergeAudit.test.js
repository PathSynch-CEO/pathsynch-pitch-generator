'use strict';

/**
 * PR-D — FIPS union-merge audit + Table B retirement + state-fallback deletion (pre-fix-failure honesty).
 *
 * TABLE_B_ORIGINAL is a frozen snapshot of the retired `CITY_TO_FIPS` (industryEconomicsService.js) as it
 * existed pre-PR-D. The audit asserts every Table B row is accounted for after the merge: either it now
 * resolves through Table A (geography.js) to the SAME 5-digit county FIPS, OR it is explicitly recorded in
 * FIPS_MERGE_UNVERIFIED. Nothing is silently dropped.
 */

const fs = require('fs');
const path = require('path');
const geography = require('../services/geography');

// Frozen snapshot of the retired CITY_TO_FIPS (5-digit values), abbr-keyed as it originally was.
const TABLE_B_ORIGINAL = {
    'atlanta,ga': '13121', 'buckhead,ga': '13121', 'midtown,ga': '13121', 'sandy springs,ga': '13121',
    'dunwoody,ga': '13089', 'alpharetta,ga': '13121', 'johns creek,ga': '13121', 'roswell,ga': '13121',
    'brookhaven,ga': '13089', 'decatur,ga': '13089', 'stone mountain,ga': '13089', 'tucker,ga': '13089',
    'marietta,ga': '13067', 'smyrna,ga': '13067', 'kennesaw,ga': '13067', 'acworth,ga': '13067',
    'lawrenceville,ga': '13135', 'duluth,ga': '13135', 'norcross,ga': '13135', 'suwanee,ga': '13135',
    'cumming,ga': '13117', 'canton,ga': '13057', 'peachtree city,ga': '13113', 'newnan,ga': '13097',
    'stockbridge,ga': '13151', 'mcdonough,ga': '13151', 'college park,ga': '13063', 'jonesboro,ga': '13063',
    'conyers,ga': '13247', 'gainesville,ga': '13139', 'rome,ga': '13295', 'columbus,ga': '13215',
    'savannah,ga': '13051', 'macon,ga': '13021', 'augusta,ga': '13245', 'warner robins,ga': '13153',
    'athens,ga': '13195', 'valdosta,ga': '13185',
    'houston,tx': '48201', 'dallas,tx': '48113', 'austin,tx': '48453', 'san antonio,tx': '48029',
    'fort worth,tx': '48439', 'plano,tx': '48085', 'frisco,tx': '48085', 'mckinney,tx': '48085',
    'arlington,tx': '48439', 'irving,tx': '48113', 'garland,tx': '48113', 'el paso,tx': '48141',
    'miami,fl': '12086', 'orlando,fl': '12095', 'tampa,fl': '12057', 'jacksonville,fl': '12031',
    'ft lauderdale,fl': '12011', 'fort lauderdale,fl': '12011', 'boca raton,fl': '12099',
    'palm beach,fl': '12099', 'clearwater,fl': '12103', 'st petersburg,fl': '12103',
    'los angeles,ca': '06037', 'san diego,ca': '06073', 'san francisco,ca': '06075', 'san jose,ca': '06085',
    'sacramento,ca': '06067', 'fresno,ca': '06019', 'irvine,ca': '06059', 'anaheim,ca': '06059',
    'long beach,ca': '06037', 'riverside,ca': '06065',
    'new york,ny': '36061', 'brooklyn,ny': '36047', 'queens,ny': '36081', 'bronx,ny': '36005',
    'staten island,ny': '36085', 'buffalo,ny': '36029',
    'chicago,il': '17031', 'naperville,il': '17043', 'aurora,il': '17089', 'joliet,il': '17197',
    'charlotte,nc': '37119', 'raleigh,nc': '37183', 'durham,nc': '37063', 'greensboro,nc': '37081',
    'phoenix,az': '04013', 'scottsdale,az': '04013', 'tempe,az': '04013', 'mesa,az': '04013',
    'chandler,az': '04013', 'gilbert,az': '04013', 'tucson,az': '04019',
    'denver,co': '08031', 'aurora,co': '08005', 'boulder,co': '08013', 'lakewood,co': '08059',
    'seattle,wa': '53033', 'bellevue,wa': '53033', 'tacoma,wa': '53053', 'spokane,wa': '53063',
    'nashville,tn': '47037', 'memphis,tn': '47157', 'knoxville,tn': '47093', 'chattanooga,tn': '47065',
    'virginia beach,va': '51810', 'richmond,va': '51760', 'arlington,va': '51013', 'alexandria,va': '51510',
    'columbus,oh': '39049', 'cleveland,oh': '39035', 'cincinnati,oh': '39061', 'dayton,oh': '39113',
    'philadelphia,pa': '42101', 'pittsburgh,pa': '42003',
    'detroit,mi': '26163', 'grand rapids,mi': '26081',
    'boston,ma': '25025',
    'baltimore,md': '24510', 'bethesda,md': '24031', 'silver spring,md': '24031',
    'las vegas,nv': '32003', 'henderson,nv': '32003',
    'minneapolis,mn': '27053',
    'st louis,mo': '29189',
    'portland,or': '41051',
    'indianapolis,in': '18097',
    'milwaukee,wi': '55079'
};

function resolved5(city, abbr) {
    const cf = geography.getCountyFips(city, abbr);
    const sf = geography.getStateFips(abbr);
    return (cf && sf) ? `${sf}${cf}` : null;
}

// #97: two Table-B originals were verified (Census) transcription errors and were CORRECTED in Table A.
// The frozen TABLE_B_ORIGINAL keeps the original (wrong) values for honesty; Table A now resolves to the
// corrected FIPS. See tests/cityCountyAudit.test.js for the authoritative verification.
const CORRECTED_IN_97 = { 'newnan,ga': '13077', 'rome,ga': '13115' };

describe('FIPS union-merge audit — no Table B row silently dropped', () => {
    const unverifiedKeys = new Set(geography.FIPS_MERGE_UNVERIFIED.map(x => x.key));

    for (const [key, expected5] of Object.entries(TABLE_B_ORIGINAL)) {
        const expectResolve = CORRECTED_IN_97[key] || expected5;
        const title = CORRECTED_IN_97[key]
            ? `Table B row "${key}" was a transcription error, CORRECTED in #97 to ${expectResolve} (was ${expected5})`
            : `Table B row "${key}" is accounted for (resolves to ${expected5} in Table A, or flagged unverified)`;
        test(title, () => {
            if (unverifiedKeys.has(key)) {
                // Explicitly recorded as not-migrated — not a silent drop.
                expect(unverifiedKeys.has(key)).toBe(true);
                return;
            }
            const [city, abbr] = key.split(',');
            expect(resolved5(city, abbr)).toBe(expectResolve);
        });
    }

    test('the two known-divergent/suspect rows are the ONLY unverified ones, and are documented', () => {
        expect(unverifiedKeys.has('athens,ga')).toBe(true);   // B=13195 (Morgan) vs Clarke 13059
        expect(unverifiedKeys.has('st louis,mo')).toBe(true);  // A=29510 city vs B=29189 county
        expect(geography.FIPS_MERGE_UNVERIFIED.length).toBe(2);
        for (const row of geography.FIPS_MERGE_UNVERIFIED) {
            expect(typeof row.reason).toBe('string');
            expect(row.reason.length).toBeGreaterThan(20);
        }
    });

    test('every original Table B key is either resolvable OR flagged (exhaustive coverage)', () => {
        const dropped = Object.keys(TABLE_B_ORIGINAL).filter(key => {
            if (unverifiedKeys.has(key)) return false;
            const [city, abbr] = key.split(',');
            return resolved5(city, abbr) !== (CORRECTED_IN_97[key] || TABLE_B_ORIGINAL[key]);
        });
        expect(dropped).toEqual([]);
    });
});

describe('Table B retirement — the orphaned service no longer owns FIPS/NAICS/state-fallback logic', () => {
    const svcPath = path.join(__dirname, '..', 'utils', 'industryEconomicsService.js');
    const src = fs.readFileSync(svcPath, 'utf8');

    test('retired: CITY_TO_FIPS table is gone from the service', () => {
        expect(src.includes('CITY_TO_FIPS')).toBe(false);
    });

    test('retired: regex mapToNAICS is gone (taxonomy code now drives the query)', () => {
        expect(src.includes('function mapToNAICS')).toBe(false);
    });

    test('retired: the old getIndustryEconomics entry point is gone; getStructuralGrowth is the API', () => {
        const svc = require('../utils/industryEconomicsService');
        expect(svc.getIndustryEconomics).toBeUndefined();
        expect(typeof svc.getStructuralGrowth).toBe('function');
    });

    test('no module still imports the retired service under its old name/shape', () => {
        // structuralGrowth.js is the only consumer, and it consumes getStructuralGrowth.
        const orch = fs.readFileSync(path.join(__dirname, '..', 'services', 'structuralGrowth.js'), 'utf8');
        expect(orch.includes('getStructuralGrowth')).toBe(true);
        expect(orch.includes('getIndustryEconomics')).toBe(false);
    });
});

describe('state-fallback deletion — pre-fix-failure honesty', () => {
    const svcPath = path.join(__dirname, '..', 'utils', 'industryEconomicsService.js');
    const src = fs.readFileSync(svcPath, 'utf8');

    test('the service no longer contains a state-level FIPS fallback (STATE_FIPS / isStateFallback)', () => {
        // OLD behavior: when no county resolved, the service substituted STATE_FIPS[state] (e.g. "13000")
        // and set isStateFallback=true, mislabeling STATE data as COUNTY data. That path is deleted.
        expect(src.includes('isStateFallback')).toBe(false);
        expect(/STATE_FIPS\s*=/.test(src)).toBe(false);
    });

    test('the resolver returns a WITHHOLD (not a state FIPS) when county is unresolved — the old failure is now impossible', () => {
        const { resolveCountyFips } = require('../services/countyResolver');
        const r = resolveCountyFips({ state: 'GA', geo: {} });
        // Pre-fix, this scenario produced fips "13000" (state-level). Now it withholds.
        expect(r.fips5).toBeUndefined();
        expect(r.withholdCause).toBe('no_county_fips');
    });
});
