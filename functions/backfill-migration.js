/**
 * PathSynch Pitch Generator - Data Migration Script
 * 
 * This script:
 * 1. Backfills existing pitches with new schema fields
 * 2. Creates users collection from existing pitch authors
 * 3. Creates usage tracking documents
 * 4. Normalizes data structure
 * 
 * Run with: node backfill-migration.js
 * 
 * Prerequisites:
 * 1. Install firebase-admin: npm install firebase-admin
 * 2. Download service account key from Firebase Console
 * 3. Set GOOGLE_APPLICATION_CREDENTIALS environment variable
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin
// Option 1: Using service account file
// const serviceAccount = require('./path-to-service-account.json');
// admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

// Option 2: Using default credentials (if running in GCP or with GOOGLE_APPLICATION_CREDENTIALS)
admin.initializeApp({
    projectId: 'pathsynch-pitch-creation'
});

const db = admin.firestore();

// ============================================
// HELPER FUNCTIONS
// ============================================

function extractCity(address) {
    if (!address) return '';
    const parts = address.split(',');
    if (parts.length >= 2) {
        return parts[parts.length - 2].trim();
    }
    return '';
}

function extractState(address) {
    if (!address) return '';
    const parts = address.split(',');
    if (parts.length >= 1) {
        const lastPart = parts[parts.length - 1].trim();
        const stateMatch = lastPart.match(/([A-Z]{2})\s*\d{5}/);
        return stateMatch ? stateMatch[1] : '';
    }
    return '';
}

function getCurrentPeriod() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getNextPeriodStart() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

// ============================================
// MIGRATION FUNCTIONS
// ============================================

/**
 * Step 1: Backfill existing pitches with new schema
 */
