/**
 * Competitive Battlecard Renderer
 *
 * Produces a self-contained HTML document with Chart.js scatter plot
 * (positioning matrix), head-to-head comparison table, wins/gaps analysis,
 * and a gap-closing action plan.
 *
 * Usage:
 *   renderBattlecard(pitch, sellerProfile)
 *
 * pitch = {
 *   inputs:        { businessName, city, state, googleRating, numReviews, industry }
 *   prospect:      enriched prospect object (seoTier, shareOfVoice, responseRate)
 *   analysis:      { complaintFrequency, responseRate }
 *   sections:      resolved template sections
 *   solutionPackage: { packageName, products[], setupFee, monthlyTotal }
 *   marketContext: { avgRating, avgReviews, marketLeader, marketLeaderRating,
 *                   marketLeaderReviews, totalCompetitors, competitors[],
 *                   leaderVoiceShare }
 *   competitors:   fallback competitor array
 * }
 *
 * Wired from templateOnePager.js when l2Style === 'competitive_battlecard'.
 */

'use strict';

const { PATHSYNCH_DEFAULT_BRAND } = require('./brandResolver');

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
    greenBd:  '#BBF7D0',
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
    return Number(n || 0).toLocaleString('en-US');
}

// ── Synthetic competitor dots (deterministic spread) ───────────────────────
const SYNTHETIC_COMPETITORS = [
    { name: 'Competitor A', rating: 4.2, reviewCount: 285  },
    { name: 'Competitor B', rating: 4.6, reviewCount: 740  },
    { name: 'Competitor C', rating: 3.9, reviewCount: 150  },
    { name: 'Competitor D', rating: 4.4, reviewCount: 520  },
    { name: 'Competitor E', rating: 4.1, reviewCount: 95   },
    { name: 'Competitor F', rating: 4.7, reviewCount: 1200 },
    { name: 'Competitor G', rating: 4.3, reviewCount: 380  },
    { name: 'Competitor H', rating: 4.5, reviewCount: 890  },
    { name: 'Competitor I', rating: 3.8, reviewCount: 210  },
    { name: 'Competitor J', rating: 4.8, reviewCount: 1750 },
];

// ── Parse product string ───────────────────────────────────────────────────
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

function extractMonthlyTotal(pkg) {
    if (!pkg) return 248;
    const raw = pkg.monthlyTotal || pkg.total || '';
    if (typeof raw === 'number') return raw;
    const n = parseInt(String(raw).replace(/[^0-9]/g, ''));
    return n > 0 ? n : 248;
}

