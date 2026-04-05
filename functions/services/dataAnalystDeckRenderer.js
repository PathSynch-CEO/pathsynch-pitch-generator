/**
 * Data Analyst Deck Renderer
 *
 * Generates a 10-slide PPTX presentation and HTML preview
 * from real Market Intelligence data for the L3 Data Analyst style.
 *
 * Exports:
 *   renderDataAnalystDeck(pitch, sellerProfile, marketReport) → { buffer, filename }
 *   renderDataAnalystHTML(pitch, sellerProfile, marketReport) → HTML string
 */

const PptxGenJS = require('pptxgenjs');

// ── Brand constants (hex without #) ────────────────────────────────────────
const B = {
    teal:      '0D9488',
    tealLight: 'CCFBF1',
    tealDim:   'E0F7F4',
    amber:     'F59E0B',
    amberLight:'FFFBEB',
    red:       'DC2626',
    redLight:  'FEF2F2',
    green:     '059669',
    greenLight:'ECFDF5',
    dark:      '111827',
    text:      '1F2937',
    muted:     '6B7280',
    light:     'D1D5DB',
    border:    'E5E7EB',
    card:      'F9FAFB',
    white:     'FFFFFF',
    darkGreen: '134E4A'
};

const INDUSTRY_ATV = {
    healthcare: 250, dental: 250, medical: 200,
    restaurant: 45, food: 45,
    automotive: 350, auto: 350,
    legal: 500, attorney: 500, law: 500,
    hvac: 350, plumbing: 300, electrical: 280,
    salon: 80, spa: 100, beauty: 80,
    fitness: 90, gym: 90,
    default: 150
};

// ── Data extraction ─────────────────────────────────────────────────────────
function extractData(pitch, sellerProfile, marketReport) {
    const inputs  = pitch.inputs  || pitch || {};
    const analysis = pitch.analysis || {};
    const sp      = pitch.solutionPackage || {};
    const mc      = pitch.marketContext  || marketReport || {};

    const businessName   = inputs.businessName  || pitch.businessName  || 'Business';
    const city           = inputs.city || (inputs.address || '').split(',')[0].trim() || '';
    const state          = inputs.state || '';
    const industry       = inputs.industry || 'Healthcare';
    const rating         = parseFloat(inputs.googleRating || inputs.rating || pitch.googleRating) || 4.0;
    const reviewCount    = parseInt(inputs.numReviews || inputs.reviewCount || pitch.numReviews) || 0;
    const responseRate   = parseFloat(analysis.responseRate || 0);
    const complaintFreq  = Math.abs(analysis.complaintFrequency || 2);
    // opportunityScore: from pitch.prospect (set by generator), analysis, or find matching lead in mc
    const matchedLeadScore = mc.leads?.find(l => l.name === inputs.businessName)?.opportunityScore || 0;
    const oppScore       = parseInt(pitch.prospect?.opportunityScore || analysis.opportunityScore || matchedLeadScore || 0);
    const seoTier        = analysis.seoTier || mc.seoLandscape?.tier || 'moderate';

    // Market data — benchmarks may be nested (mc.benchmarks) or flat (mc itself)
    const benchmarks         = mc.benchmarks || mc.report?.benchmarks || mc;
    const marketAvgRating    = parseFloat(benchmarks.avgRating    || mc.avgRating)    || 4.5;
    const marketAvgReviews   = parseInt(benchmarks.avgReviews     || mc.avgReviews)   || 500;
    // marketLeader may be stored as a string name OR as an object {name, rating, reviews}
    const mlRaw              = benchmarks.marketLeader || mc.marketLeader || {};
    const mlObj              = typeof mlRaw === 'object' && mlRaw !== null ? mlRaw : {};
    const marketLeaderName   = mlObj.name
        || benchmarks.marketLeader   // may be a string
        || mc.marketLeader           // may be a string
        || benchmarks.leader?.name
        || 'Market Leader';
    const marketLeaderRating = parseFloat(
        mlObj.rating || benchmarks.marketLeaderRating || mc.marketLeaderRating || mlObj.rating
    ) || 4.8;
    const marketLeaderReviews = parseInt(
        mlObj.reviews || mlObj.reviewCount || benchmarks.marketLeaderReviews || mc.marketLeaderReviews
    ) || 1000;
    const totalCompetitors   = parseInt(benchmarks.totalCompetitors || mc.totalCompetitors) || 20;
    const qualifiedLeads     = mc.qualifiedLeads?.length || mc.leads?.length || 5;
    const competitorNarrative= mc.competitorAnalysis?.narrative || analysis.competitorNarrative || '';

    // Competitors: prefer mc.competitors, fall back to leads array (from market intel path)
    const rawCompetitors = mc.competitors
        || mc.report?.competitors
        || mc.leads?.map(l => ({ name: l.name, rating: l.rating, reviewCount: l.reviews || l.reviewCount }))
        || [];
    const competitors = rawCompetitors.slice(0, 20).map(c => ({
        name: c.name || '',
        rating: parseFloat(c.rating) || 4.2,
        reviewCount: parseInt(c.reviewCount || c.reviews) || 100
    })).filter(c => c.name);

    // Calculations
    const presenceGap       = marketAvgReviews > 0
        ? Math.round((1 - (reviewCount / marketAvgReviews)) * 100) : 0;
    const allReviews        = [reviewCount, marketLeaderReviews, ...competitors.map(c => c.reviewCount), 10];
    const maxReviews        = Math.max(...allReviews) * 1.1;
    const voiceShare        = marketAvgReviews * totalCompetitors > 0
        ? ((reviewCount / (marketAvgReviews * totalCompetitors)) * 100).toFixed(1) : '0.0';
    const leaderVoiceShare  = marketAvgReviews * totalCompetitors > 0
        ? ((marketLeaderReviews / (marketAvgReviews * totalCompetitors)) * 100).toFixed(1) : '0.0';

    const industryKey = Object.keys(INDUSTRY_ATV).find(k => industry.toLowerCase().includes(k)) || 'default';
    const atv          = INDUSTRY_ATV[industryKey];
    const customersLost       = Math.max(0, Math.round(presenceGap * 0.12));
    const monthlyRevenueLost  = customersLost * atv;
    const revenueRecovered    = Math.round(monthlyRevenueLost * 0.75);
    const monthlyTotal        = parseInt(sp.totalMonthly) || 248;
    const netGain             = revenueRecovered - monthlyTotal;
    const paybackDays         = monthlyTotal > 0 ? Math.round(monthlyTotal / Math.max(revenueRecovered / 30, 1)) : 90;
    const roiMultiple         = monthlyTotal > 0 ? (revenueRecovered / monthlyTotal).toFixed(1) : '0';
    const month1Reviews       = reviewCount + 12;
    const month2Reviews       = reviewCount + 33;
    const month3Reviews       = reviewCount + 58;
    const ratingTarget        = rating >= 4.8 ? `${rating.toFixed(1)}+` : (rating + 0.1).toFixed(1);

    const products  = sp.products || [
        { name: 'PathConnect Starter', price: '$149/mo' },
        { name: 'Review Response AI',  price: '$99/mo'  }
    ];
    const setupFee  = sp.setupFee || '$299 one-time';

    const sellerName  = sellerProfile?.name || sellerProfile?.displayName || 'Charles Berry';
    const sellerEmail = sellerProfile?.email || 'hello@pathsynch.com';
    const sellerTitle = sellerProfile?.title || 'CEO & Founder, PathSynch Labs';

    // Voice of customer
    const complaints = analysis.complaints || analysis.negativeSnippets || [];
    const loves      = analysis.loves      || analysis.positiveSnippets  || [];
    const defaultLoves = ['Excellent clinical care', 'Professional staff', 'Welcoming atmosphere', 'Community trust'];
    const defaultComplaints = [
        { category: 'Service consistency', count: 4 },
        { category: 'Scheduling friction',  count: 3 },
        { category: 'Follow-up lapses',     count: 2 }
    ];

    return {
        businessName, city, state, industry, rating, reviewCount, responseRate,
        complaintFreq, oppScore, seoTier, marketAvgRating, marketAvgReviews,
        marketLeaderName, marketLeaderRating, marketLeaderReviews, totalCompetitors,
        qualifiedLeads, competitorNarrative, competitors, presenceGap, maxReviews,
        voiceShare, leaderVoiceShare, atv, customersLost, monthlyRevenueLost,
        revenueRecovered, monthlyTotal, netGain, paybackDays, roiMultiple,
        month1Reviews, month2Reviews, month3Reviews, ratingTarget,
        products, setupFee, sellerName, sellerEmail, sellerTitle,
        complaints, loves, defaultLoves, defaultComplaints
    };
}

