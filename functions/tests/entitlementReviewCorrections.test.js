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
