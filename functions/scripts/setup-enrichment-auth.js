'use strict';

/**
 * One-time setup: create config/enrichmentAuth doc in Firestore.
 * Run: node functions/scripts/setup-enrichment-auth.js
 * Delete this file after running (or keep as reference).
 */

const admin = require('firebase-admin');
const serviceAccount = require('C:/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'pathsynch-pitch-creation'
});

async function setup() {
    await admin.firestore().collection('config').doc('enrichmentAuth').set({
        authorizedUids: ['dehiyRBCXcUUM72O211S27lfXbl1'],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        notes: 'Add Joseph Abu UID after Firebase account creation. Add team member UIDs as needed.'
    });
    console.log('enrichmentAuth config document created successfully.');
    console.log('Authorized UIDs: dehiyRBCXcUUM72O211S27lfXbl1 (Charles Berry)');
    process.exit(0);
}

setup().catch(err => {
    console.error('Script failed:', err.message);
    console.log('\nIf credentials fail, create the doc manually in Firebase Console:');
    console.log('  Collection: config');
    console.log('  Document ID: enrichmentAuth');
    console.log('  Field authorizedUids (array): ["dehiyRBCXcUUM72O211S27lfXbl1"]');
    console.log('  Field updatedAt (timestamp): now');
    console.log('  Field notes (string): "Add Joseph Abu UID after Firebase account creation"');
    process.exit(1);
});