// ── Competitive calculations ───────────────────────────────────────────────
function computeMetrics(d) {
    const {
        rating, reviewCount, responseRate, complaintFrequency,
        marketAvgRating, marketAvgReviews, marketLeaderName,
        marketLeaderRating, marketLeaderReviews, totalCompetitors,
    } = d;

    const presenceGap = Math.max(0, Math.round((1 - (reviewCount / marketAvgReviews)) * 100));
    const ratingVsAvg  = +(rating - marketAvgRating).toFixed(2);
    const ratingWin    = ratingVsAvg > 0;
    const reviewWin    = reviewCount >= marketAvgReviews;
    const responseWin  = responseRate >= 50;

    const voiceShare = d.shareOfVoice !== null
        ? d.shareOfVoice
        : +(reviewCount / (marketAvgReviews * totalCompetitors) * 100).toFixed(2);
    const leaderVoiceShare = d.leaderVoiceShare !== null
        ? d.leaderVoiceShare
        : +(marketLeaderReviews / (marketAvgReviews * totalCompetitors) * 100).toFixed(1);
    const marketAvgVoice = 5; // baseline

    // Months to reach market average at 15 reviews/month
    const monthsToAvg = reviewCount < marketAvgReviews
        ? Math.ceil((marketAvgReviews - reviewCount) / 15) : 0;

    // Wins
    const wins = [];
    if (ratingWin) {
        wins.push({
            title: ratingVsAvg >= 0.3 ? 'Significantly above market average rating' : 'Above market average rating',
            detail: `${rating} stars vs. ${marketAvgRating} avg. Your quality is proven.`
        });
    }
    if (rating >= marketLeaderRating) {
        wins.push({
            title: 'Tied with the market leader on rating',
            detail: `${rating} stars — same as ${marketLeaderName}. That's earned, not bought.`
        });
    }
    if (reviewWin) {
        wins.push({
            title: 'Strong review volume',
            detail: `${fmt(reviewCount)} reviews — above the ${fmt(marketAvgReviews)} market average.`
        });
    }
    if (responseWin) {
        wins.push({
            title: 'Active review engagement',
            detail: `${responseRate}% response rate shows patients you care.`
        });
    }
    if (wins.length === 0) {
        wins.push({ title: 'Established local presence', detail: 'You have a Google Business Profile with real patient reviews.' });
    }
    if (wins.length === 1) {
        wins.push({ title: 'Authentic patient loyalty', detail: 'Review sentiment shows genuine satisfaction — not incentivized.' });
    }

    // Gaps
    const gaps = [];
    if (!reviewWin) {
        gaps.push({
            title: `${presenceGap}% below market in reviews`,
            detail: `${fmt(reviewCount)} vs. ${fmt(marketAvgReviews)} avg. ${marketLeaderName} has ${fmt(marketLeaderReviews)}. You're invisible in search.`,
            fix: 'PathConnect'
        });
    }
    if (!responseWin) {
        gaps.push({
            title: responseRate === 0 ? 'Zero review responses' : `Only ${responseRate}% response rate`,
            detail: responseRate === 0 ? 'Every unanswered review is a missed conversation.' : 'Industry best practice is 90%+.',
            fix: 'Response AI'
        });
    }
    if (complaintFrequency >= 2) {
        gaps.push({
            title: 'Service complaints appearing',
            detail: `~${complaintFrequency} complaints/month detected in recent reviews.`,
            fix: 'Response AI + alerts'
        });
    }
    if (gaps.length === 0) {
        gaps.push({
            title: 'Room to grow visibility',
            detail: 'Even strong businesses can capture more local search traffic.',
            fix: 'LocalSynch'
        });
    }

    return {
        presenceGap, ratingVsAvg, ratingWin, reviewWin, responseWin,
        voiceShare, leaderVoiceShare, marketAvgVoice,
        monthsToAvg, wins, gaps,
    };
}

// ── Section renderers ──────────────────────────────────────────────────────

function renderHeader(d) {
    const loc = [d.city, d.state].filter(Boolean).join(', ');
    return `
<div style="background:${d.accentColor};padding:14px 20px;display:flex;justify-content:space-between;align-items:center;">
  <div style="font-size:14px;font-weight:800;color:#fff;letter-spacing:-0.3px;">${esc(d.companyName)}</div>
  <div style="text-align:right;">
    <div style="font-size:10px;font-weight:700;color:#fff;letter-spacing:1.2px;text-transform:uppercase;">COMPETITIVE BATTLECARD &mdash; ${esc(d.businessName)}</div>
    ${loc ? `<div style="font-size:9px;color:rgba(255,255,255,0.7);margin-top:2px;">${esc(loc)}</div>` : ''}
  </div>
</div>`;
}

