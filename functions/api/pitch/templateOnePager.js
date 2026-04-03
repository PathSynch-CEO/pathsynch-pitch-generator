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
const { buildAndExecuteBatchPrompt } = require('../../services/templatePromptBuilder');
const { resolveAllSections } = require('../../services/templateSectionResolver');

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
                topComplaintPattern: 'service consistency',
                topComplaintCategory: 'SERVICE',
                complaintFrequency: 2,
                reviewVolumeAssessment: 'growing',
                urgencyHook: null,
                projectedOutcomes: [
                    { value: '30+', label: 'NEW REVIEWS IN 90 DAYS' },
                    { value: '4.5', label: 'RATING TARGET' },
                    { value: '100%', label: 'REVIEW RESPONSE RATE' },
                    { value: '1', label: 'UNIFIED DASHBOARD' }
                ]
            },
            enrichmentMeta: { elapsed: 0, creditsUsed: 0, error: err.message }
        };
    }

    // ── Step 4: Build + Execute Batch Gemini Prompt ──────────────────────────
    const sellerProfile = options.sellerContext || {};
    let aiResults = {};
    try {
        aiResults = await buildAndExecuteBatchPrompt(
            template.sections,
            enrichedData,
            template.generationRules,
            sellerProfile
        );
    } catch (err) {
        console.error('[TemplateOnePager] Gemini batch generation failed:', err.message);
        // Continue with empty aiResults — resolveSection handles nulls gracefully
    }

    // ── Step 5: Resolve All Sections ────────────────────────────────────────
    const pitch = buildPitchData(inputs, options, sellerProfile);
    const sections = resolveAllSections(
        template.sections,
        enrichedData,
        aiResults,
        sellerProfile,
        pitch
    );

    // ── Step 6: Generate HTML from resolved sections ─────────────────────────
    const html = renderOnePagerHtml(sections, template, sellerProfile, enrichedData.prospect);

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
        pricingLineItems: inputs.pricingLineItems || [],
        setupFee: inputs.setupFee || null,
        monthlyTotal: inputs.monthlyTotal || null,
        pricingHighlight: inputs.pricingHighlight || null
    };
}

/**
 * Render resolved sections into HTML.
 * Produces a print-ready one-pager with the Review Audit template design.
 */
