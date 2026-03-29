/**
 * SEO Landscape Calculator
 * Extracted from market.js — scores competitors on online presence signals
 */

function calculateSEOLandscape(competitors) {
    try {
        const scored = competitors.slice(0, 10).map(c => {
            let score = 0;
            const signals = [];

            // Rating signal (review quality)
            if (c.rating >= 4.5) { score += 25; signals.push('High rating'); }
            else if (c.rating >= 4.0) { score += 15; signals.push('Good rating'); }
            else if (c.rating) { score += 5; }

            // Review count (content velocity)
            if (c.reviewCount >= 500) { score += 25; signals.push('High review volume'); }
            else if (c.reviewCount >= 100) { score += 18; signals.push('Active reviews'); }
            else if (c.reviewCount >= 20) { score += 10; }
            else { signals.push('Low review volume'); }

            // Has website
            if (c.website) { score += 20; signals.push('Has website'); }
            else { signals.push('No website'); }

            // Has phone (GBP completeness proxy)
            if (c.phone) { score += 10; signals.push('GBP complete'); }

            // Has address
            if (c.address) score += 10;

            // Review response proxy (high rating + many reviews = likely responds)
            if (c.rating >= 4.3 && c.reviewCount >= 50) {
                score += 10;
                signals.push('Likely review responder');
            }

            const tier = score >= 70 ? 'strong' : score >= 45 ? 'moderate' : 'weak';

            return {
                name: c.name || null,
                address: c.address || null,
                rating: c.rating || null,
                reviewCount: c.reviewCount || null,
                website: c.website || null,
                phone: c.phone || null,
                seoScore: Math.min(100, score),
                tier,
                signals,
                opportunity: tier === 'weak'
                    ? 'High opportunity — weak online presence'
                    : tier === 'moderate'
                    ? 'Medium opportunity — room to improve'
                    : 'Low opportunity — strong online presence'
            };
        }).sort((a, b) => b.seoScore - a.seoScore);

        const avgSEO = Math.round(scored.reduce((s, c) => s + c.seoScore, 0) / scored.length);
        const strongCount = scored.filter(c => c.tier === 'strong').length;
        const weakCount = scored.filter(c => c.tier === 'weak').length;

        return {
            competitors: scored,
            avgSEOScore: avgSEO,
            strongCount,
            weakCount,
            marketInsight: weakCount > 5
                ? `${weakCount} of ${scored.length} competitors have weak online presence — significant PathSynch opportunity`
                : `${strongCount} strong competitors — focus on differentiating on response time and review quality`
        };
    } catch (e) {
        console.warn('[MarketIntel] SEO landscape failed:', e.message);
        return null;
    }
}

module.exports = { calculateSEOLandscape };
