/**
 * Template-Driven One-Pager Orchestrator
 *
 * Full pipeline:
 *   selectTemplate() → enrichment pipeline → buildBatchPrompt() → geminiGenerate()
 *     → resolveSection() for each section → return assembled sections + HTML
 *
 * Called from pitchGenerator.js case 2 when outreachType maps to L2 and a
 * template is available in pitchTemplates collection.
 *
 * IMPORTANT: Does NOT touch L1/L3/L4 generation paths. Does NOT modify
 * any Countifi-related code (UID: vkSfmPqfNrWYo7ZzelTwPgtC8yw2).
 */

const { selectTemplate } = require('../../services/templateSelector');
const { runTemplateEnrichment } = require('../../services/templateEnrichment');
const {
    buildAndExecuteBatchPrompt,
    buildAndExecuteTemplatePrompt
} = require('../../services/templatePromptBuilder');
const { resolveAllSections } = require('../../services/templateSectionResolver');
const { calculateDeterministicOutcomes } = require('../../services/deterministicOutcomes');

/**
 * Generate a template-driven L2 one-pager.
 *
 * @param {Object} inputs       - Pitch inputs from request body
 *   { businessName, address, websiteUrl, googleRating, numReviews, industry, ... }
 * @param {Object} options      - Pitch options (sellerContext, branding, etc.)
 * @param {string} userId       - Firebase UID
 * @returns {Promise<Object|null>}
 *   { sections, html, templateId, enrichmentMeta } or null if no template found
 */
