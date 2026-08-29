/**
 * Plan-resolution contract (F-1014 / #129 / #130).
 *
 * Two build-time guards over the whole source tree, both AST-based:
 *
 *   Guard 1 — no BARE getUserPlan(userId). A gate that resolves the caller's own
 *   plan is workspace-blind: a member of a Growth or Scale workspace reads as
 *   whatever their personal doc says, which is usually 'starter'. The canonical
 *   form is getUserPlan(userId, { workspaceId }) or getUserPlanForRequest(req).
 *
 *   Guard 2 — no direct users/{uid}.plan / .tier read. This is the ORIGINAL
 *   F-1014 shape, and it is worse than a bare getUserPlan call: besides being
 *   workspace-blind it re-implements the plan chain locally, so it misses
 *   subscription.plan (where Stripe actually writes) and drifts from planGate
 *   silently. It is what index.js did until #132 and what generateMerchantConfig
 *   still does under #130.
 *
 * BOTH guards are advisory-by-exemption, never advisory-by-omission. A call that
 * genuinely should not resolve a workspace passes only if it carries BOTH:
 *
 *   1. an inline marker at the call site, which is what the next person reading
 *      that route sees:
 *
 *        // plan-gate-exempt(§4.1): throttle counts are per-caller abuse protection
 *        userPlan = normalizePlanForLimits(await getUserPlan(req.userId));
 *
 *   2. an entry in the EXEMPT_* inventory below, whose `reason` must be a literal
 *      quote from that marker. The inventory is the half that makes adding an
 *      exception show up in THIS file's diff, where a reviewer will argue about
 *      it rather than scroll past an eslint-disable.
 *
 * Stale inventory entries fail too, so a removed call cannot leave a dangling
 * licence behind for the next call that lands in the same function.
 *
 * Per CLAUDE.md, both guards were verified by injecting the drift they claim to
 * catch, not merely by watching them pass.
 */

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

const SOURCE_ROOT = path.resolve(__dirname, '..');

// Not request paths: tests and mocks are allowed to fake anything, and scripts/
// holds one-off operator diagnostics that run against a single named account.
const SKIP_DIRS = new Set([
    'node_modules', 'coverage', 'tests', '__tests__', '__mocks__',
    'scripts', 'lib', 'public', '.git', '.firebase'
]);

// The canonical resolver itself. planGate.js IS the plan chain, so reading
// userData.subscription.plan there is the definition, not a violation.
const CANONICAL_RESOLVER = 'middleware/planGate.js';

const MARKER = /plan-gate-exempt\s*\(([^)]*)\)\s*:/;

/**
 * Guard 1 exemptions: bare getUserPlan(userId) calls that are correct as written.
 * `reason` must appear verbatim inside the call site's inline marker.
 */
const EXEMPT_BARE = [
    {
        file: 'index.js',
        fn: 'api',
        reason: 'throttle counts are per-caller abuse protection'
    },
    {
        file: 'services/workspaceService.js',
        fn: 'createWorkspace',
        reason: 'the subject IS the owner'
    },
    {
        file: 'api/stripe.js',
        fn: 'getSubscription',
        reason: 'billing reads the individual account'
    },
    {
        file: 'api/admin.js',
        fn: 'getUser',
        reason: "admin panel displaying one account's own limits"
    }
];

/**
 * Guard 2 exemptions: direct users/{uid} plan reads that are not access gates.
 */
const EXEMPT_DIRECT = [
    {
        file: 'utils/generateMerchantConfig.js',
        fn: 'writeMerchantConfig',
        reason: 'known workspace-blind local plan chain, tracked as #130'
    },
    {
        file: 'index.js',
        fn: 'api',
        reason: 'admin panel display field'
    },
    {
        file: 'api/onboarding.js',
        fn: 'checkPlanLimits',
        reason: 'advisory upgrade prompt'
    }
];

// A glob that quietly stops matching would let both guards pass vacuously.
const MIN_SOURCE_FILES = 60;
const MIN_GETUSERPLAN_CALLS = 15;

// ---------------------------------------------------------------------------
// AST plumbing
// ---------------------------------------------------------------------------

