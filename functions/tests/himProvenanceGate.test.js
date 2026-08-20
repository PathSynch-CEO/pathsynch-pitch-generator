'use strict';

/**
 * PR-C2 / #92 — High-Impact Moves provenance gate, ANCHOR-BASED.
 *
 * #91's shape-based gate corrupted legitimate prose (Title-Case common nouns → "the business owner").
 * #92 only acts on names matched against an anchor set (verified decisionMaker ∪ steered candidates)
 * and never on Title-Case shape; businesses are recognized only by known-name match, never by suffix
 * shape. Explicit, accepted coverage reduction: with the current pipeline (generators steered only
 * with verified names), the gate performs ZERO rewrites on real reports — an unverified recalled name
 * or an out-of-set business now SHIPS. That is a smaller failure than corrupted prose; the race fix is
 * the primary defense.
 */

const {
    gateHighImpactMoves,
    gateSalesIntelNames,
    normPerson,
    personMatches,
    isVerifiedPerson,
    buildContext
} = require('../services/himProvenanceGate');

// ── Real v10 context (report Nf5gIdrM2OntxUsAMzQA) ──────────────────────────────
const V10_LEADS = [
    { name: 'EZ Atlanta Junk Removal', decisionMaker: null },
    { name: 'Atlanta Has Junk!', decisionMaker: null },
    { name: 'Junk Hauling For Less', decisionMaker: { name: null, buyer: 'Dana', source: 'search', contacts: [] } },
    { name: 'Peachtree Junk Removal', decisionMaker: { name: 'Ryan Tabb', title: 'President', source: 'search', confidence: 'high', contacts: [{ name: 'Ryan Tabb', title: 'President' }, { name: 'Ryan T.', title: 'Business owner' }] } },
    { name: 'JUSTJUNK Atlanta', decisionMaker: null },
    { name: 'SS PRO JUNK REMOVAL', decisionMaker: { name: 'STACEY STEMBRIDGE', title: 'Company Owner', source: 'search', contacts: [{ name: 'STACEY STEMBRIDGE', title: 'Company Owner' }] } },
    { name: 'Southside Junk Removal & Dumpster Rentals', decisionMaker: null }
];
const V10_COMPETITORS = [
    'College Hunks Hauling Junk and Moving Atlanta', 'JUSTJUNK Atlanta', 'EZ Atlanta Junk Removal',
    'Peachtree Junk Removal', 'Junk Hauling For Less', 'Junk King Atlanta South', 'SS PRO JUNK REMOVAL',
    'Junk People Atlanta', 'Stand Up Guys Junk Removal', 'Junk-it ATL', '1-800-GOT-JUNK? Atlanta Westside',
    'LoadUp Junk Removal', 'Junk King Atlanta Southeast'
].map(name => ({ name }));
const V10_NEWS = [{ title: 'Authority Brands Relocates HQ, Creates 390 Jobs in Cobb Co.' }];
const V10_CTX = { leads: V10_LEADS, competitors: V10_COMPETITORS, newsSignals: V10_NEWS };

const V10_MOVES = [
    { title: 'Leverage the review volume gap against market leaders',
      context: '1-800-GOT-JUNK? dominates with 26,802 reviews, creating an insurmountable authority gap for smaller 5-star players like EZ Atlanta Junk Removal.',
      action: 'Pitch EZ Atlanta Junk Removal on using PathSynch to automate review generation to bridge the 26,000-unit social proof gap.',
      timing: 'within the next 30 days', expectedOutcome: 'Initial discovery call scheduled with the owner to discuss scaling reputation.' },
    { title: 'Target high-volume 5-star operators losing momentum',
      context: 'Peachtree Junk Removal has a strong 734-review base but a lower score of 52/100, suggesting a decline in recent engagement.',
      action: "Directly message Ryan Tabb at Peachtree Junk Removal with a 'Health Check' audit comparing their recent velocity to the 4.96 market average.",
      timing: 'Week 2', expectedOutcome: "A platform demo focused on PathSynch's re-engagement and lead capture tools." },
    { title: 'Capitalize on the Cobb County HQ relocation surge',
      context: 'Authority Brands relocating to Cobb County creates 390 jobs and a massive influx of residential move-ins/outs requiring cleanout services.',
      action: "Offer JUSTJUNK Atlanta a localized landing page strategy via PathSynch to capture 'Residential Cleanout' searches in the Cobb County corridor.",
      timing: 'Week 3', expectedOutcome: 'Agreement to a 14-day trial focused on geographic lead routing.' },
    { title: 'Pivot to price-sensitive segments during weatherization shifts',
      context: 'Junk Hauling For Less (444 reviews) is positioned for budget-conscious homeowners during the Pre-winter weatherproofing shift in September.',
      action: "Show Junk Hauling For Less how PathSynch's automated follow-ups convert high-intent 'Residential Cleanout' leads faster than manual outreach.",
      timing: 'Week 4', expectedOutcome: "Conversion of a 'high-intent' lead into a paid PathSynch subscription." }
];

