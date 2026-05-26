'use strict';

/**
 * websiteSignalsProvider.js
 * Analyze competitor website performance and conversion signals via Google PageSpeed Insights.
 * Capped at 3 leads per report to stay within the 20-second orchestrator timeout.
 *
 * CONFIRMED FIELD PATHS (Google PageSpeed Insights API v5 — stable since 2018):
 *   Response root keys: id, lighthouseResult, analysisUTCTimestamp, loadingExperience (may be absent)
 *   Category keys: "performance", "seo", "best-practices"
 *   Category score path: lighthouseResult.categories[key].score  (0.0–1.0, multiply by 100)
 *   Audit path: lighthouseResult.audits[auditKey]
 *     - 'first-contentful-paint'.numericValue  (milliseconds)
 *     - 'largest-contentful-paint'.numericValue (milliseconds)
 *     - 'cumulative-layout-shift'.numericValue  (ratio, 0.0–1.0+)
 *     - 'viewport'.score                        (1 = pass, 0 = fail)
 *     - 'meta-description'.score                (1 = pass, 0 = fail)
 *     - 'structured-data'.score                 (may be absent — treat absent as false)
 *
 * API KEY NOTE:
 *   Uses GOOGLE_PSI_API_KEY if set (recommended — avoids shared-quota limits).
 *   Falls back to keyless calls if not set (PSI free-tier, rate-limited to 25/100s).
 *   To enable: GCP Console → APIs & Services → Library → "PageSpeed Insights API" → Enable.
 *   Then set GOOGLE_PSI_API_KEY in functions/.env.
 *   The existing GOOGLE_PLACES_API_KEY cannot be used directly because that key likely has
 *   API restrictions that exclude pagespeedonline.googleapis.com.
 */

const https = require('https');
const { readVisibilityCache, writeVisibilityCache, normalizeCacheKey } = require('./visibilityCache');

const PSI_BASE      = 'www.googleapis.com';
const PSI_PATH      = '/pagespeedonline/v5/runPagespeed';
const CACHE_TTL_HOURS = 168; // 7 days

// ── HTTP helper ───────────────────────────────────────────────────────────────

