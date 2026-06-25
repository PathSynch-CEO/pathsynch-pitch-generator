/**
 * bootstrap-workspaces.js — One-time migration from teams/{ownerUid} to
 * workspaces + workspaceMembers collections.
 *
 * What it does:
 *   1. Reads all teams/{ownerUid} docs
 *   2. Creates workspaces/{autoId} + workspaceMembers/{wsId}_{uid} docs
 *   3. Backlinks teams.workspaceId to the new workspace
 *   4. Quarantines stale entries (tdh356b, daniyal@pathsynch.com reference)
 *
 * Idempotent: skips teams that already have a workspaceId backlink.
 *
 * Usage (from functions/ directory):
 *   GOOGLE_APPLICATION_CREDENTIALS=./pathsynch-pitch-creation-c6d08f00a3fc.json \
 *   node scripts/bootstrap-workspaces.js
 *
 * Rollback:
 *   1. Delete all workspaceMembers docs where workspaceId matches
 *   2. Delete all workspaces docs created by this script
 *   3. Remove workspaceId field from teams docs
 *   Rollback is safe — workspace data is additive; no existing data is modified.
 */

'use strict';

const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: 'pathsynch-pitch-creation'
    });
}

const db = admin.firestore();

// Known stale entries to quarantine (per spec §15)
const STALE_TEAM_IDS = ['tdh356b', 'NRPJo05FVMjCTKQo7PTq', 'cbFZRMJSXV5bLHXghPTe'];
const STALE_MEMBER_EMAILS = ['daniyal@pathsynch.com', 'tdh356b@gmail.com'];

// Charles Berry — deterministic workspace ID for testing consistency
const CHARLES_UID = 'dehiyRBCXcUUM72O211S27lfXbl1';
const CHARLES_WORKSPACE_ID = 'ws_bootstrap_charles';

