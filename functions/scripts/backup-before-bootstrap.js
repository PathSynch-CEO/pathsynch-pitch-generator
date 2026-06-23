/**
 * backup-before-bootstrap.js — Pre-write backup of teams/ and users/ collections.
 *
 * MUST be run before bootstrap-workspaces.js to capture reversible state.
 *
 * Outputs:
 *   backup_teams_{timestamp}.json   — full teams collection snapshot
 *   backup_users_{timestamp}.json   — users collection (credits + plan fields only)
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/c/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json \
 *   node scripts/backup-before-bootstrap.js
 *
 * Files are written to cwd (functions/ directory). Do NOT commit them (contain PII).
 */

'use strict';

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: 'pathsynch-pitch-creation'
    });
}

const db = admin.firestore();

async function backupTeams() {
    console.log('Backing up teams/ collection...');
    const snap = await db.collection('teams').get();
    const backup = {};
    snap.docs.forEach(d => {
        backup[d.id] = d.data();
    });
    const filename = `backup_teams_${Date.now()}.json`;
    fs.writeFileSync(path.join(process.cwd(), filename), JSON.stringify(backup, null, 2));
    console.log(`  Backed up ${snap.size} teams docs → ${filename}`);
    return snap.size;
}

async function backupUsers() {
    console.log('Backing up users/ collection (credits + plan fields only)...');
    const snap = await db.collection('users').get();
    const backup = {};
    snap.docs.forEach(d => {
        const data = d.data();
        backup[d.id] = {
            credits: data.credits !== undefined ? data.credits : null,
            plan: data.plan || null,
            tier: data.tier || null,
            subscription: data.subscription || null,
        };
    });
    const filename = `backup_users_${Date.now()}.json`;
    fs.writeFileSync(path.join(process.cwd(), filename), JSON.stringify(backup, null, 2));
    console.log(`  Backed up ${snap.size} user credit/plan snapshots → ${filename}`);
    return snap.size;
}

async function main() {
    console.log('=== Pre-Bootstrap Backup ===\n');

    const teamsCount = await backupTeams();
    const usersCount = await backupUsers();

    console.log('\n=== Backup Complete ===');
    console.log(`Teams: ${teamsCount} docs`);
    console.log(`Users: ${usersCount} docs (credits + plan fields only)`);
    console.log('\nYou may now run bootstrap-workspaces.js');

    process.exit(0);
}

main().catch(err => {
    console.error('\nBackup failed:', err);
    process.exit(1);
});
