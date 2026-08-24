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

describe('no code in the taxonomy is a NAICS 2017 code that 2022 retired', () => {
    // Found during batch 3: technology_saas carried 511210 Software Publishers as its parent code.
    // NAICS 2022 restructured sector 51 and moved software publishing to 513210, so 511210 no longer
    // exists in the QCEW series — and the parent fallback in api/market.js stamps that code into every
    // stored report's industry.naicsCode. Worse, a widening walk from it reaches 511 "Publishing
    // Industries", which in 2022 means newspapers and books: a silently WRONG series, not an absent one.
    //
    // This list is the verified set, not an exhaustive one — extend it as retired codes are confirmed.
    const RETIRED_2017 = {
        '511210': '513210 Software Publishers',
        '515110': '516110 Radio Broadcasting Stations',
        '515120': '516120 Television Broadcasting Stations',
        '515210': '516210 Media Streaming Distribution Services, Social Networks, and Other Media Networks and Content Providers',
        '5151': '5161 Radio and Television Broadcasting Stations',
        '515': '516 Broadcasting and Content Providers',
        // Sector 52, confirmed while mapping finance_banking in batch 4.
        '523110': '523150 Investment Banking and Securities Intermediation',
        '523120': '523150 Investment Banking and Securities Intermediation',
        '522120': '522180 Savings Institutions and Other Depository Credit Intermediation',
        '522190': '522180 Savings Institutions and Other Depository Credit Intermediation'
    };

    test('no industry or sub-industry uses a retired code', () => {
        const offenders = [];
        for (const ind of taxonomy.industries) {
            if (RETIRED_2017[ind.naicsCode]) offenders.push(`${ind.id}=${ind.naicsCode} → use ${RETIRED_2017[ind.naicsCode]}`);
            for (const s of ind.subIndustries || []) {
                if (RETIRED_2017[s.naicsCode]) offenders.push(`${ind.id}/${s.id}=${s.naicsCode} → use ${RETIRED_2017[s.naicsCode]}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    test('technology_saas carries the 2022 software-publishing code', () => {
        expect(industryById('technology_saas').naicsCode).toBe('513210');
    });
});

describe('sector-range codes (NN-NN) must never be used where a walk can reach them', () => {
    // Three INDUSTRY-level codes are sector ranges: manufacturing 31-33, retail 44-45,
    // transportation_logistics 48-49. That is fine where they live — they are report metadata only,
    // and Structural Growth reads the SUB-industry code. But buildWalk strips non-digits, so a range
    // that ever reached it would be silently misread. Demonstrated below rather than described,
    // because the failure is invisible: it returns a plausible code for a different industry.
    test('buildWalk misreads a sector range — this is why one may not be a sub-industry code', () => {
        expect(buildWalk('31-33', 'Manufacturing').map((l) => l.code)).toEqual(['3133', '313']);
        //     31-33 → "3133" (not a NAICS code at all) → widens to 313 Textile Mills. Wrong, not absent.
        expect(buildWalk('44-45', 'Retail Trade').map((l) => l.code)).toEqual(['4445', '444']);
    });

    test('no SUB-industry carries a sector-range code', () => {
        const offenders = [];
        for (const ind of taxonomy.industries) {
            for (const sub of ind.subIndustries || []) {
                if (/^\d{2}-\d{2}$/.test(String(sub.naicsCode || ''))) offenders.push(`${ind.id}/${sub.id}=${sub.naicsCode}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    test('manufacturing/general_manufacturing is withheld for exactly this reason', () => {
        const rule = STRUCTURAL_GROWTH_POLICY.manufacturing.general_manufacturing;
        expect(rule.allow).toBe(false);
        expect(rule.reason).toContain('31-33');
        expect(rule.reason).toContain('313');
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
            'agencies_marketing_services', 'agriculture', 'automotive', 'commercial_real_estate',
            'construction_trades', 'education_training', 'energy_utilities', 'finance_banking',
            'food_beverage', 'health_wellness', 'home_services', 'hospitality_lodging',
            'manufacturing', 'media_entertainment', 'nonprofit_associations', 'professional_services',
            'retail', 'salon_beauty', 'technology_saas', 'transportation_logistics'
        ]);
    });

    test('the still-unmapped verticals are known, and government_public_sector is excluded BY DESIGN', () => {
        const unmapped = taxonomy.industries.map((i) => i.id).filter((id) => !STRUCTURAL_GROWTH_POLICY[id]).sort();
        // The backfill is COMPLETE. The only two verticals left are the two that can never be mapped,
        // and both are here by design rather than by omission.
        expect(unmapped).toEqual(['government_public_sector', 'other']);
        // government_public_sector can never be mapped: industryEconomicsService filters QCEW rows to
        // own_code '5' (private ownership), which contains no government employment at all. Any code
        // there would render an empty or misleading series. Same for "other" (a custom catch-all).
        const svc = require('fs').readFileSync(require.resolve('../utils/industryEconomicsService.js'), 'utf8');
        expect(svc).toMatch(/own_code\)\.trim\(\) !== '5'/);
    });
});
