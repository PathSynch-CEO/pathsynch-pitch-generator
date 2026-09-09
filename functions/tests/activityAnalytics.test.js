'use strict';
jest.mock('firebase-admin');
jest.unmock('firebase-admin/firestore');
const { projectActivity, dateRange, creator, loadActivity } = require('../services/activityAnalytics');
const { eventRecord, eventId, recordLogin, withVerifiedLogins } = require('../services/operationalActivity');
const FROM = new Date('2026-08-01T00:00:00Z'), TO = new Date('2026-09-01T00:00:00Z');
const date = '2026-08-15T12:00:00Z';
const req = { userId: 'owner', workspaceId: 'ws-a', workspaceRole: 'admin' };
const membership = uid => ({ uid, workspaceId: 'ws-a', status: 'active', role: 'contributor' });
const report = (id, uid = 'member', extra = {}) => ({ id, userId: uid, createdByUid: uid, workspaceId: 'ws-a', createdAt: date, ...extra });
const login = (id = 'login', extra = {}) => ({ id, schemaVersion: 2, eventType: 'user_login', userId: 'member', subjectUserId: 'member', workspaceId: 'ws-a', entityType: 'user', entityId: 'member', createdAt: date, authenticatedAt: extra.createdAt || date, ...extra });
function project(extra = {}) {
  return projectActivity({ req, memberships: [membership('owner'), membership('member')], reports: [], events: [],
    identities: new Map([['owner', { uid: 'owner', displayName: 'Owner' }], ['member', { uid: 'member', displayName: 'Member' }]]), from: FROM, to: TO, now: new Date('2026-09-08T00:00:00Z'), ...extra });
}
const member = result => result.members.find(m => m.uid === 'member');
test('stored report without browser telemetry reconciles to one member report and visible legacy row', () => {
  const out = project({ reports: [report('r1')] });
  expect(member(out).reportCount).toBe(1); expect(out.entries).toHaveLength(1);
  expect(out.entries[0]).toMatchObject({ action: 'stored_report', provenance: 'legacy_stored_record', actorType: 'unknown' });
  expect(member(out).verifiedReportCount).toBe(0);
});
test('multiple stored reports count once per source ID', () => {
  expect(member(project({ reports: [report('r1'), report('r1'), report('r2')] })).reportCount).toBe(2);
});
test('verified creation replaces legacy feed projection rather than double counting', () => {
  const receipt = login('receipt', { eventType: 'market_report_created', entityType: 'report', entityId: 'r1' });
  const out = project({ reports: [report('r1')], events: [receipt, { ...receipt, id: 'duplicate' }] });
  expect(out.entries).toHaveLength(1); expect(member(out).reportCount).toBe(1); expect(member(out).verifiedReportCount).toBe(1);
});
test('browser telemetry with a server marker never becomes a verified event', () => {
  const out = project({ events: [{ ...login(), schemaVersion: undefined, serverVerified: true, action: 'report_generated' }] });
  expect(out.entries).toEqual([]); expect(member(out).lastLoginAt).toBeNull();
});
test('workspace-scoped authenticated login updates without a report', () => {
  const out = project({ events: [login()] }); expect(member(out).lastLoginAt).toBe(new Date(date).toISOString());
  expect(out.entries[0].action).toBe('user_login');
});
test('duplicate login callbacks contribute one event', () => expect(project({ events: [login(), login()] }).entries).toHaveLength(1));
test('cross-workspace reports and sign-ins do not leak', () => {
  const out = project({ reports: [report('other', 'member', { workspaceId: 'ws-b' })], events: [login('other', { workspaceId: 'ws-b' })] });
  expect(member(out).reportCount).toBe(0); expect(member(out).lastLoginAt).toBeNull(); expect(out.entries).toEqual([]);
});
test('missing workspace identity is never inferred from current membership', () => {
  expect(member(project({ reports: [report('solo', 'member', { workspaceId: null })] })).storedReportTotal).toBe(0);
});
test('conflicting owner fields do not impersonate another member', () => {
  const out = project({ reports: [report('forged', 'attacker', { createdByUid: 'member' })] });
  expect(out.warnings.unassignedReports).toBe(1); expect(member(out).reportCount).toBe(0);
});
test('legacy UID fallback is explicit and does not require display-name mapping', () => {
  const out = project({ reports: [report('legacy', 'member', { createdByUid: null })] }); expect(member(out).reportCount).toBe(1);
});
test('missing user identity is unassigned', () => expect(creator({ userId: null, createdByUid: 'member' })).toBeNull());
test('contributors cannot see peer report counts, names, or sign-in events', () => {
  const out = project({ req: { ...req, userId: 'member', workspaceRole: 'contributor' }, reports: [report('owner-report', 'owner'), report('own')], events: [login('owner-login', { userId: 'owner' })] });
  expect(out.members.map(m => m.uid)).toEqual(['member']); expect(out.entries.map(e => e.resourceId)).toEqual(['own']);
});
test.each(['removed', 'disabled', 'deleted'])('%s users retain historical counts without current profile PII', status => {
  const identities = new Map(status === 'deleted' ? [] : [['member', { displayName: 'Private Name', email: 'private@example.test', disabled: status === 'disabled' }]]);
  const out = project({ memberships: [{ ...membership('member'), status: status === 'removed' ? 'removed' : 'active' }], identities, reports: [report('r1')] });
  expect(member(out).reportCount).toBe(1); expect(member(out).email).toBe(''); expect(member(out).name).not.toBe('Private Name');
});
test('unknown historical UID gets a neutral former-member bucket', () => {
  const out = project({ reports: [report('r1', 'former')] }); expect(out.members.find(m => m.uid === 'former')).toMatchObject({ name: 'Former member', reportCount: 1, email: '' });
});

