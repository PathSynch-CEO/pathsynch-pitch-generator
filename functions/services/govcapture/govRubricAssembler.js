'use strict';

/**
 * govRubricAssembler.js — Merchant rubric assembler (PR-C5 Phase 1, Gate 1a).
 *
 * Rubric = DATA, never prompt code. This assembles a labeled "merchant rubric"
 * reference block for the evaluator (Pass B) from data the customer has already
 * entered — gov profile credentials/rank fields + the shared sellerProfile value
 * proposition — plus one optional free-text field (rubricNotes). At most one new
 * field; onboarded customers get a working custom rubric with no new forms.
 *
 * SECURITY: the returned text is reference data injected into a delimited block
 * of the fixed scaffold. To prevent a hostile field value from forging the block
 * boundary or posing as instructions, every value is sanitized (delimiter tokens
 * stripped, control chars removed) and the whole block is length-capped. The
 * output SCHEMA is enforced by generateStructured regardless of rubric content.
 */

const crypto = require('crypto');

// Distinctive block delimiters — stripped from any field value so rubric text
// cannot forge the boundary.
const OPEN_DELIM  = '<<<MERCHANT_RUBRIC>>>';
const CLOSE_DELIM = '<<<END_MERCHANT_RUBRIC>>>';

const MAX_BLOCK_LEN   = 4000;
const MAX_FIELD_LEN   = 800;
const MAX_LIST_ITEMS  = 8;
const MAX_PAST_PERF   = 5;

/**
 * Neutralize a value for safe inclusion as reference data.
 * - coerces to string, strips control chars
 * - removes the delimiter tokens (case-insensitive) so it can't break out
 * - collapses whitespace, caps length
 */
function _sanitize(value, maxLen = MAX_FIELD_LEN) {
    if (value == null) return '';
    let s = String(value);
    // Strip control characters (keep normal whitespace, normalized below).
    s = s.replace(/[\x00-\x1F\x7F]+/g, ' ');
    // Remove anything resembling the block delimiters (defeats boundary forging).
    s = s.replace(/<{2,}\s*\/?\s*(end[_ ]?)?merchant[_ ]?rubric\s*>{2,}/gi, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    if (s.length > maxLen) s = s.slice(0, maxLen) + '…';
    return s;
}

function _list(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(v => _sanitize(v)).filter(Boolean).slice(0, MAX_LIST_ITEMS);
}

/**
 * Assemble the merchant rubric block.
 *
 * @param {object} params
 * @param {object} [params.govProfile]     — govProfiles doc
 * @param {object} [params.sellerProfile]  — users/{uid}.sellerProfile
 * @returns {{ text: string|null, version: string, sources: string[] }}
 *   text: the block WITHOUT delimiters (evaluator wraps it), or null when empty.
 *   version: short content hash ('none' when text is null).
 */
function assembleRubric(params = {}) {
    const gp = params.govProfile || {};
    const sp = params.sellerProfile || {};
    const creds = gp.credentials || {};
    const vp = sp.valueProposition || {};

    const sections = [];
    const sources = [];

    // Certifications held.
    const certs = _list(creds.certifications);
    if (certs.length) { sections.push(`Certifications held: ${certs.join(', ')}.`); sources.push('certifications'); }

    // Set-aside eligibility.
    const setAsides = _list(creds.setAsideEligibility);
    if (setAsides.length) { sections.push(`Set-aside eligibility: ${setAsides.join(', ')}.`); sources.push('setAsideEligibility'); }

    // Past performance (client names + short detail).
    if (Array.isArray(creds.pastPerformance) && creds.pastPerformance.length) {
        const pp = creds.pastPerformance
            .map(e => {
                const name = _sanitize(e && (e.clientName || e.client || e.name), 120);
                const desc = _sanitize(e && (e.description || e.summary), 200);
                if (!name) return '';
                return desc ? `${name} (${desc})` : name;
            })
            .filter(Boolean)
            .slice(0, MAX_PAST_PERF);
        if (pp.length) { sections.push(`Relevant past performance: ${pp.join('; ')}.`); sources.push('pastPerformance'); }
    }

    // Differentiators / value proposition (shared sellerProfile).
    const diff = _sanitize(vp.differentiator);
    const usps = _list(vp.uniqueSellingPoints);
    const benefits = _list(vp.keyBenefits);
    const vpParts = [];
    if (diff) vpParts.push(`Differentiator: ${diff}.`);
    if (usps.length) vpParts.push(`Unique selling points: ${usps.join('; ')}.`);
    if (benefits.length) vpParts.push(`Key benefits: ${benefits.join('; ')}.`);
    if (vpParts.length) { sections.push(`Win themes — ${vpParts.join(' ')}`); sources.push('valueProposition'); }

    // Strategic emphasis (PR-C1 rank fields).
    const rankParts = [];
    const ideal = _sanitize(gp.rankIdealSolutions);
    const cust  = _sanitize(gp.rankIdealCustomer);
    const geo   = _sanitize(gp.rankIdealGeography);
    const avoid = _sanitize(gp.rankAvoid);
    if (ideal) rankParts.push(`Ideal solutions: ${ideal}.`);
    if (cust)  rankParts.push(`Ideal customer: ${cust}.`);
    if (geo)   rankParts.push(`Ideal geography: ${geo}.`);
    if (avoid) rankParts.push(`Avoids: ${avoid}.`);
    if (rankParts.length) { sections.push(`Strategic emphasis — ${rankParts.join(' ')}`); sources.push('rankFields'); }

    // Explicit rubric notes (the one new optional field).
    const notes = _sanitize(gp.rubricNotes);
    if (notes) { sections.push(`Additional rubric notes: ${notes}.`); sources.push('rubricNotes'); }

    if (!sections.length) {
        return { text: null, version: 'none', sources: [] };
    }

    let text = sections.join('\n');
    if (text.length > MAX_BLOCK_LEN) text = text.slice(0, MAX_BLOCK_LEN) + '…';

    const version = crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
    return { text, version, sources };
}

/**
 * Wrap assembled rubric text in the delimited reference block for prompt
 * injection. Returns '' when there is no rubric (→ generic scaffold only).
 */
function wrapRubricBlock(text) {
    if (!text) return '';
    return `${OPEN_DELIM}\n${text}\n${CLOSE_DELIM}`;
}

module.exports = {
    assembleRubric,
    wrapRubricBlock,
    OPEN_DELIM,
    CLOSE_DELIM,
    MAX_BLOCK_LEN,
    _sanitize,
};
