'use strict';

/**
 * publicDataEnrichmentService.js
 *
 * Tier 1 Public Data Enrichment for Government and Nonprofit Market Intel reports.
 *
 * Providers:
 *  - USAspending.gov — federal award data by location (government reports)
 *  - ProPublica Nonprofit Explorer — 990 financial data (nonprofit reports)
 *  - IRS BMF (seeded Firestore cache) — EIN lookup (nonprofit reports)
 *
 * Rules:
 *  - Feature-flag every provider (process.env.ENABLE_*)
 *  - Wrap everything in try/catch — NEVER throw to caller
 *  - Cache in Firestore publicDataEnrichmentCache (72h TTL)
 *  - NEVER extract or store executive compensation
 *  - Use revenue BANDS in pitch copy (not exact amounts)
 *  - All confidence levels: high / medium / low
 *
 * Waterfall:
 * 1. enrichReport() — routes by reportProfile
 * 2. enrichGovernmentReport() — USAspending
 * 3. enrichNonprofitReport() — ProPublica + optional IRS BMF
 */

const admin = require('firebase-admin');
const axios = require('axios');
const { safeNumber } = require('../utils/numericSafety');

// ─── Caching ─────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

function normalizeForCache(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

async function readCache(cacheKey) {
  try {
    const db = admin.firestore();
    const doc = await db.collection('publicDataEnrichmentCache').doc(cacheKey).get();
    if (!doc.exists) return null;
    const data = doc.data();
    const cachedAt = data.cachedAt && data.cachedAt.toDate ? data.cachedAt.toDate().getTime() : 0;
    if (Date.now() - cachedAt > CACHE_TTL_MS) return null;
    return data.payload || null;
  } catch (e) {
    console.warn('[PublicDataEnrichment] Cache read failed:', e.message);
    return null;
  }
}

async function writeCache(cacheKey, payload) {
  try {
    const db = admin.firestore();
    await db.collection('publicDataEnrichmentCache').doc(cacheKey).set({
      payload,
      cachedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.warn('[PublicDataEnrichment] Cache write failed:', e.message);
  }
}

// ─── Utility Helpers ─────────────────────────────────────────────────────────

function formatCurrency(amount) {
  if (!amount && amount !== 0) return null;
  var n = safeNumber(amount);
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + n.toFixed(0);
}

function formatRevenueband(amount) {
  var n = safeNumber(amount);
  if (n <= 0) return 'under $100K';
  if (n < 100000) return 'under $100K';
  if (n < 500000) return '$100K–$500K';
  if (n < 1000000) return '$500K–$1M';
  if (n < 2500000) return '$1M–$2.5M';
  if (n < 5000000) return '$2.5M–$5M';
  if (n < 10000000) return '$5M–$10M';
  if (n < 25000000) return '$10M–$25M';
  if (n < 50000000) return '$25M–$50M';
  if (n < 100000000) return '$50M–$100M';
  return 'over $100M';
}

var STATE_CODES = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC'
};

function stateNameToCode(input) {
  if (!input) return null;
  var s = input.trim();
  if (s.length === 2) return s.toUpperCase();
  return STATE_CODES[s.toLowerCase()] || null;
}

function stringSimilarity(a, b) {
  if (!a || !b) return 0;
  var s1 = a.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  var s2 = b.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  if (s1 === s2) return 1;
  if (s1.includes(s2) || s2.includes(s1)) return 0.85;
  var words1 = s1.split(/\s+/);
  var words2 = s2.split(/\s+/);
  var common = words1.filter(function(w) { return w.length > 2 && words2.includes(w); });
  var total = Math.max(words1.length, words2.length);
  return total > 0 ? common.length / total : 0;
}

function median(arr) {
  if (!arr || arr.length === 0) return null;
  var sorted = arr.slice().sort(function(a, b) { return a - b; });
  var mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function getCurrentFiscalYear() {
  var now = new Date();
  return now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
}

// ─── NTEE Code → Description ─────────────────────────────────────────────────

var NTEE_CATEGORIES = {
  'A': 'Arts, Culture & Humanities', 'B': 'Education',
  'C': 'Environment', 'D': 'Animal-Related',
  'E': 'Health – General & Rehabilitative', 'F': 'Mental Health & Crisis Intervention',
  'G': 'Diseases, Disorders & Medical Disciplines', 'H': 'Medical Research',
  'I': 'Crime & Legal-Related', 'J': 'Employment',
  'K': 'Food, Agriculture & Nutrition', 'L': 'Housing & Shelter',
  'M': 'Public Safety, Disaster Preparedness & Relief', 'N': 'Recreation & Sports',
  'O': 'Youth Development', 'P': 'Human Services – Multipurpose & Other',
  'Q': 'International, Foreign Affairs & National Security',
  'R': 'Civil Rights, Social Action & Advocacy',
  'S': 'Community Improvement & Capacity Building',
  'T': 'Philanthropy, Voluntarism & Grantmaking Foundations',
  'U': 'Science & Technology', 'V': 'Social Science',
  'W': 'Public & Societal Benefit – Multipurpose & Other',
  'X': 'Religion-Related', 'Y': 'Mutual & Membership Benefit',
  'Z': 'Unknown'
};

function nteeToDescription(nteeCode) {
  if (!nteeCode) return 'Nonprofit Organization';
  var letter = (nteeCode || '').toUpperCase().charAt(0);
  return NTEE_CATEGORIES[letter] || 'Nonprofit Organization';
}

// ─── USAspending Provider ─────────────────────────────────────────────────────

/**
 * fetchUSAspendingByLocation
 * Makes two calls (grants + contracts) to stay within API group constraints.
 * Actual field names confirmed via test script:
 *  'Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency', 'Award Type', 'Start Date', 'Description'
 */
async function fetchUSAspendingByLocation(city, state) {
  if (!process.env.ENABLE_USASPENDING_ENRICHMENT || process.env.ENABLE_USASPENDING_ENRICHMENT !== 'true') {
    return null;
  }

  var stateCode = stateNameToCode(state);
  if (!city || !stateCode) return null;

  var cacheKey = 'usaspending_' + normalizeForCache(city) + '_' + normalizeForCache(stateCode);
  var cached = await readCache(cacheKey);
  if (cached) {
    console.log('[USAspending] Cache hit:', cacheKey);
    return cached;
  }

  var fy = getCurrentFiscalYear();
  var timePeriod = [{ start_date: (fy - 1) + '-10-01', end_date: fy + '-09-30' }];
  var recipientLocations = [{ country: 'USA', state: stateCode, city: city }];
  var baseFields = ['Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency', 'Award Type', 'Start Date', 'Description'];
  var baseReq = { filters: { recipient_locations: recipientLocations, time_period: timePeriod }, fields: baseFields, limit: 10, page: 1, sort: 'Award Amount', order: 'desc' };

  var grants = [];
  var contracts = [];
  var totalGrantsAmt = 0;
  var totalContractsAmt = 0;
  var grantPageMeta = null;
  var contractPageMeta = null;

  try {
    var grantRes = await axios.post('https://api.usaspending.gov/api/v2/search/spending_by_award/', Object.assign({}, baseReq, { filters: Object.assign({}, baseReq.filters, { award_type_codes: ['02', '03', '04', '05'] }) }), { timeout: 15000 });
    grants = grantRes.data.results || [];
    grantPageMeta = grantRes.data.page_metadata || {};
    grants.forEach(function(a) { totalGrantsAmt += safeNumber(a['Award Amount']); });
  } catch (gErr) {
    console.warn('[USAspending] Grants call failed:', gErr.message);
  }

  try {
    var contractRes = await axios.post('https://api.usaspending.gov/api/v2/search/spending_by_award/', Object.assign({}, baseReq, { filters: Object.assign({}, baseReq.filters, { award_type_codes: ['A', 'B', 'C', 'D'] }) }), { timeout: 15000 });
    contracts = contractRes.data.results || [];
    contractPageMeta = contractRes.data.page_metadata || {};
    contracts.forEach(function(a) { totalContractsAmt += safeNumber(a['Award Amount']); });
  } catch (cErr) {
    console.warn('[USAspending] Contracts call failed:', cErr.message);
  }

  if (grants.length === 0 && contracts.length === 0) return null;

  // Aggregate top awarding agencies across both lists
  var agencyMap = {};
  var allAwards = grants.concat(contracts);
  allAwards.forEach(function(a) {
    var ag = a['Awarding Agency'] || 'Unknown';
    if (!agencyMap[ag]) agencyMap[ag] = { agency: ag, awardCount: 0, totalAmount: 0 };
    agencyMap[ag].awardCount++;
    agencyMap[ag].totalAmount += safeNumber(a['Award Amount']);
  });
  var topAgencies = Object.values(agencyMap).sort(function(a, b) { return b.totalAmount - a.totalAmount; }).slice(0, 5).map(function(a) {
    return { agency: a.agency, awardCount: a.awardCount, totalAmount: a.totalAmount, formattedAmount: formatCurrency(a.totalAmount) };
  });

  var recentAwards = allAwards.slice(0, 10).map(function(a) {
    return {
      awardId: a['Award ID'] || null,
      recipientName: a['Recipient Name'] || null,
      awardAmount: safeNumber(a['Award Amount']),
      formattedAmount: formatCurrency(safeNumber(a['Award Amount'])),
      awardingAgency: a['Awarding Agency'] || null,
      awardType: a['Award Type'] || null,
      startDate: a['Start Date'] || null,
      description: a['Description'] || null
    };
  });

  var totalAmt = totalGrantsAmt + totalContractsAmt;
  // Estimate total count from page_metadata if available
  var estimatedGrantTotal = grantPageMeta && grantPageMeta.hasNext ? '10+' : String(grants.length);
  var estimatedContractTotal = contractPageMeta && contractPageMeta.hasNext ? '10+' : String(contracts.length);

  var result = {
    fiscalYear: fy,
    city: city,
    state: stateCode,
    totalAwardsAmount: totalAmt,
    formattedTotalAmount: formatCurrency(totalAmt),
    grantsAmount: totalGrantsAmt,
    contractsAmount: totalContractsAmt,
    grantsCount: grants.length,
    contractsCount: contracts.length,
    awardCount: allAwards.length,
    estimatedGrantTotal: estimatedGrantTotal,
    estimatedContractTotal: estimatedContractTotal,
    topAwardingAgencies: topAgencies,
    recentAwards: recentAwards,
    fetchedAt: new Date().toISOString()
  };

  await writeCache(cacheKey, result);
  return result;
}

// ─── ProPublica Provider ──────────────────────────────────────────────────────

/**
 * searchProPublica
 * Actual field names confirmed via test script:
 *  Search: ein, name, city, state, ntee_code, score
 *  Detail org: ein, name, city, state, ntee_code, asset_amount, income_amount, revenue_amount, ruling_date
 *  Filing (filings_with_data at top level): tax_prd_yr, totrevenue, totfuncexpns, totassetsend, totliabend, totnetassetend, pdf_url, formtype
 *
 * SENSITIVITY: pct_compnsatncurrofcr is present in filings — we NEVER extract or store this.
 */
async function searchProPublica(orgName, state) {
  if (!process.env.ENABLE_PROPUBLICA_NONPROFIT_ENRICHMENT || process.env.ENABLE_PROPUBLICA_NONPROFIT_ENRICHMENT !== 'true') {
    return null;
  }
  if (!orgName) return null;

  var cacheKey = 'propublica_' + normalizeForCache(orgName) + '_' + normalizeForCache(state || '');
  var cached = await readCache(cacheKey);
  if (cached) {
    console.log('[ProPublica] Cache hit:', cacheKey);
    return cached;
  }

  try {
    // Search — state param sometimes causes 500, so search by name + city
    var searchParams = { q: orgName };
    var searchRes = await axios.get('https://projects.propublica.org/nonprofits/api/v2/search.json', { params: searchParams, timeout: 10000 });
    var orgs = searchRes.data.organizations || [];
    if (orgs.length === 0) return null;

    // Filter by state if provided
    var stateCode = stateNameToCode(state);
    var filtered = stateCode ? orgs.filter(function(o) { return (o.state || '').toUpperCase() === stateCode; }) : orgs;
    if (filtered.length === 0) filtered = orgs; // fall back to all results

    // Best match by similarity
    var bestOrg = null;
    var bestScore = 0;
    filtered.forEach(function(o) {
      var sim = stringSimilarity(orgName, o.name || '');
      if (sim > bestScore) { bestScore = sim; bestOrg = o; }
    });
    if (!bestOrg || bestScore < 0.25) return null;

    var ein = bestOrg.ein || bestOrg.strein;
    if (!ein) return null;

    // Detail fetch
    var detailRes = await axios.get('https://projects.propublica.org/nonprofits/api/v2/organizations/' + ein + '.json', { timeout: 10000 });
    var orgDetail = detailRes.data.organization || {};
    var filings = detailRes.data.filings_with_data || [];

    // Log field names on first filing to detect schema changes
    if (filings.length > 0) {
      console.log('[ProPublica] Filing field names (schema check):', Object.keys(filings[0]).join(', '));
    }

    // Latest filing with financial data
    var latestFiling = filings.length > 0 ? filings[0] : null;

    // SENSITIVITY: explicitly exclude compensation fields
    var result = {
      ein: ein,
      name: orgDetail.name || bestOrg.name || null,
      city: orgDetail.city || bestOrg.city || null,
      state: orgDetail.state || bestOrg.state || null,
      nteeCode: orgDetail.ntee_code || bestOrg.ntee_code || null,
      nteeDescription: nteeToDescription(orgDetail.ntee_code || bestOrg.ntee_code),
      rulingDate: orgDetail.ruling_date || null,
      // Financial summary from org detail (rough, use filings for precision)
      assetAmountRough: safeNumber(orgDetail.asset_amount),
      incomeAmountRough: safeNumber(orgDetail.income_amount),
      revenueAmountRough: safeNumber(orgDetail.revenue_amount),
      matchSimilarity: bestScore,
      // Latest 990 filing data (NEVER include pct_compnsatncurrofcr)
      latestFiling: latestFiling ? {
        year: safeNumber(latestFiling.tax_prd_yr),
        // Primary field names as returned by API:
        totalRevenue: safeNumber(latestFiling.totrevenue),
        totalExpenses: safeNumber(latestFiling.totfuncexpns),
        totalAssetsEnd: safeNumber(latestFiling.totassetsend),
        totalLiabEnd: safeNumber(latestFiling.totliabend),
        totalNetAssetsEnd: safeNumber(latestFiling.totnetassetend),
        formType: latestFiling.formtype || null,
        pdfUrl: latestFiling.pdf_url || null
        // INTENTIONALLY OMITTED: pct_compnsatncurrofcr (executive compensation)
      } : null,
      fetchedAt: new Date().toISOString()
    };

    await writeCache(cacheKey, result);
    return result;
  } catch (e) {
    console.warn('[ProPublica] Search failed for', orgName, ':', e.message);
    return null;
  }
}

// ─── IRS BMF Provider ─────────────────────────────────────────────────────────

/**
 * lookupIrsBmf — reads from seeded Firestore irsBmfCache collection
 */
async function lookupIrsBmf(orgName, city, state) {
  if (!process.env.ENABLE_IRS_BMF_ENRICHMENT || process.env.ENABLE_IRS_BMF_ENRICHMENT !== 'true') {
    return null;
  }
  if (!orgName) return null;

  try {
    var db = admin.firestore();
    var normalizedName = normalizeForCache(orgName);
    var stateCode = stateNameToCode(state);

    var query = db.collection('irsBmfCache').where('normalizedName', '==', normalizedName);
    if (stateCode) query = query.where('state', '==', stateCode);
    var snap = await query.limit(5).get();

    if (snap.empty) {
      // Try partial match — search by state only, filter in JS
      var stateQuery = stateCode ? db.collection('irsBmfCache').where('state', '==', stateCode).limit(200) : null;
      if (!stateQuery) return null;
      var stateSnap = await stateQuery.get();
      var best = null;
      var bestSim = 0;
      stateSnap.forEach(function(doc) {
        var d = doc.data();
        var sim = stringSimilarity(orgName, d.name || '');
        if (sim > bestSim) { bestSim = sim; best = d; }
      });
      if (!best || bestSim < 0.5) return null;
      return { source: 'irs_bmf', matchSimilarity: bestSim, ...best };
    }

    // Exact match found
    var bestDoc = null;
    var bestScore = 0;
    snap.forEach(function(doc) {
      var d = doc.data();
      var sim = stringSimilarity(orgName, d.name || '');
      if (sim > bestScore) { bestScore = sim; bestDoc = d; }
    });
    if (!bestDoc) return null;
    return { source: 'irs_bmf', matchSimilarity: bestScore, ...bestDoc };
  } catch (e) {
    console.warn('[IRS BMF] Lookup failed:', e.message);
    return null;
  }
}

// ─── Nonprofit Lead Matching ──────────────────────────────────────────────────

/**
 * matchNonprofitLead — cross-references a single lead against ProPublica + IRS BMF
 */
async function matchNonprofitLead(leadName, city, state, irsBmfEnabled) {
  var ppResult = await searchProPublica(leadName + ' ' + (city || ''), state);
  var bmfResult = irsBmfEnabled ? await lookupIrsBmf(leadName, city, state) : null;

  var confidence = 'low';
  var primaryData = null;

  if (ppResult && bmfResult && ppResult.matchSimilarity >= 0.4) {
    confidence = 'high';
    primaryData = ppResult;
  } else if (ppResult && ppResult.matchSimilarity >= 0.4) {
    confidence = 'medium';
    primaryData = ppResult;
  } else if (bmfResult) {
    confidence = 'low';
    primaryData = null; // BMF only — use for confirmation, not financials
  } else {
    return null;
  }

  var filing = primaryData ? primaryData.latestFiling : null;
  var revenue = filing ? filing.totalRevenue : safeNumber(primaryData && primaryData.revenueAmountRough);
  var expenses = filing ? filing.totalExpenses : 0;
  var netAssets = filing ? filing.totalNetAssetsEnd : safeNumber(primaryData && primaryData.assetAmountRough);

  return {
    businessName: leadName,
    matchedName: primaryData ? primaryData.name : (bmfResult ? bmfResult.name : null),
    ein: primaryData ? primaryData.ein : (bmfResult ? bmfResult.ein : null),
    nteeCode: primaryData ? primaryData.nteeCode : (bmfResult ? bmfResult.nteeCode : null),
    nteeDescription: primaryData ? primaryData.nteeDescription : nteeToDescription(bmfResult ? bmfResult.nteeCode : null),
    revenue: revenue,
    expenses: expenses,
    netAssets: netAssets,
    revenueFormatted: formatCurrency(revenue),
    expensesFormatted: formatCurrency(expenses),
    netAssetsFormatted: formatCurrency(netAssets),
    revenueBand: formatRevenueband(revenue),
    latestFilingYear: filing ? filing.year : null,
    pdfUrl: filing ? filing.pdfUrl : null,
    matchConfidence: confidence,
    matchSimilarity: primaryData ? primaryData.matchSimilarity : (bmfResult ? bmfResult.matchSimilarity : 0),
    pitchImplication: generateNonprofitLeadPitchImplication({ revenue: revenue, nteeDescription: primaryData ? primaryData.nteeDescription : null, revenueBand: formatRevenueband(revenue) }, leadName)
  };
}

// ─── Pitch Implication Generators ────────────────────────────────────────────

function generateGovernmentPitchImplication(fundingData, city, state, subIndustry) {
  if (!fundingData) return null;
  var total = fundingData.totalAwardsAmount || 0;
  var band = formatCurrency(total);
  var topAgency = (fundingData.topAwardingAgencies || [])[0];
  var agencyName = topAgency ? topAgency.agency : 'federal agencies';
  var cityStr = city || state || 'this area';
  if (total >= 1e9) {
    return cityStr + ' receives significant federal funding from ' + agencyName + ' (' + band + ' in FY' + fundingData.fiscalYear + '). Digital modernization and citizen engagement tools are well-aligned with compliance and reporting requirements for organizations at this funding scale.';
  } else if (total >= 1e6) {
    return cityStr + ' receives federal funding from ' + agencyName + ' (' + band + ' in FY' + fundingData.fiscalYear + '). Grant-funded agencies have reporting and communication requirements that digital tools help address efficiently.';
  } else {
    return cityStr + ' public sector entities receive federal grants and contracts. Digital presence and citizen communication improvements support compliance and community engagement goals.';
  }
}

function generateNonprofitLeadPitchImplication(match, leadName) {
  if (!match) return null;
  var revBand = match.revenueBand || 'mid-size';
  var ntee = match.nteeDescription || 'Nonprofit';
  var name = leadName || 'This organization';
  return name + ' is a ' + ntee + ' organization with ' + revBand + ' annual revenue. Outreach should emphasize impact visibility, donor/member engagement, and mission communication — not sales-focused language.';
}

// ─── Main Orchestrator ────────────────────────────────────────────────────────

/**
 * enrichGovernmentReport
 */
async function enrichGovernmentReport(reportData, options) {
  var city = (options && options.city) || reportData.location && reportData.location.city || reportData.city || null;
  var state = (options && options.state) || reportData.location && reportData.location.state || reportData.state || null;
  var subIndustry = (options && options.subIndustry) || reportData.subIndustry || null;

  var fundingData = await fetchUSAspendingByLocation(city, state);
  if (!fundingData) return null;

  var pitchImplication = generateGovernmentPitchImplication(fundingData, city, state, subIndustry);

  return {
    publicSectorIntelligence: {
      federalFunding: {
        fiscalYear: fundingData.fiscalYear,
        totalAwardsAmount: fundingData.totalAwardsAmount,
        formattedTotalAmount: fundingData.formattedTotalAmount,
        grantsAmount: fundingData.grantsAmount,
        contractsAmount: fundingData.contractsAmount,
        grantsCount: fundingData.grantsCount,
        contractsCount: fundingData.contractsCount,
        awardCount: fundingData.awardCount,
        topAwardingAgencies: fundingData.topAwardingAgencies || [],
        recentAwards: (fundingData.recentAwards || []).slice(0, 5)
      },
      pitchImplication: pitchImplication,
      confidence: 'medium',
      source: 'USAspending.gov',
      enrichedAt: new Date().toISOString()
    }
  };
}

/**
 * enrichNonprofitReport
 */
async function enrichNonprofitReport(reportData, options) {
  var qualifiedLeads = (options && options.qualifiedLeads) || reportData.qualifiedLeads || (reportData.data && reportData.data.leads) || [];
  var city = (options && options.city) || (reportData.location && reportData.location.city) || reportData.city || null;
  var state = (options && options.state) || (reportData.location && reportData.location.state) || reportData.state || null;
  var irsBmfEnabled = process.env.ENABLE_IRS_BMF_ENRICHMENT === 'true';

  if (!qualifiedLeads || qualifiedLeads.length === 0) return null;

  // Match top 10 leads (to avoid rate limiting)
  var leadsToMatch = qualifiedLeads.slice(0, 10);
  var matchPromises = leadsToMatch.map(function(lead) {
    var leadName = lead.name || lead.businessName || '';
    if (!leadName) return Promise.resolve(null);
    return matchNonprofitLead(leadName, city, state, irsBmfEnabled).catch(function(e) {
      console.warn('[NonprofitEnrichment] Lead match failed for', leadName, ':', e.message);
      return null;
    });
  });

  var matches = await Promise.all(matchPromises);
  var validMatches = matches.filter(function(m) { return m !== null; });

  if (validMatches.length === 0) return null;

  // Aggregate summary stats
  var revenues = validMatches.map(function(m) { return m.revenue; }).filter(function(r) { return r > 0; });
  var netAssets = validMatches.map(function(m) { return m.netAssets; }).filter(function(r) { return r > 0; });
  var medianRevenue = median(revenues);
  var medianNetAssets = median(netAssets);

  return {
    nonprofitFinancialIntelligence: {
      marketSummary: {
        matchedLeadCount: validMatches.length,
        totalLeadsAnalyzed: leadsToMatch.length,
        medianRevenue: medianRevenue,
        medianRevenueBand: formatRevenueband(medianRevenue),
        medianRevenueFormatted: formatCurrency(medianRevenue),
        medianNetAssets: medianNetAssets,
        medianNetAssetsFormatted: formatCurrency(medianNetAssets)
      },
      leadMatches: validMatches,
      source: 'ProPublica Nonprofit Explorer' + (irsBmfEnabled ? ' + IRS BMF' : ''),
      enrichedAt: new Date().toISOString()
    }
  };
}

/**
 * enrichReport — main orchestrator, routes by reportProfile
 */
async function enrichReport(reportData, industryConfig, options) {
  try {
    var reportProfile = (reportData && reportData.reportProfile) || (industryConfig && industryConfig.reportProfile) || 'default_local_business';

    if (reportProfile === 'government_public_sector') {
      return await enrichGovernmentReport(reportData, options);
    }

    if (reportProfile === 'nonprofit_association') {
      return await enrichNonprofitReport(reportData, options);
    }

    // All other profiles — no enrichment
    return null;
  } catch (e) {
    console.error('[PublicDataEnrichment] enrichReport error:', e.message);
    return null;
  }
}

module.exports = {
  enrichReport,
  enrichGovernmentReport,
  enrichNonprofitReport,
  searchProPublica,
  lookupIrsBmf,
  fetchUSAspendingByLocation,
  stateNameToCode,
  formatCurrency,
  formatRevenueband
};
