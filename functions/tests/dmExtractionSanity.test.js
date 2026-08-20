'use strict';

/**
 * PR-C2 review point 3 — extraction sanity.
 *
 * source:'search' means Gemini pulled a name from Serper snippets. Extraction can still grab the wrong
 * human (a reviewer, a quoted customer). extractContacts now applies two deterministic guards:
 *   (1) the snippets must contain an ownership/role term, else return [] (skip the LLM);
 *   (2) the extracted name (or surname) must appear in the snippets (grounding).
 * These tests cover the guard predicates directly.
 */

const { nameAppearsInText, hasRoleContext } = require('../services/decisionMakerEnrichment');

describe('hasRoleContext — snippets must mention ownership/leadership', () => {
    test('true when a role term is present', () => {
        expect(hasRoleContext('Ryan Tabb, owner of Peachtree Junk Removal, said ...')).toBe(true);
        expect(hasRoleContext('Founded by Jane Smith in 2015')).toBe(true);
        expect(hasRoleContext('Meet our president and CEO')).toBe(true);
        expect(hasRoleContext('The company is owned by the Tabb family')).toBe(true);
    });

    test('false when snippets only mention a customer/reviewer (no ownership context)', () => {
        expect(hasRoleContext('"Great service!" — Sarah Johnson, verified customer')).toBe(false);
        expect(hasRoleContext('Reviewed by Mike Davis: 5 stars, fast and friendly')).toBe(false);
        expect(hasRoleContext('')).toBe(false);
    });
});

describe('nameAppearsInText — grounding', () => {
    test('true when the full name or surname is present', () => {
        const snip = 'Peachtree Junk Removal is led by Ryan Tabb, a longtime operator.';
        expect(nameAppearsInText('Ryan Tabb', snip)).toBe(true);
        expect(nameAppearsInText('Ryan T. Tabb', snip)).toBe(true);  // surname "Tabb" present
        expect(nameAppearsInText('Dr. Ryan Tabb', snip)).toBe(true); // honorific stripped
    });

    test('false when the name is not in the snippets (LLM invented it)', () => {
        const snip = 'Peachtree Junk Removal, owner-operated, serves metro Atlanta.';
        expect(nameAppearsInText('Ryan Tabb', snip)).toBe(false);
        expect(nameAppearsInText('', snip)).toBe(false);
        expect(nameAppearsInText('Ryan Tabb', '')).toBe(false);
    });

    test('a very short surname is not matched loosely', () => {
        // surname "Ng" (< 3 chars) must not match by fragment.
        expect(nameAppearsInText('Al Ng', 'engineering and management')).toBe(false);
    });
});

describe('combined guard — a customer name is NOT verified as an owner', () => {
    test('reviewer snippet: no role context → extraction would be dropped', () => {
        const snippets = 'Reviews: "Amazing crew!" — Sarah Johnson. "On time" — Mike Davis.';
        // Guard (1) fails: no ownership term → extractContacts returns [] before trusting any name.
        expect(hasRoleContext(snippets)).toBe(false);
    });

    test('owner snippet with a grounded name passes both guards', () => {
        const snippets = 'Ryan Tabb is the owner and founder of Peachtree Junk Removal.';
        expect(hasRoleContext(snippets)).toBe(true);
        expect(nameAppearsInText('Ryan Tabb', snippets)).toBe(true);
    });
});
