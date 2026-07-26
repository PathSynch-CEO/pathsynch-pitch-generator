'use strict';
// READ-ONLY recon for the Countifi rollout. No writes.
// Minimal .env loader (dotenv is not a functions dependency).
const fs = require('fs');
for (const line of fs.readFileSync('C:/Users/tdh35/pathsynch-pitch-generator/functions/.env', 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const admin = require('firebase-admin');

const CHARLES = 'dehiyRBCXcUUM72O211S27lfXbl1';

admin.initializeApp({
    credential: admin.credential.cert('C:/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json'),
    storageBucket: 'pathsynch-pitch-creation.appspot.com',
});
const db = admin.firestore();

(async () => {
    // David's account
    let david = null;
    try {
        const u = await admin.auth().getUserByEmail('david@countifi.com');
        david = { uid: u.uid, email: u.email, displayName: u.displayName || null };
    } catch (e) {
        david = { error: e.message };
    }
    console.log('DAVID:', JSON.stringify(david));

    // Charles: credits + plan (no secrets)
    const cu = await db.collection('users').doc(CHARLES).get();
    const cud = cu.exists ? cu.data() : {};
    console.log('CHARLES: credits=' + (cud.credits ?? 'n/a') + ' plan=' + (cud.plan || cud.tier || 'n/a'));

    // Gov profiles for Charles
    const profs = await db.collection('govProfiles').where('userId', '==', CHARLES).get();
    console.log('GOV PROFILES (Charles):', profs.docs.map(d => `${d.id} "${(d.data().name || d.data().companyName || '').slice(0, 40)}"`).join(' | ') || 'none');

    // David gov profiles (if uid found)
    if (david && david.uid) {
        const dprofs = await db.collection('govProfiles').where('userId', '==', david.uid).get();
        console.log('GOV PROFILES (David):', dprofs.docs.length);
        const dmasters = await db.collection('govMasterProposals').where('userId', '==', david.uid).get();
        console.log('MASTERS (David):', dmasters.docs.length);
    }

    // Opportunities with meaningful text (top 5 by description length)
    const opps = await db.collection('govOpportunities').limit(60).get();
    const usable = opps.docs
        .map(d => ({ id: d.id, title: (d.data().title || '').slice(0, 60), descLen: (d.data().description || '').length, userId: d.data().userId || null, due: d.data().dueDate || null }))
        .sort((a, b) => b.descLen - a.descLen)
        .slice(0, 5);
    console.log('TOP OPPORTUNITIES BY TEXT:');
    usable.forEach(o => console.log(`  ${o.id} descLen=${o.descLen} due=${String(o.due).slice(0, 10)} "${o.title}"`));

    // Existing pursuits
    const pursuits = await db.collection('govPursuits').limit(10).get();
    console.log('PURSUITS existing:', pursuits.docs.length);
    pursuits.docs.slice(0, 5).forEach(d => {
        const p = d.data();
        console.log(`  ${d.id} user=${(p.userId || '').slice(0, 8)} stage=${p.stage} opp=${p.sourceOpportunityId}`);
    });

    // Storage bucket sanity
    try {
        const [exists] = await admin.storage().bucket().exists();
        console.log('BUCKET appspot exists:', exists);
    } catch (e) {
        console.log('BUCKET appspot error:', e.message);
    }
    process.exit(0);
})().catch(e => { console.error('RECON FAIL:', e.message); process.exit(1); });
