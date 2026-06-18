/**
 * Firebase Auth Middleware
 *
 * Verifies Firebase ID tokens for config endpoints.
 * Sets req.tenantId = Firebase UID (canonical tenant identity).
 */

/**
 * @param {Object} deps - Injected dependencies
 * @param {Object} deps.auth - Firebase Admin auth instance (admin.auth())
 * @returns {Function} Express middleware
 */
function firebaseAuth({ auth }) {
    return async (req, res, next) => {
        const authHeader = req.headers['authorization'];

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Missing or invalid Authorization header. Expected: Bearer {token}'
            });
        }

        const idToken = authHeader.split('Bearer ')[1];

        try {
            const decoded = await auth.verifyIdToken(idToken);
            req.tenantId = decoded.uid;
            req.userEmail = decoded.email;
            next();
        } catch (error) {
            console.error('[firebaseAuth] Token verification failed:', error.message);
            return res.status(401).json({
                success: false,
                error: 'Invalid or expired Firebase token'
            });
        }
    };
}

module.exports = { firebaseAuth };
