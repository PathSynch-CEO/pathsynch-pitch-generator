const ENTITY360_URL = process.env.ENTITY360_SERVICE_URL;
const ENTITY360_API_KEY = process.env.ENTITY360_INTERNAL_API_KEY;

/**
 * Called after every Market Intelligence Report generation.
 * Non-blocking — SynchIntro continues if Entity360 sync fails.
 */
async function syncReportToAccount360(reportData) {
  if (!ENTITY360_URL) {
    console.warn('[Entity360] ENTITY360_SERVICE_URL not set — skipping sync');
    return null;
  }

  try {
    // Check if Account360 exists for this business
    const authHeaders = {
      'Content-Type': 'application/json',
      ...(ENTITY360_API_KEY ? { 'Authorization': `Bearer ${ENTITY360_API_KEY}` } : {})
    };

    const searchRes = await fetch(
      `${ENTITY360_URL}/entity360/account360/search?businessName=${encodeURIComponent(reportData.businessName)}&zip=${reportData.zip}`,
      { headers: authHeaders }
    );
    const searchData = await searchRes.json();

    if (searchData.found) {
      // Update existing Account360
      const res = await fetch(
        `${ENTITY360_URL}/entity360/account360/${searchData.accountId}/sync/synchintro`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify(buildSyncPayload(reportData))
        }
      );
      const data = await res.json();
      return { accountId: searchData.accountId, action: 'updated', ...data };
    } else {
      // Create new Account360
      const res = await fetch(
        `${ENTITY360_URL}/entity360/account360`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            businessName: reportData.businessName,
            city: reportData.city,
            state: reportData.state,
            zip: reportData.zip,
            vertical: reportData.vertical,
            gbpUrl: reportData.gbpUrl,
            sourceType: 'synchintro_report',
            initialIntelligence: buildSyncPayload(reportData)
          })
        }
      );
      const data = await res.json();
      return { accountId: data.accountId, action: 'created', ...data };
    }
  } catch (err) {
    // Non-blocking — SynchIntro continues if Entity360 sync fails
    console.error('[Entity360] Report sync failed:', err.message);
    return null;
  }
}

/**
 * Called after Attio or Instantly push.
 * Non-blocking — fire and forget.
 */
async function syncOutboundStatus(accountId, updateType, payload) {
  if (!ENTITY360_URL || !accountId) return;
  try {
    await fetch(
      `${ENTITY360_URL}/entity360/account360/${accountId}/sync/outbound`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(ENTITY360_API_KEY ? { 'Authorization': `Bearer ${ENTITY360_API_KEY}` } : {})
        },
        body: JSON.stringify({ updateType, ...payload })
      }
    );
  } catch (err) {
    console.error('[Entity360] Outbound sync failed:', err.message);
  }
}

function buildSyncPayload(reportData) {
  return {
    taxonomyMetadata: {
      taxonomyVersion: reportData.taxonomyVersion || null,
      industryId: reportData.industryId || null,
      industryLabel: reportData.industryLabel || reportData.vertical || null,
      subIndustryId: reportData.subIndustryId || null,
      subIndustryLabel: reportData.subIndustryLabel || null,
      scoringProfile: reportData.scoringProfile || 'default_local_business',
      reportProfile: reportData.reportProfile || 'default_local_business',
      searchQueryUsed: reportData.searchQueryUsed || null,
      benchmarkKey: reportData.benchmarkKey || null,
      reportProfileLanguage: {
        competitorLanguage: reportData.reportProfileLanguage?.competitorLanguage || 'competitors',
        opportunityLanguage: reportData.reportProfileLanguage?.opportunityLanguage || 'opportunity gap'
      }
    },
    reportId: reportData.reportId,
    reportGeneratedAt: reportData.generatedAt,
    opportunityScore: reportData.opportunityScore,
    opportunityScoreRationale: reportData.opportunityScoreRationale,
    opportunityScoreProvenance: {
      source: 'SynchIntro',
      sourceTier: 2,
      updatedAt: new Date().toISOString(),
      updatedBy: 'SynchIntro',
      confidence: reportData.opportunityScoreConfidence || 0.8,
      basis: reportData.opportunityScoreRationale
    },
    recommendedAngle: reportData.recommendedAngle,
    recommendedAngleProvenance: {
      source: 'SynchIntro',
      sourceTier: 2,
      updatedAt: new Date().toISOString(),
      updatedBy: 'SynchIntro',
      confidence: reportData.angleConfidence || 0.8,
      basis: reportData.angleRationale || reportData.recommendedAngle
    },
    intentSignals: reportData.intelSignals || [],
    intentScore: reportData.intentScore,
    signalConfidence: reportData.signalConfidence,
    marketPosition: reportData.marketPosition,
    shareOfVoice: reportData.shareOfVoice,
    competitiveGapSummary: reportData.competitiveGapSummary,
    primaryPainHypothesis: reportData.primaryPain,
    triggerEvents: reportData.triggerEvents || [],
    timingWindowSummary: reportData.timingWindowSummary,
    localPresence: {
      gbpCompletenessScore: reportData.gbpCompletenessScore,
      rating: reportData.gbpRating,
      reviewCount: reportData.gbpReviewCount,
      reviewVelocity30d: reportData.reviewVelocity30d,
      unansweredReviews: reportData.unansweredReviews,
      responseRate: reportData.responseRate,
      localPresenceGapSummary: reportData.localPresenceGapSummary,
      topWeakness: reportData.topWeakness,
      topOpportunity: reportData.topOpportunity,
      competitorDelta: reportData.competitorDelta
    },
    marketContext: {
      marketReportId: reportData.reportId,
      marketName: reportData.marketName,
      topCompetitors: reportData.topCompetitors || [],
      avgMarketRating: reportData.avgMarketRating,
      avgMarketReviewCount: reportData.avgMarketReviewCount,
      marketLeader: reportData.marketLeader,
      demographicSummary: reportData.demographicSummary,
      highImpactMoves: reportData.highImpactMoves || [],
      marketContextSnapshot: reportData.marketContextSnapshot
    }
  };
}

module.exports = { syncReportToAccount360, syncOutboundStatus };
