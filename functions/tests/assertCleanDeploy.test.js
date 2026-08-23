'use strict';

/**
 * assert-clean-deploy.cjs — end-to-end tests against real throwaway git repos.
 *
 * The guard exists because of two real incidents, and each check is pinned to the incident
 * it prevents:
 *   check 1 (dirty tree)     — 2026-05-08: deploy from uncommitted working tree silently
 *                              dropped industryEconomics on the next clean deploy.
 *   check 2 (unpushed HEAD)  — same class: commits that exist only on one machine.
 *   check 3 (behind origin)  — 2026-08-23: a CLEAN checkout of main, four merges behind
 *                              origin, passed checks 1+2 and shipped old code (reports lost
 *                              marketVerdict/marketSegments/audienceTags). Local refs cannot
 *                              catch this — the local remote-tracking ref was equally stale —
 *                              so the guard must fetch, and these tests use a real (local
 *                              file) origin to prove it does.
 *
 * Each scenario builds: a bare "origin", a writer clone that advances it, and a deployer
 * clone the script runs in. The deployer's remote-tracking refs are left STALE on purpose in
 * the behind-origin tests — that is the exact 8/23 shape.
 */

const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'assert-clean-deploy.cjs');

let root;

function git(cwd, args) {
    return execSync(`git ${args}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commitFile(cwd, name, content, msg) {
    fs.writeFileSync(path.join(cwd, name), content);
    git(cwd, `add ${name}`);
    git(cwd, `commit -q -m "${msg}"`);
}

/** Build origin (bare) + writer clone + deployer clone, with one initial pushed commit. */
function scenario(label) {
    const dir = fs.mkdtempSync(path.join(root, label + '-'));
    const origin = path.join(dir, 'origin.git');
    const writer = path.join(dir, 'writer');
    const deployer = path.join(dir, 'deployer');
    execSync(`git init -q --bare -b main "${origin}"`);
    execSync(`git clone -q "${origin}" "${writer}"`);
    git(writer, 'config user.email test@test.local');
    git(writer, 'config user.name Test');
    git(writer, 'checkout -q -b main');
    commitFile(writer, 'app.js', 'v1', 'initial');
    git(writer, 'push -q -u origin main');
    execSync(`git clone -q "${origin}" "${deployer}"`);
    git(deployer, 'config user.email test@test.local');
    git(deployer, 'config user.name Test');
    return { origin, writer, deployer };
}

/** Run the guard in a repo; returns { code, out } with stdout+stderr combined. */
function runGuard(cwd, env) {
    const r = spawnSync(process.execPath, [SCRIPT], {
        cwd,
        env: Object.assign({}, process.env, env || {}),
        encoding: 'utf8'
    });
    return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'acd-test-'));
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe('check 1: dirty tree (the 2026-05-08 incident)', () => {
    test('a modified tracked file blocks the deploy, with no bypass', () => {
        const { deployer } = scenario('dirty');
        fs.writeFileSync(path.join(deployer, 'app.js'), 'edited-but-not-committed');
        const r = runGuard(deployer, { ALLOW_UNPUSHED_DEPLOY: '1', ALLOW_BEHIND_DEPLOY: '1' });
        expect(r.code).toBe(1);
        expect(r.out).toContain('Uncommitted changes to tracked files');
    });

    test('untracked files alone do not block, but are listed', () => {
        const { deployer } = scenario('untracked');
        fs.writeFileSync(path.join(deployer, 'scratch.txt'), 'scratch');
        const r = runGuard(deployer);
        expect(r.code).toBe(0);
        expect(r.out).toContain('untracked file(s) present (not blocking)');
    });
});

describe('check 2: unpushed HEAD', () => {
    test('a local-only commit blocks; ALLOW_UNPUSHED_DEPLOY=1 bypasses exactly that', () => {
        const { deployer } = scenario('unpushed');
        commitFile(deployer, 'local.js', 'x', 'local only');
        const blocked = runGuard(deployer);
        expect(blocked.code).toBe(1);
        expect(blocked.out).toContain('is not on any remote branch');
        // Bypassed: check 3 then sees HEAD AHEAD of origin (behind count 0), which is fine.
        const bypassed = runGuard(deployer, { ALLOW_UNPUSHED_DEPLOY: '1' });
        expect(bypassed.code).toBe(0);
    });
});

describe('check 3: behind origin (the 2026-08-23 incident)', () => {
    test('a clean checkout behind origin is BLOCKED even though checks 1+2 pass', () => {
        const { writer, deployer } = scenario('behind');
        // Another machine advances origin — the deployer's local refs all stay stale.
        commitFile(writer, 'feature.js', 'new section', 'feat: market verdict');
        commitFile(writer, 'feature2.js', 'more', 'feat: market segments');
        git(writer, 'push -q origin main');
        const r = runGuard(deployer);
        expect(r.code).toBe(1);
        expect(r.out).toContain("is 2 commits BEHIND origin/main");
        expect(r.out).toContain('market verdict');           // names the missing commits
        expect(r.out).toContain('Pull first');
    });

    test('ALLOW_BEHIND_DEPLOY=1 permits an intentional rollback deploy', () => {
        const { writer, deployer } = scenario('rollback');
        commitFile(writer, 'feature.js', 'new', 'feat: newer');
        git(writer, 'push -q origin main');
        const r = runGuard(deployer, { ALLOW_BEHIND_DEPLOY: '1' });
        expect(r.code).toBe(0);
    });

    test('after pulling, the same checkout passes', () => {
        const { writer, deployer } = scenario('pulled');
        commitFile(writer, 'feature.js', 'new', 'feat: newer');
        git(writer, 'push -q origin main');
        git(deployer, 'pull -q origin main');
        const r = runGuard(deployer);
        expect(r.code).toBe(0);
        expect(r.out).toContain('current with origin');
    });

    test('a pushed branch that does not exist on origin under its own name is not "behind"', () => {
        // e.g. a local rename of a pushed branch: HEAD is on origin/main (check 2 passes) but
        // `git fetch origin local-name` fails — the guard must treat that as nothing-to-compare.
        const { deployer } = scenario('localbranch');
        git(deployer, 'checkout -q -b local-name');
        const r = runGuard(deployer);
        expect(r.code).toBe(0);
    });

    test('detached HEAD (CI exact-commit deploy shape) skips the behind check', () => {
        const { deployer } = scenario('detached');
        const sha = git(deployer, 'rev-parse HEAD');
        git(deployer, `checkout -q ${sha}`);
        const r = runGuard(deployer, { ALLOW_UNPUSHED_DEPLOY: '1' });
        expect(r.code).toBe(0);
    });

    test('unreachable origin warns and proceeds instead of blocking', () => {
        const { deployer } = scenario('offline');
        git(deployer, 'remote set-url origin /nonexistent/path/origin.git');
        const r = runGuard(deployer, { ALLOW_UNPUSHED_DEPLOY: '1' });   // check 2 needs no network (local refs), but bypass to isolate check 3
        expect(r.code).toBe(0);
        expect(r.out).toContain('could not reach origin');
    });
});
