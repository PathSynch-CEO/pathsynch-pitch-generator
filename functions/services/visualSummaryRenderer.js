/**
 * Visual Summary Renderer
 *
 * Produces a self-contained HTML document with the "Visual Summary" L2 style.
 * Infographic-style one-pager: KPI strip, market position gauge, strengths/gaps,
 * review volume bar chart, complaint donut chart, 90-day projection, solution bar.
 *
 * Usage:
 *   renderVisualSummary(pitch, sellerProfile)
 *
 * pitch = {
 *   inputs:          { businessName, city, state, googleRating, numReviews }
 *   prospect:        enriched prospect object (seoTier, responseRate, rating, reviewCount)
 *   analysis:        { complaintFrequency, responseRate, complaints[], loves[] }
 *   solutionPackage: { packageName, products[], monthlyTotal }
 *   marketContext:   { avgReviews, avgRating, marketLeader, marketLeaderReviews, marketLeaderRating }
 * }
 *
 * Wired from templateOnePager.js when l2Style === 'visual_summary'.
 */

'use strict';

// ── Color palette ──────────────────────────────────────────────────────────
const C = {
    teal:     '#0D9488',
    tealBg:   '#F0FDFA',
    tealBd:   '#99F6E4',
    amber:    '#D97706',
    amberBg:  '#FFFBEB',
    amberBd:  '#FDE68A',
    red:      '#DC2626',
    redBg:    '#FEF2F2',
    redBd:    '#FECACA',
    green:    '#059669',
    greenBg:  '#ECFDF5',
    greenBd:  '#BBF7D0',
    dark:     '#111827',
    text:     '#1F2937',
    muted:    '#6B7280',
    light:    '#9CA3AF',
    card:     '#FFFFFF',
    border:   '#E5E7EB',
    pageBg:   '#FCFBF8',
};

// ── Helpers ────────────────────────────────────────────────────────────────
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

function extractMonthlyTotal(solutionPackage) {
    if (!solutionPackage) return 248;
    const raw = solutionPackage.monthlyTotal || solutionPackage.total || '';
    if (typeof raw === 'number') return raw;
    const digits = parseInt(String(raw).replace(/[^0-9]/g, ''));
    return digits > 0 ? digits : 248;
}

// ── SECTION 1: Teal Header Bar ─────────────────────────────────────────────
function renderHeader(d) {
    const loc = [d.city, d.state].filter(Boolean).join(', ');
    return `
<div style="background:${C.teal};padding:12px 24px;display:flex;justify-content:space-between;align-items:center;">
  <div style="font-size:14px;font-weight:800;color:#fff;letter-spacing:-0.3px;">PathSynch Labs</div>
  <div style="text-align:right;">
    <div style="font-size:10px;font-weight:700;color:#fff;letter-spacing:1.2px;text-transform:uppercase;">VISUAL SUMMARY &mdash; ${esc(d.businessName)}</div>
    ${loc ? `<div style="font-size:9px;color:rgba(255,255,255,0.7);margin-top:2px;">${esc(loc)}</div>` : ''}
  </div>
</div>`;
}

