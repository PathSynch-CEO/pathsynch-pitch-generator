/**
 * Website Scrape Tool
 *
 * Scrapes a prospect's website for their own news, blog posts, press
 * releases, job postings, and announcements. Shared by both News
 * Intelligence Agent and LinkedIn Research Agent.
 */

const axios = require('axios');

/**
 * Extract text content from HTML, removing tags
 */
function stripHtml(html) {
    return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Scrape a website for content
 *
 * @param {Object} params
 * @param {string} params.websiteUrl - Base URL to scrape
 * @param {Array<string>} params.pages - Specific pages to check (default: common paths)
 * @returns {Promise<Object>} Scraped content from each page
 */
async function websiteScrape({ websiteUrl, pages }) {
    const defaultPages = ['/blog', '/news', '/press', '/about', '/careers', '/'];
    const pagesToCheck = pages || defaultPages;

    let baseUrl = websiteUrl.replace(/\/$/, '');
    if (!baseUrl.startsWith('http')) {
        baseUrl = `https://${baseUrl}`;
    }

    console.log(`[WebsiteScrape] Scraping ${baseUrl} (${pagesToCheck.length} pages)`);

    const results = [];

    for (const page of pagesToCheck) {
        try {
            const url = page === '/' ? baseUrl : `${baseUrl}${page}`;

            const response = await axios.get(url, {
                timeout: 8000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                },
                maxRedirects: 3,
                validateStatus: s => s < 400,
            });

            const html = response.data;

            // Extract page title
            const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
            const title = titleMatch ? titleMatch[1].trim() : page;

            // Extract headings (H1, H2)
            const headings = [];
            const hMatches = html.matchAll(/<h[12][^>]*>([^<]+)<\/h[12]>/gi);
            for (const m of hMatches) {
                const text = m[1].replace(/\s+/g, ' ').trim();
                if (text.length > 5 && text.length < 200) {
                    headings.push(text);
                }
            }

            // Extract meta description
            const metaMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)/i);
            const metaDescription = metaMatch ? metaMatch[1] : null;

            // Extract Open Graph description as fallback
            const ogMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)/i);
            const ogDescription = ogMatch ? ogMatch[1] : null;

            // Extract blog/news article titles (look for common patterns)
            const articleTitles = [];
            const articlePatterns = [
                /<(?:h[2-4]|a)[^>]*class="[^"]*(?:post|article|entry|blog|news)[^"]*"[^>]*>([^<]{10,150})<\//gi,
                /<article[^>]*>[\s\S]*?<h[2-3][^>]*>([^<]{10,150})<\/h[2-3]/gi,
                /<a[^>]*href="[^"]*(?:blog|news|press)[^"]*"[^>]*>([^<]{10,100})<\/a>/gi,
            ];

            for (const pattern of articlePatterns) {
                const matches = html.matchAll(pattern);
                for (const m of matches) {
                    const text = stripHtml(m[1]).trim();
                    if (text.length > 10 && text.length < 150 && !articleTitles.includes(text)) {
                        articleTitles.push(text);
                    }
                }
            }

            // Extract dates if visible (for blog/news freshness)
            const dates = [];
            const datePatterns = [
                /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/gi,
                /\d{1,2}\/\d{1,2}\/\d{4}/g,
                /\d{4}-\d{2}-\d{2}/g,
            ];
            for (const pattern of datePatterns) {
                const matches = html.match(pattern);
                if (matches) {
                    dates.push(...matches.slice(0, 5));
                }
            }

            // Extract job postings (careers page)
            const jobTitles = [];
            if (page.includes('career') || page.includes('job')) {
                const jobPatterns = [
                    /<(?:h[2-4]|a|span|div)[^>]*>([^<]*(?:Engineer|Manager|Director|Developer|Designer|Analyst|Coordinator|Specialist|Lead|Head of|VP|Chief)[^<]*)<\//gi,
                ];
                for (const pattern of jobPatterns) {
                    const matches = html.matchAll(pattern);
                    for (const m of matches) {
                        const job = m[1].replace(/\s+/g, ' ').trim();
                        if (job.length > 5 && job.length < 100 && !jobTitles.includes(job)) {
                            jobTitles.push(job);
                        }
                    }
                }
            }

            // Extract company info from about page
            let companyInfo = null;
            if (page.includes('about')) {
                // Look for founding year, employee count, etc.
                const foundedMatch = html.match(/(?:founded|established|since)\s*(?:in\s*)?(\d{4})/i);
                const employeeMatch = html.match(/(\d+(?:,\d+)?)\s*(?:employees|team members|people)/i);

                companyInfo = {
                    foundedYear: foundedMatch ? foundedMatch[1] : null,
                    employeeCount: employeeMatch ? employeeMatch[1].replace(',', '') : null,
                };
            }

            results.push({
                page,
                url: page === '/' ? baseUrl : `${baseUrl}${page}`,
                found: true,
                title,
                metaDescription: metaDescription || ogDescription,
                headings: headings.slice(0, 10),
                articleTitles: articleTitles.slice(0, 10),
                jobTitles: jobTitles.slice(0, 10),
                recentDates: [...new Set(dates)].slice(0, 5),
                companyInfo,
            });

        } catch (error) {
            results.push({
                page,
                url: page === '/' ? baseUrl : `${baseUrl}${page}`,
                found: false,
                error: error.response?.status === 404 ? 'Page not found' : error.message,
            });
        }
    }

    const foundPages = results.filter(r => r.found).length;
    console.log(`[WebsiteScrape] Completed: ${foundPages}/${pagesToCheck.length} pages found`);

    return {
        baseUrl,
        pagesChecked: results,
        summary: {
            pagesFound: foundPages,
            totalPages: pagesToCheck.length,
            hasNews: results.some(r => r.articleTitles?.length > 0),
            hasCareers: results.some(r => r.jobTitles?.length > 0),
        },
    };
}

module.exports = { websiteScrape };
