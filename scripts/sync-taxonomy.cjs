const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const source = path.resolve(__dirname, '../functions/config/industryTaxonomy.json');
const sourceManifest = path.resolve(__dirname, '../functions/config/industryTaxonomy.sha256');
const targetDir = path.resolve(__dirname, '../../synchintro-app/config');
const target = path.join(targetDir, 'industryTaxonomy.json');
const targetManifest = path.join(targetDir, 'industryTaxonomy.sha256');

// Drift-guard manifest (Change B, 2026-07-28). The hash is computed over LINE-ENDING-NORMALIZED
// content (CR stripped) so the backend (CRLF) and frontend (LF) copies produce the SAME hash.
// Each repo commits its own copy of industryTaxonomy.sha256; a per-repo CI test asserts the local
// JSON still hashes to the committed manifest (see functions/tests/taxonomySync.test.js).
//
// BLIND SPOT (must stay documented here and in the test): the manifest only proves a repo's JSON
// was synced AT COMMIT TIME. A repo whose JSON *and* manifest are BOTH stale passes its own check.
// It proves "synced when committed," NOT "in sync with the other repo right now." The real guard
// for cross-repo divergence is running this script + committing both trees together.
function normalizedHash(text) {
  return crypto.createHash('sha256').update(text.replace(/\r/g, ''), 'utf8').digest('hex');
}

const src = fs.readFileSync(source, 'utf8');
const hash = normalizedHash(src);

// Backend manifest
fs.writeFileSync(sourceManifest, hash + '\n');

// Frontend copy + manifest
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
  console.log('Created directory:', targetDir);
}
fs.copyFileSync(source, target);
fs.writeFileSync(targetManifest, hash + '\n');

const dst = fs.readFileSync(target, 'utf8');
if (normalizedHash(dst) === hash) {
  console.log(`✓ Synced industryTaxonomy.json + manifest to frontend. Normalized SHA-256: ${hash}`);
} else {
  console.error('✗ SYNC FAILED — frontend copy hash mismatch');
  process.exit(1);
}
