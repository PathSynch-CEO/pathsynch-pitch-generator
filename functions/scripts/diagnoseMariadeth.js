/**
 * Diagnostic script: Audit Mariadeth's workspace setup
 * Run: GOOGLE_APPLICATION_CREDENTIALS="/c/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json" node scripts/diagnoseMariadeth.js
 */

const admin = require('firebase-admin');

const serviceAccount = require('C:/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const OWNER_UID = 'dehiyRBCXcUUM72O211S27lfXbl1';

async function main() {
    console.log('=== STEP 1: TEAM DOC ===');
    const teamDoc = await db.collection('teams').doc(OWNER_UID).get();
    if (!teamDoc.exists) {
        console.log('ERROR: teams/' + OWNER_UID + ' does NOT exist');
    } else {
        const t = teamDoc.data();
        console.log('ownerUid:', t.ownerUid);
        console.log('memberUids:', JSON.stringify(t.memberUids));
        console.log('members (full):', JSON.stringify(t.members, null, 2));
    }

    console.log('\n=== STEP 2: FIND MARIADETH\'S USER DOC ===');
    // Search by email
    const snap = await db.collection('users')
        .where('email', '>=', 'mariadeth')
        .where('email', '<', 'mariadetha')
        .get();

    let mariadethUid = null;
    let mariadethData = null;

    if (!snap.empty) {
        snap.docs.forEach(d => {
            console.log('Found by email prefix:', d.id, d.data().email);
            mariadethUid = d.id;
            mariadethData = d.data();
        });
    } else {
        // Try name search
        console.log('No exact email prefix match, trying display name search...');
        const allSnap = await db.collection('users').get();
        allSnap.docs.forEach(d => {
            const data = d.data();
            const name = (data.name || data.displayName || '').toLowerCase();
            const email = (data.email || '').toLowerCase();
            if (name.includes('mariadeth') || email.includes('mariadeth')) {
                console.log('Found:', d.id, email, name);
                mariadethUid = d.id;
                mariadethData = data;
            }
        });
    }

    if (!mariadethUid) {
        console.log('ERROR: Could not find Mariadeth in users collection');
        process.exit(1);
    }

    console.log('\n--- Mariadeth user doc ---');
    console.log('uid:', mariadethUid);
    console.log('email:', mariadethData.email);
    console.log('name:', mariadethData.name || mariadethData.displayName);
    console.log('plan:', mariadethData.plan);
    console.log('tier:', mariadethData.tier);
    console.log('subscription:', JSON.stringify(mariadethData.subscription));
    console.log('_workspaceOwnerUid:', mariadethData._workspaceOwnerUid);
    console.log('_isWorkspaceMember:', mariadethData._isWorkspaceMember);
    console.log('_workspaceRole:', mariadethData._workspaceRole);

    console.log('\n=== STEP 3: VERIFY MARIADETH IN memberUids ===');
    if (teamDoc.exists) {
        const t = teamDoc.data();
        const inMemberUids = (t.memberUids || []).includes(mariadethUid);
        const inMembers = (t.members || []).some(m => m.uid === mariadethUid);
        console.log('In memberUids array:', inMemberUids);
        console.log('In members array:', inMembers);

        if (!inMemberUids) {
            console.log('\nACTION NEEDED: Mariadeth NOT in memberUids — adding her now...');
            const existingMember = (t.members || []).find(m => m.uid === mariadethUid);
            const role = existingMember?.role || 'contributor';

            await db.collection('teams').doc(OWNER_UID).update({
                memberUids: admin.firestore.FieldValue.arrayUnion(mariadethUid),
                members: inMembers ? t.members : admin.firestore.FieldValue.arrayUnion({
                    uid: mariadethUid,
                    email: mariadethData.email,
                    role: role,
                    addedAt: admin.firestore.Timestamp.now()
                }),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log('SUCCESS: Added', mariadethUid, 'to memberUids with role:', role);
        } else {
            console.log('OK: Mariadeth is already in memberUids');
        }
    }

    console.log('\n=== STEP 4: CHECK OWNER\'S PLAN ===');
    const ownerDoc = await db.collection('users').doc(OWNER_UID).get();
    if (ownerDoc.exists) {
        const od = ownerDoc.data();
        console.log('Owner plan:', od.plan);
        console.log('Owner tier:', od.tier);
        console.log('Owner subscription:', JSON.stringify(od.subscription));
    } else {
        console.log('ERROR: Owner doc not found');
    }

    console.log('\n=== STEP 5: CHECK PENDING INVITATIONS ===');
    const inviteSnap = await db.collection('teamInvitations')
        .where('inviteeEmail', '==', mariadethData.email)
        .get();
    if (inviteSnap.empty) {
        console.log('No invitations found for', mariadethData.email);
    } else {
        inviteSnap.docs.forEach(d => {
            const inv = d.data();
            console.log('Invitation:', d.id, '| status:', inv.status, '| role:', inv.role, '| teamOwnerUid:', inv.teamOwnerUid);
        });
    }

    console.log('\n=== STEP 6: RATE LIMITS COLLECTION ===');
    const rateSnap = await db.collection('rateLimits')
        .where('userId', '==', mariadethUid)
        .get();
    if (rateSnap.empty) {
        // Try by UID directly
        const rateDoc = await db.collection('rateLimits').doc(mariadethUid).get();
        if (rateDoc.exists) {
            console.log('Rate limit doc:', JSON.stringify(rateDoc.data(), null, 2));
        } else {
            console.log('No rate limit docs found for', mariadethUid);
        }
    } else {
        rateSnap.docs.forEach(d => {
            console.log('Rate limit doc:', d.id, JSON.stringify(d.data(), null, 2));
        });
    }

    console.log('\n=== DONE ===');
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