test.each(['removed', 'disabled', 'suspended'])('inactive membership retains %s when Auth lookup was deliberately skipped', status => {
  const out = project({ memberships: [{ ...membership('member'), status }], identities: new Map(), reports: [report('r1')] });
  expect(member(out)).toMatchObject({ status, reportCount: 1, email: '' });
  expect(member(out).name).toBe('Former or disabled member');
});

test('active membership with missing Auth identity is still marked deleted', () => {
  expect(member(project({ identities: new Map() })).status).toBe('deleted');
});
test('soft-deleted inventory is excluded while a real generation receipt remains historical evidence', () => {
  const out = project({ reports: [report('r1', 'member', { deletedAt: date })], events: [login('receipt', { eventType: 'market_report_created', entityType: 'report', entityId: 'r1' })] });
  expect(member(out).reportCount).toBe(0); expect(member(out).verifiedReportCount).toBe(1);
});
test('half-open UTC range and missing dates do not fabricate activity', () => {
  const out = project({ reports: [report('start', 'member', { createdAt: FROM }), report('end', 'member', { createdAt: TO }), report('missing', 'member', { createdAt: null })] });
  expect(member(out).reportCount).toBe(1); expect(member(out).storedReportTotal).toBe(3); expect(out.warnings.missingReportDates).toBe(1);
});
test('ordered events have a stable tie break', () => {
  expect(project({ events: [login('b'), login('a')] }).entries.map(e => e.id)).toEqual(['a', 'b']);
});
test('future events are omitted', () => expect(project({ events: [login('future', { createdAt: '2027-01-01' })] }).entries).toEqual([]));
test('last workspace sign-in before range remains visible without counting in-range activity', () => {
  const out = project({ events: [login('old', { createdAt: '2026-07-01' })] }); expect(member(out).lastLoginAt).toBe('2026-07-01T00:00:00.000Z'); expect(out.entries).toEqual([]);
});

test('latest workspace sign-in remains visible when selecting a historical range', () => {
  const out = project({ events: [login('old'), login('recent', { createdAt: '2026-09-05T00:00:00Z' })] });
  expect(member(out).lastLoginAt).toBe('2026-09-05T00:00:00.000Z');
  expect(out.entries.map(e => e.id)).toEqual(['old']);
});

