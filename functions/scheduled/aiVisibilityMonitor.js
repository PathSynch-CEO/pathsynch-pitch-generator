'use strict';

/**
 * aiVisibilityMonitor.js
 * AIsynch Persistent Monitoring Cron — Phase 1B-1
 *
 * Runs at 3 AM ET daily. Enumerates active AIsynch subscribers, checks
 * tier-based monitoring frequency (daily/weekly/monthly), and runs
 * AI visibility checks for each eligible merchant.
 *
 * Model queries: Gemini + Perplexity run in PARALLEL (not fallback).
 * Results stored per-model in aiVisibilitySnapshots — never merged.
 *
 * SCALING NOTE: Current design handles ~25-30 merchants per run (9-min timeout).
 * When active merchants > 50, migrate to Pub/Sub fan-out:
 *   1. This function becomes the enumerator (publishes one message per merchant)
 *   2. processOneMonitoringRun becomes the Pub/Sub subscriber handler
 *   3. Zero logic changes — only the trigger mechanism changes
 * Pattern reference: pathconnect-442522 GSC sync pipeline
 * (daily-sync-trigger → sync-work-topic → sync-work-subscription)
 *
 * Feature flag: ENABLE_AISYNCH_MONITORING must be 'true' to run.
 * Cost cap:     AISYNCH_DAILY_COST_CAP (default $25) — checked before processing.
 */

var { onSchedule } = require('firebase-functions/v2/scheduler');
var admin = require('firebase-admin');
var {
  queryGeminiGrounded,
  queryPerplexity
} = require('../services/providers/aiVisibilityProvider');

// db is initialized lazily so tests can inject mocks before requiring this module
function getDb() {
  return admin.firestore();
}

// ── Per-run caps (from env vars with defaults) ────────────────────────────────

var DEFAULT_MAX_PROMPTS     = 15;
var DEFAULT_MAX_COMPETITORS = 10;
var DEFAULT_MAX_MODELS      = 3;

// ── PII scrubbing ─────────────────────────────────────────────────────────────

/**
 * Remove PII patterns from response text before storage.
 * @param {string} text
 * @returns {string}
 */
function scrubPii(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    // Email addresses
    .replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '[EMAIL]')
    // US phone numbers (various formats)
    .replace(/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, '[PHONE]')
    // SSN patterns (9 digits with separators)
    .replace(/\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g, '[SSN]')
    // Credit card patterns
    .replace(/\b\d{4}[-.\s]?\d{4}[-.\s]?\d{4}[-.\s]?\d{4}\b/g, '[CARD]');
}

/**
 * PII-scrub and cap a response snippet.
 * @param {string} text
 * @param {number} [maxLength=300]
 * @returns {string}
 */
function prepareSnippet(text, maxLength) {
  maxLength = maxLength || 300;
  if (!text || typeof text !== 'string') return '';
  return scrubPii(text.substring(0, maxLength));
}

// ── Mention detection ─────────────────────────────────────────────────────────

/**
 * Check if any merchant alias appears in the lowercased response text.
 * @param {string} responseText   Already lowercased
 * @param {string[]} aliases
 * @returns {boolean}
 */
function detectMention(responseText, aliases) {
  if (!responseText || !aliases || !aliases.length) return false;
  var lower = responseText.toLowerCase();
  return aliases.some(function(a) { return lower.includes(a.toLowerCase()); });
}

/**
 * Detect which competitor names appear in the lowercased response text.
 * @param {string} responseText
 * @param {string[]} competitorNames
 * @returns {string[]}
 */
function detectCompetitorMentions(responseText, competitorNames) {
  if (!responseText || !competitorNames || !competitorNames.length) return [];
  var lower = responseText.toLowerCase();
  return competitorNames.filter(function(name) {
    return lower.includes(name.toLowerCase());
  });
}

