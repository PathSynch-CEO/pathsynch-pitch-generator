/**
 * USPTO Patent & Trademark Service
 * Provides innovation signals from US Patent and Trademark Office data
 *
 * APIs Used:
 * - PatentsView API (free, no auth): Patent data by assignee/company
 * - Future: TSDR API for trademark data (requires API key)
 *
 * Documentation:
 * - https://patentsview.org/apis/api-endpoints/assignees
 * - https://patentsview.org/apis/api-endpoints/patents
 */

const admin = require('firebase-admin');

// Cache duration: 7 days (patent data doesn't change frequently)
const CACHE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

// PatentsView API base URL
const PATENTSVIEW_BASE_URL = 'https://api.patentsview.org';

/**
 * Search for patents by company/assignee name
 * @param {string} companyName - Company name to search
 * @param {number} limit - Max results to return
 * @returns {Promise<Object>} Patent data for the company
 */
async function searchPatentsByCompany(companyName, limit = 100) {
    if (!companyName) return null;

    try {
        // Clean company name for search
        const searchName = cleanCompanyName(companyName);

        // Build the query - search for assignee organizations containing the name
        const query = {
            _or: [
                { _contains: { assignee_organization: searchName } },
                { _begins: { assignee_organization: searchName } }
            ]
        };

        const fields = [
            'assignee_id',
            'assignee_organization',
            'assignee_type',
            'assignee_total_num_patents',
            'assignee_first_seen_date',
            'assignee_last_seen_date'
        ];

        const url = `${PATENTSVIEW_BASE_URL}/assignees/query?q=${encodeURIComponent(JSON.stringify(query))}&f=${encodeURIComponent(JSON.stringify(fields))}&o={"per_page":${limit}}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            console.error(`PatentsView API error: ${response.status}`);
            return null;
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error searching patents by company:', error);
        return null;
    }
}

/**
 * Get recent patents for a company
 * @param {string} companyName - Company name
 * @param {number} years - How many years back to search
 * @returns {Promise<Object>} Recent patent data
 */
async function getRecentPatents(companyName, years = 5) {
    if (!companyName) return null;

    try {
        const searchName = cleanCompanyName(companyName);
        const startDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - years);
        const dateStr = startDate.toISOString().split('T')[0];

        const query = {
            _and: [
                { _or: [
                    { _contains: { assignee_organization: searchName } },
                    { _begins: { assignee_organization: searchName } }
                ]},
                { _gte: { patent_date: dateStr } }
            ]
        };

        const fields = [
            'patent_id',
            'patent_number',
            'patent_title',
            'patent_date',
            'patent_type',
            'patent_abstract',
            'assignee_organization'
        ];

        const url = `${PATENTSVIEW_BASE_URL}/patents/query?q=${encodeURIComponent(JSON.stringify(query))}&f=${encodeURIComponent(JSON.stringify(fields))}&o={"per_page":25,"sort":[{"patent_date":"desc"}]}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            console.error(`PatentsView API error: ${response.status}`);
            return null;
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error getting recent patents:', error);
        return null;
    }
}

/**
 * Get patent statistics for a company
 * @param {string} companyName - Company name
 * @returns {Promise<Object>} Patent statistics
 */
async function getCompanyPatentStats(companyName) {
    if (!companyName) return null;

    // Check cache first
    const cached = await getCachedData('patent_stats', companyName);
    if (cached) return cached;

    try {
        // Get assignee data
        const assigneeData = await searchPatentsByCompany(companyName, 10);

        if (!assigneeData || !assigneeData.assignees || assigneeData.assignees.length === 0) {
            return {
                found: false,
                companyName,
                totalPatents: 0,
                message: 'No patent records found'
            };
        }

        // Find the best matching assignee
        const bestMatch = findBestMatch(companyName, assigneeData.assignees);

        if (!bestMatch) {
            return {
                found: false,
                companyName,
                totalPatents: 0,
                message: 'No close match found'
            };
        }

        // Get recent patents for additional context
        const recentPatents = await getRecentPatents(bestMatch.assignee_organization, 5);

        const stats = {
            found: true,
            companyName: bestMatch.assignee_organization,
            assigneeId: bestMatch.assignee_id,
            assigneeType: bestMatch.assignee_type,
            totalPatents: bestMatch.assignee_total_num_patents || 0,
            firstPatentDate: bestMatch.assignee_first_seen_date || null,
            lastPatentDate: bestMatch.assignee_last_seen_date || null,
            recentPatentCount: recentPatents?.patents?.length || 0,
            recentPatents: (recentPatents?.patents || []).slice(0, 5).map(p => ({
                number: p.patent_number,
                title: p.patent_title,
                date: p.patent_date,
                type: p.patent_type
            })),
            innovationSignal: calculateInnovationSignal(bestMatch, recentPatents)
        };

        // Cache the result
        await cacheData('patent_stats', companyName, stats);

        return stats;
    } catch (error) {
        console.error('Error getting company patent stats:', error);
        return null;
    }
}

