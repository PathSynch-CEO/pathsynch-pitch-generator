'use strict';

/**
 * Executive summary sentence 2 — the degenerate-range fix.
 *
 * The 8/22 report printed "review counts ranging from 68 to 68"; the 8/23 report printed
 * "review counts ranging from 1315 to 1315, well below the market leader's 1358" — a range of
 * one value, and a "well below" claim about a count at 97% of the leader's. The template's raw
 * min/max had no n=1 branch and the comparison was unconditional. This is the same class as the
 * design review's "ranging from 56 to 56" lesson that the verdict fixed — resurfacing in the
 * summary the verdict sits directly above.
 *
 * buildLeadReviewPhrases pre-forms the whole phrase deterministically and evidence-gates the
 * leader comparison; the prompt and the fallback template both consume the fragment verbatim,
 * and raw min/max are no longer placed in summaryData at all.
 */

const fs = require('fs');
const path = require('path');
const { buildLeadReviewPhrases, leadCountPhrase } = require('../services/narrativeGenerator');

const lead = (n) => ({ name: 'L', reviewCount: n });

describe('range wording: never "ranging from X to X"', () => {
    test('the 8/23 production case: leads at 0, 0, 1315 vs leader 1358', () => {
        const r = buildLeadReviewPhrases([lead(0), lead(0), lead(1315)], 1358);
        expect(r.fragment).toBe('one with 1315 reviews and the others with no measurable review volume, comparable to the market leader\'s 1358');
        expect(r.fragment).not.toContain('ranging from');
        expect(r.fragment).not.toContain('well below');       // 1358/1315 = 1.03: parity, not a gap
        expect(r.measuredCount).toBe(1);
    });

    test('the 8/22 production case: both leads at one value never yields a range', () => {
        const r = buildLeadReviewPhrases([lead(68), lead(68)], 1014);
        expect(r.fragment).toBe('review counts all at 68, well below the market leader\'s 1014');
        expect(r.fragment).not.toContain('ranging from 68 to 68');
    });

    test('two distinct values yield the real range', () => {
        const r = buildLeadReviewPhrases([lead(68), lead(204)], 1014);
        expect(r.fragment).toContain('review counts ranging from 68 to 204');
    });

    test('one measurable among two: singular "the other"', () => {
        const r = buildLeadReviewPhrases([lead(0), lead(120)], 900);
        expect(r.fragment).toContain('one with 120 reviews and the other with no measurable review volume');
    });

    test('a single lead in total states its count plainly, no range language', () => {
        const r = buildLeadReviewPhrases([lead(120)], 900);
        expect(r.fragment).toMatch(/^120 reviews/);
    });

    test('no measurable volume anywhere → null fragment (assert nothing)', () => {
        expect(buildLeadReviewPhrases([lead(0), lead(0)], 900)).toEqual({ fragment: null, measuredCount: 0 });
        expect(buildLeadReviewPhrases([], 900).fragment).toBeNull();
        expect(buildLeadReviewPhrases(null, 900).fragment).toBeNull();
    });
});

describe('leader comparison: evidence-gated, never unconditional', () => {
    const frag = (max, L) => buildLeadReviewPhrases([lead(max)], L).fragment;

    test('>= 3x → "well below"; > 1.2x → "below"; within ±20% → "comparable"', () => {
        expect(frag(100, 300)).toContain('well below the market leader\'s 300');
        expect(frag(100, 200)).toContain('below the market leader\'s 200');
        expect(frag(100, 110)).toContain('comparable to the market leader\'s 110');
    });

    test('a lead out-reviewing the leader gets NO comparison claim at all', () => {
        const f = frag(500, 200);
        expect(f).toBe('500 reviews');
        expect(f).not.toContain('leader');
    });

    test('an unmeasured leader (0 reviews) gets no comparison', () => {
        expect(frag(120, 0)).toBe('120 reviews');
    });

    test('boundary: exactly 1.2x is parity ("comparable"), not "below"', () => {
        expect(frag(100, 120)).toContain('comparable');
    });
});


describe('lead count phrase: never "1 qualified leads"', () => {
    test('the 8/23 production case: a single lead reads singular', () => {
        expect(leadCountPhrase(1)).toBe('1 qualified lead identified');
        expect(leadCountPhrase(1)).not.toContain('leads');
    });

    test('zero and plural counts read plural', () => {
        expect(leadCountPhrase(0)).toBe('0 qualified leads identified');
        expect(leadCountPhrase(2)).toBe('2 qualified leads identified');
        expect(leadCountPhrase(19)).toBe('19 qualified leads identified');
    });

    test('unusable input yields null rather than a malformed phrase', () => {
        expect(leadCountPhrase(null)).toBeNull();
        expect(leadCountPhrase(-1)).toBeNull();
        expect(leadCountPhrase('abc')).toBeNull();
    });
});

describe('source-shape guards: both output paths use the pre-formed count phrase', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'services', 'narrativeGenerator.js'), 'utf8');

    test('the prompt no longer hardcodes the plural in its sentence-2 format', () => {
        expect(src).toContain('[leadCountPhrase]');
        expect(src).not.toContain('"[N] qualified leads identified');
    });

    test('the fallback template consumes leadCountPhrase too', () => {
        expect(src).toMatch(/d\.leadCountPhrase \|\|/);
    });
});

describe('non-blocking section logs: success and silent-failure share one greppable label', () => {
    // The 8/23 diagnosis cost a round trip because the exclusions success log said
    // "Definition exclusions:" while its swallowed-error warn said "Definition exclusion
    // enforcement failed" - a grep for the success label could not see the failure. Every
    // try/catch section pair must be findable with ONE search of its label.
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'api', 'market.js'), 'utf8');
    const LABELS = [
        'Definition exclusions', 'Market definition', 'Market segments',
        'Evidence ledger', 'Market verdict', 'Audience tags'
    ];

    test.each(LABELS)('%s: both the success line and the failure warn carry the label', (label) => {
        expect(src).toContain(`[MarketIntel] ${label}:`);
        const failure = new RegExp(`\\[MarketIntel\\] ${label}[^'\`]*fail`, 'i');
        expect(src).toMatch(failure);
    });
});

describe('source-shape guards: both output paths consume the fragment', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'services', 'narrativeGenerator.js'), 'utf8');

    test('the prompt uses reviewSummary.fragment and no longer formats raw min/max', () => {
        expect(src).toContain('[reviewSummary.fragment]');
        expect(src).not.toContain('[qualifiedLeadReviewRange.min]');
    });

    test('raw min/max are not placed in summaryData (the model cannot re-derive the range)', () => {
        expect(src).not.toMatch(/qualifiedLeadReviewRange:/);
    });

    test('the fallback template uses the same fragment as the Gemini path', () => {
        expect(src).toMatch(/d\.reviewSummary && d\.reviewSummary\.fragment/);
    });
});