function renderPositioningMatrix(d, cm) {
    // Build competitor dots JSON for Chart.js
    const competitors = d.competitors;
    const competitorDots = JSON.stringify(
        competitors.map(c => ({ x: c.reviewCount || 0, y: c.rating || 4.0, n: c.name || '' }))
    );
    const youDot     = JSON.stringify({ x: d.reviewCount, y: d.rating });
    const leaderDot  = JSON.stringify({ x: d.marketLeaderReviews, y: d.marketLeaderRating, n: d.marketLeaderName });

    const xMax = Math.max(d.marketLeaderReviews * 1.15, 2200);
    const oppXMax = Math.round(d.marketAvgReviews * 0.5);

    // JSON-safe strings for embedded script
    const businessNameJS = JSON.stringify(d.businessName);
    const leaderNameJS   = JSON.stringify(d.marketLeaderName);
    const avgRatingJS    = JSON.stringify(d.marketAvgRating);

    return `
<div style="padding:10px 20px 6px;">
  <div style="font-size:9px;font-weight:700;color:${C.teal};letter-spacing:0.8px;text-transform:uppercase;margin-bottom:6px;">&#9642; YOUR MARKET POSITION</div>
  <div style="position:relative;height:220px;background:${C.card};border:1px solid ${C.border};border-radius:6px;padding:4px;">
    <canvas id="posChart" style="width:100%;height:100%;"></canvas>
  </div>
  <!-- Chart legend -->
  <div style="display:flex;gap:14px;margin-top:6px;flex-wrap:wrap;">
    <div style="display:flex;align-items:center;gap:4px;font-size:8.5px;color:${C.muted};">
      <span style="width:10px;height:10px;border-radius:50%;background:${C.teal};display:inline-block;"></span>You
    </div>
    <div style="display:flex;align-items:center;gap:4px;font-size:8.5px;color:${C.muted};">
      <span style="width:10px;height:10px;background:${C.amber};transform:rotate(45deg);display:inline-block;"></span>Market leader
    </div>
    <div style="display:flex;align-items:center;gap:4px;font-size:8.5px;color:${C.muted};">
      <span style="width:10px;height:10px;border-radius:50%;background:#D1D5DB;display:inline-block;"></span>Competitors
    </div>
    <div style="display:flex;align-items:center;gap:4px;font-size:8.5px;color:${C.muted};">
      <span style="width:16px;border-top:2px dashed ${C.teal};display:inline-block;"></span>Opportunity zone
    </div>
  </div>
</div>
<script>
(function() {
  function initChart() {
    var canvas = document.getElementById('posChart');
    if (!canvas || typeof Chart === 'undefined') {
      setTimeout(initChart, 100);
      return;
    }
    if (typeof window.annotationPlugin !== 'undefined') {
      Chart.register(window.annotationPlugin);
    }

    var competitorData = ${competitorDots};
    var youData = [${youDot}];
    var leaderData = [${leaderDot}];
    var businessName = ${businessNameJS};
    var leaderName   = ${leaderNameJS};
    var avgRating    = ${avgRatingJS};

    var labelPlugin = {
      id: 'labelPlugin',
      afterDatasetsDraw: function(chart) {
        var ctx = chart.ctx;
        chart.data.datasets.forEach(function(dataset, di) {
          var meta = chart.getDatasetMeta(di);
          if (dataset.label === 'You' || dataset.label === leaderName) {
            meta.data.forEach(function(pt) {
              var pos = pt.getProps(['x','y'], true);
              var txt = dataset.label === 'You'
                ? ('You (' + chart.data.datasets[di].data[0].y + '\u2605, ' + chart.data.datasets[di].data[0].x + ')')
                : (leaderName.length > 12 ? leaderName.substring(0,12)+'...' : leaderName);
              ctx.save();
              ctx.font = 'bold 8px sans-serif';
              ctx.fillStyle = dataset.label === 'You' ? '${C.teal}' : '${C.amber}';
              ctx.fillText(txt, pos.x + 8, pos.y - 5);
              ctx.restore();
            });
          }
        });
      }
    };

    new Chart(canvas.getContext('2d'), {
      type: 'scatter',
      plugins: [labelPlugin],
      data: {
        datasets: [
          {
            label: 'Competitors',
            data: competitorData.map(function(c) { return { x: c.x, y: c.y, name: c.n }; }),
            backgroundColor: 'rgba(209,213,219,0.7)',
            pointRadius: 5,
            pointHoverRadius: 7,
            order: 3
          },
          {
            label: 'You',
            data: youData,
            backgroundColor: '${C.teal}',
            borderColor: '#fff',
            borderWidth: 1.5,
            pointRadius: 9,
            pointHoverRadius: 11,
            order: 1
          },
          {
            label: leaderName,
            data: leaderData.map(function(d) { return { x: d.x, y: d.y, name: d.n }; }),
            backgroundColor: '${C.amber}',
            borderColor: '#fff',
            borderWidth: 1.5,
            pointStyle: 'rectRot',
            pointRadius: 10,
            pointHoverRadius: 12,
            order: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                var name = ctx.raw.name || ctx.dataset.label;
                return name + ': ' + ctx.raw.y + '\u2605, ' + ctx.raw.x.toLocaleString() + ' reviews';
              }
            }
          },
          annotation: {
            annotations: {
              opportunityZone: {
                type: 'box',
                xMin: 0,
                xMax: ${oppXMax},
                yMin: 4.5,
                yMax: 5.05,
                backgroundColor: 'rgba(13,148,136,0.06)',
                borderColor: '${C.teal}',
                borderWidth: 1,
                borderDash: [6, 4],
                label: {
                  display: true,
                  content: 'Opportunity zone',
                  position: { x: 'start', y: 'start' },
                  color: '${C.teal}',
                  font: { size: 8 }
                }
              },
              avgLine: {
                type: 'line',
                yMin: avgRating,
                yMax: avgRating,
                borderColor: '#9CA3AF',
                borderWidth: 1,
                borderDash: [4, 4],
                label: {
                  display: true,
                  content: 'Market avg ' + avgRating + '\u2605',
                  position: 'end',
                  backgroundColor: 'rgba(255,255,255,0.8)',
                  color: '${C.muted}',
                  font: { size: 8 }
                }
              }
            }
          }
        },
        scales: {
          x: {
            title: { display: true, text: 'Review count', font: { size: 9 }, color: '${C.muted}' },
            min: 0,
            max: ${xMax},
            ticks: { font: { size: 8 }, color: '${C.muted}', maxTicksLimit: 6 },
            grid: { color: 'rgba(0,0,0,0.04)' }
          },
          y: {
            title: { display: true, text: 'Rating', font: { size: 9 }, color: '${C.muted}' },
            min: 3.7,
            max: 5.05,
            ticks: {
              font: { size: 8 }, color: '${C.muted}',
              callback: function(v) { return v.toFixed(1) + '\u2605'; }
            },
            grid: { color: 'rgba(0,0,0,0.04)' }
          }
        }
      }
    });
  }
  initChart();
})();
</script>`;
}