/**
 * Enrich competitors with patent data
 * @param {Array} competitors - Array of competitor objects
 * @param {number} maxToEnrich - Max number of competitors to enrich
 * @returns {Promise<Array>} Enriched competitors
 */
async function enrichCompetitorsWithPatents(competitors, maxToEnrich = 5) {
    if (!competitors || competitors.length === 0) return competitors;

    const toEnrich = competitors.slice(0, maxToEnrich);
    const enrichedPromises = toEnrich.map(async (competitor) => {
        const patentStats = await getCompanyPatentStats(competitor.name);
        return {
            ...competitor,
            patentData: patentStats
        };
    });

    const enriched = await Promise.all(enrichedPromises);

    // Merge enriched with remaining competitors
    return [
        ...enriched,
        ...competitors.slice(maxToEnrich)
    ];
}

/**
 * Get industry patent trends
 * @param {string} industry - Industry name or keyword
 * @returns {Promise<Object>} Industry patent trends
 */
async function getIndustryPatentTrends(industry) {
    if (!industry) return null;

    // Check cache
    const cached = await getCachedData('industry_patents', industry);
    if (cached) return cached;

    try {
        // Search for patents with industry-related terms in title/abstract
        const currentYear = new Date().getFullYear();
        const years = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3, currentYear - 4];

        const yearCounts = {};

        for (const year of years) {
            const query = {
                _and: [
                    { _text_any: { patent_title: industry } },
                    { _gte: { patent_date: `${year}-01-01` } },
                    { _lte: { patent_date: `${year}-12-31` } }
                ]
            };

            const url = `${PATENTSVIEW_BASE_URL}/patents/query?q=${encodeURIComponent(JSON.stringify(query))}&f=["patent_id"]&o={"per_page":1}`;

            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });

            if (response.ok) {
                const data = await response.json();
                yearCounts[year] = data.total_patent_count || 0;
            } else {
                yearCounts[year] = 0;
            }

            // Small delay to respect rate limits
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        const trends = {
            industry,
            yearlyPatentCounts: yearCounts,
            trend: calculateTrend(yearCounts),
            totalRecent: Object.values(yearCounts).reduce((a, b) => a + b, 0)
        };

        // Cache the result
        await cacheData('industry_patents', industry, trends);

        return trends;
    } catch (error) {
        console.error('Error getting industry patent trends:', error);
        return null;
    }
}

/**
 * Build patent intelligence summary for market report
 * @param {Array} competitors - Competitors with patent data
 * @param {string} industry - Industry name
 * @returns {Object} Patent intelligence summary
 */
function buildPatentIntelligence(competitors, industry) {
    const competitorsWithPatents = (competitors || []).filter(c => c.patentData?.found);

    if (competitorsWithPatents.length === 0) {
        return {
            hasData: false,
            summary: 'No patent data available for analyzed competitors.'
        };
    }

    // Calculate aggregate stats
    const totalPatents = competitorsWithPatents.reduce((sum, c) => sum + (c.patentData?.totalPatents || 0), 0);
    const avgPatents = Math.round(totalPatents / competitorsWithPatents.length);
    const recentlyActive = competitorsWithPatents.filter(c => c.patentData?.recentPatentCount > 0);

    // Find top patent holders
    const topHolders = competitorsWithPatents
        .sort((a, b) => (b.patentData?.totalPatents || 0) - (a.patentData?.totalPatents || 0))
        .slice(0, 3);

    // Innovation signals
    const highInnovation = competitorsWithPatents.filter(c => c.patentData?.innovationSignal === 'high');
    const moderateInnovation = competitorsWithPatents.filter(c => c.patentData?.innovationSignal === 'moderate');

    return {
        hasData: true,
        analyzedCompetitors: competitorsWithPatents.length,
        totalPatentsInMarket: totalPatents,
        averagePatentsPerCompetitor: avgPatents,
        recentlyActiveCompetitors: recentlyActive.length,
        topPatentHolders: topHolders.map(c => ({
            name: c.name,
            totalPatents: c.patentData?.totalPatents || 0,
            recentPatents: c.patentData?.recentPatentCount || 0,
            innovationSignal: c.patentData?.innovationSignal
        })),
        innovationBreakdown: {
            high: highInnovation.length,
            moderate: moderateInnovation.length,
            low: competitorsWithPatents.length - highInnovation.length - moderateInnovation.length
        },
        summary: generatePatentSummary(competitorsWithPatents, totalPatents, avgPatents, recentlyActive.length)
    };
}