async function generateTemplateOnePager(inputs, options, userId) {
    const t0 = Date.now();

    // ── Step 1: Select Template ──────────────────────────────────────────────
    const outreachType = options.outreachType || 'l2';
    const industry = inputs.industry || null;

    const template = await selectTemplate(userId, outreachType, industry);
    if (!template) {
        console.log('[TemplateOnePager] No template found — falling back to legacy L2 generator');
        return null;
    }

    console.log(`[TemplateOnePager] Using template: ${template.templateId} (${template.templateName})`);

    // ── Step 2: Build prospectData from inputs ───────────────────────────────
    const cityState = parseAddress(inputs.address || '');
    const prospectData = {
        businessName: inputs.businessName || '',
        city: inputs.city || cityState.city || '',
        state: inputs.state || cityState.state || '',
        rating: parseFloat(inputs.googleRating) || null,
        reviewCount: parseInt(inputs.numReviews) || null,
        website: inputs.websiteUrl || null,
        address: inputs.address || null,
        industry: inputs.industry || null
    };

    // ── Step 3: Run Enrichment Pipeline ─────────────────────────────────────
    let enrichedData;
    try {
        enrichedData = await runTemplateEnrichment(template, prospectData, userId);
    } catch (err) {
        console.error('[TemplateOnePager] Enrichment failed (continuing with minimal data):', err.message);
        enrichedData = {
            prospect: prospectData,
            analysis: {
                reviewSnippets: [],
                positiveSnippets: [],
                negativeSnippets: [],
                topComplaintPattern: null,
                topComplaintCategory: null,
                complaintFrequency: 0,
                reviewVolumeAssessment: 'growing',
                urgencyHook: null,
                projectedOutcomes: computeDefaultOutcomes(prospectData)
            },
            enrichmentMeta: { elapsed: 0, creditsUsed: 0, error: err.message }
        };
    }

    // Issue 2 fix: DataForSEO's owner_answer field sometimes returns null even when
    // owner responses are visible on Google Maps. Override ownerResponseCount and
    // respondedCount with the user-text parsed count when DataForSEO shows 0.
    if (inputs.parsedRespondedCount > 0) {
        if (enrichedData.prospect.ownerResponseCount === 0) {
            enrichedData.prospect.ownerResponseCount = inputs.parsedRespondedCount;
        }
        if (!enrichedData.analysis.respondedCount) {
            enrichedData.analysis.respondedCount = inputs.parsedRespondedCount;
        }
        // Recompute responseRate from parsed count so the stat card shows an accurate %.
        // Only override when DataForSEO returned 0 (avoids stomping a real measured rate).
        if (!enrichedData.analysis.responseRate) {
            const totalReviews = enrichedData.prospect.reviewCount || inputs.numReviews || 0;
            if (totalReviews > 0) {
                enrichedData.analysis.responseRate = Math.round(
                    (inputs.parsedRespondedCount / totalReviews) * 100
                );
            }
        }
    }

    // Propagate review velocity computed from pasted review timestamps.
    if (inputs.reviewVelocity && !enrichedData.analysis.reviewVelocity) {
        enrichedData.analysis.reviewVelocity = inputs.reviewVelocity;
    }

    // ── Step 3b: Flag no-GBP in analysis so Gemini adapts headline/narrative ─
    const gbpDetectedEarly = !!(
        enrichedData.prospect?.rating ||
        enrichedData.prospect?.reviewCount ||
        parseFloat(inputs.googleRating) > 0 ||
        parseInt(inputs.numReviews) > 0
    );
    if (!gbpDetectedEarly) {
        enrichedData.analysis.noGBP = true;
        enrichedData.analysis.hasReviewData = false;
        // Override any fabricated defaults that might have leaked through
        enrichedData.analysis.topComplaintPattern = null;
        enrichedData.analysis.topComplaintCategory = null;
        enrichedData.analysis.complaintFrequency = 0;
        enrichedData.analysis.reviewVolumeAssessment = 'none';
    }

    // ── Step 3c: Override projectedOutcomes for confirmed no-GBP businesses ─
    // Must happen BEFORE resolveAllSections() so the stat card renderer
    // picks up the correct outcome values.  gbpStatus === 'not_found' means
    // DataForSEO confirmed no GBP exists — use GBP-acquisition outcomes
    // instead of the default review-growth outcomes.
    const _userHasGBPData = parseFloat(inputs.googleRating) > 0 || parseInt(inputs.numReviews) > 0;
    if (enrichedData.enrichmentMeta?.gbpStatus === 'not_found' && !_userHasGBPData) {
        enrichedData.analysis.projectedOutcomes = [
            { value: '1',    label: 'GBP CLAIMED & OPTIMIZED' },
            { value: '4.8+', label: 'RATING TARGET' },
            { value: '100%', label: 'REVIEW RESPONSE RATE' },
            { value: '18+',  label: 'NEW REVIEWS IN 90 DAYS' }
        ];
    }

    // ── Step 3d: Parse pasted reviews as fallback when DataForSEO returns no data ─
    if (inputs.googleReviews && inputs.googleReviews.trim().length > 50) {
        const hasEnrichedReviews = enrichedData.analysis?.reviewSnippets?.length > 0;
        if (!hasEnrichedReviews) {
            console.log('[TemplateOnePager] No DataForSEO reviews — parsing pasted reviews as fallback');
            const parsed = parsePastedReviews(inputs.googleReviews);
            if (parsed.snippets.length > 0) {
                enrichedData.analysis.reviewSnippets = parsed.snippets;
                enrichedData.analysis.positiveSnippets = parsed.positive;
                enrichedData.analysis.negativeSnippets = parsed.negative;
                // Also set aliases used by buildAndExecuteTemplatePrompt
                enrichedData.analysis.positiveReviews = parsed.positive;
                enrichedData.analysis.negativeReviews = parsed.negative;
                enrichedData.analysis.hasReviewData = true;
                enrichedData.analysis.reviewDataStatus = 'has_reviews';
                console.log(`[TemplateOnePager] Parsed ${parsed.snippets.length} reviews from pasted text (${parsed.positive.length} positive, ${parsed.negative.length} negative)`);
            }
        }
    }

    // Count owner responses in pasted reviews if not already set from DataForSEO
    if (!inputs.parsedRespondedCount && inputs.googleReviews) {
        const ownerResponses = (inputs.googleReviews.match(/\(Owner\)/gi) || []).length;
        if (ownerResponses > 0) {
            inputs.parsedRespondedCount = ownerResponses;
            console.log(`[TemplateOnePager] Detected ${ownerResponses} owner responses in pasted reviews`);
        }
    }

    // ── Step 3e: Recompute stat card fields from parsed review data ──────────
    // When pasted reviews are the data source, complaintFrequency and responseRate
    // need to be computed from the parsed data since the earlier recompute block
    // (lines ~87-104) ran before Step 3d populated the data.
    if (inputs.parsedRespondedCount > 0 || enrichedData.analysis?.negativeSnippets?.length > 0) {
        // Recompute response rate from owner response count
        if (inputs.parsedRespondedCount > 0 && !enrichedData.analysis.responseRate) {
            const totalReviews = enrichedData.prospect?.reviewCount || parseInt(inputs.numReviews) || 0;
            if (totalReviews > 0) {
                enrichedData.analysis.responseRate = Math.round(
                    (inputs.parsedRespondedCount / totalReviews) * 100
                );
            }
            if (!enrichedData.prospect.ownerResponseCount) {
                enrichedData.prospect.ownerResponseCount = inputs.parsedRespondedCount;
            }
            if (!enrichedData.analysis.respondedCount) {
                enrichedData.analysis.respondedCount = inputs.parsedRespondedCount;
            }
            console.log(`[TemplateOnePager] Recomputed responseRate: ${enrichedData.analysis.responseRate}% from ${inputs.parsedRespondedCount} owner responses / ${enrichedData.prospect?.reviewCount || parseInt(inputs.numReviews) || 0} total`);
        }

        // Compute complaint frequency from negative snippets
        const negCount = enrichedData.analysis?.negativeSnippets?.length || 0;
        if (negCount > 0 && !enrichedData.analysis.complaintFrequency) {
            enrichedData.analysis.complaintFrequency = negCount;
            console.log(`[TemplateOnePager] Set complaintFrequency: ${negCount}/mo from parsed negative reviews`);
        }
    }

    // ── Step 3f: Deterministic 90-day outcome calculation ─────────────────────
    // Replace AI-generated "What Changes in 90 Days" with math-based projections.
    // Skipped for no-GBP businesses — they get GBP-acquisition outcome cards from Step 3c.
    const _hasGBPForOutcomes = parseFloat(inputs.googleRating) > 0 || parseInt(inputs.numReviews) > 0;
    if (_hasGBPForOutcomes) {
        const deterministicInputs = {
            currentReviewCount: parseInt(inputs.numReviews) || enrichedData.prospect?.reviewCount || 0,
            currentRating: parseFloat(inputs.googleRating) || enrichedData.prospect?.rating || 0,
            currentDisplayedRating: parseFloat(inputs.googleRating) || enrichedData.prospect?.rating || 0,
            reviews: (enrichedData.analysis?.reviewSnippets || []).map(s => ({
                relativeDateLabel: s.date || null,
                rating: s.rating || null
            })),
            expectedNewReviewAverage: 5.0,
            recentNegativeReviewRate: enrichedData.analysis?.negativeSnippets?.length > 0 && enrichedData.analysis?.reviewSnippets?.length > 0
                ? enrichedData.analysis.negativeSnippets.length / enrichedData.analysis.reviewSnippets.length
                : null
        };

        const deterministicOutcomes = calculateDeterministicOutcomes(deterministicInputs);

        if (deterministicOutcomes.displayReviewTarget > 0) {
            enrichedData.analysis.projectedOutcomes = [
                { value: `${deterministicOutcomes.displayReviewTarget}+`, label: 'NEW REVIEWS IN 90 DAYS' },
                { value: deterministicOutcomes.ratingTargetLabel.split(' ')[0], label: deterministicOutcomes.ratingTargetLabel.includes('Protected') ? 'PROTECTED' : 'RATING TARGET' },
                { value: '100%', label: 'REVIEW RESPONSE RATE' },
                { value: '1', label: 'UNIFIED DASHBOARD' }
            ];
            enrichedData.analysis.deterministicOutcomes = deterministicOutcomes;
            console.log(`[TemplateOnePager] Deterministic outcomes: ${deterministicOutcomes.displayReviewTarget}+ reviews, ${deterministicOutcomes.ratingTargetLabel}, trend: ${deterministicOutcomes.reviewVelocityTrend}`);
        }
    }

    // ── Step 4: Build + Execute Gemini Prompt ───────────────────────────────
    // executive_brief uses Vertex AI Controlled Generation (responseSchema) for
    // guaranteed schema-compliant output. Other styles use the legacy batch prompt path.
    const sellerProfile = options.sellerContext || {};
    const l2StyleEarly = options.l2Style || inputs.l2Style || null;
    let aiResults = {};
    try {
        if (l2StyleEarly === 'executive_brief') {
            aiResults = await buildAndExecuteTemplatePrompt(
                template,
                enrichedData.prospect,
                sellerProfile,
                enrichedData.analysis
            );
            console.log('[TemplateOnePager] Used structured generation (responseSchema) for executive_brief');
        } else {
            aiResults = await buildAndExecuteBatchPrompt(
                template.sections,
                enrichedData,
                template.generationRules,
                sellerProfile
            );
        }
    } catch (err) {
        console.error('[TemplateOnePager] AI generation failed:', err.message);
        // Continue with empty aiResults — resolveSection handles nulls gracefully
    }

    // ── Step 5: Resolve All Sections ────────────────────────────────────────
    const pitch = buildPitchData(inputs, options, sellerProfile);
    let sections = resolveAllSections(
        template.sections,
        enrichedData,
        aiResults,
        sellerProfile,
        pitch
    );

    // ── Step 5b: No-GBP banner injection ────────────────────────────────────
    // Only inject the amber "No GBP Found" banner when gbpStatus is confirmed 'not_found'.
    // Never inject on 'unknown' (timeouts, credit-gate) — that would falsely label a real business.

    // Override gbpStatus when user provided rating or review count — the business HAS a GBP
    // regardless of whether DataForSEO succeeded. This prevents false no-GBP banners
    // when DataForSEO is down (e.g. returning 404).
    const userSuppliedGBP = parseFloat(inputs.googleRating) > 0 || parseInt(inputs.numReviews) > 0;
    if (userSuppliedGBP && enrichedData.enrichmentMeta?.gbpStatus === 'not_found') {
        enrichedData.enrichmentMeta.gbpStatus = 'found';
        if (enrichedData.analysis) {
            enrichedData.analysis.gbpStatus = 'found';
            enrichedData.analysis.hasReviewData = true;
            enrichedData.analysis.reviewDataStatus = 'has_reviews';
        }
        console.log('[TemplateOnePager] User supplied rating/reviews — overriding gbpStatus to found');
    }

    const gbpStatus = enrichedData.analysis?.gbpStatus || enrichedData.enrichmentMeta?.gbpStatus || 'unknown';
    if (gbpStatus === 'not_found') {
        // Remove complaint and love sections — they have no data and mustn't render empty shells
        sections = sections.filter(s => s && s.sectionId !== 'complaintPatterns' && s.sectionId !== 'customerLove');

        // Build LocalSynch upsell data from seller products or use hardcoded defaults
        const sellerProducts = sellerProfile?.products || [];
        const localGrowthProduct = sellerProducts.find(p =>
            (p.productName || p.name || '').toLowerCase().includes('local growth') ||
            (p.productName || p.name || '').toLowerCase().includes('localsynch growth')
        );
        const localAuthorityProduct = sellerProducts.find(p =>
            (p.productName || p.name || '').toLowerCase().includes('local authority') ||
            (p.productName || p.name || '').toLowerCase().includes('localsynch authority')
        );
        const noGBPData = {
            businessName: enrichedData.prospect?.businessName || inputs.businessName || '',
            city: enrichedData.prospect?.city || inputs.city || '',
            localGrowth: {
                name: localGrowthProduct?.productName || localGrowthProduct?.name || 'LocalSynch — Local Growth',
                price: localGrowthProduct?.monthlyPrice ? `$${localGrowthProduct.monthlyPrice}/mo` : '$199/mo',
                setupFee: localGrowthProduct?.setupFee ? `$${localGrowthProduct.setupFee} one-time setup` : '$299 one-time setup',
                description: 'GBP creation & optimization, directory sync across 60+ platforms, monthly posts & photo uploads, review generation setup'
            },
            localAuthority: {
                name: localAuthorityProduct?.productName || localAuthorityProduct?.name || 'LocalSynch — Local Authority',
                price: localAuthorityProduct?.monthlyPrice ? `$${localAuthorityProduct.monthlyPrice}/mo` : '$329/mo',
                setupFee: localAuthorityProduct?.setupFee ? `$${localAuthorityProduct.setupFee} one-time setup` : '$599 one-time setup',
                description: 'Everything in Local Growth plus advanced local SEO, competitor monitoring, weekly GBP posts, citation building, and quarterly strategy calls'
            }
        };

        // Splice the banner right after statCards (or at position 4 if statCards not found)
        const statCardsIdx = sections.findIndex(s => s && s.sectionId === 'statCards');
        const insertAt = statCardsIdx >= 0 ? statCardsIdx + 1 : Math.min(4, sections.length);
        sections.splice(insertAt, 0, {
            sectionId: 'noGBPBanner',
            enabled: true,
            data: noGBPData
        });

        console.log('[TemplateOnePager] No GBP detected — injected noGBPBanner, removed complaint/love sections');
    } else if (gbpStatus !== 'found') {
        // unknown — strip complaint/love sections silently if no review evidence (no false banner)
        const hasReviewData = enrichedData.analysis?.hasReviewData === true;
        if (!hasReviewData) {
            sections = sections.filter(s => s && s.sectionId !== 'complaintPatterns' && s.sectionId !== 'customerLove');
            console.log('[TemplateOnePager] No review evidence — stripped complaint/love sections (gbpStatus: unknown)');
        }
    }

    // ── Step 6: Generate HTML from resolved sections ─────────────────────────
    const urgencyHook = enrichedData.analysis?.urgencyHook || null;

    // Shared pitch context object for style renderers (richer than just sections)
    const pitchContext = {
        sections,
        inputs,
        prospect:        enrichedData.prospect,
        analysis:        enrichedData.analysis,
        urgencyHook,
        solutionPackage: aiResults?.solutionPackage || null,
        marketContext:   inputs.marketContext || null,
    };

    // Route to alternate renderer based on l2Style
    const l2Style = l2StyleEarly;
    let html;
    if (l2Style === 'executive_brief') {
        const { renderExecutiveBrief } = require('../../services/executiveBriefRenderer');
        html = renderExecutiveBrief(pitchContext, sellerProfile);
        console.log('[TemplateOnePager] Rendered as executive_brief style');
    } else if (l2Style === 'roi_snapshot') {
        const { renderROISnapshot } = require('../../services/roiSnapshotRenderer');
        html = renderROISnapshot(pitchContext, sellerProfile);
        console.log('[TemplateOnePager] Rendered as roi_snapshot style');
    } else if (l2Style === 'competitive_battlecard') {
        const { renderBattlecard } = require('../../services/battlecardRenderer');
        html = renderBattlecard(pitchContext, sellerProfile);
        console.log('[TemplateOnePager] Rendered as competitive_battlecard style');
    } else if (l2Style === 'visual_summary') {
        const { renderVisualSummary } = require('../../services/visualSummaryRenderer');
        html = renderVisualSummary(pitchContext, sellerProfile);
        console.log('[TemplateOnePager] Rendered as visual_summary style');
    } else {
        html = renderOnePagerHtml(sections, template, sellerProfile, enrichedData.prospect, urgencyHook);
    }

    const elapsed = Date.now() - t0;
    console.log(`[TemplateOnePager] Done in ${elapsed}ms — ${sections.length} sections rendered`);

    return {
        sections,
        html,
        templateId: template.templateId,
        templateName: template.templateName,
        enrichmentMeta: enrichedData.enrichmentMeta || {},
        aiFieldCount: Object.keys(aiResults).length,
        generatedWithTemplate: true
    };
}

