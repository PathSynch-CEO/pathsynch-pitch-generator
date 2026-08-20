'use strict';

/**
 * fix/market-intel-precision-leak-and-discovery-zeroing
 *
 * Two coupled defects on the live 2026-08-20 Atlanta "Junk Removal & Hauling" report
 * (report id G9Ope6tejD79RtbB3NCm — 13 competitors, 0 leads):
 *
 * DEFECT 1 (prompt-text leak): internal steering text was fused into the industry label
 *   (aiIndustryContext = `${industry}${precisionContext}`) and interpolated verbatim into the
 *   zero-lead executive summary by buildZeroLeadSummary:
 *     "...dominates Atlanta Home Services PRECISION FILTER: The user is specifically targeting
 *      \"Residential Cleanouts\" businesses ... Prioritize businesses matching this sub-type.
 *      User's approach preference: All Atlanta Metro Area. with 26793 reviews. No qualified leads..."
 *   Fixes: (a) market.js no longer fuses precisionContext into the label — it threads it through
 *   profileGuidance; (b) buildZeroLeadSummary interpolates only a cleaned label; (c) reportSanitizer
 *   strips instruction markers from customer-facing fields as defense in depth.
 *
 * DEFECT 2 (discovery-side zeroing): the leadQualification block showed candidatesDiscovered=0
 *   (NOT an over-filter — filteredOut=0). Root cause: the supplemental precision answer (q1) was
 *   folded into the Serper DISCOVERY query (`${q1.value} ${industry}` → "Residential Cleanouts
 *   Home Services"), starving discovery to zero while 13 competitors were found via the taxonomy
 *   query. The prior day's identical-param run discovered 10 candidates → 6 leads. Fix (#80 lesson —
 *   supplemental answers may RANK leads, never ELIMINATE them to zero): the discovery query depends
 *   only on the robust taxonomy label, never on the precision answer.
 *
 * These tests FAIL against pre-fix source (the descriptor echoed the fused label; the discovery
 * query embedded q1) and pass once the fixes land.
 */

const { buildLeadDiscoveryQuery } = require('../api/market');
const { generateAIExecutiveSummary } = require('../services/narrativeGenerator');
const { sanitizeReport } = require('../utils/reportSanitizer');
const fx = require('./fixtures/atlantaJunkReport');

// The exact fused label the pre-fix caller produced (industry + precisionContext).
const DIRTY_INDUSTRY_LABEL =
    'Home Services\n' +
    'PRECISION FILTER: The user is specifically targeting "Residential Cleanouts" businesses ' +
    'within the Home Services vertical. Prioritize businesses matching this sub-type.\n' +
    '\n' +
    "User's approach preference: All Atlanta Metro Area.\n";

const MARKER_PHRASES = [
    'PRECISION FILTER',
    'The user is',
    'Prioritize businesses',
    "User's approach preference",
];

function assertNoMarkers(text) {
    MARKER_PHRASES.forEach(p => expect(String(text)).not.toContain(p));
}

describe('Defect 2 — #80: lead discovery query never depends on the precision answer', () => {
    const subCfg = { id: 'junk_removal_hauling', label: 'Junk Removal & Hauling' };

    test('uses the sub-industry label when present', () => {
        expect(buildLeadDiscoveryQuery(subCfg, 'Home Services')).toBe('Junk Removal & Hauling');
    });

    test('falls back to the display industry label when no sub-industry config', () => {
        expect(buildLeadDiscoveryQuery(null, 'Home Services')).toBe('Home Services');
        expect(buildLeadDiscoveryQuery({}, 'Home Services')).toBe('Home Services');
    });

    test('signature ignores supplemental precision answers (arity 2 — no q1 coupling)', () => {
        // A regression guard: re-introducing `${q1.value} ${industry}` would require adding the
        // precision answer as a parameter. The query must be a pure function of the taxonomy label.
        expect(buildLeadDiscoveryQuery.length).toBe(2);
        // Whatever the user answered, discovery is identical — it can never be starved to zero.
        const q = buildLeadDiscoveryQuery(subCfg, 'Home Services');
        expect(q).not.toContain('Residential Cleanouts');
        expect(q).toBe('Junk Removal & Hauling');
    });
});

describe('Defect 1 — zero-lead descriptor interpolates only a clean label', () => {
    test('n=0 with a DIRTY fused industry label echoes NO prompt-context text', async () => {
        const summary = await generateAIExecutiveSummary(
            'Atlanta', DIRTY_INDUSTRY_LABEL, fx.competitors, [], [], fx.benchmarks,
            '', { leadCandidateCount: 0 }
        );
        expect(summary).toBeTruthy();
        assertNoMarkers(summary);
        // The clean human-readable label survives; the honest zero-lead statement is present.
        expect(summary).toContain('Home Services');
        expect(summary.toLowerCase()).toContain('no qualified leads');
    });

    test('n=0 WITH candidates + dirty label: filtering outcome stated, still no markers', async () => {
        const summary = await generateAIExecutiveSummary(
            'Atlanta', DIRTY_INDUSTRY_LABEL, fx.competitors, [], [], fx.benchmarks,
            '', { leadCandidateCount: 7 }
        );
        assertNoMarkers(summary);
        expect(summary).toContain('7');
        expect(summary.toLowerCase()).toContain('filtering outcome');
        expect(summary).toContain('Home Services');
    });

    test('a clean label is passed through unchanged (no over-stripping)', async () => {
        const summary = await generateAIExecutiveSummary(
            'Atlanta', 'Junk Removal & Hauling', fx.competitors, [], [], fx.benchmarks,
            '', { leadCandidateCount: 0 }
        );
        expect(summary).toContain('Junk Removal & Hauling');
        assertNoMarkers(summary);
    });
});

