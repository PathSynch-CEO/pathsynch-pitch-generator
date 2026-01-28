/**
 * Admin Authentication Middleware
 *
 * Restricts access to admin endpoints based on email whitelist
 */

const admin = require('firebase-admin');

// Admin email whitelist - add authorized admin emails here
const ADMIN_EMAILS = [
    'admin@pathsynch.com',
    'support@pathsynch.com'
    // Add additional admin emails as needed
];

/**
 * Check if user email is in admin whitelist
 */
function isAdminEmail(email) {
    if (!email) return false;
    return ADMIN_EMAILS.includes(email.toLowerCase());
}

/**
 * Middleware to require admin access
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

        if (!isAdminEmail(userRecord.email)) {
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
 */
async function checkIsAdmin(userId) {
    if (!userId || userId === 'anonymous') {
        return false;
    }

    try {
        const userRecord = await admin.auth().getUser(userId);
        return userRecord.email && isAdminEmail(userRecord.email);
    } catch (error) {
        return false;
    }
}

/**
 * Get list of admin emails (for display purposes)
 */
function getAdminEmails() {
    return [...ADMIN_EMAILS];
}

module.exports = {
    requireAdmin,
    checkIsAdmin,
    isAdminEmail,
    getAdminEmails,
    ADMIN_EMAILS
};
