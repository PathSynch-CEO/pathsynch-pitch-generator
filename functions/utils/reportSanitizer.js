'use strict';

const { stripHedgingSentences, stripInstructionMarkerLines } = require('./bannedLanguage');
const { canonicalReviewMedian } = require('../services/evidencePainPoints');

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
        if (benchmarks && (!benchmarks.avgReviews || benchmarks.avgReviews === 'N/A' || benchmarks.avgReviews === 0 || benchmarks.medianReviews == null)) {
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
                if (!benchmarks.avgReviews || benchmarks.avgReviews === 'N/A' || benchmarks.avgReviews === 0) {
                    benchmarks.avgReviews = computed;
                    console.log('[Sanitizer] Fixed: market avg reviews computed from ' + reviewCounts.length + ' businesses → ' + computed);
                }

                // Addition 2 / N3: backfill the robust MEDIAN via the CANONICAL shared function, over
                // the same deduped leads+competitors population and the same formula the benchmarks,
                // weaknesses, and pain points use — so the fallback can never reintroduce a divergent
                // median. Drives report copy/thresholds and the Median Review Count KPI row.
                const medianComputed = canonicalReviewMedian(leads, competitors);
                if (benchmarks.medianReviews == null) {
                    benchmarks.medianReviews = medianComputed;
                    console.log('[Sanitizer] Fixed: market median reviews computed from leads+competitors → ' + medianComputed);
                }

                // Patch the KPI scorecard row immediately (median-based, matching computeKpiScorecard).
                const kpiScorecard = data.kpiScorecard;
                if (Array.isArray(kpiScorecard)) {
                    kpiScorecard.forEach(function(kpi) {
                        if (kpi && kpi.kpi === 'Median Review Count' && kpi.currentValue === 'N/A') {
                            kpi.currentValue = String(medianComputed);
                            kpi.benchmark = 'Market median: ' + medianComputed;
                            kpi.target = String(Math.round(medianComputed * 1.5)) + ' reviews';
                            console.log('[Sanitizer] Fixed: KPI "Median Review Count" N/A → ' + medianComputed);
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

    // ── CHECK_PROMPT_SCAFFOLDING ──────────────────────────────────────────────
    // Defense-in-depth net for the prompt-scaffolding leak (the "=== INDUSTRY-SPECIFIC
    // INSTRUCTIONS ===" block). The root cause is fixed upstream (the industry label is
    // no longer fused with steering text), but if any generator ever echoes the block
    // again it MUST NOT reach a customer. This check FAILS CLOSED: if the precise strip
    // leaves the marker behind, we hard-strip from the marker to end-of-string and flag
    // the report, rather than warn-and-pass.
    //
    // Precise strip: matches the marker, the free-text prompt-injection paragraph, and the
    // trailing instruction lines ("Use \"X\" instead of \"Y\" throughout." and
    // "Do NOT include these sections: ...."), stopping exactly at the last such line so
    // real content that runs into the block mid-line (no paragraph break) is preserved.
    const SCAFFOLD_RE = /\s*={2,}\s*INDUSTRY-SPECIFIC INSTRUCTIONS\s*={2,}[\s\S]*?(?:\n+(?:Use "[^"]*" instead of "[^"]*" throughout\.|Do NOT include these sections:[^\n]*?\.))+/gi;
    const MARKER_RE = /INDUSTRY-SPECIFIC INSTRUCTIONS/i;
    const HARD_RE = /\s*={2,}\s*INDUSTRY-SPECIFIC INSTRUCTIONS[\s\S]*$/i;

    // Clean one string; returns { value, hardStripped }. Never throws.
    const stripScaffold = function (s) {
        if (typeof s !== 'string' || s.indexOf('INDUSTRY-SPECIFIC INSTRUCTIONS') === -1) {
            return { value: s, hardStripped: false };
        }
        let out = s.replace(SCAFFOLD_RE, '');
        let hardStripped = false;
        if (MARKER_RE.test(out)) {
            // Precise strip failed to remove the marker (unrecognized scaffolding shape).
            // Fail closed: drop everything from the marker onward.
            out = out.replace(HARD_RE, '');
            hardStripped = true;
        }
        return { value: out.trim(), hardStripped };
    };

    // Fields that render customer-facing narrative and are known to have leaked.
    const scaffoldTargets = [
        { name: 'executiveSummary', get: () => data.executiveSummary, set: (v) => { data.executiveSummary = v; } },
        { name: 'competitorAnalysis', get: () => data.data && data.data.competitorAnalysis, set: (v) => { if (data.data) data.data.competitorAnalysis = v; } }
    ];

    try {
        let anyHardStrip = false;
        scaffoldTargets.forEach(function (t) {
            const cur = t.get();
            if (typeof cur !== 'string' || cur.indexOf('INDUSTRY-SPECIFIC INSTRUCTIONS') === -1) return;
            const res = stripScaffold(cur);
            t.set(res.value);
            anyHardStrip = anyHardStrip || res.hardStripped;
            console.log('[Sanitizer] Fixed: stripped prompt scaffolding from ' + t.name +
                (res.hardStripped ? ' (HARD-STRIP — fail-closed, precise strip incomplete)' : ''));
        });
        if (anyHardStrip) {
            data._sanitizerHardStripped = true;
            console.error('[Sanitizer] CHECK_PROMPT_SCAFFOLDING hard-stripped a field — ' +
                'precise strip left the marker behind. Report flagged (_sanitizerHardStripped).');
        }
    } catch (e) {
        // Even on unexpected error, fail closed: guarantee no marker survives in the
        // known fields by hard-stripping from the marker to end-of-string.
        console.error('[Sanitizer] CHECK_PROMPT_SCAFFOLDING error — applying hard fail-closed strip:', e.message);
        try {
            scaffoldTargets.forEach(function (t) {
                const cur = t.get();
                if (typeof cur === 'string' && MARKER_RE.test(cur)) {
                    t.set(cur.replace(HARD_RE, '').trim());
                    data._sanitizerHardStripped = true;
                }
            });
        } catch (_) { /* nothing more we can safely do */ }
    }

    // ── CHECK_PROMPT_INSTRUCTION_MARKERS ──────────────────────────────────────
    // Defense-in-depth for the precision-context leak (2026-08-20 Atlanta Junk Removal report):
    // internal steering text ("PRECISION FILTER: The user is specifically targeting ... Prioritize
    // businesses ...") was fused into the industry label and interpolated verbatim into the
    // zero-lead executive summary. The root cause is fixed upstream (the label is no longer fused),
    // and CHECK_PROMPT_SCAFFOLDING already covers the "=== INDUSTRY-SPECIFIC INSTRUCTIONS ===" block,
    // but NEITHER catches the precision markers. This strips any LINE carrying an instruction marker
    // from the customer-facing narrative fields, preserving the surrounding real narrative. Fails
    // closed and flags the report (_instructionMarkersStripped) when anything was removed.
    try {
        const markerTargets = [
            { name: 'executiveSummary',
              get: () => data.executiveSummary,
              set: (v) => { data.executiveSummary = v; } },
            { name: 'competitorAnalysis',
              get: () => data.data && data.data.competitorAnalysis,
              set: (v) => { if (data.data) data.data.competitorAnalysis = v; } },
            { name: 'strategicMarketThesis.thesis',
              get: () => data.strategicMarketThesis && data.strategicMarketThesis.thesis,
              set: (v) => { if (data.strategicMarketThesis) data.strategicMarketThesis.thesis = v; } }
        ];
        let anyMarkerStripped = false;
        const stripField = function (name, cur, set) {
            if (typeof cur !== 'string') return;
            const res = stripInstructionMarkerLines(cur);
            if (res.stripped) {
                set(res.value);
                anyMarkerStripped = true;
                console.log('[Sanitizer] Fixed: stripped instruction markers from ' + name);
            }
        };
        markerTargets.forEach(function (t) { stripField(t.name, t.get(), t.set); });

        // Other Gemini free-form narrative surfaces now receive precisionContext via profileGuidance
        // (with an "apply silently — do NOT echo" instruction). Models can disobey, so these carry the
        // same leak risk as the summary and are covered too — matching the hedging check's target set
        // plus High-Impact Moves, which was explicitly flagged in review.
        try {
            const si = data.data && data.data.salesIntel;
            if (si) {
                stripField('salesIntel.entryWedge', si.entryWedge, function (v) { si.entryWedge = v; });
                stripField('salesIntel.competitorVulnerability', si.competitorVulnerability, function (v) { si.competitorVulnerability = v; });
                stripField('salesIntel.bestTimeToCall', si.bestTimeToCall, function (v) { si.bestTimeToCall = v; });
                if (Array.isArray(si.talkingPoints)) {
                    si.talkingPoints = si.talkingPoints.map(function (tp) {
                        if (typeof tp !== 'string') return tp;
                        const res = stripInstructionMarkerLines(tp);
                        if (res.stripped) { anyMarkerStripped = true; return res.value; }
                        return tp;
                    });
                }
                if (Array.isArray(si.topPainPoints)) {
                    si.topPainPoints = si.topPainPoints.map(function (pp) {
                        if (typeof pp !== 'string') return pp;
                        const res = stripInstructionMarkerLines(pp);
                        if (res.stripped) { anyMarkerStripped = true; return res.value; }
                        return pp;
                    });
                }
            }
        } catch (e) {
            console.warn('[Sanitizer] CHECK_PROMPT_INSTRUCTION_MARKERS (salesIntel) skipped:', e.message);
        }

        try {
            const him = data.data && data.data.highImpactMoves;
            if (Array.isArray(him)) {
                him.forEach(function (move, i) {
                    if (!move || typeof move !== 'object') return;
                    ['title', 'context', 'action', 'timing', 'expectedOutcome'].forEach(function (field) {
                        stripField('highImpactMoves[' + i + '].' + field, move[field], function (v) { move[field] = v; });
                    });
                });
            }
        } catch (e) {
            console.warn('[Sanitizer] CHECK_PROMPT_INSTRUCTION_MARKERS (highImpactMoves) skipped:', e.message);
        }

        if (anyMarkerStripped) {
            data._instructionMarkersStripped = true;
            console.error('[Sanitizer] CHECK_PROMPT_INSTRUCTION_MARKERS removed internal steering ' +
                'text from customer-facing copy (report flagged _instructionMarkersStripped).');
        }
    } catch (e) {
        console.warn('[Sanitizer] CHECK_PROMPT_INSTRUCTION_MARKERS skipped:', e.message);
    }

    // ── CHECK_HEDGING_LANGUAGE ────────────────────────────────────────────────
    // Banned-language guard (S3 seed). Speculative hedges ("it is highly probable that...")
    // are how unsourced conclusions used to reach the reader. Strip any sentence carrying a
    // banned hedge from the customer-facing narrative fields, fail-closed (drop the sentence
    // rather than leave a hedge). Flags the report (_hedgingScrubbed) when anything was removed.
    // Template-bound sections (evidence pain points) cannot hedge by construction, so this only
    // needs to cover the Gemini-authored narrative surfaces.
    try {
        const hedgeTargets = [
            { get: () => data.executiveSummary, set: (v) => { data.executiveSummary = v; } },
            { get: () => data.strategicMarketThesis && data.strategicMarketThesis.thesis,
              set: (v) => { if (data.strategicMarketThesis) data.strategicMarketThesis.thesis = v; } },
            { get: () => data.data && data.data.competitorAnalysis,
              set: (v) => { if (data.data) data.data.competitorAnalysis = v; } },
            { get: () => data.data && data.data.salesIntel && data.data.salesIntel.entryWedge,
              set: (v) => { if (data.data && data.data.salesIntel) data.data.salesIntel.entryWedge = v; } }
        ];
        let anyStripped = false;
        hedgeTargets.forEach(function (t) {
            const cur = t.get();
            if (typeof cur !== 'string') return;
            const res = stripHedgingSentences(cur);
            if (res.stripped) {
                t.set(res.value);
                anyStripped = true;
                console.log('[Sanitizer] Fixed: stripped hedging language from a narrative field');
            }
        });
        // salesIntel.talkingPoints is an array of strings — scrub each, drop any that were all hedge.
        const tp = data.data && data.data.salesIntel && data.data.salesIntel.talkingPoints;
        if (Array.isArray(tp)) {
            const cleaned = tp
                .map(function (s) { return typeof s === 'string' ? stripHedgingSentences(s) : { value: s, stripped: false }; })
                .filter(function (r) { if (r.stripped) anyStripped = true; return r.value; })
                .map(function (r) { return r.value; });
            data.data.salesIntel.talkingPoints = cleaned;
        }
        if (anyStripped) {
            data._hedgingScrubbed = true;
            console.warn('[Sanitizer] CHECK_HEDGING_LANGUAGE removed banned hedging phrasing (report flagged _hedgingScrubbed).');
        }
    } catch (e) {
        console.warn('[Sanitizer] CHECK_HEDGING_LANGUAGE skipped:', e.message);
    }

    return data;
}

module.exports = { sanitizeReport };
