'use strict';

/**
 * Story S3 seed — banned-language (hedging) guard. The four hedges named in the PR-B scope
 * must be detected and must not survive into report output. Also exercises the runtime
 * CHECK_HEDGING_LANGUAGE pass in the report sanitizer.
 */
const { HEDGING_PHRASES, findHedgingViolations, stripHedgingSentences } = require('../utils/bannedLanguage');
const { sanitizeReport } = require('../utils/reportSanitizer');

describe('bannedLanguage — detection', () => {
    test.each([
        'highly probable',
        'reasonable to infer',
        'likely that',
        "it's probable",
        'it is probable'
    ])('flags the banned hedge %p', (phrase) => {
        expect(HEDGING_PHRASES).toContain(phrase);
        const text = `The market is strong and it is ${phrase} they will convert soon.`;
        expect(findHedgingViolations(text)).toContain(phrase);
    });

    test('detection is case-insensitive', () => {
        expect(findHedgingViolations('It is HIGHLY PROBABLE they respond.')).toContain('highly probable');
    });

    test('clean copy yields no violations', () => {
        expect(findHedgingViolations('62% of businesses have no website detected.')).toEqual([]);
    });
});

describe('bannedLanguage — stripping (fail-closed)', () => {
    test('drops the hedged sentence and keeps the sourced one', () => {
        const input = '62% have no website. It is reasonable to infer they are losing customers. The leader holds 900 reviews.';
        const { value, stripped } = stripHedgingSentences(input);
        expect(stripped).toBe(true);
        expect(value).toContain('62% have no website');
        expect(value).toContain('The leader holds 900 reviews');
        expect(value.toLowerCase()).not.toContain('reasonable to infer');
    });

    test('clean text is returned unchanged', () => {
        const input = 'The market average rating is 4.3 stars.';
        expect(stripHedgingSentences(input)).toEqual({ value: input, stripped: false });
    });
});

describe('reportSanitizer — CHECK_HEDGING_LANGUAGE', () => {
    test('scrubs hedging from the executive summary and flags the report', () => {
        const data = {
            executiveSummary: 'College Hunks leads the market with 900 reviews. It is highly probable that outreach converts.',
            data: {}
        };
        const out = sanitizeReport(data, new Date());
        expect(out.executiveSummary).toContain('College Hunks leads the market');
        expect(out.executiveSummary.toLowerCase()).not.toContain('highly probable');
        expect(out._hedgingScrubbed).toBe(true);
    });

    test('leaves a clean report untouched (no flag)', () => {
        const data = { executiveSummary: 'The market median is 20 reviews.', data: {} };
        const out = sanitizeReport(data, new Date());
        expect(out.executiveSummary).toBe('The market median is 20 reviews.');
        expect(out._hedgingScrubbed).toBeUndefined();
    });
});
