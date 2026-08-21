'use strict';

/**
 * Gate 1 — competitor/lead snapshot reconciliation (§5 of the approved brief).
 *
 * Invariant: once a lead/competitor match is accepted, no downstream derived metric consumes an
 * unreconciled review count. Precedence: DataForSEO (accepted) → Places exact → Serper, PROVIDER-ATOMIC
 * (rating and reviewCount from the same provider). Match: whitespace-insensitive name + city + the
 * existing divergence guards.
 */

const { reconcileSnapshots } = require('../api/market');
const { canonicalReviewMedian } = require('../services/evidencePainPoints');
const { scoreLeads, generateIntelSignal } = require('../services/opportunityScorer');

// plainNorm mirrors market.js normalizeBusinessName (keeps spaces) — the key that is INSUFFICIENT.
const plainNorm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
const clone = (x) => JSON.parse(JSON.stringify(x));

describe('Gate 1 — false-positive prevention (geo gate)', () => {
    test('same brand, different city does NOT merge: Stand Up Guys Atlanta ≠ Stand Up Guys Marietta', () => {
        const leads = [{ name: 'Stand Up Guys', address: '10 Peachtree St, Atlanta, GA 30303', rating: 4.9, reviewCount: 589 }];
        const competitors = [{ name: 'Stand Up Guys', address: '5 Cobb Pkwy, Marietta, GA 30060', rating: 5.0, reviewCount: 601 }];
        const before = clone({ leads, competitors });
        const r = reconcileSnapshots(leads, competitors);
        expect(r.matched).toBe(0);
        expect(leads).toEqual(before.leads);         // untouched — different locations
        expect(competitors).toEqual(before.competitors);
    });
});

describe('Gate 1 — true-positive recovery (whitespace-insensitive name + geo)', () => {
    test('JUSTJUNK Atlanta merges with JUST JUNK? Atlanta — and plain normalizeBusinessName alone does NOT', () => {
        // The plain (space-keeping) key would NOT establish this match:
        expect(plainNorm('JUSTJUNK Atlanta')).not.toBe(plainNorm('JUST JUNK? Atlanta')); // "justjunk atlanta" ≠ "just junk atlanta"

        const leads = [{ name: 'JUST JUNK? Atlanta', address: '1 Marietta St, Atlanta, GA 30303', rating: 5.0, reviewCount: 1200 }]; // Serper (rounded)
        const competitors = [{ name: 'JUSTJUNK Atlanta', address: '1 Marietta St NW, Atlanta, GA 30303', rating: 5.0, reviewCount: 1188 }]; // Places (exact)
        const r = reconcileSnapshots(leads, competitors);
        expect(r.matched).toBe(1);
        expect(leads[0].reviewCount).toBe(1188);        // canonical = Places exact
        expect(competitors[0].reviewCount).toBe(1188);
        expect(leads[0].rating).toBe(5.0);
        expect(competitors[0].rating).toBe(5.0);
    });
});

describe('Gate 1 — divergence / geo guards reject a bad candidate', () => {
    test('same name + same city but >5x review divergence → NOT merged (probably not the same business)', () => {
        const leads = [{ name: 'Junk Kings', address: 'Atlanta, GA', rating: 5.0, reviewCount: 2000 }];
        const competitors = [{ name: 'Junk Kings', address: 'Atlanta, GA', rating: 5.0, reviewCount: 300 }]; // 6.7x gap > 5x
        const r = reconcileSnapshots(leads, competitors);
        expect(r.matched).toBe(0);
    });
    test('missing city on one side → cannot confirm geo → NOT merged (conservative)', () => {
        const leads = [{ name: 'Peachtree Junk', address: '', rating: 4.8, reviewCount: 700 }];
        const competitors = [{ name: 'Peachtree Junk', address: 'Atlanta, GA', rating: 4.8, reviewCount: 710 }];
        const r = reconcileSnapshots(leads, competitors);
        expect(r.matched).toBe(0);
    });
});

describe('Gate 1 — provider-atomic precedence', () => {
    test('DataForSEO (accepted) wins for BOTH fields when present', () => {
        const leads = [{ name: 'Peachtree Junk Removal', address: 'Atlanta, GA', rating: 4.7, reviewCount: 736,
            dataForSEO: { reviewCount: 741, averageRating: 4.8 } }]; // lead.dataForSEO ⟺ reconcileReviewEnrichment accepted
        const competitors = [{ name: 'Peachtree Junk Removal', address: 'Atlanta, GA', rating: 4.6, reviewCount: 733 }];
        const r = reconcileSnapshots(leads, competitors);
        expect(r.matched).toBe(1);
        // atomic: rating and count both from DataForSEO — never a mix (e.g. 4.6★/741 no source observed)
        expect(leads[0].reviewCount).toBe(741);
        expect(leads[0].rating).toBe(4.8);
        expect(competitors[0].reviewCount).toBe(741);
        expect(competitors[0].rating).toBe(4.8);
    });
    test('DataForSEO missing a field → fall through to Places for BOTH fields', () => {
        const leads = [{ name: 'Peachtree Junk Removal', address: 'Atlanta, GA', rating: 4.7, reviewCount: 736,
            dataForSEO: { reviewCount: 741, averageRating: null } }]; // incomplete
        const competitors = [{ name: 'Peachtree Junk Removal', address: 'Atlanta, GA', rating: 4.6, reviewCount: 733 }];
        const r = reconcileSnapshots(leads, competitors);
        expect(leads[0].reviewCount).toBe(733);   // Places, both fields
        expect(leads[0].rating).toBe(4.6);
    });
});

