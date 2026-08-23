#!/usr/bin/env node
'use strict';

/**
 * assert-clean-deploy.cjs — refuse to deploy code that git does not have, or that git has
 * already moved past.
 *
 * WHY THIS EXISTS: on 2026-05-08, Cloud Functions were deployed from a working tree whose
 * `api/market.js` wiring (Prompt 6 / industryEconomics) was never committed. The next deploy
 * from a clean checkout silently dropped the feature, and reports lost a whole section for
 * months before anyone traced it (2026-08-22 investigation). The fix class: deployed code
 * must ALWAYS be committed, pushed, CURRENT code.
 *
 * WHY CHECK 3 EXISTS: on 2026-08-23, a deploy ran from a clean checkout of main that was four
 * merges BEHIND origin (local f67e64e, origin bdee940). Checks 1 and 2 both passed — the tree
 * was clean and f67e64e was on a remote branch — so the guard printed OK and old code shipped:
 * freshly generated reports were missing marketVerdict, marketSegments and audienceTags even
 * though every line of source was correct. Staleness cannot be detected from local refs alone
 * (the local remote-tracking ref was equally stale), so check 3 fetches from the network.
 *
 * Wired as a `predeploy` hook in firebase.json, so every `firebase deploy` (functions,
 * hosting, rules) runs it first. It fails the deploy when:
 *   1. the working tree is dirty (uncommitted tracked changes, staged or not), or
 *   2. HEAD is not contained in any remote branch (unpushed commits), or
 *   3. HEAD is behind origin's tip of the current branch (stale checkout — pull first).
 * Untracked files alone do not block (scratch files are harmless — they cannot be silently
 * lost by a later clean deploy the way modified tracked files can), but they are listed.
 *
 * Escape hatches (each bypasses ONE check; there is deliberately NO bypass for a dirty tree):
 *   ALLOW_UNPUSHED_DEPLOY=1  skips check 2 (e.g. a CI job deploying the exact commit it
 *                            checked out, before any branch pointer settles).
 *   ALLOW_BEHIND_DEPLOY=1    skips check 3 (an INTENTIONAL rollback to an older commit).
 * If origin is unreachable, check 3 warns and proceeds rather than blocking — a deploy needs
 * the network anyway, so a truly offline machine fails later with a clearer error.
 */

const { execSync } = require('child_process');

function sh(cmd) {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fail(lines) {
    console.error('\n✖ DEPLOY BLOCKED by scripts/assert-clean-deploy.cjs\n');
    for (const l of lines) console.error('  ' + l);
    console.error('\n  Deployed code must be committed, pushed, current code.');
    console.error('  (History: the 2026-05-08 uncommitted-deploy incident silently dropped the');
    console.error('  industryEconomics report section; the 2026-08-23 stale-checkout deploy');
    console.error('  shipped four merges behind origin and dropped three report sections.)\n');
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

// 3 ── HEAD must be CURRENT with origin's tip of this branch. Local refs cannot answer this
//      (the local remote-tracking ref goes stale together with the branch), so fetch for real.
if (process.env.ALLOW_BEHIND_DEPLOY !== '1') {
    let branch = '';
    try { branch = sh('git rev-parse --abbrev-ref HEAD'); } catch (e) { branch = ''; }
    if (branch && branch !== 'HEAD') {          // detached HEAD (CI exact-commit deploy): nothing to compare
        let fetched = false;
        try {
            execSync(`git fetch --quiet origin ${branch}`,
                { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
            fetched = true;
        } catch (e) {
            // Either the branch does not exist on origin (a purely local branch — nothing to be
            // behind of; check 2 already proved HEAD is pushed somewhere) or origin is unreachable.
            let onOrigin = null;
            try { onOrigin = sh(`git ls-remote --heads origin ${branch}`); } catch (e2) { onOrigin = null; }
            if (onOrigin === null) {
                console.warn('[assert-clean-deploy] WARNING: could not reach origin to verify this checkout is current; proceeding unverified.');
            }
        }
        if (fetched) {
            const behind = parseInt(sh('git rev-list --count HEAD..FETCH_HEAD'), 10) || 0;
            if (behind > 0) {
                let missing = [];
                try { missing = sh('git log --oneline HEAD..FETCH_HEAD').split('\n').slice(0, 10); } catch (e) { missing = []; }
                fail([
                    `This checkout of '${branch}' is ${behind} commit${behind === 1 ? '' : 's'} BEHIND origin/${branch} — deploying it would ship old code.`,
                    'Missing from this machine:',
                    ...missing.map(l => '    ' + l),
                    behind > 10 ? `    … and ${behind - 10} more` : '',
                    `Pull first (git pull origin ${branch}). For an INTENTIONAL rollback deploy set ALLOW_BEHIND_DEPLOY=1.`
                ].filter(Boolean));
            }
        }
    }
}

if (untracked.length > 0) {
    console.log(`[assert-clean-deploy] note: ${untracked.length} untracked file(s) present (not blocking):`);
    untracked.slice(0, 10).forEach(l => console.log('    ' + l));
}
console.log('[assert-clean-deploy] OK — tree clean, HEAD is pushed and current with origin. Proceeding with deploy.');
