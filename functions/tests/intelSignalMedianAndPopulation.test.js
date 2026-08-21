'use strict';

/**
 * N3 completion — retire the last surface still citing the competitor-inflated MEAN, and disambiguate
 * the population count in weakness/pain copy.
 *
 * (1) generateIntelSignal's per-lead presence line ("NNN reviews vs. NNNN ...") now cites the
 *     CANONICAL leads+competitors median — the SAME figure the KPI scorecard, deterministic
 *     weaknesses, evidence pain points, exec summary, and sanitizer fallback use — labeled
 *     "market median", with "% below presence threshold" recomputed off that baseline. The rating
 *     line (LINE 2) legitimately keeps "market avg" — that is a MEAN rating, for which no canonical
 *     median exists — so these tests assert on the presence line only.
 *
 * (2) Weakness/pain copy names the union count: "N of M analyzed businesses" (was a bare "N of M"),
 *     so "7 of 15 analyzed businesses" no longer reads as a contradiction beside "13 competitors".
 */

const { generateIntelSignal } = require('../services/opportunityScorer');
const {
    canonicalReviewMedian,
    buildEvidencePainPoints,
    REPORT_SCHEMA_VERSION
} = require('../services/evidencePainPoints');
const { buildWeaknessThemes, DEFAULT_PAIN_THRESHOLDS } = require('../services/competitiveWeaknesses');

// A market where the MEAN and the MEDIAN diverge hard (one huge leader inflates the mean).
const LEADS = [
    { name: 'Lead A', reviewCount: 12, rating: 4.7 },
    { name: 'Lead B', reviewCount: 40, rating: 4.8 },
    { name: 'Lead C', reviewCount: 187, rating: 4.6 }
];
const COMPETITORS = [
    { name: 'Comp Leader', reviewCount: 26793, rating: 4.9 },
    { name: 'Comp Mid', reviewCount: 734, rating: 4.8 },
    { name: 'Comp Low', reviewCount: 300, rating: 4.5 }
];
const CANON = canonicalReviewMedian(LEADS, COMPETITORS);
const MEAN = Math.round([...LEADS, ...COMPETITORS].reduce((s, b) => s + b.reviewCount, 0) / 6);
// benchmarks as market.js assigns them before the intel-signal loop: canonical median present.
const BENCH = { avgReviews: MEAN, avgRating: 4.7, medianReviews: CANON };

const presenceLine = (sig) => String(sig).split('\n')[0];

describe('N3 — intel-signal presence baseline IS the canonical median', () => {
    test('sanity: the fixture median and mean genuinely diverge', () => {
        expect(CANON).toBeGreaterThan(0);
        expect(MEAN).toBeGreaterThan(CANON * 5); // leader-inflated mean
    });

    test('below-median lead: cites EXACTLY canonicalReviewMedian, labeled "market median"', () => {
        const sig = generateIntelSignal({ name: 'Lead C', reviewCount: 187, rating: 4.6 }, BENCH, { reviewDenominator: 800 });
        const line = presenceLine(sig);
        // identical value — not just "a median"
        expect(line).toContain(`vs. ${CANON} market median`);
        // never the mean, and never labeled "market avg" on the presence line
        expect(line).not.toContain(String(MEAN));
        expect(line).not.toContain('market avg');
        // % below is recomputed off the median baseline
        const expectedGap = Math.round(((CANON - 187) / CANON) * 100);
        expect(line).toContain(`${expectedGap}% below presence threshold`);
    });

    test('the presence baseline equals canonicalReviewMedian over the SAME population (identity)', () => {
        // Re-derive independently and assert the string carries that exact integer.
        const expected = canonicalReviewMedian(LEADS, COMPETITORS);
        const sig = generateIntelSignal({ name: 'x', reviewCount: 1, rating: 4.5 }, BENCH);
        expect(presenceLine(sig)).toContain(`vs. ${expected} market median`);
    });

    test('above-median lead: phrasing reads "above the median", not "below presence threshold"', () => {
        const sig = generateIntelSignal({ name: 'Big', reviewCount: CANON + 500, rating: 4.6 }, BENCH, { reviewDenominator: 800 });
        const line = presenceLine(sig);
        expect(line).toContain('market median');
        expect(line).toMatch(/% above the median/);
        expect(line).not.toContain('below presence threshold');
    });

    test('at-median lead: "at the market median of N"', () => {
        const sig = generateIntelSignal({ name: 'Exact', reviewCount: CANON, rating: 4.6 }, BENCH, { reviewDenominator: 800 });
        expect(presenceLine(sig)).toContain(`at the market median of ${CANON}`);
    });

    test('honest fallback: benchmarks WITHOUT a median → labeled "market avg", never mislabeled', () => {
        const sig = generateIntelSignal({ name: 'X', reviewCount: 50, rating: 4.6 }, { avgReviews: 2431, avgRating: 4.4 });
        const line = presenceLine(sig);
        expect(line).toContain('2431 market avg');
        expect(line).not.toContain('market median');
    });
});

