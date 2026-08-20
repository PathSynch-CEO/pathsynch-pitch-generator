'use strict';

/**
 * PR-C2 — High-Impact Moves provenance gate.
 *
 * Grounded in the live 2026-08-20 Atlanta Junk Removal report Nf5gIdrM2OntxUsAMzQA (v10): its HIM is
 * actually CLEAN (every business is a lead/competitor or the news entity "Authority Brands"; "Ryan
 * Tabb" is backed by leads[].decisionMaker with source:"search"). The gate must pass it through
 * untouched. Out-of-set / unbacked cases use the v9-observed patterns (Junk King Gwinnett, The Junk
 * Tycoons) as synthetic fixtures.
 */

const {
    gateHighImpactMoves,
    gateSalesIntelNames,
    looksLikePerson,
    hasBusinessToken
} = require('../services/himProvenanceGate');

// ── Real v10 context ──────────────────────────────────────────────────────────
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

// The four real v10 moves, verbatim.
const V10_MOVES = [
    {
        title: 'Leverage the review volume gap against market leaders',
        context: '1-800-GOT-JUNK? dominates with 26,802 reviews, creating an insurmountable authority gap for smaller 5-star players like EZ Atlanta Junk Removal.',
        action: 'Pitch EZ Atlanta Junk Removal on using PathSynch to automate review generation to bridge the 26,000-unit social proof gap.',
        timing: 'within the next 30 days',
        expectedOutcome: 'Initial discovery call scheduled with the owner to discuss scaling reputation.'
    },
    {
        title: 'Target high-volume 5-star operators losing momentum',
        context: 'Peachtree Junk Removal has a strong 734-review base but a lower score of 52/100, suggesting a decline in recent engagement.',
        action: "Directly message Ryan Tabb at Peachtree Junk Removal with a 'Health Check' audit comparing their recent velocity to the 4.96 market average.",
        timing: 'Week 2',
        expectedOutcome: "A platform demo focused on PathSynch's re-engagement and lead capture tools."
    },
    {
        title: 'Capitalize on the Cobb County HQ relocation surge',
        context: 'Authority Brands relocating to Cobb County creates 390 jobs and a massive influx of residential move-ins/outs requiring cleanout services.',
        action: "Offer JUSTJUNK Atlanta a localized landing page strategy via PathSynch to capture 'Residential Cleanout' searches in the Cobb County corridor.",
        timing: 'Week 3',
        expectedOutcome: 'Agreement to a 14-day trial focused on geographic lead routing.'
    },
    {
        title: 'Pivot to price-sensitive segments during weatherization shifts',
        context: 'Junk Hauling For Less (444 reviews) is positioned for budget-conscious homeowners during the Pre-winter weatherproofing shift in September.',
        action: "Show Junk Hauling For Less how PathSynch's automated follow-ups convert high-intent 'Residential Cleanout' leads faster than manual outreach.",
        timing: 'Week 4',
        expectedOutcome: "Conversion of a 'high-intent' lead into a paid PathSynch subscription."
    }
];

describe('PR-C2 — v10 real HIM is clean: gate passes it through untouched', () => {
    test('no move dropped, no rewrite, all four survive', () => {
        const r = gateHighImpactMoves(JSON.parse(JSON.stringify(V10_MOVES)), V10_CTX);
        expect(r.dropped).toBe(0);
        expect(r.rewrites).toBe(0);
        expect(r.changed).toBe(false);
        expect(r.moves).toHaveLength(4);
    });

    test('the backed name "Ryan Tabb" (source:search) is preserved verbatim', () => {
        const r = gateHighImpactMoves(JSON.parse(JSON.stringify(V10_MOVES)), V10_CTX);
        expect(r.moves[1].action).toContain('Ryan Tabb');
    });

    test('the news entity "Authority Brands" is in-set (cited, not dropped)', () => {
        const r = gateHighImpactMoves(JSON.parse(JSON.stringify(V10_MOVES)), V10_CTX);
        expect(r.moves[2].context).toContain('Authority Brands');
    });
});

describe('PR-C2 — person-name provenance', () => {
    test('unbacked recalled name → "the owner of <business>" (no bare name, no hedge)', () => {
        const moves = [{
            title: 'Engage the decision maker',
            context: 'Peachtree Junk Removal shows strong ratings but low volume.',
            action: 'Call Jane Doe at Peachtree Junk Removal to pitch review automation.',
            timing: 'Week 1', expectedOutcome: 'A demo booked.'
        }];
        // decisionMaker for Peachtree here is only "Ryan Tabb"; "Jane Doe" is unbacked.
        const r = gateHighImpactMoves(moves, V10_CTX);
        expect(r.moves[0].action).not.toContain('Jane Doe');
        expect(r.moves[0].action).toContain('the owner of Peachtree Junk Removal');
        expect(r.moves[0].action.toLowerCase()).not.toMatch(/likely|probably|may be|possibly/); // no hedge
    });

    test('a backed name is kept even when another move has an unbacked one', () => {
        const moves = [
            { title: 't', context: 'c', action: 'Message Ryan Tabb at Peachtree Junk Removal.', timing: 'w', expectedOutcome: 'o' },
            { title: 't', context: 'c', action: 'Message Bob Roberts at EZ Atlanta Junk Removal.', timing: 'w', expectedOutcome: 'o' }
        ];
        const r = gateHighImpactMoves(moves, V10_CTX);
        expect(r.moves[0].action).toContain('Ryan Tabb');
        expect(r.moves[1].action).toContain('the owner of EZ Atlanta Junk Removal');
        expect(r.moves[1].action).not.toContain('Bob Roberts');
    });
});

