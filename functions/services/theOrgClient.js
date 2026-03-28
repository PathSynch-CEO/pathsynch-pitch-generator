/**
 * TheOrg API Client
 *
 * Fetches company decision makers from TheOrg's organization chart database.
 * Used by Market Intel for enterprise lead enrichment.
 *
 * Env: THEORG_API_KEY (optional — graceful skip if missing)
 */

const THEORG_API_KEY = process.env.THEORG_API_KEY;
const THEORG_BASE = 'https://api.theorg.com/v1';

/**
 * Get decision makers for a company from TheOrg
 */
async function getCompanyDecisionMakers(companyName) {
    try {
        if (!THEORG_API_KEY) {
            console.warn('[TheOrg] No API key configured');
            return null;
        }

        const searchResp = await fetch(
            `${THEORG_BASE}/organizations/search?q=${encodeURIComponent(companyName)}&limit=3`,
            {
                headers: {
                    'Authorization': `Bearer ${THEORG_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!searchResp.ok) {
            console.warn('[TheOrg] Search failed:', searchResp.status);
            return null;
        }

        const searchData = await searchResp.json();
        const org = searchData.organizations?.[0] ||
            searchData.data?.[0] ||
            searchData?.[0];

        if (!org) return null;

        const orgId = org.id || org.slug;

        const peopleResp = await fetch(
            `${THEORG_BASE}/organizations/${orgId}/people?limit=20`,
            {
                headers: {
                    'Authorization': `Bearer ${THEORG_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!peopleResp.ok) return null;

        const peopleData = await peopleResp.json();
        const people = peopleData.people ||
            peopleData.data ||
            peopleData || [];

        const DECISION_MAKER_TITLES = [
            'ceo', 'coo', 'cfo', 'cto', 'cmo',
            'vp', 'vice president', 'director',
            'head of', 'chief', 'president',
            'procurement', 'operations', 'purchasing',
            'vendor', 'supply chain', 'facilities'
        ];

        const decisionMakers = people
            .filter(p => {
                const title = (p.title || p.job_title || '').toLowerCase();
                return DECISION_MAKER_TITLES.some(t => title.includes(t));
            })
            .slice(0, 8)
            .map(p => ({
                name: p.name || `${p.first_name} ${p.last_name}`.trim(),
                title: p.title || p.job_title || '',
                department: p.department || '',
                linkedIn: p.linkedin_url || p.linkedin || null,
                seniorityLevel: getSeniorityLevel(p.title || p.job_title || '')
            }));

        return {
            companyName: org.name || companyName,
            orgSize: org.headcount || org.size || null,
            industry: org.industry || null,
            decisionMakers,
            totalPeople: people.length
        };
    } catch (e) {
        console.warn('[TheOrg] Failed for', companyName, e.message);
        return null;
    }
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

module.exports = { getCompanyDecisionMakers };