/**
 * Parse "City, ST 12345" style address into { city, state }
 */
function parseAddress(address) {
    if (!address) return { city: '', state: '' };
    // Try "City, ST" or "City, State"
    const match = address.match(/([^,]+),\s*([A-Z]{2})\b/);
    if (match) return { city: match[1].trim(), state: match[2].trim() };
    return { city: address.split(',')[0].trim(), state: '' };
}

/**
 * ISSUE 4: Compute a smart rating target based on current rating.
 */
function computeDefaultOutcomes(prospectData) {
    const rating = parseFloat(prospectData?.rating) || null;
    const reviewCount = parseInt(prospectData?.reviewCount || prospectData?.numReviews) || null;

    let ratingTarget;
    if (!rating || rating < 4.5) {
        ratingTarget = '4.5★';
    } else if (rating >= 4.8) {
        ratingTarget = '4.9+★';
    } else {
        ratingTarget = (Math.round(rating * 10) / 10 + 0.1).toFixed(1) + '★';
    }

    // Review target: ~25% of current count or minimum of 10, formatted as "X+"
    const reviewTarget = reviewCount
        ? `${Math.max(10, Math.round(reviewCount * 0.25))}+`
        : null;

    const outcomes = [
        { value: ratingTarget, label: 'RATING TARGET' }
    ];
    if (reviewTarget) {
        outcomes.push({ value: reviewTarget, label: 'NEW REVIEWS (90 DAYS)' });
    }
    return outcomes;
}