// ============ Helper Functions ============

/**
 * Clean company name for search
 */
function cleanCompanyName(name) {
    if (!name) return '';
    return name
        .replace(/\s+(Inc\.?|LLC|Corp\.?|Corporation|Company|Co\.?|Ltd\.?|Limited|LP|LLP)$/i, '')
        .replace(/[^\w\s]/g, '')
        .trim();
}

/**
 * Find best matching assignee from results
 */
function findBestMatch(searchName, assignees) {
    if (!assignees || assignees.length === 0) return null;

    const cleanSearch = cleanCompanyName(searchName).toLowerCase();

    // First try exact match
    const exactMatch = assignees.find(a =>
        cleanCompanyName(a.assignee_organization).toLowerCase() === cleanSearch
    );
    if (exactMatch) return exactMatch;

    // Then try starts with
    const startsMatch = assignees.find(a =>
        cleanCompanyName(a.assignee_organization).toLowerCase().startsWith(cleanSearch)
    );
    if (startsMatch) return startsMatch;

    // Return first result (most relevant from API)
    return assignees[0];
}

/**
 * Calculate innovation signal based on patent data
 */
function calculateInnovationSignal(assignee, recentPatents) {
    const totalPatents = assignee?.assignee_total_num_patents || 0;
    const recentCount = recentPatents?.patents?.length || 0;

    // High: 50+ total patents AND active recently (5+ in last 5 years)
    if (totalPatents >= 50 && recentCount >= 5) return 'high';

    // Moderate: 10+ patents OR some recent activity
    if (totalPatents >= 10 || recentCount >= 2) return 'moderate';

    // Low: few or no patents
    return 'low';
}

/**
 * Calculate trend from yearly counts
 */
function calculateTrend(yearCounts) {
    const years = Object.keys(yearCounts).sort();
    if (years.length < 2) return 'stable';

    const recent = yearCounts[years[years.length - 1]] || 0;
    const older = yearCounts[years[0]] || 0;

    if (older === 0) return recent > 0 ? 'growing' : 'stable';

    const change = ((recent - older) / older) * 100;

    if (change > 20) return 'growing';
    if (change < -20) return 'declining';
    return 'stable';
}

/**
 * Generate patent summary narrative
 */
function generatePatentSummary(competitors, totalPatents, avgPatents, recentlyActive) {
    const parts = [];

    if (totalPatents > 0) {
        parts.push(`Analysis of ${competitors.length} competitors reveals ${totalPatents.toLocaleString()} total patents`);
        parts.push(`averaging ${avgPatents} patents per company`);
    }

    if (recentlyActive > 0) {
        const pct = Math.round((recentlyActive / competitors.length) * 100);
        parts.push(`${pct}% of competitors have filed patents in the last 5 years, indicating ${pct > 50 ? 'active' : 'moderate'} innovation in this market`);
    }

    const topHolder = competitors.sort((a, b) => (b.patentData?.totalPatents || 0) - (a.patentData?.totalPatents || 0))[0];
    if (topHolder?.patentData?.totalPatents > 10) {
        parts.push(`${topHolder.name} leads with ${topHolder.patentData.totalPatents.toLocaleString()} patents`);
    }

    return parts.join('. ') + '.';
}

// ============ Caching Functions ============

async function getCachedData(type, key) {
    try {
        const db = admin.firestore();
        const cacheKey = `${type}_${key.toLowerCase().replace(/\s+/g, '_')}`;
        const doc = await db.collection('cache_uspto').doc(cacheKey).get();

        if (doc.exists) {
            const data = doc.data();
            const cacheAge = Date.now() - data.cachedAt.toMillis();
            if (cacheAge < CACHE_DURATION_MS) {
                return data.data;
            }
        }
        return null;
    } catch (error) {
        console.error('Cache read error:', error);
        return null;
    }
}

async function cacheData(type, key, data) {
    try {
        const db = admin.firestore();
        const cacheKey = `${type}_${key.toLowerCase().replace(/\s+/g, '_')}`;
        await db.collection('cache_uspto').doc(cacheKey).set({
            data,
            cachedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        console.error('Cache write error:', error);
    }
}

module.exports = {
    searchPatentsByCompany,
    getRecentPatents,
    getCompanyPatentStats,
    enrichCompetitorsWithPatents,
    getIndustryPatentTrends,
    buildPatentIntelligence
};
