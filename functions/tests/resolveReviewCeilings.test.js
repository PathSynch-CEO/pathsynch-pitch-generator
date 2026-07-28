/**
 * Change B (2026-07-28) — per-sub-industry review-count ceiling / score-denominator resolver.
 * Covers the resolver in isolation plus an integration check against the real taxonomy.
 */
const { resolveReviewCeilings } = require('../services/verticalConfigs');
const { findIndustry, findSubIndustry } = require('../config/industryTaxonomy');
const { detectVertical } = require('../services/verticalConfigs');
const { getScoringProfile } = require('../config/scoringProfiles');

describe('resolveReviewCeilings — unit', () => {
  const vertical = { key: 'home_services', reviewCountCeiling: 350 };
  const profile = { reviewCeiling: 400 };

  test('sub with BOTH ceiling and denominator → both taken verbatim (decoupled)', () => {
    const sub = { id: 'junk_removal', reviewCountCeiling: 2000, reviewScoreDenominator: 800 };
    expect(resolveReviewCeilings(sub, vertical, profile)).toEqual({ ceiling: 2000, denominator: 800 });
  });

  test('sub with ceiling ONLY → denominator falls back to the sub ceiling (PRD §2.2)', () => {
    const sub = { id: 'x', reviewCountCeiling: 900 };
    expect(resolveReviewCeilings(sub, vertical, profile)).toEqual({ ceiling: 900, denominator: 900 });
  });

  test('existing sub with NO overrides → both fall back to the vertical ceiling (byte-identical to pre-change)', () => {
    const sub = { id: 'roofing', label: 'Roofing', aliases: [] };
    expect(resolveReviewCeilings(sub, vertical, profile)).toEqual({ ceiling: 350, denominator: 350 });
  });

  test('CUSTOM sub (subIndustryConfig null) → vertical ceiling for both (PRD §2.3)', () => {
    expect(resolveReviewCeilings(null, vertical, profile)).toEqual({ ceiling: 350, denominator: 350 });
  });

  test('no vertical → scoringProfile.reviewCeiling', () => {
    expect(resolveReviewCeilings(null, null, profile)).toEqual({ ceiling: 400, denominator: 400 });
  });

  test('nothing at all → global default 500', () => {
    expect(resolveReviewCeilings(null, null, null)).toEqual({ ceiling: 500, denominator: 500 });
  });

  test('0 is not a valid ceiling/denominator — it falls through (guards Component B div-by-zero)', () => {
    const sub = { id: 'bad', reviewCountCeiling: 0, reviewScoreDenominator: 0 };
    expect(resolveReviewCeilings(sub, vertical, profile)).toEqual({ ceiling: 350, denominator: 350 });
  });
});

describe('resolveReviewCeilings — integration with the real taxonomy', () => {
  const resolveFor = (industryLabel, subLabel) => {
    const sub = findSubIndustry(industryLabel, subLabel);
    const vertical = detectVertical(industryLabel, subLabel, null);
    const profile = getScoringProfile(findIndustry(industryLabel)?.scoringProfile);
    return resolveReviewCeilings(sub, vertical, profile);
  };

  test('Junk Removal & Hauling → ceiling 2000 / denominator 800', () => {
    expect(resolveFor('Home Services', 'Junk Removal & Hauling')).toEqual({ ceiling: 2000, denominator: 800 });
  });

  test('Dumpster Rental & Roll-Off → ceiling 750 / denominator 400', () => {
    expect(resolveFor('Home Services', 'Dumpster Rental & Roll-Off')).toEqual({ ceiling: 750, denominator: 400 });
  });

  test('Moving & Storage → ceiling 2000 / denominator 800', () => {
    expect(resolveFor('Home Services', 'Moving & Storage')).toEqual({ ceiling: 2000, denominator: 800 });
  });

  test('REGRESSION: the six existing Home Services subs carry no override → ceiling === denominator === 350', () => {
    for (const label of ['Plumbing & HVAC', 'Electrical', 'Roofing', 'Landscaping', 'Cleaning', 'General Contractor']) {
      expect(resolveFor('Home Services', label)).toEqual({ ceiling: 350, denominator: 350 });
    }
  });

  test('custom sub-industry label (not in taxonomy) → vertical ceiling 350 for both', () => {
    expect(resolveFor('Home Services', 'Residential Roofing')).toEqual({ ceiling: 350, denominator: 350 });
  });
});
