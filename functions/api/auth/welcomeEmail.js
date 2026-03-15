/**
 * SynchIntro Welcome Email — Firebase Auth onCreate Trigger
 *
 * Fires when a new user creates an account via Firebase Auth (Google sign-in).
 * Sends a SynchIntro-branded welcome email via SendGrid and ensures the
 * user document exists in Firestore.
 *
 * Uses v1 auth trigger (functions.auth.user().onCreate) which is fully
 * supported alongside v2 functions in firebase-functions v7+.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const sgMail = require('@sendgrid/mail');
const { generateWelcomeHtml } = require('../../templates/welcomeEmail');

// SendGrid init (uses same env var as services/email.js)
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// From address — uses pathsynch.com (verified domain).
// Switch to hello@synchintro.ai once domain verification is complete.
const FROM_EMAIL = 'hello@pathsynch.com';
const FROM_NAME = 'SynchIntro';

/**
 * Firebase Auth onCreate handler
 * @param {import('firebase-functions').auth.UserRecord} user
 */
async function handleNewUser(user) {
    const { email, displayName, uid, photoURL } = user;

    console.log(`[welcomeEmail] New user created: ${uid} (${email || 'no email'})`);

    // 1. Ensure user document exists in Firestore
    const db = admin.firestore();
    const userRef = db.collection('users').doc(uid);

    try {
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
            await userRef.set({
                userId: uid,
                profile: {
                    displayName: displayName || null,
                    email: email || null,
                    photoUrl: photoURL || null,
                    company: null,
                    role: null
                },
                plan: 'starter',
                settings: {
                    defaultTone: 'consultative',
                    defaultGoal: 'book_demo',
                    defaultIndustry: null,
                    emailSignature: null
                },
                branding: {
                    logoUrl: null,
                    companyName: null,
                    primaryColor: '#3A6746',
                    accentColor: '#FFC700',
                    hidePoweredBy: false
                },
                stats: {
                    totalPitches: 0,
                    totalViews: 0,
                    lastPitchAt: null
                },
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
                welcomeEmailSent: false
            });
            console.log(`[welcomeEmail] Created user doc for ${uid}`);
        } else {
            console.log(`[welcomeEmail] User doc already exists for ${uid}`);
        }
    } catch (docError) {
        console.error(`[welcomeEmail] Failed to create user doc for ${uid}:`, docError);
        // Continue — still try to send the email
    }

    // 2. Send SynchIntro-branded welcome email
    if (!email) {
        console.log(`[welcomeEmail] No email for user ${uid}, skipping welcome email`);
        return;
    }

    const html = generateWelcomeHtml({
        userName: displayName || 'there',
        setupLink: 'https://app.synchintro.ai',
        supportEmail: 'support@pathsynch.com'
    });

    const msg = {
        to: email,
        from: {
            email: FROM_EMAIL,
            name: FROM_NAME
        },
        subject: 'Welcome to SynchIntro — Let\'s Get You Started',
        html
    };

    try {
        await sgMail.send(msg);
        console.log(`[welcomeEmail] Welcome email sent to ${email}`);

        // Mark welcome email as sent
        await userRef.update({ welcomeEmailSent: true });
    } catch (sendError) {
        console.error(`[welcomeEmail] Failed to send welcome email to ${email}:`,
            sendError.response?.body || sendError.message);
        // Don't throw — email failure should not block auth
    }
}

// Export the v1 auth trigger
const onUserCreated = functions.auth.user().onCreate(handleNewUser);

module.exports = { onUserCreated, handleNewUser };
