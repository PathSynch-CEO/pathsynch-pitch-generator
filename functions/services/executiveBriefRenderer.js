/**
 * Executive Brief Renderer
 *
 * Produces a self-contained HTML document with the "Executive Brief" L2 style.
 * Boardroom-quality layout: fixed 10-section structure, system fonts, max-width 612px.
 *
 * Usage:
 *   renderExecutiveBrief({ sections, prospect, analysis, urgencyHook }, sellerProfile)
 *
 * Wired from templateOnePager.js when inputs.l2Style === 'executive_brief'.
 * Takes the same resolved sections data produced by resolveAllSections().
 */

'use strict';

// ── Color palette ──────────────────────────────────────────────────────────
const C = {
    teal:    '#0D9488',
    amber:   '#D97706',
    red:     '#DC2626',
    green:   '#059669',
    purple:  '#7C3AED',
    bg:      '#FCFBF8',
    card:    '#FFFFFF',
    text:    '#1F2937',
    muted:   '#6B7280',
    light:   '#9CA3AF',
    redBg:   '#FEF2F2',
    greenBg: '#F0FDF4',
    tealBg:  '#F0FDFA',
    amberBg: '#FFFBEB',
    border:  '#E5E7EB',
};

// ── HTML escape ────────────────────────────────────────────────────────────
function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Section/field lookup helpers ───────────────────────────────────────────
function findSection(sections, sectionId) {
    return sections?.find(s => s.sectionId === sectionId) || null;
}

function findField(section, fieldId) {
    return section?.fields?.find(f => f.fieldId === fieldId) || null;
}

/** Get a text/ai_generated field value from a named section */
function fv(sections, sectionId, fieldId) {
    return findField(findSection(sections, sectionId), fieldId)?.value ?? null;
}

/** Get a stat_card field (returns { number, label, sublabel }) */
function fStat(sections, sectionId, fieldId) {
    const f = findField(findSection(sections, sectionId), fieldId);
    if (!f) return null;
    return { number: f.number || '—', label: f.label || '', sublabel: f.sublabel || '' };
}