const clone = (x) => JSON.parse(JSON.stringify(x));

describe('#92 — v10 real HIM guardrail: gate passes it through untouched', () => {
    test('no rewrite, no drop, all four survive', () => {
        const r = gateHighImpactMoves(clone(V10_MOVES), V10_CTX);
        expect(r.rewrites).toBe(0);
        expect(r.dropped).toBe(0);
        expect(r.changed).toBe(false);
        expect(r.moves).toHaveLength(4);
        expect(JSON.stringify(r.moves)).toEqual(JSON.stringify(V10_MOVES));
    });
});

describe('#92 — FINDING (a) CLOSED: Title-Case common nouns are NEVER rewritten', () => {
    // The exact corruption class that made #91 blocking. With no matching anchor, ZERO rewrites.
    const PHRASES = [
        'Improve their Google Business Profile to capture more local searches.',
        'Build a Landing Page that converts high-intent leads.',
        'Boost Social Proof and Review Volume against the Market Leader.',
        'Use Lead Capture forms and a Discovery Call to grow the pipeline.',
        'Pitch a First Response and Emergency Response cleanout plan.',
        'Bundle QRsynch, LocalSynch and PathConnect for the Home Services vertical.',
        'Target the Weekend Warriors segment with Same Day service.'
    ];
    test.each(PHRASES)('unchanged: %s', (phrase) => {
        const move = { title: 't', context: phrase, action: 'a', timing: 'w', expectedOutcome: 'o' };
        const r = gateHighImpactMoves([move], V10_CTX);
        expect(r.rewrites).toBe(0);
        expect(r.moves[0].context).toBe(phrase);
    });

    test('a whole batch dense with Title-Case nouns → zero rewrites, zero drops', () => {
        const moves = PHRASES.map(p => ({ title: 'Grow Market Share', context: p, action: 'Schedule a Discovery Call.', timing: 'Q4', expectedOutcome: 'A Signed Agreement.' }));
        const r = gateHighImpactMoves(moves, V10_CTX);
        expect(r.rewrites).toBe(0);
        expect(r.dropped).toBe(0);
        expect(r.moves).toHaveLength(PHRASES.length);
    });
});

describe('#92 — FINDING (c) CLOSED: honorific / surname / possessive matching of a backed name', () => {
    const c = buildContext(V10_CTX); // Peachtree → Ryan Tabb backed

    test('isVerifiedPerson matches "Mr. Tabb", "Tabb", "Ryan Tabb\'s", "Dr. Ryan Tabb"', () => {
        expect(isVerifiedPerson(normPerson('Mr. Tabb'), c)).toBe(true);
        expect(isVerifiedPerson(normPerson('Tabb'), c)).toBe(true);
        expect(isVerifiedPerson(normPerson("Ryan Tabb's"), c)).toBe(true);
        expect(isVerifiedPerson(normPerson('Dr. Ryan Tabb'), c)).toBe(true);
        expect(isVerifiedPerson(normPerson('Ryan Tabb'), c)).toBe(true);
    });

    test('personMatches: honorific stripped, surname-inclusive, possessive tolerated', () => {
        expect(personMatches(normPerson('Mr. Tabb'), 'ryan tabb')).toBe(true);
        expect(personMatches(normPerson('STACEY STEMBRIDGE'), 'stacey stembridge')).toBe(true);
        expect(personMatches(normPerson('Ms. Stembridge'), 'stacey stembridge')).toBe(true);
        expect(personMatches(normPerson('Someone Else'), 'ryan tabb')).toBe(false);
    });

    test('a move mentioning the backed owner as "Mr. Tabb" is NOT rewritten', () => {
        const moves = [{ title: 't', context: 'c', action: 'Contact Mr. Tabb at Peachtree Junk Removal about a demo.', timing: 'w', expectedOutcome: 'o' }];
        const r = gateHighImpactMoves(moves, V10_CTX);
        expect(r.rewrites).toBe(0);
        expect(r.moves[0].action).toContain('Mr. Tabb'); // backed → kept, no longer role-referenced
    });
});

