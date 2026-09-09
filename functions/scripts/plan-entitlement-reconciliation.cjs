#!/usr/bin/env node
'use strict';
// Offline diagnostic only. No Firebase initialization, credentials, network, or write path.
const fs = require('node:fs');
function inspect(input, maxRecords = 100) {
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 500) throw Error('maxRecords must be 1..500');
  if (!input || !Array.isArray(input.workspaces) || input.workspaces.length > maxRecords) throw Error('Bounded workspaces array required');
  const { membershipState, assignmentPlan } = require('../services/workspaceEntitlements');
  const { seatContract, VERSION } = require('../services/planCatalog');
  const seen = new Set();
  return { mode: 'dry_run_only', plan_version: VERSION, workspaces: input.workspaces.map(row => {
    if (!row || typeof row.workspaceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(row.workspaceId) || seen.has(row.workspaceId)) throw Error('Unique valid workspaceId required');
    seen.add(row.workspaceId);
    if (!Array.isArray(row.members) || row.members.length > 5000) throw Error('Bounded membership array required');
    let state;
    try { state = membershipState({ docs: row.members.map(m => ({ id: m.documentId, data: () => m })) }, row.workspaceId); }
    catch (_) { return { workspace_id: row.workspaceId, status: 'membership_reconciliation_required' }; }
    const plan = assignmentPlan(row.protectedAssignment, state.ownerUid);
    if (!plan) return { workspace_id: row.workspaceId, status: 'operator_attestation_required', active_seats: state.used, automatic_grant: false };
    const seats = seatContract(plan);
    return { workspace_id: row.workspaceId, status: 'resolved', plan_id: plan, active_seats: state.used, team_seats: seats, over_limit: !seats.unlimited && state.used > seats.limit, automatic_grant: false };
  }) };
}
function main(argv) {
  if (argv.length !== 3 || argv[0] !== '--input') throw Error('Usage: node scripts/plan-entitlement-reconciliation.cjs --input <local-snapshot.json> <max-records>');
  const stat = fs.statSync(argv[1]);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw Error('Input must be a local JSON file no larger than 2 MiB');
  return inspect(JSON.parse(fs.readFileSync(argv[1], 'utf8')), Number(argv[2]));
}
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(main(process.argv.slice(2)), null, 2) + '\n'); }
  catch (error) { process.stderr.write('Reconciliation diagnostic stopped: ' + error.message + '\n'); process.exitCode = 1; }
}
module.exports = { inspect, main };
