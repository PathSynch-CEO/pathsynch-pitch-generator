'use strict';

/**
 * Workstream 6a — Market Verdict (Aug-19 design review, screen 02 pin 4): "The report can say no."
 *
 * The review's specific lesson under test: "At n=1 the old exec summary rendered 'ranging from 56
 * to 56.' The verdict template has explicit n=0 and n=1 branches, the lesson from the v4 zero-lead
 * regression." Plus the PR #82 distinction: zero leads because candidates were FILTERED is a
 * filtering outcome, not a confirmed empty market.
 */

const {
    buildMarketVerdict, resolveVerdictThresholds, DEFAULT_VERDICT_THRESHOLDS,
    VERDICT_STATE, VERDICT_HEADLINE
} = require('../services/marketVerdict');

const lead = (n) => ({ name: 'Lead ' + n, reviewCount: 50 });
const report = (nLeads, nCompetitors, over) => ({
    data: Object.assign({
        leads: Array.from({ length: nLeads }, (_, i) => lead(i)),
        competitors: Array.from({ length: nCompetitors || 0 }, (_, i) => ({ name: 'Comp ' + i }))
    }, over || {})
});

describe('the report can say no', () => {
    test('zero leads → not_worth_working, whatever the competitor count', () => {
        const v = buildMarketVerdict(report(0, 12));
        expect(v.state).toBe(VERDICT_STATE.NOT_WORTH_WORKING);
        expect(v.headline).toBe('Not worth working now');
        expect(v.recommendedAction.length).toBeGreaterThan(0);
    });

    test('every state carries a headline and a recommended next action', () => {
        for (const r of [report(0, 5), report(1, 5), report(9, 5)]) {
            const v = buildMarketVerdict(r);
            expect(VERDICT_HEADLINE[v.state]).toBe(v.headline);
            expect(typeof v.recommendedAction).toBe('string');
            expect(v.recommendedAction.length).toBeGreaterThan(0);
        }
    });

    test('a verdict is ALWAYS produced (a report that cannot say no is what this replaces)', () => {
        expect(buildMarketVerdict({}).state).toBe(VERDICT_STATE.NOT_WORTH_WORKING);
        expect(buildMarketVerdict({ data: {} }).state).toBe(VERDICT_STATE.NOT_WORTH_WORKING);
        expect(buildMarketVerdict(null).headline).toBe('Not worth working now');
    });
});

describe('n=0 branch: filtered is not the same as empty (PR #82 distinction preserved)', () => {
    test('candidates discovered then filtered → filtering-outcome copy + widen-scope action', () => {
        const v = buildMarketVerdict(report(0, 12), { leadCandidateCount: 2 });
        expect(v.narrative).toContain('filtered as off profile');
        expect(v.narrative).toContain('rather than a confirmed empty market');
        expect(v.recommendedAction).toContain('before concluding this market is empty');
        expect(v.basis.excludedByScope).toBe(2);
    });

    test('nothing discovered at all → empty-market copy + widen-radius action', () => {
        const v = buildMarketVerdict(report(0, 12), { leadCandidateCount: 0 });
        expect(v.narrative).toContain('no businesses matching this profile');
        expect(v.narrative).not.toContain('filtered');
        expect(v.recommendedAction).toContain('wider radius');
        expect(v.basis.excludedByScope).toBeNull();
    });

    test('an unknown candidate count does not fabricate a filtering claim', () => {
        const v = buildMarketVerdict(report(0, 12));            // no leadCandidateCount at all
        expect(v.narrative).not.toContain('filtered');
        expect(v.basis.candidatesDiscovered).toBeNull();
        expect(v.stats.find(s => s.key === 'excludedByScope')).toBeUndefined();
    });

    test('singular grammar when exactly one candidate was filtered', () => {
        const v = buildMarketVerdict(report(0, 3), { leadCandidateCount: 1 });
        expect(v.narrative).toContain('1 candidate was discovered');
        expect(v.narrative).not.toContain('candidates were');
    });
});

describe('n=1 branch: the "ranging from 56 to 56" lesson', () => {
    const v = buildMarketVerdict(report(1, 12));

    test('one lead → workable_thin with SINGULAR copy, never "1 qualified leads"', () => {
        expect(v.state).toBe(VERDICT_STATE.WORKABLE_THIN);
        expect(v.headline).toBe('Workable, but thin');
        expect(v.narrative).toContain('One qualified lead');
        expect(v.narrative).not.toMatch(/\b1 qualified leads\b/);
    });

    test('the stat label is singular too', () => {
        const stat = v.stats.find(s => s.key === 'qualifiedLeads');
        expect(stat.label).toBe('Qualified lead');
        expect(stat.value).toBe(1);
    });

    test('no range language is emitted at n=1', () => {
        expect(v.narrative).not.toMatch(/ranging from/i);
        expect(v.narrative).not.toMatch(/between .* and /i);
    });
});

