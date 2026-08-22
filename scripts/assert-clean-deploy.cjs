#!/usr/bin/env node
'use strict';

/**
 * assert-clean-deploy.cjs — refuse to deploy code that git does not have.
 *
 * WHY THIS EXISTS: on 2026-05-08, Cloud Functions were deployed from a working tree whose
 * `api/market.js` wiring (Prompt 6 / industryEconomics) was never committed. The next deploy
 * from a clean checkout silently dropped the feature, and reports lost a whole section for
 * months before anyone traced it (2026-08-22 investigation). The fix class: deployed code
 * must ALWAYS be committed, pushed code.
 *
 * Wired as a `predeploy` hook in firebase.json, so every `firebase deploy` (functions,
 * hosting, rules) runs it first. It fails the deploy when:
 *   1. the working tree is dirty (uncommitted tracked changes, staged or not), or
 *   2. HEAD is not contained in any remote branch (unpushed commits).
 * Untracked files alone do not block (scratch files are harmless — they cannot be silently
 * lost by a later clean deploy the way modified tracked files can), but they are listed.
 *
 * CI escape hatch: set ALLOW_UNPUSHED_DEPLOY=1 to bypass check 2 only (e.g. a CI job that
 * deploys the exact commit it checked out, before any branch pointer settles). There is
 * deliberately NO bypass for a dirty tree.
 */

const { execSync } = require('child_process');

function sh(cmd) {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fail(lines) {
    console.error('\n✖ DEPLOY BLOCKED by scripts/assert-clean-deploy.cjs\n');
    for (const l of lines) console.error('  ' + l);
    console.error('\n  Deployed code must be committed and pushed code. Commit (or stash) and push, then deploy.');
    console.error('  (History: the 2026-05-08 uncommitted-deploy incident silently dropped the');
    console.error('  industryEconomics report section on the next clean deploy.)\n');
    process.exit(1);
}

let inRepo = true;
try { sh('git rev-parse --is-inside-work-tree'); } catch (e) { inRepo = false; }
if (!inRepo) {
    // Not a git checkout at all (e.g. an exported tarball) — that is worse, not better.
    fail(['This directory is not a git checkout. Deploys must run from a pushed git checkout.']);
}

// 1 ── Dirty tracked files (staged or unstaged). Untracked are reported but do not block.
const status = sh('git status --porcelain');
const lines = status ? status.split('\n') : [];
const dirty = lines.filter(l => !l.startsWith('??'));
const untracked = lines.filter(l => l.startsWith('??'));

if (dirty.length > 0) {
    fail([
        'Uncommitted changes to tracked files:',
        ...dirty.slice(0, 20).map(l => '    ' + l),
        dirty.length > 20 ? `    … and ${dirty.length - 20} more` : ''
    ].filter(Boolean));
}

// 2 ── HEAD must exist on some remote branch (i.e. it has been pushed).
if (process.env.ALLOW_UNPUSHED_DEPLOY !== '1') {
    let remoteBranches = '';
    try {
        remoteBranches = sh('git branch -r --contains HEAD');
    } catch (e) {
        remoteBranches = '';
    }
    if (!remoteBranches) {
        const head = (() => { try { return sh('git rev-parse --short HEAD'); } catch (e) { return '?'; } })();
        fail([
            `HEAD (${head}) is not on any remote branch — these commits exist only on this machine.`,
            'Push first (git push), or for a CI job deploying its own checked-out commit set ALLOW_UNPUSHED_DEPLOY=1.'
        ]);
    }
}

if (untracked.length > 0) {
    console.log(`[assert-clean-deploy] note: ${untracked.length} untracked file(s) present (not blocking):`);
    untracked.slice(0, 10).forEach(l => console.log('    ' + l));
}
console.log('[assert-clean-deploy] OK — tree clean, HEAD is pushed. Proceeding with deploy.');
