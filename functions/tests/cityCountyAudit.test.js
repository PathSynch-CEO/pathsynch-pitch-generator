'use strict';

/**
 * PR #97 — city→county→FIPS audit lock + regression fence.
 *
 * The reference (tests/fixtures/cityCountyAudit.js) is the INDEPENDENT result of a Census
 * coordinates→Counties audit (authoritative county membership per Table-A city point), NOT generated from
 * Table A. Any future Table-A fallback mapping that diverges from the reviewed set fails this lock until
 * the new expected FIPS is deliberately re-verified and added to the fixture.
 */

const g = require('../services/geography');
const { FIPS_TO_COUNTY_LABEL } = require('../services/countyResolver');
const { VERIFIED_CITY_FIPS, MULTI_COUNTY_PENDING, FIPS_TO_NAME_AUTHORITATIVE } = require('./fixtures/cityCountyAudit');

// Resolve a "city,abbr" key through the SAME production path used by county resolution.
function tableFips(key) {
    const [city, abbr] = key.split(',');
    const cf = g.getCountyFips(city, abbr);
    const sf = g.getStateFips(abbr);
    return (cf && sf) ? `${sf}${cf}` : null;
}

describe('#97 — the two corrected transcription errors', () => {
    test('Newnan, GA → 13077 (Coweta), and NOT 13097 (Douglas)', () => {
        expect(tableFips('newnan,ga')).toBe('13077');
        expect(tableFips('newnan,ga')).not.toBe('13097');
    });
    test('Rome, GA → 13115 (Floyd), and NOT 13295 (Walker)', () => {
        expect(tableFips('rome,ga')).toBe('13115');
        expect(tableFips('rome,ga')).not.toBe('13295');
    });
    test('the corrected FIPS carry verified canonical labels', () => {
        expect(FIPS_TO_COUNTY_LABEL['13077']).toBe('Coweta County');
        expect(FIPS_TO_COUNTY_LABEL['13115']).toBe('Floyd County');
    });
});

describe('#97 — audit lock: every Table-A city resolves to its Census-verified FIPS', () => {
    for (const [key, expected] of Object.entries(VERIFIED_CITY_FIPS)) {
        test(`${key} → ${expected}`, () => {
            expect(tableFips(key)).toBe(expected);
        });
    }
});

describe('#97 — no Table-A city silently escapes the audit', () => {
    test('every unique Table-A city is in the verified set OR the multi-county pending list', () => {
        const pendingKeys = new Set(MULTI_COUNTY_PENDING.map(p => p.key));
        const abbrToName = g.STATE_ABBR_TO_NAME;
        const nameToAbbr = {};
        for (const [a, n] of Object.entries(abbrToName)) nameToAbbr[n.toLowerCase()] = a.toLowerCase();

        const missing = [];
        for (const rawKey of Object.keys(g.MAJOR_CITIES)) {
            const [city, st] = rawKey.split(',');
            const abbr = st.length === 2 ? st : (nameToAbbr[st] || st);
            const key = `${city},${abbr}`;
            if (VERIFIED_CITY_FIPS[key] || pendingKeys.has(key)) continue;
            // only count rows that actually resolve to a county FIPS (audited universe)
            if (tableFips(key)) missing.push(key);
        }
        expect([...new Set(missing)]).toEqual([]); // no unaudited city retains authority to pick QCEW geography
    });
});

describe('#97 — College Park resolved under the adopted principal-county rule', () => {
    // #97 adopted: largest Census population share (Fulton), city-hall tiebreaker (Fulton), and the Census
    // centroid (Fulton) all concur → College Park spans Fulton+Clayton but resolves to Fulton 13121.
    test('College Park, GA → 13121 (Fulton), and NOT 13063 (Clayton)', () => {
        expect(tableFips('college park,ga')).toBe('13121');
        expect(tableFips('college park,ga')).not.toBe('13063');
    });
    test('College Park is promoted to VERIFIED and removed from the pending list', () => {
        expect(VERIFIED_CITY_FIPS['college park,ga']).toBe('13121');
        expect(MULTI_COUNTY_PENDING.some(p => p.key === 'college park,ga')).toBe(false);
    });
    test('its canonical label already exists (no duplicate needed)', () => {
        expect(FIPS_TO_COUNTY_LABEL['13121']).toBe('Fulton County');
    });
    test('MULTI_COUNTY_PENDING remains the STOP mechanism for future ambiguous places (empty is valid)', () => {
        expect(Array.isArray(MULTI_COUNTY_PENDING)).toBe(true);
        expect(MULTI_COUNTY_PENDING.length).toBe(0);
    });
});

describe('#97 — FIPS_TO_COUNTY_LABEL is zero-mismatch vs the authoritative Census county names', () => {
    test('every label that overlaps the authoritative reference matches (case-insensitive)', () => {
        const mismatches = [];
        for (const [fips, label] of Object.entries(FIPS_TO_COUNTY_LABEL)) {
            const auth = FIPS_TO_NAME_AUTHORITATIVE[fips];
            if (auth && auth.toLowerCase() !== label.toLowerCase()) mismatches.push(`${fips}: ours="${label}" auth="${auth}"`);
        }
        expect(mismatches).toEqual([]);
    });
    test('the two previously-fixed labels remain authoritative (regression from #96)', () => {
        expect(FIPS_TO_COUNTY_LABEL['13097']).toBe('Douglas County');
        expect(FIPS_TO_COUNTY_LABEL['13295']).toBe('Walker County');
    });
});