function renderComparisonTable(d, cm) {
    // Helper: cell styling based on win/loss
    function cell(content, isWin, isHeader) {
        if (isHeader) return `<td style="background:${C.teal};color:#fff;font-weight:700;padding:8px 10px;text-align:center;font-size:10px;">${esc(String(content))}</td>`;
        const bg = isWin === true ? C.greenBg : isWin === false ? C.redBg : C.card;
        return `<td style="background:${bg};padding:8px 10px;text-align:center;font-size:10px;color:${C.text};">${content}</td>`;
    }

    function val(v, unit = '') {
        return `<div style="font-size:14px;font-weight:800;">${esc(String(v))}${unit}</div>`;
    }

    function sub(s) {
        return `<div style="font-size:7.5px;color:${C.muted};margin-top:1px;">${esc(String(s))}</div>`;
    }

    const ratingWin = d.rating > d.marketAvgRating;
    const ratingEq  = d.rating >= d.marketLeaderRating;
    const reviewWin = d.reviewCount >= d.marketAvgReviews;

    const responseColor = d.responseRate >= 50 ? C.green : d.responseRate >= 20 ? C.amber : C.red;
    const seoColor = d.seoTier === 'strong' ? C.green : d.seoTier === 'moderate' ? C.amber : C.red;

    const voiceWin = cm.voiceShare > cm.marketAvgVoice;

    const rows = [
        {
            metric: 'Rating',
            you: val(d.rating, '★') + (ratingWin ? sub('Above avg') : sub('Below avg')),
            leader: val(d.marketLeaderRating, '★'),
            avg: val(d.marketAvgRating, '★'),
            youWin: ratingWin,
        },
        {
            metric: 'Reviews',
            you: val(fmt(d.reviewCount)) + (reviewWin ? '' : sub(cm.presenceGap + '% below avg')),
            leader: val(fmt(d.marketLeaderReviews)),
            avg: val(fmt(d.marketAvgReviews)),
            youWin: reviewWin,
        },
        {
            metric: 'Response rate',
            you: `<div style="font-size:14px;font-weight:800;color:${responseColor};">${d.responseRate}%</div>`,
            leader: `<div style="font-size:11px;color:${C.muted};">N/A</div>`,
            avg: `<div style="font-size:11px;color:${C.muted};">N/A</div>`,
            youWin: d.responseRate >= 50,
        },
        {
            metric: 'SEO tier',
            you: `<div style="font-size:12px;font-weight:700;color:${seoColor};text-transform:uppercase;">${d.seoTier}</div>`,
            leader: `<div style="font-size:11px;color:${C.muted};">N/A</div>`,
            avg: `<div style="font-size:11px;color:${C.muted};">N/A</div>`,
            youWin: d.seoTier === 'strong',
        },
        {
            metric: 'Voice share',
            you: val(cm.voiceShare + '%') + (!voiceWin ? sub('vs ' + cm.marketAvgVoice + '% avg') : ''),
            leader: val(cm.leaderVoiceShare + '%'),
            avg: val(cm.marketAvgVoice + '%'),
            youWin: voiceWin,
        },
    ];

    const rowsHtml = rows.map(r => `
  <tr>
    <td style="padding:8px 10px;font-size:10px;font-weight:600;color:${C.muted};white-space:nowrap;border-bottom:0.5px solid ${C.border};">${esc(r.metric)}</td>
    ${cell(r.you, r.youWin)}
    <td style="padding:8px 10px;text-align:center;font-size:10px;color:${C.text};background:${C.card};">${r.leader}</td>
    <td style="padding:8px 10px;text-align:center;font-size:10px;color:${C.text};background:${C.card};">${r.avg}</td>
  </tr>`).join('');

    return `
<div style="padding:6px 20px;">
  <div style="font-size:9px;font-weight:700;color:${C.teal};letter-spacing:0.8px;text-transform:uppercase;margin-bottom:6px;">&#9663; HEAD-TO-HEAD COMPARISON</div>
  <table style="width:100%;border-collapse:collapse;border:0.5px solid ${C.border};border-radius:6px;overflow:hidden;background:${C.card};">
    <thead>
      <tr>
        <td style="padding:8px 10px;background:#F9FAFB;font-size:9px;color:${C.muted};"></td>
        ${cell(d.businessName, null, true)}
        <td style="padding:8px 10px;background:#F3F4F6;font-weight:700;text-align:center;font-size:10px;color:${C.text};">${esc(d.marketLeaderName)}</td>
        <td style="padding:8px 10px;background:#F3F4F6;font-weight:700;text-align:center;font-size:10px;color:${C.text};">Market avg</td>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</div>`;
}