// ── PPTX helpers ─────────────────────────────────────────────────────────────
function accentBar(slide) {
    slide.addShape('rect', { x: 0, y: 0, w: 10, h: 0.08, fill: { color: B.teal }, line: { type: 'none' } });
}
function slideNum(slide, n) {
    slide.addText(`${n} / 10`, { x: 8.5, y: 5.25, w: 1.1, h: 0.3, fontSize: 9, color: B.muted, align: 'right', fontFace: 'Arial' });
}
function slideTitle(slide, text) {
    slide.addText(text, { x: 0.4, y: 0.18, w: 9.2, h: 0.45, fontSize: 20, bold: true, color: B.dark, fontFace: 'Arial' });
}
function slideSubtitle(slide, text) {
    slide.addText(text, { x: 0.4, y: 0.63, w: 9.2, h: 0.27, fontSize: 11, color: B.teal, fontFace: 'Arial' });
}
function rect(slide, x, y, w, h, color, lineColor) {
    const opts = { x, y, w, h, fill: { color }, line: { type: lineColor ? 'solid' : 'none', color: lineColor || B.border, pt: 0.5 } };
    slide.addShape('rect', opts);
}
function dot(slide, cx, cy, r, color) {
    slide.addShape('ellipse', { x: cx - r, y: cy - r, w: r * 2, h: r * 2, fill: { color }, line: { type: 'none' } });
}
function txt(slide, text, x, y, w, h, opts = {}) {
    slide.addText(text, { x, y, w, h, fontFace: 'Arial', fontSize: 11, color: B.text, wrap: true, ...opts });
}

// Convert rating + reviews to plot coordinates
// Plot area: x=1.2, y=1.0 → x=9.0, y=4.9 (w=7.8, h=3.9)
const PLOT = { x: 1.2, y: 1.0, w: 7.8, h: 3.9, rMin: 3.5, rMax: 5.0 };
function toPlotXY(reviews, rating, maxRev) {
    const px = PLOT.x + (Math.min(reviews, maxRev) / maxRev) * PLOT.w;
    const py = (PLOT.y + PLOT.h) - ((rating - PLOT.rMin) / (PLOT.rMax - PLOT.rMin)) * PLOT.h;
    return { px: Math.max(PLOT.x, Math.min(px, PLOT.x + PLOT.w)), py: Math.max(PLOT.y, Math.min(py, PLOT.y + PLOT.h)) };
}