// ── Data extraction from resolved sections + prospect/analysis fallbacks ───
function extractData(sections, prospect, analysis, urgencyHook, sellerProfile) {
    const sp = sellerProfile || {};
    const branding = sp.branding || {};

    // Business identity
    const businessName = prospect?.businessName
        || fv(sections, 'header', 'preparedFor')
        || 'the business';

    const rawLogoUrl = fv(sections, 'header', 'logo') || branding.logoUrl || sp.logoUrl || null;
    const logoUrl = rawLogoUrl && /^(https?:|data:)/i.test(String(rawLogoUrl)) ? rawLogoUrl : null;

    // Decision maker (from resolved section or direct prospect data)
    const dmSection = findSection(sections, 'decisionMaker');
    const dmName  = fv(sections, 'decisionMaker', 'ownerName')
        || prospect?.decisionMaker?.name || prospect?.contacts?.[0]?.name || null;
    const dmTitle = fv(sections, 'decisionMaker', 'ownerTitle')
        || prospect?.decisionMaker?.title || prospect?.contacts?.[0]?.title || null;

    // Audit summary / alert box
    // Field IDs match template sections: summaryBody (not summaryText), urgencyBadge section
    const summaryText   = fv(sections, 'auditSummary', 'summaryBody') || null;
    const urgencyLabel  = fv(sections, 'urgencyBadge', 'urgencyLabel') || 'TIME-SENSITIVE';
    const urgencyDetail = fv(sections, 'urgencyBadge', 'urgencyDetail') || urgencyHook || null;

    // Headline / narrative
    // Field IDs: headlineLine1 (not headlineText), narrativeParagraph section / narrativeBody (not narrativeText)
    const headlineText  = fv(sections, 'headline', 'headlineLine1') || null;
    const headlineLine2 = fv(sections, 'headline', 'headlineLine2') || null;
    const narrativeText = fv(sections, 'narrativeParagraph', 'narrativeBody') || null;

    // Stat cards
    const statSec = findSection(sections, 'statCards');
    const ratingField     = findField(statSec, 'googleRating');
    const reviewsField    = findField(statSec, 'reviewCount');
    const complaintsField = findField(statSec, 'complaintFrequency');
    const responseField   = findField(statSec, 'ownerResponseCount');

    const ratingNum     = ratingField?.number
        || (prospect?.rating != null ? String(prospect.rating) : '—');
    const reviewsNum    = reviewsField?.number
        || (prospect?.reviewCount != null ? String(prospect.reviewCount) : '—');
    const complaintsNum = complaintsField?.number
        || (analysis?.complaintFrequency != null
            ? Math.abs(analysis.complaintFrequency) + '/mo' : '—');
    const responseNum   = responseField?.number
        || String(prospect?.ownerResponseCount ?? 0);

    // Complaint patterns
    const patternsField = findField(findSection(sections, 'complaintPatterns'), 'patterns');
    const patterns = Array.isArray(patternsField?.value)
        ? patternsField.value.slice(0, 3) : [];

    // What customers love
    // Section ID is 'customerLove' (not 'whatCustomersLove') — matches renderSection() switch
    const loveField  = findField(findSection(sections, 'customerLove'), 'lovePoints');
    const lovePoints = Array.isArray(loveField?.value) && loveField.value.length > 0
        ? loveField.value.slice(0, 4)
        : [];

    // Solution / pricing
    const solutionSec = findSection(sections, 'solution');
    let pricing  = null;
    let products = [];

    if (solutionSec) {
        const pricingField  = solutionSec.fields?.find(f => f.type === 'pricing_block');
        const productField  = solutionSec.fields?.find(f => f.type === 'product_line_items');
        if (pricingField?.pricing) pricing = pricingField.pricing;
        if (productField?.products?.length) products = productField.products.slice(0, 3);
    }

    // Fall back to pricing line items if no product field
    if (products.length === 0 && pricing?.lineItems?.length) {
        products = pricing.lineItems
            .map(p => typeof p === 'string' ? { name: p } : p)
            .filter(p => p?.name)
            .slice(0, 3);
    }

    // Outcomes grid (4 tiles)
    let outcomes = [];
    const outcomeField = findField(solutionSec, 'projectedOutcomes')
        || findField(solutionSec, 'outcomes');
    if (Array.isArray(outcomeField?.value)) {
        outcomes = outcomeField.value.slice(0, 4);
    } else if (Array.isArray(analysis?.projectedOutcomes)) {
        outcomes = analysis.projectedOutcomes.slice(0, 4);
    }
    if (outcomes.length === 0) {
        const r = parseFloat(prospect?.rating);
        let ratingTarget = '4.5';
        if (r >= 4.8) ratingTarget = '4.9+';
        else if (r >= 4.5) ratingTarget = (Math.round(r * 10) / 10 + 0.1).toFixed(1);
        outcomes = [
            { value: '30+', label: 'NEW REVIEWS IN 90 DAYS' },
            { value: ratingTarget, label: 'RATING TARGET' },
            { value: '100%', label: 'REVIEW RESPONSE RATE' },
            { value: '1', label: 'UNIFIED DASHBOARD' }
        ];
    }

    // Urgency badge text (section 9)
    const urgencyText = fv(sections, 'urgencyBadge', 'urgencyText')
        || urgencyDetail || urgencyHook || null;

    // CTA line — from AI-generated field in closingCTA section
    const ctaLine = fv(sections, 'closingCTA', 'ctaLine') || null;

    // Seller contact info
    const sellerName    = sp.name || sp.sellerName || '';
    const sellerPhone   = sp.phone || branding.phone || '';
    const sellerEmail   = sp.email || branding.email || '';
    const companyName   = sp.companyName || 'PathSynch';
    const tagline       = branding.tagline || 'Reputation Intelligence Platform';
    const bookingUrl    = sp.bookingUrl || branding.bookingUrl || null;

    const today = new Date().toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric'
    });

    return {
        businessName, logoUrl,
        dmName, dmTitle,
        summaryText, urgencyLabel, urgencyDetail,
        headlineText, headlineLine2, narrativeText,
        ratingNum, reviewsNum, complaintsNum, responseNum,
        patterns, lovePoints,
        pricing, products, outcomes,
        urgencyText, ctaLine,
        sellerName, sellerPhone, sellerEmail,
        companyName, tagline, bookingUrl, today
    };
}

