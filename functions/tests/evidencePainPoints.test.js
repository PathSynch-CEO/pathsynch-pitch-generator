'use strict';

/**
 * Story S2 — evidence-derived pain points. Every claim must be computed from values the
 * report already produces, gated by a threshold, and stamped with its n. When nothing
 * fires, a single neutral line replaces filler. No em dashes in any output string.
 */
const {
    buildEvidencePainPoints,
    REPORT_SCHEMA_VERSION,
    NEUTRAL_LINE
} = require('../services/evidencePainPoints');

// A market where every threshold fires. reviewCounts median = 20 -> threshold 30.
function firingReport() {
    return {
        aiVisibilityIntelligence: { mentionRate: 40, sampleNote: 'sample of 5 prompts' },
        data: {
            competitors: [
                { name: 'Alpha Co', reviewCount: 5,   seoScore: 40, daysSinceLastReview: 120 },
                { name: 'Bravo Co', reviewCount: 10,  seoScore: 50, daysSinceLastReview: 200 },
                { name: 'Charlie Co', reviewCount: 20, seoScore: 55, daysSinceLastReview: 30 }
            ],
            leads: [
                { name: 'Delta Co', reviewCount: 500, website: 'https://delta.example' },
                { name: 'Echo Co',  reviewCount: 900 }
            ]
        }
    };
}

const idsOf = (r) => r.items.map(i => i.id);

describe('buildEvidencePainPoints — thresholds fire', () => {
    const result = buildEvidencePainPoints(firingReport());

    test('stamps schema version and computed count over the deduped population', () => {
        expect(result.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
        expect(result.computedCount).toBe(5);
    });

    test('website absence fires with correct percentage, count, and provenance n', () => {
        const item = result.items.find(i => i.id === 'website_absence');
        expect(item).toBeTruthy();
        expect(item.value).toBe(80); // 4 of 5 have no website
        expect(item.n).toBe(5);
        expect(item.claim).toContain('80%');
        expect(item.claim).toContain('4 of 5');
        expect(item.provenance).toBe('Computed from 5 businesses');
    });

    test('review threshold, weak SEO, AI mention, leader dominance, and velocity all fire', () => {
        expect(idsOf(result)).toEqual(expect.arrayContaining([
            'below_review_threshold', 'weak_seo', 'low_ai_mention', 'leader_dominance', 'stalled_velocity'
        ]));
        const seo = result.items.find(i => i.id === 'weak_seo');
        expect(seo.n).toBe(3);                       // only 3 had a seoScore
        expect(seo.provenance).toBe('Computed from 3 businesses');
        const vel = result.items.find(i => i.id === 'stalled_velocity');
        expect(vel.n).toBe(3);                        // only 3 had review dates
        expect(vel.provenance).toContain('with review dates');
        const ai = result.items.find(i => i.id === 'low_ai_mention');
        expect(ai.claim.toLowerCase()).toContain('directional');
    });

    test('no em dashes in any claim, provenance, or the neutral line', () => {
        const strings = result.items.flatMap(i => [i.claim, i.provenance]).concat([result.neutralLine]);
        for (const s of strings) expect(s).not.toMatch(/—/);
    });
});

describe('buildEvidencePainPoints — nothing fires', () => {
    const healthy = {
        data: {
            leads: [
                { name: 'Strong A', reviewCount: 100, website: 'https://a.example', seoScore: 80, daysSinceLastReview: 5 },
                { name: 'Strong B', reviewCount: 120, website: 'https://b.example', seoScore: 85, daysSinceLastReview: 10 },
                { name: 'Strong C', reviewCount: 150, website: 'https://c.example', seoScore: 90, daysSinceLastReview: 15 }
            ],
            competitors: []
        }
    };

    test('emits zero items and the single neutral line', () => {
        const r = buildEvidencePainPoints(healthy);
        expect(r.items).toEqual([]);
        expect(r.neutralLine).toBe(NEUTRAL_LINE);
        expect(r.computedCount).toBe(3);
    });
});

describe('buildEvidencePainPoints — evidence gate guards', () => {
    test('a percentage claim never fires below the minimum n (n=1 class)', () => {
        const tiny = { data: { leads: [{ name: 'Solo', reviewCount: 2 }], competitors: [] } };
        const r = buildEvidencePainPoints(tiny);
        // 1 business with no website is 100% absent, but n=1 is below MIN_N — no claim.
        expect(idsOf(r)).not.toContain('website_absence');
        expect(idsOf(r)).not.toContain('below_review_threshold');
    });

    test('velocity fires only over businesses whose review dates resolved', () => {
        const noDates = {
            data: { competitors: [
                { name: 'A', reviewCount: 5 }, { name: 'B', reviewCount: 6 }, { name: 'C', reviewCount: 7 }
            ] }
        };
        const r = buildEvidencePainPoints(noDates);
        expect(idsOf(r)).not.toContain('stalled_velocity'); // no daysSinceLastReview anywhere
    });

    test('AI mention pain requires a resolved rate (no field -> no claim)', () => {
        const noAi = buildEvidencePainPoints(firingReport());
        expect(idsOf(noAi)).toContain('low_ai_mention');
        const stripped = firingReport(); delete stripped.aiVisibilityIntelligence;
        expect(idsOf(buildEvidencePainPoints(stripped))).not.toContain('low_ai_mention');
    });

    test('handles an empty market without throwing', () => {
        const r = buildEvidencePainPoints({ data: { leads: [], competitors: [] } });
        expect(r.items).toEqual([]);
        expect(r.computedCount).toBe(0);
        expect(r.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
    });
});