describe('#92 — anchor rewrite path fires ONLY for a steered-but-unverified candidate', () => {
    test('a candidate name Gemini was steered with, absent from the verified set, IS rewritten', () => {
        // Simulate a future flow that steered "Ghost Owner" as a candidate without verifying it.
        const ctx = Object.assign({}, V10_CTX, { candidateNames: ['Ghost Owner'] });
        const moves = [{ title: 't', context: 'c', action: 'Call Ghost Owner at EZ Atlanta Junk Removal.', timing: 'w', expectedOutcome: 'o' }];
        const r = gateHighImpactMoves(moves, ctx);
        expect(r.rewrites).toBe(1);
        expect(r.moves[0].action).not.toContain('Ghost Owner');
        expect(r.moves[0].action).toContain('the owner of EZ Atlanta Junk Removal');
    });

    test('a verified name is protected even when an unverified candidate shares a surname', () => {
        const ctx = Object.assign({}, V10_CTX, { candidateNames: ['Bob Tabb'] }); // shares surname with backed "Ryan Tabb"
        const moves = [{ title: 't', context: 'c', action: 'Message Ryan Tabb at Peachtree Junk Removal, not Bob Tabb.', timing: 'w', expectedOutcome: 'o' }];
        const r = gateHighImpactMoves(moves, ctx);
        expect(r.moves[0].action).toContain('Ryan Tabb');       // verified surname mention kept
        expect(r.moves[0].action).not.toContain('Bob Tabb');    // unverified candidate rewritten
    });
});

describe('#92 — ACCEPTED, EXPLICIT coverage reduction (documented in PR body)', () => {
    test('an unverified recalled name with no anchor now SHIPS (smaller failure than corruption)', () => {
        const moves = [{ title: 't', context: 'c', action: 'Call Bob Roberts at EZ Atlanta Junk Removal.', timing: 'w', expectedOutcome: 'o' }];
        const r = gateHighImpactMoves(moves, V10_CTX);
        expect(r.rewrites).toBe(0);
        expect(r.moves[0].action).toContain('Bob Roberts'); // ships — no anchor match, gate does not guess
    });

    test('an out-of-set business now SHIPS (no suffix-shape drop)', () => {
        const moves = [{ title: 't', context: 'The Junk Tycoons lead the eastside.', action: 'Pitch The Junk Tycoons.', timing: 'w', expectedOutcome: 'o' }];
        const r = gateHighImpactMoves(moves, V10_CTX);
        expect(r.dropped).toBe(0);
        expect(r.moves).toHaveLength(1);
        expect(JSON.stringify(r.moves)).toContain('Junk Tycoons');
    });
});

describe('#92 — salesIntel person gate (anchor-based)', () => {
    test('no rewrite when steered only with verified names (Ryan Tabb kept, common nouns untouched)', () => {
        const si = { entryWedge: 'Ask Ryan Tabb how to grow Review Volume and their Google Business Profile.', competitorVulnerability: 'v', talkingPoints: ['Boost Social Proof.'] };
        const r = gateSalesIntelNames(si, V10_CTX);
        expect(r.changed).toBe(false);
        expect(r.salesIntel.entryWedge).toContain('Ryan Tabb');
        expect(r.salesIntel.entryWedge).toContain('Google Business Profile');
    });

    test('a steered-but-unverified name in entryWedge IS rewritten to "the business owner"', () => {
        const ctx = Object.assign({}, V10_CTX, { candidateNames: ['Ghost Owner'] });
        const si = { entryWedge: 'Ask Ghost Owner about review volume.', competitorVulnerability: 'v', talkingPoints: [] };
        const r = gateSalesIntelNames(si, ctx);
        expect(r.salesIntel.entryWedge).not.toContain('Ghost Owner');
        expect(r.salesIntel.entryWedge).toContain('the business owner');
    });
});

describe('#92 — helpers robustness', () => {
    test('normPerson strips honorific + possessive', () => {
        expect(normPerson('Mr. Tabb')).toBe('tabb');
        expect(normPerson("Ryan Tabb's")).toBe('ryan tabb');
        expect(normPerson('Dr. Rima Patel')).toBe('rima patel');
    });
    test('gate tolerates non-array / empty input', () => {
        expect(gateHighImpactMoves(null, V10_CTX).moves).toBeNull();
        expect(gateHighImpactMoves([], V10_CTX).moves).toEqual([]);
    });
});