function renderWinsAndGaps(cm) {
    const winCards = cm.wins.map(w => `
    <div style="display:flex;gap:8px;margin-bottom:7px;">
      <div style="font-size:13px;color:${C.green};flex-shrink:0;line-height:1.2;">&#10003;</div>
      <div>
        <div style="font-size:9.5px;font-weight:700;color:${C.text};">${esc(w.title)}</div>
        <div style="font-size:8.5px;color:${C.muted};margin-top:1px;">${esc(w.detail)}</div>
      </div>
    </div>`).join('');

    const gapCards = cm.gaps.map(g => `
    <div style="display:flex;gap:8px;margin-bottom:7px;">
      <div style="font-size:11px;font-weight:800;color:${C.red};flex-shrink:0;line-height:1.3;">!</div>
      <div style="flex:1;">
        <div style="font-size:9.5px;font-weight:700;color:${C.text};">${esc(g.title)}</div>
        <div style="font-size:8.5px;color:${C.muted};margin-top:1px;">${esc(g.detail)}</div>
        ${g.fix ? `<span style="display:inline-block;margin-top:3px;background:${C.tealBg};border:1px solid ${C.tealBd};color:${C.teal};font-size:7.5px;font-weight:700;padding:1px 7px;border-radius:20px;">Fix: ${esc(g.fix)}</span>` : ''}
      </div>
    </div>`).join('');

    return `
<div style="padding:6px 20px;">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
    <div>
      <div style="font-size:9px;font-weight:700;color:${C.green};letter-spacing:0.8px;text-transform:uppercase;margin-bottom:6px;">&#9650; WHERE YOU WIN</div>
      <div style="background:${C.greenBg};border:1px solid ${C.greenBd};border-radius:6px;padding:10px 12px;">${winCards}</div>
    </div>
    <div>
      <div style="font-size:9px;font-weight:700;color:${C.red};letter-spacing:0.8px;text-transform:uppercase;margin-bottom:6px;">&#9660; WHERE YOU'RE EXPOSED</div>
      <div style="background:${C.redBg};border:1px solid ${C.redBd};border-radius:6px;padding:10px 12px;">${gapCards}</div>
    </div>
  </div>
</div>`;
}

