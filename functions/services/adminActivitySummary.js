'use strict';
const { creator } = require('./activityAnalytics');
const { toDate } = require('./operationalActivity');
function adminActivitySummary(users, reports, pitches, now = new Date()) {
  const start = new Date(now.getTime() - 30 * 86400000);
  const sourceReports = reports.filter(r => !r.deletedAt && creator(r));
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
  const adoption = users.filter(u => String(u.plan || u.tier || 'free').toLowerCase() !== 'free').map(u => ({
    userId: u.id, storedReportCount: reportCounts.get(u.id) || 0, storedPitchCount: pitchCounts.get(u.id) || 0
  }));
  return { reportActivity, adoption, storedReportTotal: sourceReports.length, reportProvenance: 'Stored inventory; legacy generation unverified' };
}
module.exports = { adminActivitySummary };