// ── Section renderers ──────────────────────────────────────────────────────

function renderTopBar() {
    return `<div style="height:4px;background:${C.teal};width:100%;"></div>`;
}

function renderHeader(d) {
    const logoHtml = d.logoUrl
        ? `<img src="${esc(d.logoUrl)}" alt="Logo" style="height:36px;max-width:140px;object-fit:contain;">`
        : `<div style="font-size:14px;font-weight:800;color:${C.teal};letter-spacing:-0.5px;">${esc(d.companyName)}</div>`;

    const dmLine = (d.dmName || d.dmTitle)
        ? `<div style="font-size:10px;color:${C.muted};margin-top:3px;">
             ${d.dmName ? esc(d.dmName) : ''}${d.dmName && d.dmTitle ? ' &bull; ' : ''}${d.dmTitle ? esc(d.dmTitle) : ''}
           </div>`
        : '';

    return `
<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:16px 24px 12px;border-bottom:1px solid ${C.border};">
  <div style="display:flex;align-items:center;">${logoHtml}</div>
  <div style="text-align:right;">
    <div style="font-size:9px;font-weight:700;color:${C.teal};letter-spacing:1px;text-transform:uppercase;">PREPARED FOR</div>
    <div style="font-size:14px;font-weight:800;color:${C.text};margin-top:2px;">${esc(d.businessName)}</div>
    ${dmLine}
    <div style="font-size:9px;color:${C.light};margin-top:3px;">${esc(d.today)}</div>
  </div>
</div>`;
}

function renderAlertBox(d) {
    if (!d.summaryText && !d.urgencyDetail) return '';
    const text  = d.summaryText  || '';
    const uhook = d.urgencyDetail || '';
    return `
<div style="margin:12px 24px;padding:12px 14px;background:${C.redBg};border-left:4px solid ${C.red};border-radius:4px;">
  <div style="display:flex;align-items:flex-start;gap:10px;">
    <div style="font-size:16px;line-height:1;flex-shrink:0;">&#9888;</div>
    <div>
      ${text ? `<div style="font-size:10px;font-weight:700;color:${C.red};letter-spacing:0.5px;text-transform:uppercase;margin-bottom:3px;">KEY FINDING</div>
      <div style="font-size:11px;color:${C.text};line-height:1.4;">${esc(text)}</div>` : ''}
      ${uhook ? `<div style="font-size:10px;color:${C.muted};margin-top:${text ? '6px' : '0'};font-style:italic;">
        <span style="font-weight:700;color:${C.red};font-style:normal;">${esc(d.urgencyLabel)}:</span> ${esc(uhook)}
      </div>` : ''}
    </div>
  </div>
</div>`;
}

function renderHeadlineSection(d) {
    if (!d.headlineText && !d.headlineLine2 && !d.narrativeText) return '';
    const parts = [];

    parts.push(`<div style="padding:12px 24px 8px;">`);
    parts.push(`<div style="font-size:9px;font-weight:700;color:${C.teal};letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">REPUTATION INTELLIGENCE</div>`);

    if (d.headlineText) {
        parts.push(`<div style="font-size:20px;font-weight:800;color:${C.text};line-height:1.15;">${esc(d.headlineText)}</div>`);
    }
    if (d.headlineLine2) {
        parts.push(`<div style="font-size:20px;font-weight:800;color:${C.amber};line-height:1.15;">${esc(d.headlineLine2)}</div>`);
    }
    if (d.narrativeText) {
        parts.push(`<div style="font-size:11px;color:${C.muted};line-height:1.5;margin-top:8px;">${esc(d.narrativeText)}</div>`);
    }
    parts.push(`</div>`);
    return parts.join('\n');
}