function renderSEOInsight(d) {
    if (d.seoTier === 'strong') return '';
    return `
<div style="margin:6px 20px;padding:10px 14px;background:${C.amberBg};border-left:3px solid ${C.amber};border-radius:0 6px 6px 0;">
  <span style="font-size:9.5px;font-weight:700;color:${C.amber};">SEO insight: </span>
  <span style="font-size:9.5px;color:${C.text};">Your SEO tier is <strong>${esc(d.seoTier)}</strong> despite a <strong>${d.rating}&#9733;</strong> rating. Patients searching &ldquo;${esc(d.industry || 'local business')} ${esc(d.city)}&rdquo; see competitors with lower ratings but more reviews first. Review volume is the primary ranking signal you&rsquo;re missing.</span>
</div>`;
}

function renderClosingTheGap(d, cm) {
    const step3Target = cm.monthsToAvg > 0
        ? `Top quartile in ~${cm.monthsToAvg} months`
        : 'Maintain your position';

    const steps = [
        { num: '1', color: C.amber,  title: 'Capture reviews',     desc: 'NFC tap cards — patients review after visits',         target: '+15/month'          },
        { num: '2', color: C.teal,   title: 'Respond to all',      desc: 'AI drafts replies — approve in one click',              target: '100% in 30 days'    },
        { num: '3', color: C.green,  title: 'Move right on chart', desc: 'Every review shifts your dot toward the leader',        target: step3Target          },
    ];

    const cols = steps.map(s => `
  <div style="flex:1;text-align:center;padding:10px 8px;">
    <div style="width:28px;height:28px;border-radius:50%;background:${s.color};color:#fff;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;margin:0 auto 7px;">${s.num}</div>
    <div style="font-size:10px;font-weight:700;color:${C.text};margin-bottom:3px;">${s.title}</div>
    <div style="font-size:8.5px;color:${C.muted};margin-bottom:6px;line-height:1.35;">${s.desc}</div>
    <div style="font-size:8px;font-weight:700;color:${s.color};background:${s.color}1A;border-radius:20px;padding:2px 10px;display:inline-block;">${esc(s.target)}</div>
  </div>`).join('');

    return `
<div style="padding:6px 20px;">
  <div style="font-size:9px;font-weight:700;color:${C.teal};letter-spacing:0.8px;text-transform:uppercase;margin-bottom:6px;">&#8594; CLOSING THE GAP</div>
  <div style="background:${C.card};border:1px solid ${C.border};border-radius:8px;display:flex;">
    ${cols}
  </div>
</div>`;
}