function listSourceFiles(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) listSourceFiles(full, out);
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

function parse(source, relPath) {
    try {
        return parser.parse(source, { sourceType: 'unambiguous', errorRecovery: false });
    } catch (err) {
        throw new Error(`Failed to parse ${relPath}: ${err.message}`);
    }
}

const FUNCTION_TYPES = new Set([
    'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
    'ObjectMethod', 'ClassMethod'
]);

function functionName(node, ancestors) {
    if (node.id && node.id.name) return node.id.name;
    if (node.key && node.key.name) return node.key.name;
    // An anonymous handler takes the name of whatever it is being assigned to, looking
    // through wrappers: `exports.api = onRequest(opts, async (req, res) => {...})`.
    for (let i = ancestors.length - 1, hops = 0; i >= 0 && hops < 3; i--, hops++) {
        const a = ancestors[i];
        if (a.type === 'VariableDeclarator' && a.id.type === 'Identifier') return a.id.name;
        if (a.type === 'ObjectProperty' && a.key && a.key.name) return a.key.name;
        if (a.type === 'AssignmentExpression' && a.left.type === 'MemberExpression' &&
            a.left.property && a.left.property.name) return a.left.property.name;
        if (a.type !== 'CallExpression' && a.type !== 'OptionalCallExpression' &&
            a.type !== 'AwaitExpression' && a.type !== 'ExpressionStatement') break;
    }
    return null;
}

/**
 * Depth-first walk handing each node the name of its nearest named function and
 * the first line of the statement it sits in. A marker comment is written above
 * the statement, which is not always the line the call expression lands on.
 */
function walk(root, visitor) {
    const ancestors = [];
    (function step(node, scope, stmtLine) {
        if (!node || typeof node.type !== 'string') return;
        let nextScope = scope;
        if (FUNCTION_TYPES.has(node.type)) nextScope = functionName(node, ancestors) || scope;
        let nextStmt = stmtLine;
        if (node.loc && (node.type.endsWith('Statement') || node.type.endsWith('Declaration'))) {
            nextStmt = node.loc.start.line;
        }
        visitor(node, nextScope, nextStmt);
        ancestors.push(node);
        for (const key of Object.keys(node)) {
            if (key === 'loc' || key.endsWith('Comments')) continue;
            const value = node[key];
            if (Array.isArray(value)) {
                for (const child of value) {
                    if (child && typeof child.type === 'string') step(child, nextScope, nextStmt);
                }
            } else if (value && typeof value.type === 'string') {
                step(value, nextScope, nextStmt);
            }
        }
        ancestors.pop();
    })(root, '<module>', 1);
}

/**
 * Collect the marker comment attached to a call: the contiguous comment block
 * immediately above it, plus a trailing comment on the line itself.
 */