/**
 * Check if a citation URL's domain appears explicitly in the response text.
 * "Explicitly cited" = the domain name appears somewhere in the response prose,
 * not just retrieved as a grounding source.
 *
 * @param {string} url
 * @param {string} responseText  Lowercased
 * @returns {boolean}
 */
function isCitedInText(url, responseText) {
  if (!url || !responseText) return false;
  try {
    var domain = url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
    return responseText.toLowerCase().includes(domain);
  } catch (e) {
    return false;
  }
}

/**
 * Detect approximate list position of the merchant in the response.
 * Returns 1-10 or null if not found in a list context.
 *
 * @param {string} responseText  Lowercased
 * @param {string[]} aliases
 * @returns {number|null}
 */
function detectPosition(responseText, aliases) {
  var lower = responseText.toLowerCase();
  // Look for numbered list patterns: "1. ", "2. ", "#1 ", etc.
  var lines = lower.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    var matchesAlias = aliases.some(function(a) { return line.includes(a.toLowerCase()); });
    if (!matchesAlias) continue;
    var numMatch = line.match(/^(\d+)[.)]\s/);
    if (numMatch) {
      var pos = parseInt(numMatch[1], 10);
      if (pos >= 1 && pos <= 10) return pos;
    }
  }
  return null;
}

// ── Source events builder ─────────────────────────────────────────────────────

/**
 * Build sourceEvents for one prompt + one model.
 * Each source event represents a single citation URL observed during the run.
 *
 * @param {string}   promptId
 * @param {string}   model
 * @param {{ uri: string, title: string }[]} citationUrls  From query response
 * @param {string}   responseText   Full response text
 * @param {boolean}  merchantMentioned
 * @param {string[]} competitorsMentioned
 * @returns {object[]}
 */
function buildSourceEvents(promptId, model, citationUrls, responseText, merchantMentioned, competitorsMentioned) {
  var events = [];
  var urls = citationUrls || [];
  for (var i = 0; i < urls.length; i++) {
    var item = urls[i];
    var url  = (item && (item.uri || item.url)) || '';
    if (!url) continue;

    events.push({
      url:                  url,
      wasRetrieved:         true,
      wasExplicitlyCited:   isCitedInText(url, responseText),
      merchantMentioned:    merchantMentioned,
      competitorsMentioned: competitorsMentioned || [],
      promptId:             promptId,
      model:                model
    });
  }
  return events;
}

// ── API cost estimation ───────────────────────────────────────────────────────

/**
 * Estimate the API cost for one merchant monitoring run.
 * Based on architecture doc Section 5.6.
 *
 * @param {string[]} modelsToQuery
 * @param {number}   promptCount
 * @returns {number}  USD
 */
function computeApiCosts(modelsToQuery, promptCount) {
  var cost = 0;
  // Gemini flash: ~$0.0005 per prompt
  if (modelsToQuery.indexOf('gemini') !== -1)     cost += promptCount * 0.0005;
  // Perplexity Sonar: ~$0.005 per prompt
  if (modelsToQuery.indexOf('perplexity') !== -1) cost += promptCount * 0.005;
  // Claude via Bedrock: ~$0.003 per prompt (Growth/Scale only)
  if (modelsToQuery.indexOf('claude') !== -1)     cost += promptCount * 0.003;
  return parseFloat(cost.toFixed(4));
}

// ── Daily cost tracking ───────────────────────────────────────────────────────

/**
 * Atomically increment today's estimated API cost.
 * Uses FieldValue.increment for safety under concurrent runs.
 */