describe('state thresholds', () => {
    test('below strongMinLeads → workable_thin; at or above → strong', () => {
        const min = DEFAULT_VERDICT_THRESHOLDS.strongMinLeads;
        expect(buildMarketVerdict(report(min - 1, 5)).state).toBe(VERDICT_STATE.WORKABLE_THIN);
        expect(buildMarketVerdict(report(min, 5)).state).toBe(VERDICT_STATE.STRONG);
        expect(buildMarketVerdict(report(min + 20, 5)).state).toBe(VERDICT_STATE.STRONG);
    });

    test('the threshold is pack-overridable, same pattern as the pain thresholds', () => {
        const pack = { verdictThresholds: { strongMinLeads: 2 } };
        expect(resolveVerdictThresholds(pack, DEFAULT_VERDICT_THRESHOLDS).strongMinLeads).toBe(2);
        expect(buildMarketVerdict(report(2, 5), { pack }).state).toBe(VERDICT_STATE.STRONG);
        // a null pack yields exactly the defaults
        expect(resolveVerdictThresholds(null, DEFAULT_VERDICT_THRESHOLDS))
            .toEqual(DEFAULT_VERDICT_THRESHOLDS);
        expect(buildMarketVerdict(report(2, 5)).state).toBe(VERDICT_STATE.WORKABLE_THIN);
    });

    test('basis records the threshold actually applied (auditable derivation)', () => {
        const v = buildMarketVerdict(report(3, 7), { pack: { verdictThresholds: { strongMinLeads: 3 } }, leadCandidateCount: 5 });
        expect(v.basis).toMatchObject({
            qualifiedLeads: 3, competitors: 7, candidatesDiscovered: 5,
            excludedByScope: 2, strongMinLeads: 3
        });
    });
});

describe('stats are omitted unless positively measured', () => {
    test('share of voice appears only when measured', () => {
        expect(buildMarketVerdict(report(6, 9)).stats.find(s => s.key === 'leaderVoiceShare')).toBeUndefined();
        const withSov = buildMarketVerdict(report(6, 9, { shareOfVoice: { leaderShare: 43.71, leaderName: 'Alpha' } }));
        expect(withSov.stats.find(s => s.key === 'leaderVoiceShare').value).toBe('43.7%');
    });

    test('a high measured share adds an evidence-backed dominance clause', () => {
        const v = buildMarketVerdict(report(6, 9, { shareOfVoice: { leaderShare: 43.71, leaderName: 'Alpha Co' } }));
        expect(v.narrative).toContain('Alpha Co');
        expect(v.narrative).toContain('44% share of voice');
    });

    test('a LOW share adds no clause, and a share without a name adds no clause', () => {
        expect(buildMarketVerdict(report(6, 9, { shareOfVoice: { leaderShare: 12, leaderName: 'Alpha' } })).narrative)
            .not.toContain('share of voice');
        expect(buildMarketVerdict(report(6, 9, { shareOfVoice: { leaderShare: 80 } })).narrative)
            .not.toContain('share of voice');
    });

    test('the verdict never claims demand health it has no evidence for', () => {
        for (const r of [report(0, 5), report(1, 5), report(9, 5)]) {
            const n = buildMarketVerdict(r).narrative.toLowerCase();
            expect(n).not.toContain('demand is healthy');
            expect(n).not.toContain('structural demand');
        }
    });

    test('competitor stat pluralization', () => {
        expect(buildMarketVerdict(report(2, 1)).stats.find(s => s.key === 'competitors').label).toBe('Competitor');
        expect(buildMarketVerdict(report(2, 5)).stats.find(s => s.key === 'competitors').label).toBe('Competitors');
    });
});

describe('house rules', () => {
    test('no em dashes in any output string', () => {
        for (const r of [report(0, 5), report(0, 5), report(1, 5), report(3, 5), report(9, 5)]) {
            const v = buildMarketVerdict(r, { leadCandidateCount: 4, });
            const strings = [v.headline, v.narrative, v.recommendedAction, ...v.stats.map(s => s.label)];
            for (const s of strings) expect(s).not.toContain('—');
        }
    });

    test('deterministic: the same report always yields the same verdict', () => {
        const r = report(3, 8, { shareOfVoice: { leaderShare: 50, leaderName: 'X' } });
        expect(buildMarketVerdict(r, { leadCandidateCount: 6 }))
            .toEqual(buildMarketVerdict(r, { leadCandidateCount: 6 }));
    });
});

describe('audience classification', () => {
    test('the verdict is merchant-facing (it describes THEIR market, not how to sell anyone)', () => {
        const { isVisibleTo } = require('../services/audienceTags');
        expect(isVisibleTo('marketVerdict', 'merchant')).toBe(true);
    });
});
