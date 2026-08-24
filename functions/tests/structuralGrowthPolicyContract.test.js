'use strict';

/**
 * The Structural Growth policy contract — batch-agnostic invariants over the WHOLE taxonomy and the
 * WHOLE policy. Extracted from naicsBackfillBatch1.test.js during batch 2: none of this was ever
 * specific to batch 1, and duplicating it per batch would let a later batch quietly skip a check.
 *
 * A section renders county employment only when TWO files agree — the taxonomy carries a naicsCode,
 * and STRUCTURAL_GROWTH_POLICY carries allow:true for that sub. Because those facts live apart they
 * can drift, and every drift is SILENT: a policy allow:true with no code withholds `no_naics`, and a
 * taxonomy code with no policy entry withholds too. Nothing throws, nothing logs, the section just
 * quietly stops existing. These tests are the only thing that makes such a drift loud.
 *
 * The per-batch files (naicsBackfillBatch1/2.test.js) pin the researched codes themselves. This file
 * asserts the structure they have to fit into.
 */

const taxonomy = require('../config/industryTaxonomy.json');
const { STRUCTURAL_GROWTH_POLICY } = require('../services/structuralGrowth');
const { buildWalk } = require('../utils/industryEconomicsService');

const industryById = (id) => taxonomy.industries.find((i) => i.id === id);
const subById = (indId, subId) => (industryById(indId)?.subIndustries || []).find((s) => s.id === subId);

const policyPairs = [];
for (const [vertical, subs] of Object.entries(STRUCTURAL_GROWTH_POLICY)) {
    for (const [subId, rule] of Object.entries(subs)) policyPairs.push([vertical, subId, rule]);
}
const allowed = policyPairs.filter(([, , r]) => r.allow === true);

describe('taxonomy ↔ policy: a section renders only when BOTH files agree', () => {
    test('every policy vertical is a real taxonomy industry', () => {
        const orphans = Object.keys(STRUCTURAL_GROWTH_POLICY).filter((v) => !industryById(v));
        expect(orphans).toEqual([]);
    });

    test('every policy entry names a sub-industry that actually exists in the taxonomy', () => {
        expect(policyPairs.filter(([v, s]) => !subById(v, s)).map(([v, s]) => `${v}/${s}`)).toEqual([]);
    });

    test('every allow:true entry has a taxonomy naicsCode (else it silently withholds no_naics)', () => {
        expect(allowed.filter(([v, s]) => !subById(v, s).naicsCode).map(([v, s]) => `${v}/${s}`)).toEqual([]);
    });

    test('every allow:false entry records a reason (a denial without a judgment is not reviewable)', () => {
        const silent = policyPairs.filter(([, , r]) => r.allow === false && !r.reason);
        expect(silent.map(([v, s]) => `${v}/${s}`)).toEqual([]);
    });

    test('a mapped sub in a policy-covered vertical is never left UNLISTED (a code alone renders nothing)', () => {
        const unlisted = [];
        for (const vertical of Object.keys(STRUCTURAL_GROWTH_POLICY)) {
            for (const sub of industryById(vertical).subIndustries || []) {
                if (sub.naicsCode && !STRUCTURAL_GROWTH_POLICY[vertical][sub.id]) unlisted.push(`${vertical}/${sub.id}`);
            }
        }
        expect(unlisted).toEqual([]);
    });

    test('a withheld sub either carries no code at all, or carries one the reason argues against', () => {
        // Both shapes are legitimate. business_brokers keeps 541990 and the reason explains why that
        // code is unusable; med_spa_aesthetics has no code because none exists. What is NOT allowed is
        // a withheld sub whose reason says nothing about the classification.
        const vague = policyPairs
            .filter(([, , r]) => r.allow === false)
            .filter(([, , r]) => !/NAICS|\d{3,6}|class|series/i.test(r.reason))
            .map(([v, s]) => `${v}/${s}`);
        expect(vague).toEqual([]);
    });
});

describe('taxonomy data integrity at the sub level (whole file)', () => {
    // 2-6 digit codes, or a sector range like "44-45".
    const NAICS_RE = /^(\d{2,6}|\d{2}-\d{2})$/;

    test('a sub-industry never carries a code without a label, or a label without a code', () => {
        const offenders = [];
        for (const ind of taxonomy.industries) {
            for (const s of ind.subIndustries || []) {
                if ((s.naicsCode == null) !== (s.naicsLabel == null)) offenders.push(`${ind.id}/${s.id}`);
                if (s.naicsCode != null && !NAICS_RE.test(s.naicsCode)) offenders.push(`${ind.id}/${s.id}=${s.naicsCode}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    test('no two subs inside one vertical share an id', () => {
        const dupes = [];
        for (const ind of taxonomy.industries) {
            const seen = new Set();
            for (const s of ind.subIndustries || []) {
                if (seen.has(s.id)) dupes.push(`${ind.id}/${s.id}`);
                seen.add(s.id);
            }
        }
        expect(dupes).toEqual([]);
    });
});

describe('widening walk: EVERY allowed code has a real label at every level it can widen into', () => {
    // On BLS suppression the walk steps 6→4→3. An unlabelled level renders as the bare string
    // "NAICS 7225", which reads to a merchant as a defect. Running this over the whole policy rather
    // than the current batch is what surfaced two pre-existing gaps (2381, 4591) during batch 2.
    test.each(allowed.map(([v, s]) => [v, s]))('%s/%s widens through labelled levels', (vertical, sub) => {
        const code = subById(vertical, sub).naicsCode;
        const placeholders = buildWalk(code, 'taxonomy-label').filter((l) => /^NAICS \d+$/.test(l.label));
        expect(placeholders.map((l) => `${code}→${l.code}`)).toEqual([]);
    });
});

describe('policy coverage inventory — a deliberate, reviewable snapshot', () => {
    // Not a style check: this is the ONE place that states which verticals Structural Growth covers.
    // A vertical missing here renders no section at all, silently. Changing this list is the point of
    // a NAICS backfill batch, so the diff should show it.
    test('mapped verticals are exactly these', () => {
        expect(Object.keys(STRUCTURAL_GROWTH_POLICY).sort()).toEqual([
            'automotive', 'construction_trades', 'food_beverage', 'health_wellness',
            'home_services', 'hospitality_lodging', 'professional_services', 'retail',
            'salon_beauty', 'transportation_logistics'
        ]);
    });

    test('the still-unmapped verticals are known, and government_public_sector is excluded BY DESIGN', () => {
        const unmapped = taxonomy.industries.map((i) => i.id).filter((id) => !STRUCTURAL_GROWTH_POLICY[id]).sort();
        expect(unmapped).toEqual([
            'agencies_marketing_services', 'agriculture', 'commercial_real_estate', 'education_training',
            'energy_utilities', 'finance_banking', 'government_public_sector', 'manufacturing',
            'media_entertainment', 'nonprofit_associations', 'other', 'technology_saas'
        ]);
        // government_public_sector can never be mapped: industryEconomicsService filters QCEW rows to
        // own_code '5' (private ownership), which contains no government employment at all. Any code
        // there would render an empty or misleading series. Same for "other" (a custom catch-all).
        const svc = require('fs').readFileSync(require.resolve('../utils/industryEconomicsService.js'), 'utf8');
        expect(svc).toMatch(/own_code\)\.trim\(\) !== '5'/);
    });
});