// ── SECTION 2: KPI Strip — 4 icon-stat cards ──────────────────────────────
function renderKPIStrip(d) {
    const responseColor   = d.responseRate > 50 ? C.green : C.red;
    const responseBg      = d.responseRate > 50 ? C.tealBg : C.redBg;
    const responseIconBg  = d.responseRate > 50 ? '#A7F3D0' : '#FEE2E2';
    const responseIconClr = d.responseRate > 50 ? C.green   : C.red;

    const svgStar = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${C.teal}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
    const svgChat = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${C.red}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
    const svgWarn = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${C.amber}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    const svgReply = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${responseIconClr}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>`;

    const cards = [
        {
            bg: C.tealBg, iconBg: '#CCFBF1', svg: svgStar,
            num: d.rating.toFixed(1), numColor: C.teal, label: 'RATING'
        },
        {
            bg: C.redBg, iconBg: '#FEE2E2', svg: svgChat,
            num: fmt(d.reviewCount), numColor: C.red, label: 'REVIEWS'
        },
        {
            bg: C.amberBg, iconBg: '#FEF3C7', svg: svgWarn,
            num: d.complaintFrequency + '/mo', numColor: C.amber, label: 'COMPLAINTS'
        },
        {
            bg: responseBg, iconBg: responseIconBg, svg: svgReply,
            num: d.responseRate + '%', numColor: responseColor, label: 'RESPONSE RATE'
        },
    ];

    const cells = cards.map(c => `
  <div style="flex:1;background:${c.bg};border-radius:8px;padding:10px 6px;text-align:center;">
    <div style="width:32px;height:32px;border-radius:50%;background:${c.iconBg};display:inline-flex;align-items:center;justify-content:center;margin-bottom:5px;">${c.svg}</div>
    <div style="font-size:22px;font-weight:800;color:${c.numColor};line-height:1;">${esc(c.num)}</div>
    <div style="font-size:10px;font-weight:600;color:${C.muted};text-transform:uppercase;letter-spacing:0.5px;margin-top:3px;">${c.label}</div>
  </div>`).join('');

    return `
<div style="padding:10px 16px 8px;">
  <div style="display:flex;gap:8px;">${cells}</div>
</div>`;
}

// ── SECTION 3: Market Position Gauge ──────────────────────────────────────
function renderGauge(d) {
    // Track: x=20 to x=380, width=360
    const trackX = 20;
    const trackW = 360;
    const yourX  = Math.round(trackX + (trackW * d.gaugePosition / 100));
    const avgX   = Math.round(trackX + (trackW * d.gaugeAvgPosition / 100));
    const leaderX = trackX + trackW; // 380
    const filledW = Math.max(14, Math.round(trackW * d.gaugePosition / 100));

    return `
<div style="padding:4px 16px 6px;">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 60" width="100%" style="display:block;overflow:visible;">
    <!-- Gray track -->
    <rect x="${trackX}" y="20" width="${trackW}" height="14" rx="7" fill="${C.border}"/>
    <!-- Red fill up to your position -->
    <rect x="${trackX}" y="20" width="${filledW}" height="14" rx="7" fill="${C.red}" opacity="0.7"/>
    <!-- Avg dashed marker -->
    <line x1="${avgX}" y1="13" x2="${avgX}" y2="40" stroke="${C.muted}" stroke-width="1.5" stroke-dasharray="3,2"/>
    <text x="${avgX}" y="11" text-anchor="middle" font-size="8" fill="${C.muted}" font-family="Helvetica Neue,Arial,sans-serif">Market avg</text>
    <!-- You dot -->
    <circle cx="${yourX}" cy="27" r="8" fill="${C.teal}"/>
    <text x="${yourX}" y="46" text-anchor="middle" font-size="8" fill="${C.teal}" font-weight="700" font-family="Helvetica Neue,Arial,sans-serif">You</text>
    <!-- Leader dot -->
    <circle cx="${leaderX}" cy="27" r="8" fill="${C.amber}"/>
    <text x="${leaderX}" y="46" text-anchor="middle" font-size="8" fill="${C.amber}" font-weight="700" font-family="Helvetica Neue,Arial,sans-serif">Leader</text>
    <!-- Edge labels -->
    <text x="${trackX}" y="58" text-anchor="start" font-size="7.5" fill="${C.light}" font-family="Helvetica Neue,Arial,sans-serif">Invisible</text>
    <text x="${leaderX}" y="58" text-anchor="end" font-size="7.5" fill="${C.light}" font-family="Helvetica Neue,Arial,sans-serif">Market leader</text>
  </svg>
  <div style="font-size:11px;font-weight:700;color:${C.text};text-align:center;margin-top:2px;">
    ${fmt(d.reviewCount)} reviews &bull; ${fmt(d.marketAvgReviews)} market avg &bull; ${fmt(d.marketLeaderReviews)} leader
  </div>
</div>`;
}

// ── SECTION 4: Strengths vs Gaps ──────────────────────────────────────────
function renderStrengthsGaps(d) {
    const gapColors = [C.red, C.amber, C.red];

    const strengthItems = d.strengths.map((s, i) => `
  <div style="padding:6px 10px;${i < d.strengths.length - 1 ? 'border-bottom:0.5px solid ' + C.greenBd + ';' : ''}display:flex;align-items:center;gap:8px;">
    <div style="width:20px;height:20px;border-radius:50%;background:${C.green};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
    </div>
    <span style="font-size:11px;font-weight:600;color:${C.text};line-height:1.3;">${esc(s)}</span>
  </div>`).join('');

    const gapItems = d.gaps.map((g, i) => `
  <div style="padding:6px 10px;${i < d.gaps.length - 1 ? 'border-bottom:0.5px solid ' + C.redBd + ';' : ''}display:flex;align-items:center;gap:8px;">
    <div style="width:20px;height:20px;border-radius:50%;background:${gapColors[i] || C.red};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
      <span style="font-size:11px;font-weight:800;color:#fff;line-height:1;">!</span>
    </div>
    <span style="font-size:11px;font-weight:600;color:${C.text};line-height:1.3;">${esc(g)}</span>
  </div>`).join('');

    return `
<div style="padding:4px 16px 8px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
  <div>
    <div style="font-size:11px;font-weight:700;color:${C.green};text-transform:uppercase;letter-spacing:0.6px;margin-bottom:5px;">STRENGTHS</div>
    <div style="background:${C.greenBg};border:1px solid ${C.greenBd};border-radius:8px;overflow:hidden;">${strengthItems || '<div style="padding:8px 10px;font-size:10px;color:' + C.muted + ';">Analyzing…</div>'}</div>
  </div>
  <div>
    <div style="font-size:11px;font-weight:700;color:${C.red};text-transform:uppercase;letter-spacing:0.6px;margin-bottom:5px;">GAPS</div>
    <div style="background:${C.redBg};border:1px solid ${C.redBd};border-radius:8px;overflow:hidden;">${gapItems || '<div style="padding:8px 10px;font-size:10px;color:' + C.muted + ';">Analyzing…</div>'}</div>
  </div>
</div>`;
}

// ── SECTION 5: Review Volume Bar Chart ────────────────────────────────────
function renderBarChart(d) {
    const bars = [
        { label: 'You',              color: C.red,   pct: d.yourBarPct, count: d.reviewCount          },
        { label: 'Market avg',       color: C.light, pct: d.avgBarPct,  count: d.marketAvgReviews     },
        { label: d.marketLeaderName, color: C.teal,  pct: 100,          count: d.marketLeaderReviews  },
    ];

    const rows = bars.map(b => `
  <div style="display:flex;align-items:center;margin-bottom:5px;">
    <div style="width:90px;text-align:right;padding-right:8px;font-size:11px;font-weight:600;color:${C.text};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(b.label)}">${esc(b.label)}</div>
    <div style="flex:1;background:${C.border};border-radius:4px;height:22px;overflow:hidden;">
      <div style="background:${b.color};width:${b.pct}%;min-width:36px;height:100%;border-radius:4px;display:flex;align-items:center;padding-left:8px;">
        <span style="font-size:10px;font-weight:700;color:#fff;">${fmt(b.count)}</span>
      </div>
    </div>
  </div>`).join('');

    return `
<div style="padding:4px 16px 8px;">
  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:${C.text};margin-bottom:6px;">REVIEW VOLUME COMPARISON</div>
  ${rows}
</div>`;
}

// ── SECTION 6: Complaint Donut Chart ──────────────────────────────────────
function renderDonutChart(d) {
    const cats   = d.complaintCategories;
    const labels = JSON.stringify(cats.map(c => c.name));
    const counts = JSON.stringify(cats.map(c => c.count));
    const colors = JSON.stringify(cats.map(c => c.color));

    const legendItems = cats.map(c => `
  <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
    <div style="width:8px;height:8px;border-radius:2px;background:${c.color};flex-shrink:0;"></div>
    <span style="font-size:11px;color:${C.text};">${esc(c.name)} (${c.count}+)</span>
  </div>`).join('');

    return `
<div style="padding:4px 16px 8px;">
  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:${C.text};margin-bottom:6px;">TOP COMPLAINT PATTERNS</div>
  <div style="display:flex;align-items:center;gap:16px;">
    <div style="width:100px;height:100px;flex-shrink:0;"><canvas id="complaintDonut" width="100" height="100"></canvas></div>
    <div>${legendItems}</div>
  </div>
</div>
<script>
(function() {
  function initDonut() {
    if (typeof Chart === 'undefined') { setTimeout(initDonut, 100); return; }
    var ctx = document.getElementById('complaintDonut');
    if (!ctx) return;
    new Chart(ctx.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ${labels},
        datasets: [{ data: ${counts}, backgroundColor: ${colors}, borderWidth: 0 }]
      },
      options: {
        cutout: '62%',
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        animation: { duration: 0 }
      }
    });
  }
  initDonut();
})();
</script>`;
}

// ── SECTION 7: 90-Day Projected Outcome ───────────────────────────────────
function renderProjection(d) {
    const ratingNum = parseFloat(d.ratingTarget);
    const ratingArrow = (!isNaN(ratingNum) && ratingNum <= d.rating + 0.05)
        ? 'Maintained'
        : `${d.rating.toFixed(1)} \u2192 ${d.ratingTarget}`;

    const responseArrow = d.responseRate >= 100
        ? 'Maintained'
        : `${d.responseRate}% \u2192 100%`;

    const cards = [
        { num: fmt(d.month3Reviews) + '+', label: 'REVIEWS',       arrow: `${fmt(d.reviewCount)} \u2192 ${fmt(d.month3Reviews)}+` },
        { num: d.ratingTarget,             label: 'RATING',         arrow: ratingArrow                                               },
        { num: '100%',                     label: 'RESPONSE RATE',  arrow: responseArrow                                             },
    ];

    const cells = cards.map(c => `
  <div style="flex:1;background:${C.greenBg};border-radius:8px;padding:10px 8px;text-align:center;">
    <div style="font-size:20px;font-weight:800;color:${C.green};line-height:1;">${esc(c.num)}</div>
    <div style="font-size:10px;font-weight:600;color:${C.muted};text-transform:uppercase;letter-spacing:0.5px;margin:3px 0 2px;">${c.label}</div>
    <div style="font-size:11px;color:${C.green};">${esc(c.arrow)}</div>
  </div>`).join('');

    return `
