'use strict';

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// Initialize with service account
const serviceAccount = require('../pathsynch-pitch-creation-firebase-adminsdk-fbsvc-8aaf3aeefc.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'pathsynch-pitch-creation'
});

const db = admin.firestore();
const logFile = 'C:/Users/tdh35/account-audit-2026-06-01.log';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
}

function logObj(label, obj) {
  const line = `[${new Date().toISOString()}] ${label}: ${JSON.stringify(obj, null, 2)}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
}

async function run() {
  log('=== ACCOUNT AUDIT 2026-06-01 — Corrections 3D and 3E ===');
  log('');

  // ========== 3D: hello@pathsynch.com — Update to enterprise ==========
  log('--- 3D: hello@pathsynch.com (UID: dehiyRBCXcUUM72O211S27lfXbl1) ---');

  const uid3D = 'dehiyRBCXcUUM72O211S27lfXbl1';
  const docRef3D = db.collection('users').doc(uid3D);

  // BEFORE
  const before3D = await docRef3D.get();
  if (!before3D.exists) {
    log('ERROR: 3D doc does not exist!');
  } else {
    const d = before3D.data();
    logObj('3D BEFORE — plan', d.plan);
    logObj('3D BEFORE — tier', d.tier);
    logObj('3D BEFORE — subscription', d.subscription);
    logObj('3D BEFORE — email', d.email);
  }

  // UPDATE
  await docRef3D.update({
    plan: 'enterprise',
    tier: 'enterprise',
    'subscription.plan': 'enterprise',
    'subscription.tier': 'enterprise',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: 'account-audit-2026-06-01'
  });
  log('3D UPDATE applied.');

  // AFTER
  const after3D = await docRef3D.get();
  const a3D = after3D.data();
  logObj('3D AFTER — plan', a3D.plan);
  logObj('3D AFTER — tier', a3D.tier);
  logObj('3D AFTER — subscription', a3D.subscription);
  logObj('3D AFTER — updatedBy', a3D.updatedBy);
  log('');

  // ========== 3E: demo@pathsynch.com — Create users doc ==========
  log('--- 3E: demo@pathsynch.com (UID: SE8bo7rvpdaUMBrmKSmIGLZRpQ32) ---');

  const uid3E = 'SE8bo7rvpdaUMBrmKSmIGLZRpQ32';
  const docRef3E = db.collection('users').doc(uid3E);

  // BEFORE — confirm doc doesn't exist
  const before3E = await docRef3E.get();
  log(`3E BEFORE — doc exists: ${before3E.exists}`);
  if (before3E.exists) {
    logObj('3E BEFORE — existing data', before3E.data());
  }

  // CREATE
  await docRef3E.set({
    email: 'demo@pathsynch.com',
    name: 'PathSynch Demo',
    company: 'PathSynch',
    plan: 'enterprise',
    tier: 'enterprise',
    subscription: { plan: 'enterprise', tier: 'enterprise' },
    credits: 50000,
    onboardingCompleted: false,
    profile: {
      displayName: 'PathSynch Demo',
      email: 'demo@pathsynch.com',
      photoUrl: null,
      company: 'PathSynch',
      role: null
    },
    settings: {
      defaultTone: 'consultative',
      defaultGoal: 'book_demo',
      defaultIndustry: null,
      emailSignature: null
    },
    branding: {
      logoUrl: null,
      companyName: 'PathSynch',
      primaryColor: '#3A6746',
      accentColor: '#FFC700',
      hidePoweredBy: false
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: 'account-audit-2026-06-01'
  });
  log('3E CREATE applied.');

  // AFTER
  const after3E = await docRef3E.get();
  logObj('3E AFTER — full doc', after3E.data());

  log('');
  log('=== AUDIT COMPLETE ===');

  // Clean exit
  process.exit(0);
}

run().catch(err => {
  log(`FATAL ERROR: ${err.message}`);
  console.error(err);
  process.exit(1);
});