// ── Slide builders ─────────────────────────────────────────────────────────
function slide1(pptx, d) {
    const slide = pptx.addSlide();
    slide.background = { color: B.darkGreen };
    accentBar(slide);

    // Badge
    txt(slide, 'REPUTATION INTELLIGENCE BRIEFING', 0.4, 0.5, 5.8, 0.3, { fontSize: 9, bold: true, color: '5EEAD4', charSpacing: 1 });
    // Business name
    txt(slide, d.businessName, 0.4, 0.85, 5.8, 0.9, { fontSize: 26, bold: true, color: B.white });
    // Location
    if (d.city) txt(slide, `${d.city}${d.state ? ', ' + d.state : ''}`, 0.4, 1.8, 5.8, 0.4, { fontSize: 14, color: 'A7F3D0' });
    // Market context
    const ctxLines = [
        `${d.city} ${d.industry} Market`,
        `${d.totalCompetitors} competitors analyzed  ·  ${d.qualifiedLeads} qualified leads identified`,
        `Market leader: ${d.marketLeaderName} (${d.marketLeaderReviews.toLocaleString()} reviews)`,
        `Prepared by PathSynch Labs  ·  ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
    ].join('\n');
    txt(slide, ctxLines, 0.4, 2.3, 5.8, 2.2, { fontSize: 11, color: '6EE7B7', lineSpacingMultiple: 1.6 });

    // 3 stat cards on right
    const cards = [
        { label: 'Google Rating', value: `${d.rating}★`, color: B.teal },
        { label: 'Reviews',       value: d.reviewCount.toLocaleString(), color: B.red },
        { label: 'Opportunity',   value: d.oppScore > 0 ? `${d.oppScore}/100` : '—', color: B.amber }
    ];
    cards.forEach((c, i) => {
        const cy = 0.5 + i * 1.62;
        rect(slide, 6.5, cy, 3.1, 1.45, '1A3C35');
        txt(slide, c.value, 6.5, cy + 0.1, 3.1, 0.75, { fontSize: 26, bold: true, color: c.color, align: 'center' });
        txt(slide, c.label, 6.5, cy + 0.85, 3.1, 0.4, { fontSize: 10, color: '9CA3AF', align: 'center' });
    });

    slideNum(slide, 1);
    return slide;
}

function slide2(pptx, d) {
    const slide = pptx.addSlide();
    slide.background = { color: B.white };
    accentBar(slide);
    slideTitle(slide, 'Where you stand today');
    slideSubtitle(slide, 'Slide 2 — Reputation snapshot');

    // 4 KPI cards
    const cards = [
        { v: `${d.rating}★`, l: 'Google Rating',   sub: d.rating > d.marketAvgRating ? `Above ${d.marketAvgRating} avg` : `Below ${d.marketAvgRating} avg`, bg: d.rating >= d.marketAvgRating ? B.greenLight : B.redLight, vc: d.rating >= d.marketAvgRating ? B.green : B.red },
        { v: d.reviewCount.toLocaleString(), l: 'Reviews', sub: `${Math.abs(d.presenceGap)}% ${d.presenceGap > 0 ? 'below' : 'above'} avg`, bg: B.redLight, vc: B.red },
        { v: `${d.complaintFreq}/mo`, l: 'Complaint Rate', sub: d.complaintFreq > 3 ? 'High — needs attention' : 'Manageable', bg: B.amberLight, vc: B.amber },
        { v: `${d.responseRate}%`, l: 'Response Rate', sub: d.responseRate < 50 ? 'Low — revenue risk' : 'Solid', bg: d.responseRate < 50 ? B.redLight : B.greenLight, vc: d.responseRate < 50 ? B.red : B.green }
    ];
    const cW = 2.2, gap = (9.2 - 4 * cW) / 3;
    cards.forEach((c, i) => {
        const cx = 0.4 + i * (cW + gap);
        rect(slide, cx, 1.0, cW, 1.5, c.bg);
        txt(slide, c.v, cx, 1.1, cW, 0.65, { fontSize: 22, bold: true, color: c.vc, align: 'center' });
        txt(slide, c.l, cx, 1.75, cW, 0.3, { fontSize: 10, bold: true, color: B.text, align: 'center' });
        txt(slide, c.sub, cx, 2.05, cW, 0.3, { fontSize: 9, color: B.muted, align: 'center' });
    });

    // Alert box
    rect(slide, 0.4, 2.65, 9.2, 2.1, 'FFF1F2', B.red);
    rect(slide, 0.4, 2.65, 0.08, 2.1, B.red);
    const alertText = `Your ${d.rating}★ rating is exceptional, but with only ${d.reviewCount.toLocaleString()} reviews you're nearly invisible in local search. ${d.marketLeaderName} dominates with ${d.marketLeaderReviews.toLocaleString()} reviews — ${Math.round(d.marketLeaderReviews / Math.max(d.reviewCount, 1))}× your volume — capturing the majority of new patient searches in your market.`;
    txt(slide, alertText, 0.6, 2.75, 8.9, 1.9, { fontSize: 12, color: B.red, lineSpacingMultiple: 1.5 });

    slideNum(slide, 2);
    return slide;
}

function slide3(pptx, d) {
    const slide = pptx.addSlide();
    slide.background = { color: B.white };
    accentBar(slide);
    slideTitle(slide, `Your position in the ${d.city} ${d.industry} market`);
    slideSubtitle(slide, 'Slide 3 — Positioning matrix (rating vs. review volume)');

    // Opportunity zone (top-left: high rating ≥4.5, low reviews ≤avg*0.5)
    const zoneMaxRev = Math.min(d.marketAvgReviews * 0.5, d.maxReviews);
    const zoneW = (zoneMaxRev / d.maxReviews) * PLOT.w;
    const zoneTopY = PLOT.y; // rating=5.0
    const zoneBotY = PLOT.y + PLOT.h - ((4.5 - PLOT.rMin) / (PLOT.rMax - PLOT.rMin)) * PLOT.h;
    rect(slide, PLOT.x, zoneTopY, zoneW, zoneBotY - zoneTopY, B.tealDim);
    txt(slide, 'OPPORTUNITY\nZONE', PLOT.x + 0.05, zoneTopY + 0.05, Math.max(zoneW - 0.1, 0.8), 0.45,
        { fontSize: 8, bold: true, color: B.teal, align: 'center' });

    // Axes (draw as thin rects)
    rect(slide, PLOT.x, PLOT.y + PLOT.h, PLOT.w, 0.02, B.light);   // X axis
    rect(slide, PLOT.x, PLOT.y, 0.02, PLOT.h, B.light);             // Y axis

    // Y-axis ticks & labels
    [3.5, 4.0, 4.5, 5.0].forEach(r => {
        const { py } = toPlotXY(0, r, d.maxReviews);
        rect(slide, PLOT.x - 0.08, py, 0.08, 0.02, B.light);
        txt(slide, `${r}★`, 0.4, py - 0.15, 0.7, 0.3, { fontSize: 9, color: B.muted, align: 'right' });
    });

    // X-axis ticks & labels
    [0, 0.25, 0.5, 0.75, 1.0].forEach(pct => {
        const xv = Math.round(pct * d.maxReviews);
        const px = PLOT.x + pct * PLOT.w;
        rect(slide, px, PLOT.y + PLOT.h, 0.02, 0.08, B.light);
        txt(slide, xv.toLocaleString(), px - 0.2, PLOT.y + PLOT.h + 0.1, 0.4, 0.25, { fontSize: 8, color: B.muted, align: 'center' });
    });

    // Axis labels
    txt(slide, 'Review Volume →', PLOT.x, PLOT.y + PLOT.h + 0.4, PLOT.w, 0.25,
        { fontSize: 9, color: B.muted, align: 'center' });
    txt(slide, 'Rating', 0.1, PLOT.y + PLOT.h / 2 - 0.1, 0.7, 0.25,
        { fontSize: 9, color: B.muted, align: 'center' });

    // Competitor dots (gray)
    d.competitors.forEach(c => {
        const { px, py } = toPlotXY(c.reviewCount, Math.max(PLOT.rMin, Math.min(c.rating, PLOT.rMax)), d.maxReviews);
        dot(slide, px, py, 0.07, B.light);
    });

    // Market leader (amber diamond-ish — use larger circle)
    const { px: lpx, py: lpy } = toPlotXY(d.marketLeaderReviews, d.marketLeaderRating, d.maxReviews);
    dot(slide, lpx, lpy, 0.12, B.amber);
    txt(slide, d.marketLeaderName.split(' ')[0], lpx - 0.5, lpy - 0.3, 1.0, 0.22,
        { fontSize: 8, bold: true, color: B.amber, align: 'center' });

    // "You" dot (teal, larger)
    const { px: ypx, py: ypy } = toPlotXY(d.reviewCount, d.rating, d.maxReviews);
    dot(slide, ypx, ypy, 0.14, B.teal);
    txt(slide, 'YOU', ypx - 0.3, ypy - 0.32, 0.6, 0.22,
        { fontSize: 9, bold: true, color: B.teal, align: 'center' });

    // Legend (bottom right)
    [[B.teal, 'You'], [B.amber, 'Market leader'], [B.light, 'Competitors']].forEach(([c, lbl], i) => {
        const lx = 6.8 + i * 0.95;
        dot(slide, lx + 0.08, 5.1, 0.07, c);
        txt(slide, lbl, lx + 0.2, 5.0, 0.75, 0.22, { fontSize: 8, color: B.muted });
    });

    slideNum(slide, 3);
    return slide;
}

function slide4(pptx, d) {
    const slide = pptx.addSlide();
    slide.background = { color: B.white };
    accentBar(slide);
    slideTitle(slide, 'How you compare');
    slideSubtitle(slide, 'Slide 4 — Head-to-head competitive snapshot');

    const ratingWin  = d.rating >= d.marketAvgRating;
    const reviewWin  = d.reviewCount >= d.marketAvgReviews;
    const responseWin= d.responseRate >= 50;
    const seoWin     = d.seoTier === 'strong';

    const rows = [
        [
            { text: 'Metric',             options: { bold: true, fill: { color: B.teal }, color: B.white, align: 'center', valign: 'middle' } },
            { text: d.businessName,       options: { bold: true, fill: { color: B.teal }, color: B.white, align: 'center', valign: 'middle' } },
            { text: d.marketLeaderName,   options: { bold: true, color: B.text,  align: 'center', valign: 'middle', fill: { color: B.card } } },
            { text: 'Market Avg',         options: { bold: true, color: B.text,  align: 'center', valign: 'middle', fill: { color: B.card } } }
        ],
        [
            { text: 'Google Rating',      options: { color: B.text, valign: 'middle' } },
            { text: `${d.rating}★`,       options: { bold: true, color: ratingWin ? B.green : B.red, align: 'center', valign: 'middle', fill: { color: ratingWin ? B.greenLight : B.redLight } } },
            { text: `${d.marketLeaderRating}★`, options: { align: 'center', valign: 'middle', color: B.text } },
            { text: `${d.marketAvgRating}★`,    options: { align: 'center', valign: 'middle', color: B.muted } }
        ],
        [
            { text: 'Review Count',       options: { color: B.text, valign: 'middle' } },
            { text: d.reviewCount.toLocaleString(), options: { bold: true, color: reviewWin ? B.green : B.red, align: 'center', valign: 'middle', fill: { color: reviewWin ? B.greenLight : B.redLight } } },
            { text: d.marketLeaderReviews.toLocaleString(), options: { align: 'center', valign: 'middle', color: B.text } },
            { text: d.marketAvgReviews.toLocaleString(),    options: { align: 'center', valign: 'middle', color: B.muted } }
        ],
        [
            { text: 'Response Rate',      options: { color: B.text, valign: 'middle' } },
            { text: `${d.responseRate}%`, options: { bold: true, color: responseWin ? B.green : B.red, align: 'center', valign: 'middle', fill: { color: responseWin ? B.greenLight : B.redLight } } },
            { text: 'N/A',                options: { align: 'center', valign: 'middle', color: B.muted } },
            { text: 'N/A',                options: { align: 'center', valign: 'middle', color: B.muted } }
        ],
        [
            { text: 'SEO Tier',           options: { color: B.text, valign: 'middle' } },
            { text: d.seoTier,            options: { bold: true, color: seoWin ? B.green : B.red, align: 'center', valign: 'middle', fill: { color: seoWin ? B.greenLight : B.redLight } } },
            { text: 'Strong',             options: { align: 'center', valign: 'middle', color: B.text } },
            { text: 'Moderate',           options: { align: 'center', valign: 'middle', color: B.muted } }
        ],
        [
            { text: 'Voice Share',        options: { color: B.text, valign: 'middle' } },
            { text: `${d.voiceShare}%`,   options: { bold: true, color: B.red, align: 'center', valign: 'middle', fill: { color: B.redLight } } },
            { text: `${d.leaderVoiceShare}%`, options: { align: 'center', valign: 'middle', color: B.text } },
            { text: '5.0%',               options: { align: 'center', valign: 'middle', color: B.muted } }
        ]
    ];

    slide.addTable(rows, {
        x: 0.4, y: 0.95, w: 9.2,
        colW: [2.4, 2.3, 2.3, 2.2],
        rowH: 0.58,
        fontSize: 11,
        fontFace: 'Arial',
        border: { pt: 0.5, color: B.border }
    });

    slideNum(slide, 4);
    return slide;
}

function slide5(pptx, d) {
    const slide = pptx.addSlide();
    slide.background = { color: B.white };
    accentBar(slide);
    slideTitle(slide, 'What your customers are saying');
    slideSubtitle(slide, 'Slide 5 — Voice of the customer');

    // Left column: Loves
    rect(slide, 0.4, 0.95, 4.4, 4.3, B.greenLight);
    txt(slide, '✓  What they love', 0.5, 1.05, 4.2, 0.4, { fontSize: 12, bold: true, color: B.green });

    const loves = d.loves.length > 0
        ? d.loves.slice(0, 4).map(l => typeof l === 'string' ? l : (l.category || l.theme || String(l)))
        : d.defaultLoves;
    loves.slice(0, 4).forEach((item, i) => {
        txt(slide, `• ${item}`, 0.55, 1.55 + i * 0.7, 4.1, 0.55, { fontSize: 11, color: '065F46', lineSpacingMultiple: 1.3 });
    });

    // Right column: Complaints
    rect(slide, 5.0, 0.95, 4.6, 4.3, B.redLight);
    txt(slide, '⚠  What\'s hurting you', 5.1, 1.05, 4.4, 0.4, { fontSize: 12, bold: true, color: B.red });

    const complaints = d.complaints.length > 0
        ? d.complaints.slice(0, 3).map(c => typeof c === 'string' ? c : `${c.category || c.theme || 'Issue'} (${c.count || '2'}+)`)
        : d.defaultComplaints.map(c => `${c.category} (${c.count}+)`);
    complaints.slice(0, 3).forEach((item, i) => {
        txt(slide, `• ${item}`, 5.15, 1.55 + i * 0.85, 4.3, 0.65, { fontSize: 11, color: '991B1B', lineSpacingMultiple: 1.3 });
    });

    slideNum(slide, 5);
    return slide;
}

function slide6(pptx, d) {
    const slide = pptx.addSlide();
    slide.background = { color: B.white };
    accentBar(slide);
    slideTitle(slide, 'What this gap is costing you');
    slideSubtitle(slide, 'Slide 6 — Cost of inaction');

    // Left: big number
    txt(slide, 'MONTHLY REVENUE LOST', 0.4, 0.95, 4.5, 0.3, { fontSize: 9, bold: true, color: B.red, charSpacing: 0.5 });
    const lostStr = `$${d.monthlyRevenueLost.toLocaleString()}`;
    txt(slide, lostStr, 0.4, 1.3, 4.5, 0.9, { fontSize: 38, bold: true, color: B.red });
    const mathText = `Based on ${d.presenceGap}% presence gap × ${d.customersLost} estimated customers/mo × $${d.atv} avg transaction`;
    txt(slide, mathText, 0.4, 2.3, 4.4, 0.7, { fontSize: 10, color: B.muted, lineSpacingMultiple: 1.5 });

    // Potential recovered
    rect(slide, 0.4, 3.1, 4.4, 1.2, B.greenLight);
    txt(slide, `$${d.revenueRecovered.toLocaleString()}/mo recoverable`, 0.5, 3.2, 4.2, 0.45,
        { fontSize: 16, bold: true, color: B.green });
    txt(slide, `With PathSynch capturing 75% of lost revenue`, 0.5, 3.65, 4.2, 0.5, { fontSize: 10, color: '065F46' });

    // Right: horizontal bars
    txt(slide, 'Review volume = search visibility', 5.0, 0.95, 4.6, 0.3, { fontSize: 9, bold: true, color: B.muted, charSpacing: 0.5 });
    const barData = [
        { label: 'You', value: d.reviewCount, color: B.red },
        { label: 'Market avg', value: d.marketAvgReviews, color: B.muted },
        { label: d.marketLeaderName.split(' ')[0], value: d.marketLeaderReviews, color: B.teal }
    ];
    const barMaxVal = Math.max(...barData.map(b => b.value));
    const barMaxW   = 4.3;
    barData.forEach((b, i) => {
        const barY   = 1.3 + i * 1.15;
        const barW   = (b.value / barMaxVal) * barMaxW;
        txt(slide, b.label, 5.0, barY, 4.5, 0.3, { fontSize: 10, bold: true, color: B.text });
        rect(slide, 5.0, barY + 0.35, barMaxW, 0.35, B.border);
        rect(slide, 5.0, barY + 0.35, Math.max(barW, 0.05), 0.35, b.color);
        txt(slide, b.value.toLocaleString(), 5.0 + barW + 0.08, barY + 0.38, 0.8, 0.3,
            { fontSize: 10, bold: true, color: b.color });
    });

    slideNum(slide, 6);
    return slide;
}

function slide7(pptx, d) {
    const slide = pptx.addSlide();
    slide.background = { color: B.white };
    accentBar(slide);
    slideTitle(slide, 'Competitive landscape analysis');
    slideSubtitle(slide, 'Slide 7 — AI-generated market narrative');

    const narrative = d.competitorNarrative ||
        `The ${d.city} ${d.industry} market features ${d.totalCompetitors} competitors with ${d.marketLeaderName} leading at ${d.marketLeaderReviews.toLocaleString()} reviews. Most established practices sit in the 200-500 review range, creating a clear split between high-volume, moderate-quality operators and high-quality, low-visibility practices like ${d.businessName}. This fragmentation creates a significant window: businesses that combine strong ratings with review volume gains tend to capture disproportionate search visibility within 90 days.`;

    // Left border
    rect(slide, 0.4, 0.95, 0.06, 3.7, B.teal);
    txt(slide, narrative, 0.6, 1.0, 8.9, 3.6, { fontSize: 12, color: B.text, lineSpacingMultiple: 1.7, wrap: true });

    txt(slide, `AI-generated analysis from ${d.totalCompetitors} competitors · PathSynch Market Intelligence`,
        0.4, 4.75, 9.2, 0.3, { fontSize: 9, color: B.muted });

    slideNum(slide, 7);
    return slide;
}

function slide8(pptx, d) {
    const slide = pptx.addSlide();
    slide.background = { color: B.white };
    accentBar(slide);
    slideTitle(slide, 'How PathSynch closes each gap');
    slideSubtitle(slide, 'Slide 8 — Gap-to-solution map');

    const gaps = [
        {
            problem: `${d.reviewCount.toLocaleString()} reviews (${d.presenceGap}% below market avg)`,
            solution: 'PathConnect Starter — NFC tap cards + automated review requests (+15 reviews/mo)'
        },
        {
            problem: `${d.responseRate}% review response rate`,
            solution: 'Review Response AI — auto-draft replies, approve in one click, 100% coverage'
        },
        {
            problem: `${d.complaintFreq} complaint patterns/month`,
            solution: 'Real-time alerts — flag negative reviews for staff action before they spread'
        }
    ];
    if (d.seoTier !== 'strong') {
        gaps.push({
            problem: `SEO tier: ${d.seoTier} — below-average local search visibility`,
            solution: 'LocalSynch — GBP optimization + directory sync + keyword positioning'
        });
    }

    gaps.slice(0, 4).forEach((g, i) => {
        const ry = 0.95 + i * 1.05;
        rect(slide, 0.4, ry, 4.0, 0.85, B.redLight, B.red);
        txt(slide, g.problem, 0.5, ry + 0.08, 3.8, 0.7, { fontSize: 10, color: B.red, lineSpacingMultiple: 1.3 });
        txt(slide, '→', 4.5, ry + 0.2, 0.5, 0.45, { fontSize: 18, bold: true, color: B.teal, align: 'center' });
        rect(slide, 5.1, ry, 4.5, 0.85, B.tealDim, B.teal);
        txt(slide, g.solution, 5.2, ry + 0.08, 4.3, 0.7, { fontSize: 10, color: '0F766E', lineSpacingMultiple: 1.3 });
    });

    slideNum(slide, 8);
    return slide;
}

function slide9(pptx, d) {
    const slide = pptx.addSlide();
    slide.background = { color: B.white };
    accentBar(slide);
    slideTitle(slide, '90-day plan and return on investment');
    slideSubtitle(slide, 'Slide 9 — Investment and ROI');

    // 3 timeline cards
    const months = [
        { mo: 'Month 1', reviews: d.month1Reviews, resp: '50%',  color: B.amber,  bg: B.amberLight },
        { mo: 'Month 2', reviews: d.month2Reviews, resp: '85%',  color: B.teal,   bg: B.tealDim   },
        { mo: 'Month 3', reviews: d.month3Reviews, resp: '100%', color: B.green,  bg: B.greenLight }
    ];
    months.forEach((m, i) => {
        const cx = 0.4 + i * 3.1;
        rect(slide, cx, 0.95, 2.85, 1.55, m.bg);
        rect(slide, cx, 0.95, 2.85, 0.3, m.color);
        txt(slide, m.mo.toUpperCase(), cx, 0.95, 2.85, 0.3, { fontSize: 9, bold: true, color: B.white, align: 'center', valign: 'middle' });
        txt(slide, `${m.reviews}+ reviews`, cx, 1.3, 2.85, 0.45, { fontSize: 14, bold: true, color: m.color, align: 'center' });
        txt(slide, `${m.resp} response rate`, cx, 1.75, 2.85, 0.4, { fontSize: 10, color: B.muted, align: 'center' });
    });

    // Bottom left: package
    rect(slide, 0.4, 2.65, 4.4, 2.3, B.dark);
    txt(slide, 'PathSynch Package', 0.5, 2.72, 4.2, 0.38, { fontSize: 11, bold: true, color: B.white });
    const products = d.products.slice(0, 3);
    products.forEach((p, i) => {
        txt(slide, p.name || p, 0.5, 3.15 + i * 0.43, 2.8, 0.38, { fontSize: 10, color: 'D1FAE5' });
        txt(slide, p.price || '', 3.0, 3.15 + i * 0.43, 1.7, 0.38, { fontSize: 10, color: B.amber, align: 'right', bold: true });
    });
    const totalY = 3.15 + products.length * 0.43;
    rect(slide, 0.4, totalY, 4.4, 0.02, B.muted);
    txt(slide, `Total: $${d.monthlyTotal}/mo + ${d.setupFee}`, 0.5, totalY + 0.08, 4.2, 0.35,
        { fontSize: 10, bold: true, color: B.amber });

    // Bottom right: ROI cards
    const roiCards = [
        { v: `+$${d.netGain.toLocaleString()}/mo`, l: 'Net monthly gain after PathSynch', bg: B.tealDim, vc: B.teal },
        { v: `~${d.paybackDays} days`, l: 'Pays for itself in', bg: B.greenLight, vc: B.green },
        { v: `${d.roiMultiple}×`, l: 'Return on investment', bg: B.amberLight, vc: B.amber }
    ];
    roiCards.forEach((rc, i) => {
        const ry = 2.65 + i * 0.72;
        rect(slide, 5.0, ry, 4.6, 0.65, rc.bg);
        txt(slide, rc.v, 5.1, ry + 0.05, 2.0, 0.55, { fontSize: 16, bold: true, color: rc.vc, valign: 'middle' });
        txt(slide, rc.l, 7.15, ry + 0.13, 2.35, 0.4, { fontSize: 10, color: B.muted, valign: 'middle' });
    });

    slideNum(slide, 9);
    return slide;
}

function slide10(pptx, d) {
    const slide = pptx.addSlide();
    slide.background = { color: B.darkGreen };
    accentBar(slide);

    txt(slide, "Let's get started", 0.4, 0.6, 9.2, 0.65, { fontSize: 22, bold: true, color: B.white, align: 'center' });

    const steps = [
        { n: '1', title: '15-min walkthrough',   sub: 'See it work for your practice' },
        { n: '2', title: '30-day pilot',          sub: 'PathConnect with 15 patients'  },
        { n: '3', title: 'Full deployment',       sub: 'Both tools, reviews growing'   }
    ];
    steps.forEach((s, i) => {
        const sx = 0.5 + i * 3.15;
        rect(slide, sx, 1.4, 2.85, 1.8, '1A3C35');
        txt(slide, s.n, sx + 0.15, 1.5, 0.5, 0.5, { fontSize: 18, bold: true, color: B.teal });
        txt(slide, s.title, sx + 0.1, 2.05, 2.6, 0.4, { fontSize: 12, bold: true, color: B.white });
        txt(slide, s.sub, sx + 0.1, 2.5, 2.6, 0.55, { fontSize: 10, color: '6EE7B7' });
    });

    // Contact
    txt(slide, `${d.sellerEmail}  ·  pathsynch.com  ·  synchintro.ai`,
        0.4, 3.45, 9.2, 0.4, { fontSize: 12, color: '9CA3AF', align: 'center' });
    txt(slide, `${d.sellerName}  ·  ${d.sellerTitle}`,
        0.4, 3.85, 9.2, 0.35, { fontSize: 11, color: B.white, align: 'center' });
    txt(slide,
        `Data sourced from ${d.city} ${d.industry} Market Intelligence Report · ${d.totalCompetitors} competitors analyzed`,
        0.4, 5.0, 9.2, 0.28, { fontSize: 8, color: B.muted, align: 'center' });

    slideNum(slide, 10);
    return slide;
}

// ── Main PPTX export ─────────────────────────────────────────────────────────
async function renderDataAnalystDeck(pitch, sellerProfile, marketReport) {
    const d    = extractData(pitch, sellerProfile, marketReport);
    const pptx = new PptxGenJS();

    pptx.layout  = 'LAYOUT_16x9';
    pptx.author  = 'PathSynch SynchIntro';
    pptx.title   = `${d.businessName} — Reputation Intelligence Briefing`;
    pptx.subject = 'Market Intelligence Analysis';
    pptx.company = 'PathSynch Labs';

    slide1(pptx, d);
    slide2(pptx, d);
    slide3(pptx, d);
    slide4(pptx, d);
    slide5(pptx, d);
    slide6(pptx, d);
    slide7(pptx, d);
    slide8(pptx, d);
    slide9(pptx, d);
    slide10(pptx, d);

    const buffer   = await pptx.write({ outputType: 'nodebuffer' });
    const safeName = (d.businessName || 'pitch').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `${safeName}_data_analyst.pptx`;

    return { buffer, filename };
}

// ── HTML preview ─────────────────────────────────────────────────────────────
function renderDataAnalystHTML(pitch, sellerProfile, marketReport) {
    const d = extractData(pitch, sellerProfile, marketReport);
    const narrative = d.competitorNarrative ||
        `The ${d.city} ${d.industry} market features ${d.totalCompetitors} competitors with ${d.marketLeaderName} leading at ${d.marketLeaderReviews.toLocaleString()} reviews. Most sit in the 200-500 review range, creating a clear split between high-volume operators and high-quality, low-visibility practices like ${d.businessName}. This fragmentation creates a significant window: businesses that combine strong ratings with review volume gains tend to capture disproportionate search visibility within 90 days.`;

    const ratingWin   = d.rating >= d.marketAvgRating;
    const reviewWin   = d.reviewCount >= d.marketAvgReviews;
    const responseWin = d.responseRate >= 50;
    const seoWin      = d.seoTier === 'strong';

    const gaps = [
        { problem: `${d.reviewCount.toLocaleString()} reviews (${d.presenceGap}% below market avg)`, solution: 'PathConnect Starter — NFC tap cards + automated review requests (+15 reviews/mo)' },
        { problem: `${d.responseRate}% review response rate`, solution: 'Review Response AI — auto-draft replies, one-click approval, 100% coverage' },
        { problem: `${d.complaintFreq} complaint patterns/month`, solution: 'Real-time alerts — flag negative reviews for immediate staff action' }
    ];
    if (d.seoTier !== 'strong') gaps.push({ problem: `SEO tier: ${d.seoTier}`, solution: 'LocalSynch — GBP optimization + directory sync' });

    const loves     = d.loves.length > 0 ? d.loves.slice(0, 4).map(l => typeof l === 'string' ? l : (l.category || String(l))) : d.defaultLoves;
    const complaints= d.complaints.length > 0 ? d.complaints.slice(0, 3).map(c => typeof c === 'string' ? c : `${c.category || 'Issue'} (${c.count || '2'}+)`) : d.defaultComplaints.map(c => `${c.category} (${c.count}+)`);

    // SVG for positioning matrix
    const svgW = 580, svgH = 280, pX = 60, pY = 20, pW = 500, pH = 240;
    const rMin = 3.5, rMax = 5.0;
    const allRevs = [d.reviewCount, d.marketLeaderReviews, ...d.competitors.map(c => c.reviewCount)];
    const mxRev   = Math.max(...allRevs) * 1.1 || 500;
    const toSVGX  = r => pX + (r / mxRev) * pW;
    const toSVGY  = rating => (pY + pH) - ((Math.max(rMin, Math.min(rating, rMax)) - rMin) / (rMax - rMin)) * pH;

    const oppZoneW = (Math.min(d.marketAvgReviews * 0.5, mxRev) / mxRev) * pW;
    const oppZoneH = ((4.5 - rMin) / (rMax - rMin)) * pH;

    const competitorDots = d.competitors.map(c => {
        const cx = toSVGX(c.reviewCount), cy = toSVGY(c.rating);
        return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="#D1D5DB" opacity="0.8"/>`;
    }).join('');

    const leaderX = toSVGX(d.marketLeaderReviews), leaderY = toSVGY(d.marketLeaderRating);
    const youX    = toSVGX(d.reviewCount),          youY    = toSVGY(d.rating);

    const svgMatrix = `<svg width="${svgW}" height="${svgH}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:580px;">
  <rect x="${pX}" y="${pY}" width="${oppZoneW.toFixed(1)}" height="${oppZoneH.toFixed(1)}" fill="#CCFBF1" opacity="0.5"/>
  <text x="${(pX + oppZoneW / 2).toFixed(1)}" y="${(pY + oppZoneH / 2).toFixed(1)}" font-size="9" fill="#0D9488" text-anchor="middle" font-family="Arial">OPPORTUNITY ZONE</text>
  <line x1="${pX}" y1="${pY + pH}" x2="${pX + pW}" y2="${pY + pH}" stroke="#D1D5DB" stroke-width="1"/>
  <line x1="${pX}" y1="${pY}" x2="${pX}" y2="${pY + pH}" stroke="#D1D5DB" stroke-width="1"/>
  ${[3.5, 4.0, 4.5, 5.0].map(r => `<text x="${pX - 8}" y="${toSVGY(r).toFixed(1)}" font-size="9" fill="#9CA3AF" text-anchor="end" dominant-baseline="middle" font-family="Arial">${r}★</text>`).join('')}
  ${[0, 0.25, 0.5, 0.75, 1.0].map(p => `<text x="${(pX + p * pW).toFixed(1)}" y="${(pY + pH + 14)}" font-size="9" fill="#9CA3AF" text-anchor="middle" font-family="Arial">${Math.round(p * mxRev)}</text>`).join('')}
  ${competitorDots}
  <circle cx="${leaderX.toFixed(1)}" cy="${leaderY.toFixed(1)}" r="9" fill="${'#' + B.amber}"/>
  <text x="${leaderX.toFixed(1)}" y="${(leaderY - 13).toFixed(1)}" font-size="9" fill="${'#' + B.amber}" text-anchor="middle" font-family="Arial" font-weight="bold">${d.marketLeaderName.split(' ')[0]}</text>
  <circle cx="${youX.toFixed(1)}" cy="${youY.toFixed(1)}" r="10" fill="${'#' + B.teal}"/>
  <text x="${youX.toFixed(1)}" y="${(youY - 14).toFixed(1)}" font-size="10" fill="${'#' + B.teal}" text-anchor="middle" font-family="Arial" font-weight="bold">YOU</text>
  <text x="${(pX + pW / 2)}" y="${svgH - 2}" font-size="9" fill="#9CA3AF" text-anchor="middle" font-family="Arial">Review Volume →</text>
</svg>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${d.businessName} — Data Analyst Deck</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;background:#1a1a1a;color:#1F2937;line-height:1.5}
.slide{width:960px;min-height:540px;margin:32px auto;background:#fff;border-radius:8px;
  box-shadow:0 20px 60px rgba(0,0,0,.35);overflow:hidden;position:relative;padding:36px 44px}
.slide-dark{background:#134E4A;color:#fff}
.teal-bar{position:absolute;top:0;left:0;right:0;height:6px;background:#0D9488}
.slide-num{position:absolute;bottom:12px;right:18px;font-size:10px;color:#9CA3AF}
.slide-title{font-size:20px;font-weight:700;color:#111827;margin-bottom:6px}
.slide-sub{font-size:11px;color:#0D9488;margin-bottom:18px}
.dark-title{font-size:22px;font-weight:700;color:#fff}
.badge{font-size:9px;font-weight:700;letter-spacing:1px;color:#5EEAD4;text-transform:uppercase;margin-bottom:10px}
.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
.kpi{padding:16px;border-radius:8px;text-align:center}
.kpi-val{font-size:22px;font-weight:700}
.kpi-lbl{font-size:10px;font-weight:600;margin-top:4px}
.kpi-sub{font-size:9px;color:#6B7280;margin-top:2px}
.alert{border-radius:8px;padding:14px 16px;border-left:4px solid #DC2626;background:#FEF2F2;font-size:12px;color:#DC2626;line-height:1.6}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.col-green{background:#ECFDF5;border-radius:8px;padding:16px}
.col-red{background:#FEF2F2;border-radius:8px;padding:16px}
.col-h{font-size:12px;font-weight:700;margin-bottom:12px}
.col-item{font-size:11px;padding:6px 0;border-bottom:1px solid rgba(0,0,0,.06)}
.col-item:last-child{border:none}
table{width:100%;border-collapse:collapse;font-size:11px}
th,td{padding:9px 12px;border:1px solid #E5E7EB;text-align:center}
th{background:#0D9488;color:#fff;font-weight:700}
td:first-child{text-align:left}
.win{background:#ECFDF5;color:#059669;font-weight:700}
.loss{background:#FEF2F2;color:#DC2626;font-weight:700}
.neutral{color:#6B7280}
.big-num{font-size:38px;font-weight:700;color:#DC2626;margin:8px 0}
.bar-row{margin-bottom:16px}
.bar-lbl{font-size:10px;font-weight:700;margin-bottom:4px}
.bar-track{height:20px;background:#E5E7EB;border-radius:4px;overflow:hidden}
.bar-fill{height:100%;border-radius:4px}
.narrative-box{border-left:5px solid #0D9488;padding:14px 18px;background:#F0FDFA;border-radius:0 8px 8px 0;font-size:12px;line-height:1.7;color:#1F2937}
.gap-row{display:grid;grid-template-columns:1fr 40px 1fr;gap:8px;align-items:center;margin-bottom:10px}
.gap-problem{background:#FEF2F2;border:1px solid #DC2626;border-radius:6px;padding:10px;font-size:10px;color:#DC2626}
.gap-arrow{font-size:20px;color:#0D9488;text-align:center;font-weight:700}
.gap-solution{background:#CCFBF1;border:1px solid #0D9488;border-radius:6px;padding:10px;font-size:10px;color:#0F766E}
.timeline{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px}
.mo-card{border-radius:8px;padding:14px;text-align:center}
.mo-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px}
.mo-rev{font-size:15px;font-weight:700;margin-bottom:3px}
.mo-resp{font-size:10px;color:#6B7280}
.pkg{background:#111827;border-radius:8px;padding:16px}
.pkg-title{font-size:11px;font-weight:700;color:#fff;margin-bottom:10px}
.pkg-row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #374151;font-size:10px}
.pkg-name{color:#D1FAE5}
.pkg-price{color:#F59E0B;font-weight:700}
.roi-card{border-radius:6px;padding:10px 14px;margin-bottom:8px;display:flex;align-items:center;gap:12px}
.roi-val{font-size:17px;font-weight:700}
.roi-lbl{font-size:10px;color:#6B7280}
.step-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:16px 0}
.step-card{background:#1A3C35;border-radius:8px;padding:18px}
.step-num{font-size:20px;font-weight:700;color:#0D9488;margin-bottom:6px}
.step-title{font-size:12px;font-weight:700;color:#fff;margin-bottom:4px}
.step-sub{font-size:10px;color:#6EE7B7}
.contact{text-align:center;margin-top:14px;font-size:11px;color:#9CA3AF}
.contact strong{color:#fff}
@media print{body{background:#fff!important}.slide{margin:0;box-shadow:none;page-break-after:always;border-radius:0}}
</style>
</head>
<body>

<!-- Slide 1: Title -->
<div class="slide slide-dark">
  <div class="teal-bar"></div>
  <div class="badge">Reputation Intelligence Briefing</div>
  <h1 style="font-size:26px;font-weight:700;color:#fff;margin-bottom:6px">${d.businessName}</h1>
  ${d.city ? `<p style="font-size:14px;color:#A7F3D0;margin-bottom:18px">${d.city}${d.state ? ', ' + d.state : ''}</p>` : ''}
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;max-width:520px">
    ${[
        ['Rating', `${d.rating}★`, '#0D9488'],
        ['Reviews', d.reviewCount.toLocaleString(), '#DC2626'],
        ['Opportunity', d.oppScore > 0 ? `${d.oppScore}/100` : '—', '#F59E0B']
    ].map(([lbl, val, c]) => `
    <div style="background:#1A3C35;border-radius:8px;padding:14px;text-align:center">
      <div style="font-size:22px;font-weight:700;color:${c}">${val}</div>
      <div style="font-size:9px;color:#9CA3AF;margin-top:4px">${lbl}</div>
    </div>`).join('')}
  </div>
  <div style="margin-top:20px;font-size:11px;color:#6EE7B7;line-height:1.8">
    ${d.city} ${d.industry} Market · ${d.totalCompetitors} competitors analyzed · ${d.qualifiedLeads} qualified leads<br>
    Market leader: ${d.marketLeaderName} (${d.marketLeaderReviews.toLocaleString()} reviews) · PathSynch Labs ${new Date().getFullYear()}
  </div>
  <div class="slide-num" style="color:#6EE7B7">1 / 10</div>
</div>

<!-- Slide 2: Reputation Snapshot -->
<div class="slide">
  <div class="teal-bar"></div>
  <div class="slide-title">Where you stand today</div>
  <div class="slide-sub">Slide 2 — Reputation snapshot</div>
  <div class="kpi-grid">
    ${[
        { v: `${d.rating}★`, l: 'Google Rating',   s: `${d.rating > d.marketAvgRating ? 'Above' : 'Below'} ${d.marketAvgRating} avg`, bg: ratingWin ? '#ECFDF5' : '#FEF2F2', vc: ratingWin ? '#059669' : '#DC2626' },
        { v: d.reviewCount.toLocaleString(), l: 'Reviews',  s: `${Math.abs(d.presenceGap)}% below avg`,  bg: '#FEF2F2', vc: '#DC2626' },
        { v: `${d.complaintFreq}/mo`, l: 'Complaints', s: d.complaintFreq > 3 ? 'Needs attention' : 'Manageable', bg: '#FFFBEB', vc: '#F59E0B' },
        { v: `${d.responseRate}%`, l: 'Response Rate', s: d.responseRate < 50 ? 'Revenue risk' : 'Solid', bg: responseWin ? '#ECFDF5' : '#FEF2F2', vc: responseWin ? '#059669' : '#DC2626' }
    ].map(c => `<div class="kpi" style="background:${c.bg}"><div class="kpi-val" style="color:${c.vc}">${c.v}</div><div class="kpi-lbl">${c.l}</div><div class="kpi-sub">${c.s}</div></div>`).join('')}
  </div>
  <div class="alert">
    Your ${d.rating}★ rating is exceptional, but with only ${d.reviewCount.toLocaleString()} reviews you're nearly invisible in local search.
    ${d.marketLeaderName} dominates with ${d.marketLeaderReviews.toLocaleString()} reviews — ${Math.round(d.marketLeaderReviews / Math.max(d.reviewCount, 1))}× your volume — capturing the majority of new patient searches in your market.
  </div>
  <div class="slide-num">2 / 10</div>
</div>

<!-- Slide 3: Positioning Matrix -->
<div class="slide">
  <div class="teal-bar"></div>
  <div class="slide-title">Your position in the ${d.city} ${d.industry} market</div>
  <div class="slide-sub">Slide 3 — Positioning matrix (rating vs. review volume)</div>
  <div style="display:flex;justify-content:center;margin:10px 0">${svgMatrix}</div>
  <div style="display:flex;gap:20px;justify-content:center;margin-top:8px;font-size:10px;color:#6B7280">
    <span>🟢 You</span><span>🟡 ${d.marketLeaderName.split(' ')[0]}</span><span>⚪ Competitors</span>
  </div>
  <div class="slide-num">3 / 10</div>
</div>

<!-- Slide 4: Head-to-Head -->
<div class="slide">
  <div class="teal-bar"></div>
  <div class="slide-title">How you compare</div>
  <div class="slide-sub">Slide 4 — Head-to-head competitive snapshot</div>
  <table>
    <tr>
      <th>Metric</th>
      <th>${d.businessName}</th>
      <th>${d.marketLeaderName}</th>
      <th>Market Avg</th>
    </tr>
    <tr>
      <td>Google Rating</td>
      <td class="${ratingWin ? 'win' : 'loss'}">${d.rating}★</td>
      <td>${d.marketLeaderRating}★</td>
      <td class="neutral">${d.marketAvgRating}★</td>
    </tr>
    <tr>
      <td>Review Count</td>
      <td class="${reviewWin ? 'win' : 'loss'}">${d.reviewCount.toLocaleString()}</td>
      <td>${d.marketLeaderReviews.toLocaleString()}</td>
      <td class="neutral">${d.marketAvgReviews.toLocaleString()}</td>
    </tr>
    <tr>
      <td>Response Rate</td>
      <td class="${responseWin ? 'win' : 'loss'}">${d.responseRate}%</td>
      <td class="neutral">N/A</td>
      <td class="neutral">N/A</td>
    </tr>
    <tr>
      <td>SEO Tier</td>
      <td class="${seoWin ? 'win' : 'loss'}">${d.seoTier}</td>
      <td>Strong</td>
      <td class="neutral">Moderate</td>
    </tr>
    <tr>
      <td>Voice Share</td>
      <td class="loss">${d.voiceShare}%</td>
      <td>${d.leaderVoiceShare}%</td>
      <td class="neutral">5.0%</td>
    </tr>
  </table>
  <div class="slide-num">4 / 10</div>
</div>

<!-- Slide 5: Voice of Customer -->
<div class="slide">
  <div class="teal-bar"></div>
  <div class="slide-title">What your customers are saying</div>
  <div class="slide-sub">Slide 5 — Voice of the customer</div>
  <div class="two-col">
    <div class="col-green">
      <div class="col-h" style="color:#059669">✓ What they love</div>
      ${loves.map(l => `<div class="col-item" style="color:#065F46">• ${l}</div>`).join('')}
    </div>
    <div class="col-red">
      <div class="col-h" style="color:#DC2626">⚠ What's hurting you</div>
      ${complaints.map(c => `<div class="col-item" style="color:#991B1B">• ${c}</div>`).join('')}
    </div>
  </div>
  <div class="slide-num">5 / 10</div>
</div>

<!-- Slide 6: Cost of Inaction -->
<div class="slide">
  <div class="teal-bar"></div>
  <div class="slide-title">What this gap is costing you</div>
  <div class="slide-sub">Slide 6 — Cost of inaction</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
    <div>
      <div style="font-size:9px;font-weight:700;letter-spacing:0.5px;color:#DC2626;text-transform:uppercase">Monthly Revenue Lost</div>
      <div class="big-num">$${d.monthlyRevenueLost.toLocaleString()}</div>
      <div style="font-size:10px;color:#6B7280;line-height:1.6">Based on ${d.presenceGap}% presence gap × ${d.customersLost} estimated customers/mo × $${d.atv} avg transaction</div>
      <div style="background:#ECFDF5;border-radius:8px;padding:12px;margin-top:14px">
        <div style="font-size:16px;font-weight:700;color:#059669">$${d.revenueRecovered.toLocaleString()}/mo recoverable</div>
        <div style="font-size:10px;color:#065F46;margin-top:4px">PathSynch captures 75% of lost revenue</div>
      </div>
    </div>
    <div>
      <div style="font-size:9px;font-weight:700;letter-spacing:0.5px;color:#6B7280;text-transform:uppercase;margin-bottom:12px">Review volume = search visibility</div>
      ${[
          { label: 'You', value: d.reviewCount, max: Math.max(d.reviewCount, d.marketLeaderReviews, d.marketAvgReviews), color: '#DC2626' },
          { label: 'Market avg', value: d.marketAvgReviews, max: Math.max(d.reviewCount, d.marketLeaderReviews, d.marketAvgReviews), color: '#9CA3AF' },
          { label: d.marketLeaderName.split(' ')[0], value: d.marketLeaderReviews, max: Math.max(d.reviewCount, d.marketLeaderReviews, d.marketAvgReviews), color: '#0D9488' }
      ].map(b => `
      <div class="bar-row">
        <div class="bar-lbl">${b.label} (${b.value.toLocaleString()})</div>
        <div class="bar-track"><div class="bar-fill" style="width:${((b.value/b.max)*100).toFixed(0)}%;background:${b.color}"></div></div>
      </div>`).join('')}
    </div>
  </div>
  <div class="slide-num">6 / 10</div>
</div>

<!-- Slide 7: Competitive Narrative -->
<div class="slide">
  <div class="teal-bar"></div>
  <div class="slide-title">Competitive landscape analysis</div>
  <div class="slide-sub">Slide 7 — AI-generated market narrative</div>
  <div class="narrative-box">${narrative}</div>
  <div style="margin-top:14px;font-size:9px;color:#9CA3AF">AI-generated analysis from ${d.totalCompetitors} competitors · PathSynch Market Intelligence</div>
  <div class="slide-num">7 / 10</div>
</div>

<!-- Slide 8: Gap-to-Solution Map -->
<div class="slide">
  <div class="teal-bar"></div>
  <div class="slide-title">How PathSynch closes each gap</div>
  <div class="slide-sub">Slide 8 — Gap-to-solution map</div>
  ${gaps.map(g => `
  <div class="gap-row">
    <div class="gap-problem">${g.problem}</div>
    <div class="gap-arrow">→</div>
    <div class="gap-solution">${g.solution}</div>
  </div>`).join('')}
  <div class="slide-num">8 / 10</div>
</div>

<!-- Slide 9: Investment + ROI -->
<div class="slide">
  <div class="teal-bar"></div>
  <div class="slide-title">90-day plan and return on investment</div>
  <div class="slide-sub">Slide 9 — Investment and ROI</div>
  <div class="timeline">
    ${[
        { mo: 'Month 1', rev: d.month1Reviews, resp: '50%', c: '#F59E0B', bg: '#FFFBEB' },
        { mo: 'Month 2', rev: d.month2Reviews, resp: '85%', c: '#0D9488', bg: '#CCFBF1' },
        { mo: 'Month 3', rev: d.month3Reviews, resp: '100%', c: '#059669', bg: '#ECFDF5' }
    ].map(m => `
    <div class="mo-card" style="background:${m.bg}">
      <div class="mo-label" style="color:${m.c}">${m.mo}</div>
      <div class="mo-rev" style="color:${m.c}">${m.rev}+ reviews</div>
      <div class="mo-resp">${m.resp} response rate</div>
    </div>`).join('')}
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div class="pkg">
      <div class="pkg-title">PathSynch Package</div>
      ${d.products.slice(0, 3).map(p => `<div class="pkg-row"><span class="pkg-name">${p.name || p}</span><span class="pkg-price">${p.price || ''}</span></div>`).join('')}
      <div style="border-top:1px solid #374151;margin-top:6px;padding-top:6px;font-size:10px;font-weight:700;color:#F59E0B">Total: $${d.monthlyTotal}/mo + ${d.setupFee}</div>
    </div>
    <div>
      ${[
          { v: `+$${d.netGain.toLocaleString()}/mo`, l: 'Net monthly gain after PathSynch', bg: '#CCFBF1', vc: '#0D9488' },
          { v: `~${d.paybackDays} days`, l: 'Pays for itself in', bg: '#ECFDF5', vc: '#059669' },
          { v: `${d.roiMultiple}×`, l: 'Return on investment', bg: '#FFFBEB', vc: '#F59E0B' }
      ].map(rc => `<div class="roi-card" style="background:${rc.bg}"><div class="roi-val" style="color:${rc.vc}">${rc.v}</div><div class="roi-lbl">${rc.l}</div></div>`).join('')}
    </div>
  </div>
  <div class="slide-num">9 / 10</div>
</div>

<!-- Slide 10: Next Steps -->
<div class="slide slide-dark">
  <div class="teal-bar"></div>
  <h2 style="font-size:22px;font-weight:700;color:#fff;text-align:center;margin-bottom:4px">Let's get started</h2>
  <div class="step-cards">
    ${[
        { n: '1', title: '15-min walkthrough', sub: 'See it work for your practice' },
        { n: '2', title: '30-day pilot',        sub: 'PathConnect with 15 patients' },
        { n: '3', title: 'Full deployment',      sub: 'Both tools, reviews growing'  }
    ].map(s => `<div class="step-card"><div class="step-num">${s.n}</div><div class="step-title">${s.title}</div><div class="step-sub">${s.sub}</div></div>`).join('')}
  </div>
  <div class="contact">
    ${d.sellerEmail} · pathsynch.com · synchintro.ai<br>
    <strong>${d.sellerName}</strong> · ${d.sellerTitle}
  </div>
  <div style="text-align:center;margin-top:12px;font-size:9px;color:#6B7280">
    Data sourced from ${d.city} ${d.industry} Market Intelligence Report · ${d.totalCompetitors} competitors analyzed
  </div>
  <div class="slide-num" style="color:#6EE7B7">10 / 10</div>
</div>

</body>
</html>`;
}

module.exports = { renderDataAnalystDeck, renderDataAnalystHTML };