async function backfillPitches() {
    console.log('\n📦 Step 1: Backfilling pitches with new schema...\n');
    
    const snapshot = await db.collection('pitches').get();
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const doc of snapshot.docs) {
        try {
            const data = doc.data();
            const pitchId = doc.id;
            
            // Skip if already migrated (has 'business' nested object)
            if (data.business && data.business.name) {
                console.log(`  ⏭️  Skipping ${pitchId} (already migrated)`);
                skipped++;
                continue;
            }
            
            // Build normalized update
            const update = {
                // Ensure pitchId matches doc ID
                pitchId: pitchId,
                
                // Normalized business object
                business: {
                    name: data.businessName || data.business_name || '',
                    address: data.address || '',
                    city: extractCity(data.address),
                    state: extractState(data.address),
                    website: data.websiteUrl || data.website || '',
                    phone: data.phone || ''
                },
                
                // Normalized Google data
                google: {
                    rating: data.googleRating || data.google_rank || 0,
                    reviewCount: data.numReviews || data.number_of_google_reviews || 0,
                    placeId: data.placeId || null
                },
                
                // Classification
                industry: data.industry || data.segment || 'Other',
                subIndustry: data.subIndustry || data.vertical || '',
                
                // Pitch metadata
                pitchLevel: data.pitchLevel || 3,
                contactName: data.contactName || 'Business Owner',
                
                // Status
                status: data.status || 'ready',
                
                // Sharing (normalize structure)
                sharing: {
                    public: data.shared || data.isPubliclyShared || (data.sharing && data.sharing.public) || false,
                    shareId: data.shareId || (data.sharing && data.sharing.shareId) || null,
                    sharedAt: data.sharedAt || null
                },
                
                // Analytics snapshot (for quick dashboard display)
                analytics: {
                    views: 0,
                    uniqueViewers: 0,
                    lastViewedAt: null
                },
                
                // Ensure timestamps exist
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                
                // Migration flag
                _migrated: true,
                _migratedAt: admin.firestore.FieldValue.serverTimestamp()
            };
            
            // Preserve createdAt if exists
            if (!data.createdAt && data.created_at) {
                update.createdAt = data.created_at;
            }
            
            await doc.ref.update(update);
            console.log(`  ✅ Updated ${pitchId} (${data.businessName || data.business_name})`);
            updated++;
            
        } catch (error) {
            console.error(`  ❌ Error updating ${doc.id}:`, error.message);
            errors++;
        }
    }
    
    console.log(`\n📊 Pitch Migration Summary:`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Errors:  ${errors}`);
    console.log(`   Total:   ${snapshot.size}`);
    
    return { updated, skipped, errors };
}

/**
 * Step 2: Create users collection from pitch authors
 */
async function createUsersFromPitches() {
    console.log('\n👤 Step 2: Creating users collection...\n');
    
    const pitchesSnapshot = await db.collection('pitches').get();
    const userIds = new Set();
    
    // Collect unique userIds
    pitchesSnapshot.forEach(doc => {
        const userId = doc.data().userId;
        if (userId && userId !== 'anonymous') {
            userIds.add(userId);
        }
    });
    
    console.log(`   Found ${userIds.size} unique users`);
    
    let created = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const userId of userIds) {
        try {
            const userRef = db.collection('users').doc(userId);
            const userDoc = await userRef.get();
            
            if (userDoc.exists) {
                console.log(`  ⏭️  Skipping ${userId} (already exists)`);
                skipped++;
                continue;
            }
            
            // Count user's pitches
            const userPitchesSnapshot = await db.collection('pitches')
                .where('userId', '==', userId)
                .get();
            
            // Create user document
            await userRef.set({
                userId: userId,
                
                // Profile (to be filled later)
                profile: {
                    displayName: null,
                    email: null,
                    photoUrl: null,
                    company: null,
                    role: null
                },
                
                // Plan & Billing
                plan: {
                    tier: 'free',  // free | growth | enterprise
                    pitchLimit: 5,
                    apiAccess: false,
                    whiteLabel: false
                },
                
                // Default Settings
                settings: {
                    defaultTone: 'consultative',
                    defaultGoal: 'book_demo',
                    defaultIndustry: null,
                    emailSignature: null
                },
                
                // Branding
                branding: {
                    logoUrl: null,
                    companyName: null,
                    primaryColor: '#3A6746',
                    accentColor: '#FFC700',
                    hidePoweredBy: false
                },
                
                // Stats (denormalized for quick access)
                stats: {
                    totalPitches: userPitchesSnapshot.size,
                    totalViews: 0,
                    lastPitchAt: null
                },
                
                // Timestamps
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                lastActiveAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            console.log(`  ✅ Created user ${userId} (${userPitchesSnapshot.size} pitches)`);
            created++;
            
        } catch (error) {
            console.error(`  ❌ Error creating user ${userId}:`, error.message);
            errors++;
        }
    }
    
    console.log(`\n📊 Users Creation Summary:`);
    console.log(`   Created: ${created}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Errors:  ${errors}`);
    
    return { created, skipped, errors };
}

/**
 * Step 3: Create usage tracking documents
 */
async function createUsageDocuments() {
    console.log('\n📈 Step 3: Creating usage tracking documents...\n');
    
    const usersSnapshot = await db.collection('users').get();
    const period = getCurrentPeriod();
    
    let created = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const userDoc of usersSnapshot.docs) {
        try {
            const userId = userDoc.id;
            const userData = userDoc.data();
            const usageId = `${userId}_${period}`;
            
            const usageRef = db.collection('usage').doc(usageId);
            const existingUsage = await usageRef.get();
            
            if (existingUsage.exists) {
                console.log(`  ⏭️  Skipping ${usageId} (already exists)`);
                skipped++;
                continue;
            }
            
            // Count pitches created this period
            const periodStart = new Date(`${period}-01`);
            const pitchesThisPeriod = await db.collection('pitches')
                .where('userId', '==', userId)
                .where('createdAt', '>=', periodStart)
                .get();
            
            // Determine limits based on plan
            const planLimits = {
                free: { pitches: 5, apiCalls: 100, storage: 100 },
                growth: { pitches: 50, apiCalls: 5000, storage: 1000 },
                enterprise: { pitches: -1, apiCalls: -1, storage: -1 }  // -1 = unlimited
            };
            
            const limits = planLimits[userData.plan?.tier || 'free'];
            
            await usageRef.set({
                userId: userId,
                period: period,
                
                // Current usage
                pitchesGenerated: pitchesThisPeriod.size,
                apiCalls: 0,
                storageUsedMB: 0,
                
                // Limits
                limits: {
                    pitches: limits.pitches,
                    apiCalls: limits.apiCalls,
                    storageMB: limits.storage
                },
                
                // Period info
                periodStart: periodStart,
                periodEnd: getNextPeriodStart(),
                
                // Timestamps
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            console.log(`  ✅ Created usage ${usageId} (${pitchesThisPeriod.size} pitches this period)`);
            created++;
            
        } catch (error) {
            console.error(`  ❌ Error creating usage for ${userDoc.id}:`, error.message);
            errors++;
        }
    }
    
    console.log(`\n📊 Usage Creation Summary:`);
    console.log(`   Created: ${created}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Errors:  ${errors}`);
    
    return { created, skipped, errors };
}

/**
 * Step 4: Create pitch templates collection with defaults
 */
async function createDefaultTemplates() {
    console.log('\n📝 Step 4: Creating default templates...\n');
    
    const templates = [
        {
            templateId: 'default_food_bev',
            name: 'Food & Beverage Default',
            industry: 'Food & Bev',
            isSystem: true,
            isPublic: true,
            settings: {
                tone: 'friendly',
                goal: 'book_demo',
                pitchLevel: 2
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        },
        {
            templateId: 'default_automotive',
            name: 'Automotive Default',
            industry: 'Automotive',
            isSystem: true,
            isPublic: true,
            settings: {
                tone: 'professional',
                goal: 'book_demo',
                pitchLevel: 2
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        },
        {
            templateId: 'default_home_services',
            name: 'Home Services Default',
            industry: 'Home Services',
            isSystem: true,
            isPublic: true,
            settings: {
                tone: 'consultative',
                goal: 'book_demo',
                pitchLevel: 2
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        },
        {
            templateId: 'default_health_wellness',
            name: 'Health & Wellness Default',
            industry: 'Health & Wellness',
            isSystem: true,
            isPublic: true,
            settings: {
                tone: 'empathetic',
                goal: 'book_demo',
                pitchLevel: 2
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        },
        {
            templateId: 'default_professional',
            name: 'Professional Services Default',
            industry: 'Professional Services',
            isSystem: true,
            isPublic: true,
            settings: {
                tone: 'professional',
                goal: 'schedule_call',
                pitchLevel: 3
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        },
        {
            templateId: 'default_retail',
            name: 'Retail Default',
            industry: 'Retail',
            isSystem: true,
            isPublic: true,
            settings: {
                tone: 'friendly',
                goal: 'book_demo',
                pitchLevel: 2
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        }
    ];
    
    let created = 0;
    let skipped = 0;
    
    for (const template of templates) {
        const ref = db.collection('templates').doc(template.templateId);
        const existing = await ref.get();
        
        if (existing.exists) {
            console.log(`  ⏭️  Skipping ${template.templateId} (already exists)`);
            skipped++;
            continue;
        }
        
        await ref.set(template);
        console.log(`  ✅ Created template: ${template.name}`);
        created++;
    }
    
    console.log(`\n📊 Templates Creation Summary:`);
    console.log(`   Created: ${created}`);
    console.log(`   Skipped: ${skipped}`);
    
    return { created, skipped };
}

/**
 * Step 5: Create analytics aggregation documents
 */
async function createAnalyticsDocuments() {
    console.log('\n📊 Step 5: Creating analytics documents...\n');
    
    const pitchesSnapshot = await db.collection('pitches').get();
    let created = 0;
    let skipped = 0;
    
    for (const pitchDoc of pitchesSnapshot.docs) {
        try {
            const pitchId = pitchDoc.id;
            const analyticsRef = db.collection('pitchAnalytics').doc(pitchId);
            const existing = await analyticsRef.get();
            
            if (existing.exists) {
                skipped++;
                continue;
            }
            
            const pitchData = pitchDoc.data();
            
            await analyticsRef.set({
                pitchId: pitchId,
                userId: pitchData.userId || 'anonymous',
                
                // Aggregate metrics
                views: 0,
                uniqueViewers: 0,
                avgTimeSeconds: 0,
                
                // Engagement
                shares: 0,
                downloads: 0,
                ctaClicks: 0,
                
                // By level (for Level 3 decks)
                bySlide: {},
                
                // Time series
                viewsByDay: {},
                
                // Timestamps
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            created++;
            
        } catch (error) {
            console.error(`  ❌ Error creating analytics for ${pitchDoc.id}:`, error.message);
        }
    }
    
    console.log(`\n📊 Analytics Creation Summary:`);
    console.log(`   Created: ${created}`);
    console.log(`   Skipped: ${skipped}`);
    
    return { created, skipped };
}

// ============================================
// MAIN EXECUTION
// ============================================

async function runMigration() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     PathSynch Pitch Generator - Data Migration Script      ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(`\nStarted at: ${new Date().toISOString()}`);
    console.log(`Period: ${getCurrentPeriod()}`);
    
    const results = {
        pitches: null,
        users: null,
        usage: null,
        templates: null,
        analytics: null
    };
    
    try {
        // Run migrations in sequence
        results.pitches = await backfillPitches();
        results.users = await createUsersFromPitches();
        results.usage = await createUsageDocuments();
        results.templates = await createDefaultTemplates();
        results.analytics = await createAnalyticsDocuments();
        
        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║                    MIGRATION COMPLETE                       ║');
        console.log('╚════════════════════════════════════════════════════════════╝');
        console.log('\n📊 Final Summary:');
        console.log(`   Pitches Updated:    ${results.pitches.updated}`);
        console.log(`   Users Created:      ${results.users.created}`);
        console.log(`   Usage Docs Created: ${results.usage.created}`);
        console.log(`   Templates Created:  ${results.templates.created}`);
        console.log(`   Analytics Created:  ${results.analytics.created}`);
        console.log(`\nCompleted at: ${new Date().toISOString()}`);
        
    } catch (error) {
        console.error('\n❌ Migration failed:', error);
        process.exit(1);
    }
    
    process.exit(0);
}

// Run if called directly
if (require.main === module) {
    runMigration();
}

module.exports = {
    backfillPitches,
    createUsersFromPitches,
    createUsageDocuments,
    createDefaultTemplates,
    createAnalyticsDocuments,
    runMigration
};
