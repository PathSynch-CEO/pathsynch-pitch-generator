'use strict';

/**
 * audienceTags.js — Workstream 5b (Aug-19 design review, screen 02 pin 5): "One report, two clean
 * views."
 *
 * The review's finding: Gemini could not separate merchant copy from the internal sales playbook
 * because the source interleaves them. The fix is to tag sections AT GENERATION TIME, so every
 * downstream surface (report view, PDF, deck-source export, the Gemini brief) reads one manifest
 * and cannot drift apart.
 *
 * TWO AUDIENCES
 *   'both'     — market research the prospect may see. The merchant-facing view.
 *   'internal' — the sales playbook: who to sell, what to sell them, when to call.
 *
 * FAIL CLOSED IS THE WHOLE POINT. `defaultAudience` is 'internal': a section absent from the
 * registry is hidden from a merchant, never shown. Showing a prospect the prospect list, or the
 * wedge describing how to sell them, is the failure this module exists to prevent — so an
 * unclassified section errs toward invisible.
 *
 * That default alone would let a new section go unnoticed forever, so the registry is ALSO pinned
 * by a test that reads the real `reportData.*` assignments out of api/market.js: adding a section
 * without classifying it fails the build rather than silently hiding it.
 */

const { REPORT_SCHEMA_VERSION } = require('./evidencePainPoints');

const AUDIENCE = { BOTH: 'both', INTERNAL: 'internal' };

/**
 * Section audience registry. Keys are the report's own data keys — the stable contract both the
 * live view and the exports already read — not display titles.
 *
 * INTERNAL entries follow the review verbatim (merchant-facing "hides Sales Intelligence, entry
 * wedges, and High-Impact Moves") plus the prospect list itself and the product/target-account
 * recommendations, which are the sales side by definition.
 *
 * NOTE the deliberate split: `evidencePainPoints` is BOTH — screen 03 renders "What Does the Pain
 * Cost Them?" inside the merchant-facing frame — while `salesIntel` is INTERNAL, because it wraps
 * those same computed claims with the entry wedge and the best-time-to-call playbook.
 */
const SECTION_AUDIENCE = {
    // ── Market research: safe for the prospect to read (screen 03 is titled "Merchant-facing view")
    executiveSummary: AUDIENCE.BOTH,
    marketDefinition: AUDIENCE.BOTH,
    strategicMarketThesis: AUDIENCE.BOTH,
    kpiScorecard: AUDIENCE.BOTH,
    evidenceLedger: AUDIENCE.BOTH,          // the report showing its own work is the point
    benchmarks: AUDIENCE.BOTH,
    competitors: AUDIENCE.BOTH,
    competitorAnalysis: AUDIENCE.BOTH,
    competitorTypes: AUDIENCE.BOTH,
    referenceCompetitors: AUDIENCE.BOTH,
    positioningMatrix: AUDIENCE.BOTH,
    shareOfVoice: AUDIENCE.BOTH,
    weaknessThemes: AUDIENCE.BOTH,
    weaknessThemesMeta: AUDIENCE.BOTH,
    evidencePainPoints: AUDIENCE.BOTH,      // screen 03 Q3, merchant-facing
    marketSegments: AUDIENCE.BOTH,          // screen 03 Q4, merchant-facing
    demographicsEnriched: AUDIENCE.BOTH,
    demographicsCommunities: AUDIENCE.BOTH,
    demographicBusinessMeaning: AUDIENCE.BOTH,
    safetyContext: AUDIENCE.BOTH,
    structuralGrowth: AUDIENCE.BOTH,
    seoLandscape: AUDIENCE.BOTH,
    seoIntelligence: AUDIENCE.BOTH,
    aiVisibilityIntelligence: AUDIENCE.BOTH,
    websiteConversionSignals: AUDIENCE.BOTH,
    mapPackIntelligence: AUDIENCE.BOTH,      // Visibility layer: competitor SERP ranks — market research
    adSpendIntelligence: AUDIENCE.BOTH,      // Visibility layer: competitor ad presence — market research
    intentSignals: AUDIENCE.BOTH,
    trends: AUDIENCE.BOTH,
    swotAnalysis: AUDIENCE.BOTH,
    strategicRoadmap: AUDIENCE.BOTH,        // advice FOR the merchant
    aiRecommendations: AUDIENCE.BOTH,
    financialSignals: AUDIENCE.BOTH,
    publicSectorIntelligence: AUDIENCE.BOTH,
    nonprofitFinancialIntelligence: AUDIENCE.BOTH,

    // ── The sales playbook: never shown to the prospect
    leads: AUDIENCE.INTERNAL,               // the prospect list itself
    leadCount: AUDIENCE.INTERNAL,
    leadQualification: AUDIENCE.INTERNAL,
    salesIntel: AUDIENCE.INTERNAL,          // pain points + ENTRY WEDGE + best time to call
    highImpactMoves: AUDIENCE.INTERNAL,     // review: explicitly hidden
    productRecommendations: AUDIENCE.INTERNAL,
    enterpriseTargetAccounts: AUDIENCE.INTERNAL
};

/**
 * Keys that are report METADATA, not renderable sections. Listed explicitly so the registry guard
 * can tell "not a section" from "someone forgot to classify this".
 */
const NON_SECTION_KEYS = [
    'id', 'reportSchemaVersion', 'benchmarkId', 'refreshCount', 'refreshedAt',
    'enterpriseMode', 'enterpriseVertical', 'audienceTags'
];

/**
 * Is this section visible to the given audience?
 * Unknown section + merchant audience → false (fail closed). Internal sees everything.
 */
function isVisibleTo(sectionId, audience) {
    if (audience !== 'merchant') return true;            // internal view withholds nothing
    return SECTION_AUDIENCE[sectionId] === AUDIENCE.BOTH;
}

/**
 * Build the manifest persisted on the report, so the live view, the PDF and the deck export all
 * filter from ONE source rather than each re-deciding.
 *
 * @param {object} [reportData] - optional; when given, only sections actually present are listed,
 *                                so a surface never has to distinguish "hidden" from "absent".
 */
function buildAudienceManifest(reportData) {
    const present = (id) => {
        if (!reportData) return true;
        const d = reportData.data || {};
        return reportData[id] !== undefined || d[id] !== undefined;
    };
    const sections = {};
    Object.keys(SECTION_AUDIENCE).forEach(id => {
        if (present(id)) sections[id] = SECTION_AUDIENCE[id];
    });
    return {
        schemaVersion: REPORT_SCHEMA_VERSION,
        defaultAudience: AUDIENCE.INTERNAL,               // fail closed for anything unlisted
        sections,
        internalOnly: Object.keys(sections).filter(id => sections[id] === AUDIENCE.INTERNAL).sort()
    };
}

module.exports = {
    AUDIENCE,
    SECTION_AUDIENCE,
    NON_SECTION_KEYS,
    isVisibleTo,
    buildAudienceManifest
};
