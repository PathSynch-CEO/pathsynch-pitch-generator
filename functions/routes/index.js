/**
 * Route Index
 *
 * Combines all route modules and provides a unified router.
 * This is the main entry point for all API routes.
 */

const { combineRouters } = require('../utils/router');

// Import route modules
const pitchRoutes = require('./pitchRoutes');
const userRoutes = require('./userRoutes');
const teamRoutes = require('./teamRoutes');
const analyticsRoutes = require('./analyticsRoutes');
const pitchOutcomeRoutes = require('./pitchOutcomeRoutes');
const transcriptRoutes = require('./transcriptRoutes');
const precallFormRoutes = require('./precallFormRoutes');
const investorRoutes = require('./investorRoutes');
const adminRoutes = require('./adminRoutes');

/**
 * All routes combined into a single router
 * Routes are matched in the order they are added
 */
const allRoutes = combineRouters(
    pitchRoutes,
    userRoutes,
    teamRoutes,
    analyticsRoutes,
    pitchOutcomeRoutes,
    transcriptRoutes,
    precallFormRoutes,
    investorRoutes,
    adminRoutes
);

/**
 * Get all registered route patterns (for documentation)
 */
function getRouteList() {
    return allRoutes.getRoutes();
}

/**
 * List of available API endpoints (for 404 response)
 */