<div style="padding:4px 16px 8px;">
  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:${C.green};margin-bottom:6px;">90-DAY PROJECTED OUTCOME</div>
  <div style="display:flex;gap:8px;">${cells}</div>
</div>`;
}

// ── SECTION 8: Solution Bar (dark) ────────────────────────────────────────
function renderSolutionBar(d) {
    const products = d.products.length ? d.products : [
        { name: 'PathConnect',  price: '$149/mo' },
        { name: 'Response AI',  price: '$99/mo'  },
    ];

    const city  = d.city  || 'local';
    const state = d.state ? ', ' + d.state : '';
    const loc   = city + state;

    const productRows = products.map(p => `
  <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
    <span style="font-size:9.5px;font-weight:600;color:rgba(255,255,255,0.9);">${esc(p.name)}</span>
    <span style="font-size:10px;font-weight:700;color:#fff;">${esc(p.price)}</span>
  </div>`).join('');

    return `
<div style="margin:4px 16px;background:${C.dark};border-radius:8px;padding:12px 16px;">
  <div style="font-size:8px;font-weight:700;color:${C.teal};letter-spacing:1.2px;text-transform:uppercase;margin-bottom:4px;">THE PATHSYNCH SOLUTION</div>
  <div style="font-size:15px;font-weight:700;color:#fff;margin-bottom:10px;">${products.length} tools. One dashboard. ${esc(loc)} results.</div>
  <div style="margin-bottom:8px;">${productRows}</div>
  <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid ${C.amber};padding-top:8px;">
    <span style="font-size:9px;color:${C.amber};">${esc(d.packageName || 'PathSynch Bundle')}</span>
    <span style="font-size:16px;font-weight:800;color:${C.amber};">$${fmt(d.monthlyTotal)}/mo</span>
  </div>