describe('Defect 1 — reportSanitizer strips instruction markers (defense in depth)', () => {
    // The exact production executiveSummary leak, reproduced verbatim.
    const PRODUCTION_LEAK =
        '1-800-GOT-JUNK? Atlanta Westside dominates Atlanta Home Services\n' +
        'PRECISION FILTER: The user is specifically targeting "Residential Cleanouts" businesses ' +
        'within the Home Services vertical. Prioritize businesses matching this sub-type.\n' +
        '\n' +
        "User's approach preference: All Atlanta Metro Area.\n" +
        ' with 26793 reviews. No qualified leads were identified in this market.';

    test('strips markers from executiveSummary, keeps real narrative, flags the report', () => {
        const report = {
            executiveSummary: PRODUCTION_LEAK,
            data: {
                benchmarks: { marketLeader: '1-800-GOT-JUNK? Atlanta Westside', avgRating: 4.4, avgReviews: 2431, medianReviews: 2431 },
                competitors: fx.competitors,
                leads: []
            }
        };
        sanitizeReport(report, new Date('2026-08-20T13:04:29Z'));

        assertNoMarkers(report.executiveSummary);
        expect(report.executiveSummary).toContain('26793 reviews');
        expect(report.executiveSummary).toContain('No qualified leads were identified in this market');
        expect(report._instructionMarkersStripped).toBe(true);
    });

    test('strips markers from competitorAnalysis and strategicMarketThesis.thesis too', () => {
        const report = {
            executiveSummary: 'Clean summary — 6 qualified leads identified.',
            strategicMarketThesis: { thesis: 'Structural gap exists.\nPrioritize businesses matching this sub-type.' },
            data: {
                competitorAnalysis: 'The field is fragmented.\nThe user is specifically targeting residential accounts.',
                benchmarks: { marketLeader: 'Acme', avgRating: 4.4, avgReviews: 100, medianReviews: 100 },
                competitors: fx.competitors,
                leads: fx.qualifiedLeads
            }
        };
        sanitizeReport(report, new Date('2026-08-20T13:04:29Z'));

        assertNoMarkers(report.data.competitorAnalysis);
        assertNoMarkers(report.strategicMarketThesis.thesis);
        expect(report.data.competitorAnalysis).toContain('The field is fragmented.');
        expect(report.strategicMarketThesis.thesis).toContain('Structural gap exists.');
        expect(report._instructionMarkersStripped).toBe(true);
    });

    test('strips markers from salesIntel prose (entryWedge, talkingPoints) and High-Impact Moves', () => {
        const report = {
            executiveSummary: 'Clean summary.',
            data: {
                salesIntel: {
                    entryWedge: 'Open with the market gap. Prioritize businesses matching this sub-type.',
                    talkingPoints: [
                        'Clean talking point one.',
                        "The user is specifically targeting residential cleanouts.",
                        'Clean talking point three.'
                    ],
                    competitorVulnerability: 'Acme is slow. PRECISION FILTER: focus here.'
                },
                highImpactMoves: [
                    { title: 'Target the gap', context: 'Real context. Prioritize businesses matching this sub-type.', action: 'Call Delerme CPA', timing: 'This week', expectedOutcome: '2 demos' }
                ],
                benchmarks: { marketLeader: 'Acme', avgRating: 4.4, avgReviews: 100, medianReviews: 100 },
                competitors: fx.competitors,
                leads: fx.qualifiedLeads
            }
        };
        sanitizeReport(report, new Date('2026-08-20T13:04:29Z'));

        const si = report.data.salesIntel;
        assertNoMarkers(si.entryWedge);
        expect(si.entryWedge).toContain('Open with the market gap.');
        si.talkingPoints.forEach(tp => assertNoMarkers(tp));
        // Clean talking points survive; the marker-bearing one is scrubbed (kept as a cleaned string or emptied).
        expect(si.talkingPoints).toContain('Clean talking point one.');
        expect(si.talkingPoints).toContain('Clean talking point three.');
        assertNoMarkers(si.competitorVulnerability);
        expect(si.competitorVulnerability).toContain('Acme is slow.');

        const move = report.data.highImpactMoves[0];
        assertNoMarkers(move.context);
        expect(move.context).toContain('Real context.');
        expect(move.action).toBe('Call Delerme CPA');
        expect(report._instructionMarkersStripped).toBe(true);
    });

    test('clean report is untouched and NOT flagged', () => {
        const clean = 'Riverwood Dental leads the Atlanta market with 1538 reviews. 6 qualified leads identified.';
        const report = {
            executiveSummary: clean,
            data: {
                benchmarks: { marketLeader: 'Riverwood Dental', avgRating: 4.7, avgReviews: 666, medianReviews: 666 },
                competitors: fx.competitors,
                leads: fx.qualifiedLeads
            }
        };
        sanitizeReport(report, new Date('2026-08-20T13:04:29Z'));

        expect(report.executiveSummary).toBe(clean);
        expect(report._instructionMarkersStripped).toBeUndefined();
    });
});