function renderSolutionBar(d) {
    const loc = [d.city, d.state].filter(Boolean).join(', ');
    const toolCount = d.products.length || 2;

    const productRows = d.products.map(p => `
    <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
      <span style="font-size:9.5px;color:rgba(255,255,255,0.85);font-weight:600;">${esc(p.name)}</span>
      <span style="font-size:10px;font-weight:700;color:#fff;">${esc(p.price)}</span>
    </div>`).join('');

    return `
<div style="margin:6px 20px;background:${C.dark};border-radius:8px;padding:14px 16px;">
  <div style="font-size:8px;font-weight:700;color:${d.accentColor};letter-spacing:1.2px;text-transform:uppercase;margin-bottom:4px;">${(d.mode !== 'pathsynch') ? (d.companyName.toUpperCase() + ' SOLUTION') : 'THE PATHSYNCH SOLUTION'}</div>
  <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:10px;">${toolCount} tools. One dashboard. ${esc(loc || 'local')} results.</div>
  <div style="margin-bottom:8px;">${productRows}</div>
  <div style="display:flex;justify-content:space-between;border-top:1px solid rgba(255,255,255,0.2);padding-top:8px;">
    <span style="font-size:9px;font-weight:700;color:#fff;">${esc(d.packageName || (d.companyName + ' Bundle'))}</span>
    <span style="font-size:15px;font-weight:800;color:${C.amber};">$${fmt(d.monthlyTotal)}/mo</span>
  </div>
</div>`;
}

