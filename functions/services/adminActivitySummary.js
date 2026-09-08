'use strict';
const { creator, bounded } = require('./activityAnalytics');
async function adminReportInventory(db) {
  try {
    return await bounded(db.collection('marketReports').select('userId', 'createdByUid', 'workspaceId', 'createdAt', 'deletedAt'), 5000, 'Admin report inventory');
  } catch (error) {
    if (error.statusCode === 422) return null;
    throw error;
  }
}
const { toDate } = require('./operationalActivity');
// Display-only plan precedence mirrors planGate; this does not grant entitlements.
function recordedPlan(user) {
  const plan = user.subscription?.plan || user.subscription?.tier || user.plan || user.tier;
  return typeof plan === 'string' ? plan.toLowerCase() : typeof plan?.tier === 'string' ? plan.tier.toLowerCase() : 'free';
}
function adminActivitySummary(users, reports, pitches, now = new Date()) {
  const start = new Date(now.getTime() - 30 * 86400000);
  const available = Array.isArray(reports);
  const sourceReports = (reports || []).filter(r => !r.deletedAt && creator(r));
  const reportActivity = sourceReports.map(r => ({ id: 'stored-report:' + r.id, userId: creator(r), type: 'stored_report', createdAt: toDate(r.createdAt) }))
    .concat(users.map(u => ({ id: 'auth:' + u.id, userId: u.id, type: 'authenticated_login', createdAt: toDate(u.lastLoginAt) })))
    .filter(e => e.createdAt && e.createdAt <= now)
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)).slice(0, 20);
  const reportCounts = new Map(), pitchCounts = new Map();
  for (const [records, counts] of [[sourceReports, reportCounts], [pitches.filter(p => !p.deletedAt && creator(p)), pitchCounts]]) {
    for (const r of records) {
      const d = toDate(r.createdAt); if (!d || d < start || d > now) continue;
      const uid = creator(r); counts.set(uid, (counts.get(uid) || 0) + 1);
    }
  }
  const adoption = users.filter(u => recordedPlan(u) !== 'free').map(u => ({
    userId: u.id, storedReportCount: available ? reportCounts.get(u.id) || 0 : null, storedPitchCount: pitchCounts.get(u.id) || 0
  }));
  return { reportActivity, adoption, storedReportTotal: available ? sourceReports.length : null, reportInventoryStatus: available ? 'complete' : 'limit_exceeded', unassignedMarketReports: available ? reports.filter(r => !r.deletedAt && !creator(r)).length : null, reportProvenance: 'Stored inventory; legacy generation unverified' };
}
module.exports = { adminActivitySummary, adminReportInventory };
