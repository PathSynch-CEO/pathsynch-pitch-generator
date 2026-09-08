'use strict';
jest.mock('firebase-admin');
const { adminReportInventory, adminActivitySummary } = require('../services/adminActivitySummary');
function fixture(count) {
 const rows = Array.from({length: count}, (_, i) => ({ id: String(i), data: () => ({ userId: 'fixture', createdAt: '2026-08-15' }) }));
 const query = { select: jest.fn(() => query), limit: jest.fn(limit => ({ get: async () => ({ size: Math.min(limit, count), docs: rows.slice(0, limit) }) })) };
 return { db: { collection: () => query }, query };
}
test('exactly 5000 global reports retain complete source counts', async () => {
 const {db, query} = fixture(5000); const rows = await adminReportInventory(db);
 const summary = adminActivitySummary([{id:'fixture',plan:'growth'}], rows, [], new Date('2026-09-01'));
 expect(query.limit).toHaveBeenCalledWith(5001);
 expect(summary).toMatchObject({storedReportTotal:5000,reportInventoryStatus:'complete'});
 expect(summary.adoption[0].storedReportCount).toBe(5000);
});
test('5001 reports leave dashboard usable without fabricating partial counts or zero adoption', async () => {
 const {db} = fixture(5001); const rows = await adminReportInventory(db);
 expect(rows).toBeNull();
 const summary = adminActivitySummary([{id:'fixture',plan:'growth',lastLoginAt:'2026-08-31'}], rows, [{id:'p',userId:'fixture',createdAt:'2026-08-15'}], new Date('2026-09-01'));
 expect(summary).toMatchObject({storedReportTotal:null,unassignedMarketReports:null,reportInventoryStatus:'limit_exceeded'});
 expect(summary.adoption[0]).toMatchObject({storedReportCount:null,storedPitchCount:1});
 expect(summary.reportActivity).toHaveLength(1); expect(summary.reportActivity[0].type).toBe('authenticated_login');
});
test('bounded empty inventory is a real zero, not unavailable', async () => {
 const summary = adminActivitySummary([], await adminReportInventory(fixture(0).db), []);
 expect(summary).toMatchObject({storedReportTotal:0,reportInventoryStatus:'complete',unassignedMarketReports:0});
});
test('unrelated database errors are not silently reclassified as a scale limit', async () => {
 const query = {select:()=>query,limit:()=>({get:async()=>{throw Error('fixture database unavailable')}})};
 await expect(adminReportInventory({collection:()=>query})).rejects.toThrow('fixture database unavailable');
});

test('adoption uses recorded subscription precedence rather than stale profile tier', () => {
 const users = [
  {id:'subscription-plan',subscription:{plan:'growth'},plan:'free',tier:'FREE'},
  {id:'subscription-tier',subscription:{tier:'scale'},tier:'free'},
  {id:'object-plan',subscription:{plan:{tier:'growth'}},tier:'free'},
  {id:'cancelled-free',subscription:{plan:'free'},plan:'growth'},
  {id:'profile-paid',plan:'growth'}, {id:'unknown'}
 ];
 expect(adminActivitySummary(users, [], []).adoption.map(r=>r.userId)).toEqual(['subscription-plan','subscription-tier','object-plan','profile-paid']);
});
