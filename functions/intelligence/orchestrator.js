/**
 * Intelligence Engine Orchestrator
 *
 * Coordinates the four-stage pipeline:
 * 1. Collect data (existing sources in Phase 1)
 * 2. Process signals (basic extraction in Phase 1)
 * 3. Synthesize insights (LLM Call 1)
 * 4. Generate brief (LLM Call 2)
 */

const { synthesizeInsights } = require('./synthesis/insightSynthesizer');
const { generateBrief } = require('./generation/briefGenerator');
const { getTierConfig, getMaxSignals } = require('./tierGate');
const { SIGNAL_CATEGORIES } = require('./constants');
const linkedinAgent = require('../services/linkedinAgent');

/**
 * Extract basic signals from existing data sources
 * Phase 1: Simple extraction from website analysis and Google Places
 * Later phases will add the full signal processing engine
 *
 * @param {object} rawData - Raw data from collectors
 * @returns {Array} Array of signal objects
 */
function extractBasicSignals(rawData) {
    const signals = [];

    // From website analysis
    if (rawData.website) {
        if (rawData.website.valueProposition) {
            signals.push({
                category: SIGNAL_CATEGORIES.COMPANY_POSITIONING,
                label: 'Value proposition',
                data: rawData.website.valueProposition,
                confidence: 0.7,
                source: 'website_analysis',
            });
        }

        if (rawData.website.targetMarket) {
            signals.push({
                category: SIGNAL_CATEGORIES.COMPANY_POSITIONING,
                label: 'Target market',
                data: rawData.website.targetMarket,
                confidence: 0.7,
                source: 'website_analysis',
            });
        }

        if (rawData.website.products || rawData.website.services) {
            signals.push({
                category: SIGNAL_CATEGORIES.COMPANY_POSITIONING,
                label: 'Products/Services',
                data: rawData.website.products || rawData.website.services,
                confidence: 0.8,
                source: 'website_analysis',
            });
        }

        if (rawData.website.companySize || rawData.website.employeeCount) {
            signals.push({
                category: SIGNAL_CATEGORIES.COMPANY_POSITIONING,
                label: 'Company size',
                data: rawData.website.companySize || rawData.website.employeeCount,
                confidence: 0.6,
                source: 'website_analysis',
            });
        }
    }

    // From Google Places
    if (rawData.places) {
        if (rawData.places.rating && rawData.places.reviewCount) {
            signals.push({
                category: SIGNAL_CATEGORIES.MARKET_PRESENCE,
                label: 'Customer sentiment',
                data: {
                    rating: rawData.places.rating,
                    reviewCount: rawData.places.reviewCount,
                },
                confidence: 0.8,
                source: 'google_places',
                inference: rawData.places.rating >= 4.5
                    ? 'High customer satisfaction - likely values quality'
                    : rawData.places.rating >= 4.0
                    ? 'Good customer satisfaction'
                    : 'Mixed customer feedback - may be sensitive to service quality',
            });
        }

        if (rawData.places.types && rawData.places.types.length > 0) {
            signals.push({
                category: SIGNAL_CATEGORIES.COMPANY_POSITIONING,
                label: 'Business type',
                data: rawData.places.types,
                confidence: 0.85,
                source: 'google_places',
            });
        }

        if (rawData.places.competitors && rawData.places.competitors.length > 0) {
            signals.push({
                category: SIGNAL_CATEGORIES.COMPETITIVE_PRESSURE,
                label: 'Nearby competitors',
                data: rawData.places.competitors.slice(0, 5).map(c => c.name),
                confidence: 0.7,
                source: 'google_places',
            });
        }
    }

    // From existing contact enrichment (if Growth+)
    if (rawData.contact) {
        if (rawData.contact.summary) {
            signals.push({
                category: SIGNAL_CATEGORIES.CONTACT_CONTEXT,
                label: 'Professional summary',
                data: rawData.contact.summary,
                confidence: 0.85,
                source: 'contact_enrichment',
            });
        }

        if (rawData.contact.careerHistory && rawData.contact.careerHistory.length > 0) {
            signals.push({
                category: SIGNAL_CATEGORIES.LEADERSHIP_DYNAMICS,
                label: 'Career history',
                data: rawData.contact.careerHistory,
                confidence: 0.85,
                source: 'contact_enrichment',
            });
        }

        if (rawData.contact.education) {
            signals.push({
                category: SIGNAL_CATEGORIES.RAPPORT_HOOK,
                label: 'Education background',
                data: rawData.contact.education,
                confidence: 0.9,
                source: 'contact_enrichment',
            });
        }

        if (rawData.contact.communicationStyle) {
            signals.push({
                category: SIGNAL_CATEGORIES.CONTACT_CONTEXT,
                label: 'Communication style',
                data: rawData.contact.communicationStyle,
                confidence: 0.7,
                source: 'contact_enrichment',
            });
        }
    }

    // From News Intelligence Agent (real-time news signals)
    if (rawData.newsAgent && rawData.newsAgent.signals) {
        for (const newsSignal of rawData.newsAgent.signals.slice(0, 5)) { // Top 5 news
            const categoryMap = {
                funding: SIGNAL_CATEGORIES.MARKET_PRESENCE,
                leadership_change: SIGNAL_CATEGORIES.LEADERSHIP_DYNAMICS,
                expansion: SIGNAL_CATEGORIES.MARKET_PRESENCE,
                partnership: SIGNAL_CATEGORIES.COMPANY_POSITIONING,
                product_launch: SIGNAL_CATEGORIES.COMPANY_POSITIONING,
                award: SIGNAL_CATEGORIES.MARKET_PRESENCE,
                hiring: SIGNAL_CATEGORIES.MARKET_PRESENCE,
                financial: SIGNAL_CATEGORIES.MARKET_PRESENCE,
                regulatory: SIGNAL_CATEGORIES.COMPETITIVE_PRESSURE,
                industry_trend: SIGNAL_CATEGORIES.COMPETITIVE_PRESSURE,
            };

            signals.push({
                category: categoryMap[newsSignal.type] || SIGNAL_CATEGORIES.MARKET_PRESENCE,
                label: `News: ${newsSignal.type}`,
                data: {
                    headline: newsSignal.headline,
                    summary: newsSignal.summary,
                    date: newsSignal.date,
                    source: newsSignal.source,
                    talkingPoint: newsSignal.talkingPoint,
                    suggestedUse: newsSignal.suggestedUse,
                },
                confidence: (newsSignal.relevanceScore || 5) / 10, // Convert 1-10 to 0-1
                source: 'news_intelligence_agent',
                inference: newsSignal.talkingPoint || `Recent ${newsSignal.type} - potential conversation starter`,
            });
        }

        // Add industry context signals
        if (rawData.newsAgent.industryContext) {
            const ctx = rawData.newsAgent.industryContext;

            if (ctx.recentTrends && ctx.recentTrends.length > 0) {
                signals.push({
                    category: SIGNAL_CATEGORIES.COMPETITIVE_PRESSURE,
                    label: 'Industry trends',
                    data: ctx.recentTrends,
                    confidence: 0.75,
                    source: 'news_intelligence_agent',
                    inference: 'Current industry shifts that may affect the prospect',
                });
            }

            if (ctx.competitorMoves && ctx.competitorMoves.length > 0) {
                signals.push({
                    category: SIGNAL_CATEGORIES.COMPETITIVE_PRESSURE,
                    label: 'Competitor news',
                    data: ctx.competitorMoves,
                    confidence: 0.8,
                    source: 'news_intelligence_agent',
                    inference: 'Competitive activity to reference in conversation',
                });
            }
        }
    }

    // From Contact Intelligence Agent (enhanced LinkedIn research)
    if (rawData.contactAgent && rawData.contactAgent.profile) {
        const profile = rawData.contactAgent.profile;

        // Communication style with evidence (better than keyword matching)
        if (profile.communicationStyle && profile.styleEvidence) {
            signals.push({
                category: SIGNAL_CATEGORIES.CONTACT_CONTEXT,
                label: 'Communication style (AI inferred)',
                data: {
                    style: profile.communicationStyle,
                    evidence: profile.styleEvidence,
                },
                confidence: 0.85,
                source: 'contact_intelligence_agent',
                inference: `Adapt communication to ${profile.communicationStyle} style`,
            });
        }

        // Conversation starters (AI-generated)
        if (rawData.contactAgent.conversationStarters && rawData.contactAgent.conversationStarters.length > 0) {
            signals.push({
                category: SIGNAL_CATEGORIES.RAPPORT_HOOK,
                label: 'AI conversation starters',
                data: rawData.contactAgent.conversationStarters,
                confidence: 0.9,
                source: 'contact_intelligence_agent',
                inference: 'Research-backed conversation starters for rapport building',
            });
        }

        // Do not mention flags (important for avoiding sensitive topics)
        if (rawData.contactAgent.doNotMention && rawData.contactAgent.doNotMention.length > 0) {
            signals.push({
                category: SIGNAL_CATEGORIES.CONTACT_CONTEXT,
                label: 'Sensitive topics to avoid',
                data: rawData.contactAgent.doNotMention,
                confidence: 0.95,
                source: 'contact_intelligence_agent',
                inference: 'Critical: avoid these topics in conversation',
            });
        }

        // Recent activity (speaking, writing, posts)
        if (profile.recentActivity && profile.recentActivity.length > 0) {
            signals.push({
                category: SIGNAL_CATEGORIES.RAPPORT_HOOK,
                label: 'Recent public activity',
                data: profile.recentActivity,
                confidence: 0.8,
                source: 'contact_intelligence_agent',
                inference: 'Recent activity to reference for personalization',
            });
        }
    }

    // From seller context - analyze fit between seller and prospect
    if (rawData.seller) {
        const seller = rawData.seller;

        // Selected product focus
        if (seller.selectedProduct) {
            signals.push({
                category: SIGNAL_CATEGORIES.COMPANY_POSITIONING,
                label: 'Selected product focus',
                data: {
                    name: seller.selectedProduct.name,
                    description: seller.selectedProduct.description,
                    features: seller.selectedProduct.features,
                },
                confidence: 1.0,
                source: 'seller_context',
                inference: `Focus the conversation on ${seller.selectedProduct.name} and its specific value propositions`,
            });
        }

        // Seller's products/services
        if (seller.products && seller.products.length > 0) {
            signals.push({
                category: SIGNAL_CATEGORIES.COMPANY_POSITIONING,
                label: 'Seller product portfolio',
                data: seller.products.map(p => ({
                    name: p.name,
                    description: p.description,
                    isPrimary: p.isPrimary,
                })),
                confidence: 1.0,
                source: 'seller_context',
            });
        }

        // Industry alignment analysis
        if (seller.industry) {
            signals.push({
                category: SIGNAL_CATEGORIES.COMPANY_POSITIONING,
                label: 'Seller industry context',
                data: {
                    sellerIndustry: seller.industry,
                    sellerCompany: seller.company,
                },
                confidence: 1.0,
                source: 'seller_context',
            });
        }
    }

    return signals;
}