function renderStatStrip(d) {
    const stats = [
        { num: d.ratingNum,     label: 'GOOGLE RATING',       color: C.teal  },
        { num: d.reviewsNum,    label: 'TOTAL REVIEWS',        color: C.text  },
        { num: d.complaintsNum, label: 'MONTHLY COMPLAINTS',   color: C.red   },
        { num: d.responseNum,   label: 'RESPONSE RATE',         color: C.muted },
    ];

    const cells = stats.map(s => {
        let displayNum = s.num;
        if (/RESPONSE RATE/i.test(s.label) && /^\d+$/.test(String(s.num))) {
            displayNum = s.num + '%';
        }
        return `
  <div style="flex:1;background:${C.card};border-radius:6px;padding:10px 8px;text-align:center;border:1px solid ${C.border};">
    <div style="font-size:22px;font-weight:800;color:${s.color};line-height:1;">${esc(displayNum)}</div>
    <div style="font-size:8px;font-weight:600;color:${C.muted};text-transform:uppercase;letter-spacing:0.5px;margin-top:4px;">${esc(s.label)}</div>
  </div>`;
    }).join('');

    // Competitor context benchmark line — mirrors templateOnePager.js renderStatCards()
    const ratingVal = parseFloat(d.ratingNum) || 0;
    const reviewVal = parseInt(String(d.reviewsNum || '').replace(/,/g, '')) || 0;
    let benchmarkHtml = '';
    if (ratingVal > 0 && reviewVal > 0) {
        if (ratingVal >= 4.5 && reviewVal >= 500) {
            benchmarkHtml = `<div style="text-align:center;font-size:6.5pt;color:#6B7280;margin:-2px 24px 4px;font-style:italic;">Your ${ratingVal}&#9733; across ${reviewVal.toLocaleString()} reviews puts you in the top tier for your market. The question is what\u2019s hiding in the negative patterns.</div>`;
        } else if (ratingVal >= 4.3) {
            benchmarkHtml = `<div style="text-align:center;font-size:6.5pt;color:#6B7280;margin:-2px 24px 4px;font-style:italic;">Most businesses in your category average 4.1\u20134.3&#9733;. Your ${ratingVal}&#9733; is competitive \u2014 protecting it is the priority.</div>`;
        } else {
            benchmarkHtml = `<div style="text-align:center;font-size:6.5pt;color:#6B7280;margin:-2px 24px 4px;font-style:italic;">Local competitors in your category average 4.1\u20134.3&#9733;. Closing the gap starts with addressing the patterns below.</div>`;
        }
    }

    return `
<div style="display:flex;gap:8px;padding:8px 24px;">
  ${cells}
</div>${benchmarkHtml}`;
}

function renderComplaintPatterns(patterns) {
    if (!patterns.length) return '';
    const barColors = [C.red, C.amber, '#EA580C'];

    const cards = patterns.map((p, i) => {
        const color   = barColors[i] || C.muted;
        const count   = p.count || '—';
        const cat     = p.category || '';
        const snippets = Array.isArray(p.snippets) ? p.snippets.slice(0, 2) : [];
        const snippetHtml = snippets.length
            ? `<div style="font-size:9px;color:${C.muted};font-style:italic;margin-top:4px;">${snippets.map(s => `"${esc(s)}"`).join(' &nbsp;&bull;&nbsp; ')}</div>`
            : '';
        return `
  <div style="flex:1;background:${C.card};border-radius:6px;overflow:hidden;border:1px solid ${C.border};display:flex;">
    <div style="width:4px;background:${color};flex-shrink:0;"></div>
    <div style="padding:10px 10px 10px 10px;flex:1;">
      <div style="font-size:20px;font-weight:800;color:${color};line-height:1;">${esc(count)}</div>
      <div style="font-size:9px;font-weight:700;color:${C.text};text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;">${esc(cat)}</div>
      ${snippetHtml}
    </div>
  </div>`;
    }).join('');

    return `
<div style="padding:8px 24px;">
  <div style="font-size:9px;font-weight:700;color:${C.muted};text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">COMPLAINT PATTERNS</div>
  <div style="display:flex;gap:8px;">
    ${cards}
  </div>
</div>`;
}