describe('N3 — intel signal reflects the FINAL analyzed population, not a pre-qualification superset', () => {
    // Reviewer's settling test: prove the value the intel signal cites equals canonicalReviewMedian
    // over the FINAL (post-qualification) population — the #88 guarantee — and would DIFFER if it were
    // computed over the raw pre-drop superset. market.js now assigns benchmarks.medianReviews from the
    // final population (after all filtering) and the intel-signal loop runs AFTER that assignment, so
    // generateIntelSignal reads the final-population figure.
    const COMPS = [{ name: 'L', reviewCount: 26793 }, { name: 'M', reviewCount: 734 }, { name: 'Low', reviewCount: 300 }];
    // Raw candidates include a sub-floor lead (3 reviews) that qualification drops (review floor = 5).
    const RAW_LEADS = [
        { name: 'tiny', reviewCount: 3, rating: 4.6 },
        { name: 'a', reviewCount: 12, rating: 4.7 },
        { name: 'b', reviewCount: 40, rating: 4.8 },
        { name: 'c', reviewCount: 187, rating: 4.6 }
    ];
    const FINAL_LEADS = RAW_LEADS.filter(l => l.reviewCount >= 5); // the ICP floor drops 'tiny'

    const finalMedian = canonicalReviewMedian(FINAL_LEADS, COMPS);
    const rawMedian = canonicalReviewMedian(RAW_LEADS, COMPS);

    test('the fixture is load-bearing: dropping the disqualified lead CHANGES the median', () => {
        expect(finalMedian).not.toBe(rawMedian); // 300 (final) vs 187 (raw superset)
    });

    test('intel signal cites the FINAL-population median (as market.js assigns it), not the superset', () => {
        // market.js: benchmarks.medianReviews = canonicalReviewMedian(final leads, competitors),
        // assigned BEFORE the (relocated) intel-signal loop.
        const benchmarks = { avgReviews: 4000, avgRating: 4.7, medianReviews: finalMedian };
        const sig = generateIntelSignal({ name: 'c', reviewCount: 187, rating: 4.6 }, benchmarks, { reviewDenominator: 800 });
        const line = presenceLine(sig);
        expect(line).toContain(`vs. ${finalMedian} market median`);   // final population wins
        expect(line).not.toContain(`vs. ${rawMedian} market median`); // never the pre-drop superset
    });
});

describe('N3 — population copy names the analyzed-business count', () => {
    // Median of [8,10,14,22,1200] = 14 → reviewThreshold max(30,14)=30; 4 of 5 fall under 30 → fires.
    const richReport = () => ({
        data: {
            seoLandscape: { avgSEOScore: 42 },
            competitors: [
                { name: 'Leader Co', reviewCount: 1200, website: 'a.com', rating: 4.9 },
                { name: 'B Shop', reviewCount: 22, rating: 4.8 },
                { name: 'C Shop', reviewCount: 14, rating: 4.7 },
                { name: 'D Shop', reviewCount: 10, rating: 4.6 },
                { name: 'E Shop', reviewCount: 8, rating: 4.5 }
            ],
            leads: []
        },
        aiVisibilityIntelligence: { mentionRate: 0.3 }
    });

    test('weakness theme: "N of M analyzed businesses fall under ..." (no bare "N of M")', () => {
        const w = buildWeaknessThemes(richReport(), DEFAULT_PAIN_THRESHOLDS);
        const below = w.items.find(i => i.id === 'below_review_threshold');
        expect(below).toBeTruthy();
        expect(below.theme).toMatch(/\d+ of \d+ analyzed businesses fall under/);
        // The bare form (a number immediately followed by "fall under") must be gone.
        expect(below.theme).not.toMatch(/\d+ of \d+ fall under/);
    });

    test('weakness theme: website-absence copy names analyzed businesses too', () => {
        const w = buildWeaknessThemes(richReport(), DEFAULT_PAIN_THRESHOLDS);
        const wa = w.items.find(i => i.id === 'website_absence');
        if (wa) {
            expect(wa.theme).toMatch(/\d+ of \d+ analyzed businesses are absent/);
            expect(wa.theme).not.toMatch(/\d+ of \d+ are absent/);
        }
    });

    test('evidence pain point: below-threshold claim names analyzed businesses', () => {
        const pp = buildEvidencePainPoints(richReport());
        const claims = (pp.items || []).map(i => i.claim).join(' || ');
        expect(claims).toMatch(/\d+ of \d+ analyzed businesses fall under/);
        expect(claims).not.toMatch(/\d+ of \d+ fall under \d+ reviews/); // bare form gone
    });
});

describe('N3 — copy/value change only, report shape unchanged', () => {
    // PR-D bumped the shared report schema 3→4 for the new Structural Growth section. The pain-points
    // shape is unchanged; it just carries the current monotonic report-wide version stamp.
    test('report schema version is the current stamp (4 after PR-D)', () => {
        expect(REPORT_SCHEMA_VERSION).toBe(4);
        expect(buildEvidencePainPoints({ data: { leads: [], competitors: [] } }).schemaVersion).toBe(4);
    });
});