async function updateDailyCost(db, dateStr, amount) {
  var ref = db.collection('aisynchRunLogs').doc('cost_' + dateStr);
  await ref.set({
    date:               dateStr,
    totalEstimatedCost: admin.firestore.FieldValue.increment(amount),
    updatedAt:          admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

// ── Aggregated results ────────────────────────────────────────────────────────

/**
 * Compute cross-model aggregated visibility metrics.
 * @param {{ [model: string]: { mentionRate: number } }} modelResults
 * @returns {object}
 */
function computeAggregated(modelResults) {
  var models = Object.keys(modelResults || {});
  if (!models.length) return { overallMentionRate: 0, mentioned: false, modelCount: 0 };

  var rates = models.map(function(m) {
    var r = modelResults[m];
    return (r && typeof r.mentionRate === 'number') ? r.mentionRate : 0;
  });

  var sum  = rates.reduce(function(a, b) { return a + b; }, 0);
  var rate = Math.round(sum / rates.length);

  var perModel = {};
  models.forEach(function(m) {
    perModel[m] = { mentionRate: modelResults[m] ? (modelResults[m].mentionRate || 0) : 0 };
  });

  return {
    overallMentionRate: rate,
    mentioned:          rate > 0,
    modelCount:         models.length,
    perModel:           perModel
  };
}

// ── Prompt tracking update ────────────────────────────────────────────────────

/**
 * Update lastRunAt and historicalMentionRate on each active prompt.
 * historicalMentionRate uses an exponential moving average (alpha=0.3)
 * so it stabilises over time without requiring a run counter.
 *
 * @param {object} db
 * @param {string} merchantId
 * @param {{ [promptId: string]: boolean }} promptMentionMap  promptId → mentioned
 */
async function updatePromptTracking(db, merchantId, promptMentionMap) {
  var ref = db.collection('aiVisibilityPrompts').doc(merchantId);
  var snap = await ref.get();
  if (!snap.exists) return;

  var data    = snap.data();
  var prompts = Array.isArray(data.prompts) ? data.prompts : [];
  var now     = new Date().toISOString();

  var updated = prompts.map(function(p) {
    if (!p.active) return p;

    var mentioned = promptMentionMap.hasOwnProperty(p.id)
      ? promptMentionMap[p.id]
      : false;

    var currentValue = mentioned ? 100 : 0;
    var newRate;
    if (p.historicalMentionRate === null || p.historicalMentionRate === undefined) {
      newRate = currentValue;
    } else {
      newRate = Math.round(p.historicalMentionRate * 0.7 + currentValue * 0.3);
    }

    return Object.assign({}, p, {
      lastRunAt:             now,
      lastMentionedAt:       mentioned ? now : (p.lastMentionedAt || null),
      historicalMentionRate: newRate
    });
  });

  await ref.update({ prompts: updated, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
}

// ── AI Readiness score update ─────────────────────────────────────────────────

/**
 * Update the aiVisibility pillar on the merchant's AI Readiness score
 * using the latest snapshot data.
 *
 * @param {object} db
 * @param {string} merchantId
 * @param {object} snapshot
 */
async function updateAiReadinessScore(db, merchantId, snapshot) {
  var ref = db.collection('aiReadinessScores').doc(merchantId);
  var snap = await ref.get();
  if (!snap.exists) return;

  var agg  = snapshot.aggregated || {};
  var rate = agg.overallMentionRate || 0;

  // Pillar update: mentionRate → pillar score (0-100)
  var visibilityScore = Math.min(100, rate);
  var confidence      = snapshot.models && Object.keys(snapshot.models).length >= 2 ? 'medium' : 'low';

  await ref.update({
    'pillars.aiVisibility.score':        visibilityScore,
    'pillars.aiVisibility.mentionRate':  rate,
    'pillars.aiVisibility.confidence':   confidence,
    'pillars.aiVisibility.lastUpdated':  admin.firestore.FieldValue.serverTimestamp(),
    lastMonitoredAt:                     admin.firestore.FieldValue.serverTimestamp()
  });
}

// ── Mention rate trigger ──────────────────────────────────────────────────────

/**
 * Fire a review request trigger when the merchant's mention rate increases
 * by 10+ percentage points vs the previous snapshot.
 * Rate-limited to once per week per merchant.
 */
async function checkMentionRateTrigger(db, merchantId, snapshot) {
  var prevSnaps = await db.collection('aiVisibilitySnapshots')
    .where('merchantId', '==', merchantId)
    .orderBy('snapshotDate', 'desc')
    .limit(2)
    .get();

  if (prevSnaps.size < 2) return;

  var docs = [];
  prevSnaps.forEach(function(d) { docs.push(d.data()); });
  var previous = docs[1];

  var currentRate  = (snapshot.aggregated || {}).overallMentionRate || 0;
  var previousRate = (previous.aggregated || {}).overallMentionRate  || 0;

  if (currentRate - previousRate < 10) return;

  // Throttle — max one trigger per merchant per week
  var lastTrigger = await db.collection('aiVisibilityTriggers')
    .where('merchantId', '==', merchantId)
    .where('type', '==', 'review_request')
    .orderBy('triggeredAt', 'desc')
    .limit(1)
    .get();

  if (!lastTrigger.empty) {
    var lastDate  = lastTrigger.docs[0].data().triggeredAt;
    var lastMs    = lastDate && lastDate.toDate ? lastDate.toDate().getTime() : 0;
    var daysSince = (Date.now() - lastMs) / (1000 * 60 * 60 * 24);
    if (daysSince < 7) return;
  }

  await db.collection('aiVisibilityTriggers').add({
    merchantId:          merchantId,
    type:                'review_request',
    mentionRateChange:   currentRate - previousRate,
    currentRate:         currentRate,
    previousRate:        previousRate,
    message:             'Your business is gaining AI visibility! Help us stay visible by sharing your experience.',
    triggeredAt:         admin.firestore.FieldValue.serverTimestamp(),
    status:              'pending'
  });

  console.log('[AIVisMonitor] Review trigger fired: ' + merchantId + ' ' + previousRate + '% → ' + currentRate + '%');
}

// ── Single-merchant monitoring run ────────────────────────────────────────────

/**
 * Process one merchant's monitoring run.
 *
 * Fully self-contained — accepts a subscription object and does everything.
 *
 * SCALING: When migrating to Pub/Sub fan-out, this function becomes the
 * Pub/Sub subscriber handler with zero logic changes. The subscription object
 * passed here maps 1:1 to the Pub/Sub message payload.
 *
 * @param {object} subscription   Firestore aisynchSubscriptions document data
 * @param {object} [opts]
 * @param {object} [opts.db]      Injected db (for testing)
 */
async function processOneMonitoringRun(subscription, opts) {
  opts = opts || {};
  var db  = opts.db || getDb();
  var startTime = Date.now();

  var merchantId   = subscription.merchantId;
  var tier         = subscription.tier;
  var entitlements = subscription.entitlements || {};

  var maxPrompts     = parseInt(process.env.AISYNCH_MAX_PROMPTS_PER_MERCHANT     || DEFAULT_MAX_PROMPTS,     10);
  var maxCompetitors = parseInt(process.env.AISYNCH_MAX_COMPETITORS_PER_MERCHANT || DEFAULT_MAX_COMPETITORS, 10);
  var maxModels      = parseInt(process.env.AISYNCH_MAX_MODELS_PER_RUN           || DEFAULT_MAX_MODELS,      10);

  var errorCount   = 0;
  var fallbackUsed = false;

  // ── Load prompts ────────────────────────────────────────────────────────────
  var promptsDoc = await db.collection('aiVisibilityPrompts').doc(merchantId).get();
  if (!promptsDoc.exists) {
    console.warn('[AIVisMonitor] No prompts for ' + merchantId + ', skipping');
    return;
  }

  var promptsData = promptsDoc.data();
  var allPrompts  = (promptsData.prompts || []).filter(function(p) { return p.active; });
  var prompts     = allPrompts.slice(0, maxPrompts);

  // Load merchant name aliases for mention detection
  var aliases = (promptsData.merchantNameAliases || [])
    .filter(function(a) { return a.active; })
    .map(function(a)    { return (a.alias || '').toLowerCase(); });

  if (!aliases.length) {
    aliases = [promptsData.merchantId ? '' : '', promptsData.city || ''].filter(Boolean);
  }

  // ── Determine models to query ───────────────────────────────────────────────
  var configuredModels = entitlements.aiModels || ['gemini', 'perplexity'];
  var modelsToQuery    = configuredModels.slice(0, maxModels);

  // ── Load competitor names ───────────────────────────────────────────────────
  var competitorNames = [];
  try {
    var scoreDoc = await db.collection('aiReadinessScores').doc(merchantId).get();
    if (scoreDoc.exists) {
      var competitors = scoreDoc.data().competitors || [];
      competitorNames = competitors.slice(0, maxCompetitors)
        .map(function(c) { return c.name || c.merchantName || ''; })
        .filter(Boolean);
    }
  } catch (compErr) {
    console.warn('[AIVisMonitor] Could not load competitors for ' + merchantId);
  }

  // ── Query AI models in PARALLEL across prompts ──────────────────────────────
  var modelResults  = {};
  var allSourceEvents = [];
  var promptMentionMap = {};  // promptId → boolean (any model mentioned)

  // Build parallel query tasks — all prompts × all models run concurrently
  var queryTasks = [];
  prompts.forEach(function(prompt) {
    modelsToQuery.forEach(function(model) {
      queryTasks.push({ prompt: prompt, model: model });
    });
  });

  // Run all tasks in parallel with Promise.allSettled
  var taskResults = await Promise.allSettled(
    queryTasks.map(function(task) {
      var prompt = task.prompt;
      var model  = task.model;

      if (model === 'gemini') {
        return queryGeminiGrounded(prompt.text, aliases, 'gemini-3-flash-preview')
          .then(function(r) { return { model: model, prompt: prompt, result: r }; });
      } else if (model === 'perplexity') {
        var apiKey = process.env.PERPLEXITY_API_KEY || '';
        return queryPerplexity(prompt.text, aliases, apiKey)
          .then(function(r) { return { model: model, prompt: prompt, result: r }; });
      }
      return Promise.resolve({ model: model, prompt: prompt, result: null });
    })
  );

  // Aggregate results per model
  taskResults.forEach(function(settled) {
    if (settled.status === 'rejected') {
      errorCount++;
      fallbackUsed = true;
      return;
    }

    var taskData = settled.value;
    if (!taskData || !taskData.result) {
      errorCount++;
      return;
    }

    var model    = taskData.model;
    var prompt   = taskData.prompt;
    var result   = taskData.result;

    // Initialize per-model accumulator
    if (!modelResults[model]) {
      modelResults[model] = {
        mentioned:        false,
        mentionRate:      0,
        promptsChecked:   0,
        promptsMentioned: 0,
        citedUrls:        [],
        responseSnippets: []
      };
    }

    var acc = modelResults[model];
    acc.promptsChecked++;

    // Detect merchant mention in the full response text
    var rawText  = result.responseSummary || result.text || '';
    var mentioned = detectMention(rawText, aliases);

    // Also check the mentionedBusinesses array from the provider (aliases passed in)
    if (!mentioned && result.mentionedBusinesses && result.mentionedBusinesses.length > 0) {
      mentioned = true;
    }

    if (mentioned) {
      acc.promptsMentioned++;
      acc.mentioned = true;
      promptMentionMap[prompt.id] = true;
    } else if (!promptMentionMap.hasOwnProperty(prompt.id)) {
      promptMentionMap[prompt.id] = false;
    }

    var position  = mentioned ? detectPosition(rawText, aliases) : null;
    var competitorsMentioned = detectCompetitorMentions(rawText, competitorNames);

    // Snippet: PII-scrubbed, 300-char max
    var snippet = prepareSnippet(rawText);

    acc.responseSnippets.push({
      prompt:    prompt.text,
      promptId:  prompt.id,
      mentioned: mentioned,
      position:  position,
      citedUrls: (result.citationUrls || []).map(function(u) {
        var url = (u && (u.uri || u.url)) || '';
        return {
          url:             url,
          mentionedInText: isCitedInText(url, rawText)
        };
      }),
      snippet:   snippet
    });

    // Collect cited URL strings for the model summary
    (result.citationUrls || []).forEach(function(u) {
      var url = (u && (u.uri || u.url)) || '';
      if (url) acc.citedUrls.push(url);
    });

    // Build source events — one per citation URL per prompt+model
    var events = buildSourceEvents(
      prompt.id, model, result.citationUrls || [],
      rawText, mentioned, competitorsMentioned
    );
    allSourceEvents = allSourceEvents.concat(events);
  });

  // Compute mentionRate per model
  Object.keys(modelResults).forEach(function(model) {
    var acc = modelResults[model];
    if (acc.promptsChecked > 0) {
      acc.mentionRate = Math.round((acc.promptsMentioned / acc.promptsChecked) * 100);
    }
    acc.citedUrls = acc.citedUrls.filter(function(v, i, a) { return a.indexOf(v) === i; });
  });

  // ── Build snapshot ──────────────────────────────────────────────────────────
  var snapshot = {
    merchantId:   merchantId,
    snapshotDate: admin.firestore.FieldValue.serverTimestamp(),
    snapshotType: entitlements.monitoringFrequency || 'daily',
    aisynchTier:  tier,
    schemaVersion: '1.0',
    models:       modelResults,
    aggregated:   computeAggregated(modelResults),
    sourceEvents: allSourceEvents,
    apiCosts:     computeApiCosts(modelsToQuery, prompts.length),
    errorCount:   errorCount,
    fallbackUsed: fallbackUsed,
    runDurationMs: Date.now() - startTime,
    createdAt:    admin.firestore.FieldValue.serverTimestamp()
  };

  await db.collection('aiVisibilitySnapshots').add(snapshot);

  // ── Update prompt tracking ──────────────────────────────────────────────────
  await updatePromptTracking(db, merchantId, promptMentionMap);

  // ── Re-run AI Readiness score with new visibility data ──────────────────────
  try {
    await updateAiReadinessScore(db, merchantId, snapshot);
  } catch (scoreErr) {
    console.warn('[AIVisMonitor] Score update failed for ' + merchantId + ':', scoreErr.message);
  }

  // ── Check mention rate trigger (Growth/Scale) ───────────────────────────────
  if (entitlements.reviewRequestTrigger) {
    try {
      await checkMentionRateTrigger(db, merchantId, snapshot);
    } catch (triggerErr) {
      console.warn('[AIVisMonitor] Trigger check failed for ' + merchantId + ':', triggerErr.message);
    }
  }

  console.log('[AIVisMonitor] ✓ ' + merchantId + ' (' + (Date.now() - startTime) + 'ms)' +
    ' mentionRate=' + (snapshot.aggregated.overallMentionRate) + '%' +
    ' errors=' + errorCount);

  return snapshot;
}

// ── Scheduled function ────────────────────────────────────────────────────────

/**
 * AIsynch Visibility Monitor Cron
 *
 * Runs at 3 AM ET daily. Checks which merchants need monitoring
 * based on their tier's frequency (daily/weekly/monthly).
 *
 * SCALING NOTE: Current design handles ~25-30 merchants per run.
 * When active merchants > 50, migrate to Pub/Sub fan-out:
 *   1. This function becomes the enumerator (publishes messages)
 *   2. processOneMonitoringRun becomes the Pub/Sub subscriber
 *   3. No logic changes — just a different trigger mechanism
 * Pattern reference: pathconnect-442522 GSC sync pipeline
 */
var aiVisibilityMonitorCron = onSchedule({
  schedule:       '0 3 * * *',
  timeZone:       'America/New_York',
  timeoutSeconds: 540,
  memory:         '1GiB',
  maxInstances:   1,
  region:         'us-central1'
}, async function(event) {

  if (process.env.ENABLE_AISYNCH_MONITORING !== 'true') {
    console.log('[AIVisMonitor] Monitoring disabled via feature flag (ENABLE_AISYNCH_MONITORING)');
    return;
  }

  var db = getDb();

  // ── Daily cost cap check ────────────────────────────────────────────────────
  var dailyCostCap  = parseFloat(process.env.AISYNCH_DAILY_COST_CAP || '25');
  var todayDateStr  = new Date().toISOString().split('T')[0];
  var costDocSnap   = await db.collection('aisynchRunLogs').doc('cost_' + todayDateStr).get();
  var todayCost     = costDocSnap.exists ? (costDocSnap.data().totalEstimatedCost || 0) : 0;

  if (todayCost >= dailyCostCap) {
    console.warn('[AIVisMonitor] Daily cost cap reached: $' + todayCost.toFixed(2) +
      ' >= $' + dailyCostCap + '. Skipping run.');
    return;
  }

  // ── Determine which frequencies to run today ────────────────────────────────
  var today       = new Date();
  var dayOfWeek   = today.getDay();   // 0=Sunday
  var dayOfMonth  = today.getDate();  // 1-31

  var frequenciesToRun = ['daily'];
  if (dayOfWeek   === 0) frequenciesToRun.push('weekly');
  if (dayOfMonth  === 1) frequenciesToRun.push('monthly');

  console.log('[AIVisMonitor] Running for: ' + frequenciesToRun.join(', '));

  // ── Enumerate eligible merchants ────────────────────────────────────────────
  var subsSnap = await db.collection('aisynchSubscriptions')
    .where('status', '==', 'active')
    .get();

  var merchants = [];
  subsSnap.forEach(function(doc) {
    var sub       = doc.data();
    var frequency = sub.entitlements && sub.entitlements.monitoringFrequency;
    if (frequenciesToRun.indexOf(frequency) !== -1) {
      merchants.push(sub);
    }
  });

  console.log('[AIVisMonitor] ' + merchants.length + ' merchants to process');

  // ── Process in batches of 5 with 2-second pause between batches ────────────
  var BATCH_SIZE = 5;
  var processed  = 0;
  var failed     = 0;

  for (var i = 0; i < merchants.length; i += BATCH_SIZE) {
    var batch   = merchants.slice(i, i + BATCH_SIZE);
    var results = await Promise.allSettled(
      batch.map(function(merchant) {
        return processOneMonitoringRun(merchant, { db: db });
      })
    );

    results.forEach(function(r) {
      if (r.status === 'fulfilled' && r.value) {
        processed++;
        // Increment daily cost after each merchant run
        var runCost = (r.value.apiCosts || 0);
        updateDailyCost(db, todayDateStr, runCost).catch(function(e) {
          console.warn('[AIVisMonitor] Cost update failed:', e.message);
        });
      } else {
        failed++;
        console.error('[AIVisMonitor] Batch item failed:', r.reason ? r.reason.message : 'unknown');
      }
    });

    // Pause 2s between batches (not after the last one)
    if (i + BATCH_SIZE < merchants.length) {
      await new Promise(function(resolve) { setTimeout(resolve, 2000); });
    }
  }

  console.log('[AIVisMonitor] Complete. Processed: ' + processed + ', Failed: ' + failed);
});

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  aiVisibilityMonitorCron:  aiVisibilityMonitorCron,
  processOneMonitoringRun:  processOneMonitoringRun,

  // Export helpers for unit testing
  scrubPii:               scrubPii,
  prepareSnippet:         prepareSnippet,
  detectMention:          detectMention,
  isCitedInText:          isCitedInText,
  buildSourceEvents:      buildSourceEvents,
  computeApiCosts:        computeApiCosts,
  computeAggregated:      computeAggregated,
  updatePromptTracking:   updatePromptTracking
};
