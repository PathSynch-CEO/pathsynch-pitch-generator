/**
 * Signal Types for Sales Intelligence
 *
 * Defines the types of signals tracked by Intent Hunter,
 * used by ICP Refiner, and scored by LinkedIn Scorer.
 */

/**
 * Intent Signal Categories
 */
const INTENT_CATEGORIES = {
    // Website behavior
    PAGE_VIEW: 'page_view',
    TIME_ON_SITE: 'time_on_site',
    RETURN_VISIT: 'return_visit',
    SCROLL_DEPTH: 'scroll_depth',

    // High-intent pages
    PRICING_VIEW: 'pricing_view',
    DEMO_PAGE: 'demo_page',
    CASE_STUDY_VIEW: 'case_study_view',
    COMPARISON_PAGE: 'comparison_page',
    FEATURES_PAGE: 'features_page',

    // Engagement actions
    FORM_SUBMIT: 'form_submit',
    CONTENT_DOWNLOAD: 'content_download',
    VIDEO_WATCH: 'video_watch',
    CHAT_INITIATED: 'chat_initiated',

    // Email engagement
    EMAIL_OPEN: 'email_open',
    EMAIL_CLICK: 'email_click',
    EMAIL_REPLY: 'email_reply',

    // Social signals
    LINKEDIN_VIEW: 'linkedin_view',
    SOCIAL_SHARE: 'social_share',

    // Direct signals
    DEMO_REQUEST: 'demo_request',
    CONTACT_FORM: 'contact_form',
    PHONE_CALL: 'phone_call',
};

/**
 * Intent signal weights (for scoring)
 */
const INTENT_WEIGHTS = {
    // Very high intent (80-100 points)
    [INTENT_CATEGORIES.DEMO_REQUEST]: 100,
    [INTENT_CATEGORIES.CONTACT_FORM]: 90,
    [INTENT_CATEGORIES.PHONE_CALL]: 95,

    // High intent (50-79 points)
    [INTENT_CATEGORIES.PRICING_VIEW]: 70,
    [INTENT_CATEGORIES.COMPARISON_PAGE]: 65,
    [INTENT_CATEGORIES.CASE_STUDY_VIEW]: 55,
    [INTENT_CATEGORIES.CONTENT_DOWNLOAD]: 50,

    // Medium intent (20-49 points)
    [INTENT_CATEGORIES.RETURN_VISIT]: 40,
    [INTENT_CATEGORIES.FEATURES_PAGE]: 35,
    [INTENT_CATEGORIES.EMAIL_CLICK]: 30,
    [INTENT_CATEGORIES.VIDEO_WATCH]: 25,
    [INTENT_CATEGORIES.CHAT_INITIATED]: 45,

    // Low intent (5-19 points)
    [INTENT_CATEGORIES.PAGE_VIEW]: 5,
    [INTENT_CATEGORIES.EMAIL_OPEN]: 10,
    [INTENT_CATEGORIES.TIME_ON_SITE]: 15,
    [INTENT_CATEGORIES.SCROLL_DEPTH]: 8,
    [INTENT_CATEGORIES.LINKEDIN_VIEW]: 12,
    [INTENT_CATEGORIES.SOCIAL_SHARE]: 15,
};

/**
 * ICP Criteria Categories
 */
const ICP_CRITERIA = {
    // Company attributes
    COMPANY_SIZE: 'company_size',
    INDUSTRY: 'industry',
    REVENUE: 'revenue',
    LOCATION: 'location',
    TECH_STACK: 'tech_stack',
    GROWTH_STAGE: 'growth_stage',

    // Contact attributes
    TITLE_SENIORITY: 'title_seniority',
    DEPARTMENT: 'department',
    DECISION_AUTHORITY: 'decision_authority',
    YEARS_EXPERIENCE: 'years_experience',

    // Behavioral attributes
    ENGAGEMENT_LEVEL: 'engagement_level',
    BUYING_TIMELINE: 'buying_timeline',
    BUDGET_AUTHORITY: 'budget_authority',

    // Fit indicators
    USE_CASE_MATCH: 'use_case_match',
    PAIN_POINT_MATCH: 'pain_point_match',
    COMPETITIVE_SITUATION: 'competitive_situation',
};