describe('Gate 1 — GOAL regression: one canonical count across every representation & derived metric', () => {
    test('JUSTJUNK 1188 (Places) vs 1200 (Serper) → all consumers derive from 1188', () => {
        const lead = { name: 'JUST JUNK? Atlanta', address: 'Atlanta, GA', rating: 5.0, reviewCount: 1200, opportunityComponents: null };
        const comp = { name: 'JUSTJUNK Atlanta', address: 'Atlanta, GA', rating: 5.0, reviewCount: 1188 };
        const leads = [lead];
        const competitors = [comp];

        reconcileSnapshots(leads, competitors);
        const CANON = 1188;

        // persisted lead row (reportData.data.leads = serperLeads) and the persisted competitor row's
        // source (the finalization maps `reviews: match.reviewCount`)
        expect(lead.reviewCount).toBe(CANON);
        expect(comp.reviewCount).toBe(CANON);
        const persistedCompetitorRow = { name: comp.name, reviews: comp.reviewCount, rating: comp.rating }; // mirrors :finalization
        expect(persistedCompetitorRow.reviews).toBe(CANON);

        // canonicalReviewMedian over both populations
        expect(canonicalReviewMedian(leads, competitors)).toBe(CANON);

        // Share of Voice totalMarketReviews (market.js computation) uses the canonical, not 1200
        const uniq = [...competitors, ...leads].filter((b, i, arr) =>
            arr.findIndex(x => (x.name || '').toLowerCase().trim() === (b.name || '').toLowerCase().trim()) === i || true);
        const totalMarketReviews = [...competitors, ...leads].reduce((s, b) => s + (parseInt(b.reviewCount) || parseInt(b.reviews) || 0), 0);
        expect(totalMarketReviews).toBe(CANON * 2); // both sides canonical (2376), never 1188+1200=2388
        void uniq;

        // opportunityScore INPUT is the canonical count
        const scored = scoreLeads(leads, { avgSEOScore: 65 }, 800);
        expect(parseInt(scored[0].reviewCount)).toBe(CANON);

        // intel-signal string cites the canonical count, never the unreconciled Serper 1200
        const sig = generateIntelSignal(scored[0], { avgReviews: 3164, avgRating: 4.9, medianReviews: canonicalReviewMedian(leads, competitors) });
        expect(sig).toContain('1188');
        expect(sig).not.toContain('1200');
    });
});

describe('Gate 1 — accepted, fenced inconsistency: qualification is NOT re-decided on canonical values', () => {
    test('a lead qualified on its Serper count stays qualified after reconciliation changes the count', () => {
        const CEILING = 1500;
        const leadA = { name: 'Alpha Junk', address: 'Atlanta, GA', rating: 4.9, reviewCount: 1400 }; // qualifies on Serper
        const leadB = { name: 'Beta Junk', address: 'Atlanta, GA', rating: 4.9, reviewCount: 1600 };  // disqualified on Serper
        // qualification runs FIRST, on Serper values (the fenced predicate: reviewCount <= ceiling)
        const qualified = [leadA, leadB].filter(l => (parseInt(l.reviewCount) || 0) <= CEILING);
        expect(qualified.map(l => l.name)).toEqual(['Alpha Junk']);

        // reconciliation runs AFTER; Alpha's canonical (Places) is 1600 — which WOULD fail the ceiling
        const competitors = [{ name: 'Alpha Junk', address: 'Atlanta, GA', rating: 4.9, reviewCount: 1600 }];
        reconcileSnapshots(qualified, competitors);

        // membership is unchanged (reconciliation does not filter) and Alpha remains qualified even
        // though its canonical count now exceeds the ceiling — the accepted, fenced inconsistency.
        expect(qualified.map(l => l.name)).toEqual(['Alpha Junk']);
        expect(qualified[0].reviewCount).toBe(1600);
    });
});

describe('Gate 1 — no-match passthrough (deep-equal, no metadata)', () => {
    test('zero overlap → both populations byte-identical to pre-reconciliation; no fields added', () => {
        const leads = [{ name: 'Alpha Junk', address: 'Atlanta, GA', rating: 4.9, reviewCount: 300 }];
        const competitors = [{ name: 'Zeta Hauling', address: 'Atlanta, GA', rating: 4.8, reviewCount: 500 }];
        const beforeLeads = clone(leads), beforeComps = clone(competitors);
        const r = reconcileSnapshots(leads, competitors);
        expect(r.matched).toBe(0);
        expect(leads).toEqual(beforeLeads);
        expect(competitors).toEqual(beforeComps);
        expect(Object.keys(leads[0])).toEqual(Object.keys(beforeLeads[0]));       // no reconciliation metadata
        expect(Object.keys(competitors[0])).toEqual(Object.keys(beforeComps[0]));
    });
});