function markerTextFor(lines, line) {
    const collected = [];
    // A block opener between the comment and the call (`try {`) does not detach it.
    const STRUCTURAL = /^(try\s*\{|\{|\}|\}\s*else\s*\{|else\s*\{)$/;
    for (let i = line - 2; i >= 0; i--) {
        const text = lines[i].trim();
        if (text === '' || STRUCTURAL.test(text)) {
            if (collected.length) break; // blank line after a comment ends the block
            continue;
        }
        if (text.startsWith('//') || text.startsWith('*') || text.startsWith('/*')) {
            collected.unshift(text.replace(/^\/\/+|^\/\*+|^\*+\/?|\*\/$/g, '').trim());
            continue;
        }
        break;
    }
    collected.push((lines[line - 1] || '').trim());
    const joined = collected.join(' ').replace(/\s+/g, ' ');
    return MARKER.test(joined) ? joined : null;
}

function describe_(v) {
    return `${v.file}:${v.line} in ${v.fn}()  ${v.snippet}`;
}

/**
 * Shared adjudication: a violation is allowed only when the inventory names it
 * AND the call site's marker quotes the inventory reason.
 */
function adjudicate(violations, inventory, guardLabel) {
    const unexcused = [];
    const unmarked = [];
    const mismatched = [];
    const used = new Set();

    for (const v of violations) {
        const idx = inventory.findIndex(e => e.file === v.file && e.fn === v.fn);
        if (idx === -1) {
            unexcused.push(describe_(v));
            continue;
        }
        used.add(idx);
        if (!v.marker) {
            unmarked.push(describe_(v));
        } else if (!v.marker.includes(inventory[idx].reason)) {
            mismatched.push(`${describe_(v)}\n      inventory reason: "${inventory[idx].reason}"\n      marker:           "${v.marker}"`);
        }
    }

    const stale = inventory
        .map((e, i) => (used.has(i) ? null : `${e.file} in ${e.fn}()`))
        .filter(Boolean);

    return { unexcused, unmarked, mismatched, stale, guardLabel };
}

function assertClean(result) {
    expect({
        guard: result.guardLabel,
        unexcused: result.unexcused,
        missingInlineMarker: result.unmarked,
        markerDoesNotQuoteInventory: result.mismatched,
        staleInventoryEntries: result.stale
    }).toEqual({
        guard: result.guardLabel,
        unexcused: [],
        missingInlineMarker: [],
        markerDoesNotQuoteInventory: [],
        staleInventoryEntries: []
    });
}

// ---------------------------------------------------------------------------
// Scanners
// ---------------------------------------------------------------------------

const SOURCE_FILES = listSourceFiles(SOURCE_ROOT);

function scan(collect) {
    const found = [];
    for (const absolute of SOURCE_FILES) {
        const file = path.relative(SOURCE_ROOT, absolute).split(path.sep).join('/');
        const source = fs.readFileSync(absolute, 'utf8');
        const lines = source.split('\n');
        collect({ file, source, lines, ast: () => parse(source, file), found });
    }
    return found;
}

/** Guard 1: getUserPlan called without a resolved workspace. */
function findBareGetUserPlan() {
    let totalCalls = 0;
    const violations = scan(({ file, source, lines, ast, found }) => {
        if (!source.includes('getUserPlan')) return;
        walk(ast(), (node, fn, stmtLine) => {
            if (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression') return;
            const callee = node.callee;
            const name = callee.type === 'Identifier'
                ? callee.name
                : (callee.property && callee.property.name);
            if (name !== 'getUserPlan') return;
            if (file === CANONICAL_RESOLVER) return; // the declaration + its own recursion
            totalCalls += 1;

            const options = node.arguments[1];
            const resolvesWorkspace = options &&
                options.type === 'ObjectExpression' &&
                options.properties.some(p => p.key && (p.key.name || p.key.value) === 'workspaceId');
            if (resolvesWorkspace) return;

            const line = node.loc.start.line;
            found.push({
                file,
                fn,
                line,
                snippet: lines[line - 1].trim(),
                marker: markerTextFor(lines, line) || markerTextFor(lines, stmtLine)
            });
        });
    });
    return { violations, totalCalls };
}

/**
 * Guard 2: a plan/tier field read off a users/{uid} document.
 *
 * Tracked by dataflow rather than by name so that `userStatus.tier` — which
 * comes from a limit-checking helper, not a Firestore doc — is not swept up:
 * a variable qualifies only if it holds `.data()` of a snapshot that came from
 * db.collection('users').
 */
const PLAN_FIELDS = new Set(['plan', 'tier', 'planTier']);

function subtreeReadsUsersCollection(node) {
    let hit = false;
    walk(node, (n) => {
        if (n.type !== 'CallExpression' && n.type !== 'OptionalCallExpression') return;
        const callee = n.callee;
        if (!callee || !callee.property || callee.property.name !== 'collection') return;
        const arg = n.arguments[0];
        if (arg && arg.type === 'StringLiteral' && arg.value === 'users') hit = true;
    });
    return hit;
}

function findDirectUserDocPlanReads() {
    return scan(({ file, source, lines, ast, found }) => {
        if (file === CANONICAL_RESOLVER) return;
        if (!/collection\(\s*['"]users['"]\s*\)/.test(source)) return;
        const tree = ast();

        // Pass 1: variables holding a users snapshot, then variables holding its data().
        const snapshots = new Set();
        const docData = new Set();
        for (let pass = 0; pass < 3; pass++) {
            walk(tree, (node) => {
                if (node.type !== 'VariableDeclarator' || !node.init || node.id.type !== 'Identifier') return;
                if (subtreeReadsUsersCollection(node.init)) snapshots.add(node.id.name);
                let fromData = false;
                walk(node.init, (n) => {
                    if (n.type !== 'CallExpression' && n.type !== 'OptionalCallExpression') return;
                    const c = n.callee;
                    if (!c || !c.property || c.property.name !== 'data') return;
                    if (c.object.type === 'Identifier' && snapshots.has(c.object.name)) fromData = true;
                });
                if (fromData) docData.add(node.id.name);
            });
        }

        // Pass 2: plan/tier reads off those variables.
        walk(tree, (node, fn, stmtLine) => {
            if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') return;
            if (node.computed || !node.property || !PLAN_FIELDS.has(node.property.name)) return;

            const obj = node.object;
            const isDocVar = obj.type === 'Identifier' && docData.has(obj.name);
            const isSubscriptionOfDocVar =
                (obj.type === 'MemberExpression' || obj.type === 'OptionalMemberExpression') &&
                !obj.computed && obj.object.type === 'Identifier' && docData.has(obj.object.name) &&
                obj.property.name === 'subscription';
            const isInlineData =
                (obj.type === 'CallExpression' || obj.type === 'OptionalCallExpression') &&
                obj.callee && obj.callee.property && obj.callee.property.name === 'data' &&
                obj.callee.object.type === 'Identifier' && snapshots.has(obj.callee.object.name);

            if (!isDocVar && !isSubscriptionOfDocVar && !isInlineData) return;

            const line = node.loc.start.line;
            found.push({
                file,
                fn,
                line,
                snippet: lines[line - 1].trim(),
                marker: markerTextFor(lines, line) || markerTextFor(lines, stmtLine)
            });
        });
    });
}

// Several reads usually sit on consecutive lines of one plan chain; report the
// first per function so a four-line chain is one finding, not four.
function dedupeByFunction(violations) {
    const seen = new Set();
    return violations.filter(v => {
        const key = `${v.file}::${v.fn}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('plan resolution contract', () => {
    it('scans a plausible number of source files (guards cannot pass vacuously)', () => {
        expect(SOURCE_FILES.length).toBeGreaterThanOrEqual(MIN_SOURCE_FILES);
        expect(SOURCE_FILES.some(f => f.endsWith('/middleware/rateLimiter.js'))).toBe(true);
        expect(SOURCE_FILES.some(f => f.endsWith('/routes/investorRoutes.js'))).toBe(true);
    });

    describe('guard 1 — getUserPlan must resolve a workspace', () => {
        const { violations, totalCalls } = findBareGetUserPlan();

        it('finds the known getUserPlan call sites', () => {
            expect(totalCalls).toBeGreaterThanOrEqual(MIN_GETUSERPLAN_CALLS);
        });

        it('has no bare getUserPlan(userId) call outside the recorded exemptions', () => {
            assertClean(adjudicate(dedupeByFunction(violations), EXEMPT_BARE, 'bare getUserPlan'));
        });
    });

    describe('guard 2 — no local plan chain off a users document', () => {
        const violations = dedupeByFunction(findDirectUserDocPlanReads());

        it('has no direct users/{uid}.plan or .tier read outside the recorded exemptions', () => {
            assertClean(adjudicate(violations, EXEMPT_DIRECT, 'direct users-doc plan read'));
        });

        it('still recognises planGate as the canonical resolver it exempts', () => {
            const canonical = fs.readFileSync(path.join(SOURCE_ROOT, CANONICAL_RESOLVER), 'utf8');
            expect(canonical).toMatch(/subscription\?\.plan/);
            expect(canonical).toMatch(/userData\?\.tier/);
        });
    });

    it('records a non-empty, reviewable reason for every exemption', () => {
        for (const entry of [...EXEMPT_BARE, ...EXEMPT_DIRECT]) {
            expect(entry.reason.length).toBeGreaterThanOrEqual(15);
        }
    });
});