test('future observations never update Last Login even if the selected range includes them', () => {
  const out = project({ to: new Date('2026-09-09T00:00:00Z'), events: [login('future', { createdAt: '2026-09-08T12:00:00Z' })] });
  expect(member(out).lastLoginAt).toBeNull();
  expect(out.entries).toEqual([]);
});
test('solo sign-in uses Auth rather than client profile timestamp', () => {
  const out = project({ req: { userId: 'member', workspaceId: null }, memberships: [membership('member')], identities: new Map([['member', { metadata: { lastSignInTime: date } }]]) });
  expect(member(out).lastLoginAt).toBe(new Date(date).toISOString());
  expect(out.scope).toBe('self');
  expect(out.workspaceId).toBeNull();
});
test.each([0, -1, 367, 'bad', 1.5])('invalid days %s fails closed', days => expect(() => dateRange({ days }, TO)).toThrow());
test('custom reversed range fails closed', () => expect(() => dateRange({ from: '2026-09-01', to: '2026-08-01' }, TO)).toThrow());

test.each([0, 400, 'invalid'])('explicit dates take precedence over unused days=%s', days => {
  expect(dateRange({ from: FROM.toISOString(), to: TO.toISOString(), days }, TO)).toEqual({ from: FROM, to: TO });
});

test('explicit date validation still rejects empty dates and ranges over 366 days', () => {
  expect(() => dateRange({ from: '', to: TO.toISOString(), days: 'ignored' }, TO)).toThrow();
  expect(() => dateRange({ from: '2020-01-01', to: TO.toISOString(), days: 'ignored' }, TO)).toThrow();
});

test('partial dates still validate the days fallback', () => {
  expect(() => dateRange({ from: FROM.toISOString(), days: 'invalid' }, TO)).toThrow();
  expect(() => dateRange({ to: TO.toISOString(), days: 0 }, TO)).toThrow();
});

test.each(['contributor', 'staff'])('%s reads own inventory even when peers exceed the source cap', async role => {
  const admin = require('firebase-admin');
  const records = [report('own'), ...Array.from({ length: 5001 }, (_, i) => report('peer-' + i, 'owner'))];
  function query(rows, filters = [], limit = Infinity) {
    return {
      where: (field, op, value) => { if (op !== '==') throw Error('Unexpected fixture operator'); return query(rows, [...filters, [field, value]], limit); },
      select: () => query(rows, filters, limit),
      limit: n => query(rows, filters, n),
      get: async () => {
        const selected = rows.filter(r => filters.every(([field, value]) => r[field] === value)).slice(0, limit);
        return { size: selected.length, docs: selected.map((r, i) => ({ id: r.id || String(i), data: () => r })) };
      }
    };
  }
  const db = { collection: name => name === 'workspaceMembers' ? query([{ ...membership('member'), role }])
    : name === 'users' ? { doc: () => ({ collection: () => query([]) }) } : query(records) };
  const identities = { getUser: async uid => ({ uid }), getUsers: async ids => ({ users: ids.map(({ uid }) => ({ uid })) }) };
  const firestore = jest.spyOn(admin, 'firestore').mockReturnValue(db);
  const auth = jest.spyOn(admin, 'auth').mockReturnValue(identities);
  try {
    const out = await loadActivity({ ...req, userId: 'member', query: { from: FROM.toISOString(), to: TO.toISOString() } });
    expect(out.scope).toBe('self');
    expect(out.members).toHaveLength(1);
    expect(member(out)).toMatchObject({ reportCount: 1, pitchCount: 1, storedReportTotal: 1 });
  } finally { firestore.mockRestore(); auth.mockRestore(); }
});
test.each(['ws-a', null])('operational cap excludes other workspaces before reading scope %s', async workspaceId => {
  const admin = require('firebase-admin');
  const events = [login('selected', { workspaceId }), ...Array.from({ length: 20001 }, (_, i) => login('other-' + i, { workspaceId: 'ws-b' }))];
  function query(rows, filters = [], limit = Infinity) {
    return {
      where: (field, op, value) => { if (op !== '==') throw Error('Unexpected fixture operator'); return query(rows, [...filters, [field, value]], limit); },
      select: () => query(rows, filters, limit),
      limit: n => query(rows, filters, n),
      get: async () => {
        const selected = rows.filter(r => filters.every(([field, value]) => r[field] === value)).slice(0, limit);
        return { size: selected.length, docs: selected.map((r, i) => ({ id: r.id || String(i), data: () => r })) };
      }
    };
  }
  const db = { collection: name => name === 'workspaceMembers' ? query([membership('member')])
    : name === 'users' ? { doc: () => ({ collection: () => query(events) }) } : query([]) };
  const identities = { getUser: async uid => ({ uid }), getUsers: async ids => ({ users: ids.map(({ uid }) => ({ uid })) }) };
  const firestore = jest.spyOn(admin, 'firestore').mockReturnValue(db);
  const auth = jest.spyOn(admin, 'auth').mockReturnValue(identities);
  try {
    const out = await loadActivity({ ...req, userId: 'member', workspaceId, query: { from: FROM.toISOString(), to: TO.toISOString() } });
    expect(out.workspaceId).toBe(workspaceId);
    expect(out.entries.map(e => e.id)).toEqual(['selected']);
    expect(out.members.map(m => m.uid)).toEqual(['member']);
  } finally { firestore.mockRestore(); auth.mockRestore(); }
});

