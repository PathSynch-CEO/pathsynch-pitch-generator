'use strict';
jest.mock('firebase-admin');
jest.mock('../middleware/adminAuth',()=>({checkIsAdmin:jest.fn(async()=>true)}));
const admin=require('firebase-admin');const {createWorkspace}=require('../services/workspaceService');
const {failure}=require('../services/workspaceEntitlements');
const fs=require('fs'),vm=require('vm');
beforeEach(()=>{jest.restoreAllMocks();admin._resetMockData();admin._mockData.users['fixture-operator']={uid:'fixture-operator',email:'fixture@example.test'};admin._setMockCollection('users',{owner:{plan:'starter'}});});
test('orphaned legacy workspace cannot cause automatic duplicate provisioning',async()=>{
 admin._setMockCollection('workspaces',{legacy:{ownerId:'owner'}});admin._setMockCollection('teams',{owner:{ownerUid:'owner'}});
 await expect(createWorkspace('owner')).rejects.toMatchObject({code:'WORKSPACE_RECONCILIATION_REQUIRED'});
 expect(Object.keys(admin._mockData.collections.workspaces)).toEqual(['legacy']);expect(Object.keys(admin._mockData.collections.workspaceMembers||{})).toHaveLength(0);
});
test('protected team backlink with missing owner membership refuses provisioning',async()=>{
 admin._setMockCollection('teams',{owner:{ownerUid:'owner',workspaceId:'legacy'}});
 await expect(createWorkspace('owner')).rejects.toMatchObject({code:'WORKSPACE_RECONCILIATION_REQUIRED'});
 expect(Object.keys(admin._mockData.collections.workspaces||{})).toHaveLength(0);
});
function inlineHandler(){const source=fs.readFileSync(require.resolve('../index.js'),'utf8'),needle="console.error('Update user plan error:'";const catchAt=source.indexOf(needle),start=source.lastIndexOf('                try {',catchAt),end=source.indexOf('\n            }',catchAt);const code=source.slice(start,end);return vm.runInNewContext('(async(req,res)=>{const userId=req.params.userId;const adminEmail="fixture@example.test";const db=admin.firestore();'+code+'})',{admin,console,decodedToken:{uid:'fixture-operator'},require:id=>id.startsWith('./')?require('../'+id.slice(2)):require(id)});}
for(const kind of ['modular','inline']) for(const [code,status]of [['UNKNOWN_PLAN',400],['OPERATOR_REQUIRED',403],['ASSIGNMENT_UNRESOLVED',409]]) test(kind+' preserves '+code+' status without writes',async()=>{
 const service=require('../services/workspaceEntitlements');const spy=jest.spyOn(service,'grantFromAdminRequest').mockRejectedValueOnce(failure(code,'Synthetic rejection',status));
 const handler=kind==='inline'?inlineHandler():require('../routes/adminRoutes').routes.find(r=>r.method==='PUT'&&r.pattern.endsWith('/users/:userId/plan')).handlers.at(-1);
 const req={params:{userId:'owner'},body:{tier:'unknown'},adminEmail:'fixture@example.test'},res={status:jest.fn().mockReturnThis(),json:jest.fn().mockReturnThis()};
 await handler(req,res);expect(spy).toHaveBeenCalledTimes(1);expect(res.status).toHaveBeenCalledWith(status);expect(res.json.mock.calls[0][0].code).toBe(code);expect(admin._mockData.collections.accountPlanAssignments).toBeUndefined();spy.mockRestore();
});
test('owner resolution reads only bounded owner candidates in a large Enterprise membership set',async()=>{
 const rows=[{uid:'owner',workspaceId:'ws',status:'active',isWorkspaceOwner:true},...Array.from({length:1000},(_,i)=>({uid:'member-'+i,workspaceId:'ws',status:i%2?'active':'removed',isWorkspaceOwner:false}))];let readCount=0;
 const query=(filters=[],cap=Infinity)=>({where:(f,op,v)=>query([...filters,[f,v]],cap),limit:n=>query(filters,n),get:async()=>{const selected=rows.filter(r=>filters.every(([f,v])=>r[f]===v)).slice(0,cap);readCount+=selected.length;return {docs:selected.map(r=>({id:'ws_'+r.uid,data:()=>r}))};}});
 expect(await require('../services/workspaceEntitlements').workspaceOwner({collection:()=>query()},'ws')).toBe('owner');expect(readCount).toBe(1);
});