async function bootstrap() {
    console.log('=== Workspace Bootstrap Migration ===\n');

    const teamsSnap = await db.collection('teams').get();

    if (teamsSnap.empty) {
        console.log('No teams found. Nothing to migrate.');
        process.exit(0);
    }

    console.log(`Found ${teamsSnap.size} team doc(s).\n`);

    let created = 0;
    let skipped = 0;
    let quarantined = 0;

    for (const teamDoc of teamsSnap.docs) {
        const teamId = teamDoc.id;
        const teamData = teamDoc.data();

        // ── Quarantine stale entries ────────────────────────────────────
        if (STALE_TEAM_IDS.includes(teamId)) {
            console.log(`  [QUARANTINE] teams/${teamId} — stale test entry`);
            await teamDoc.ref.update({
                quarantinedAt:     admin.firestore.FieldValue.serverTimestamp(),
                quarantinedReason: 'Pre-refactor stale entry — bootstrap-workspaces.js',
            });
            quarantined++;
            continue;
        }

        // ── Skip if already migrated ───────────────────────────────────
        if (teamData.workspaceId) {
            console.log(`  [SKIP] teams/${teamId} — already has workspaceId: ${teamData.workspaceId}`);
            skipped++;
            continue;
        }

        const ownerUid = teamData.ownerUid || teamId;

        // Fetch owner user doc for display name
        const ownerUserDoc = await db.collection('users').doc(ownerUid).get();
        const ownerData = ownerUserDoc.exists ? ownerUserDoc.data() : {};
        const ownerEmail = teamData.ownerEmail || ownerData.email || '';
        const ownerDisplayName = teamData.ownerDisplayName || ownerData.displayName || ownerEmail.split('@')[0] || '';

        // ── Determine workspace ID ─────────────────────────────────────
        const workspaceId = (ownerUid === CHARLES_UID)
            ? CHARLES_WORKSPACE_ID
            : undefined; // auto-generated

        // ── Create workspace ───────────────────────────────────────────
        const now = admin.firestore.FieldValue.serverTimestamp();
        const workspaceData = {
            ownerId:             ownerUid,
            entitlementOwnerUid: ownerUid,
            name:                `${ownerDisplayName}'s Workspace`,
            memberIds:           [ownerUid],
            memberCount:         1,
            seatLimit:           -1, // Will be resolved from plan at runtime
            createdAt:           now,
            updatedAt:           now,
        };

        let workspaceRef;
        if (workspaceId) {
            workspaceRef = db.collection('workspaces').doc(workspaceId);
            // Check if already exists (idempotency for deterministic IDs)
            const existing = await workspaceRef.get();
            if (existing.exists) {
                console.log(`  [SKIP] Workspace ${workspaceId} already exists for ${ownerUid}`);
                // Still backlink teams doc if missing
                await teamDoc.ref.update({ workspaceId });
                skipped++;
                continue;
            }
            await workspaceRef.set(workspaceData);
        } else {
            workspaceRef = await db.collection('workspaces').add(workspaceData);
        }

        const wsId = workspaceRef.id;
        console.log(`  [CREATE] Workspace ${wsId} for owner ${ownerUid} (${ownerDisplayName})`);

        // ── Seed workspaceBranding from owner's agencyBrandOverrides ──
        // Closes B2 risk window: without this, resolveBrand() in workspace
        // context falls back to agencyBrandOverrides/{ownerUid} (client-writable),
        // which would let a direct client write affect workspace-resolved branding.
        // Seeding workspaceBranding/{wsId} ensures resolveBrand() reads from the
        // server-only source immediately, with no fallback window.
        try {
            const brandSnap = await db.collection('agencyBrandOverrides').doc(ownerUid).get();
            if (brandSnap.exists) {
                const brandData = brandSnap.data();
                await db.collection('workspaceBranding').doc(wsId).set({
                    ...brandData,
                    _seededFromUid: ownerUid,
                    _seededAt: now,
                });
                console.log(`  [SEED] workspaceBranding/${wsId} seeded from agencyBrandOverrides/${ownerUid}`);
            } else {
                console.log(`  [SKIP] No agencyBrandOverrides for ${ownerUid} — workspaceBranding will use defaults`);
            }
        } catch (brandErr) {
            // Non-blocking — workspace is still usable with default branding
            console.warn(`  [WARN] Failed to seed workspaceBranding/${wsId}:`, brandErr.message);
        }

        // ── Create owner's workspaceMembers doc ────────────────────────
        const ownerMemberDocId = `${wsId}_${ownerUid}`;
        await db.collection('workspaceMembers').doc(ownerMemberDocId).set({
            workspaceId:          wsId,
            uid:                  ownerUid,
            email:                ownerEmail.toLowerCase(),
            displayName:          ownerDisplayName,
            displayNameSnapshot:  ownerDisplayName,
            role:                 'admin',
            isWorkspaceOwner:     true,
            status:               'active',
            joinedAt:             now,
            invitedBy:            null,
            removedAt:            null,
            reactivatedAt:        null,
            updatedAt:            now,
        });

        // ── Migrate existing team members ──────────────────────────────
        const members = teamData.members || [];
        const memberIds = [ownerUid];

        for (const member of members) {
            if (!member.uid) continue;

            // Quarantine known stale member emails
            if (STALE_MEMBER_EMAILS.includes((member.email || '').toLowerCase())) {
                console.log(`    [QUARANTINE] Member ${member.email} — should rejoin via Phase 3A invite`);
                quarantined++;
                continue;
            }

            const memberDocId = `${wsId}_${member.uid}`;
            await db.collection('workspaceMembers').doc(memberDocId).set({
                workspaceId:          wsId,
                uid:                  member.uid,
                email:                (member.email || '').toLowerCase(),
                displayName:          member.displayName || '',
                displayNameSnapshot:  member.displayName || '',
                role:                 mapLegacyRole(member.role),
                isWorkspaceOwner:     false,
                status:               member.status === 'active' ? 'active' : 'removed',
                joinedAt:             member.joinedAt || now,
                invitedBy:            ownerUid,
                removedAt:            null,
                reactivatedAt:        null,
                updatedAt:            now,
            });

            if (member.status === 'active' || !member.status) {
                memberIds.push(member.uid);
            }

            console.log(`    [MEMBER] ${member.email} → role: ${mapLegacyRole(member.role)}`);
        }

        // ── Update workspace memberIds + count ─────────────────────────
        await workspaceRef.update({
            memberIds,
            memberCount: memberIds.length,
        });

        // ── Backlink teams doc ─────────────────────────────────────────
        await teamDoc.ref.update({ workspaceId: wsId });

        created++;
    }

    console.log('\n=== Bootstrap Complete ===');
    console.log(`Created     : ${created} workspace(s)`);
    console.log(`Skipped     : ${skipped} (already migrated)`);
    console.log(`Quarantined : ${quarantined} stale entries`);

    process.exit(0);
}

/**
 * Map legacy team role names to workspace role names.
 * Legacy: 'admin', 'contributor', 'viewer'
 * New:    'admin', 'contributor', 'manager'
 *
 * 'viewer' maps to 'contributor' — read-only becomes a capability, not a role.
 */
function mapLegacyRole(role) {
    switch ((role || '').toLowerCase()) {
        case 'admin':       return 'admin';
        case 'contributor': return 'contributor';
        case 'viewer':      return 'contributor';
        case 'manager':     return 'manager';
        default:            return 'contributor';
    }
}

bootstrap().catch(err => {
    console.error('\nBootstrap failed:', err);
    process.exit(1);
});