</div>`;
}

// ── SECTION 9: Footer ─────────────────────────────────────────────────────
function renderFooter(d) {
    const contactParts = ['15-minute walkthrough', d.sellerEmail, 'pathsynch.com'].filter(Boolean);
    return `
<div style="padding:8px 16px 12px;border-top:1px solid ${C.border};">
  <div style="font-size:13px;font-weight:700;color:${C.teal};margin-bottom:3px;">
    Your patients rate you ${esc(d.rating.toFixed(1))} stars. The rest is fixable.
  </div>
  <div style="font-size:11px;color:${C.muted};">
    ${contactParts.map(esc).join(' &middot; ')}
  </div>
</div>`;
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Render a complete Visual Summary HTML document.
 *
 * @param {Object} pitch         - { inputs, prospect, analysis, solutionPackage, marketContext }
 * @param {Object} sellerProfile - Seller context (name, email, branding, etc.)
 * @returns {string}             - Complete HTML document string
 */
function renderVisualSummary(pitch, sellerProfile) {
    const p  = pitch         || {};
    const sp = sellerProfile || {};

    const inp  = p.inputs        || {};
    const pros = p.prospect      || {};
    const anal = p.analysis      || {};
    const mkt  = p.marketContext || {};
    const pkg  = p.solutionPackage || null;

    // ── Data extraction ──────────────────────────────────────────────────────
    const businessName        = inp.businessName      || pros.businessName      || 'Business';
    const city                = inp.city              || pros.city              || '';
    const state               = inp.state             || pros.state             || '';
    const rating              = parseFloat(inp.googleRating || pros.rating)     || 4.0;
    const reviewCount         = parseInt(inp.numReviews   || pros.reviewCount)  || 0;
    const responseRate        = Math.round(parseFloat(anal.responseRate ?? pros.responseRate ?? 0));
    const complaintFrequency  = Math.abs(anal.complaintFrequency ?? 2);

    const marketAvgReviews    = parseInt(mkt.avgReviews)          || 500;
    const marketAvgRating     = parseFloat(mkt.avgRating)         || 4.5;
    const marketLeaderName    = mkt.marketLeader                  || 'Market Leader';
    const marketLeaderReviews = parseInt(mkt.marketLeaderReviews) || 1000;
    const marketLeaderRating  = parseFloat(mkt.marketLeaderRating)|| 4.8;
    const seoTier             = pros.seoTier                      || 'moderate';

    // ── Calculations ─────────────────────────────────────────────────────────
    const presenceGap      = Math.round((1 - (reviewCount / marketAvgReviews)) * 100);
    const ratingVsAvg      = rating - marketAvgRating;
    const ratingWin        = ratingVsAvg > 0;
    const reviewWin        = reviewCount >= marketAvgReviews;

    const yourBarPct       = Math.max(3, Math.round((reviewCount / marketLeaderReviews) * 100));
    const avgBarPct        = Math.round((marketAvgReviews / marketLeaderReviews) * 100);
    const gaugePosition    = Math.max(3, Math.round((reviewCount / marketLeaderReviews) * 100));
    const gaugeAvgPosition = Math.round((marketAvgReviews / marketLeaderReviews) * 100);

    const month3Reviews    = reviewCount + 55;
    const ratingTarget     = rating >= 4.8
        ? rating.toFixed(1) + '+'
        : (rating + 0.1).toFixed(1);
    const reviewGrowth     = reviewCount > 0
        ? Math.round(((month3Reviews - reviewCount) / reviewCount) * 100)
        : 0;

    // ── Complaint categories ─────────────────────────────────────────────────
    const complaintCategories = [];
    if (anal.complaints && Array.isArray(anal.complaints)) {
        anal.complaints.slice(0, 3).forEach((c, i) => {
            complaintCategories.push({
                name:  c.category || c.title || `Pattern ${i + 1}`,
                count: c.count || Math.max(1, complaintFrequency - i),
                color: ['#DC2626', '#D97706', '#7C3AED'][i]
            });
        });
    }
    if (complaintCategories.length === 0) {
        complaintCategories.push(
            { name: 'Service consistency', count: 4, color: '#DC2626' },
            { name: 'Scheduling friction', count: 3, color: '#D97706' },
            { name: 'Follow-up lapses',    count: 2, color: '#7C3AED' }
        );
    }

    // ── Strengths ────────────────────────────────────────────────────────────
    const strengths = [];
    if (ratingWin) strengths.push(`${rating.toFixed(1)} rating \u2014 above ${marketAvgRating} market avg`);
    if (rating >= marketLeaderRating) strengths.push(`Tied with ${marketLeaderName} on rating`);
    if (anal.loves && Array.isArray(anal.loves)) {
        anal.loves.slice(0, 2).forEach(l => {
            const text = l.title || l.category || (typeof l === 'string' ? l : null);
            if (text) strengths.push(text);
        });
    }
    if (strengths.length < 3) strengths.push('Staff praised by name in reviews');
    strengths.splice(3);

    // ── Gaps ─────────────────────────────────────────────────────────────────
    const gaps = [];
    if (!reviewWin) gaps.push(`${presenceGap}% below market in review count`);
    if (responseRate < 50) gaps.push(responseRate === 0 ? 'Zero responses to any reviews' : `Only ${responseRate}% response rate`);
    if (complaintFrequency >= 2) gaps.push(`${complaintFrequency} service complaints per month`);
    if (gaps.length < 3) gaps.push('SEO tier: ' + seoTier + ' \u2014 not ranking for local search');
    gaps.splice(3);

    // ── Solution products ────────────────────────────────────────────────────
    let products    = [];
    let packageName = '';
    const monthlyTotal = extractMonthlyTotal(pkg);
    if (pkg) {
        packageName = pkg.packageName || '';
        if (Array.isArray(pkg.products)) {
            products = pkg.products
                .map(parseProduct)
                .filter(x => x.name)
                .slice(0, 3);
        }
    }

    // ── Seller info ──────────────────────────────────────────────────────────
    const sellerEmail = sp.email || sp.branding?.email || 'hello@pathsynch.com';

    // ── Assemble data object ─────────────────────────────────────────────────
    const d = {
        businessName, city, state, rating, reviewCount, responseRate, complaintFrequency,
        marketAvgReviews, marketAvgRating, marketLeaderName, marketLeaderReviews, seoTier,
        presenceGap, ratingWin, reviewWin,
        yourBarPct, avgBarPct, gaugePosition, gaugeAvgPosition,
        month3Reviews, ratingTarget, reviewGrowth,
        complaintCategories, strengths, gaps,
        products, packageName, monthlyTotal, sellerEmail,
    };

    // ── Render sections ──────────────────────────────────────────────────────
    const bodyParts = [
        renderHeader(d),
        renderKPIStrip(d),
        renderGauge(d),
        renderStrengthsGaps(d),
        renderBarChart(d),
        renderDonutChart(d),
        renderProjection(d),
        renderSolutionBar(d),
        renderFooter(d),
    ].filter(Boolean).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Visual Summary &mdash; ${esc(businessName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>
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
  .vs-page {
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
    .vs-page { max-width: 100%; min-height: 10.5in; box-shadow: none; page-break-after: avoid; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div class="vs-page">
${bodyParts}
</div>
</body>
</html>`;
}

module.exports = { renderVisualSummary };