function renderOnePagerHtml(sections, template, sellerProfile, prospect) {
    const colors = template.layout?.colorScheme || {};
    const primary = colors.primary || '#0D9488';
    const accent = colors.accent || '#F59E0B';
    const dark = colors.dark || '#111827';
    const muted = colors.muted || '#6B7280';
    const bg = colors.background || '#FCFBF8';
    const cardBg = colors.cardBg || '#F9FAFB';
    const alertRed = colors.alertRed || '#EF4444';
    const successGreen = colors.successGreen || '#10B981';

    const sectionHtmlParts = sections.map(section => renderSection(section, colors));

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
  .stat-strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
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
 * Render a single resolved section to HTML
 */
function renderSection(section, colors) {
    const alertRed = colors.alertRed || '#EF4444';
    const successGreen = colors.successGreen || '#10B981';

    switch (section.sectionId) {
        case 'header': return renderHeader(section);
        case 'decisionMaker': return renderDecisionMaker(section);
        case 'auditSummary': return renderAuditSummary(section);
        case 'headline': return renderHeadline(section);
        case 'narrativeParagraph': return renderNarrative(section);
        case 'statCards': return renderStatCards(section, colors);
        case 'complaintPatterns': return renderComplaintPatterns(section, alertRed);
        case 'customerLove': return renderCustomerLove(section, successGreen);
        case 'solution': return renderSolution(section, colors);
        case 'urgencyBadge': return renderUrgencyBadge(section);
        case 'closingCTA': return renderCTA(section);
        case 'footer': return renderFooter(section);
        default: return `<!-- section: ${section.sectionId} -->`;
    }
}

function fieldVal(section, fieldId) {
    return section.fields.find(f => f.fieldId === fieldId)?.value ?? null;
}

function renderHeader(section) {
    const logo = section.fields.find(f => f.fieldId === 'logo');
    const prepared = fieldVal(section, 'preparedFor');

    // Only render an img tag for genuine URLs — never for fallback text strings
    const logoVal = logo?.value || '';
    const isLogoUrl = logoVal && (
        logoVal.startsWith('http://') ||
        logoVal.startsWith('https://') ||
        logoVal.startsWith('/') ||
        logoVal.startsWith('data:')
    );
    const logoHtml = isLogoUrl
        ? `<img src="${escHtml(logoVal)}" alt="Logo" style="height:28px;">`
        : `<span class="header-logo" style="color:#0D9488;font-weight:700;">PathSynch Labs</span>`;

    return `<div class="section-header">
  <div>${logoHtml}</div>
  <div class="header-prepared">${escHtml(prepared || '')}</div>
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
    const cards = statFields.map(f => {
        const isRed = f.style?.numberColor === 'alertRed';
        return `<div class="stat-card">
  <div class="stat-number${isRed ? ' red' : ''}">${escHtml(String(f.number || '—'))}</div>
  <div class="stat-label">${escHtml(f.label || '')}</div>
  ${f.sublabel ? `<div class="stat-sublabel">${escHtml(f.sublabel)}</div>` : ''}
</div>`;
    }).join('\n');
    return `<div class="stat-strip">${cards}</div>`;
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

    const productsHtml = (productsField?.products || []).map(p => `<div class="product-item">
  <span class="product-name">${escHtml(p.name || '')}</span>
  ${p.description ? ` &rarr; <span>${escHtml(p.description)}</span>` : ''}
</div>`).join('');

    const pricing = pricingField?.pricing || {};
    // Render line items (from solutionPackage.products array) as a list above the total
    const lineItems = Array.isArray(pricing.lineItems) ? pricing.lineItems : [];
    const lineItemsHtml = lineItems.length
        ? `<div style="margin-bottom:6px;">${lineItems.map(item => `<div class="product-item"><span class="product-name">${escHtml(typeof item === 'string' ? item : (item.name || ''))}</span></div>`).join('')}</div>`
        : '';
    // monthlyTotal may already be formatted (e.g. "$348/mo") — don't double-prepend $
    const rawTotal = pricing.monthlyTotal || '';
    const formattedTotal = rawTotal
        ? (rawTotal.startsWith('$') ? rawTotal : `$${rawTotal}`)
        : '';
    const pricingHtml = (formattedTotal || pricing.packageName) ? `<div class="pricing-card">
  <div>
    <div class="pricing-package">${escHtml(pricing.packageName || 'PathSynch Package')}</div>
    ${pricing.setupFee ? `<div style="font-size:7pt;color:rgba(255,255,255,0.75);margin-top:2px;">${escHtml(pricing.setupFee)}</div>` : ''}
  </div>
  <div class="pricing-total">${escHtml(formattedTotal)}</div>
</div>` : '';

    return `<div class="section-solution">
  <div class="solution-title">${escHtml(titleField?.value || 'THE PATHSYNCH SOLUTION')}</div>
  <div class="solution-subtitle">${escHtml(subtitleField?.value || '')}</div>
  <div class="outcome-grid">${metricsHtml}</div>
  <div class="product-list">${productsHtml}</div>
  ${lineItemsHtml}
  ${pricingHtml}
</div>`;
}

function renderUrgencyBadge(section) {
    const label = fieldVal(section, 'urgencyLabel') || '';
    const detail = fieldVal(section, 'urgencyDetail') || '';
    return `<div>
  <span class="urgency-badge">
    <span class="urgency-label">${escHtml(label)}</span>
  </span>
  ${detail ? `<span class="urgency-detail" style="margin-left:8px;">${escHtml(detail)}</span>` : ''}
</div>`;
}

function renderCTA(section) {
    const text = fieldVal(section, 'ctaLine') || '';
    return `<div class="section-cta">${escHtml(text)}</div>`;
}

function renderFooter(section) {
    const parts = section.fields.map(f => {
        const val = f.value || '';
        return val ? `<span>${escHtml(val)}</span>` : '';
    }).filter(Boolean).join(' &bull; ');
    return `<div class="section-footer">${parts}</div>`;
}

function escHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

module.exports = { generateTemplateOnePager };
