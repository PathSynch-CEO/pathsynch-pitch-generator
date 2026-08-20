'use strict';

/**
 * himProvenanceGate.js — PR-C2 provenance gate for High-Impact Moves (and person names in
 * salesIntel prose).
 *
 * The defect this closes is NOT fabrication — Gemini often recalls REAL owners/businesses from
 * training data. It is that those names/businesses arrive with ZERO pipeline provenance, so a
 * correct-by-memorization answer is indistinguishable from a guess and can go stale or collide.
 *
 * Two deterministic guarantees, applied AFTER Gemini generation:
 *   1. Person names render ONLY if backed by pipeline enrichment (leads[].decisionMaker — which is
 *      Serper/website/TheOrg search-grounded). An unbacked, model-recalled name is rewritten to the
 *      business-role reference ("the owner of <business>") — never a bare unverified name, never a hedge.
 *   2. Every business named in a HIM move must exist in the analyzed set (leads + competitors +
 *      news-signal entities). An out-of-set business is rewritten to an in-set one when the move's
 *      logic survives (another in-set business anchors the move); otherwise the move is DROPPED.
 *      No filler: HIM renders the survivors even if fewer than two remain.
 */

// Mirrors market.js normalizeBusinessName so set membership matches the rest of the pipeline.
function normalizeName(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Tokens that mark a proper-noun phrase as a BUSINESS. Deliberately EXCLUDES generic service/category
// words (junk, cleanout, dumpster, removal-as-a-service, moving, waste, ...) that appear in service
// phrases like "Residential Cleanout" and would cause false positives. Kept: distinctive legal
// suffixes + brand-shaped words that reliably mark a company NAME. In-set businesses that happen to
// contain a category word are still recognized by the allowed-set substring match, not this list.
const BUSINESS_TOKENS = new Set([
    'hauling', 'haulers', 'removal', 'removals', 'llc', 'inc', 'incorporated', 'corp', 'corporation',
    'company', 'group', 'brands', 'brand', 'enterprises', 'solutions', 'systems', 'partners',
    'associates', 'holdings', 'ventures', 'industries', 'logistics', 'pros', 'tycoons', 'king',
    'kings', 'squad', 'luggers', 'sons'
]);

// Capitalized words that are NOT entities — sentence-initial verbs, connectors, geography, products,
// time terms. A phrase's LEADING run of these is stripped before classification (so "Message Bob
// Roberts" classifies on "Bob Roberts"), and a person phrase containing any of them is rejected.
// Kept lowercase; compared against lowercased tokens.
const NON_ENTITY_TOKENS = new Set([
    // verbs that commonly start a HIM sentence / precede an entity
    'pitch', 'show', 'offer', 'target', 'leverage', 'capitalize', 'pivot', 'directly', 'following',
    'message', 'call', 'contact', 'email', 'engage', 'approach', 'reach', 'connect', 'ask', 'tell',
    'invite', 'book', 'send', 'schedule', 'scheduled', 'convert', 'convince', 'position', 'poach',
    // connectors / determiners / time / geography / products already appearing capitalized
    'before', 'after', 'with', 'during', 'week', 'weeks', 'month', 'initial', 'agreement',
    'conversion', 'audit', 'health', 'check', 'residential', 'commercial', 'home', 'google',
    'pathsynch', 'atlanta', 'cobb', 'county', 'georgia', 'ga', 'the', 'a', 'an', 'pre', 'post',
    'winter', 'summer', 'spring', 'fall', 'autumn', 'january', 'february', 'march', 'april', 'may',
    'june', 'july', 'august', 'september', 'october', 'november', 'december', 'hq', 'usa', 'us'
]);

const MOVE_TEXT_FIELDS = ['title', 'context', 'action', 'timing', 'expectedOutcome'];

// A proper-noun phrase: a run of 1+ capitalized/number tokens, allowing lowercase connectors
// (for/of/and/the/&) BETWEEN capitalized tokens. Captures "EZ Atlanta Junk Removal",
// "Junk Hauling For Less", "Junk King Gwinnett", "The Junk Tycoons", "Ryan Tabb", "Authority Brands".
const PHRASE_RE = /\b[A-Z0-9][A-Za-z0-9.'&-]*(?:\s+(?:for|of|and|the|&|de|la)\s+[A-Z0-9][A-Za-z0-9.'&-]*|\s+[A-Z0-9][A-Za-z0-9.'&-]*)*/g;

function tokensOf(phrase) {
    return normalizeName(phrase).split(' ').filter(Boolean);
}

function hasBusinessToken(phrase) {
    return tokensOf(phrase).some(t => BUSINESS_TOKENS.has(t));
}

// A person phrase: exactly 2–3 tokens, none a business token, none a non-entity/stopword token.
function looksLikePerson(phrase) {
    const toks = tokensOf(phrase);
    if (toks.length < 2 || toks.length > 3) return false;
    if (toks.some(t => BUSINESS_TOKENS.has(t))) return false;
    if (toks.some(t => NON_ENTITY_TOKENS.has(t))) return false;
    // Reject pure-number tokens (e.g. "1 800").
    if (toks.some(t => /^\d+$/.test(t))) return false;
    return true;
}

function buildContext(ctx) {
    ctx = ctx || {};
    const businesses = new Map(); // normalized -> display
    const addBiz = (name) => {
        const n = normalizeName(name);
        if (n && !businesses.has(n)) businesses.set(n, name);
    };
    (ctx.leads || []).forEach(l => l && addBiz(l.name));
    (ctx.competitors || []).forEach(c => c && addBiz(c.name));

    const leadDisplayNames = (ctx.leads || []).map(l => l && l.name).filter(Boolean);

    // News titles (normalized) — a business phrase that is a substring of a news title is in-set.
    const newsTitlesNorm = (ctx.newsSignals || [])
        .map(s => normalizeName(typeof s === 'string' ? s : (s && (s.title || s.headline)) || ''))
        .filter(Boolean);

    // Verified person names from search-grounded enrichment.
    const persons = new Set();
    (ctx.leads || []).forEach(l => {
        const dm = l && l.decisionMaker;
        if (!dm) return;
        const names = [dm.name, dm.buyer].concat((dm.contacts || []).map(c => c && c.name));
        names.forEach(nm => { const n = normalizeName(nm); if (n) persons.add(n); });
    });

    return { businesses, leadDisplayNames, newsTitlesNorm, persons };
}

function isAllowedBusiness(phraseNorm, c) {
    if (!phraseNorm) return true;
    if (c.businesses.has(phraseNorm)) return true;
    // Substring either way handles "JUSTJUNK Atlanta" vs "justjunk", and news-title containment.
    for (const norm of c.businesses.keys()) {
        if (norm.includes(phraseNorm) || phraseNorm.includes(norm)) return true;
    }
    if (c.newsTitlesNorm.some(t => t.includes(phraseNorm))) return true;
    return false;
}

function isVerifiedPerson(phraseNorm, c) {
    if (c.persons.has(phraseNorm)) return true;
    // Allow a first-name-only or "First L." backing to match the full verified name and vice-versa.
    for (const p of c.persons) {
        if (p.includes(phraseNorm) || phraseNorm.includes(p)) return true;
    }
    return false;
}

/**
 * Gate a single move. Returns { move, changed, drop, reasons[] }.
 */
function processMove(move, c) {
    if (!move || typeof move !== 'object') return { move, changed: false, drop: false, reasons: [] };
    const out = Object.assign({}, move);
    const reasons = [];
    let changed = false;
    let drop = false;

    // Which in-set businesses does the move mention? Longest-first so the display name wins.
    const moveNorm = normalizeName(MOVE_TEXT_FIELDS.map(f => out[f] || '').join(' '));
    const inSet = [];
    for (const [norm, display] of c.businesses) {
        if (norm && moveNorm.includes(norm)) inSet.push({ norm, display });
    }
    inSet.sort((a, b) => b.norm.length - a.norm.length);
    const anchorBiz = inSet.length ? inSet[0].display : null;

    for (const field of MOVE_TEXT_FIELDS) {
        if (typeof out[field] !== 'string' || !out[field]) continue;
        out[field] = out[field].replace(PHRASE_RE, (phrase) => {
            // Strip a leading run of non-entity/verb words so a sentence-initial verb ("Message",
            // "Pitch") does not hide the entity that follows. Always keep ≥1 word.
            const words = phrase.split(/\s+/);
            let i = 0;
            while (i < words.length - 1 && NON_ENTITY_TOKENS.has(normalizeName(words[i]))) i++;
            const prefix = i > 0 ? words.slice(0, i).join(' ') + ' ' : '';
            const core = words.slice(i).join(' ');
            const norm = normalizeName(core);
            if (!norm) return phrase;

            // 0) A known in-set business, a FRAGMENT of one ("Stand Up Guys" ⊂ "Stand Up Guys Junk
            //    Removal"), or a news-signal entity — always keep, even when it is person-shaped. This
            //    guards businesses whose names read like people so they are never rewritten to a role.
            if (isAllowedBusiness(norm, c)) return phrase;

            // 1) Business-bearing phrase (not in-set) → out-of-set business.
            if (hasBusinessToken(core)) {
                // Out-of-set business. Rewrite to an in-set anchor if one survives; else flag for drop.
                if (anchorBiz && normalizeName(anchorBiz) !== norm) {
                    changed = true;
                    reasons.push(`out-of-set business "${core.trim()}" → "${anchorBiz}"`);
                    return prefix + anchorBiz;
                }
                drop = true;
                reasons.push(`out-of-set business "${core.trim()}" with no in-set anchor — move dropped`);
                return phrase;
            }

            // 2) Person-looking phrase.
            if (looksLikePerson(core)) {
                if (isVerifiedPerson(norm, c)) return phrase; // backed by enrichment — keep
                // Unbacked recalled name → business-role reference. Never a bare name, never a hedge.
                const replacement = anchorBiz ? `the owner of ${anchorBiz}` : 'the business owner';
                changed = true;
                reasons.push(`unverified name "${core.trim()}" → "${replacement}"`);
                return prefix + replacement;
            }

            return phrase; // allowed business without a suffix token, geography, product, etc.
        });

        // Tidy the "the owner of X at X" redundancy the rewrite can create.
        out[field] = out[field].replace(/\b(the owner of [^.,;]+?) at \1\b/gi, '$1');
    }

    return { move: out, changed, drop, reasons };
}

/**
 * Gate High-Impact Moves. ctx = { leads, competitors, newsSignals }.
 * Returns { moves, changed, dropped, rewrites, floorMet }.
 */
function gateHighImpactMoves(moves, ctx) {
    if (!Array.isArray(moves)) return { moves: moves, changed: false, dropped: 0, rewrites: 0, floorMet: false };
    const c = buildContext(ctx);
    const survivors = [];
    let dropped = 0, rewrites = 0;
    for (const move of moves) {
        const r = processMove(move, c);
        if (r.drop) { dropped++; continue; }
        if (r.changed) rewrites++;
        survivors.push(r.move);
    }
    // No filler: return survivors as-is even if fewer than two. `floorMet` lets the caller log it.
    return { moves: survivors, changed: rewrites > 0 || dropped > 0, dropped, rewrites, floorMet: survivors.length >= 2 };
}

/**
 * Gate PERSON names only, in salesIntel free-form prose (entryWedge, competitorVulnerability,
 * bestTimeToCall, talkingPoints[]). Businesses in salesIntel are out of scope for PR-C2.
 */
function gateSalesIntelNames(salesIntel, ctx) {
    if (!salesIntel || typeof salesIntel !== 'object') return { salesIntel, changed: false };
    const c = buildContext(ctx);
    const out = Object.assign({}, salesIntel);
    let changed = false;

    const scrubString = (str) => {
        if (typeof str !== 'string' || !str) return str;
        return str.replace(PHRASE_RE, (phrase) => {
            // Strip a leading verb/stopword run so a sentence-initial verb doesn't hide the name.
            const words = phrase.split(/\s+/);
            let i = 0;
            while (i < words.length - 1 && NON_ENTITY_TOKENS.has(normalizeName(words[i]))) i++;
            const prefix = i > 0 ? words.slice(0, i).join(' ') + ' ' : '';
            const core = words.slice(i).join(' ');
            const norm = normalizeName(core);
            if (!norm) return phrase;
            if (isAllowedBusiness(norm, c)) return phrase;   // in-set business / fragment / news — keep
            if (hasBusinessToken(core)) return phrase;       // businesses untouched here (part 3 is HIM-only)
            if (!looksLikePerson(core)) return phrase;
            if (isVerifiedPerson(norm, c)) return phrase;    // search-grounded name — keep
            changed = true;
            return prefix + 'the business owner';
        });
    };

    ['entryWedge', 'competitorVulnerability', 'bestTimeToCall'].forEach(f => {
        const v = scrubString(out[f]);
        if (v !== out[f]) out[f] = v;
    });
    if (Array.isArray(out.talkingPoints)) {
        out.talkingPoints = out.talkingPoints.map(tp => scrubString(tp));
    }
    return { salesIntel: out, changed };
}

module.exports = {
    gateHighImpactMoves,
    gateSalesIntelNames,
    // exported for unit tests
    normalizeName,
    looksLikePerson,
    hasBusinessToken,
    buildContext,
    processMove
};
