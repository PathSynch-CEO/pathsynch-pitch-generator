'use strict';

/**
 * himProvenanceGate.js — PR-C2 provenance gate for High-Impact Moves (and person names in
 * salesIntel prose). REDESIGNED for #92 (anchor-based) after #91's shape-based version was found to
 * corrupt legitimate prose.
 *
 * The defect being gated is NOT fabrication — Gemini often recalls REAL owners/businesses from
 * training — but names/businesses arriving with ZERO pipeline provenance.
 *
 * #91's approach classified ANY Title-Case 2–3-word phrase as a person and rewrote it, so
 * "Google Business Profile" → "Google the business owner", "Landing Page" → "the business owner",
 * and generic-suffix phrases dropped whole moves. That is worse than the defect.
 *
 * #92 is ANCHOR-BASED, never shape-based:
 *   • A phrase is only treated as a PERSON if it matches (honorific/surname/possessive-normalized) a
 *     name in the anchor set = (i) the enrichment `decisionMaker` set ∪ (ii) the candidate-name list
 *     Gemini was actually steered with. A verified name is kept; a steered-but-unverified candidate is
 *     rewritten to the business role. A phrase matching NOTHING in the anchor set is NEVER touched.
 *   • BUSINESSES are only recognized by matching KNOWN names (in-set leads/competitors or a news-signal
 *     entity). There is NO suffix-shape detection, so a legitimate phrase can never be rewritten or
 *     dropped as an "out-of-set business."
 *
 * ACCEPTED, EXPLICIT coverage reduction: because the generators are steered only with VERIFIED
 * decisionMaker names, the candidate set equals the verified set in the current pipeline, so the gate
 * performs ZERO rewrites/drops on real reports — an unverified recalled name (or an out-of-set
 * business) now SHIPS. That is a smaller failure than corrupted prose, and the race fix (real names in
 * the prompt) is the primary defense. The rewrite machinery remains for the day a steered-but-
 * unverified candidate list exists.
 */

// Business set-membership normalization (mirrors market.js normalizeBusinessName).
function normalizeName(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'mx', 'dr', 'prof', 'sir', 'madam', 'mme', 'rev']);