for (const [file, name] of [['market.js', 'generateReport'], ['bulk.js', 'uploadCSV']]) test(name + ' preserves unresolved entitlement before any work', async () => {
 const source = fs.readFileSync(require.resolve('../api/' + file), 'utf8');
 const start = source.indexOf('async function ' + name + '('), next = source.indexOf('\nasync function ', start + 1);
 const stripe = require('../config/stripe');
 const context = { console, require: id => require(id), getUserPlanForRequest: async () => 'unresolved', hasFeature: stripe.hasFeature, getPlanLimits: stripe.getPlanLimits };
 vm.createContext(context); vm.runInContext(source.slice(start, next) + '\nthis.handler=' + name + ';', context);
 const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
 await context.handler({ userId: 'fixture-user', body: {} }, res);
 expect(res.status).toHaveBeenCalledWith(409); expect(res.json.mock.calls[0][0].code).toBe('ENTITLEMENT_UNRESOLVED');
});


function seedReviewWorkspace() {
 const store = admin._mockData.collections;
 store.workspaces = { ws: { ownerId: 'forged-owner', memberIds: ['owner', 'member'], memberCount: 2 } };
 store.teams = { owner: { ownerUid: 'owner', members: [], memberUids: ['member'] } };
 require('./helpers/entitlementFixtures').seed(store, { ownerUid: 'owner', workspaceId: 'ws', plan: 'enterprise', memberUids: ['member'] });
 return store;
}

test('request plan resolution reads bounded membership rows despite a large historical roster', async () => {
 const store = seedReviewWorkspace();
 for (let i = 0; i < 1000; i++) store.workspaceMembers['ws_old-' + i] = { uid: 'old-' + i, workspaceId: 'ws', status: 'removed', isWorkspaceOwner: false };
 let membershipReads = 0;
 const query = (name, filters = [], cap = Infinity) => ({
  where: (field, op, value) => query(name, [...filters, [field, value]], cap),
  limit: count => query(name, filters, count),
  get: async () => {
   const rows = Object.entries(store[name] || {}).filter(([, data]) => filters.every(([field, value]) => data[field] === value)).slice(0, cap);
   if (name === 'workspaceMembers') membershipReads += rows.length;
   return { docs: rows.map(([id, data]) => ({ id, data: () => data })) };
  },
  doc: id => ({ get: async () => {
   const data = store[name]?.[id];
   if (name === 'workspaceMembers' && data) membershipReads++;
   return { id, exists: !!data, data: () => data };
  } })
 });
 const originalFirestore = admin.firestore.getMockImplementation();
 admin.firestore.mockReturnValue({ collection: name => query(name) });
 try {
  expect(await require('../services/workspaceEntitlements').effectivePlan('member', 'ws')).toBe('enterprise');
  expect(membershipReads).toBeLessThanOrEqual(3);
 } finally {
  admin.firestore.mockImplementation(originalFirestore);
 }
});

for (const scenario of ['missing-workspace', 'absent-caller', 'removed-caller', 'mismatched-caller', 'conflicting-owner']) test('bounded plan lookup fails closed for ' + scenario, async () => {
 const store = seedReviewWorkspace();
 const expected = scenario === 'missing-workspace' ? 'WORKSPACE_NOT_FOUND' : scenario === 'conflicting-owner' ? 'OWNER_UNRESOLVED' : 'MEMBERSHIP_REQUIRED';
 if (scenario === 'missing-workspace') delete store.workspaces.ws;
 if (scenario === 'absent-caller') delete store.workspaceMembers.ws_member;
 if (scenario === 'removed-caller') store.workspaceMembers.ws_member.status = 'removed';
 if (scenario === 'mismatched-caller') store.workspaceMembers.ws_member.uid = 'different-user';
 if (scenario === 'conflicting-owner') store.workspaceMembers.ws_member.isWorkspaceOwner = true;
 await expect(require('../services/workspaceEntitlements').effectivePlan('member', 'ws')).rejects.toMatchObject({ code: expected });
});

