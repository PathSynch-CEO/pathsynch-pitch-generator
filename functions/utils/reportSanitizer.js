'use strict';

/**
 * reportSanitizer.js — S0: Credibility Guardrails & Report QA Sanitizer
 *
 * Runs after all enrichment and Gemini calls, before template rendering.
 * Each check is independent — a failure in one check never crashes the report.
 *
 * Execution order matters: CHECK_MARKET_RATING and CHECK_MARKET_AVG run before
 * CHECK_KPI_NA so that KPI rows have fresh benchmark values to draw from.
 *
 * @param {object} data - The full reportData object (mutated in place)
 * @param {Date}   generationDate - Date the report is being generated (defaults to now)
 * @returns {object} The patched data object
 */
function sanitizeReport(data, generationDate) {
    if (!data) return data;
    const genDate = generationDate instanceof Date ? generationDate : new Date();

    // ── CHECK_UNKNOWN_LEADER ──────────────────────────────────────────────────
    // If the market leader name is "Unknown" or missing, patch the executive
    // summary and strategic thesis so the rep isn't embarrassed in a meeting.
    try {
        const benchmarks = (data.data && data.data.benchmarks) ? data.data.benchmarks : {};
        const leaderName = benchmarks.marketLeader;

        if (!leaderName || leaderName === 'Unknown') {
            const REPLACEMENT = 'No clear market leader detected in local search results.';

            if (typeof data.executiveSummary === 'string') {
                const before = data.executiveSummary;
                data.executiveSummary = data.executiveSummary
                    .replace(/\bUnknown\s+(edges? out the field in|leads?|dominates?)[^.]*\./gi, REPLACEMENT)
                    .replace(/\bUnknown\b(?!\s+is\s+not|\s+competitors?)/g, 'the market');
                if (data.executiveSummary !== before) {
                    console.log('[Sanitizer] Fixed: unknown market leader in executive summary');
                }
            }

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

    // ── CHECK_EMPTY_COMPETITORS ───────────────────────────────────────────────
    // If competitors array is empty, set a contextual message so the template
    // shows an explanation instead of a blank table.
    try {
        const competitors = (data.data && data.data.competitors) ? data.data.competitors : [];
        if (competitors.length === 0) {
            const leads = (data.data && data.data.leads) ? data.data.leads : [];
            data.data._emptyCompetitorMessage = leads.length === 0
                ? 'No businesses were identified in this market. Try adjusting the search radius or industry.'
                : 'No direct local competitors were identified in search results. See Qualified Leads below for businesses in this market.';
            console.log('[Sanitizer] Fixed: empty competitors — added explanatory message');
        }
    } catch (e) {
        console.warn('[Sanitizer] CHECK_EMPTY_COMPETITORS skipped:', e.message);
    }

    // ── CHECK_MARKET_RATING ───────────────────────────────────────────────────
    // If benchmarks.avgRating is missing (e.g. 0-competitor CRE market), compute
    // it from the union of qualified leads + competitors. Also patch any Gemini-
    // generated text that contains "undefined★" from when the prompt fired with
    // no market average.
    try {
        // Ensure benchmarks object exists before other checks mutate it
        if (data.data && !data.data.benchmarks) data.data.benchmarks = {};

        const benchmarks = data.data && data.data.benchmarks;
        if (benchmarks && (!benchmarks.avgRating || benchmarks.avgRating === 'N/A')) {
            const leads = (data.data && data.data.leads) ? data.data.leads : [];
            const competitors = (data.data && data.data.competitors) ? data.data.competitors : [];
            const allBiz = [].concat(leads, competitors);
            const ratings = allBiz
                .map(function(b) { return parseFloat(b.rating) || 0; })
                .filter(function(r) { return r > 0; });

            if (ratings.length > 0) {
                const computed = (ratings.reduce(function(s, r) { return s + r; }, 0) / ratings.length).toFixed(2);
                benchmarks.avgRating = computed;
                console.log('[Sanitizer] Fixed: market avg rating computed from ' + ratings.length + ' businesses → ' + computed);

                // Patch Gemini-generated text that says "undefined★ market average"
                const ratingLabel = computed + '\u2605';
                const replaceUndefined = function(str) {
                    return str.replace(/undefined\u2605/g, ratingLabel).replace(/undefined★/g, ratingLabel);
                };
                if (data.data.salesIntel) {
                    if (typeof data.data.salesIntel.entryWedge === 'string' &&
                        data.data.salesIntel.entryWedge.indexOf('undefined') !== -1) {
                        data.data.salesIntel.entryWedge = replaceUndefined(data.data.salesIntel.entryWedge);
                        console.log('[Sanitizer] Fixed: "undefined★" in entryWedge → ' + ratingLabel);
                    }
                    if (Array.isArray(data.data.salesIntel.talkingPoints)) {
                        data.data.salesIntel.talkingPoints = data.data.salesIntel.talkingPoints.map(function(tp) {
                            return typeof tp === 'string' ? replaceUndefined(tp) : tp;
                        });
                    }
                }
                if (typeof data.executiveSummary === 'string') {
                    data.executiveSummary = replaceUndefined(data.executiveSummary);
                }
            }
        }
    } catch (e) {
        console.warn('[Sanitizer] CHECK_MARKET_RATING skipped:', e.message);
    }

    // ── CHECK_MARKET_AVG ──────────────────────────────────────────────────────
    // If benchmarks.avgReviews is missing or 0, compute from leads + competitors.
    // Runs BEFORE CHECK_KPI_NA so the KPI row can be filled from the fresh value.
    try {
        if (data.data && !data.data.benchmarks) data.data.benchmarks = {};

        const benchmarks = data.data && data.data.benchmarks;
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

                // Patch the KPI scorecard row immediately
                const kpiScorecard = data.kpiScorecard;
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

    // ── CHECK_SEO_ZEROES ──────────────────────────────────────────────────────
    // If seoLandscape.avgSEOScore is 0, try to recompute from:
    //   1. lead.seoScore fields (from calculateSEOLandscape on leads)
    //   2. websiteConversionSignals.leadSignals[].scores.performance (PageSpeed)
    // If neither source has data, mark the aggregate row for hiding.
    try {
        const seo = (data.data && data.data.seoLandscape) ? data.data.seoLandscape : null;
        if (seo && (seo.avgSEOScore === 0 || seo.marketAvgScore === 0)) {
            const leads = (data.data && data.data.leads) ? data.data.leads : [];

            // Source 1: lead.seoScore (composite score from calculateSEOLandscape)
            const leadsWithSeoScore = leads.filter(function(l) {
                return l.seoScore && typeof l.seoScore === 'number' && l.seoScore > 0;
            });

            if (leadsWithSeoScore.length > 0) {
                const recomputed = Math.round(
                    leadsWithSeoScore.reduce(function(sum, l) { return sum + l.seoScore; }, 0) / leadsWithSeoScore.length
                );
                if (seo.avgSEOScore === 0) seo.avgSEOScore = recomputed;
                if (seo.marketAvgScore === 0) seo.marketAvgScore = recomputed;
                console.log('[Sanitizer] Fixed: SEO aggregate recomputed from ' + leadsWithSeoScore.length + ' lead seoScore fields → ' + recomputed);
            } else {
                // Source 2: websiteConversionSignals.leadSignals[].scores.performance
                const wcs = data.websiteConversionSignals;
                const wcsSignals = (wcs && Array.isArray(wcs.leadSignals)) ? wcs.leadSignals : [];
                const perfScores = wcsSignals
                    .map(function(l) { return (l.scores && l.scores.performance) || 0; })
                    .filter(function(s) { return s > 0; });

                if (perfScores.length > 0) {
                    const recomputed = Math.round(
                        perfScores.reduce(function(s, v) { return s + v; }, 0) / perfScores.length
                    );
                    if (seo.avgSEOScore === 0) seo.avgSEOScore = recomputed;
                    if (seo.marketAvgScore === 0) seo.marketAvgScore = recomputed;
                    console.log('[Sanitizer] Fixed: SEO aggregate from website signals (' + perfScores.length + ' sites) → ' + recomputed);
                } else {
                    // No data anywhere — hide the aggregate row
                    seo._hideAggregateRow = true;
                    console.log('[Sanitizer] Fixed: SEO aggregate hidden (0 with no source data)');
                }
            }
        }
    } catch (e) {
        console.warn('[Sanitizer] CHECK_SEO_ZEROES skipped:', e.message);
    }

    // ── CHECK_ADS_CONTRADICTION ───────────────────────────────────────────────
    // If adSaturationPct is 0 but paidSignals booleans are true, suppress the
    // conflicting flags — adSaturation is the single source of truth.
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
                    // mapsAds lives on mapPackIntelligence — don't touch here
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

    // ── CHECK_STALE_TIMING ────────────────────────────────────────────────────
    // Replace past-month or past-quarter references in High-Impact Move timing
    // fields with relative strings. Only replaces clearly past references.
    try {
        const MONTHS = [
            'january', 'february', 'march', 'april', 'may', 'june',
            'july', 'august', 'september', 'october', 'november', 'december'
        ];
        const currentMonthIdx = genDate.getMonth(); // 0-based
        const currentQuarter = Math.floor(currentMonthIdx / 3) + 1;

        const highImpactMoves = (data.data && data.data.highImpactMoves) ? data.data.highImpactMoves : [];
        highImpactMoves.forEach(function(move) {
            if (!move || typeof move.timing !== 'string') return;
            const timingLower = move.timing.toLowerCase();

            for (var i = 0; i < MONTHS.length; i++) {
                if (timingLower.indexOf(MONTHS[i]) !== -1) {
                    if (i < currentMonthIdx) {
                        var old = move.timing;
                        move.timing = 'within the next 30 days';
                        console.log('[Sanitizer] Fixed: stale timing "' + old + '" → "within the next 30 days"');
                    }
                    return;
                }
            }

            var qMatch = timingLower.match(/\bq([1-4])\b/);
            if (qMatch) {
                var refQuarter = parseInt(qMatch[1]);
                if (refQuarter < currentQuarter) {
                    var old2 = move.timing;
                    move.timing = 'this quarter';
                    console.log('[Sanitizer] Fixed: stale quarter timing "' + old2 + '" → "this quarter"');
                }
            }
        });
    } catch (e) {
        console.warn('[Sanitizer] CHECK_STALE_TIMING skipped:', e.message);
    }

    // ── CHECK_KPI_NA ──────────────────────────────────────────────────────────
    // Fill KPI rows that still show N/A after the market-avg checks above have
    // populated benchmarks. Runs AFTER CHECK_MARKET_RATING and CHECK_MARKET_AVG.
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

    return data;
}

module.exports = { sanitizeReport };
