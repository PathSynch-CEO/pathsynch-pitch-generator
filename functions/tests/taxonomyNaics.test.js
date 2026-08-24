/**
 * NAICS coverage guard for the Market Intel research-sections work (PR-A / Story S1).
 *
 * ORIGINAL scope (GATE2 decisions doc): codes were backfilled for the ACTIVE-GTM verticals only —
 * Retail, Automotive, Home Services — plus dental_practice, business_brokers and truck_stops, with
 * every other sub-industry resolving through the parent-industry fallback.
 *
 * SUPERSEDED 2026-08-24 by NAICS backfill batches 1-4: every vertical that can be mapped now is, and
 * the only sub-industries left without a code are the ones deliberately WITHHELD plus the two
 * verticals excluded by construction (government_public_sector, "other"). The live coverage contract
 * lives in tests/structuralGrowthPolicyContract.test.js. What remains useful HERE is the shape and
 * fallback plumbing — that codes are well-formed, that the GTM verticals never regress, and that the
 * subIndustry -> industry -> null resolution chain in api/market.js still behaves.
 */
const taxonomy = require('../config/industryTaxonomy.json');

// Valid 2022 NAICS shapes used in this taxonomy: 2-6 digit codes, or a sector range like "44-45".
const NAICS_RE = /^(\d{2,6}|\d{2}-\d{2})$/;

const industryById = (id) => taxonomy.industries.find((i) => i.id === id);
const subById = (industryId, subId) =>
  (industryById(industryId)?.subIndustries || []).find((s) => s.id === subId);

// The active-GTM verticals whose EVERY sub must carry a verified code.
const GTM_VERTICALS = ['retail', 'automotive', 'home_services'];

describe('taxonomy NAICS — version + format', () => {
  test('taxonomyVersion is bumped to 1.1.0', () => {
    expect(taxonomy.taxonomyVersion).toBe('1.1.0');
  });

  test('every present naicsCode (industry + sub) is a valid NAICS shape', () => {
    const offenders = [];
    for (const ind of taxonomy.industries) {
      if (ind.naicsCode != null && !NAICS_RE.test(ind.naicsCode)) {
        offenders.push(`industry ${ind.id}=${ind.naicsCode}`);
      }
      for (const sub of ind.subIndustries) {
        if (sub.naicsCode != null && !NAICS_RE.test(sub.naicsCode)) {
          offenders.push(`${ind.id}/${sub.id}=${sub.naicsCode}`);
        }
      }
      // A code without a human label (or vice-versa) is a data defect.
      const hasCode = ind.naicsCode != null;
      const hasLabel = ind.naicsLabel != null;
      if (hasCode !== hasLabel) offenders.push(`industry ${ind.id} code/label mismatch`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('taxonomy NAICS — industry-level parent codes', () => {
  // Charles's requirement: the 3 real industries missing a parent code get one, because the
  // sub-industry fallback resolves to the parent. "other" is a deliberate exception (a custom
  // catch-all has no meaningful NAICS; its growth section must stay withheld, not point at a
  // wrong Census series) — flagged in the PR for confirmation.
  test.each([
    ['energy_utilities', '221'],
    ['manufacturing', '31-33'],
    ['transportation_logistics', '48-49'],
  ])('%s has parent naicsCode %s', (id, code) => {
    expect(industryById(id).naicsCode).toBe(code);
  });

  test('"other" industry naicsCode stays null by design (custom catch-all, growth withheld)', () => {
    expect(industryById('other').naicsCode).toBeNull();
  });
});

describe('taxonomy NAICS — active-GTM vertical coverage', () => {
  test.each(GTM_VERTICALS)('%s: every sub-industry carries code + label', (id) => {
    const missing = industryById(id).subIndustries.filter(
      (s) => !s.naicsCode || !s.naicsLabel
    );
    expect(missing.map((s) => s.id)).toEqual([]);
  });

  test('dental_practice code is kept as-is (621210)', () => {
    expect(subById('health_wellness', 'dental_practice').naicsCode).toBe('621210');
  });
});

describe('taxonomy NAICS — new entries follow the expansion pattern', () => {
  test('business_brokers under professional_services (541990)', () => {
    const bb = subById('professional_services', 'business_brokers');
    expect(bb).toBeTruthy();
    expect(bb.naicsCode).toBe('541990');
    // Expansion pattern: ceiling/denominator estimates + includedBusinessTypes.
    expect(typeof bb.reviewCountCeiling).toBe('number');
    expect(typeof bb.reviewScoreDenominator).toBe('number');
    expect(Array.isArray(bb.includedBusinessTypes)).toBe(true);
    expect(bb.includedBusinessTypes.length).toBeGreaterThan(0);
  });

  test('truck_stops under transportation_logistics (457120)', () => {
    const ts = subById('transportation_logistics', 'truck_stops');
    expect(ts).toBeTruthy();
    expect(ts.naicsCode).toBe('457120');
    expect(typeof ts.reviewCountCeiling).toBe('number');
    expect(typeof ts.reviewScoreDenominator).toBe('number');
    expect(Array.isArray(ts.includedBusinessTypes)).toBe(true);
    expect(ts.includedBusinessTypes.length).toBeGreaterThan(0);
  });
});

describe('taxonomy NAICS — parent-industry fallback invariant', () => {
  // Mirrors the resolution chain in market.js: subIndustryConfig?.naicsCode || industryConfig?.naicsCode.
  const resolveNaics = (industryId, subId) =>
    subById(industryId, subId)?.naicsCode || industryById(industryId)?.naicsCode || null;

  test('a sub without its own code resolves to the parent industry code', () => {
    // Was agriculture/crop_farming until batch 4 mapped it. government_public_sector is the durable
    // example: that vertical can NEVER be mapped, because industryEconomicsService filters QCEW to
    // own_code '5' (private ownership) and government employment is not in that series at all.
    expect(subById('government_public_sector', 'state_agency').naicsCode).toBeUndefined();
    expect(resolveNaics('government_public_sector', 'state_agency')).toBe('921');
  });

  test('a GTM sub resolves to its own (more specific) code, not the parent', () => {
    // retail parent is "44-45"; general_merchandise must resolve to its own "455".
    expect(resolveNaics('retail', 'general_merchandise')).toBe('455');
  });

  test('a custom sub under "other" resolves to null (growth section withheld)', () => {
    expect(resolveNaics('other', 'custom_industry')).toBeNull();
  });
});
