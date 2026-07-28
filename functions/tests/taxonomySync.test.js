/**
 * Taxonomy drift guard (Change B, 2026-07-28) — Option 1 (manifest self-check) + Option 3
 * (sibling-path cross-repo compare, skipped when the frontend tree isn't checked out).
 *
 * ┌─ BLIND SPOT (Option 1) ──────────────────────────────────────────────────────────────────┐
 * │ The manifest only proves this repo's JSON was in sync WHEN IT WAS COMMITTED. A repo whose  │
 * │ JSON *and* manifest are BOTH stale passes its own check. Green CI here means "this tree is  │
 * │ internally consistent," NOT "this tree matches synchintro-app right now." The genuine       │
 * │ cross-repo guard is Option 3 below (when both trees are present) + committing both repos    │
 * │ together after running scripts/sync-taxonomy.cjs.                                           │
 * └────────────────────────────────────────────────────────────────────────────────────────────┘
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Must match scripts/sync-taxonomy.cjs exactly: hash of CR-stripped content so CRLF/LF copies match.
function normalizedHash(text) {
  return crypto.createHash('sha256').update(text.replace(/\r/g, ''), 'utf8').digest('hex');
}

const backendJson = path.resolve(__dirname, '../config/industryTaxonomy.json');
const backendManifest = path.resolve(__dirname, '../config/industryTaxonomy.sha256');
// functions/tests -> functions -> repo root -> tdh35 -> synchintro-app
const frontendJson = path.resolve(__dirname, '../../../synchintro-app/config/industryTaxonomy.json');

describe('taxonomy drift guard', () => {
  test('Option 1 — backend JSON hashes to its committed manifest (run sync-taxonomy.cjs if this fails)', () => {
    expect(fs.existsSync(backendManifest)).toBe(true);
    const expected = fs.readFileSync(backendManifest, 'utf8').trim();
    const actual = normalizedHash(fs.readFileSync(backendJson, 'utf8'));
    expect(actual).toBe(expected);
  });

  test('Option 3 — frontend copy matches backend byte-for-byte (normalized), when the frontend tree is present', () => {
    if (!fs.existsSync(frontendJson)) {
      console.warn('[taxonomySync] synchintro-app not checked out as a sibling — cross-repo compare SKIPPED. ' +
        'This is expected in isolated CI; Option 1 (manifest) still ran. See blind-spot note above.');
      return;
    }
    const backendHash = normalizedHash(fs.readFileSync(backendJson, 'utf8'));
    const frontendHash = normalizedHash(fs.readFileSync(frontendJson, 'utf8'));
    expect(frontendHash).toBe(backendHash);
  });
});
