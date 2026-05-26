'use strict';

/**
 * reportSanitizer.js — S0: Credibility Guardrails & Report QA Sanitizer
 *
 * Runs after all enrichment and Gemini calls, before template rendering.
 * Each check is independent — a failure in one check never crashes the report.
 *
 * @param {object} data - The full reportData object (mutated in place)
 * @param {Date}   generationDate - Date the report is being generated (defaults to now)
 * @returns {object} The patched data object
 */
function sanitizeReport(data, generationDate) {
    if (!data) return data;
    const genDate = generationDate instanceof Date ? generationDate : new Date();

    // CHECK_UNKNOWN_LEADER
    // If the market leader name is "Unknown" or missing, fix the executive summary
    // and strategic thesis so they don't embarrass the rep in a meeting.
    try {
        const benchmarks = (data.data && data.data.benchmarks) ? data.data.benchmarks : {};
        const leaderName = benchmarks.marketLeader;

        if (!leaderName || leaderName === 'Unknown') {
            const REPLACEMENT = 'No clear market leader detected in local search results.';

            // Patch executive summary
            if (typeof data.executiveSummary === 'string') {
                const before = data.executiveSummary;
                // "Unknown edges out the field in X" / "Unknown leads X" / "Unknown dominates X"
                data.executiveSummary = data.executiveSummary
                    .replace(/\bUnknown\s+(edges? out the field in|leads?|dominates?)[^.]*\./gi, REPLACEMENT)
                    .replace(/\bUnknown\b(?!\s+is\s+not|\s+competitors?)/g, 'the market');
                if (data.executiveSummary !== before) {
                    console.log('[Sanitizer] Fixed: unknown market leader in executive summary');
                }
            }

            // Patch strategic thesis
            if (data.strategicMarketThesis && typeof data.strategicMarketThesis.thesis === 'string') {
                const before = data.strategicMarketThesis.thesis;
                data.strategicMarketThesis.thesis = data.strategicMarketThesis.thesis
                    .replace(/\bUnknown\s+(edges? out the field in|leads?|dominates?)[^.]*\./gi, REPLACEMENT)
                    .replace(/\bUnknown\b(?!\s+is\s+not|\s+competitors?)/g, 'the market');
                if (data.strategicMarketThesis.thesis !== before) {
                    console.log('[Sanitizer] Fixed: unknown market leader in strategic thesis');
                }
            }
        }
    } catch (e) {
        console.warn('[Sanitizer] CHECK_UNKNOWN_LEADER skipped:', e.message);
    }

    // CHECK_EMPTY_COMPETITORS
    // If competitors array is empty, add a contextual message so the template
    // shows a meaningful explanation instead of an empty table.
    try {
        const competitors = (data.data && data.data.competitors) ? data.data.competitors : [];
        if (competitors.length === 0) {
            const leads = (data.data && data.data.leads) ? data.data.leads : [];
            if (leads.length === 0) {
                data.data._emptyCompetitorMessage = 'No businesses were identified in this market. Try adjusting the search radius or industry.';
            } else {
                data.data._emptyCompetitorMessage = 'No direct local competitors were identified in search results. See Qualified Leads below for businesses in this market.';
            }
            console.log('[Sanitizer] Fixed: empty competitors — added explanatory message');
        }
    } catch (e) {
        console.warn('[Sanitizer] CHECK_EMPTY_COMPETITORS skipped:', e.message);
    }

    // CHECK_SEO_ZEROES
    // If seoLandscape.avgSEOScore is 0 but leads have individual SEO scores,
    // recompute the aggregate from available data.
    try {
        const seo = (data.data && data.data.seoLandscape) ? data.data.seoLandscape : null;
        if (seo && (seo.avgSEOScore === 0 || seo.marketAvgScore === 0)) {
            const leads = (data.data && data.data.leads) ? data.data.leads : [];
            const leadsWithScores = leads.filter(function(l) {
                return l.seoScore && typeof l.seoScore === 'number' && l.seoScore > 0;
            });

            if (leadsWithScores.length > 0) {
                const recomputed = Math.round(
                    leadsWithScores.reduce(function(sum, l) { return sum + l.seoScore; }, 0) / leadsWithScores.length
                );
                if (seo.avgSEOScore === 0) seo.avgSEOScore = recomputed;
                if (seo.marketAvgScore === 0) seo.marketAvgScore = recomputed;
                console.log('[Sanitizer] Fixed: SEO aggregate recomputed from ' + leadsWithScores.length + ' leads → ' + recomputed);
            } else {
                // No data to recompute from — mark aggregate row for hiding
                seo._hideAggregateRow = true;
                console.log('[Sanitizer] Fixed: SEO aggregate hidden (0 with no source data)');
            }
        }
    } catch (e) {
        console.warn('[Sanitizer] CHECK_SEO_ZEROES skipped:', e.message);
    }

    // CHECK_ADS_CONTRADICTION
    // If adSaturationPct is 0 but paidSignals flags are true, use adSaturation as
    // the single source of truth and suppress the conflicting paid-activity flags.
    try {
        const asi = data.adSpendIntelligence;
        if (asi) {
            const satPct = typeof asi.adSaturationPct === 'number' ? asi.adSaturationPct : parseInt(asi.adSaturation) || 0;
            const paidSignals = asi.paidSignals || {};
            const anyPaidFlagTrue = paidSignals.searchAds || paidSignals.localServicesAds || paidSignals.mapsAds;

            if (satPct === 0 && anyPaidFlagTrue) {
                if (asi.paidSignals) {
                    asi.paidSignals.searchAds = false;
                    asi.paidSignals.localServicesAds = false;
                    // mapsAds is on mapPackIntelligence — don't touch it here
                }
                if (typeof asi.paidActivityDetected !== 'undefined') {
                    asi.paidActivityDetected = false;
                }
                console.log('[Sanitizer] Fixed: ads contradiction — 0 saturation with paid flags, suppressed paid flags');
            }
        }
    } catch (e) {
        console.warn('[Sanitizer] CHECK_ADS_CONTRADICTION skipped:', e.message);
    }

    // CHECK_STALE_TIMING
    // Replace specific past-month or past-quarter references in High-Impact Move timing
    // fields with relative timing strings (e.g. "February" → "within the next 30 days").
    // Only replaces if the month/quarter is clearly in the past relative to generationDate.
    try {
        const MONTHS = [
            'january', 'february', 'march', 'april', 'may', 'june',
            'july', 'august', 'september', 'october', 'november', 'december'
        ];
        // Short forms accepted in timing strings
        const MONTH_SHORTS = [
            'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
        ];
        const currentMonthIdx = genDate.getMonth(); // 0-based
        const currentQuarter = Math.floor(currentMonthIdx / 3) + 1;

        const highImpactMoves = (data.data && data.data.highImpactMoves) ? data.data.highImpactMoves : [];
        highImpactMoves.forEach(function(move) {
            if (!move || typeof move.timing !== 'string') return;
            const timingLower = move.timing.toLowerCase();

            // Check full month names
            for (var i = 0; i < MONTHS.length; i++) {
                if (timingLower.indexOf(MONTHS[i]) !== -1) {
                    // Only replace if the month is clearly in the past (not current or future)
                    if (i < currentMonthIdx) {
                        const old = move.timing;
                        move.timing = 'within the next 30 days';
                        console.log('[Sanitizer] Fixed: stale timing "' + old + '" → "within the next 30 days"');
                    }
                    return; // Found a month reference — stop checking
                }
            }

            // Check Q1/Q2/Q3/Q4 references
            var qMatch = timingLower.match(/\bq([1-4])\b/);
            if (qMatch) {
                var refQuarter = parseInt(qMatch[1]);
                if (refQuarter < currentQuarter) {
                    var old = move.timing;
                    move.timing = 'this quarter';
                    console.log('[Sanitizer] Fixed: stale quarter timing "' + old + '" → "this quarter"');
                }
            }
        });
    } catch (e) {
        console.warn('[Sanitizer] CHECK_STALE_TIMING skipped:', e.message);
    }

    // CHECK_KPI_NA
    // If a KPI row shows N/A but the same metric exists elsewhere in the report data,
    // use the available value. If still unavailable, mark the row for hiding.
    try {
        const kpiScorecard = data.kpiScorecard;
        if (Array.isArray(kpiScorecard) && kpiScorecard.length > 0) {
            const benchmarks = (data.data && data.data.benchmarks) ? data.data.benchmarks : {};
            const seo = (data.data && data.data.seoLandscape) ? data.data.seoLandscape : {};

            kpiScorecard.forEach(function(kpi) {
                if (!kpi || kpi.currentValue !== 'N/A') return;

                if (kpi.kpi === 'Average Rating' && benchmarks.avgRating) {
                    kpi.currentValue = parseFloat(benchmarks.avgRating).toFixed(2) + '\u2605';
                    console.log('[Sanitizer] Fixed: KPI "Average Rating" N/A → ' + kpi.currentValue);

                } else if (kpi.kpi === 'SEO / Digital Authority') {
                    var seoScore = seo.avgSEOScore || seo.marketAvgScore;
                    if (seoScore && seoScore > 0) {
                        kpi.currentValue = Math.round(seoScore) + '/100';
                        console.log('[Sanitizer] Fixed: KPI "SEO / Digital Authority" N/A → ' + kpi.currentValue);
                    } else {
                        kpi._hide = true;
                        console.log('[Sanitizer] Fixed: KPI "SEO / Digital Authority" hidden (no data)');
                    }

                } else if (kpi.kpi === 'Total Competitors' && benchmarks.totalCompetitors != null) {
                    kpi.currentValue = String(benchmarks.totalCompetitors);
                    console.log('[Sanitizer] Fixed: KPI "Total Competitors" N/A → ' + kpi.currentValue);
                }
            });
        }
    } catch (e) {
        console.warn('[Sanitizer] CHECK_KPI_NA skipped:', e.message);
    }

    // CHECK_MARKET_AVG
    // If the market average review count is N/A or 0 in benchmarks but
    // qualified leads + competitors have review data, compute a real average.
    try {
        const benchmarks = (data.data && data.data.benchmarks) ? data.data.benchmarks : null;
        if (benchmarks && (!benchmarks.avgReviews || benchmarks.avgReviews === 'N/A' || benchmarks.avgReviews === 0)) {
            const leads = (data.data && data.data.leads) ? data.data.leads : [];
            const competitors = (data.data && data.data.competitors) ? data.data.competitors : [];
            const allBiz = [].concat(leads, competitors);
            const reviewCounts = allBiz
                .map(function(b) { return parseInt(b.reviewCount) || parseInt(b.reviews) || 0; })
                .filter(function(r) { return r > 0; });

            if (reviewCounts.length > 0) {
                const computed = Math.round(
                    reviewCounts.reduce(function(s, r) { return s + r; }, 0) / reviewCounts.length
                );
                benchmarks.avgReviews = computed;
                console.log('[Sanitizer] Fixed: market avg reviews computed from ' + reviewCounts.length + ' businesses → ' + computed);

                // Also patch the KPI scorecard row if it was set to N/A
                var kpiScorecard = data.kpiScorecard;
                if (Array.isArray(kpiScorecard)) {
                    kpiScorecard.forEach(function(kpi) {
                        if (kpi && kpi.kpi === 'Avg Review Count' && kpi.currentValue === 'N/A') {
                            kpi.currentValue = String(computed);
                            kpi.benchmark = 'Market: ' + computed;
                            kpi.target = String(Math.round(computed * 1.5)) + ' reviews';
                            console.log('[Sanitizer] Fixed: KPI "Avg Review Count" N/A → ' + computed);
                        }
                    });
                }
            }
        }
    } catch (e) {
        console.warn('[Sanitizer] CHECK_MARKET_AVG skipped:', e.message);
    }

    return data;
}

module.exports = { sanitizeReport };
