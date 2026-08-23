'use strict';

/**
 * marketVerdict.js — Workstream 6a (Aug-19 design review, screen 02 pin 4): "The report can say no."
 *
 * Replaces an always-positive opportunity score with an honest verdict in three states, each
 * carrying a recommended next action:
 *   strong             — enough prospecting surface to justify working the market
 *   workable_thin      — real but small; widen before committing
 *   not_worth_working  — nothing to work at this radius right now
 *
 * The review's specific lesson: "At n=1 the old exec summary rendered 'ranging from 56 to 56.'
 * The verdict template has explicit n=0 and n=1 branches, the lesson from the v4 zero-lead
 * regression." Both branches are explicit here, including singular grammar at n=1.
 *
 * Deterministic and template-bound (no Gemini, same posture as evidencePainPoints and
 * competitiveWeaknesses), so no hedging phrase can reach output by construction. Every stat is
 * omitted unless positively measured: the verdict never invents a number to fill its own card.
 *
 * It also preserves the distinction buildZeroLeadSummary established (PR #82): zero leads because
 * candidates were FILTERED as off-profile is a filtering outcome, not a confirmed empty market,
 * and the two produce different narratives and different recommended actions.
 *
 * No em dashes in any output string (house rule).
 */

const { REPORT_SCHEMA_VERSION } = require('./evidencePainPoints');

const STATE = {
    STRONG: 'strong',
    WORKABLE_THIN: 'workable_thin',
    NOT_WORTH_WORKING: 'not_worth_working'
};

const HEADLINE = {
    [STATE.STRONG]: 'Strong',
    [STATE.WORKABLE_THIN]: 'Workable, but thin',
    [STATE.NOT_WORTH_WORKING]: 'Not worth working now'
};

// Pack-overridable, same pattern as DEFAULT_PAIN_THRESHOLDS: a vertical where a rep needs more (or
// fewer) prospects to justify a territory day can tune this without touching code.
const DEFAULT_VERDICT_THRESHOLDS = {
    strongMinLeads: 5      // >= this many qualified leads is a workable territory
};

function toInt(v) { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : null; }
function toNum(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }

function resolveVerdictThresholds(pack, defaults) {
    const base = defaults || DEFAULT_VERDICT_THRESHOLDS;
    const overrides = (pack && pack.verdictThresholds) || {};
    const out = {};
    for (const key of Object.keys(base)) {
        out[key] = overrides[key] != null ? overrides[key] : base[key];
    }
    return out;
}

/**
 * Build the market verdict.
 *
 * @param {object} reportData - full report object (read-only)
 * @param {object} [options]
 *   - leadCandidateCount {number} pre-filter discovery count (distinguishes filtered from empty)
 *   - pack {object|null}          question pack, for verdictThresholds overrides
 *   - thresholds {object}         explicit override (tests)
 * @returns {object} verdict (always returned: "no verdict" is not an option; the report must
 *                   be able to say no)
 */
function buildMarketVerdict(reportData, options) {
    const opts = options || {};
    const d = (reportData && reportData.data) || {};
    const t = opts.thresholds || resolveVerdictThresholds(opts.pack, DEFAULT_VERDICT_THRESHOLDS);

    const leads = Array.isArray(d.leads) ? d.leads.length : 0;
    const competitors = Array.isArray(d.competitors) ? d.competitors.length : 0;
    const candidates = toInt(opts.leadCandidateCount);
    // Candidates discovered but dropped by the business-type / scope filter. Only meaningful when
    // the pre-filter count is known AND exceeds what survived.
    const excludedByScope = (candidates != null && candidates > leads) ? candidates - leads : null;

    const sov = d.shareOfVoice || {};
    const leaderShare = toNum(sov.leaderShare);
    const leaderName = (typeof sov.leaderName === 'string' && sov.leaderName) ? sov.leaderName : null;

    // ── State ────────────────────────────────────────────────────────────────
    let state;
    if (leads === 0) state = STATE.NOT_WORTH_WORKING;
    else if (leads < t.strongMinLeads) state = STATE.WORKABLE_THIN;
    else state = STATE.STRONG;

    // ── Narrative: explicit n=0 and n=1 branches, singular grammar at n=1 ────
    let narrative;
    let recommendedAction;
    if (leads === 0) {
        if (excludedByScope != null && excludedByScope > 0) {
            narrative = `No qualified leads matched the business-type criteria in this market. `
                + `${excludedByScope} candidate${excludedByScope === 1 ? ' was' : 's were'} discovered and filtered as off profile, `
                + `so this is a filtering outcome rather than a confirmed empty market.`;
            recommendedAction = 'Widen the sub-industry or review the discovery pool before concluding this market is empty.';
        } else {
            narrative = 'Discovery returned no businesses matching this profile, so there is no lead set to prioritize.';
            recommendedAction = 'Try a wider radius or an adjacent sub-industry.';
        }
    } else if (leads === 1) {
        narrative = 'One qualified lead in this market. The prospecting surface is small, '
            + 'so the market is workable but should not carry a territory on its own.';
        recommendedAction = 'Widen the radius or run an adjacent sub-industry before working this market.';
    } else if (state === STATE.WORKABLE_THIN) {
        narrative = `${leads} qualified leads in this market, below the ${t.strongMinLeads} that make a territory worth working on its own.`;
        recommendedAction = 'Widen the radius or run an adjacent sub-industry before working this market.';
    } else {
        narrative = `${leads} qualified leads in this market, enough prospecting surface to work it directly.`;
        recommendedAction = 'Work the qualified leads in priority order.';
    }

    // Evidence-backed dominance clause. Added ONLY when share of voice was measured; never a
    // claim about demand health, which this section has no evidence for.
    if (leaderShare != null && leaderName && leaderShare >= 40 && leads > 0) {
        narrative += ` Discovery concentrates on ${leaderName} at ${Math.round(leaderShare)}% share of voice.`;
    }

    // ── Stats: omitted unless positively measured ────────────────────────────
    const stats = [
        { key: 'qualifiedLeads', label: leads === 1 ? 'Qualified lead' : 'Qualified leads', value: leads },
        { key: 'competitors', label: competitors === 1 ? 'Competitor' : 'Competitors', value: competitors }
    ];
    if (excludedByScope != null && excludedByScope > 0) {
        stats.push({ key: 'excludedByScope', label: 'Excluded by scope', value: excludedByScope });
    }
    if (leaderShare != null) {
        stats.push({ key: 'leaderVoiceShare', label: 'Leader voice share', value: `${Math.round(leaderShare * 10) / 10}%` });
    }

    return {
        schemaVersion: REPORT_SCHEMA_VERSION,
        state,
        headline: HEADLINE[state],
        narrative,
        recommendedAction,
        stats,
        // Auditable derivation: every input the state and copy were computed from.
        basis: {
            qualifiedLeads: leads,
            competitors,
            candidatesDiscovered: candidates,
            excludedByScope,
            leaderVoiceShare: leaderShare,
            strongMinLeads: t.strongMinLeads
        }
    };
}

module.exports = {
    buildMarketVerdict,
    resolveVerdictThresholds,
    DEFAULT_VERDICT_THRESHOLDS,
    VERDICT_STATE: STATE,
    VERDICT_HEADLINE: HEADLINE
};
