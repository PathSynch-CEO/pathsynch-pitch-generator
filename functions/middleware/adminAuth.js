/**
 * Admin Authentication Middleware
 *
 * Restricts access to admin endpoints based on:
 * 1. Firestore admins collection (primary)
 * 2. ADMIN_EMAILS environment variable (fallback/legacy)
 */

const admin = require('firebase-admin');
const crypto = require('node:crypto');

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
const RECOVERY_AUTH_MAX_AGE_SECONDS = 15 * 60;

function createRequireRecoveryOperator(options = {}) {
    const authClient = options.auth || admin.auth();
    const firestore = options.db || db;
    const now = options.now || (() => new Date());
    return async function requireRecoveryOperator(req, res, next) {
        const authorization = String(req.headers?.authorization || '');
        const bearer = authorization.match(/^Bearer ([^\s]+)$/);
        if (!req.userId || req.userId === 'anonymous' || !bearer) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }
        try {
            // Recovery is a privileged, destructive operator surface. Re-verify the
            // exact bearer token with Firebase's authoritative revocation check rather
            // than approximating revocation with second-granularity local timestamps.
            const decoded = await authClient.verifyIdToken(bearer[1], true);
            if (!decoded?.uid || decoded.uid !== req.userId) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const authTime = Number(decoded.auth_time);
            const nowSeconds = Math.floor(now().getTime() / 1000);
            if (!Number.isInteger(authTime)
                || authTime > nowSeconds + 60
                || nowSeconds - authTime > RECOVERY_AUTH_MAX_AGE_SECONDS) {
                return res.status(401).json({
                    success: false,
                    error: 'Recent authentication required'
                });
            }
            const userRecord = await authClient.getUser(decoded.uid);
            const email = String(userRecord.email || '').trim().toLowerCase();
            if (userRecord.disabled === true) {
                return res.status(403).json({
                    success: false,
                    error: 'Operator identity is disabled'
                });
            }
            if (!email || decoded.email_verified !== true || userRecord.emailVerified !== true
                || String(decoded.email || '').trim().toLowerCase() !== email) {
                return res.status(403).json({
                    success: false,
                    error: 'Verified operator identity required'
                });
            }
            const snapshot = await firestore.collection('admins').doc(email).get();
            const record = snapshot.exists ? snapshot.data() : null;
            if (!record || record.role !== 'super_admin' || record.active === false) {
                return res.status(403).json({
                    success: false,
                    error: 'Synthetic recovery operator access required'
                });
            }
            req.recoveryActor = Object.freeze({
                uid: decoded.uid,
                uid_digest: crypto.createHash('sha256').update(decoded.uid).digest('hex'),
                email_digest: crypto.createHash('sha256').update(email).digest('hex'),
                role: 'super_admin',
                permission: 'synchintro.synthetic_recovery'
            });
            return next();
        } catch (error) {
            const code = String(error?.code || '');
            if (['auth/id-token-revoked', 'auth/id-token-expired', 'auth/argument-error',
                'auth/invalid-id-token'].includes(code)) {
                return res.status(401).json({ success: false, error: 'Operator authentication denied' });
            }
            if (code === 'auth/user-disabled') {
                return res.status(403).json({ success: false, error: 'Operator identity is disabled' });
            }
            return res.status(500).json({
                success: false,
                error: 'Operator authentication unavailable'
            });
        }
    };
}

const requireRecoveryOperator = createRequireRecoveryOperator();

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
    ADMIN_EMAILS,
    RECOVERY_AUTH_MAX_AGE_SECONDS,
    createRequireRecoveryOperator,
    requireRecoveryOperator
};