function httpsGet(urlStr) {
  return new Promise(function(resolve, reject) {
    const parsed = new URL(urlStr);
    const req = https.request({
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'GET'
    }, function(res) {
      let d = '';
      res.on('data', function(c) { d += c; });
      res.on('end', function() {
        if (res.statusCode >= 400) {
          var errMsg = 'PageSpeed API HTTP ' + res.statusCode;
          try {
            var j = JSON.parse(d);
            if (j.error && j.error.message) errMsg += ': ' + j.error.message.slice(0, 120);
          } catch(e) { /* ignore */ }
          return reject(new Error(errMsg));
        }
        try { resolve(JSON.parse(d)); }
        catch(e) { reject(new Error('JSON parse: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(25000, function() { req.destroy(); reject(new Error('PageSpeed API timeout')); });
    req.end();
  });
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Analyze website performance and conversion signals for qualified leads.
 * @param {Array} qualifiedLeads - already sliced to max 3 by orchestrator
 * @returns {Object} websiteConversionSignals
 */
async function enrichWebsiteSignals(qualifiedLeads) {
  const apiKey = process.env.GOOGLE_PSI_API_KEY || '';

  // Run all PSI calls in parallel (was sequential — 3×25s = 75s > orchestrator timeout)
  const leadSignals = await Promise.all(qualifiedLeads.map(async function(lead) {
    const rawSite = lead.website || lead.url || '';
    const bizName = lead.name || lead.businessName || 'Unknown';

    if (!rawSite) {
      return { businessName: bizName, website: null, status: 'no_website' };
    }

    const website  = rawSite.startsWith('http') ? rawSite : ('https://' + rawSite);
    const cacheKey = 'website_' + normalizeCacheKey(website);
    const cached   = await readVisibilityCache(cacheKey);

    if (cached) {
      return Object.assign({ businessName: bizName, website: website }, cached);
    }

    try {
      const signals = await analyzeWebsite(website, apiKey);
      await writeVisibilityCache(cacheKey, signals, CACHE_TTL_HOURS, 'website_signals');
      return Object.assign({ businessName: bizName, website: website }, signals);
    } catch (err) {
      console.error('[WebsiteSignals] Failed for ' + website + ':', err.message);
      return { businessName: bizName, website: website, status: 'error', error: err.message };
    }
  }));

  return {
    status:        leadSignals.some(function(l) { return l.status === 'complete'; }) ? 'complete' : 'partial',
    leadsAnalyzed: leadSignals.length,
    leadSignals:   leadSignals,
    marketSummary: buildMarketWebsiteSummary(leadSignals),
    enrichedAt:    new Date().toISOString()
  };
}

// ── PageSpeed Insights call ───────────────────────────────────────────────────

async function analyzeWebsite(url, apiKey) {
  var qs = '?url=' + encodeURIComponent(url)
    + '&category=performance&category=seo&category=best-practices'
    + '&strategy=mobile';

  if (apiKey) qs += '&key=' + encodeURIComponent(apiKey);

  const data = await httpsGet('https://' + PSI_BASE + PSI_PATH + qs);
  return extractSignals(url, data);
}

// ── Extract signals from PSI response ────────────────────────────────────────
// All field paths confirmed against PSI v5 API (stable since 2018).

// S6: Helper — extract a boolean pass/fail from a Lighthouse audit entry
function auditPass(auditObj) {
  if (auditObj === undefined || auditObj === null) return null; // not evaluated
  if (auditObj.score === null || auditObj.score === undefined) return null;
  return auditObj.score === 1;
}

// S6: Build the 13-signal Lighthouse audit checklist + compute verdict
function buildLighthouseAudit(url, audits, lcp) {
  const hasHttps = url.startsWith('https');
  const lcpMs    = lcp !== null ? Math.round(lcp) : null;
  const lcpPass  = lcpMs !== null ? lcpMs <= 2500 : null;

  const signals = [
    {
      id:    'https',
      label: 'HTTPS / SSL',
      pass:  hasHttps,
      issue: hasHttps ? null : 'No SSL — browsers warn visitors and search engines penalize non-HTTPS sites'
    },
    {
      id:    'viewport',
      label: 'Mobile viewport',
      pass:  auditPass(audits['viewport']),
      issue: auditPass(audits['viewport']) === false ? 'No mobile viewport meta tag — site does not render correctly on phones' : null
    },
    {
      id:    'lcp',
      label: 'Page speed (LCP)',
      pass:  lcpPass,
      issue: (lcpPass === false && lcpMs !== null) ? ('LCP ' + (lcpMs / 1000).toFixed(1) + 's — exceeds 2.5s threshold for good Core Web Vitals') : null
    },
    {
      id:    'meta-description',
      label: 'Meta description',
      pass:  auditPass(audits['meta-description']),
      issue: auditPass(audits['meta-description']) === false ? 'Missing meta description — reduces click-through rate from search results' : null
    },
    {
      id:    'document-title',
      label: 'Document title',
      pass:  auditPass(audits['document-title']),
      issue: auditPass(audits['document-title']) === false ? 'Missing or empty page title — critical for search indexing' : null
    },
    {
      id:    'is-crawlable',
      label: 'Crawlability',
      pass:  auditPass(audits['is-crawlable']),
      issue: auditPass(audits['is-crawlable']) === false ? 'Page is blocked from crawling — search engines cannot index this site' : null
    },
    {
      id:    'canonical',
      label: 'Canonical URL',
      pass:  auditPass(audits['canonical']),
      issue: auditPass(audits['canonical']) === false ? 'Canonical URL missing or misconfigured — duplicate content risk' : null
    },
    {
      id:    'robots-txt',
      label: 'Robots.txt',
      pass:  auditPass(audits['robots-txt']),
      issue: auditPass(audits['robots-txt']) === false ? 'robots.txt missing or invalid — may allow or block wrong pages' : null
    },
    {
      id:    'image-alt',
      label: 'Image alt text',
      pass:  auditPass(audits['image-alt']),
      issue: auditPass(audits['image-alt']) === false ? 'Images missing alt text — hurts accessibility and image search indexing' : null
    },
    {
      id:    'link-text',
      label: 'Link text quality',
      pass:  auditPass(audits['link-text']),
      issue: auditPass(audits['link-text']) === false ? 'Links use non-descriptive text (e.g. "click here") — weakens SEO context signals' : null
    },
    {
      id:    'tap-targets',
      label: 'Tap targets (mobile)',
      pass:  auditPass(audits['tap-targets']),
      issue: auditPass(audits['tap-targets']) === false ? 'Buttons and links too small for mobile touch — increases bounce rate on phones' : null
    },
    {
      id:    'structured-data',
      label: 'Structured data',
      pass:  (() => {
        var sd = audits['structured-data'];
        if (sd === undefined || sd === null) return null;
        return sd.score !== 0 && sd.score !== null;
      })(),
      issue: (() => {
        var sd = audits['structured-data'];
        if (!sd || sd.score === null) return null;
        return sd.score === 0 ? 'No structured data (schema.org) — site misses rich result opportunities in Google' : null;
      })()
    },
    {
      id:    'errors-in-console',
      label: 'Console errors',
      pass:  auditPass(audits['errors-in-console']),
      issue: auditPass(audits['errors-in-console']) === false ? 'JavaScript errors detected — may break site functionality for visitors' : null
    }
  ];

  // Count passes — only count signals that were actually evaluated (not null)
  const evaluated = signals.filter(function(s) { return s.pass !== null; });
  const passCount = evaluated.filter(function(s) { return s.pass === true; }).length;
  const total     = evaluated.length;

  // Verdict thresholds scale with number of evaluated signals
  var verdict;
  var verdictColor;
  if (total === 0) {
    verdict = 'Insufficient data';
    verdictColor = 'gray';
  } else {
    const ratio = passCount / total;
    if (passCount >= 9 || ratio >= 0.69) {
      verdict = 'Captures demand';
      verdictColor = 'green';
    } else if (passCount >= 6 || ratio >= 0.46) {
      verdict = 'Leaks demand';
      verdictColor = 'yellow';
    } else {
      verdict = 'Not converting local intent';
      verdictColor = 'red';
    }
  }

  return {
    signals:      signals,
    passCount:    passCount,
    failCount:    evaluated.filter(function(s) { return s.pass === false; }).length,
    totalEvaluated: total,
    verdict:      verdict,
    verdictColor: verdictColor
  };
}

function extractSignals(url, data) {
  const lr      = (data && data.lighthouseResult) || {};
  const cats    = lr.categories || {};
  const audits  = lr.audits     || {};

  // Category scores (0.0–1.0 → 0–100)
  const performanceScore   = scoreToInt(cats.performance);
  const seoScore           = scoreToInt(cats.seo);
  const bestPracticesScore = scoreToInt(cats['best-practices']);
  const avgScore           = Math.round((performanceScore + seoScore + bestPracticesScore) / 3);
  const grade              = scoreGrade(avgScore);

  // Core Web Vitals (numericValue in milliseconds; CLS is a ratio)
  const fcp = numericVal(audits['first-contentful-paint']);
  const lcp = numericVal(audits['largest-contentful-paint']);
  const cls = numericVal(audits['cumulative-layout-shift']);

  // Conversion checks (preserved for backward compatibility)
  const hasHttps          = url.startsWith('https');
  const isMobileFriendly  = audits['viewport'] && audits['viewport'].score === 1;
  const hasMetaDesc       = audits['meta-description'] && audits['meta-description'].score === 1;
  const sdAudit           = audits['structured-data'];
  const hasStructuredData = sdAudit !== undefined && sdAudit !== null && sdAudit.score !== 0;

  // Issues list — vertical-agnostic language
  const issues = [];
  if (performanceScore < 50)            issues.push('Slow page load — visitors leave before the site finishes loading');
  if (!isMobileFriendly)                issues.push('Not mobile-optimized — most local searches happen on phones');
  if (!hasHttps)                        issues.push('No SSL certificate — search engines penalize non-HTTPS sites');
  if (!hasMetaDesc)                     issues.push('Missing meta description — reduces click-through rate from search results');
  if (seoScore < 70)                    issues.push('Weak technical SEO — site structure limits search engine indexing');
  if (lcp !== null && lcp > 4000)       issues.push('Largest Contentful Paint over 4 seconds — high bounce rate risk');

  // S6: 13-signal Lighthouse audit checklist + verdict
  const lighthouseAudit = buildLighthouseAudit(url, audits, lcp);

  return {
    status: 'complete',
    grade:  grade,
    scores: {
      performance:   performanceScore,
      seo:           seoScore,
      bestPractices: bestPracticesScore,
      overall:       avgScore
    },
    coreWebVitals: {
      firstContentfulPaint:    fcp !== null ? Math.round(fcp) : null,
      largestContentfulPaint:  lcp !== null ? Math.round(lcp) : null,
      cumulativeLayoutShift:   cls !== null ? parseFloat(cls.toFixed(3)) : null
    },
    conversionChecks: {
      https:           hasHttps,
      mobileFriendly:  isMobileFriendly,
      metaDescription: hasMetaDesc,
      structuredData:  hasStructuredData
    },
    lighthouseAudit: lighthouseAudit,
    issues:     issues,
    issueCount: issues.length
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreToInt(categoryObj) {
  if (!categoryObj || categoryObj.score === null || categoryObj.score === undefined) return 0;
  return Math.round(categoryObj.score * 100);
}

function numericVal(auditObj) {
  if (!auditObj || auditObj.numericValue === undefined || auditObj.numericValue === null) return null;
  return auditObj.numericValue;
}

function scoreGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  if (score >= 30) return 'D';
  return 'F';
}

// ── Market summary ────────────────────────────────────────────────────────────

function buildMarketWebsiteSummary(leadSignals) {
  const complete = leadSignals.filter(function(l) { return l.status === 'complete'; });
  if (complete.length === 0) return null;

  const avgPerformance  = Math.round(complete.reduce(function(s, l) { return s + (l.scores && l.scores.performance || 0); }, 0) / complete.length);
  const avgSeo          = Math.round(complete.reduce(function(s, l) { return s + (l.scores && l.scores.seo || 0); }, 0) / complete.length);
  const mobileFriendly  = complete.filter(function(l) { return l.conversionChecks && l.conversionChecks.mobileFriendly; }).length;
  const mobilePct       = Math.round((mobileFriendly / complete.length) * 100);
  const avgIssues       = parseFloat((complete.reduce(function(s, l) { return s + (l.issueCount || 0); }, 0) / complete.length).toFixed(1));

  return {
    avgPerformanceScore:     avgPerformance,
    avgSeoScore:             avgSeo,
    mobileFriendlyPercentage: mobilePct,
    avgIssuesPerSite:        avgIssues,
    sitesAnalyzed:           complete.length,
    pitchImplication:        generateWebsiteImplication(avgPerformance, avgSeo, mobilePct)
  };
}

// Generic language — no vertical-specific terms
function generateWebsiteImplication(perf, seo, mobile) {
  if (perf < 50 && seo < 70) {
    return 'Most competitor websites in this market have significant performance and SEO issues. A well-optimized site will stand out immediately in search results.';
  }
  if (perf < 50) {
    return 'Page speed is a major issue across this market. Faster-loading sites capture more visitors from local search — most users abandon sites that take over 3 seconds to load.';
  }
  if (seo < 70) {
    return 'Technical SEO is weak across this market. Proper site structure and meta optimization will yield disproportionate ranking advantage.';
  }
  if (mobile < 80) {
    return 'Several competitors lack mobile optimization. Mobile-first sites have a clear edge — over 60% of local searches happen on phones.';
  }
  return 'Competitor websites are generally well-maintained. Differentiation will come from content quality, review volume, and conversion optimization.';
}

module.exports = { enrichWebsiteSignals };