describe('PR-C2 — out-of-set business references', () => {
    test('out-of-set business WITH an in-set anchor → rewritten to the in-set business', () => {
        const moves = [{
            title: 'Poach from a weaker rival',
            context: 'Junk King Gwinnett has slipping reviews next to Peachtree Junk Removal.',
            action: 'Pitch Peachtree Junk Removal on outpacing Junk King Gwinnett with PathSynch.',
            timing: 'Week 1', expectedOutcome: 'A demo.'
        }];
        const r = gateHighImpactMoves(moves, V10_CTX);
        expect(r.dropped).toBe(0);
        const joined = JSON.stringify(r.moves[0]);
        expect(joined).not.toContain('Junk King Gwinnett'); // out-of-set (Gwinnett is not a competitor)
        expect(joined).toContain('Peachtree Junk Removal');  // in-set anchor survives
    });

    test('out-of-set business as the SOLE target (no in-set anchor) → move dropped', () => {
        const moves = [
            { title: 'x', context: 'The Junk Tycoons lead the eastside.', action: 'Pitch The Junk Tycoons on PathSynch.', timing: 'w', expectedOutcome: 'o' },
            { title: 'y', context: 'Peachtree Junk Removal has strong ratings.', action: 'Pitch Peachtree Junk Removal.', timing: 'w', expectedOutcome: 'o' },
            { title: 'z', context: 'EZ Atlanta Junk Removal is a 5-star operator.', action: 'Pitch EZ Atlanta Junk Removal.', timing: 'w', expectedOutcome: 'o' }
        ];
        const r = gateHighImpactMoves(moves, V10_CTX);
        expect(r.dropped).toBe(1);
        expect(r.moves).toHaveLength(2);
        expect(JSON.stringify(r.moves)).not.toContain('Junk Tycoons');
    });

    test('min-2 floor: when only 1 move survives, render it — no filler', () => {
        const moves = [
            { title: 'x', context: 'The Junk Tycoons lead.', action: 'Pitch The Junk Tycoons.', timing: 'w', expectedOutcome: 'o' },
            { title: 'y', context: 'Junk King Gwinnett leads.', action: 'Pitch Junk King Gwinnett.', timing: 'w', expectedOutcome: 'o' },
            { title: 'z', context: 'Peachtree Junk Removal is strong.', action: 'Pitch Peachtree Junk Removal.', timing: 'w', expectedOutcome: 'o' }
        ];
        const r = gateHighImpactMoves(moves, V10_CTX);
        expect(r.moves.length).toBe(1);       // two dropped, one derived survivor
        expect(r.floorMet).toBe(false);        // caller can log that the floor wasn't met
        expect(r.moves[0].context).toContain('Peachtree Junk Removal');
    });
});

describe('PR-C2 — salesIntel person-name gate', () => {
    test('unbacked name in entryWedge → "the business owner"; backed name kept', () => {
        const si = {
            entryWedge: 'Ask Ryan Tabb how they plan to grow review volume.',
            competitorVulnerability: 'John Q Public runs a weaker shop.',
            talkingPoints: ['Businesses like EZ Atlanta Junk Removal have low volume.']
        };
        const r = gateSalesIntelNames(si, V10_CTX);
        expect(r.salesIntel.entryWedge).toContain('Ryan Tabb');          // backed
        expect(r.salesIntel.competitorVulnerability).not.toContain('John Q Public');
        expect(r.salesIntel.competitorVulnerability).toContain('the business owner');
        // business references in talking points are left alone (out of scope for salesIntel)
        expect(r.salesIntel.talkingPoints[0]).toContain('EZ Atlanta Junk Removal');
    });
});

describe('PR-C2 — helpers', () => {
    test('looksLikePerson: names yes, businesses/geography/verbs no', () => {
        expect(looksLikePerson('Ryan Tabb')).toBe(true);
        expect(looksLikePerson('STACEY STEMBRIDGE')).toBe(true);
        expect(looksLikePerson('Peachtree Junk Removal')).toBe(false); // business token
        expect(looksLikePerson('Cobb County')).toBe(false);            // geography stopword
        expect(looksLikePerson('Authority Brands')).toBe(false);       // business token "brands"
        expect(looksLikePerson('Health Check')).toBe(false);           // stopwords
    });

    test('hasBusinessToken', () => {
        expect(hasBusinessToken('Junk King Gwinnett')).toBe(true);
        expect(hasBusinessToken('Ryan Tabb')).toBe(false);
    });
});
