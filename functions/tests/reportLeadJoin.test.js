'use strict';

/**
 * fix/report-lead-join-place-id
 *
 * Reproduces the 2026-08 live Atlanta Junk Removal defect: a qualified-lead card
 * mixed two different businesses that share a similar name. The card header (Places
 * business A: 5.0★/257 reviews) disagreed with the scored row / velocity alert /
 * review quote (name-keyed DataForSEO lookalike business B: 3★/2 reviews).
 *
 * reconcileReviewEnrichment re-keys the join on place identity and, absent a
 * place_id link, requires an exact-name + consistency match, with an unconditional
 * divergence guard. These tests assert the bad join no longer lands and that
 * legitimate enrichment still does.
 */

const { reconcileReviewEnrichment } = require('../api/market');
const {
    keepNItTidyLead,
    keepNItTidyCollidingReview,
    keepNItTidyGoodReview,
} = require('./fixtures/atlantaJunkReport');

describe('reconcileReviewEnrichment — Keep\'N it Tidy collision', () => {
    test('rejects the mis-joined lookalike (different cid) — the reported defect', () => {
        const r = reconcileReviewEnrichment(keepNItTidyLead, keepNItTidyCollidingReview);
        expect(r.accept).toBe(false);
        expect(r.reason).toBe('place_id_mismatch');
    });

    test('accepts a legitimate enrichment with matching identity + consistent numbers', () => {
        const r = reconcileReviewEnrichment(keepNItTidyLead, keepNItTidyGoodReview);
        expect(r.accept).toBe(true);
        expect(r.reason).toBe('place_id_match');
    });

    test('rejects on divergent review count even with NO place_id on either side', () => {
        // Strip identifiers so we fall through to name + consistency; keep the same
        // name so only the wild 257-vs-2 count gap triggers the drop.
        const lead = { ...keepNItTidyLead, cid: null, placeId: null };
        const src = {
            ...keepNItTidyCollidingReview,
            cid: null,
            placeId: null,
            matchedName: "Keep'N it Tidy", // same normalized name as the lead
        };
        const r = reconcileReviewEnrichment(lead, src);
        expect(r.accept).toBe(false);
        expect(r.reason).toBe('review_count_divergence');
    });

    test('rejects on name mismatch when there is no place_id link', () => {
        const lead = { ...keepNItTidyLead, cid: null, placeId: null };
        const src = {
            ...keepNItTidyGoodReview, // consistent numbers…
            cid: null,
            placeId: null,
            matchedName: 'Peachtree Junk Squad', // …but a different business name
        };
        const r = reconcileReviewEnrichment(lead, src);
        expect(r.accept).toBe(false);
        expect(r.reason).toBe('name_mismatch');
    });
});

describe('reconcileReviewEnrichment — divergence guard (applied regardless)', () => {
    const baseLead = { name: 'Acme Co', rating: 5.0, reviewCount: 257, cid: null, placeId: null };

    test('rating off by >1.0 (count close) → reject', () => {
        const r = reconcileReviewEnrichment(baseLead, { rating: 3.5, reviewCount: 240 });
        expect(r.accept).toBe(false);
        expect(r.reason).toBe('rating_divergence');
    });

    test('review count off by >5x (rating close) → reject', () => {
        const r = reconcileReviewEnrichment(baseLead, { rating: 4.9, reviewCount: 10 });
        expect(r.accept).toBe(false);
        expect(r.reason).toBe('review_count_divergence');
    });

    test('divergence guard fires even when identity matches (contradictory data)', () => {
        const lead = { ...baseLead, cid: 'abc123' };
        const r = reconcileReviewEnrichment(lead, { cid: 'abc123', rating: 5.0, reviewCount: 2 });
        expect(r.accept).toBe(false);
        expect(r.reason).toBe('review_count_divergence');
    });

    test('consistent numbers with no identity → accept via consistency', () => {
        const r = reconcileReviewEnrichment(baseLead, { rating: 4.9, reviewCount: 251 });
        expect(r.accept).toBe(true);
        expect(r.reason).toBe('consistency_ok');
    });

    test('borderline within tolerance (exactly 5x count, exactly 1.0 rating) → accept', () => {
        // 250/50 = 5x (not >5); |5.0-4.0| = 1.0 (not >1.0)
        const r = reconcileReviewEnrichment(
            { name: 'X', rating: 5.0, reviewCount: 250 },
            { rating: 4.0, reviewCount: 50 }
        );
        expect(r.accept).toBe(true);
    });
});

describe('reconcileReviewEnrichment — degenerate inputs', () => {
    test('null review data → no_data (nothing to attach)', () => {
        expect(reconcileReviewEnrichment(keepNItTidyLead, null)).toEqual({ accept: false, reason: 'no_data' });
    });

    test('null lead → no_data', () => {
        expect(reconcileReviewEnrichment(null, keepNItTidyGoodReview)).toEqual({ accept: false, reason: 'no_data' });
    });

    test('missing Places numbers → cannot disprove identity, accepts (no false drop)', () => {
        // A lead with no rating/reviewCount can't be consistency-checked; with no
        // conflicting identifier or name, enrichment is allowed through.
        const lead = { name: 'New Biz', rating: null, reviewCount: 0, cid: null, placeId: null };
        const r = reconcileReviewEnrichment(lead, { rating: 4.5, reviewCount: 30 });
        expect(r.accept).toBe(true);
    });
});
