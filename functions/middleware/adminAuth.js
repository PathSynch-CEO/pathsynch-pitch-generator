/**
 * Admin Authentication Middleware
 *
 * Restricts access to admin endpoints based on:
 * 1. Firestore admins collection (primary)
 * 2. ADMIN_EMAILS environment variable (fallback/legacy)
 */

const admin = require('firebase-admin');

const db = admin.firestore();

/**
 * Get admin emails from environment variable
 * Format: ADMIN_EMAILS=admin@example.com,support@example.com
 */
function getAdminEmailsFromEnv() {
    const envEmails = process.env.ADMIN_EMAILS;
    if (!envEmails) {
        // Not a warning anymore since we use Firestore as primary
        return [];
    }
    return envEmails
        .split(',')
        .map(email => email.trim().toLowerCase())
        .filter(email => email.length > 0 && email.includes('@'));
}

// Cache admin emails on cold start (refresh on function restart)
const ADMIN_EMAILS = getAdminEmailsFromEnv();

/**
 * Check if user email is in Firestore admins collection
 */
async function isAdminInFirestore(email) {
    if (!email) return false;
    try {
        const adminDoc = await db.collection('admins').doc(email.toLowerCase()).get();
        return adminDoc.exists;
    } catch (error) {
        console.error('Error checking Firestore admin:', error);
        return false;
    }
}

/**
 * Check if user email is in admin whitelist (env var)
 */
function isAdminEmail(email) {
    if (!email) return false;
    if (ADMIN_EMAILS.length === 0) return false;
    return ADMIN_EMAILS.includes(email.toLowerCase());
}

/**
 * Middleware to require admin access
 * Checks Firestore admins collection first, then falls back to env var
 */
async function requireAdmin(req, res, next) {
    const userId = req.userId;

    if (!userId || userId === 'anonymous') {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    try {
        // Get user from Firebase Auth
        const userRecord = await admin.auth().getUser(userId);

        if (!userRecord.email) {
            return res.status(403).json({
                success: false,
                error: 'Access denied',
                message: 'Admin access requires a verified email address'
            });
        }

        // Check Firestore admins collection first (primary)
        const isFirestoreAdmin = await isAdminInFirestore(userRecord.email);

        // Fall back to environment variable whitelist
        const isEnvAdmin = isAdminEmail(userRecord.email);

        if (!isFirestoreAdmin && !isEnvAdmin) {
            console.warn(`Admin access denied for: ${userRecord.email}`);
            return res.status(403).json({
                success: false,
                error: 'Access denied',
                message: 'You do not have admin privileges'
            });
        }

        // Attach admin info to request
        req.adminEmail = userRecord.email;
        req.isAdmin = true;

        // Get role from Firestore if available
        if (isFirestoreAdmin) {
            try {
                const adminDoc = await db.collection('admins').doc(userRecord.email.toLowerCase()).get();
                req.adminRole = adminDoc.data()?.role || 'admin';
            } catch (e) {
                req.adminRole = 'admin';
            }
        }

        next();
    } catch (error) {
        console.error('Admin auth error:', error);
        return res.status(500).json({
            success: false,
            error: 'Authentication error'
        });
    }
}

/**
 * Check if current user is admin (non-blocking)
 * Checks Firestore first, then env var
 */
async function checkIsAdmin(userId) {
    if (!userId || userId === 'anonymous') {
        return false;
    }

    try {
        const userRecord = await admin.auth().getUser(userId);
        if (!userRecord.email) return false;

        // Check Firestore first
        const isFirestoreAdmin = await isAdminInFirestore(userRecord.email);
        if (isFirestoreAdmin) return true;

        // Fall back to env var
        return isAdminEmail(userRecord.email);
    } catch (error) {
        return false;
    }
}

/**
 * Get list of admin emails (for display purposes)
 * Returns a copy to prevent mutation
 */
function getAdminEmails() {
    return [...ADMIN_EMAILS];
}

/**
 * Refresh admin emails from environment (useful for testing)
 */
function refreshAdminEmails() {
    ADMIN_EMAILS.length = 0;
    ADMIN_EMAILS.push(...getAdminEmailsFromEnv());
    return ADMIN_EMAILS.length;
}

module.exports = {
    requireAdmin,
    checkIsAdmin,
    isAdminEmail,
    isAdminInFirestore,
    getAdminEmails,
    refreshAdminEmails,
    ADMIN_EMAILS
};