function renderLovePoints(lovePoints) {
    if (!lovePoints.length) return '';
    const items = lovePoints.map(lp => `
    <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;">
      <div style="width:6px;height:6px;border-radius:50%;background:${C.green};margin-top:4px;flex-shrink:0;"></div>
      <div style="font-size:10px;line-height:1.4;color:${C.text};">
        <span style="font-weight:700;">${esc(lp.label || '')}</span>${lp.detail ? ': ' + esc(lp.detail) : ''}
      </div>
    </div>`).join('');

    return `
<div style="margin:8px 24px;padding:12px 14px;background:${C.greenBg};border-radius:6px;border:1px solid #BBF7D0;">
  <div style="font-size:9px;font-weight:700;color:${C.green};letter-spacing:0.8px;text-transform:uppercase;margin-bottom:8px;">&#10003; WHAT CUSTOMERS LOVE</div>
  ${items}
</div>`;
}

function renderSolution(d) {
    const outcomeCells = d.outcomes.slice(0, 4).map(o => `
    <div style="flex:1;background:rgba(255,255,255,0.12);border-radius:5px;padding:8px 6px;text-align:center;">
      <div style="font-size:18px;font-weight:800;color:#FFFFFF;line-height:1;">${esc(o.value)}</div>
      <div style="font-size:7px;color:rgba(255,255,255,0.8);text-transform:uppercase;letter-spacing:0.5px;margin-top:3px;">${esc(o.label)}</div>
    </div>`).join('');

    const productPills = d.products.length
        ? d.products.map(p => {
            const name  = typeof p === 'string' ? p : (p.name || p.productName || '');
            const price = typeof p === 'object'
                ? (p.monthlyPrice || p.price || p.oneTimeFee || null)
                : null;
            const priceStr = price ? esc(String(price).startsWith('$') ? price : `$${price}`) : '';
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.12);">
              <span style="font-size:10px;color:#fff;font-weight:600;">${esc(name)}</span>
              ${priceStr ? `<span style="font-size:10px;color:rgba(255,255,255,0.85);font-weight:700;">${priceStr}/mo</span>` : ''}
            </div>`;
        }).join('')
        : '';

    return `
<div style="margin:8px 24px;padding:14px 16px;background:${C.teal};border-radius:8px;">
  <div style="font-size:9px;font-weight:700;color:rgba(255,255,255,0.7);letter-spacing:1px;text-transform:uppercase;">PATHSYNCH SOLUTION</div>
  <div style="font-size:13px;font-weight:700;color:#fff;margin-top:3px;margin-bottom:10px;">What Changes in 90 Days</div>
  <div style="display:flex;gap:6px;">${outcomeCells}</div>
  ${productPills ? `<div style="margin-top:10px;border-top:1px solid rgba(255,255,255,0.2);padding-top:8px;">${productPills}</div>` : ''}
  <div style="margin-top:10px;font-size:7.5px;color:rgba(255,255,255,0.55);line-height:1.4;">Methodology: Review targets based on trailing 90-day velocity from pasted Google review timestamps. Response rate calculated from owner reply patterns detected in review text.</div>
</div>`;
}

function renderPricingAndUrgency(d) {
    const hasPricing  = d.pricing && (d.pricing.monthlyTotal || d.pricing.packageName);
    const hasUrgency  = !!d.urgencyText;
    if (!hasPricing && !hasUrgency) return '';

    const pricingBox = hasPricing ? `
  <div style="flex:1;background:${C.card};border:2px solid ${C.teal};border-radius:8px;padding:12px 14px;">
    <div style="font-size:9px;font-weight:700;color:${C.teal};letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;">INVESTMENT</div>
    ${d.pricing.packageName ? `<div style="font-size:10px;font-weight:700;color:${C.text};">${esc(d.pricing.packageName)}</div>` : ''}
    ${d.pricing.monthlyTotal ? `<div style="font-size:24px;font-weight:800;color:${C.teal};line-height:1;margin-top:4px;">${esc(d.pricing.monthlyTotal)}</div>
    ${!/mo|month/i.test(String(d.pricing.monthlyTotal)) ? `<div style="font-size:8px;color:${C.muted};">per month</div>` : ''}` : ''}
    ${d.pricing.setupFee ? `<div style="font-size:9px;color:${C.muted};margin-top:6px;">${esc(d.pricing.setupFee)}</div>` : ''}
  </div>` : `<div style="flex:1;"></div>`;

    const urgencyBox = hasUrgency ? `
  <div style="flex:1;background:${C.amberBg};border:1px solid ${C.amber};border-radius:8px;padding:12px 14px;display:flex;align-items:center;gap:8px;">
    <div style="font-size:20px;flex-shrink:0;">&#9889;</div>
    <div>
      <div style="font-size:9px;font-weight:700;color:${C.amber};letter-spacing:0.5px;text-transform:uppercase;margin-bottom:4px;">ACT NOW</div>
      <div style="font-size:10px;color:${C.text};line-height:1.4;font-weight:500;">${esc(d.urgencyText)}</div>
    </div>
  </div>` : '';

    return `
<div style="display:flex;gap:10px;padding:8px 24px;">
  ${pricingBox}
  ${urgencyBox}
</div>`;
}

function renderFooter(d) {
    // Use AI-generated ctaLine if available; fall back to generic if field is missing (pipeline debug signal)
    const ctaText = d.ctaLine
        ? esc(d.ctaLine)
        : `Schedule a 15-minute call to see exactly how we do this for ${esc(d.businessName)}.`;
    const bookingLink = d.bookingUrl
        ? `<a href="${esc(d.bookingUrl)}" style="color:${C.teal};font-weight:700;text-decoration:none;">Book a Call &rarr;</a>`
        : '';

    const contactLine = [d.sellerName, d.sellerPhone, d.sellerEmail]
        .filter(Boolean).map(esc).join(' &bull; ');

    return `
<div style="margin-top:auto;">
  <div style="padding:12px 24px;border-top:1px solid ${C.border};">
    <div style="font-size:11px;font-weight:600;color:${C.text};margin-bottom:4px;">${ctaText}${bookingLink ? ' ' + bookingLink : ''}</div>
    ${contactLine ? `<div style="font-size:9px;color:${C.muted};margin-top:3px;">${contactLine}</div>` : ''}
    <div style="font-size:9px;color:${C.light};margin-top:2px;">${esc(d.companyName)}${d.tagline ? ' &bull; ' + esc(d.tagline) : ''}</div>
  </div>
  <div style="height:4px;background:${C.teal};width:100%;"></div>
</div>`;
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Render a complete Executive Brief HTML document.
 *
 * @param {Object} pitch           - { sections, prospect, analysis, urgencyHook }
 * @param {Object} sellerProfile   - Seller context (name, email, phone, branding, etc.)
 * @returns {string}               - Complete HTML document string
 */
function renderExecutiveBrief(pitch, sellerProfile) {
    const { sections = [], prospect = {}, analysis = {}, urgencyHook = null } = pitch || {};
    const d = extractData(sections, prospect, analysis, urgencyHook, sellerProfile);

    const bodyParts = [
        renderTopBar(),
        renderHeader(d),
        renderAlertBox(d),
        renderHeadlineSection(d),
        renderStatStrip(d),
        renderComplaintPatterns(d.patterns),
        renderLovePoints(d.lovePoints),
        renderSolution(d),
        renderPricingAndUrgency(d),
        renderFooter(d),
    ].filter(Boolean).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Executive Brief &mdash; ${esc(d.businessName)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: letter portrait; margin: 0.4in; }
  html, body { background: ${C.bg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; color: ${C.text}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .brief-page { max-width: 612px; min-height: 792px; margin: 0 auto; background: ${C.bg}; display: flex; flex-direction: column; overflow: hidden; }
  @media print { html, body { background: ${C.bg}; } .brief-page { max-width: 100%; min-height: 10in; box-shadow: none; } }
</style>
</head>
<body>
<div class="brief-page">
${bodyParts}
</div>
</body>
</html>`;
}

module.exports = { renderExecutiveBrief };