const AVAILABLE_ENDPOINTS = [
    // Pitch endpoints (template-based)
    'POST /api/v1/generate-pitch',
    'GET  /api/v1/pitches',
    'GET  /api/v1/pitch/:pitchId',
    'PUT  /api/v1/pitch/:pitchId',
    'DELETE /api/v1/pitch/:pitchId',
    'GET  /api/v1/pitch/share/:shareId',
    // Narrative endpoints (AI-powered)
    'POST /api/v1/narratives/generate',
    'GET  /api/v1/narratives',
    'GET  /api/v1/narratives/:id',
    'POST /api/v1/narratives/:id/regenerate',
    'DELETE /api/v1/narratives/:id',
    // Formatter endpoints
    'GET  /api/v1/formatters',
    'POST /api/v1/narratives/:id/format/:type',
    'POST /api/v1/narratives/:id/format-batch',
    'GET  /api/v1/narratives/:id/assets',
    'GET  /api/v1/assets/:assetId',
    'DELETE /api/v1/assets/:assetId',
    // User endpoints
    'GET  /api/v1/user',
    'PUT  /api/v1/user/settings',
    // Team endpoints
    'GET  /api/v1/team',
    'POST /api/v1/team',
    'POST /api/v1/team/invite',
    'GET  /api/v1/team/invite-details',
    'POST /api/v1/team/accept-invite',
    'PUT  /api/v1/team/members/:memberId/role',
    'DELETE /api/v1/team/members/:memberId',
    'DELETE /api/v1/team/invites/:inviteId',
    // Usage & billing
    'GET  /api/v1/usage',
    'GET  /api/v1/pricing-plans',
    'GET  /api/v1/subscription',
    'POST /api/v1/stripe/create-checkout-session',
    'POST /api/v1/stripe/create-portal-session',
    // Analytics
    'POST /api/v1/analytics/track',
    'GET  /api/v1/analytics/pitch/:pitchId',
    // Templates
    'GET  /api/v1/templates',
    // Bulk upload
    'GET  /api/v1/bulk/template',
    'POST /api/v1/bulk/upload',
    'GET  /api/v1/bulk/jobs',
    'GET  /api/v1/bulk/jobs/:jobId',
    'GET  /api/v1/bulk/jobs/:jobId/download',
    // Market intelligence
    'POST /api/v1/market/report',
    'GET  /api/v1/market/reports',
    'GET  /api/v1/market/reports/:reportId',
    'GET  /api/v1/market/industries',
    'GET  /api/v1/market/company-sizes',
    'POST /api/v1/market/reports/:reportId/email',
    'POST /api/v1/market/saved-searches',
    'GET  /api/v1/market/saved-searches',
    'DELETE /api/v1/market/saved-searches/:searchId',
    'POST /api/v1/market/saved-searches/:searchId/run',
    // Leads
    'POST /api/v1/leads/mini-report',
    'GET  /api/v1/leads/stats',
    'GET  /api/v1/leads/export',
    // Export
    'POST /api/v1/export/ppt/:pitchId',
    'GET  /api/v1/export/check',
    // Email
    'POST /api/v1/pitch/:pitchId/email',
    'POST /api/v1/market/reports/:reportId/email',
    // Admin (restricted)
    'GET  /api/v1/admin/dashboard',
    'GET  /api/v1/admin/stats',
    'GET  /api/v1/admin/users',
    'GET  /api/v1/admin/users/:userId',
    'PUT  /api/v1/admin/users/:userId/plan',
    'GET  /api/v1/admin/revenue',
    'GET  /api/v1/admin/pitches',
    'GET  /api/v1/admin/usage',
    // Admin - Discount Codes
    'POST /api/v1/admin/discount-codes',
    'GET  /api/v1/admin/discount-codes',
    'PUT  /api/v1/admin/discount-codes/:codeId/toggle',
    'DELETE /api/v1/admin/discount-codes/:codeId',
    'GET  /api/v1/admin/redemptions',
    // Admin - Pricing
    'GET  /api/v1/admin/pricing',
    'PUT  /api/v1/admin/pricing',
    'GET  /api/v1/pricing',
    // Admin - Management
    'GET  /api/v1/admin/admins',
    'POST /api/v1/admin/admins',
    'DELETE /api/v1/admin/admins/:email',
    // Public - Discount Codes
    'POST /api/v1/discount-codes/validate',
    'POST /api/v1/discount-codes/redeem',
    // System
    'GET  /api/v1/health',
    // Pitch Outcomes
    'PUT  /api/v1/pitches/:pitchId/outcome',
    'GET  /api/v1/pitches/:pitchId/outcome',
    // Transcript parsing (Leave-Behind)
    'POST /api/v1/transcript/parse',
    'POST /api/v1/transcript/summary',
    'POST /api/v1/transcript/extract',
    'POST /api/v1/transcript/leave-behind',
    'GET  /api/v1/transcript/formats',
    // Pre-Call Forms (Enterprise)
    'GET  /api/v1/precall-forms/defaults',
    'POST /api/v1/precall-forms',
    'GET  /api/v1/precall-forms',
    'GET  /api/v1/precall-forms/:formId',
    'PUT  /api/v1/precall-forms/:formId/questions',
    'POST /api/v1/precall-forms/:formId/send',
    'DELETE /api/v1/precall-forms/:formId',
    'GET  /api/v1/precall-forms/public/:shareId',
    'POST /api/v1/precall-forms/public/:shareId/submit',
    'GET  /api/v1/precall-forms/:formId/pitch-data',
    // Investor Updates (Enterprise)
    'GET  /api/v1/investor/integrations/status',
    'POST /api/v1/investor/integrations/connect/stripe',
    'GET  /api/v1/investor/integrations/connect/shopify',
    'GET  /api/v1/investor/integrations/connect/quickbooks',
    'GET  /api/v1/investor/integrations/connect/ga4',
    'DELETE /api/v1/investor/integrations/:provider',
    'GET  /api/v1/investor/metrics',
    'GET  /api/v1/investor/metrics/comparison',
    'GET  /api/v1/investor/metrics/history',
    'POST /api/v1/investor/updates',
    'GET  /api/v1/investor/updates',
    'GET  /api/v1/investor/updates/:id',
    'PUT  /api/v1/investor/updates/:id',
    'POST /api/v1/investor/updates/:id/regenerate',
    'POST /api/v1/investor/updates/:id/publish',
    'DELETE /api/v1/investor/updates/:id',
    'GET  /api/v1/investor/templates'
];

module.exports = {
    pitchRoutes,
    userRoutes,
    teamRoutes,
    analyticsRoutes,
    pitchOutcomeRoutes,
    transcriptRoutes,
    precallFormRoutes,
    investorRoutes,
    adminRoutes,
    allRoutes,
    getRouteList,
    AVAILABLE_ENDPOINTS
};