/**
 * Main orchestrator function - generates an intelligent brief
 *
 * @param {object} params - Input parameters
 * @param {object} geminiClient - Gemini client for LLM calls
 * @returns {object} Generated brief with metadata
 */
async function generateIntelligentBrief(params, geminiClient) {
    const {
        userId, // Required for LinkedIn Agent profile comparison
        prospectCompany,
        prospectWebsite,
        prospectIndustry,
        prospectLocation,
        contactName,
        contactTitle,
        contactLinkedIn,
        meetingType = 'discovery',
        userTier = 'starter',
        customSalesLibrary = null,
        // Seller context (from user profile)
        sellerCompany = null,
        sellerIndustry = null,
        sellerProducts = [],
        selectedProduct = null, // Specific product to focus on
        // Existing data sources (passed in from precallBriefRoutes)
        websiteAnalysis = null,
        companyIntelligence = null,
        contactEnriched = null,
        // New AI Agent Intelligence (Sales Intelligence Trifecta)
        contactIntelligence = null, // From LinkedIn Research Agent
        newsIntelligence = null, // From News Intelligence Agent
        // Market intelligence from attached report
        marketContext = null,
    } = params;

    const startTime = Date.now();
    const tierConfig = getTierConfig(userTier);
    const maxSignals = getMaxSignals(userTier);

    console.log(`[Orchestrator] Starting intelligent brief generation for ${prospectCompany}`);
    console.log(`[Orchestrator] Tier: ${userTier}, MaxSignals: ${maxSignals}`);
    console.log(`[Orchestrator] Seller: ${sellerCompany || 'Not provided'}, Industry: ${sellerIndustry || 'Not provided'}`);
    console.log(`[Orchestrator] Products: ${sellerProducts?.length || 0}, Selected: ${selectedProduct?.name || 'None'}`);

    // Stage 1: Collect data (Phase 1 = existing sources only)
    const rawData = {
        website: websiteAnalysis,
        places: companyIntelligence,
        contact: contactEnriched,
        seller: {
            company: sellerCompany,
            industry: sellerIndustry,
            products: sellerProducts,
            selectedProduct: selectedProduct,
        },
        // AI Agent Intelligence (Sales Intelligence Trifecta)
        contactAgent: contactIntelligence, // From LinkedIn Research Agent
        newsAgent: newsIntelligence, // From News Intelligence Agent
        // Market intelligence from attached report
        market: marketContext,
    };

    // Debug: Log what data sources we have
    console.log(`[Orchestrator] Data sources: website=${!!websiteAnalysis}, places=${!!companyIntelligence}, contact=${!!contactEnriched}, contactAgent=${!!contactIntelligence}, newsAgent=${!!newsIntelligence}`);
    if (companyIntelligence) {
        console.log(`[Orchestrator] Places data: rating=${companyIntelligence.rating}, types=${companyIntelligence.types?.length || 0}, competitors=${companyIntelligence.competitors?.length || 0}`);
    }

    // Stage 2: Process signals (Phase 1 = basic extraction)
    let signals = extractBasicSignals(rawData);

    // Limit signals based on tier
    if (signals.length > maxSignals) {
        // Sort by confidence and take top N
        signals = signals
            .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
            .slice(0, maxSignals);
    }

    console.log(`[Orchestrator] Extracted ${signals.length} signals`);

    // Stage 3: Synthesize insights (LLM Call 1)
    const insights = await synthesizeInsights({
        signals,
        prospectCompany,
        prospectWebsite,
        prospectIndustry,
        prospectLocation,
        contactName,
        contactTitle,
        meetingType,
        customSalesLibrary,
        // Seller context for industry/product alignment
        sellerCompany,
        sellerIndustry,
        sellerProducts,
        selectedProduct,
        // AI Agent Intelligence
        newsIntelligence,
        contactIntelligence,
        // Market intelligence
        marketContext,
    }, geminiClient);

    console.log(`[Orchestrator] Synthesis complete (${insights._meta?.latencyMs}ms)`);

    // Stage 3.5: LinkedIn Profile Comparison (if userId provided)
    let linkedinMatch = null;
    if (userId && contactEnriched) {
        try {
            console.log(`[Orchestrator] Running LinkedIn profile comparison...`);
            linkedinMatch = await linkedinAgent.analyzeLinkedInMatch(userId, {
                ...contactEnriched,
                location: prospectLocation,
                industry: prospectIndustry,
            });

            if (linkedinMatch.success) {
                console.log(`[Orchestrator] LinkedIn match found: ${linkedinMatch.comparison?.matches?.length || 0} matches, score: ${linkedinMatch.comparison?.matchScore || 0}`);

                // Add LinkedIn-based rapport hooks to insights
                if (linkedinMatch.rapportHooks?.length > 0) {
                    insights.linkedinRapportHooks = linkedinMatch.rapportHooks;
                    insights.linkedinMatchScore = linkedinMatch.comparison?.matchScore || 0;
                    insights.linkedinMatchSummary = linkedinMatch.comparison?.summary || null;
                }
            } else {
                console.log(`[Orchestrator] LinkedIn comparison skipped: ${linkedinMatch.reason}`);
            }
        } catch (linkedinError) {
            console.warn(`[Orchestrator] LinkedIn analysis failed:`, linkedinError.message);
        }
    }

    // Stage 4: Generate brief (LLM Call 2)
    const brief = await generateBrief({
        insights,
        prospectCompany,
        prospectWebsite,
        prospectIndustry,
        contactName,
        contactTitle,
        meetingType,
        userTier,
        customSalesLibrary,
        linkedinMatch, // Pass LinkedIn comparison results
        // AI Agent Intelligence for enhanced brief
        newsIntelligence,
        contactIntelligence,
        // Market intelligence
        marketContext,
    }, geminiClient);

    const totalLatencyMs = Date.now() - startTime;
    console.log(`[Orchestrator] Brief generation complete (total: ${totalLatencyMs}ms)`);

    // Combine brief with pipeline metadata
    return {
        // All brief fields
        ...brief,

        // Pipeline metadata
        _pipeline: {
            version: '1.1.0', // Updated for AI Agent support
            phase: 1,
            totalLatencyMs,
            stages: {
                collection: { sources: Object.keys(rawData).filter(k => rawData[k]) },
                signals: { count: signals.length, maxAllowed: maxSignals },
                synthesis: {
                    latencyMs: insights._meta?.latencyMs,
                    lowDataMode: insights._meta?.lowDataMode,
                },
                generation: {
                    latencyMs: brief._meta?.latencyMs,
                    qualityCheck: brief._meta?.qualityCheck,
                },
                // AI Agent metadata
                aiAgents: {
                    contactAgent: contactIntelligence ? {
                        enrichmentLevel: contactIntelligence.enrichmentLevel,
                        sourceCount: contactIntelligence.sources?.length || 0,
                    } : null,
                    newsAgent: newsIntelligence ? {
                        signalCount: newsIntelligence.signalCount || newsIntelligence.signals?.length || 0,
                        hasIndustryContext: !!newsIntelligence.industryContext,
                    } : null,
                },
            },
            tier: userTier,
            timestamp: new Date().toISOString(),
        },

        // Include insights for debugging/transparency (can be removed in production)
        _insights: {
            tamFit: insights.tamFit,
            callStrategy: insights.callStrategy,
            painPointCount: insights.painPointHypotheses?.length || 0,
            signalCount: signals.length,
            newsSignalCount: newsIntelligence?.signals?.length || 0,
            hasDoNotMention: !!(contactIntelligence?.doNotMention?.length > 0),
        },
    };
}

module.exports = {
    generateIntelligentBrief,
    extractBasicSignals,
};
