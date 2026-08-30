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
    },
    {
        file: 'index.js',
        fn: 'users',
        reason: 'admin panel display field, one row per account'
    },
    {
        file: 'backfill-migration.js',
        fn: 'createUsageDocuments',
        reason: 'one-off backfill script, not a request path'
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

function readSources() {
    return SOURCE_FILES.map(absolute => ({
        file: path.relative(SOURCE_ROOT, absolute).split(path.sep).join('/'),
        source: fs.readFileSync(absolute, 'utf8')
    }));
}

/** Guard 1: getUserPlan called without a resolved workspace. */
function findBareGetUserPlanIn(file, source) {
    const violations = [];
    let totalCalls = 0;
    if (!source.includes('getUserPlan')) return { violations, totalCalls };
    if (file === CANONICAL_RESOLVER) return { violations, totalCalls }; // the declaration + its own recursion
    const lines = source.split('\n');

    walk(parse(source, file), (node, fn, stmtLine) => {
        if (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression') return;
        const callee = node.callee;
        const name = callee.type === 'Identifier'
            ? callee.name
            : (callee.property && callee.property.name);
        if (name !== 'getUserPlan') return;
        totalCalls += 1;

        const options = node.arguments[1];
        const resolvesWorkspace = options &&
            options.type === 'ObjectExpression' &&
            options.properties.some(p => p.key && (p.key.name || p.key.value) === 'workspaceId');
        if (resolvesWorkspace) return;

        const line = node.loc.start.line;
        violations.push({
            file,
            fn,
            line,
            // Every call is its own violation: a second bare call inside an
            // already-exempt function needs its own marker, never the licence of
            // the call above it.
            key: `${file}::call@${line}:${node.loc.start.column}`,
            snippet: lines[line - 1].trim(),
            marker: markerTextFor(lines, line) || markerTextFor(lines, stmtLine)
        });
    });
    return { violations, totalCalls };
}

/**
 * Guard 2: a plan/tier field read off a users/{uid} document.
 *
 * Tracked by dataflow rather than by name so that `userStatus.tier` — which
 * comes from a limit-checking helper, not a Firestore doc — is not swept up.
 * Bindings are scoped LEXICALLY: a `userData` in one function does not taint an
 * unrelated `userData` in the next, which would push its author toward writing
 * an exemption for code that never touched a users document.
 */
const PLAN_FIELDS = new Set(['plan', 'tier', 'planTier']);
const ITERATORS = new Set(['map', 'forEach', 'flatMap', 'filter', 'find', 'reduce']);

function unwrap(node) {
    let n = node;
    while (n) {
        if (n.type === 'AwaitExpression') n = n.argument;
        else if (n.type === 'ParenthesizedExpression' || n.type === 'TSNonNullExpression') n = n.expression;
        else break;
    }
    return n;
}

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

function makeScope(parent) {
    return {
        parent,
        snapshots: new Set(),
        docData: new Set(),
        has(kind, name) {
            for (let s = this; s; s = s.parent) if (s[kind].has(name)) return true;
            return false;
        }
    };
}

/**
 * Walk a function's OWN scope: every node under `root` except the bodies of
 * nested functions, which get their own scope and are visited separately.
 */
function walkOwn(root, visit) {
    const ancestors = [];
    (function step(node, parent, stmtLine) {
        if (!node || typeof node.type !== 'string') return;
        let nextStmt = stmtLine;
        if (node.loc && (node.type.endsWith('Statement') || node.type.endsWith('Declaration'))) {
            nextStmt = node.loc.start.line;
        }
        visit(node, parent, nextStmt, ancestors);
        if (node !== root && FUNCTION_TYPES.has(node.type)) return;
        ancestors.push(node);
        for (const key of Object.keys(node)) {
            if (key === 'loc' || key.endsWith('Comments')) continue;
            const value = node[key];
            if (Array.isArray(value)) {
                for (const child of value) {
                    if (child && typeof child.type === 'string') step(child, node, nextStmt);
                }
            } else if (value && typeof value.type === 'string') {
                step(value, node, nextStmt);
            }
        }
        ancestors.pop();
    })(root, null, root.loc ? root.loc.start.line : 1);
}

function findDirectUserDocPlanReadsIn(file, source) {
    const found = [];
    if (file === CANONICAL_RESOLVER) return found;
    if (!/collection\(\s*['"]users['"]\s*\)/.test(source)) return found;
    const lines = source.split('\n');

    /** Does this expression evaluate to a users/{uid} document snapshot? */
    function isUsersSnapshot(node, scope) {
        const n = unwrap(node);
        if (!n) return false;
        if (n.type === 'Identifier') return scope.has('snapshots', n.name);
        return subtreeReadsUsersCollection(n);
    }

    /** `snap.docs` / a users QuerySnapshot being iterated. */
    function isUsersDocList(node, scope) {
        const n = unwrap(node);
        if (!n) return false;
        if ((n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') &&
            !n.computed && n.property.name === 'docs') {
            return isUsersSnapshot(n.object, scope);
        }
        return isUsersSnapshot(n, scope);
    }

    /** The receiver of a `.data()` call anywhere in this initialiser. */
    function dataCallReceiver(init, scope) {
        let receiver = null;
        walk(init, (n) => {
            if (receiver) return;
            if (n.type !== 'CallExpression' && n.type !== 'OptionalCallExpression') return;
            const c = n.callee;
            if (!c || !c.property || c.property.name !== 'data') return;
            if (isUsersSnapshot(c.object, scope)) receiver = c.object;
        });
        return receiver;
    }

    function classify(name, init, scope) {
        if (!init) return;
        // `.data()` first: an inline chain is BOTH a users read and a data read,
        // and it is the data half that carries the plan fields.
        if (dataCallReceiver(init, scope)) { scope.docData.add(name); return; }
        const bare = unwrap(init);
        if (bare && bare.type === 'Identifier' && scope.has('docData', bare.name)) {
            scope.docData.add(name);
            return;
        }
        if (subtreeReadsUsersCollection(init)) scope.snapshots.add(name);
    }

    function analyze(root, scope, fnName) {
        const nested = [];

        // Declarations settle first, twice, so `snap` → `snap.data()` resolves
        // regardless of which line the scanner reaches first.
        for (let pass = 0; pass < 2; pass++) {
            walkOwn(root, (node, parent, _stmt, ancestors) => {
                if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
                    classify(node.id.name, node.init, scope);
                } else if (node.type === 'ForOfStatement' &&
                           node.left.type === 'VariableDeclaration' &&
                           node.left.declarations[0].id.type === 'Identifier' &&
                           isUsersDocList(node.right, scope)) {
                    scope.snapshots.add(node.left.declarations[0].id.name);
                }
                if (pass === 0 || !FUNCTION_TYPES.has(node.type) || node === root) return;
                // `usersSnap.docs.map(doc => doc.data().plan)`: the callback's first
                // parameter is a users document in the callback's own scope.
                const child = makeScope(scope);
                if (parent && (parent.type === 'CallExpression' || parent.type === 'OptionalCallExpression') &&
                    parent.callee && parent.callee.property && ITERATORS.has(parent.callee.property.name) &&
                    isUsersDocList(parent.callee.object, scope) &&
                    node.params[0] && node.params[0].type === 'Identifier') {
                    child.snapshots.add(node.params[0].name);
                }
                nested.push({
                    node,
                    scope: child,
                    // Same naming as guard 1, so one inventory entry keyed by
                    // enclosing function covers both: `exports.api = onRequest(…)`
                    // is `api`, and an anonymous callback keeps its parent's name.
                    name: functionName(node, ancestors) || fnName
                });
            });
        }

        walkOwn(root, (node, parent, stmtLine) => {
            if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') return;
            if (node.computed || !node.property || !PLAN_FIELDS.has(node.property.name)) return;

            const obj = node.object;
            let root_ = null;
            if (obj.type === 'Identifier' && scope.has('docData', obj.name)) {
                root_ = obj.name;
            } else if ((obj.type === 'MemberExpression' || obj.type === 'OptionalMemberExpression') &&
                       !obj.computed && obj.object.type === 'Identifier' &&
                       scope.has('docData', obj.object.name) && obj.property.name === 'subscription') {
                root_ = obj.object.name;
            } else if ((obj.type === 'CallExpression' || obj.type === 'OptionalCallExpression') &&
                       obj.callee && obj.callee.property && obj.callee.property.name === 'data' &&
                       isUsersSnapshot(obj.callee.object, scope)) {
                root_ = 'inline .data()';
            }
            if (!root_) return;

            const line = node.loc.start.line;
            found.push({
                file,
                fn: fnName,
                line,
                // One plan chain is one finding — `a.plan || a.tier || a.subscription.plan`
                // spans four reads of one expression. A SEPARATE statement, or a
                // different document variable, is a separate finding that needs its
                // own marker.
                key: `${file}::stmt@${stmtLine}::${root_}`,
                snippet: lines[line - 1].trim(),
                marker: markerTextFor(lines, line) || markerTextFor(lines, stmtLine)
            });
        });

        for (const child of nested) analyze(child.node, child.scope, child.name);
    }

    analyze(parse(source, file), makeScope(null), '<module>');
    return found;
}

/**
 * Collapse the reads belonging to one expression, keyed by call/statement
 * identity. Keying by file+function instead would let any SECOND violation in an
 * already-exempt function inherit the first one's licence.
 */
function groupByIdentity(violations) {
    const seen = new Set();
    return violations.filter(v => {
        if (seen.has(v.key)) return false;
        seen.add(v.key);
        return true;
    });
}

function scanTreeForBareGetUserPlan() {
    const violations = [];
    let totalCalls = 0;
    for (const { file, source } of readSources()) {
        const result = findBareGetUserPlanIn(file, source);
        violations.push(...result.violations);
        totalCalls += result.totalCalls;
    }
    return { violations: groupByIdentity(violations), totalCalls };
}

function scanTreeForDirectReads() {
    const violations = [];
    for (const { file, source } of readSources()) {
        violations.push(...findDirectUserDocPlanReadsIn(file, source));
    }
    return groupByIdentity(violations);
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
        const { violations, totalCalls } = scanTreeForBareGetUserPlan();

        it('finds the known getUserPlan call sites', () => {
            expect(totalCalls).toBeGreaterThanOrEqual(MIN_GETUSERPLAN_CALLS);
        });

        it('has no bare getUserPlan(userId) call outside the recorded exemptions', () => {
            assertClean(adjudicate(violations, EXEMPT_BARE, 'bare getUserPlan'));
        });
    });

    describe('guard 2 — no local plan chain off a users document', () => {
        const violations = scanTreeForDirectReads();

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

    // -----------------------------------------------------------------------
    // The guards' own regression suite.
    //
    // Every shape below is one a guard once passed clean. A guard is only worth
    // the CI minute if the holes it has already had stay shut, so each is pinned
    // here against a synthetic source rather than by injecting into the tree.
    // -----------------------------------------------------------------------
    describe('the guards catch the shapes they once missed', () => {
        const lines_ = s => s.split('\n').map(l => l.replace(/^ {12}/, '')).join('\n');
        const bare = src => findBareGetUserPlanIn('fixture.js', lines_(src)).violations;
        const direct = src => groupByIdentity(findDirectUserDocPlanReadsIn('fixture.js', lines_(src)));

        it('sees a plan read off an inline (await …get()).data() chain', () => {
            const found = direct(`
            async function handler(uid) {
                const user = (await db.collection('users').doc(uid).get()).data();
                return user.plan || user.tier;
            }`);
            expect(found).toHaveLength(1);
            expect(found[0].fn).toBe('handler');
        });

        it('sees a plan read off a chain with no intermediate variable at all', () => {
            const found = direct(`
            async function handler(uid) {
                return (await db.collection('users').doc(uid).get()).data().tier;
            }`);
            expect(found).toHaveLength(1);
        });

        it('sees a plan read off a query snapshot document in a .docs.map() callback', () => {
            const found = direct(`
            async function handler() {
                const snap = await db.collection('users').where('active', '==', true).get();
                return snap.docs.map(doc => {
                    const u = doc.data();
                    return u.plan;
                });
            }`);
            expect(found).toHaveLength(1);
        });

        it('sees a plan read off a document iterated with for…of', () => {
            const found = direct(`
            async function handler() {
                const snap = await db.collection('users').get();
                for (const doc of snap.docs) {
                    if (doc.data().tier === 'free') return doc.id;
                }
                return null;
            }`);
            expect(found).toHaveLength(1);
        });

        it('does not taint a same-named variable in an unrelated function', () => {
            const found = direct(`
            async function reads(uid) {
                const userDoc = await db.collection('users').doc(uid).get();
                const userData = userDoc.data();
                // plan-gate-exempt(fixture): recorded
                return userData.plan;
            }
            function unrelated(userData) {
                return userData.tier;
            }`);
            expect(found).toHaveLength(1);
            expect(found[0].fn).toBe('reads');
        });

        it('does not fire on a plan field from another collection', () => {
            expect(direct(`
            async function handler(uid) {
                const userDoc = await db.collection('users').doc(uid).get();
                const config = (await db.collection('merchantConfig').doc(uid).get()).data();
                return config.planTier + userDoc.id;
            }`)).toEqual([]);
        });

        it('reports a SECOND bare getUserPlan in an exempt function separately', () => {
            const found = bare(`
            async function getUser(userId) {
                // plan-gate-exempt(fixture): recorded reason
                const shown = await getUserPlan(userId);
                const sneaked = await getUserPlan(userId);
                return [shown, sneaked];
            }`);
            expect(found).toHaveLength(2);

            const verdict = adjudicate(
                found,
                [{ file: 'fixture.js', fn: 'getUser', reason: 'recorded reason' }],
                'fixture'
            );
            expect(verdict.unexcused).toEqual([]);
            expect(verdict.unmarked).toHaveLength(1);
            expect(verdict.unmarked[0]).toContain('sneaked');
        });

        it('reports a SECOND direct plan read in an exempt function separately', () => {
            const found = direct(`
            async function checkPlanLimits(uid) {
                const userDoc = await db.collection('users').doc(uid).get();
                const userData = userDoc.data();
                // plan-gate-exempt(fixture): recorded reason
                const shown = userData.tier || 'starter';
                const sneaked = userData.plan || userData.subscription.tier;
                return [shown, sneaked];
            }`);
            expect(found).toHaveLength(2);

            const verdict = adjudicate(
                found,
                [{ file: 'fixture.js', fn: 'checkPlanLimits', reason: 'recorded reason' }],
                'fixture'
            );
            expect(verdict.unmarked).toHaveLength(1);
            expect(verdict.unmarked[0]).toContain('sneaked');
        });

        it('still treats one plan chain in one statement as a single finding', () => {
            expect(direct(`
            async function handler(uid) {
                const userDoc = await db.collection('users').doc(uid).get();
                const userData = userDoc.data();
                return (
                    userData.subscription.plan ||
                    userData.subscription.tier ||
                    userData.plan ||
                    userData.tier
                );
            }`)).toHaveLength(1);
        });

        it('still passes a getUserPlan call that resolves a workspace', () => {
            expect(bare(`
            async function gate(req, userId) {
                return getUserPlan(userId, { workspaceId: req.workspaceId || null });
            }`)).toEqual([]);
        });
    });
});
