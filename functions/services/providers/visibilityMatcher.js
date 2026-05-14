'use strict';

/**
 * visibilityMatcher.js
 * Robust business matching for SERP results → competitor mapping.
 * Priority: placeId > domain > fuzzy name (token overlap).
 */

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'inc', 'llc', 'ltd', 'corp', 'group', 'center',
  'services', 'solutions', 'company', 'associates', 'partners'
]);

/**
 * Match a SERP result to a known competitor/lead.
 *
 * @param {Object} serpItem - { title, place_id, domain, address }
 * @param {Array}  knownBusinesses - competitors[] or qualifiedLeads[] from report
 * @returns {{ business, matchType, confidence }|null}
 */
function matchSerpToCompetitor(serpItem, knownBusinesses) {
  if (!knownBusinesses || knownBusinesses.length === 0) return null;

  // 1. PlaceId match (strongest)
  if (serpItem.place_id) {
    const m = knownBusinesses.find(function(b) {
      return (b.placeId || b.place_id) === serpItem.place_id;
    });
    if (m) return { business: m, matchType: 'placeId', confidence: 'high' };
  }

  // 2. Domain match
  if (serpItem.domain) {
    const serpDomain = normalizeDomain(serpItem.domain);
    const m = knownBusinesses.find(function(b) {
      const bDomain = normalizeDomain(b.website || b.url || '');
      return bDomain && serpDomain && (bDomain === serpDomain || bDomain.includes(serpDomain) || serpDomain.includes(bDomain));
    });
    if (m) return { business: m, matchType: 'domain', confidence: 'high' };
  }

  // 3. Fuzzy name match (token overlap ≥ 0.5)
  if (serpItem.title) {
    const serpTokens = tokenize(serpItem.title);
    let bestMatch = null;
    let bestScore = 0;

    for (var i = 0; i < knownBusinesses.length; i++) {
      const business = knownBusinesses[i];
      const bizName   = business.name || business.businessName || '';
      const bizTokens = tokenize(bizName);

      if (bizTokens.length === 0 || serpTokens.length === 0) continue;

      const overlap = bizTokens.filter(function(t) { return serpTokens.includes(t); }).length;
      const score   = overlap / Math.max(bizTokens.length, 1);

      if (score > bestScore && score >= 0.5) {
        bestScore = score;
        bestMatch = business;
      }
    }

    if (bestMatch) {
      return {
        business:   bestMatch,
        matchType:  'fuzzy_name',
        confidence: bestScore >= 0.8 ? 'high' : 'medium'
      };
    }
  }

  return null;
}

/**
 * Check if a business name appears in an AI-generated text response.
 */
function checkAiMention(responseText, businessName) {
  if (!responseText || !businessName) return false;
  const lower = responseText.toLowerCase();
  const tokens = tokenize(businessName);
  const significant = tokens.filter(function(t) { return t.length > 3; });
  if (significant.length === 0) return lower.includes(businessName.toLowerCase());
  const matched = significant.filter(function(t) { return lower.includes(t); });
  return (matched.length / significant.length) >= 0.5;
}

function normalizeDomain(url) {
  return (url || '')
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
    .trim();
}

function tokenize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(function(t) { return t.length > 2 && !STOP_WORDS.has(t); });
}

module.exports = { matchSerpToCompetitor, checkAiMention, normalizeDomain };
