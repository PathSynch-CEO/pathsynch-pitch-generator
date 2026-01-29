/**
 * Admin Authentication Middleware
 *
 * Restricts access to admin endpoints based on email whitelist.
 * Admin emails are configured via ADMIN_EMAILS environment variable (comma-separated).
 */

const admin = require('firebase-admin');

/**
 * Get admin emails from environment variable
 * Format: ADMIN_EMAILS=admin@example.com,support@example.com
 */
function getAdminEmailsFromEnv() {
    const envEmails = process.env.ADMIN_EMAILS;
    if (!envEmails) {
        console.warn('ADMIN_EMAILS environment variable not set. No admin access will be granted.');
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
 * Check if user email is in admin whitelist
 */
function isAdminEmail(email) {
    if (!email) return false;
    if (ADMIN_EMAILS.length === 0) return false;
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
    getAdminEmails,
    refreshAdminEmails,
    ADMIN_EMAILS
};