/**
 * LinkedIn Profile Scoring Factors
 */
const LINKEDIN_FACTORS = {
    // Title/Role
    TITLE_MATCH: 'title_match',
    SENIORITY_LEVEL: 'seniority_level',
    DECISION_MAKER: 'decision_maker',

    // Company
    COMPANY_SIZE_MATCH: 'company_size_match',
    INDUSTRY_MATCH: 'industry_match',
    COMPANY_GROWTH: 'company_growth',

    // Experience
    YEARS_IN_ROLE: 'years_in_role',
    RELEVANT_EXPERIENCE: 'relevant_experience',
    DOMAIN_EXPERTISE: 'domain_expertise',

    // Activity
    LINKEDIN_ACTIVITY: 'linkedin_activity',
    CONTENT_ENGAGEMENT: 'content_engagement',
    NETWORK_SIZE: 'network_size',
};

/**
 * Seniority levels for title scoring
 */
const SENIORITY_LEVELS = {
    C_LEVEL: { label: 'C-Level', weight: 100, patterns: ['ceo', 'cto', 'cfo', 'coo', 'cmo', 'cio', 'chief'] },
    VP: { label: 'VP', weight: 85, patterns: ['vp', 'vice president', 'svp', 'evp'] },
    DIRECTOR: { label: 'Director', weight: 70, patterns: ['director', 'head of'] },
    MANAGER: { label: 'Manager', weight: 55, patterns: ['manager', 'lead', 'team lead'] },
    SENIOR: { label: 'Senior IC', weight: 40, patterns: ['senior', 'sr.', 'principal', 'staff'] },
    INDIVIDUAL: { label: 'Individual Contributor', weight: 25, patterns: [] },
};

/**
 * Company size ranges
 */
const COMPANY_SIZES = {
    ENTERPRISE: { label: 'Enterprise', min: 1000, weight: 100 },
    MID_MARKET: { label: 'Mid-Market', min: 200, max: 999, weight: 80 },
    SMB: { label: 'SMB', min: 50, max: 199, weight: 60 },
    SMALL: { label: 'Small Business', min: 11, max: 49, weight: 40 },
    STARTUP: { label: 'Startup', min: 1, max: 10, weight: 30 },
};

/**
 * Deal outcomes for ICP learning
 */
const DEAL_OUTCOMES = {
    CLOSED_WON: 'closed_won',
    CLOSED_LOST: 'closed_lost',
    DISQUALIFIED: 'disqualified',
    NO_DECISION: 'no_decision',
    COMPETITOR_LOSS: 'competitor_loss',
};

/**
 * Determine seniority level from title
 */
function getSeniorityFromTitle(title) {
    if (!title) return SENIORITY_LEVELS.INDIVIDUAL;

    const titleLower = title.toLowerCase();

    for (const [key, level] of Object.entries(SENIORITY_LEVELS)) {
        if (level.patterns.some(pattern => titleLower.includes(pattern))) {
            return { key, ...level };
        }
    }

    return { key: 'INDIVIDUAL', ...SENIORITY_LEVELS.INDIVIDUAL };
}

/**
 * Determine company size category
 */
function getCompanySizeCategory(employeeCount) {
    if (!employeeCount) return null;

    for (const [key, size] of Object.entries(COMPANY_SIZES)) {
        if (employeeCount >= size.min && (!size.max || employeeCount <= size.max)) {
            return { key, ...size };
        }
    }

    return null;
}

module.exports = {
    INTENT_CATEGORIES,
    INTENT_WEIGHTS,
    ICP_CRITERIA,
    LINKEDIN_FACTORS,
    SENIORITY_LEVELS,
    COMPANY_SIZES,
    DEAL_OUTCOMES,
    getSeniorityFromTitle,
    getCompanySizeCategory,
};
