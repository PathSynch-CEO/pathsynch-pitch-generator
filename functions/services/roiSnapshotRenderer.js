/**
 * ROI Snapshot Renderer
 *
 * Produces a self-contained HTML document with the "ROI Snapshot" L2 style.
 * Numbers-forward, before/after ROI one-pager. Answers: "What does it cost to
 * do nothing?" and "What's the exact return on PathSynch?"
 *
 * Usage:
 *   renderROISnapshot(pitch, sellerProfile)
 *
 * pitch = {
 *   inputs:          { businessName, city, state, googleRating, numReviews, industry }
 *   prospect:        enriched prospect object
 *   analysis:        { complaintFrequency, responseRate, ... }
 *   sections:        resolved template sections (for AI-generated text fallbacks)
 *   solutionPackage: { packageName, products[], setupFee, monthlyTotal }
 *   marketContext:   { avgReviews, avgRating, marketLeader, marketLeaderReviews }
 *   urgencyHook:     string | null
 * }
 *
 * Wired from templateOnePager.js when l2Style === 'roi_snapshot'.
 */

'use strict';

// ── Color palette ──────────────────────────────────────────────────────────
const C = {
    teal:     '#0D9488',
    tealBg:   '#F0FDFA',
    tealBd:   '#99F6E4',
    amber:    '#D97706',
    amberBg:  '#FFFBEB',
    red:      '#DC2626',
    redBg:    '#FEF2F2',
    redBd:    '#FECACA',
    green:    '#059669',
    greenBg:  '#ECFDF5',
    greenBd:  '#A7F3D0',
    dark:     '#111827',
    text:     '#1F2937',
    muted:    '#6B7280',
    light:    '#9CA3AF',
    card:     '#FFFFFF',
    border:   '#E5E7EB',
    pageBg:   '#FCFBF8',
};