function renderFooter(d) {
    return `
<div style="padding:10px 20px 14px;border-top:1px solid ${C.border};">
  <div style="font-size:11px;font-weight:700;color:${d.accentColor};margin-bottom:3px;">
    Your patients rate you ${d.rating}&#9733;. Let&rsquo;s make sure everyone knows it.
  </div>
  <div style="font-size:9px;color:${C.muted};">
    15-minute walkthrough &middot; ${esc(d.sellerEmail)} &middot; ${esc(d.websiteUrl || 'pathsynch.com')}
  </div>
</div>`;
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Render a complete Competitive Battlecard HTML document.
 *
 * @param {Object} pitch         - pitch context from templateOnePager.js
 * @param {Object} sellerProfile - Seller context (name, email, branding, etc.)
 * @returns {string}             - Complete HTML document string
 */
function renderBattlecard(pitch, sellerProfile) {
    const p  = pitch || {};
    const sp = sellerProfile || {};
    const rb = p.resolvedBrand || PATHSYNCH_DEFAULT_BRAND;

    const inp  = p.inputs   || {};
    const pros = p.prospect || {};
    const anal = p.analysis || {};
    const mkt  = p.marketContext || {};
    const pkg  = p.solutionPackage || null;

    // ── Business data ──
    const businessName        = inp.businessName || pros.businessName || 'Business';
    const city                = inp.city  || pros.city  || '';
    const state               = inp.state || pros.state || '';
    const industry            = inp.industry || pros.industry || '';
    const rating              = parseFloat(inp.googleRating || pros.rating) || 4.0;
    const reviewCount         = parseInt(inp.numReviews   || pros.reviewCount) || 0;
    const responseRate        = Math.round(parseFloat(anal.responseRate ?? pros.responseRate ?? 0));
    const complaintFrequency  = Math.abs(anal.complaintFrequency ?? 2);
    const seoTier             = pros.seoTier || anal.seoTier || 'moderate';
    const shareOfVoice        = pros.shareOfVoice != null ? pros.shareOfVoice : null;

    // ── Market data ──
    const marketAvgRating        = parseFloat(mkt.avgRating)    || 4.5;
    const marketAvgReviews       = parseInt(mkt.avgReviews)     || 500;
    const marketLeaderName       = mkt.marketLeader             || 'Market Leader';
    const marketLeaderRating     = parseFloat(mkt.marketLeaderRating) || 4.8;
    const marketLeaderReviews    = parseInt(mkt.marketLeaderReviews)  || 1000;
    const totalCompetitors       = parseInt(mkt.totalCompetitors)     || 20;
    const leaderVoiceShare       = mkt.leaderVoiceShare != null ? mkt.leaderVoiceShare : null;

    // ── Competitor dots ──
    let competitors = [];
    if (Array.isArray(mkt.competitors) && mkt.competitors.length > 0) {
        competitors = mkt.competitors.slice(0, 20).map(c => ({
            name:        c.name        || '',
            rating:      parseFloat(c.rating) || 4.0,
            reviewCount: parseInt(c.reviewCount || c.reviews) || 0,
        }));
    } else if (Array.isArray(p.competitors) && p.competitors.length > 0) {
        competitors = p.competitors.slice(0, 20).map(c => ({
            name:        c.name        || '',
            rating:      parseFloat(c.rating) || 4.0,
            reviewCount: parseInt(c.reviewCount || c.reviews) || 0,
        }));
    } else {
        competitors = SYNTHETIC_COMPETITORS;
    }

    // ── Solution package ──
    const monthlyTotal = extractMonthlyTotal(pkg);
    let products   = [];
    let packageName = '';
    if (pkg) {
        packageName = pkg.packageName || '';
        if (Array.isArray(pkg.products)) {
            products = pkg.products.map(parseProduct).filter(p => p.name).slice(0, 3);
        }
    }
    if (products.length === 0) {
        products = [
            { name: 'PathConnect Starter', price: '$149/mo' },
            { name: 'Review Response AI',  price: '$99/mo'  },
        ];
    }

    // ── Seller ──
    const sellerEmail = rb.contactEmail || sp.email || sp.branding?.email || 'hello@pathsynch.com';

    // ── Assemble data object ──
    const d = {
        businessName, city, state, industry,
        rating, reviewCount, responseRate, complaintFrequency, seoTier,
        shareOfVoice, leaderVoiceShare,
        marketAvgRating, marketAvgReviews, marketLeaderName,
        marketLeaderRating, marketLeaderReviews, totalCompetitors,
        competitors, products, packageName, monthlyTotal, sellerEmail,
        accentColor: rb.accentColor || C.teal,
        companyName: rb.companyName || sp.companyName || 'PathSynch Labs',
        websiteUrl:  rb.websiteUrl  || null,
        mode:        rb.mode        || 'pathsynch',
    };

    const cm = computeMetrics(d);

    const bodyParts = [
        renderHeader(d),
        renderPositioningMatrix(d, cm),
        renderComparisonTable(d, cm),
        renderWinsAndGaps(cm),
        renderSEOInsight(d),
        renderClosingTheGap(d, cm),
        renderSolutionBar(d),
        renderFooter(d),
    ].filter(Boolean).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Competitive Battlecard &mdash; ${esc(businessName)}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"><\/script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/chartjs-plugin-annotation/3.0.1/chartjs-plugin-annotation.min.js"><\/script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: letter portrait; margin: 0; }
  html, body {
    background: ${C.pageBg};
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 12px;
    color: ${C.text};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .bc-page {
    max-width: 612px;
    min-height: 792px;
    margin: 0 auto;
    background: ${C.pageBg};
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  @media (max-width: 500px) {
    .bc-page { max-width: 100%; }
  }
  @media print {
    html, body { background: ${C.pageBg}; }
    .bc-page { max-width: 100%; min-height: 10.5in; box-shadow: none; }
  }
</style>
</head>
<body>
<div class="bc-page">
${bodyParts}
</div>
</body>
</html>`;
}

module.exports = { renderBattlecard };