for (const missing of ['assignment', 'profile']) test('actual pitch handler preserves ' + missing + ' reconciliation 409 before generation or writes', async () => {
 seedReviewWorkspace();
 if (missing === 'assignment') admin._setMockCollection('accountPlanAssignments', {});
 else delete admin._mockData.collections.users.member;
 const source = fs.readFileSync(require.resolve('../api/pitchGenerator'), 'utf8');
 const start = source.indexOf('async function generatePitch('), end = source.indexOf('\nasync function ', start + 1);
 const context = { console, process: { env: {} }, require: id => require(id), getDb: () => admin.firestore(), checkPitchLimit: require('../api/pitch/validators').checkPitchLimit };
 vm.createContext(context); vm.runInContext(source.slice(start, end) + '\nthis.handler=generatePitch;', context);
 const before = JSON.stringify(admin._mockData.collections);
 const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
 await context.handler({ userId: 'member', workspaceId: 'ws', body: {} }, res);
 expect(res.status).toHaveBeenCalledWith(409);
 expect(res.json.mock.calls[0][0].code).toBe(missing === 'assignment' ? 'ENTITLEMENT_UNRESOLVED' : 'USAGE_UNRESOLVED');
 expect(JSON.stringify(admin._mockData.collections)).toBe(before);
});

for (const plan of [null, 'starter', 'growth']) test('requirePlan distinguishes unresolved, insufficient and sufficient authority: ' + plan, async () => {
 const store = seedReviewWorkspace();
 if (plan) store.accountPlanAssignments.owner = require('./helpers/entitlementFixtures').assignment('owner', plan);
 else store.accountPlanAssignments = {};
 const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() }, next = jest.fn();
 await require('../middleware/planGate').requirePlan('growth')({ userId: 'member', workspaceId: 'ws' }, res, next);
 if (plan === 'growth') { expect(next).toHaveBeenCalledTimes(1); expect(res.status).not.toHaveBeenCalled(); }
 else {
  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(plan === 'starter' ? 403 : 409);
  if (!plan) { expect(res.json.mock.calls[0][0].code).toBe('ENTITLEMENT_UNRESOLVED'); expect(JSON.stringify(res.json.mock.calls[0][0])).not.toMatch(/upgrade/i); }
 }
});

function teamInviteHandler() {
 const source = fs.readFileSync(require.resolve('../routes/teamRoutes'), 'utf8');
 const start = source.indexOf("router.post('/team/invite'"), end = source.indexOf('\n});', start) + 4;
 let handler;
 const service = require('../services/workspaceService');
 const context = { router: { post: (route, fn) => { handler = fn; } }, db: admin.firestore(), admin, console,
  ...require('../middleware/errorHandler'), isValidEmail: () => true,
  normalizeRole: require('../middleware/workspaceRoleGuard').normalizeRole, VALID_ROLES: ['contributor', 'admin'],
  getUserTeam: async () => ({ isOwner: false, userRole: 'admin' }),
  getWorkspaceForUser: service.getWorkspaceForUser, createWorkspace: service.createWorkspace,
  createWorkspaceInvite: require('../services/workspaceInviteService').createInvite,
  sendWorkspaceInviteEmail: jest.fn(async () => {}) };
 vm.createContext(context); vm.runInContext(source.slice(start, end), context);
 return handler;
}

test('team invite rejects nonowner admin with a stale own team before changing an expired invitation', async () => {
 const store = seedReviewWorkspace(); store.workspaceMembers.ws_member.role = 'admin';
 store.teams.member = { ownerUid: 'member', members: [], memberUids: [] };
 store.teamInvitations = { expired: { teamOwnerUid: 'member', inviteeEmail: 'new@example.test', status: 'pending', expiresAt: admin.firestore.Timestamp.fromDate(new Date('2020-01-01')) } };
 const before = JSON.stringify(store), res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
 await teamInviteHandler()({ userId: 'member', userEmail: 'member@example.test', body: { email: 'new@example.test', role: 'contributor' } }, res);
 expect(res.status).toHaveBeenCalledWith(403);
 expect(JSON.stringify(store)).toBe(before);
});

test('team invite still allows the protected owner despite an editable forged owner pointer', async () => {
 const store = seedReviewWorkspace(), res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
 await teamInviteHandler()({ userId: 'owner', userEmail: 'owner@example.test', body: { email: 'new@example.test', role: 'contributor' } }, res);
 expect(res.status).toHaveBeenCalledWith(201);
 const invitations = Object.values(store.teamInvitations || {});
 expect(invitations).toHaveLength(1);
 expect(invitations[0]).toMatchObject({ teamOwnerUid: 'owner', workspaceId: 'ws', inviterUid: 'owner' });
});
