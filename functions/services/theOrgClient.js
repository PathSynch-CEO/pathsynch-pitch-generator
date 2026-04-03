/**
 * TheOrg API Client
 *
 * Fetches company decision makers from TheOrg's organization chart database.
 * Used by Market Intel for SMB fallback enrichment + enterprise primary enrichment.
 *
 * Env: THEORG_API_KEY (Secret Manager — graceful skip if missing)
 */

const THEORG_API_KEY = process.env.THEORG_API_KEY;
const THEORG_BASE = 'https://api.theorg.com/v1';

const DEFAULT_DM_TITLES = [
    'ceo', 'coo', 'cfo', 'cto', 'cmo',
    'vp', 'vice president', 'director',
    'head of', 'chief', 'president', 'owner', 'founder',
    'general manager', 'procurement', 'operations',
    'purchasing', 'vendor', 'supply chain', 'facilities'
];

/**
 * Search for an organization on TheOrg
 */
async function searchOrganization(businessName, city) {
    if (!THEORG_API_KEY) {
        console.warn('[TheOrg] No API key configured');
        return null;
    }
    try {
        const query = city ? `${businessName} ${city}` : businessName;
        const resp = await fetch(
            `${THEORG_BASE}/organizations/search?q=${encodeURIComponent(query)}&limit=3`,
            {
                headers: {
                    'Authorization': `Bearer ${THEORG_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                signal: AbortSignal.timeout(5000)
            }
        );
        if (!resp.ok) {
            console.warn('[TheOrg] Search failed:', resp.status);
            return null;
        }
        const data = await resp.json();
        return data.organizations?.[0] || data.data?.[0] || data?.[0] || null;
    } catch (e) {
        console.warn(`[TheOrg] Search error for ${businessName}:`, e.message);
        return null;
    }
}

/**
 * Get organization members/people
 */
async function getOrgMembers(orgId) {
    if (!THEORG_API_KEY || !orgId) return null;
    try {
        const resp = await fetch(
            `${THEORG_BASE}/organizations/${orgId}/people?limit=20`,
            {
                headers: {
                    'Authorization': `Bearer ${THEORG_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                signal: AbortSignal.timeout(5000)
            }
        );
        if (!resp.ok) return null;
        const data = await resp.json();
        return data.people || data.data || data || [];
    } catch (e) {
        console.warn(`[TheOrg] Members error for org ${orgId}:`, e.message);
        return null;
    }
}

/**
 * Check if a person is a recent hire (joined within last 6 months)
 */
function isRecentHire(startDate) {
    if (!startDate) return false;
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    return new Date(startDate) > sixMonthsAgo;
}

/**
 * Get org chart for a business — filters to decision maker titles
 * @param {string} businessName
 * @param {string} city
 * @param {string[]} targetTitles — titles to filter for (from enterprise vertical config or default)
 * @returns {Object|null} { orgName, orgSize, decisionMakers[], recentHires[], totalMembers }
 */
async function getOrgChart(businessName, city, targetTitles) {
    const org = await searchOrganization(businessName, city);
    if (!org) return null;

    const orgId = org.id || org.slug;
    const people = await getOrgMembers(orgId);
    if (!people || !Array.isArray(people) || people.length === 0) return null;

    const titlesToMatch = targetTitles || DEFAULT_DM_TITLES;

    const decisionMakers = people
        .filter(p => {
            const title = (p.title || p.job_title || '').toLowerCase();
            return titlesToMatch.some(t => title.includes(t.toLowerCase()));
        })
        .slice(0, 8)
        .map(p => ({
            name: p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
            title: p.title || p.job_title || '',
            linkedIn: p.linkedin_url || p.linkedin || null,
            recentHire: isRecentHire(p.start_date || p.startDate),
            reportsTo: p.reports_to?.name || p.reportsTo?.name || null,
            seniorityLevel: getSeniorityLevel(p.title || p.job_title || '')
        }));

    return {
        orgId,
        orgName: org.name || businessName,
        orgSize: org.headcount || org.size || null,
        decisionMakers,
        recentHires: decisionMakers.filter(dm => dm.recentHire),
        totalMembers: people.length
    };
}

/**
 * Get decision makers for a company from TheOrg (legacy — kept for backward compat)
 */
async function getCompanyDecisionMakers(companyName) {
    return getOrgChart(companyName, null, null);
}

/**
 * Determine seniority level from title
 */
function getSeniorityLevel(title) {
    const t = title.toLowerCase();
    if (['ceo', 'coo', 'cfo', 'cto', 'cmo', 'chief', 'president'].some(x => t.includes(x)))
        return 'C-Suite';
    if (['vp', 'vice president'].some(x => t.includes(x))) return 'VP';
    if (t.includes('director')) return 'Director';
    if (t.includes('head of')) return 'Head';
    if (t.includes('manager')) return 'Manager';
    return 'Individual Contributor';
}

module.exports = { searchOrganization, getOrgMembers, getOrgChart, getCompanyDecisionMakers, isRecentHire };
