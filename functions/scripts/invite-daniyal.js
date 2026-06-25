/**
 * invite-daniyal.js — One-off script to create Daniyal's workspace invite
 * using the SAME createInvite() service the HTTP endpoint uses.
 *
 * Replicates the POST /team/invite guards:
 *   1. Workspace resolution via getWorkspaceForUser()
 *   2. Existing member check (inside createInvite)
 *   3. Pending invite check (inside createInvite)
 *   4. Crypto token generation + SHA-256 hash storage
 *
 * Does NOT add Daniyal as a member — he must accept via the link.
 *
 * Usage (from functions/ directory):
 *   GOOGLE_APPLICATION_CREDENTIALS=/c/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json \
 *   node scripts/invite-daniyal.js
 */

'use strict';

const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: 'pathsynch-pitch-creation'
    });
}

// Import the REAL services — same modules the HTTP endpoint uses
const { getWorkspaceForUser } = require('../services/workspaceService');
const { createInvite } = require('../services/workspaceInviteService');

const CHARLES_UID   = 'dehiyRBCXcUUM72O211S27lfXbl1';
const CHARLES_EMAIL = 'hello@pathsynch.com';
const INVITEE_EMAIL = 'daniyal@pathsynch.com';
const ROLE          = 'contributor';

async function main() {
    console.log('=== Invite Daniyal to ws_bootstrap_charles ===\n');

    // Step 1 — Resolve Charles's workspace (same as teamRoutes.js:221)
    console.log('1. Resolving workspace for owner', CHARLES_UID, '...');
    const workspace = await getWorkspaceForUser(CHARLES_UID);

    if (!workspace) {
        console.error('ERROR: No workspace found for Charles. Aborting.');
        process.exit(1);
    }

    console.log('   Workspace found:', workspace.id);
    console.log('   Owner:', workspace.ownerId);
    console.log('   Members:', JSON.stringify(workspace.memberIds));
    console.log('   Seat limit:', workspace.seatLimit);

    if (workspace.id !== 'ws_bootstrap_charles') {
        console.error('ERROR: Expected ws_bootstrap_charles but got', workspace.id, '— aborting.');
        process.exit(1);
    }

    // Step 2 — Create invite via the real service (same as teamRoutes.js:238-248)
    console.log('\n2. Creating invite for', INVITEE_EMAIL, 'as', ROLE, '...');

    const { invitationId, plainToken } = await createInvite(
        workspace.id,        // workspaceId
        CHARLES_UID,         // inviterUid
        INVITEE_EMAIL,       // inviteeEmail
        ROLE,                // role
        {
            inviterEmail:       CHARLES_EMAIL,
            inviterDisplayName: 'Charles Berry',
            workspaceName:      workspace.name || "Charles Berry's Workspace",
        }
    );

    // Step 3 — Print results
    const acceptUrl = `https://app.synchintro.ai/?inviteToken=${plainToken}`;

    console.log('\n=== Invite Created Successfully ===');
    console.log('Invitation ID:', invitationId);
    console.log('Plain Token:  ', plainToken);
    console.log('Accept URL:   ', acceptUrl);
    console.log('\nShare the Accept URL with Daniyal. Token expires in 7 days.');
    console.log('He can accept with ANY Firebase Auth account (email match not required).');

    process.exit(0);
}

main().catch(err => {
    console.error('\nInvite failed:', err.message);
    process.exit(1);
});