test('receipt IDs bind operation, actor, workspace, and entity', () => {
  const base = eventId('user_login', 'u', 'w', '123');
  expect(eventId('user_login', 'u', 'w', '123')).toBe(base);
  expect(eventId('user_login', 'u', 'other', '123')).not.toBe(base);
  expect(eventId('user_login', 'other', 'w', '123')).not.toBe(base);
});
test('operational receipts use only fixed non-PII schema and never notification timestamp', () => {
  const e = eventRecord({ type: 'market_report_created', userId: 'u', workspaceId: 'w', entityId: 'r', metadata: { email: 'ignored@example.test' } });
  expect(e.metadata).toEqual({}); expect(e.timestamp).toBeUndefined(); expect(e.createdAt).toBeDefined();
});
test('login evidence derives from Auth even if profile field is forged', async () => {
  const auth = { getUsers: jest.fn(async () => ({ users: [{ uid: 'u', metadata: { lastSignInTime: date } }] })) };
  const [row] = await withVerifiedLogins([{ id: 'u', lastLoginAt: '2099-01-01' }], auth);
  expect(row.lastLoginAt.toISOString()).toBe(new Date(date).toISOString());
});
test('missing Auth user never falls back to client last login', async () => {
  const [row] = await withVerifiedLogins([{ id: 'deleted', lastLoginAt: '2099-01-01' }], { getUsers: async () => ({ users: [] }) });
  expect(row.lastLoginAt).toBeNull();
});
test('no raw session identifier or client metadata is stored by login writer', async () => {
  const create = jest.fn(); const ref = {};
  const db = { collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ref }) }) }), runTransaction: fn => fn({ get: async () => ({ exists: false }), create }) };
  await recordLogin(db, { userId: 'u', workspaceId: 'w', authTime: 1000000000 });
  expect(create.mock.calls[0][1].entityId).toBe('u');
  expect(create.mock.calls[0][1].authTime).toBeUndefined();
  expect(create.mock.calls[0][1].authenticatedAt).toBeDefined();
});

test('late first observation does not fabricate a fresh Last Login', () => {
  const out = project({ events: [login('delayed', { authenticatedAt: '2026-07-01T00:00:00Z' })] });
  expect(member(out).lastLoginAt).toBe('2026-07-01T00:00:00.000Z');
  expect(out.entries[0].createdAt).toBe(new Date(date).toISOString());
});

test('admin and member stored report metrics reconcile by stable ownership', () => {
 const { adminActivitySummary } = require('../services/adminActivitySummary');
 const records = [report('r1'), report('r2'), report('conflict', 'other', { createdByUid: 'member' })];
 const summary = adminActivitySummary([{ id: 'member', plan: 'growth', lastLoginAt: new Date(date) }], records, [], TO);
 expect(summary.storedReportTotal).toBe(member(project({ reports: records })).storedReportTotal);
 expect(summary.adoption[0].storedReportCount).toBe(member(project({ reports: records })).reportCount);
 expect(summary.reportActivity.filter(e => e.type === 'stored_report')).toHaveLength(2);
 expect(summary.reportActivity.filter(e => e.type === 'authenticated_login')).toHaveLength(1);
});
