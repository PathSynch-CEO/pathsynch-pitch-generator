'use strict';

/**
 * Intent Signal Service v1.1
 *
 * Live signals:
 *   - Search Momentum  (DataForSEO Trends + Keywords Everywhere)
 *   - Aggregated Velocity  (calculateVelocityTrend output already on leads)
 *
 * Placeholder cards (v2):
 *   - Competitive Activity
 *   - Hiring Signals
 *
 * Cache TTL : 7 days, shared per vertical+market (intentSignalsCache collection)
 * Credits   : 150 on fresh fetch, 50 on forced refresh, 0 on cache hit
 */

const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { checkAndDeductCredits } = require('../api/billing');

const KE_API_KEY          = process.env.KEYWORDS_EVERYWHERE_API_KEY;
const DATAFORSEO_LOGIN    = process.env.DATAFORSEO_LOGIN;
const DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD;
const CACHE_TTL_DAYS      = 7;

// ─── DataForSEO helper ───────────────────────────────────────────────────────

function dfsAuthHeader() {
    return 'Basic ' + Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64');
}

async function dfsPost(endpoint, payload) {
    if (!DATAFORSEO_LOGIN || !DATAFORSEO_PASSWORD) return null;
    try {
        const resp = await fetch(`https://api.dataforseo.com/v3${endpoint}`, {
            method: 'POST',
            headers: { 'Authorization': dfsAuthHeader(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!resp.ok) {
            console.warn('[IntentSignal] DataForSEO HTTP error:', resp.status, endpoint);
            return null;
        }
        const data = await resp.json();
        if (data.status_code !== 20000) {
            console.warn('[IntentSignal] DataForSEO API error:', data.status_message);
            return null;
        }
        return data;
    } catch (e) {
        console.warn('[IntentSignal] DataForSEO request failed:', e.message);
        return null;
    }
}

// ─── Keywords Everywhere helper ──────────────────────────────────────────────

async function keGetKeywordData(keywords) {
    if (!KE_API_KEY || KE_API_KEY === 'PLACEHOLDER') {
        console.warn('[IntentSignal] Keywords Everywhere key not configured — skipping');
        return null;
    }
    try {
        const params = new URLSearchParams();
        params.append('country', 'us');
        params.append('currency', 'USD');
        params.append('dataSource', 'gkp');
        keywords.forEach(kw => params.append('kw[]', kw));

        const resp = await fetch('https://api.keywordseverywhere.com/v1/get_keyword_data', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${KE_API_KEY}`,
                'Accept': 'application/json'
            },
            body: params
        });
        if (!resp.ok) {
            console.warn('[IntentSignal] Keywords Everywhere HTTP error:', resp.status);
            return null;
        }
        return await resp.json();
    } catch (e) {
        console.warn('[IntentSignal] Keywords Everywhere request failed:', e.message);
        return null;
    }
}

// ─── Keyword set builder ─────────────────────────────────────────────────────

function buildKeywordSet(vertical, market, state) {
    const v  = (vertical || '').toLowerCase().replace(/_/g, ' ');
    const m  = (market   || '');
    const st = (state    || '');
    return [
        `${v} ${m}`,
        `${v} near me`,
        `best ${v} ${m}`,
        `${v} ${m} ${st}`.trim(),
        `affordable ${v} ${m}`,
        `top rated ${v} ${m}`,
        `${v} reviews ${m}`,
        `local ${v} ${m}`,
        `${v} service ${m}`,
        `${v} shop ${m}`
    ].map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 10);
}

// ─── fetchSearchMomentum ─────────────────────────────────────────────────────

async function fetchSearchMomentum(vertical, market, state) {
    const keywords = buildKeywordSet(vertical, market, state);

    const now = new Date();
    const d30 = new Date(now); d30.setDate(now.getDate() - 30);
    const d90 = new Date(now); d90.setDate(now.getDate() - 90);
    const fmt = d => d.toISOString().slice(0, 10);

    // DataForSEO Trends (30d) + DataForSEO Trends (90d) + Keywords Everywhere — parallel
    const [trend30Result, trend90Result, keResult] = await Promise.allSettled([
        dfsPost('/keywords_data/google_trends/explore/live', [{
            keywords:      keywords.slice(0, 5),
            date_from:     fmt(d30),
            date_to:       fmt(now),
            type:          'web_search_interest',
            location_name: 'United States',
            language_name: 'English'
        }]),
        dfsPost('/keywords_data/google_trends/explore/live', [{
            keywords:      keywords.slice(0, 5),
            date_from:     fmt(d90),
            date_to:       fmt(now),
            type:          'web_search_interest',
            location_name: 'United States',
            language_name: 'English'
        }]),
        keGetKeywordData(keywords)   // ONE batch call — all keywords
    ]);

    function parseTrend(settled) {
        if (settled.status !== 'fulfilled' || !settled.value) return null;
        const resultArr = (settled.value?.tasks?.[0]?.result) || [];
        const items     = resultArr.length ? (resultArr[0].items || []) : [];
        if (!items.length) return null;
        let totalAvg    = 0;
        let itemsWithData = 0;
        let dataPoints  = 0;
        const allValues = [];
        const allDates  = [];
        for (const item of items) {
            // DataForSEO Trends explore/live uses 'data', not 'keyword_data'
            const series = item.data || item.keyword_data || [];
            if (!series.length) continue;
            let itemTotal = 0;
            for (const d of series) {
                const v = (d.values && d.values.length)
                    ? (d.values[0].value || d.values[0].extracted_value || 0)
                    : (d.value || 0);
                itemTotal += v;
                dataPoints++;
                allValues.push(v);
                if (d.date_from) allDates.push(d.date_from);
            }
            totalAvg += itemTotal / series.length;
            itemsWithData++;
        }
        if (!dataPoints) return null;
        // Compute daysOfData from the actual date range of time series points
        let daysOfData = 0;
        if (allDates.length >= 2) {
            const sorted = [...allDates].sort();
            daysOfData = Math.round(
                (new Date(sorted[sorted.length - 1]) - new Date(sorted[0])) / (1000 * 60 * 60 * 24)
            );
        }
        return {
            avgInterest: Math.round(totalAvg / Math.max(itemsWithData, 1)),
            dataPoints,
            daysOfData,
            sparklineValues: allValues
        };
    }

    // Log raw DataForSEO response structure (first call only) for debugging
    if (trend30Result.status === 'fulfilled' && trend30Result.value) {
        const result = trend30Result.value;
        console.log('[IntentSignals] DataForSEO raw items:',
            JSON.stringify((result?.tasks?.[0]?.result || []).slice(0, 1)).substring(0, 500));
    }

    const trend30 = parseTrend(trend30Result);
    const trend90 = parseTrend(trend90Result);

    // Parse Keywords Everywhere
    let totalMonthlyVolume = 0;
    let keKeywordsFound    = 0;
    const keData = keResult.status === 'fulfilled' ? keResult.value : null;
    if (keData && Array.isArray(keData.data)) {
        for (const item of keData.data) {
            const vol = item.vol || 0;
            totalMonthlyVolume += vol;
            if (vol > 0) keKeywordsFound++;
        }
    }

    const interest30  = trend30 ? trend30.avgInterest : 0;
    const volumeScore = Math.min(totalMonthlyVolume / 1000, 50);  // 50k+ vol → 50pts
    const trendScore  = Math.min(interest30 * 0.5, 50);           // 100 interest → 50pts
    const score       = Math.min(Math.round(volumeScore + trendScore), 100);
    const daysOfData  = (trend30 && trend30.daysOfData > 0 ? trend30.daysOfData : 0) ||
                        (trend90 && trend90.daysOfData > 0 ? trend90.daysOfData : 0) || 0;

    const rawSparkline = (trend30 && trend30.sparklineValues) ||
                         (trend90 && trend90.sparklineValues) || [];

    return {
        score,
        keywords,
        totalMonthlyVolume,
        keKeywordsFound,
        trend30:       trend30 || null,
        trend90:       trend90 || null,
        momentumRatio: (trend90 && trend90.avgInterest > 0)
            ? Math.round((interest30 / trend90.avgInterest) * 100) / 100
            : null,
        daysOfData,
        sparklineData: rawSparkline.length >= 4 ? rawSparkline : null,
        fetchedAt: new Date().toISOString()
    };
}

// ─── computeAggregatedVelocity ───────────────────────────────────────────────

function computeAggregatedVelocity(reportContext) {
    const leads = (reportContext && reportContext.leads ? reportContext.leads : []).slice(0, 20);

    // on_pace = best current classification → maps to spec weight 1.0 ("accelerating")
    const weights = { on_pace: 1.0, below_pace: 0.3, stalling: 0.1, declining: 0.0 };
    const counts  = { on_pace: 0, below_pace: 0, stalling: 0, declining: 0 };
    let weightedSum = 0;
    let scored      = 0;

    for (const lead of leads) {
        const cls = lead.velocityTrend && lead.velocityTrend.classification;
        if (!cls || !(cls in weights)) continue;
        counts[cls]++;
        weightedSum += weights[cls];
        scored++;
    }

    if (scored === 0) {
        return { score: null, counts, totalLeads: leads.length, scored: 0, hasData: false, daysOfData: 0 };
    }

    const score = Math.min(Math.round((weightedSum / 20) * 100), 100);

    const sampleLead = leads.find(l => l.velocityTrend && l.velocityTrend.daysBetween);
    const daysOfData = sampleLead ? sampleLead.velocityTrend.daysBetween : 0;

    return { score, counts, totalLeads: leads.length, scored, hasData: true, daysOfData };
}

// ─── writeVelocitySnapshot ───────────────────────────────────────────────────

async function writeVelocitySnapshot(vertical, market, state, classifications, velocityScore, reportId, userId) {
    const db    = admin.firestore();
    const today = new Date().toISOString().slice(0, 10);
    try {
        await db.collection('categoryVelocitySnapshots').add({
            vertical:      vertical || '',
            market:        (market || '').toLowerCase(),
            state:         (state  || '').toLowerCase(),
            date:          today,
            reportId:      reportId || null,
            userId:        userId   || null,
            classifications,
            velocityScore: typeof velocityScore === 'number' ? velocityScore : null,
            createdAt:     admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        console.warn('[IntentSignal] writeVelocitySnapshot failed:', e.message);
    }
}

// ─── queryHistoricalVelocity ─────────────────────────────────────────────────

async function queryHistoricalVelocity(vertical, market, state) {
    const db = admin.firestore();
    try {
        const snap = await db.collection('categoryVelocitySnapshots')
            .where('vertical', '==', vertical || '')
            .where('market',   '==', (market || '').toLowerCase())
            .where('state',    '==', (state  || '').toLowerCase())
            .orderBy('createdAt', 'desc')
            .limit(90)
            .get();

        if (snap.empty) return null;

        // Deduplicate: keep latest snapshot per calendar day
        const byDay = new Map();
        snap.docs.forEach(doc => {
            const d = doc.data();
            if (!byDay.has(d.date)) byDay.set(d.date, d);
        });

        const days = Array.from(byDay.values()).sort((a, b) => (a.date > b.date ? -1 : 1));
        if (days.length < 2) return null;

        const latest = days[0];

        function findNearest(targetDays) {
            const target = new Date();
            target.setDate(target.getDate() - targetDays);
            const targetStr = target.toISOString().slice(0, 10);
            return days.reduce(function(best, d) {
                if (!best) return d;
                const dDiff    = Math.abs(d.date.localeCompare(targetStr));
                const bestDiff = Math.abs(best.date.localeCompare(targetStr));
                return dDiff < bestDiff ? d : best;
            }, null);
        }

        const snap30 = findNearest(30);
        const snap60 = findNearest(60);
        const snap90 = findNearest(90);

        function onPaceDelta(current, prior) {
            if (!current || !prior) return null;
            const curr = (current.classifications && current.classifications.on_pace) || 0;
            const prev = (prior.classifications   && prior.classifications.on_pace)   || 0;
            return curr - prev;
        }

        return {
            current:        latest,
            snap30,
            snap60,
            snap90,
            trend30:        onPaceDelta(latest, snap30),
            trend60:        onPaceDelta(latest, snap60),
            trend90:        onPaceDelta(latest, snap90),
            totalSnapshots: days.length
        };
    } catch (e) {
        console.warn('[IntentSignal] queryHistoricalVelocity failed:', e.message);
        return null;
    }
}

// ─── computeIntentScore ──────────────────────────────────────────────────────

function computeIntentScore(searchMomentum, aggregatedVelocity) {
    const searchScore   = (searchMomentum   && searchMomentum.score   != null) ? searchMomentum.score   : 50;
    const velocityScore = (aggregatedVelocity && aggregatedVelocity.score != null) ? aggregatedVelocity.score : 50;

    let score = (searchScore * 0.45) + (velocityScore * 0.55);

    const searchDays    = (searchMomentum   && searchMomentum.daysOfData)   || 0;
    const velocityDays  = (aggregatedVelocity && aggregatedVelocity.daysOfData) || 0;
    const lowConfidence = searchDays < 30 || velocityDays < 30;
    if (lowConfidence) score *= 0.8;

    return {
        score:          Math.min(Math.round(score), 100),
        confidence:     lowConfidence ? 'low' : 'normal',
        searchWeight:   0.45,
        velocityWeight: 0.55
    };
}

// ─── generateActionRecommendations ──────────────────────────────────────────

async function generateActionRecommendations(signals, reportContext) {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
            model: 'gemini-3-flash-preview',
            generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
        });

        const industry       = (reportContext && reportContext.industry) || 'local business';
        const market         = (reportContext && reportContext.market)   || '';
        const intentScore    = (signals.intentScore && signals.intentScore.score)   || 0;
        const velocityScore  = (signals.aggregatedVelocity && signals.aggregatedVelocity.score) || 0;
        const searchScore    = (signals.searchMomentum && signals.searchMomentum.score) || 0;
        const monthlyVol     = (signals.searchMomentum && signals.searchMomentum.totalMonthlyVolume) || 0;
        const onPaceCount    = (signals.aggregatedVelocity && signals.aggregatedVelocity.counts && signals.aggregatedVelocity.counts.on_pace)    || 0;
        const decliningCount = (signals.aggregatedVelocity && signals.aggregatedVelocity.counts && signals.aggregatedVelocity.counts.declining) || 0;
        const trend30str     = (signals.historicalVelocity && signals.historicalVelocity.trend30 != null)
            ? ((signals.historicalVelocity.trend30 >= 0 ? '+' : '') + signals.historicalVelocity.trend30 + ' competitors accelerating')
            : 'no prior data';

        const prompt = `IMPORTANT: Output ONLY a valid JSON object. Start your response with { and end with }. Do not include any explanation or text outside the JSON.

You are a sales intelligence analyst. Generate 3 specific, actionable recommendations for a sales rep selling to ${industry} businesses in ${market}.

Signal data:
- Overall Intent Score: ${intentScore}/100
- Search Momentum: ${searchScore}/100 (${monthlyVol.toLocaleString()} monthly searches)
- Aggregated Velocity: ${velocityScore}/100 (${onPaceCount} competitors on-pace, ${decliningCount} declining)
- 30-day trend: ${trend30str}

Rules:
- actionRecommendations: 3 actions. Each must reference actual numbers from the signal data. Max 25 words each.
- scoreSummary: One sentence summarizing the intent score and key signals for this market. Example: "${market} ${industry} showing moderate search momentum with ${monthlyVol.toLocaleString()} monthly searches — review velocity data building."

Return exactly: {"actionRecommendations":["action 1","action 2","action 3"],"scoreSummary":"one sentence summary"}`;

        const result = await model.generateContent(prompt);
        const text   = result.response.text();
        const start  = text.indexOf('{');
        const end    = text.lastIndexOf('}');
        if (start === -1 || end === -1) return { actions: [], scoreSummary: null };

        const parsed = JSON.parse(text.slice(start, end + 1));
        const actions = Array.isArray(parsed.actionRecommendations)
            ? parsed.actionRecommendations.slice(0, 3)
            : (Array.isArray(parsed.actions) ? parsed.actions.slice(0, 3) : []);
        const scoreSummary = typeof parsed.scoreSummary === 'string' ? parsed.scoreSummary : null;
        return { actions, scoreSummary };
    } catch (e) {
        console.warn('[IntentSignal] generateActionRecommendations failed:', e.message);
        return { actions: [], scoreSummary: null };
    }
}

// ─── Cache helpers ───────────────────────────────────────────────────────────

function cacheDocId(vertical, market, state) {
    const sanitize = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
    return [vertical, market, state].map(sanitize).join('::');
}

async function checkCache(vertical, market, state) {
    const cacheKey = cacheDocId(vertical, market, state);
    try {
        const db  = admin.firestore();
        const doc = await db.collection('intentSignalsCache').doc(cacheKey).get();
        console.log(`[IntentSignals] Cache check: key=${cacheKey}, hit=${!!doc.exists}`);
        if (!doc.exists) return null;
        const data      = doc.data();
        const updatedAt = data.updatedAt && data.updatedAt.toDate ? data.updatedAt.toDate() : null;
        if (!updatedAt) return null;
        const ageDays = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24);
        return ageDays <= CACHE_TTL_DAYS ? data : null;
    } catch (e) {
        console.warn('[IntentSignal] checkCache error:', e.message);
        return null;
    }
}

async function writeToCache(vertical, market, state, signals, sourceReportId) {
    const cacheKey = cacheDocId(vertical, market, state);
    try {
        const db = admin.firestore();
        await db.collection('intentSignalsCache').doc(cacheKey).set({
            vertical:       vertical || '',
            market:         market   || '',
            state:          state    || '',
            sourceReportId: sourceReportId || null,
            signals,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`[IntentSignals] Cache write: key=${cacheKey}`);
    } catch (e) {
        console.warn('[IntentSignal] writeToCache error:', e.message);
    }
}

// deductCredits imported from ../api/billing

// ─── Audit log ───────────────────────────────────────────────────────────────

async function logKeywordsEverywhereCall(merchantId, creditsUsed, keywords) {
    try {
        const db = admin.firestore();
        await db.collection('ke_credit_log').add({
            merchantId:   merchantId || null,
            creditsUsed,
            keywords:     keywords || [],
            keywordCount: (keywords || []).length,
            at:           admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        console.warn('[IntentSignal] ke_credit_log write failed:', e.message);
    }
}

// ─── Core orchestration ──────────────────────────────────────────────────────

async function fetchAndComputeSignals(vertical, market, state, reportId, merchantId, reportContext) {
    const [smResult, hvResult] = await Promise.allSettled([
        fetchSearchMomentum(vertical, market, state),
        queryHistoricalVelocity(vertical, market, state)
    ]);

    const searchMomentum     = smResult.status === 'fulfilled' ? smResult.value : null;
    const historicalVelocity = hvResult.status === 'fulfilled' ? hvResult.value : null;
    const aggregatedVelocity = computeAggregatedVelocity(reportContext);
    const intentScore        = computeIntentScore(searchMomentum, aggregatedVelocity);

    const signals = {
        searchMomentum,
        aggregatedVelocity,
        historicalVelocity,
        intentScore,
        competitiveActivity: { status: 'v2_placeholder', label: 'Competitive Activity', available: false },
        hiringSignals:       { status: 'v2_placeholder', label: 'Hiring Signals',        available: false },
        generatedAt:    new Date().toISOString(),
        sourceReportId: reportId || null
    };

    const recResult = await generateActionRecommendations(signals, {
        industry: vertical,
        market:   market
    });
    signals.actionRecommendations = recResult.actions;
    signals.scoreSummary          = recResult.scoreSummary;

    // Velocity snapshot — append-only, non-blocking
    if (aggregatedVelocity.hasData) {
        writeVelocitySnapshot(
            vertical, market, state,
            aggregatedVelocity.counts,
            aggregatedVelocity.score,
            reportId, merchantId
        ).catch(() => {});
    }

    // KE audit log — non-blocking; 1 KE credit charged per keyword submitted
    if (searchMomentum && searchMomentum.keywords && searchMomentum.keywords.length) {
        logKeywordsEverywhereCall(
            merchantId,
            searchMomentum.keywords.length,
            searchMomentum.keywords
        ).catch(() => {});
    }

    return signals;
}

// ─── Public exports ──────────────────────────────────────────────────────────

/**
 * generateIntentSignals — cache-aware entry point (150 credits on miss, 0 on hit)
 */
async function generateIntentSignals(vertical, market, state, reportId, merchantId, reportContext) {
    const cached = await checkCache(vertical, market, state);
    if (cached) {
        console.log(`[IntentSignal] Cache hit: ${vertical}/${market}/${state} — 0 credits`);
        return Object.assign({}, cached.signals, { fromCache: true });
    }

    // Credit guard BEFORE expensive work
    const creditResult = await checkAndDeductCredits(
        merchantId, 150, 'intent_signals:fresh', { service: 'intent_signals' }
    );
    if (!creditResult.allowed) {
        console.warn(`[IntentSignal] Insufficient credits for ${merchantId}: need 150, have ${creditResult.available}`);
        return {
            fromCache: false,
            creditBlocked: true,
            error: creditResult.error || 'INSUFFICIENT_CREDITS'
        };
    }

    const signals = await fetchAndComputeSignals(vertical, market, state, reportId, merchantId, reportContext);

    writeToCache(vertical, market, state, signals, reportId).catch(() => {});

    console.log(`[IntentSignal] Fresh: ${vertical}/${market}/${state} — 150 credits`);
    return Object.assign({}, signals, { fromCache: false });
}

/**
 * refreshIntentSignals — force-bypass cache (50 credits always)
 */
async function refreshIntentSignals(vertical, market, state, reportId, merchantId, reportContext) {
    // Credit guard BEFORE expensive work
    const creditResult = await checkAndDeductCredits(
        merchantId, 50, 'intent_signals:refresh', { service: 'intent_signals' }
    );
    if (!creditResult.allowed) {
        console.warn(`[IntentSignal] Insufficient credits for refresh ${merchantId}: need 50, have ${creditResult.available}`);
        return {
            fromCache: false,
            creditBlocked: true,
            error: creditResult.error || 'INSUFFICIENT_CREDITS'
        };
    }

    const signals = await fetchAndComputeSignals(vertical, market, state, reportId, merchantId, reportContext);

    writeToCache(vertical, market, state, signals, reportId).catch(() => {});

    console.log(`[IntentSignal] Forced refresh: ${vertical}/${market}/${state} — 50 credits`);
    return Object.assign({}, signals, { fromCache: false });
}

module.exports = { generateIntentSignals, refreshIntentSignals };
