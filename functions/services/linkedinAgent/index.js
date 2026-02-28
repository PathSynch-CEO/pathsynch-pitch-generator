/**
 * LinkedIn Agent
 *
 * Centralized service for LinkedIn-related intelligence across the platform.
 * Used by: Pre-call briefs, Visitor Intel, Custom Sales Library
 *
 * Features:
 * - Profile comparison (find commonalities between seller & prospect)
 * - Rapport hook generation
 * - LinkedIn scoring against ICP
 * - Profile data extraction and storage
 */

const { getSellerProfile, updateSellerProfile, parseSellerLinkedIn } = require('./sellerProfile');
const { compareProfiles, COMPARISON_FIELDS } = require('./profileComparer');
const { generateRapportHooks, RAPPORT_CATEGORIES } = require('./rapportFinder');

/**
 * Main LinkedIn Agent function
 * Compares seller profile with prospect and generates rapport hooks
 *
 * @param {string} userId - Seller's user ID
 * @param {object} prospectData - Prospect's enriched contact data
 * @returns {object} Comparison results and rapport hooks
 */
async function analyzeLinkedInMatch(userId, prospectData) {
    const startTime = Date.now();

    try {
        // Get seller's stored profile
        const sellerProfile = await getSellerProfile(userId);

        if (!sellerProfile || !sellerProfile.hasLinkedInData) {
            console.log('[LinkedInAgent] Seller has no LinkedIn data stored');
            return {
                success: false,
                reason: 'seller_no_linkedin',
                message: 'Add your LinkedIn profile in Settings to enable profile comparison',
                rapportHooks: [],
            };
        }

        // Compare profiles
        const comparison = compareProfiles(sellerProfile, prospectData);

        // Generate rapport hooks from commonalities
        const rapportHooks = generateRapportHooks(comparison, sellerProfile, prospectData);

        const latencyMs = Date.now() - startTime;
        console.log(`[LinkedInAgent] Analysis complete in ${latencyMs}ms - found ${comparison.matches.length} matches`);

        return {
            success: true,
            comparison,
            rapportHooks,
            sellerProfileComplete: sellerProfile.completeness,
            latencyMs,
        };

    } catch (error) {
        console.error('[LinkedInAgent] Analysis failed:', error.message);
        return {
            success: false,
            reason: 'error',
            message: error.message,
            rapportHooks: [],
        };
    }
}

/**
 * Quick check if profiles have any obvious matches
 * Useful for quick filtering before full analysis
 *
 * @param {string} userId - Seller's user ID
 * @param {object} prospectData - Basic prospect data
 * @returns {object} Quick match indicators
 */
async function quickMatchCheck(userId, prospectData) {
    try {
        const sellerProfile = await getSellerProfile(userId);

        if (!sellerProfile || !sellerProfile.hasLinkedInData) {
            return { hasMatches: false, reason: 'no_seller_data' };
        }

        const matches = {
            sameLocation: false,
            sameSchool: false,
            sharedCompany: false,
            sameIndustry: false,
        };

        // Location check
        if (sellerProfile.location && prospectData.location) {
            const sellerCity = (sellerProfile.location.city || '').toLowerCase();
            const prospectCity = (prospectData.location || prospectData.city || '').toLowerCase();
            matches.sameLocation = sellerCity && prospectCity &&
                (sellerCity.includes(prospectCity) || prospectCity.includes(sellerCity));
        }

        // School check
        if (sellerProfile.education?.length > 0 && prospectData.education) {
            const sellerSchools = sellerProfile.education.map(e =>
                (e.school || e.institution || '').toLowerCase()
            );
            const prospectEdu = (prospectData.education || '').toLowerCase();
            matches.sameSchool = sellerSchools.some(school =>
                school && prospectEdu.includes(school)
            );
        }

        // Company check
        if (sellerProfile.careerHistory?.length > 0 && prospectData.careerHistory?.length > 0) {
            const sellerCompanies = sellerProfile.careerHistory.map(c =>
                (c.company || c.name || '').toLowerCase()
            );
            const prospectCompanies = prospectData.careerHistory.map(c =>
                (typeof c === 'string' ? c : c.company || c.name || '').toLowerCase()
            );
            matches.sharedCompany = sellerCompanies.some(sc =>
                prospectCompanies.some(pc => sc && pc && (sc.includes(pc) || pc.includes(sc)))
            );
        }

        const hasMatches = Object.values(matches).some(v => v);

        return {
            hasMatches,
            matches,
        };

    } catch (error) {
        console.error('[LinkedInAgent] Quick match check failed:', error.message);
        return { hasMatches: false, reason: 'error' };
    }
}

module.exports = {
    // Main functions
    analyzeLinkedInMatch,
    quickMatchCheck,

    // Profile management
    getSellerProfile,
    updateSellerProfile,
    parseSellerLinkedIn,

    // Comparison utilities
    compareProfiles,
    COMPARISON_FIELDS,

    // Rapport generation
    generateRapportHooks,
    RAPPORT_CATEGORIES,
};