// ── HTML escape ────────────────────────────────────────────────────────────
function esc(val) {
    if (val === null || val === undefined) return '';
    return String(val)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function fmt(n) {
    if (n === null || n === undefined) return '0';
    return Number(n).toLocaleString('en-US');
}

// ── Industry average transaction values ────────────────────────────────────
const INDUSTRY_ATV = {
    'Healthcare':        250,
    'Dental':            250,
    'Restaurant':        45,
    'Food & Beverage':   45,
    'Automotive':        350,
    'Legal':             500,
    'Real Estate':       800,
    'Fitness':           80,
    'Beauty':            65,
    'Home Services':     200,
    'HVAC':              200,
    'Plumbing':          180,
    'Salon':             65,
    'Spa':               90,
    'Physical Therapy':  200,
};

function getATV(industry) {
    if (!industry) return 150;
    const exact = INDUSTRY_ATV[industry];
    if (exact) return exact;
    const lower = industry.toLowerCase();
    const match = Object.keys(INDUSTRY_ATV).find(k => lower.includes(k.toLowerCase()));
    return match ? INDUSTRY_ATV[match] : 150;
}

// ── Parse price from AI product string (e.g. "PathConnect Starter $149/mo") ──
function parseProduct(p) {
    if (typeof p === 'object' && p !== null) {
        return { name: p.name || p.productName || '', price: p.price || p.description || '' };
    }
    const str = String(p);
    const priceMatch = str.match(/\$[\d,]+(?:\/mo)?/);
    const price = priceMatch ? priceMatch[0] : '';
    const name  = str.replace(/\s*\$[\d,]+(?:\/mo)?\s*$/, '').trim();
    return { name, price };
}

// ── Extract total monthly cost from solution package ───────────────────────
function extractMonthlyTotal(solutionPackage) {
    if (!solutionPackage) return 248;
    const raw = solutionPackage.monthlyTotal || solutionPackage.total || '';
    if (typeof raw === 'number') return raw;
    const digits = parseInt(String(raw).replace(/[^0-9]/g, ''));
    return digits > 0 ? digits : 248;
}

// ── ROI calculations ───────────────────────────────────────────────────────
function buildROI(data) {
    const {
        rating, reviewCount, marketAvgReviews, marketAvgRating,
        complaintFrequency, responseRate, industry, monthlyTotal,
    } = data;

    // Presence gap — % below market average (floor 0)
    const rawGap = Math.round((1 - (reviewCount / marketAvgReviews)) * 100);
    const presenceGap = Math.max(0, Math.min(rawGap, 95));

    // Rating gap (star quality deficit)
    const ratingGap = Math.max(0, marketAvgRating - rating).toFixed(1);

    // ATV lookup
    const atv = getATV(industry);

    // Customers lost to lower visibility
    const estimatedCustomersLost = Math.max(1, Math.round(presenceGap * 0.12));
    const monthlyRevenueLost = estimatedCustomersLost * atv;

    // 90-day milestones
    const month1Reviews = reviewCount + 12;
    const month2Reviews = reviewCount + 30;
    const month3Reviews = reviewCount + 55;

    const month1Response = 50;
    const month2Response = 85;
    const month3Response = 100;

    // Rating target
    let ratingTarget;
    if (rating >= 4.8) ratingTarget = (Math.floor(rating * 10) / 10).toFixed(1) + '+';
    else if (rating >= 4.5) ratingTarget = (Math.round(rating * 10) / 10 + 0.1).toFixed(1);
    else ratingTarget = '4.5';

    // Revenue recovered (conservative: 75% of lost revenue by month 3)
    const revenueRecovered = Math.round(monthlyRevenueLost * 0.75);

    // Net gain
    const netGain = revenueRecovered - monthlyTotal;

    // Payback period
    const dailyRecovery = revenueRecovered / 30;
    const paybackDays = dailyRecovery > 0 ? Math.round(monthlyTotal / dailyRecovery) : 90;

    // ROI multiplier
    const roiMultiple = monthlyTotal > 0
        ? (revenueRecovered / monthlyTotal).toFixed(1) : '0';

    // Review growth %
    const reviewGrowth = reviewCount > 0
        ? Math.round(((month3Reviews - reviewCount) / reviewCount) * 100) : 0;

    return {
        presenceGap, ratingGap, atv,
        estimatedCustomersLost, monthlyRevenueLost,
        month1Reviews, month2Reviews, month3Reviews,
        month1Response, month2Response, month3Response,
        ratingTarget, revenueRecovered, netGain,
        paybackDays, roiMultiple, reviewGrowth,
        monthlyTotal,
    };
}

// ── Section renderers ──────────────────────────────────────────────────────

function renderHeader(d) {
    const loc = [d.city, d.state].filter(Boolean).join(', ');
    return `
<div style="background:${C.teal};padding:12px 24px;display:flex;justify-content:space-between;align-items:center;">
  <div style="font-size:14px;font-weight:800;color:#fff;letter-spacing:-0.3px;">PathSynch Labs</div>
  <div style="text-align:right;">
    <div style="font-size:10px;font-weight:700;color:#fff;letter-spacing:1.2px;text-transform:uppercase;">ROI SNAPSHOT &mdash; ${esc(d.businessName)}</div>
    ${loc ? `<div style="font-size:9px;color:rgba(255,255,255,0.7);margin-top:2px;">${esc(loc)}</div>` : ''}
  </div>
</div>`;
}

function renderCurrentState(d, roi) {
    const responseColor = d.responseRate > 50 ? C.green : C.red;
    const responseBg    = d.responseRate > 50 ? C.greenBg : C.redBg;

    const boxes = [
        {
            num:   d.rating.toFixed(1) + '★',
            label: 'RATING',
            sub:   d.reviewCount + ' reviews',
            numColor: C.teal,
            bg:    C.tealBg,
        },
        {
            num:   fmt(d.reviewCount),
            label: 'REVIEWS',
            sub:   roi.presenceGap + '% below avg',
            numColor: C.red,
            bg:    C.redBg,
        },
        {
            num:   d.complaintFrequency + '/mo',
            label: 'COMPLAINTS',
            sub:   'Service gaps',
            numColor: C.amber,
            bg:    C.amberBg,
        },
        {
            num:   d.responseRate + '%',
            label: 'RESPONSE RATE',
            sub:   d.responseRate === 0 ? 'Not responding' : d.responseRate < 30 ? 'Below average' : 'Improving',
            numColor: responseColor,
            bg:    responseBg,
        },
    ];

    const cells = boxes.map(b => `
    <div style="flex:1;background:${b.bg};border-radius:6px;padding:10px 8px;text-align:center;">
      <div style="font-size:18px;font-weight:800;color:${b.numColor};line-height:1;">${esc(b.num)}</div>
      <div style="font-size:7.5px;font-weight:700;color:${C.muted};text-transform:uppercase;letter-spacing:0.5px;margin:3px 0 2px;">${esc(b.label)}</div>
      <div style="font-size:8px;color:${C.light};">${esc(b.sub)}</div>
    </div>`).join('');

    return `
<div style="padding:10px 20px 6px;">
  <div style="font-size:9px;font-weight:700;color:${C.red};letter-spacing:0.8px;text-transform:uppercase;margin-bottom:6px;">&#9650; CURRENT STATE</div>
  <div style="display:flex;gap:6px;">${cells}</div>
</div>`;
}

function renderCostOfInaction(d, roi) {
    return `
<div style="margin:6px 20px;padding:12px 16px;background:${C.redBg};border:1px solid ${C.redBd};border-radius:8px;">
  <div style="font-size:9px;font-weight:700;color:${C.red};letter-spacing:0.5px;text-transform:uppercase;margin-bottom:4px;">
    ESTIMATED MONTHLY REVENUE LOST FROM REPUTATION GAPS
  </div>
  <div style="font-size:30px;font-weight:800;color:${C.red};line-height:1;margin-bottom:6px;">
    $${fmt(roi.monthlyRevenueLost)}
  </div>
  <div style="font-size:9px;color:${C.muted};line-height:1.4;">
    Based on <strong>${esc(String(d.reviewCount))}</strong> reviews vs. <strong>${fmt(d.marketAvgReviews)}</strong> market avg &mdash;
    an estimated <strong>${roi.estimatedCustomersLost}</strong> potential customers/mo
    choosing competitors with stronger visibility
    (avg. transaction value <strong>$${roi.atv}</strong> for ${esc(d.industry || 'this industry')})
  </div>
</div>`;
}

function renderProjection(d, roi) {
    const months = [
        {
            label: 'Month 1',
            reviews:  roi.month1Reviews,
            rating:   d.rating.toFixed(1),
            response: roi.month1Response,
            color:    C.amber,
        },
        {
            label: 'Month 2',
            reviews:  roi.month2Reviews,
            rating:   (parseFloat(d.rating) >= 4.5 ? parseFloat(d.rating) + 0.05 : parseFloat(d.rating) + 0.1).toFixed(1),
            response: roi.month2Response,
            color:    C.teal,
        },
        {
            label: 'Month 3',
            reviews:  roi.month3Reviews,
            rating:   roi.ratingTarget,
            response: roi.month3Response,
            color:    C.green,
        },
    ];

    const cols = months.map((m, i) => `
    <div style="flex:1;text-align:center;">
      <div style="font-size:9px;font-weight:700;color:${m.color};letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px;">${m.label}</div>
      <div style="background:${C.card};border:1px solid ${C.border};border-top:3px solid ${m.color};border-radius:6px;padding:10px 6px;">
        <div style="font-size:16px;font-weight:800;color:${C.text};line-height:1;">${fmt(m.reviews)}+</div>
        <div style="font-size:7px;color:${C.light};text-transform:uppercase;letter-spacing:0.4px;margin:2px 0;">reviews</div>
        <div style="font-size:14px;font-weight:700;color:${m.color};margin-top:6px;">${esc(m.rating)}★</div>
        <div style="font-size:7px;color:${C.light};text-transform:uppercase;letter-spacing:0.4px;margin:2px 0;">rating</div>
        <div style="font-size:14px;font-weight:700;color:${C.text};margin-top:6px;">${m.response}%</div>
        <div style="font-size:7px;color:${C.light};text-transform:uppercase;letter-spacing:0.4px;margin:2px 0;">response rate</div>
      </div>
      ${i < 2 ? `<div style="position:absolute;top:50%;right:-10px;transform:translateY(-50%);font-size:12px;color:${C.border};">&#8594;</div>` : ''}
    </div>`).join('');

    return `
<div style="padding:8px 20px 6px;">
  <div style="font-size:9px;font-weight:700;color:${C.amber};letter-spacing:0.8px;text-transform:uppercase;margin-bottom:8px;">&#8594; 90-DAY PROJECTION</div>
  <div style="display:flex;gap:10px;position:relative;">${cols}</div>
</div>`;
}

function renderAfterPathSynch(roi) {
    const boxes = [
        { num: roi.ratingTarget + '★', label: 'RATING MAINTAINED' },
        { num: fmt(roi.month3Reviews) + '+', label: 'TOTAL REVIEWS' },
        { num: '100%', label: 'RESPONSE RATE' },
        { num: '+' + roi.reviewGrowth + '%', label: 'REVIEW GROWTH' },
    ];

    const cells = boxes.map(b => `
    <div style="flex:1;background:${C.greenBg};border:1px solid ${C.greenBd};border-radius:6px;padding:10px 8px;text-align:center;">
      <div style="font-size:18px;font-weight:800;color:${C.green};line-height:1;">${esc(b.num)}</div>
      <div style="font-size:7px;font-weight:700;color:${C.green};text-transform:uppercase;letter-spacing:0.5px;margin-top:4px;opacity:0.8;">${esc(b.label)}</div>
    </div>`).join('');

    return `
<div style="padding:6px 20px;">
  <div style="font-size:9px;font-weight:700;color:${C.green};letter-spacing:0.8px;text-transform:uppercase;margin-bottom:6px;">&#10003; AFTER PATHSYNCH &mdash; MONTH 3</div>
  <div style="display:flex;gap:6px;">${cells}</div>
</div>`;
}

function renderROICalc(roi) {
    const rows = [
        { label: 'Monthly revenue lost (current)',      value: `-$${fmt(roi.monthlyRevenueLost)}`, color: C.red    },
        { label: 'Revenue recovered (projected month 3)', value: `+$${fmt(roi.revenueRecovered)}`, color: C.green  },
        { label: 'PathSynch monthly cost',               value: `$${fmt(roi.monthlyTotal)}/mo`,   color: C.muted  },
    ];

    const rowHtml = rows.map(r => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid ${C.border};">
      <span style="font-size:9.5px;color:${C.muted};">${esc(r.label)}</span>
      <span style="font-size:11px;font-weight:700;color:${r.color};">${esc(r.value)}</span>
    </div>`).join('');

    const netColor = roi.netGain >= 0 ? C.green : C.red;
    const netSign  = roi.netGain >= 0 ? '+' : '';

    return `
<div style="padding:6px 20px;">
  <div style="font-size:9px;font-weight:700;color:${C.teal};letter-spacing:0.8px;text-transform:uppercase;margin-bottom:6px;">&#9654; RETURN ON INVESTMENT</div>
  <div style="background:#F9FAFB;border:1px solid ${C.border};border-radius:8px;padding:10px 14px;">
    ${rowHtml}
    <div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px;border-top:2px solid ${C.teal};margin-top:4px;">
      <span style="font-size:10px;font-weight:700;color:${C.text};">Net monthly gain</span>
      <span style="font-size:16px;font-weight:800;color:${netColor};">${netSign}$${fmt(Math.abs(roi.netGain))}/mo</span>
    </div>
  </div>
</div>`;
}

function renderPaybackBadge(roi) {
    return `
<div style="margin:6px 20px;padding:14px 18px;background:${C.tealBg};border:1.5px solid ${C.tealBd};border-radius:10px;text-align:center;">
  <div style="font-size:20px;font-weight:800;color:${C.teal};line-height:1.1;">
    Pays for itself in ~${roi.paybackDays} days
  </div>
  <div style="font-size:9.5px;color:${C.muted};margin-top:6px;line-height:1.4;">
    $${fmt(roi.monthlyTotal)}/mo investment recovers
    <strong style="color:${C.teal};">$${fmt(roi.revenueRecovered)}/mo</strong>
    in visibility-driven revenue &mdash;
    <strong style="color:${C.teal};">${roi.roiMultiple}x return</strong>
  </div>
</div>`;
}

function renderSolutionBar(d, roi) {
    const products = d.products.length ? d.products : [
        { name: 'PathConnect Starter', desc: 'automated review generation', price: '$149/mo' },
        { name: 'Review Response AI',  desc: 'auto-draft + publish',         price: '$99/mo'  },
    ];

    const city  = d.city || 'local';
    const state = d.state ? ', ' + d.state : '';
    const loc   = city + state;

    const productRows = products.map(p => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
      <div>
        <span style="font-size:9.5px;font-weight:600;color:rgba(255,255,255,0.9);">${esc(p.name)}</span>
        ${p.desc ? `<span style="font-size:8.5px;color:rgba(255,255,255,0.45);"> &mdash; ${esc(p.desc)}</span>` : ''}
      </div>
      <span style="font-size:10px;font-weight:700;color:#fff;white-space:nowrap;">${esc(p.price)}</span>
    </div>`).join('');

    return `
<div style="margin:6px 20px;background:${C.dark};border-radius:10px;padding:14px 16px;">
  <div style="font-size:8px;font-weight:700;color:${C.teal};letter-spacing:1.2px;text-transform:uppercase;margin-bottom:4px;">THE PATHSYNCH SOLUTION</div>
  <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:10px;">
    ${products.length} tools. One dashboard. ${esc(loc)} results.
  </div>
  <div style="margin-bottom:8px;">${productRows}</div>
  <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid ${C.amber};padding-top:8px;">
    <span style="font-size:9px;color:${C.amber};">${esc(d.packageName || 'PathSynch Bundle')}</span>
    <span style="font-size:16px;font-weight:800;color:${C.amber};">$${fmt(roi.monthlyTotal)}/mo</span>
  </div>
</div>`;
}

function renderFooter(d) {
    const contactParts = [d.sellerEmail, 'pathsynch.com'].filter(Boolean);
    return `
<div style="padding:10px 20px 14px;border-top:1px solid ${C.border};">
  <div style="font-size:11px;font-weight:700;color:${C.teal};margin-bottom:3px;">
    Ready to turn ${fmt(d.reviewCount)} reviews into your strongest asset?
  </div>
  <div style="font-size:9px;color:${C.muted};">
    15-minute walkthrough &middot; ${contactParts.map(esc).join(' &middot; ')}
  </div>
</div>`;
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Render a complete ROI Snapshot HTML document.
 *
 * @param {Object} pitch          - { inputs, prospect, analysis, sections, solutionPackage, marketContext, urgencyHook }
 * @param {Object} sellerProfile  - Seller context (name, email, phone, branding, etc.)
 * @returns {string}              - Complete HTML document string
 */
function renderROISnapshot(pitch, sellerProfile) {
    const p = pitch || {};
    const sp = sellerProfile || {};

    // ── Extract raw data ────────────────────────────────────────────────────
    const inp  = p.inputs   || {};
    const pros = p.prospect || {};
    const anal = p.analysis || {};
    const mkt  = p.marketContext || {};
    const pkg  = p.solutionPackage || null;

    const businessName = inp.businessName || pros.businessName || 'Business';
    const city         = inp.city  || pros.city  || '';
    const state        = inp.state || pros.state || '';
    const industry     = inp.industry || pros.industry || '';
    const rating       = parseFloat(inp.googleRating || pros.rating) || 4.0;
    const reviewCount  = parseInt(inp.numReviews   || pros.reviewCount) || 0;
    const responseRate = Math.round(
        parseFloat(anal.responseRate ?? pros.responseRate ?? 0)
    );
    const complaintFrequency = Math.abs(anal.complaintFrequency ?? 2);

    const marketAvgReviews     = parseInt(mkt.avgReviews)    || 500;
    const marketAvgRating      = parseFloat(mkt.avgRating)   || 4.5;
    const marketLeader         = mkt.marketLeader            || 'Market Leader';
    const marketLeaderReviews  = parseInt(mkt.marketLeaderReviews) || 1000;

    const monthlyTotal = extractMonthlyTotal(pkg);

    // ── Solution products ──────────────────────────────────────────────────
    let products = [];
    let packageName = '';
    if (pkg) {
        packageName = pkg.packageName || '';
        if (Array.isArray(pkg.products)) {
            products = pkg.products
                .map(parseProduct)
                .filter(p => p.name)
                .slice(0, 3);
        }
    }

    // ── Seller info ────────────────────────────────────────────────────────
    const sellerEmail = sp.email || sp.branding?.email || 'hello@pathsynch.com';

    // ── Build ROI numbers ──────────────────────────────────────────────────
    const roi = buildROI({
        rating, reviewCount, marketAvgReviews, marketAvgRating,
        complaintFrequency, responseRate, industry, monthlyTotal,
    });

    const d = {
        businessName, city, state, industry,
        rating, reviewCount, responseRate, complaintFrequency,
        marketAvgReviews, marketAvgRating, marketLeader, marketLeaderReviews,
        products, packageName, monthlyTotal,
        sellerEmail,
    };

    // ── Assemble sections ──────────────────────────────────────────────────
    const bodyParts = [
        renderHeader(d),
        renderCurrentState(d, roi),
        renderCostOfInaction(d, roi),
        renderProjection(d, roi),
        renderAfterPathSynch(roi),
        renderROICalc(roi),
        renderPaybackBadge(roi),
        renderSolutionBar(d, roi),
        renderFooter(d),
    ].filter(Boolean).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ROI Snapshot &mdash; ${esc(businessName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: letter portrait; margin: 0; }
  html, body {
    background: ${C.pageBg};
    font-family: 'DM Sans', 'Helvetica Neue', Arial, sans-serif;
    font-size: 12px;
    color: ${C.text};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .roi-page {
    max-width: 612px;
    min-height: 792px;
    margin: 0 auto;
    background: ${C.pageBg};
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  @media print {
    html, body { background: ${C.pageBg}; }
    .roi-page { max-width: 100%; min-height: 10.5in; box-shadow: none; page-break-after: avoid; }
  }
</style>
</head>
<body>
<div class="roi-page">
${bodyParts}
</div>
</body>
</html>`;
}

module.exports = { renderROISnapshot };