// Person-name normalization: strip a leading honorific and a trailing possessive, keep alnum tokens.
// "Mr. Tabb" -> "tabb"; "Ryan Tabb's" -> "ryan tabb"; "Dr. Rima Patel" -> "rima patel".
function normPerson(s) {
    let toks = String(s == null ? '' : s)
        .toLowerCase()
        .replace(/[’']s\b/g, '')          // possessive
        .replace(/[^a-z0-9\s.]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .map(t => t.replace(/\.$/, ''))
        .filter(Boolean);
    // drop a single leading honorific
    if (toks.length > 1 && HONORIFICS.has(toks[0])) toks = toks.slice(1);
    return toks.join(' ');
}

// Does a normalized text-mention name refer to the same person as a normalized anchor name?
//   • A BARE single token (surname or first name, >= 3 chars) matches if it equals any anchor token —
//     "Tabb"/"Mr. Tabb" both normalize to "tabb" and match "Ryan Tabb".
//   • Two FULL names match only when the FIRST names agree AND the surnames agree (or one surname is an
//     initial of the other) — so "Bob Tabb" does NOT match "Ryan Tabb" (same surname, different person).
function personMatches(mentionNorm, anchorNorm) {
    if (!mentionNorm || !anchorNorm) return false;
    if (mentionNorm === anchorNorm) return true;
    const m = mentionNorm.split(' ').filter(Boolean);
    const a = anchorNorm.split(' ').filter(Boolean);
    if (!m.length || !a.length) return false;
    if (m.length === 1) return m[0].length >= 3 && a.includes(m[0]);
    if (a.length === 1) return a[0].length >= 3 && m.includes(a[0]);
    // both are full names → require same first name, then same surname or a surname-initial match
    if (m[0] !== a[0]) return false;
    const ms = m[m.length - 1], as = a[a.length - 1];
    if (ms === as) return true;
    if (ms.length <= 2 && as.startsWith(ms)) return true;   // "ryan t" ~ "ryan tabb"
    if (as.length <= 2 && ms.startsWith(as)) return true;
    return false;
}

const MOVE_TEXT_FIELDS = ['title', 'context', 'action', 'timing', 'expectedOutcome'];

function buildContext(ctx) {
    ctx = ctx || {};
    const businesses = new Map(); // normalized -> display
    const addBiz = (name) => { const n = normalizeName(name); if (n && !businesses.has(n)) businesses.set(n, name); };
    (ctx.leads || []).forEach(l => l && addBiz(l.name));
    (ctx.competitors || []).forEach(c => c && addBiz(c.name));

    const newsTitlesNorm = (ctx.newsSignals || [])
        .map(s => normalizeName(typeof s === 'string' ? s : (s && (s.title || s.headline)) || ''))
        .filter(Boolean);

    // (i) Verified names — the ONLY provenance-backed set (search-grounded decisionMaker enrichment).
    const verifiedNames = new Set();
    (ctx.leads || []).forEach(l => {
        const dm = l && l.decisionMaker;
        if (!dm) return;
        [dm.name, dm.buyer].concat((dm.contacts || []).map(c => c && c.name)).forEach(nm => {
            const n = normPerson(nm); if (n) verifiedNames.add(n);
        });
    });
    // (ii) Candidate names — what Gemini was steered with. Defaults to the verified set (that is what
    // the generators inject as "DM: <name>"). Only candidates NOT in the verified set are ever rewritten.
    const candidateNames = new Set(verifiedNames);
    (ctx.candidateNames || []).forEach(nm => { const n = normPerson(nm); if (n) candidateNames.add(n); });

    return { businesses, newsTitlesNorm, verifiedNames, candidateNames };
}

function isAllowedBusiness(phraseNorm, c) {
    if (!phraseNorm) return true;
    if (c.businesses.has(phraseNorm)) return true;
    for (const norm of c.businesses.keys()) {
        if (norm.includes(phraseNorm) || phraseNorm.includes(norm)) return true;
    }
    if (c.newsTitlesNorm.some(t => t.includes(phraseNorm))) return true;
    return false;
}

function isVerifiedPerson(mentionNorm, c) {
    for (const v of c.verifiedNames) if (personMatches(mentionNorm, v)) return true;
    return false;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Build a matcher for a specific anchor name: the full name, or an honorific + surname, each with an
// optional possessive. Anchored to word boundaries. Used ONLY to rewrite steered-but-unverified
// candidates — never for open-ended phrase discovery.
function buildNameRegex(anchorNorm) {
    const toks = anchorNorm.split(' ').filter(Boolean);
    if (!toks.length) return null;
    const surname = toks[toks.length - 1];
    const full = toks.map(escapeRe).join('\\s+');
    const hon = '(?:(?:mr|mrs|ms|mx|dr|prof|sir|rev)\\.?\\s+)?';
    const alts = [full];
    if (surname.length >= 3) alts.push('(?:' + hon + escapeRe(surname) + ')');
    return new RegExp('\\b(?:' + alts.join('|') + ")(?:[’']s)?\\b", 'gi');
}

/**
 * Gate a single move. Only rewrites steered-but-unverified person names; never touches businesses or
 * unknown phrases. Returns { move, changed, drop:false, reasons[] }.
 */
function processMove(move, c) {
    if (!move || typeof move !== 'object') return { move, changed: false, drop: false, reasons: [] };
    const out = Object.assign({}, move);
    const reasons = [];
    let changed = false;

    // Anchor business for the role reference = the longest KNOWN in-set business named in this move.
    const moveNorm = normalizeName(MOVE_TEXT_FIELDS.map(f => out[f] || '').join(' '));
    let anchorBiz = null, anchorLen = -1;
    for (const [norm, display] of c.businesses) {
        if (norm && moveNorm.includes(norm) && norm.length > anchorLen) { anchorBiz = display; anchorLen = norm.length; }
    }
    const roleRef = anchorBiz ? `the owner of ${anchorBiz}` : 'the business owner';

    // Steered-but-unverified candidates are the ONLY names eligible for rewrite. Empty when the
    // generators were steered only with verified names (the current pipeline) → this loop is a no-op.
    const unverified = [];
    for (const cand of c.candidateNames) if (!isVerifiedPerson(cand, c)) unverified.push(cand);

    if (unverified.length > 0) {
        for (const field of MOVE_TEXT_FIELDS) {
            if (typeof out[field] !== 'string' || !out[field]) continue;
            for (const cand of unverified) {
                const re = buildNameRegex(cand);
                if (!re) continue;
                out[field] = out[field].replace(re, (m) => {
                    // Never rewrite a mention that resolves to a VERIFIED person (surname collision guard).
                    if (isVerifiedPerson(normPerson(m), c)) return m;
                    changed = true;
                    reasons.push(`unverified steered name "${m.trim()}" → "${roleRef}"`);
                    return roleRef;
                });
            }
            out[field] = out[field].replace(/\b(the owner of [^.,;]+?) at \1\b/gi, '$1');
        }
    }

    return { move: out, changed, drop: false, reasons };
}

/**
 * Gate High-Impact Moves. ctx = { leads, competitors, newsSignals, candidateNames? }.
 * Anchor-based: never drops a move and never rewrites businesses or unknown phrases.
 * Returns { moves, changed, dropped, rewrites, floorMet }.
 */
function gateHighImpactMoves(moves, ctx) {
    if (!Array.isArray(moves)) return { moves: moves, changed: false, dropped: 0, rewrites: 0, floorMet: false };
    const c = buildContext(ctx);
    const survivors = [];
    let rewrites = 0;
    for (const move of moves) {
        const r = processMove(move, c);
        if (r.changed) rewrites++;
        survivors.push(r.move);
    }
    return { moves: survivors, changed: rewrites > 0, dropped: 0, rewrites, floorMet: survivors.length >= 2 };
}

/**
 * Gate PERSON names only, in salesIntel prose. Same anchor-based rule: rewrite only steered-but-
 * unverified candidate names; never touch businesses or unknown phrases.
 */
function gateSalesIntelNames(salesIntel, ctx) {
    if (!salesIntel || typeof salesIntel !== 'object') return { salesIntel, changed: false };
    const c = buildContext(ctx);
    const out = Object.assign({}, salesIntel);
    let changed = false;

    const unverified = [];
    for (const cand of c.candidateNames) if (!isVerifiedPerson(cand, c)) unverified.push(cand);
    if (unverified.length === 0) return { salesIntel: out, changed: false };

    const scrubString = (str) => {
        if (typeof str !== 'string' || !str) return str;
        let s = str;
        for (const cand of unverified) {
            const re = buildNameRegex(cand);
            if (!re) continue;
            s = s.replace(re, (m) => {
                if (isVerifiedPerson(normPerson(m), c)) return m;
                changed = true;
                return 'the business owner';
            });
        }
        return s;
    };

    ['entryWedge', 'competitorVulnerability', 'bestTimeToCall'].forEach(f => {
        const v = scrubString(out[f]);
        if (v !== out[f]) out[f] = v;
    });
    if (Array.isArray(out.talkingPoints)) out.talkingPoints = out.talkingPoints.map(tp => scrubString(tp));

    return { salesIntel: out, changed };
}

module.exports = {
    gateHighImpactMoves,
    gateSalesIntelNames,
    // exported for unit tests
    normalizeName,
    normPerson,
    personMatches,
    isVerifiedPerson,
    isAllowedBusiness,
    buildContext,
    processMove
};
