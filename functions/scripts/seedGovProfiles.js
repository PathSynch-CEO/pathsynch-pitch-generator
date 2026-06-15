'use strict';

/**
 * seedGovProfiles.js — Admin SDK seed script for SynchGov profiles.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./pathsynch-pitch-creation-c6d08f00a3fc.json \
 *     node scripts/seedGovProfiles.js --userId <FIREBASE_UID>
 *
 * Creates:
 *   - PathSynch Labs govProfile (profileType: 'pathsynch_internal')
 *   - Countifi govProfile (profileType: 'countifi')
 *   - govChecklist doc per profile (5 default questions)
 */

const admin = require('firebase-admin');
const { DEFAULT_CHECKLIST_QUESTIONS } = require('../services/govcapture/schemas');

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

// ── Profile Data ─────────────────────────────────────────────────────────────

const PATHSYNCH_PROFILE = {
    profileName: 'PathSynch Labs',
    profileType: 'pathsynch_internal',
    status:      'active',
    rescoreNeeded: false,
    solutions: [
        {
            name: 'PathConnect — Review & Reputation Management',
            keywords: [
                'review management', 'reputation management', 'online reputation',
                'customer feedback', 'review generation', 'review response',
                'NFC review card', 'Google Business Profile',
            ],
        },
        {
            name: 'LocalSynch — Local SEO & GBP Optimization',
            keywords: [
                'local SEO', 'Google Business Profile', 'GBP optimization',
                'local search', 'citation management', 'listing management',
                'map pack', 'local visibility',
            ],
        },
        {
            name: 'PathManager — Business Intelligence Dashboard',
            keywords: [
                'business intelligence', 'analytics dashboard', 'merchant dashboard',
                'competitive intelligence', 'market intelligence', 'data analytics',
            ],
        },
    ],
    credentials: {
        naicsCodes: [],
        uei:            null,
        cage:           null,
        certifications: [],
        pastPerformance: [],
        capStatementText: null,
    },
    filters: {
        buyerTypes:     ['Federal', 'State', 'Local'],
        geographyPriority: ['GA', 'NC'],
        geographyRequired: [],
        minContractValue:  null,
        maxContractValue:  null,
    },
    digestSettings: {
        frequency: 'daily',
        enabled:   true,
    },
    autoArchiveDays: 30,
    negativeKeywords: [],
};

const COUNTIFI_PROFILE = {
    profileName: 'Countifi',
    profileType: 'countifi',
    status:      'active',
    rescoreNeeded: false,
    solutions: [
        {
            name: 'Countifi — Asset Tracking & Inventory Intelligence',
            keywords: [
                // Query-grade (top 10 — used in SAM.gov queries)
                'asset tracking', 'inventory management', 'RFID',
                'warehouse management', 'computer vision', 'predictive inventory',
                'supply chain visibility', 'materials management',
                'inventory counting', 'inventory automation',
                // Scoring-only keywords
                'barcode scanning', 'asset lifecycle', 'physical inventory',
                'cycle counting', 'inventory reconciliation', 'stock management',
                'asset audit', 'inventory control', 'warehouse operations',
                'supply chain analytics',
            ],
        },
    ],
    credentials: {
        naicsCodes:     ['541614', '561990', '541511', '541512', '611420'],
        uei:            'H5M4DURV6586',
        cage:           '9FQ89',
        certifications: [],
        pastPerformance: [
            { client: 'Emirates', description: 'Asset tracking deployment' },
            { client: 'Delta Air Lines', description: 'Inventory management system' },
            { client: 'Duke Health', description: 'Healthcare asset tracking' },
            { client: 'Clark Atlanta University', description: 'Campus asset management' },
            { client: 'North Carolina A&T', description: 'University inventory system' },
        ],
        capStatementText: null,
    },
    filters: {
        buyerTypes:         ['Federal', 'State', 'Higher Ed', 'Healthcare'],
        geographyPriority:  ['GA', 'NC', 'DC', 'VA', 'MD', 'TX', 'FL'],
        geographyRequired:  [],
        minContractValue:   null,
        maxContractValue:   null,
    },
    digestSettings: {
        frequency: 'daily',
        enabled:   true,
    },
    autoArchiveDays: 30,
    negativeKeywords: [
        'welcome kit', 'promotional', 'printing', 'uniforms',
        'janitorial', 'food service', 'landscaping', 'construction materials',
    ],
};

// ── Seed Function ────────────────────────────────────────────────────────────

async function seedProfiles(userId) {
    if (!userId) {
        console.error('Usage: node scripts/seedGovProfiles.js --userId <FIREBASE_UID>');
        process.exit(1);
    }

    const profiles = [
        { data: PATHSYNCH_PROFILE, label: 'PathSynch Labs' },
        { data: COUNTIFI_PROFILE,  label: 'Countifi' },
    ];

    for (const { data, label } of profiles) {
        const profileData = {
            ...data,
            userId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        const profileRef = await db.collection('govProfiles').add(profileData);
        console.log(`✅ ${label} profile created: ${profileRef.id}`);

        // Create govChecklist for this profile
        await db.collection('govChecklist').doc(profileRef.id).set({
            profileId: profileRef.id,
            userId,
            questions: DEFAULT_CHECKLIST_QUESTIONS.map((q, i) => ({
                id:       `q${i + 1}`,
                question: q,
                required: true,
            })),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`   ✅ Checklist created for ${label} (${DEFAULT_CHECKLIST_QUESTIONS.length} questions)`);
    }

    console.log('\nSeed complete.');
}

// ── CLI Entry ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const userIdIdx = args.indexOf('--userId');
const userId = userIdIdx >= 0 ? args[userIdIdx + 1] : null;

seedProfiles(userId).then(() => process.exit(0)).catch(err => {
    console.error('Seed failed:', err.message);
    process.exit(1);
});
