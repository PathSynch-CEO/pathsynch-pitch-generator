/**
 * DataForSEO API Client
 *
 * Provides Google reviews, SERP local pack rankings, and on-page audits.
 * Env: DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD (required)
 */

const DATAFORSEO_LOGIN = process.env.DATAFORSEO_LOGIN;
const DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD;
const BASE_URL = 'https://api.dataforseo.com/v3';

function getAuthHeader() {
    const credentials = Buffer.from(
        `${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`
    ).toString('base64');
    return `Basic ${credentials}`;
}

async function dataForSEORequest(endpoint, payload) {
    if (!DATAFORSEO_LOGIN || !DATAFORSEO_PASSWORD) {
        console.warn('[DataForSEO] Credentials not configured — skipping');
        return null;
    }

    try {
        const resp = await fetch(`${BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: {
                'Authorization': getAuthHeader(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!resp.ok) {
            console.warn('[DataForSEO] HTTP error:', resp.status, endpoint);
            return null;
        }

        const data = await resp.json();

        if (data.status_code !== 20000) {
            console.warn('[DataForSEO] API error:', data.status_message, endpoint);
            return null;
        }

        return data;
    } catch (e) {
        console.warn('[DataForSEO] Request failed:', e.message, endpoint);
        return null;
    }
}

/**
 * Get Google reviews for a business
 */
async function getGoogleReviews(businessName, city, limit = 20) {
    try {
        const data = await dataForSEORequest(
            '/business_data/google/reviews/live/advanced',
            [{
                keyword: `${businessName} ${city}`,
                location_name: `${city},United States`,
                language_name: 'English',
                depth: limit,
                sort_by: 'newest'
            }]
        );

        const result = data?.tasks?.[0]?.result?.[0];
        if (!result) return null;

        return {
            rating: result.rating?.value,
            reviewCount: result.rating?.votes_count,
            reviews: (result.items || []).slice(0, limit).map(r => ({
                text: r.review_text,
                rating: r.rating?.value,
                date: r.timestamp,
                authorName: r.author_title,
                ownerResponse: r.owner_answer || null
            }))
        };
    } catch (e) {
        console.warn('[DataForSEO] Reviews failed:', e.message);
        return null;
    }
}

/**
 * Get SERP local pack rankings
 */
async function getLocalSERPRankings(keyword, city, state) {
    try {
        const data = await dataForSEORequest(
            '/serp/google/local_pack/live/advanced',
            [{
                keyword: `${keyword} ${city} ${state}`,
                location_name: `${city},${state},United States`,
                language_name: 'English',
                device: 'desktop'
            }]
        );

        const items = data?.tasks?.[0]?.result?.[0]?.items || [];

        return items
            .filter(i => i.type === 'local_pack')
            .map((item, idx) => ({
                rank: idx + 1,
                name: item.title,
                rating: item.rating?.value,
                reviewCount: item.rating?.votes_count,
                address: item.address,
                phone: item.phone,
                website: item.url
            }));
    } catch (e) {
        console.warn('[DataForSEO] SERP failed:', e.message);
        return null;
    }
}

/**
 * Get on-page Lighthouse audit for a website
 */
async function getOnPageAudit(websiteUrl) {
    try {
        if (!websiteUrl || !websiteUrl.startsWith('http')) {
            return null;
        }

        const data = await dataForSEORequest(
            '/on_page/lighthouse/live/json',
            [{
                url: websiteUrl,
                for_mobile: false
            }]
        );

        const audit = data?.tasks?.[0]?.result?.[0];
        if (!audit) return null;

        const cats = audit.categories || {};
        const audits = audit.audits || {};

        return {
            performanceScore: Math.round((cats.performance?.score || 0) * 100),
            seoScore: Math.round((cats.seo?.score || 0) * 100),
            accessibilityScore: Math.round((cats.accessibility?.score || 0) * 100),
            bestPracticesScore: Math.round((cats['best-practices']?.score || 0) * 100),
            hasViewport: !audits.viewport?.score ? false : audits.viewport.score === 1,
            hasMobileOptimization: (cats.performance?.score || 0) > 0.5,
            loadTime: audits['speed-index']?.displayValue || null,
            topIssues: Object.values(audits)
                .filter(a => a.score !== null && a.score < 0.5)
                .slice(0, 5)
                .map(a => a.title)
        };
    } catch (e) {
        console.warn('[DataForSEO] OnPage failed:', e.message);
        return null;
    }
}

module.exports = {
    getGoogleReviews,
    getLocalSERPRankings,
    getOnPageAudit
};