/**
 * Build pitch-level data (products, pricing) from inputs and seller context
 */
function buildPitchData(inputs, options, sellerProfile) {
    const sellerProducts = sellerProfile.products || sellerProfile.icps || [];
    const recommendedProducts = sellerProducts.slice(0, 6).map(p => ({
        name: typeof p === 'string' ? p : (p.name || p.productName || ''),
        description: typeof p === 'object' ? (p.description || '') : ''
    })).filter(p => p.name);

    // Default PathSynch products if seller has none configured
    if (recommendedProducts.length === 0) {
        recommendedProducts.push(
            { name: 'Review Generation', description: 'Automated SMS/email review requests after every visit' },
            { name: 'Review Response', description: 'AI-drafted responses to every review within 2 hours' },
            { name: 'Reputation Dashboard', description: 'Unified view of all reviews across platforms' },
            { name: 'GBP Optimization', description: 'Posts, photos, Q&A managed monthly' }
        );
    }

    return {
        recommendedProducts,
        selectedProducts: inputs.selectedProducts || [],
        pricingLineItems: inputs.pricingLineItems || [],
        setupFee: inputs.setupFee || null,
        monthlyTotal: inputs.monthlyTotal || null,
        pricingHighlight: inputs.pricingHighlight || null,
        parsedRespondedCount: inputs.parsedRespondedCount || 0,
        reviewVelocity: inputs.reviewVelocity || null
    };
}

/**
 * Render resolved sections into HTML.
 * Produces a print-ready one-pager with the Review Audit template design.
 */
