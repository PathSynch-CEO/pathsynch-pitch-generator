/**
 * Growth Snapshot Renderer
 *
 * Renders a two-page "Customer Growth Snapshot" document.
 * Style: l2Style === 'growth_snapshot'
 *
 * Page 1: Opportunity, ICPs, Digital Presence Audit, Growth Framework
 * Page 2: 90-Day Roadmap, Investment/Pricing, Diagnostics, CTA
 *
 * Brand system: Satoshi Variable font, PathSynch green-500 primary, neutral palette
 * Font load: https://api.fontshare.com/v2/css?f[]=satoshi@400,450,500,700&display=swap
 */

'use strict';

// ── HTML escape ────────────────────────────────────────────────────────────
function escHtml(val) {
    if (val === null || val === undefined) return '';
    return String(val)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ── SVG Icons ──────────────────────────────────────────────────────────────
const ICONS = {
    website: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6F6E6C" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    gbp: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6F6E6C" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    instagram: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6F6E6C" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5" fill="#6F6E6C"/></svg>',
    facebook: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6F6E6C" stroke-width="2"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>'
};

// ── Content Fallback: Industry-Aware ICPs ──────────────────────────────────
/**
 * Build ICPs with industry and business awareness.
 * Known businesses get hand-tuned content. Unknown businesses
 * get industry-specific defaults that are still useful.
 *
 * IMPORTANT for THC/hemp businesses: avoid health claims, medical language,
 * or guaranteed outcome statements. Use responsible-use framing.
 */
function buildContentFallback(industry, businessName, website) {
    const name = (businessName || '').toLowerCase();
    const site = (website || '').toLowerCase();
    const ind = (industry || '').toLowerCase();

    // ── THC beverage / cannabis bar / hemp bar ──
    if (name.includes('c bar') || site.includes('thecbar') ||
        ind.includes('thc') || ind.includes('cannabis') || ind.includes('hemp')) {
        return [
            {
                name: 'The Controlled Premium Relaxer',
                want: 'A premium adult way to unwind without making alcohol the center of the night.',
                role: 'Highest revenue potential through loyalty and repeat visits.',
                pill: 'Primary Revenue Driver'
            },
            {
                name: 'The Social Alternative Seeker',
                want: 'To stay social and included without alcohol, but needs an obvious on-ramp and a comfortable first experience.',
                role: 'Awareness driver, group trial, and social proof engine.',
                pill: 'Awareness Engine'
            },
            {
                name: 'The Music-Led Explorer',
                want: 'A curated, intentional music experience with a unique atmosphere and is already standing in the right venue.',
                role: 'Cultural credibility and niche advocacy.',
                pill: 'Cultural Credibility'
            }
        ];
    }

    // ── Bar / Restaurant / Nightlife ──
    if (ind.match(/bar|restaurant|food|beverage|nightlife|venue|music/)) {
        return [
            {
                name: 'The High-Value Regular',
                want: 'A reliable go-to spot that fits their routine and rewards their loyalty.',
                role: 'Highest revenue potential through repeat visits and word-of-mouth referrals.',
                pill: 'Primary Revenue Driver'
            },
            {
                name: 'The Weekend Discovery Seeker',
                want: 'New experiences to share with friends. Discovers through social media, reviews, and group recommendations.',
                role: 'First-visit volume, social proof, and review generation.',
                pill: 'Awareness Engine'
            },
            {
                name: 'The Neighborhood Local',
                want: 'An authentic neighborhood spot with character. Values consistency over novelty.',
                role: 'Community credibility, organic advocacy, and steady weekday traffic.',
                pill: 'Community Anchor'
            }
        ];
    }

    // ── Health & Wellness / Fitness / Spa ──
    if (ind.match(/health|wellness|fitness|spa|yoga|meditation/)) {
        return [
            {
                name: 'The Committed Practitioner',
                want: 'A reliable provider who understands their goals and fits into a weekly routine.',
                role: 'Highest LTV through recurring visits, package purchases, and referrals.',
                pill: 'Primary Revenue Driver'
            },
            {
                name: 'The Resolution Starter',
                want: 'Motivation to begin a wellness journey, with low-barrier entry and visible early results.',
                role: 'New customer volume and seasonal acquisition spikes.',
                pill: 'Acquisition Engine'
            },
            {
                name: 'The Social Wellness Seeker',
                want: 'Wellness experiences to share with friends. Values community and accountability.',
                role: 'Group bookings, social proof, and organic content generation.',
                pill: 'Community Builder'
            }
        ];
    }

    // ── Generic fallback ──
    return [
        {
            name: 'The High-Value Regular',
            want: 'A reliable provider that fits their routine and rewards their loyalty.',
            role: 'Highest revenue potential through repeat visits and word-of-mouth.',
            pill: 'Primary Revenue Driver'
        },
        {
            name: 'The Social Discovery Seeker',
            want: 'New experiences to share with friends. Discovers through social media and recommendations.',
            role: 'Awareness driver, first-visit volume, and social proof engine.',
            pill: 'Awareness Engine'
        },
        {
            name: 'The Local Explorer',
            want: 'Authentic neighborhood spots with character. Values character over chains.',
            role: 'Community credibility and organic advocacy.',
            pill: 'Community Credibility'
        }
    ];
}

function buildDefaultOpportunity(businessName) {
    return `${businessName} has an opportunity to convert existing visibility into owned brand demand by building the awareness, trust, and loyalty systems that turn a first visit into a recurring behavior. The near-term growth challenge is not product or service quality. It is making the business easier to discover, easier to trust on first contact, and easier to return to without a prompt.`;
}

// ── Channel Audit with SVG Icons ───────────────────────────────────────────
function buildChannelAudit(websiteAudit, hasGBP, hasFacebook, hasInstagram, website) {
    const channels = [];

    // Website
    if (!website || website === '') {
        channels.push({
            icon: ICONS.website, name: 'Website', status: 'Not Found', statusClass: 'miss',
            detail: 'No website detected for this business.',
            finding: 'No website means zero organic search visibility and no destination for marketing campaigns.',
            findingSeverity: 'red'
        });
    } else if (websiteAudit.isPlaceholder) {
        channels.push({
            icon: ICONS.website, name: 'Website', status: 'Placeholder Only', statusClass: 'warn',
            detail: `${website} exists but has no real content, menu, or SEO.`,
            finding: `Website at ${website} is a placeholder with no content and no search optimization.`,
            findingSeverity: 'amber'
        });
    } else {
        channels.push({
            icon: ICONS.website, name: 'Website', status: 'Active', statusClass: 'ok',
            detail: `${website} is live.`, finding: null, findingSeverity: null
        });
    }

    // Google Business
    if (!hasGBP) {
        channels.push({
            icon: ICONS.gbp, name: 'Google Business', status: 'Not Found', statusClass: 'miss',
            detail: 'No Google Business Profile. Zero Maps, Search, or Local Pack visibility.',
            finding: 'No Google Business Profile means no Maps presence, no review collection, and no local pack ranking.',
            findingSeverity: 'red'
        });
    } else {
        channels.push({
            icon: ICONS.gbp, name: 'Google Business', status: 'Found', statusClass: 'ok',
            detail: 'Google Business Profile exists.', finding: null, findingSeverity: null
        });
    }

    // Instagram
    channels.push(!hasInstagram
        ? {
            icon: ICONS.instagram, name: 'Instagram', status: 'Not Found', statusClass: 'miss',
            detail: 'No dedicated Instagram account found.', finding: null, findingSeverity: null
        }
        : {
            icon: ICONS.instagram, name: 'Instagram', status: 'Active', statusClass: 'ok',
            detail: 'Instagram account found.', finding: null, findingSeverity: null
        }
    );

    // Facebook
    channels.push(!hasFacebook
        ? {
            icon: ICONS.facebook, name: 'Facebook', status: 'Not Found', statusClass: 'miss',
            detail: 'No Facebook page. No events, reviews, or check-ins.', finding: null, findingSeverity: null
        }
        : {
            icon: ICONS.facebook, name: 'Facebook', status: 'Active', statusClass: 'ok',
            detail: 'Facebook page found.', finding: null, findingSeverity: null
        }
    );

    return channels;
}

// ── Growth Framework ───────────────────────────────────────────────────────
function buildDefaultGrowthFramework() {
    return [
        { title: 'Awareness', description: 'Sharper identity and digital presence so the business is easier to discover and remember.' },
        { title: 'Acquisition', description: 'Focused acquisition through target segments with distinct trial reasons.' },
        { title: 'Trust', description: 'Confidence and clarity built into the customer experience from first impression to first visit.' },
        { title: 'Loyalty', description: 'A repeatable occasion that earns the second, third, and fourth visit.' },
        { title: 'Retention', description: 'Post-visit engagement and a reason to think of this business first.' }
    ];
}

// ── Diagnostics ────────────────────────────────────────────────────────────
function buildDefaultDiagnostics(businessName) {
    return [
        'Which customer target has the highest near-term revenue potential?',
        'Which segment is most likely to become a repeat visitor?',
        `Which occasions can ${businessName} credibly own in this market?`,
        'Where is awareness breaking down: search, social, or word of mouth?',
        'What trust cues reduce hesitation and drive first trial?',
        'What loyalty drivers make customers return without a prompt?'
    ];
}

// ── Roadmap Builder ────────────────────────────────────────────────────────
function buildRoadmap(channels, inputs, sellerProfile) {
    const hasNoWebsite = channels.some(ch => ch.name === 'Website' && ch.statusClass !== 'ok');
    const hasNoGBP = channels.some(ch => ch.name === 'Google Business' && ch.statusClass !== 'ok');

    // Phase 1: Foundation
    const phase1Items = [];
    if (hasNoWebsite) {
        phase1Items.push({
            action: 'Build and launch website',
            product: 'PathSynch · Managed Website',
            detail: 'Full custom build: menu, schedule, SEO-optimized. Replace placeholder or create from scratch.'
        });
    }
    if (hasNoGBP) {
        phase1Items.push({
            action: 'Claim and optimize Google Business Profile',
            product: 'LocalSynch Growth',
            detail: 'Categories, hours, photos, Q&A. Get into Local Pack for target search terms.'
        });
    }
    phase1Items.push({
        action: 'Deploy NFC review capture',
        product: 'PathConnect Growth · 3 NFC Cards',
        detail: 'Tap-to-review cards at key touchpoints. Seed first 25+ Google reviews in 30 days.'
    });
    phase1Items.push({
        action: 'Local market GTM strategy',
        product: 'PathSynch · Growth Advisory',
        detail: 'Full go-to-market plan for all ICPs. Channel priorities, messaging, launch sequence, 90-day KPIs.'
    });

    // Phase 2: Traction
    const phase2Items = [
        {
            action: 'Execute GTM: segment-specific campaigns',
            product: 'Growth Advisory · LocalSynch',
            detail: 'Activate each ICP channel with targeted campaigns, content, and cross-promotion strategies.'
        },
        {
            action: 'Launch customer feedback campaigns',
            product: 'Forms Builder',
            detail: 'Post-visit surveys via NFC and QR. Capture preferences, ratings, and improvement signals.'
        },
        {
            action: 'AI review response + weekly GBP content',
            product: 'PathConnect Growth · LocalSynch Growth',
            detail: 'Every review answered within 2 hours. Weekly GBP posts, photos, event announcements.'
        },
        {
            action: 'Cross-promotion funnel',
            product: 'QRsynch · Forms Builder',
            detail: 'QR-triggered offers that convert one-time visitors into repeat customers. Track conversion rates.'
        }
    ];

    // Phase 3: Scale
    const phase3Items = [
        {
            action: 'Unified analytics dashboard',
            product: 'PathManager',
            detail: 'Single view: reviews, web traffic, form submissions, feedback trends. Weekly digest.'
        },
        {
            action: 'SMS/email capture and retention loop',
            product: 'Forms Builder · PathConnect',
            detail: 'NFC tap captures visitor contact info. Automated post-visit follow-up. Build owned list to 500+.'
        },
        {
            action: 'Feedback-driven optimization',
            product: 'Forms Builder · Growth Advisory',
            detail: 'Analyze 90 days of feedback. What works, what confuses, where trust breaks. Data-backed changes.'
        },
        {
            action: 'GTM review + next quarter plan',
            product: 'PathSynch · Growth Advisory',
            detail: 'What worked, what scales. Refine ICP targeting, update channel mix, plan next 90 days.'
        }
    ];

    return [
        { title: 'Foundation', window: 'Days 1–30', items: phase1Items },
        { title: 'Traction', window: 'Days 31–60', items: phase2Items },
        { title: 'Scale', window: 'Days 61–90', items: phase3Items }
    ];
}

// ── Pricing ────────────────────────────────────────────────────────────────
function buildPricing(inputs, sellerProfile) {
    const monthlyTotal = inputs.monthlyTotal || '$477/mo';
    const setupFee = inputs.setupFee || '$499 one-time setup';
    const packageName = inputs.packageName || 'Customer Growth Platform';
    const competitorName = inputs.competitorName || 'Typical Agency';

    return {
        packageName,
        monthlyTotal,
        setupFee,
        lineItems: [
            'PathConnect Growth — NFC review capture, AI review response, SMS/email collection',
            'LocalSynch Growth — GBP management, weekly posts, competitor analysis, local SEO',
            'Managed Website — Custom-built site with menu, events, SEO, ongoing updates',
            'Forms Builder — Customer feedback campaigns, post-visit surveys, data capture',
            'Local Market GTM Strategy — ICP-specific go-to-market plan, channel strategy, 90-day KPIs',
            'PathManager Dashboard — Unified analytics across all channels'
        ],
        breakdown: [
            { label: 'PathConnect Growth', value: '$149/mo' },
            { label: 'LocalSynch Growth', value: '$199/mo' },
            { label: 'Managed Website', value: '$129/mo' },
            { label: 'Forms + GTM + Dashboard', value: 'Included' }
        ],
        competitorName,
        comparison: [
            { feature: 'Monthly cost', them: '$2,500–5,000', us: monthlyTotal, highlight: true },
            { feature: 'Custom website', them: 'Extra cost', us: 'Included', highlight: false },
            { feature: 'Google Business optimization', them: 'Basic or none', us: 'Full management', highlight: false },
            { feature: 'NFC/QR review capture', them: 'Not offered', us: 'Core feature', highlight: false },
            { feature: 'AI review responses', them: 'Manual', us: 'Automated', highlight: false },
            { feature: 'Customer feedback system', them: 'Not offered', us: 'Included', highlight: false },
            { feature: 'Competitor analysis', them: 'Ad hoc', us: 'Ongoing', highlight: false },
            { feature: 'Go-to-market strategy', them: 'Separate engagement', us: 'Included', highlight: false },
            { feature: 'Unified dashboard', them: 'Scattered reports', us: 'Single view', highlight: false },
            { feature: 'Physical-to-digital attribution', them: 'Not offered', us: 'Core feature', highlight: false }
        ]
    };
}

// ── Page 1 Renderer ────────────────────────────────────────────────────────
function renderPage1({ businessName, city, state, sellerName, opportunityText, icps, channels, growthFramework }) {
    const location = [city, state].filter(Boolean).join(', ');

    // ICP cards
    const icpHtml = icps.map(icp => `
<div class="icp-card">
  <div class="icp-top">
    <div class="icp-name">${escHtml(icp.name)}</div>
    <div class="icp-pill">${escHtml(icp.pill)}</div>
  </div>
  <div class="icp-row"><span class="icp-label">What they want</span><span class="icp-val">${escHtml(icp.want)}</span></div>
  <div class="icp-row"><span class="icp-label">Growth role</span><span class="icp-val">${escHtml(icp.role)}</span></div>
</div>`).join('');

    // Channel audit
    const channelHtml = channels.map(ch => `
<div class="ch">
  <div class="ch-icon">${ch.icon}</div>
  <div class="ch-name">${escHtml(ch.name)}</div>
  <div class="ch-status ${escHtml(ch.statusClass)}">${escHtml(ch.status)}</div>
  <div class="ch-detail">${escHtml(ch.detail)}</div>
</div>`).join('');

    // Key findings (red/amber only)
    const findings = channels.filter(ch => ch.finding);
    const findingsHtml = findings.length === 0 ? '' : `
<div class="findings">
  <div class="tag" style="margin-bottom:5px;">Key Findings</div>
  ${findings.map(f => `<div class="finding ${escHtml(f.findingSeverity)}">${escHtml(f.finding)}</div>`).join('')}
</div>`;

    // Growth framework
    const frameworkHtml = growthFramework.map((step, i) => `
<div class="fw-step">
  <div class="fw-num">${i + 1}</div>
  <div>
    <div class="fw-title">${escHtml(step.title)}</div>
    <div class="fw-desc">${escHtml(step.description)}</div>
  </div>
</div>`).join('');

    return `
<div class="page">
  <div class="bar"></div>
  <div class="hdr">
    <div>
      <div class="bn">${escHtml(businessName)}</div>
      <div class="bl">${escHtml(location)}</div>
    </div>
    <div class="hdr-right">
      <div class="doc-title">Customer Growth Snapshot</div>
      <div class="spn">Page 1 of 2 · Prepared by ${escHtml(sellerName)}</div>
    </div>
  </div>

  <div class="bd1">
    <div class="opp">
      <div class="tag">Growth Opportunity</div>
      <p class="opp-text">${escHtml(opportunityText)}</p>
    </div>

    <div class="section">
      <div class="tag">Ideal Customer Profiles (ICPs)</div>
      <div class="icp-grid">${icpHtml}</div>
    </div>

    <div class="section">
      <div class="tag">Digital Presence Audit</div>
      <div class="ch-grid">${channelHtml}</div>
      ${findingsHtml}
    </div>

    <div class="section">
      <div class="tag">Growth Framework</div>
      <div class="fw">${frameworkHtml}</div>
    </div>
  </div>

  <div class="ft">
    <span class="cf">Confidential</span>
    <span>${escHtml(sellerName)} · Customer Growth Advisory · ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
  </div>
  <div class="bar"></div>
</div>`;
}

// ── Page 2 Renderer ────────────────────────────────────────────────────────
function renderPage2({ businessName, sellerName, roadmap, pricing, diagnostics }) {

    // Roadmap HTML
    const roadmapHtml = roadmap.map(phase => {
        const itemsHtml = phase.items.map(item => `
<div class="rm-item">
  <div class="rm-action">${escHtml(item.action)}</div>
  <div class="rm-product">${escHtml(item.product)}</div>
  <div class="rm-detail">${escHtml(item.detail)}</div>
</div>`).join('');

        return `
<div class="rm-phase">
  <div class="rm-phase-hdr">
    <div class="rm-phase-title">${escHtml(phase.title)}</div>
    <div class="rm-phase-window">${escHtml(phase.window)}</div>
  </div>
  <div class="rm-items">${itemsHtml}</div>
</div>`;
    }).join('');

    // Investment card
    const breakdownHtml = pricing.breakdown.map(b =>
        `<div class="bd-row"><span class="bd-label">${escHtml(b.label)}</span><span class="bd-value">${escHtml(b.value)}</span></div>`
    ).join('');

    const investCardHtml = `
<div class="invest-card">
  <div class="tag">${escHtml(pricing.packageName)}</div>
  <div class="invest-total">${escHtml(pricing.monthlyTotal)}</div>
  <div class="invest-setup">${escHtml(pricing.setupFee)}</div>
  <div class="bd">${breakdownHtml}</div>
</div>`;

    // Comparison table
    const compareRowsHtml = pricing.comparison.map(row => `
<tr class="${row.highlight ? 'hi-row' : ''}">
  <td>${escHtml(row.feature)}</td>
  <td class="them">${escHtml(row.them)}</td>
  <td class="us">${escHtml(row.us)}</td>
</tr>`).join('');

    const compareHtml = `
<div class="compare">
  <table class="cmp-table">
    <thead>
      <tr>
        <th>Feature</th>
        <th>${escHtml(pricing.competitorName)}</th>
        <th>PathSynch</th>
      </tr>
    </thead>
    <tbody>${compareRowsHtml}</tbody>
  </table>
</div>`;

    // Diagnostics
    const diagHtml = diagnostics.map(q =>
        `<div class="dq">${escHtml(q)}</div>`
    ).join('');

    return `
<div class="page">
  <div class="bar"></div>
  <div class="hdr-slim">
    <div class="sbn">${escHtml(sellerName)} · ${escHtml(businessName)} Growth Opportunity</div>
    <div class="spn">Page 2 of 2</div>
  </div>

  <div class="bd2">
    <div>
      <div class="tag">90-Day Growth Roadmap</div>
      <div class="roadmap" style="margin-top:7px;">${roadmapHtml}</div>
    </div>

    <div class="invest">
      ${investCardHtml}
      ${compareHtml}
    </div>

    <div class="diag">
      <div class="tag">Diagnostic Questions</div>
      <div class="diag-grid">${diagHtml}</div>
    </div>

    <div class="cta">
      <div class="cta-l">
        <div class="ct">Let's Talk</div>
        <div class="ch2">30-Day Foundation Sprint</div>
      </div>
      <div class="cta-r">Website live, GBP claimed, NFC deployed, GTM strategy delivered, first feedback campaign running. Real results in 30 days.</div>
    </div>
  </div>

  <div class="ft">
    <span class="cf">Confidential</span>
    <span>${escHtml(sellerName)} · Customer Growth Advisory · ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
  </div>
  <div class="bar"></div>
</div>`;
}

// ── CSS ────────────────────────────────────────────────────────────────────
function getStyles() {
    return `
:root {
  --g500: #22C55E;
  --g600: #16A34A;
  --g50:  #F0FDF4;
  --g100: #DCFCE7;
  --n50:  #FAFAF9;
  --n100: #F5F5F4;
  --n200: #E7E5E4;
  --n300: #D6D3D1;
  --n400: #A8A29E;
  --n500: #78716C;
  --n600: #57534E;
  --n700: #44403C;
  --n800: #292524;
  --n900: #1C1917;
  --amber:#D97706;
  --red:  #DC2626;
  --blue: #2563EB;
  --white:#FFFFFF;
  --page-bg: #FAFAF9;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Satoshi Variable', 'Inter', 'Helvetica Neue', sans-serif;
  background: var(--n100);
  color: var(--n800);
  font-size: 9pt;
  line-height: 1.45;
}

/* ── Page Layout ── */
.page {
  width: 210mm;
  min-height: 297mm;
  margin: 10mm auto;
  background: var(--page-bg);
  display: flex;
  flex-direction: column;
  box-shadow: 0 2px 12px rgba(0,0,0,0.08);
  page-break-after: always;
}

@media print {
  body { background: #fff; }
  .page { margin: 0; box-shadow: none; page-break-after: always; }
}

/* ── Brand Bar ── */
.bar {
  height: 4px;
  background: linear-gradient(90deg, var(--g500) 0%, var(--g600) 100%);
}

/* ── Header ── */
.hdr {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 12px 18px 10px;
  border-bottom: 1px solid var(--n200);
}

.bn {
  font-size: 13pt;
  font-weight: 700;
  color: var(--n900);
  line-height: 1.2;
}

.bl {
  font-size: 7.5pt;
  color: var(--n500);
  margin-top: 2px;
}

.hdr-right {
  text-align: right;
}

.doc-title {
  font-size: 9pt;
  font-weight: 600;
  color: var(--g600);
  letter-spacing: 0.02em;
}

.spn {
  font-size: 6.5pt;
  color: var(--n400);
  margin-top: 2px;
}

.hdr-slim {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 18px;
  border-bottom: 1px solid var(--n200);
}

.sbn {
  font-size: 7.5pt;
  font-weight: 600;
  color: var(--n700);
}

/* ── Body Layouts ── */
.bd1 {
  flex: 1;
  padding: 12px 18px;
  display: flex;
  flex-direction: column;
  gap: 11px;
}

.bd2 {
  flex: 1;
  padding: 12px 18px;
  display: flex;
  flex-direction: column;
  gap: 11px;
}

/* ── Section Tags ── */
.tag {
  font-size: 6pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--g600);
}

.section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ── Opportunity ── */
.opp {
  background: var(--g50);
  border: 1px solid var(--g100);
  border-radius: 8px;
  padding: 10px 12px;
}

.opp-text {
  font-size: 7.5pt;
  color: var(--n700);
  line-height: 1.5;
  margin-top: 4px;
  font-weight: 450;
}

/* ── ICP Cards ── */
.icp-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 7px;
  margin-top: 6px;
}

.icp-card {
  background: var(--white);
  border: 1px solid var(--n200);
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.icp-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 6px;
}

.icp-name {
  font-size: 7pt;
  font-weight: 700;
  color: var(--n900);
  line-height: 1.3;
}

.icp-pill {
  font-size: 5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--g600);
  background: var(--g100);
  border-radius: 3px;
  padding: 2px 5px;
  white-space: nowrap;
  flex-shrink: 0;
}

.icp-row {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.icp-label {
  font-size: 5.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--n400);
}

.icp-val {
  font-size: 6.5pt;
  color: var(--n700);
  line-height: 1.4;
}

/* ── Channel Audit ── */
.ch-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-top: 5px;
}

.ch {
  background: var(--white);
  border: 1px solid var(--n200);
  border-radius: 7px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 3px;
}

.ch-icon {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 20px;
  margin-bottom: 3px;
}

.ch-name {
  font-size: 6.5pt;
  font-weight: 700;
  color: var(--n800);
}

.ch-status {
  font-size: 6pt;
  font-weight: 600;
  border-radius: 3px;
  padding: 1px 5px;
}

.ch-status.ok   { color: var(--g600); background: var(--g100); }
.ch-status.warn { color: var(--amber); background: #FEF3C7; }
.ch-status.miss { color: var(--red);   background: #FEE2E2; }

.ch-detail {
  font-size: 5.5pt;
  color: var(--n500);
  line-height: 1.4;
}

.findings {
  margin-top: 5px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.finding {
  font-size: 6.5pt;
  line-height: 1.4;
  padding: 5px 8px;
  border-radius: 5px;
  border-left: 3px solid;
}

.finding.red   { background: #FEF2F2; color: var(--red);   border-color: var(--red);   }
.finding.amber { background: #FFFBEB; color: var(--amber); border-color: var(--amber); }

/* ── Growth Framework ── */
.fw {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 6px;
}

.fw-step {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.fw-num {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--g500);
  color: #fff;
  font-size: 6.5pt;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.fw-title {
  font-size: 7pt;
  font-weight: 700;
  color: var(--n800);
}

.fw-desc {
  font-size: 6.5pt;
  color: var(--n600);
  line-height: 1.4;
  margin-top: 1px;
}

/* ── Roadmap ── */
.roadmap {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.rm-phase {
  background: var(--white);
  border: 1px solid var(--n200);
  border-radius: 8px;
  overflow: hidden;
}

.rm-phase-hdr {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--n100);
  padding: 5px 10px;
  border-bottom: 1px solid var(--n200);
}

.rm-phase-title {
  font-size: 7pt;
  font-weight: 700;
  color: var(--n800);
}

.rm-phase-window {
  font-size: 6pt;
  font-weight: 600;
  color: var(--g600);
  background: var(--g100);
  padding: 1px 6px;
  border-radius: 3px;
}

.rm-items {
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.rm-item {
  border-left: 2px solid var(--g500);
  padding-left: 7px;
}

.rm-action {
  font-size: 6.5pt;
  font-weight: 700;
  color: var(--n800);
}

.rm-product {
  font-size: 5.5pt;
  font-weight: 600;
  color: var(--g600);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-top: 1px;
}

.rm-detail {
  font-size: 6pt;
  color: var(--n500);
  line-height: 1.4;
  margin-top: 1px;
}

/* ── Investment ── */
.invest {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 8px;
  align-items: start;
}

.invest-card {
  background: var(--g50);
  border: 1px solid var(--g100);
  border-radius: 8px;
  padding: 10px 12px;
}

.invest-total {
  font-size: 18pt;
  font-weight: 700;
  color: var(--g600);
  margin: 4px 0 2px;
  line-height: 1;
}

.invest-setup {
  font-size: 6.5pt;
  color: var(--n500);
  margin-bottom: 8px;
}

.bd {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-top: 7px;
  border-top: 1px solid var(--g100);
}

.bd-row {
  display: flex;
  justify-content: space-between;
  font-size: 6.5pt;
}

.bd-label { color: var(--n600); }
.bd-value { font-weight: 600; color: var(--n800); }

/* ── Comparison Table ── */
.compare {
  overflow: hidden;
}

.cmp-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 6.5pt;
}

.cmp-table th {
  font-size: 6pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 5px 7px;
  background: var(--n100);
  color: var(--n600);
  text-align: left;
  border-bottom: 1px solid var(--n200);
}

.cmp-table td {
  padding: 4px 7px;
  border-bottom: 1px solid var(--n100);
  color: var(--n700);
}

.cmp-table .hi-row td {
  background: var(--g50);
  font-weight: 700;
}

.cmp-table .them { color: var(--n400); }
.cmp-table .us   { color: var(--g600); font-weight: 600; }

/* ── Diagnostics ── */
.diag {
  background: var(--white);
  border: 1px solid var(--n200);
  border-radius: 8px;
  padding: 12px 14px;
}

.diag-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 14px;
  margin-top: 6px;
}

.dq {
  font-size: 5.8pt;
  color: var(--n700);
  line-height: 1.4;
  padding-left: 9px;
  position: relative;
  font-weight: 400;
}

.dq::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--g500);
}

/* ── CTA ── */
.cta {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 14px;
  align-items: center;
  background: var(--n900);
  color: #fff;
  border-radius: 8px;
  padding: 12px 16px;
}

.ct {
  font-size: 13pt;
  font-weight: 700;
  line-height: 1.1;
}

.ch2 {
  font-size: 7pt;
  font-weight: 600;
  color: var(--g500);
  margin-top: 3px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.cta-r {
  font-size: 6.5pt;
  color: #D1FAE5;
  line-height: 1.5;
}

/* ── Footer ── */
.ft {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 18px;
  border-top: 1px solid var(--n200);
  font-size: 6pt;
  color: var(--n400);
}

.cf {
  font-weight: 600;
  color: var(--n500);
}
`;
}

// ── Main Export ────────────────────────────────────────────────────────────
function renderGrowthSnapshot(pitchContext, sellerProfile) {
    const {
        sections, inputs, prospect, analysis,
        urgencyHook, solutionPackage, marketContext
    } = pitchContext;

    const aiResults = pitchContext.aiResults || {};

    // Business info
    const businessName = inputs.businessName || prospect?.businessName || '';
    const city = inputs.city || prospect?.city || '';
    const state = inputs.state || prospect?.state || '';
    const industry = inputs.industry || prospect?.industry || '';
    const website = inputs.websiteUrl || prospect?.website || '';

    // Seller info
    const sellerName = sellerProfile?.companyName || sellerProfile?.name || 'PathSynch';

    // Rating/review data
    const rating = parseFloat(inputs.googleRating) || prospect?.rating || 0;

    // Digital presence audit data
    const websiteAudit = analysis?.websiteAudit || {};
    const hasGBP = analysis?.gbpStatus === 'found' || rating > 0;
    const hasFacebook = websiteAudit.hasFacebook === true;
    const hasInstagram = websiteAudit.hasInstagram === true;

    // Build all data sections
    const channels = buildChannelAudit(websiteAudit, hasGBP, hasFacebook, hasInstagram, website);
    const icps = aiResults.icps || buildContentFallback(industry, businessName, website);
    const growthFramework = aiResults.growthFramework || buildDefaultGrowthFramework();
    const opportunityText = aiResults.opportunityStatement || buildDefaultOpportunity(businessName);
    const diagnostics = aiResults.diagnosticQuestions || buildDefaultDiagnostics(businessName);
    const roadmap = buildRoadmap(channels, inputs, sellerProfile);
    const pricing = buildPricing(inputs, sellerProfile);

    const page1 = renderPage1({
        businessName, city, state, sellerName,
        opportunityText, icps, channels, growthFramework
    });

    const page2 = renderPage2({
        businessName, sellerName,
        roadmap, pricing, diagnostics
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(businessName)} — Customer Growth Snapshot</title>
<link href="https://api.fontshare.com/v2/css?f[]=satoshi@400,450,500,700&display=swap" rel="stylesheet">
<style>${getStyles()}</style>
</head>
<body>
${page1}
${page2}
</body>
</html>`;
}

module.exports = { renderGrowthSnapshot };
