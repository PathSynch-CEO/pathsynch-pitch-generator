/**
 * describePositioningQuadrant — quadrant-aware market-intel positioning sentence (2026-07-28).
 * Replaces the old unconditional "high-rating, low-volume — high quality but low visibility" claim.
 * Axes: rating vs market-average rating, review volume vs the RESOLVED DENOMINATOR (not the ceiling).
 */
const { describePositioningQuadrant } = require('../api/pitchGenerator');

const AVG_RATING = 4.2;
const DENOM = 800; // resolved junk_removal/moving_storage score denominator

describe('describePositioningQuadrant', () => {
  test('high rating + low volume → strong reputation / limited visibility', () => {
    const s = describePositioningQuadrant(4.7, 50, AVG_RATING, DENOM);
    expect(s).toMatch(/high-rating, low-volume/);
    expect(s).toMatch(/limited visibility/);
  });

  test('REGRESSION: high rating + HIGH volume (1,500 reviews) is NOT called low-visibility', () => {
    const s = describePositioningQuadrant(4.7, 1500, AVG_RATING, DENOM);
    expect(s).toMatch(/high-rating, high-volume/);
    expect(s).toMatch(/established, highly-visible/);
    // The exact bug we are fixing: a high-volume operator must never be told it has low visibility.
    expect(s).not.toMatch(/low visibility/);
    expect(s).not.toMatch(/low-volume/);
  });

  test('low rating + low volume → early-stage, build both', () => {
    const s = describePositioningQuadrant(3.8, 20, AVG_RATING, DENOM);
    expect(s).toMatch(/low-rating, low-volume/);
    expect(s).toMatch(/build both reputation and visibility/);
  });

  test('low rating + high volume → visible but reputation gap', () => {
    const s = describePositioningQuadrant(3.8, 1500, AVG_RATING, DENOM);
    expect(s).toMatch(/high-volume, below-average-rating/);
    expect(s).toMatch(/reputation gap/);
  });

  test('boundary: reviews EXACTLY at the denominator counts as high volume (>=)', () => {
    const s = describePositioningQuadrant(4.5, DENOM, AVG_RATING, DENOM);
    expect(s).toMatch(/high-rating, high-volume/);
  });

  test('boundary: rating EXACTLY at the market average counts as high rating (>=)', () => {
    const s = describePositioningQuadrant(AVG_RATING, 50, AVG_RATING, DENOM);
    expect(s).toMatch(/high-rating, low-volume/);
  });

  test('uses the DENOMINATOR, not the ceiling: 1,200 reviews (>800 denom, <2000 ceiling) is high volume', () => {
    const s = describePositioningQuadrant(4.6, 1200, AVG_RATING, DENOM);
    expect(s).toMatch(/high-volume/);
    expect(s).not.toMatch(/low-volume/);
  });

  test('unknown rating → neutral, no quadrant asserted', () => {
    const s = describePositioningQuadrant(0, 1500, AVG_RATING, DENOM);
    expect(s).toMatch(/rather than a fixed quadrant claim/);
    expect(s).not.toMatch(/quadrant of the positioning matrix/);
  });

  test('missing denominator (legacy report, no matrix) → neutral, no false claim', () => {
    const s = describePositioningQuadrant(4.7, 1500, AVG_RATING, 0);
    expect(s).toMatch(/rather than a fixed quadrant claim/);
  });

  test('every branch returns a trailing space for safe concatenation', () => {
    for (const args of [[4.7, 50], [4.7, 1500], [3.8, 20], [3.8, 1500], [0, 0]]) {
      expect(describePositioningQuadrant(args[0], args[1], AVG_RATING, DENOM)).toMatch(/ $/);
    }
  });
});