function renderOnePagerHtml(sections, template, sellerProfile, prospect, urgencyHook) {
    const branding = sellerProfile?.branding || {};
    const colors = template.layout?.colorScheme || {};
    // sellerProfile here is actually sellerContext (top-level primaryColor/accentColor/logoUrl)
    const primary = branding.primaryColor || sellerProfile?.primaryColor || colors.primary || '#0D9488';
    const accent = branding.accentColor || sellerProfile?.accentColor || colors.accent || '#F59E0B';
    const dark = colors.dark || '#111827';
    const muted = colors.muted || '#6B7280';
    const bg = colors.background || '#FCFBF8';
    const cardBg = colors.cardBg || '#F9FAFB';
    const alertRed = colors.alertRed || '#EF4444';
    const successGreen = colors.successGreen || '#10B981';

    const sectionHtmlParts = sections.map(section => renderSection(section, colors, sellerProfile));

    // ISSUE 5: inject urgency banner if no urgencyBadge section was rendered
    const hasUrgencySection = sections.some(s => s.sectionId === 'urgencyBadge');
    if (!hasUrgencySection && urgencyHook) {
        sectionHtmlParts.push(renderUrgencyBadgeText(urgencyHook));
    }

    // ISSUE 6: inject CTA if no closingCTA section rendered
    const hasCTASection = sections.some(s => s.sectionId === 'closingCTA');
    if (!hasCTASection) {
        sectionHtmlParts.push(renderCTAFallback(sellerProfile));
    }

    // ISSUE 7: inject footer if no footer section rendered
    const hasFooterSection = sections.some(s => s.sectionId === 'footer');
    if (!hasFooterSection) {
        sectionHtmlParts.push(renderFooterFallback());
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Review Audit — ${escHtml(prospect?.businessName || 'One-Pager')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'DM Sans', Helvetica, sans-serif;
    background: ${bg};
    color: ${dark};
    font-size: 9pt;
    line-height: 1.4;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    width: 8.5in;
    min-height: 11in;
    max-height: 11in;
    overflow: hidden;
    padding: 0.5in 0.6in;
    background: ${bg};
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  /* Header */
  .section-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid ${primary}; padding-bottom: 6px; }
  .header-logo { font-family: 'Syne', sans-serif; font-weight: 800; font-size: 14pt; color: ${primary}; }
  .header-prepared { font-family: 'Syne', sans-serif; font-size: 8pt; font-weight: 700; color: ${primary}; letter-spacing: 0.05em; }
  /* Decision maker */
  .section-decision-maker { font-size: 8pt; color: ${muted}; }
  /* Audit summary callout */
  .audit-callout { border: 2px solid ${primary}; border-radius: 6px; padding: 10px 12px; background: #fff; display: flex; gap: 10px; align-items: flex-start; }
  .audit-callout-icon { color: ${primary}; font-size: 16pt; line-height: 1; flex-shrink: 0; }
  .audit-callout-body { flex: 1; }
  .audit-label { font-size: 7pt; font-weight: 700; color: ${primary}; letter-spacing: 0.08em; text-transform: uppercase; }
  .audit-date { font-size: 7pt; color: ${muted}; }
  .audit-text { font-size: 8.5pt; color: ${dark}; margin-top: 4px; }
  /* Headline */
  .section-headline { }
  .headline-line1 { font-family: 'Syne', sans-serif; font-size: 22pt; font-weight: 800; color: ${dark}; line-height: 1.1; }
  .headline-line2 { font-family: 'Syne', sans-serif; font-size: 22pt; font-weight: 800; color: ${accent}; line-height: 1.1; }
  /* Narrative */
  .section-narrative { font-size: 8.5pt; color: ${dark}; line-height: 1.45; }
  /* Stat cards */
  .stat-strip { display: grid; gap: 8px; }
  .stat-card { background: ${cardBg}; border-radius: 6px; padding: 10px 8px; text-align: center; }
  .stat-number { font-family: 'Syne', sans-serif; font-size: 20pt; font-weight: 800; color: ${dark}; line-height: 1; }
  .stat-number.red { color: ${alertRed}; }
  .stat-label { font-size: 6.5pt; font-weight: 600; color: ${muted}; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 3px; }
  .stat-sublabel { font-size: 6pt; color: ${muted}; margin-top: 2px; }
  /* Two-column: complaint + love */
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .section-box { background: ${cardBg}; border-radius: 6px; padding: 10px 12px; }
  .section-box-title { font-family: 'Syne', sans-serif; font-size: 8pt; font-weight: 700; letter-spacing: 0.06em; margin-bottom: 8px; }
  .complaint-item { margin-bottom: 8px; }
  .complaint-count { font-size: 10pt; font-weight: 800; color: ${alertRed}; }
  .complaint-cat { font-size: 8pt; font-weight: 700; color: ${dark}; }
  .complaint-snippets { font-size: 7pt; color: ${muted}; font-style: italic; margin-top: 2px; }
  .love-item { margin-bottom: 6px; font-size: 8pt; }
  .love-label { font-weight: 700; color: ${dark}; }
  .love-detail { color: ${muted}; font-style: italic; }
  /* Solution block */
  .section-solution { background: ${dark}; border-radius: 8px; padding: 14px 16px; color: #fff; }
  .solution-title { font-family: 'Syne', sans-serif; font-size: 8pt; font-weight: 700; letter-spacing: 0.08em; color: #fff; text-transform: uppercase; }
  .solution-subtitle { font-family: 'Syne', sans-serif; font-size: 13pt; font-weight: 700; color: #fff; margin-top: 4px; }
  .outcome-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 8px; }
  .outcome-card { background: rgba(255,255,255,0.1); border-radius: 5px; padding: 6px 4px; text-align: center; }
  .outcome-value { font-family: 'Syne', sans-serif; font-size: 13pt; font-weight: 800; color: ${accent}; }
  .outcome-label { font-size: 6pt; color: #fff; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px; }
  .product-list { margin-top: 8px; display: flex; flex-direction: column; gap: 3px; }
  .product-item { font-size: 7.5pt; color: rgba(255,255,255,0.85); }
  .product-name { font-weight: 600; color: #fff; }
  .pricing-card { background: ${primary}; border-radius: 6px; padding: 10px 12px; margin-top: 8px; display: flex; justify-content: space-between; align-items: center; }
  .pricing-package { font-family: 'Syne', sans-serif; font-size: 8pt; font-weight: 700; color: #fff; }
  .pricing-total { font-family: 'Syne', sans-serif; font-size: 22pt; font-weight: 800; color: #fff; }
  /* Urgency badge */
  .urgency-badge { display: inline-flex; align-items: center; gap: 8px; background: ${accent}; border-radius: 20px; padding: 4px 14px; }
  .urgency-label { font-size: 7.5pt; font-weight: 700; color: ${dark}; letter-spacing: 0.05em; }
  .urgency-detail { font-size: 7pt; color: ${dark}; }
  /* CTA */
  .section-cta { font-size: 8.5pt; color: ${dark}; font-style: italic; border-top: 1px solid #e5e7eb; padding-top: 6px; }
  /* Footer */
  .section-footer { border-top: 1px solid #e5e7eb; padding-top: 6px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 4px; font-size: 7pt; color: ${muted}; margin-top: auto; }
  @media print {
    body { background: ${bg}; }
    .page { box-shadow: none; }
  }
</style>
</head>
<body>
<div class="page">
${sectionHtmlParts.join('\n')}
</div>
</body>
</html>`;
}

/**
 * Render the No-GBP amber banner with LocalSynch upsell cards
 */
function renderNoGBPBanner(sectionData) {
    const d = sectionData || {};
    const businessName = escHtml(d.businessName || 'This business');
    const city = escHtml(d.city || 'your area');
    const lg = d.localGrowth || {};
    const la = d.localAuthority || {};

    const lgName = escHtml(lg.name || 'LocalSynch — Local Growth');
    const lgPrice = escHtml(lg.price || '$199/mo');
    const lgSetup = escHtml(lg.setupFee || '$299 one-time setup');
    const lgDesc = escHtml(lg.description || 'GBP creation & optimization, directory sync, review generation setup');

    const laName = escHtml(la.name || 'LocalSynch — Local Authority');
    const laPrice = escHtml(la.price || '$329/mo');
    const laSetup = escHtml(la.setupFee || '$599 one-time setup');
    const laDesc = escHtml(la.description || 'Everything in Local Growth plus advanced local SEO, competitor monitoring, weekly GBP posts');

    return `
<div class="section-no-gbp-banner">
  <div class="no-gbp-header">
    <span class="no-gbp-icon">&#9888;</span>
    <span class="no-gbp-title">NO GOOGLE BUSINESS PROFILE FOUND</span>
  </div>
  <p class="no-gbp-body">
    ${businessName} does not appear to have a claimed Google Business Profile in ${city}.
    Without a GBP, this business is invisible in Google Maps, local search, and &quot;near me&quot; queries —
    losing customers to competitors who DO show up.
  </p>
  <div class="no-gbp-plans">
    <div class="no-gbp-plan">
      <div class="no-gbp-plan-name">${lgName}</div>
      <div class="no-gbp-plan-price">${lgPrice}</div>
      <div class="no-gbp-plan-desc">${lgDesc}</div>
      <div class="no-gbp-plan-setup">${lgSetup}</div>
    </div>
    <div class="no-gbp-plan">
      <div class="no-gbp-plan-name">${laName}</div>
      <div class="no-gbp-plan-price">${laPrice}</div>
      <div class="no-gbp-plan-desc">${laDesc}</div>
      <div class="no-gbp-plan-setup">${laSetup}</div>
    </div>
  </div>
  <p class="no-gbp-cta">&#9889; Step 1: Get found on Google. Step 2: Build the reviews. Step 3: Dominate ${city}.</p>
</div>`;
}

/**
 * Render a single resolved section to HTML
 */
function renderSection(section, colors, sellerProfile) {
    const alertRed = colors.alertRed || '#EF4444';
    const successGreen = colors.successGreen || '#10B981';

    switch (section.sectionId) {
        case 'header': return renderHeader(section, sellerProfile);
        case 'decisionMaker': return renderDecisionMaker(section);
        case 'auditSummary': return renderAuditSummary(section);
        case 'headline': return renderHeadline(section);
        case 'narrativeParagraph': return renderNarrative(section);
        case 'statCards': return renderStatCards(section, colors);
        case 'complaintPatterns': return renderComplaintPatterns(section, alertRed);
        case 'customerLove': return renderCustomerLove(section, successGreen);
        case 'noGBPBanner': return renderNoGBPBanner(section.data);
        case 'solution': return renderSolution(section, colors);
        case 'urgencyBadge': return renderUrgencyBadge(section);
        case 'closingCTA': return renderCTA(section, sellerProfile);
        case 'footer': return renderFooter(section);
        default: return `<!-- section: ${section.sectionId} -->`;
    }
}

function fieldVal(section, fieldId) {
    return section.fields.find(f => f.fieldId === fieldId)?.value ?? null;
}

function renderHeader(section, sellerProfile) {
    const logo = section.fields.find(f => f.fieldId === 'logo');
    const prepared = fieldVal(section, 'preparedFor');

    const brandingLogoUrl = sellerProfile?.branding?.logoUrl || sellerProfile?.logoUrl || '';
    const logoVal = logo?.value || brandingLogoUrl || '';
    const isLogoUrl = logoVal && (
        logoVal.startsWith('http://') ||
        logoVal.startsWith('https://') ||
        logoVal.startsWith('/') ||
        logoVal.startsWith('data:')
    );
    // ISSUE 1: logo on teal — img gets white bg pill; text fallback is white on teal
    const logoHtml = isLogoUrl
        ? `<img src="${escHtml(logoVal)}" alt="Logo" style="height:28px;background:#fff;padding:2px 6px;border-radius:4px;">`
        : `<span style="font-family:'Syne',sans-serif;font-weight:700;font-size:16px;color:#fff;">${escHtml(sellerProfile?.companyName || sellerProfile?.sellerContext?.companyName || 'Your Company')}</span>`;

    const prospectName = prepared ? prepared.replace(/^PREPARED FOR\s*/i, '').trim() : '';

    // ISSUE 1: full-width teal bar with white text, no border-bottom
    return `<div style="background:#0D9488;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;margin:-0.5in -0.6in 0;padding-left:0.6in;padding-right:0.6in;">
  <div>${logoHtml}</div>
  <div style="color:#fff;font-family:'Syne',sans-serif;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:1px;">PREPARED FOR ${escHtml(prospectName || prepared || '')}</div>
</div>`;
}

function renderDecisionMaker(section) {
    const name = fieldVal(section, 'contactNames');
    return `<div class="section-decision-maker">${escHtml(name || '')}</div>`;
}

function renderAuditSummary(section) {
    const label = fieldVal(section, 'summaryLabel') || 'Review Audit';
    const date = fieldVal(section, 'summaryDate') || '';
    const body = fieldVal(section, 'summaryBody') || '';
    return `<div class="audit-callout">
  <div class="audit-callout-icon">⚠</div>
  <div class="audit-callout-body">
    <div style="display:flex;gap:8px;align-items:baseline;">
      <span class="audit-label">${escHtml(label)}</span>
      <span class="audit-date">${escHtml(date)}</span>
    </div>
    <div class="audit-text">${escHtml(body)}</div>
  </div>
</div>`;
}

function renderHeadline(section) {
    const line1 = fieldVal(section, 'headlineLine1') || '';
    const line2 = fieldVal(section, 'headlineLine2') || '';
    return `<div class="section-headline">
  <div class="headline-line1">${escHtml(line1)}</div>
  <div class="headline-line2">${escHtml(line2)}</div>
</div>`;
}

function renderNarrative(section) {
    const body = fieldVal(section, 'narrativeBody') || '';
    return `<div class="section-narrative">${escHtml(body)}</div>`;
}

function renderStatCards(section, colors) {
    const statFields = section.fields.filter(f => f.type === 'stat_card');
    const count = statFields.length || 4;
    // Font size scales down slightly at 5+ cards to keep them on one row
    const numSize = count >= 5 ? '16pt' : '20pt';

    const cards = statFields.map(f => {
        const isRed = f.style?.numberColor === 'alertRed';
        return `<div class="stat-card">
  <div class="stat-number${isRed ? ' red' : ''}" style="font-size:${numSize}">${escHtml(String(f.number || '—'))}</div>
  <div class="stat-label">${escHtml(f.label || '')}</div>
  ${f.sublabel ? `<div class="stat-sublabel">${escHtml(f.sublabel)}</div>` : ''}
</div>`;
    }).join('\n');
    const html = `<div class="stat-strip" style="grid-template-columns:repeat(${count},1fr)">${cards}</div>`;
    return html;
}

function renderComplaintPatterns(section, alertRed) {
    const title = section.fields.find(f => f.fieldId === 'sectionTitle')?.value || 'TOP COMPLAINT PATTERNS';
    const patternsField = section.fields.find(f => f.fieldId === 'patterns');
    const patterns = patternsField?.value || [];

    const patternHtml = patterns.slice(0, 3).map((p, i) => {
        const snippets = (p.snippets || []).slice(0, 3).map(s => `"${escHtml(s)}"`).join(' &middot; ');
        return `<div class="complaint-item">
  <span class="complaint-count">${escHtml(p.count || `${i + 1}+`)}</span>
  <span class="complaint-cat" style="margin-left:6px;">${escHtml(p.category || '')}</span>
  <div class="complaint-snippets">${snippets}</div>
</div>`;
    }).join('');

    return `<div class="section-box">
  <div class="section-box-title" style="color:#111827;">${escHtml(title)}</div>
  ${patternHtml || '<div style="font-size:8pt;color:#6B7280;">Analysis pending</div>'}
</div>`;
}

function renderCustomerLove(section, successGreen) {
    const title = section.fields.find(f => f.fieldId === 'sectionTitle')?.value || 'WHAT CUSTOMERS LOVE';
    const loveField = section.fields.find(f => f.fieldId === 'lovePoints');
    const items = loveField?.value || [];

    const itemHtml = items.slice(0, 4).map(item => `<div class="love-item">
  <span class="love-label">${escHtml(item.label || '')}</span>
  <span class="love-detail"> — ${escHtml(item.detail || '')}</span>
</div>`).join('');

    return `<div class="section-box">
  <div class="section-box-title" style="color:${successGreen};">${escHtml(title)}</div>
  ${itemHtml || '<div style="font-size:8pt;color:#6B7280;">Analysis pending</div>'}
</div>`;
}

function renderSolution(section, colors) {
    const accent = colors.accent || '#F59E0B';
    const titleField = section.fields.find(f => f.fieldId === 'solutionTitle');
    const subtitleField = section.fields.find(f => f.fieldId === 'solutionSubtitle');
    const metricsField = section.fields.find(f => f.fieldId === 'outcomeMetrics');
    const productsField = section.fields.find(f => f.fieldId === 'productList');
    const pricingField = section.fields.find(f => f.fieldId === 'pricingPackage');

    const metricsHtml = (metricsField?.metrics || []).slice(0, 4).map(m => `<div class="outcome-card">
  <div class="outcome-value">${escHtml(m.value || '')}</div>
  <div class="outcome-label">${escHtml(m.label || '')}</div>
</div>`).join('');

    const pricing = pricingField?.pricing || {};

    // ISSUE 3: prefer AI-generated line items (they have pricing); filter to priced items only, max 3
    const rawLineItems = Array.isArray(pricing.lineItems) ? pricing.lineItems : [];
    const pricedLineItems = rawLineItems
        .map(item => typeof item === 'string' ? item : (item.name || ''))
        .filter(item => item.includes('$'))
        .slice(0, 3);

    // Fall back to productsField only if no priced line items from AI
    const fallbackProducts = (pricedLineItems.length === 0)
        ? (productsField?.products || []).filter(p => (p.description || '').includes('$') || (p.name || '').includes('$')).slice(0, 3)
        : [];

    const productListHtml = pricedLineItems.length
        ? pricedLineItems.map(item => `<div class="product-item"><span class="product-name">${escHtml(item)}</span></div>`).join('')
        : fallbackProducts.map(p => `<div class="product-item">
  <span class="product-name">${escHtml(p.name || '')}</span>
  ${p.description ? ` &rarr; <span>${escHtml(p.description)}</span>` : ''}
</div>`).join('');

    // monthlyTotal may already be formatted (e.g. "$348/mo") — don't double-prepend $
    const rawTotal = pricing.monthlyTotal || '';
    const formattedTotal = rawTotal
        ? (rawTotal.startsWith('$') ? rawTotal : `$${rawTotal}`)
        : '';
    const pricingHtml = (formattedTotal || pricing.packageName) ? `<div class="pricing-card">
  <div>
    <div class="pricing-package">${escHtml(pricing.packageName || '')}</div>
    ${pricing.setupFee ? `<div style="font-size:7pt;color:rgba(255,255,255,0.75);margin-top:2px;">${escHtml(pricing.setupFee)}</div>` : ''}
  </div>
  <div class="pricing-total">${escHtml(formattedTotal)}</div>
</div>` : '';

    return `<div class="section-solution">
  <div class="solution-title">${escHtml(titleField?.value || 'THE PATHSYNCH SOLUTION')}</div>
  <div class="solution-subtitle">${escHtml(subtitleField?.value || '')}</div>
  <div class="outcome-grid">${metricsHtml}</div>
  <div class="product-list">${productListHtml}</div>
  ${pricingHtml}
</div>`;
}

function renderUrgencyBadge(section) {
    // ISSUE 5: combine label + detail into one urgency text; render as full-width amber banner
    const label = fieldVal(section, 'urgencyLabel') || '';
    const detail = fieldVal(section, 'urgencyDetail') || '';
    const urgencyText = [label, detail].filter(Boolean).join(' -- ');
    return renderUrgencyBadgeText(urgencyText);
}

function renderUrgencyBadgeText(urgencyText) {
    if (!urgencyText) return '';
    return `<div style="background:#F59E0B;padding:12px 24px;text-align:center;margin:0 -0.6in;">
  <p style="margin:0;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;color:#111827;">
    &#9889; ${escHtml(urgencyText)}
  </p>
</div>`;
}

function renderCTA(section, sellerProfile) {
    const text = fieldVal(section, 'ctaLine') || '';
    // If the template has a ctaLine, use it; otherwise render the structured CTA
    if (text) {
        return `<div class="section-cta">${escHtml(text)}</div>`;
    }
    return renderCTAFallback(sellerProfile);
}

function renderCTAFallback(sellerProfile) {
    // ISSUE 6: structured closing CTA with seller info
    const sellerName = sellerProfile?.name || sellerProfile?.companyName || sellerProfile?.branding?.companyName || 'PathSynch Labs';
    const sellerEmail = sellerProfile?.email || sellerProfile?.contactEmail || 'hello@pathsynch.com';
    return `<div style="text-align:center;padding:20px 24px;border-top:1px solid #E5E7EB;">
  <p style="font-family:'DM Sans',sans-serif;font-size:14px;font-weight:600;color:#0D9488;margin:0;">
    Ready to protect your reputation? Let's talk &rarr;
  </p>
  <p style="font-family:'DM Sans',sans-serif;font-size:11px;color:#6B7280;margin:4px 0 0;">
    ${escHtml(sellerName)}${sellerEmail ? ' &middot; ' + escHtml(sellerEmail) : ''} &middot; pathsynch.com
  </p>
</div>`;
}

function renderFooter(section) {
    const parts = section.fields.map(f => {
        const val = f.value || '';
        return val ? `<span>${escHtml(val)}</span>` : '';
    }).filter(Boolean).join(' &bull; ');
    // ISSUE 7: use standard minimal footer even for template-driven sections
    if (!parts) return renderFooterFallback();
    return `<div class="section-footer">${parts}</div>`;
}

function renderFooterFallback() {
    return `<div style="text-align:center;padding:8px;background:#F9FAFB;margin:0 -0.6in -0.5in;">
  <p style="margin:0;font-size:10px;color:#9CA3AF;font-family:'DM Sans',sans-serif;">
    Generated by PathSynch SynchIntro &middot; Confidential
  </p>
</div>`;
}

function escHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Parse pasted Google Reviews text into structured review data.
 * Extracts individual reviews with ratings and categorizes as positive (4-5 star) or negative (1-3 star).
 * This is the fallback when DataForSEO is unavailable.
 */
function parsePastedReviews(rawText) {
    if (!rawText || rawText.trim().length < 50) {
        return { snippets: [], positive: [], negative: [] };
    }

    const snippets = [];
    const positive = [];
    const negative = [];

    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

    let currentReview = { text: '', rating: null, hasRating: false };
    const ownerResponsePattern = /\(Owner\)/i;
    const datePattern = /^(?:a day ago|a week ago|a month ago|\d+ (?:days?|weeks?|months?|years?) ago|New|Edited)/i;
    const metadataPattern = /^(?:Noise level|Group size|Reservation|Special offers|Wait time|Seating type|Parking|Wheelchair|Kid-friendliness|Recommendation for|Vegetarian|Photo \d|Video \d|Recommended dishes)/i;
    const pricePattern = /^\$\d+[–\-]\d+$/;
    const reviewerPattern = /^(?:.*(?:Local Guide|\d+ reviews?|\d+ photos?).*|.*\(Owner\).*)$/i;

    let skipUntilNextReview = false;

    for (const line of lines) {
        // Owner response block — skip until we see a new reviewer
        if (ownerResponsePattern.test(line)) {
            skipUntilNextReview = true;
            continue;
        }

        // Skip metadata and price lines
        if (metadataPattern.test(line) || pricePattern.test(line) || datePattern.test(line)) {
            continue;
        }

        // Skip heart/like indicators
        if (/^❤️\d*$/.test(line)) continue;

        // Detect a new reviewer name line — save previous review and start fresh
        if (reviewerPattern.test(line)) {
            if (currentReview.text.trim().length > 15) {
                saveReview(currentReview, snippets, positive, negative);
            }
            currentReview = { text: '', rating: null, hasRating: false };
            skipUntilNextReview = false;
            continue;
        }

        if (skipUntilNextReview) continue;

        // Check for rating lines (e.g. "Food: 4/5 | Service: 3/5 | Atmosphere: 5/5")
        const ratingCheck = /(?:Food|Service|Atmosphere):\s*(\d)\/5/g;
        const ratings = [];
        let match;
        while ((match = ratingCheck.exec(line)) !== null) {
            ratings.push(parseInt(match[1]));
        }

        if (ratings.length > 0) {
            const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
            currentReview.rating = Math.round(avg * 10) / 10;
            currentReview.hasRating = true;
            continue;
        }

        // Accumulate review text
        if (line.length > 10) {
            currentReview.text += (currentReview.text ? ' ' : '') + line;
        }
    }

    // Save the last review
    if (currentReview.text.trim().length > 15) {
        saveReview(currentReview, snippets, positive, negative);
    }

    return { snippets, positive, negative };
}

function saveReview(review, snippets, positive, negative) {
    const text = review.text.trim();
    if (text.length < 15) return;

    const snippet = {
        text: text.substring(0, 500),
        rating: review.rating,
        date: null,
        author: null
    };
    snippets.push(snippet);

    // Categorize: 4-5 stars = positive, 1-3 stars = negative
    // If no rating detected, use sentiment heuristics
    if (review.rating !== null) {
        if (review.rating >= 4) {
            positive.push(text.substring(0, 300));
        } else {
            negative.push(text.substring(0, 300));
        }
    } else {
        const negativeSignals = /rude|horrible|worst|terrible|awful|disgusting|never coming back|won't be back|do not recommend|disappointed|unacceptable|fired|rob|fraud|racist|racism|ignore|ignored/i;
        if (negativeSignals.test(text)) {
            negative.push(text.substring(0, 300));
        } else {
            positive.push(text.substring(0, 300));
        }
    }
}

module.exports = { generateTemplateOnePager };
