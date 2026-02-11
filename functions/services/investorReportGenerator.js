/**
 * Investor Report Generator Service
 *
 * Uses Gemini AI to generate investor update reports from aggregated metrics.
 * Supports multiple templates: Monthly Update, Quarterly Report, Board Deck
 */

const investorUpdates = require('./investorUpdates');
const metricsAggregator = require('./metricsAggregator');

// Import Gemini client
let geminiClient;
try {
    geminiClient = require('./geminiClientV2');
} catch (e) {
    console.warn('Gemini client not available, using fallback');
}

// ============================================================
// REPORT TEMPLATES
// ============================================================

const REPORT_PROMPTS = {
    monthly_update: `You are an expert startup advisor helping founders write compelling investor updates.

Generate a concise monthly investor update based on the provided metrics. The update should:
1. Start with a brief executive summary (2-3 sentences)
2. Highlight key wins and achievements
3. Present metrics with context (month-over-month changes)
4. Note any challenges or areas needing attention
5. End with asks or areas where investors can help

Keep the tone professional but personable. Investors appreciate honesty about challenges.

Format the output as JSON with this structure:
{
    "executiveSummary": "string (2-3 sentences overview)",
    "highlights": [
        { "title": "string", "description": "string", "metric": "string (optional)" }
    ],
    "metrics": {
        "revenue": { "value": "string", "change": "string", "commentary": "string" },
        "customers": { "value": "string", "change": "string", "commentary": "string" },
        "mrr": { "value": "string", "change": "string", "commentary": "string" },
        "traffic": { "value": "string", "change": "string", "commentary": "string" }
    },
    "challenges": [
        { "title": "string", "description": "string", "mitigation": "string" }
    ],
    "asks": [
        { "type": "string (intro/advice/resource)", "description": "string" }
    ],
    "closingNote": "string (brief personal note)"
}`,

    quarterly_report: `You are an expert startup advisor helping founders write comprehensive quarterly reports for investors.

Generate a detailed quarterly investor report based on the provided metrics. The report should:
1. Executive summary with quarter highlights
2. Detailed financial analysis with trends
3. Product/business updates and milestones
4. Team updates if applicable
5. Strategic roadmap for next quarter
6. Risk assessment and mitigation
7. Capital and runway discussion

Be thorough but concise. Use data to support all claims.

Format the output as JSON with this structure:
{
    "executiveSummary": {
        "headline": "string",
        "overview": "string (3-4 sentences)",
        "quarterGrade": "string (A/B/C/D)"
    },
    "financials": {
        "revenue": { "value": "string", "qoq": "string", "yoy": "string", "analysis": "string" },
        "mrr": { "value": "string", "qoq": "string", "trend": "string" },
        "expenses": { "value": "string", "breakdown": "string" },
        "runway": { "months": "number", "commentary": "string" }
    },
    "product": {
        "highlights": ["string"],
        "metrics": { "users": "string", "engagement": "string" },
        "roadmap": ["string"]
    },
    "team": {
        "headcount": "number",
        "keyHires": ["string"],
        "openRoles": ["string"]
    },
    "risks": [
        { "risk": "string", "likelihood": "string", "mitigation": "string" }
    ],
    "nextQuarter": {
        "priorities": ["string"],
        "targets": { "revenue": "string", "customers": "string" }
    },
    "asks": [
        { "category": "string", "request": "string" }
    ]
}`,

    board_deck: `You are an expert startup advisor helping founders prepare board meeting presentations.

Generate content for a board deck based on the provided metrics. The deck should be structured for a 45-60 minute board meeting.

Format the output as JSON with slides:
{
    "slides": [
        {
            "slideNumber": 1,
            "title": "Company Update - [Period]",
            "type": "title",
            "content": { "subtitle": "string", "date": "string" }
        },
        {
            "slideNumber": 2,
            "title": "Executive Summary",
            "type": "summary",
            "content": {
                "headline": "string",
                "bullets": ["string"],
                "scorecard": { "revenue": "green/yellow/red", "product": "green/yellow/red", "team": "green/yellow/red" }
            }
        },
        {
            "slideNumber": 3,
            "title": "Key Metrics",
            "type": "metrics",
            "content": {
                "metrics": [
                    { "name": "string", "value": "string", "change": "string", "status": "green/yellow/red" }
                ]
            }
        },
        {
            "slideNumber": 4,
            "title": "Revenue & Growth",
            "type": "chart",
            "content": {
                "headline": "string",
                "dataPoints": [{ "label": "string", "value": "number" }],
                "insight": "string"
            }
        },
        {
            "slideNumber": 5,
            "title": "Product Update",
            "type": "bullets",
            "content": {
                "shipped": ["string"],
                "inProgress": ["string"],
                "upNext": ["string"]
            }
        },
        {
            "slideNumber": 6,
            "title": "Customer & Market",
            "type": "bullets",
            "content": {
                "customers": "string",
                "wins": ["string"],
                "pipeline": "string"
            }
        },
        {
            "slideNumber": 7,
            "title": "Team & Operations",
            "type": "bullets",
            "content": {
                "headcount": "string",
                "recentHires": ["string"],
                "openRoles": ["string"]
            }
        },
        {
            "slideNumber": 8,
            "title": "Financials",
            "type": "table",
            "content": {
                "revenue": "string",
                "expenses": "string",
                "burn": "string",
                "runway": "string",
                "cashPosition": "string"
            }
        },
        {
            "slideNumber": 9,
            "title": "Risks & Challenges",
            "type": "bullets",
            "content": {
                "risks": [{ "risk": "string", "mitigation": "string" }]
            }
        },
        {
            "slideNumber": 10,
            "title": "Asks & Discussion",
            "type": "bullets",
            "content": {
                "asks": ["string"],
                "discussionTopics": ["string"]
            }
        }
    ],
    "appendix": {
        "detailedMetrics": {},
        "notes": "string"
    }
}`
};

// ============================================================
// REPORT GENERATION
// ============================================================

/**
 * Generate an investor update report
 * @param {string} userId - User ID
 * @param {Object} options - Generation options
 */
async function generateReport(userId, options = {}) {
    const {
        template = 'monthly_update',
        period = investorUpdates.getCurrentPeriod(),
        customHighlights = [],
        customChallenges = [],
        customAsks = [],
        companyName = '',
        founderName = ''
    } = options;

    // Fetch current period metrics
    const currentMetrics = await metricsAggregator.fetchAllMetrics(userId, period);

    // Fetch previous period for comparison
    const previousPeriod = metricsAggregator.getPreviousPeriod(period);
    const comparison = await metricsAggregator.getMetricsComparison(userId, period, previousPeriod);

    // Build context for AI
    const context = buildReportContext({
        period,
        previousPeriod,
        currentMetrics,
        comparison,
        customHighlights,
        customChallenges,
        customAsks,
        companyName,
        founderName
    });

    // Get template prompt
    const systemPrompt = REPORT_PROMPTS[template] || REPORT_PROMPTS.monthly_update;

    // Generate report content using Gemini
    let reportContent;
    let tokensUsed = 0;

    if (geminiClient) {
        try {
            const result = await geminiClient.generateText({
                systemPrompt,
                userPrompt: `Generate an investor update for the following data:\n\n${JSON.stringify(context, null, 2)}`,
                maxTokens: 4000,
                temperature: 0.7
            });

            // Parse JSON from response
            const jsonMatch = result.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                reportContent = JSON.parse(jsonMatch[0]);
            } else {
                reportContent = { error: 'Failed to parse report content', raw: result.text };
            }

            tokensUsed = result.usage?.totalTokens || 0;
        } catch (error) {
            console.error('AI generation error:', error);
            reportContent = generateFallbackReport(context, template);
        }
    } else {
        reportContent = generateFallbackReport(context, template);
    }

    // Generate HTML version
    const html = generateReportHtml(reportContent, template, context);
    const markdown = generateReportMarkdown(reportContent, template, context);

    // Save the report
    const report = await investorUpdates.createInvestorUpdate(userId, {
        template,
        period,
        title: `${template === 'monthly_update' ? 'Monthly' : template === 'quarterly_report' ? 'Quarterly' : 'Board'} Update - ${formatPeriod(period)}`,
        metrics: currentMetrics,
        content: reportContent,
        highlights: customHighlights,
        challenges: customChallenges,
        asks: customAsks,
        generatedHtml: html,
        generatedMarkdown: markdown,
        tokensUsed
    });

    return {
        updateId: report.updateId,
        title: report.title,
        period,
        template,
        content: reportContent,
        html,
        markdown,
        tokensUsed
    };
}

/**
 * Build context object for AI generation
 */
function buildReportContext(data) {
    const {
        period,
        previousPeriod,
        currentMetrics,
        comparison,
        customHighlights,
        customChallenges,
        customAsks,
        companyName,
        founderName
    } = data;

    return {
        period: formatPeriod(period),
        previousPeriod: formatPeriod(previousPeriod),
        companyName: companyName || 'The Company',
        founderName: founderName || 'The Team',

        // Current metrics by provider
        metrics: {
            stripe: currentMetrics.providers?.stripe || null,
            shopify: currentMetrics.providers?.shopify || null,
            quickbooks: currentMetrics.providers?.quickbooks || null,
            ga4: currentMetrics.providers?.ga4 || null
        },

        // Summary metrics
        summary: currentMetrics.summary || {},

        // Period-over-period comparison
        comparison: comparison.providers || {},

        // User-provided context
        highlights: customHighlights,
        challenges: customChallenges,
        asks: customAsks
    };
}

/**
 * Generate fallback report when AI is unavailable
 */
function generateFallbackReport(context, template) {
    const metrics = context.metrics;
    const summary = context.summary;

    if (template === 'monthly_update') {
        return {
            executiveSummary: `This month we generated ${investorUpdates.formatCurrency(summary.totalRevenue || 0)} in revenue with ${summary.customers || 0} customers. Traffic was ${summary.sessions || 0} sessions.`,
            highlights: context.highlights.length > 0 ? context.highlights.map(h => ({
                title: h,
                description: '',
                metric: ''
            })) : [{ title: 'Report generated', description: 'Metrics collected from connected integrations', metric: '' }],
            metrics: {
                revenue: {
                    value: investorUpdates.formatCurrency(summary.totalRevenue || 0),
                    change: 'See comparison data',
                    commentary: 'From Stripe and Shopify'
                },
                customers: {
                    value: String(summary.customers || 0),
                    change: 'See comparison data',
                    commentary: 'Active subscribers and unique customers'
                },
                mrr: {
                    value: investorUpdates.formatCurrency(summary.mrr || 0),
                    change: 'See comparison data',
                    commentary: 'Monthly recurring revenue'
                },
                traffic: {
                    value: investorUpdates.formatNumber(summary.sessions || 0),
                    change: 'See comparison data',
                    commentary: 'Website sessions from GA4'
                }
            },
            challenges: context.challenges.map(c => ({
                title: c,
                description: '',
                mitigation: ''
            })),
            asks: context.asks.map(a => ({
                type: 'general',
                description: a
            })),
            closingNote: 'Thank you for your continued support.'
        };
    }

    // Similar fallbacks for other templates...
    return {
        generated: false,
        message: 'AI generation unavailable, showing raw metrics',
        metrics: context.metrics,
        summary: context.summary
    };
}

// ============================================================
// HTML GENERATION
// ============================================================

/**
 * Generate HTML version of report
 */
function generateReportHtml(content, template, context) {
    const primaryColor = '#3A6746';

    if (template === 'monthly_update') {
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 700px;
            margin: 0 auto;
            padding: 40px 20px;
            color: #333;
            line-height: 1.6;
        }
        .header {
            text-align: center;
            margin-bottom: 40px;
            padding-bottom: 20px;
            border-bottom: 3px solid ${primaryColor};
        }
        .header h1 {
            color: ${primaryColor};
            margin: 0 0 10px 0;
        }
        .header .period {
            color: #666;
            font-size: 18px;
        }
        .summary {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
            font-size: 16px;
        }
        .section {
            margin-bottom: 30px;
        }
        .section h2 {
            color: ${primaryColor};
            border-bottom: 2px solid #e5e7eb;
            padding-bottom: 10px;
            margin-bottom: 15px;
        }
        .highlight {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            margin-bottom: 15px;
            padding: 15px;
            background: #f0fdf4;
            border-radius: 8px;
        }
        .highlight .icon {
            font-size: 24px;
        }
        .highlight .content h4 {
            margin: 0 0 5px 0;
            color: ${primaryColor};
        }
        .highlight .content p {
            margin: 0;
            color: #666;
        }
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 15px;
        }
        .metric-card {
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 15px;
        }
        .metric-card .label {
            font-size: 12px;
            color: #666;
            text-transform: uppercase;
        }
        .metric-card .value {
            font-size: 24px;
            font-weight: 700;
            color: ${primaryColor};
            margin: 5px 0;
        }
        .metric-card .change {
            font-size: 14px;
            color: #10b981;
        }
        .metric-card .change.negative {
            color: #ef4444;
        }
        .challenge {
            background: #fef3c7;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 10px;
            border-left: 4px solid #f59e0b;
        }
        .ask {
            background: #eff6ff;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 10px;
            border-left: 4px solid #3b82f6;
        }
        .closing {
            text-align: center;
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
            color: #666;
            font-style: italic;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>${context.companyName} Investor Update</h1>
        <div class="period">${context.period}</div>
    </div>

    <div class="summary">
        ${content.executiveSummary || ''}
    </div>

    ${content.highlights?.length > 0 ? `
    <div class="section">
        <h2>Highlights</h2>
        ${content.highlights.map(h => `
            <div class="highlight">
                <span class="icon">🎯</span>
                <div class="content">
                    <h4>${h.title || ''}</h4>
                    <p>${h.description || ''}</p>
                    ${h.metric ? `<p><strong>${h.metric}</strong></p>` : ''}
                </div>
            </div>
        `).join('')}
    </div>
    ` : ''}

    <div class="section">
        <h2>Key Metrics</h2>
        <div class="metrics-grid">
            ${Object.entries(content.metrics || {}).map(([key, m]) => `
                <div class="metric-card">
                    <div class="label">${key}</div>
                    <div class="value">${m.value || '-'}</div>
                    <div class="change">${m.change || ''}</div>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">${m.commentary || ''}</p>
                </div>
            `).join('')}
        </div>
    </div>

    ${content.challenges?.length > 0 ? `
    <div class="section">
        <h2>Challenges</h2>
        ${content.challenges.map(c => `
            <div class="challenge">
                <strong>${c.title || ''}</strong>
                <p>${c.description || ''}</p>
                ${c.mitigation ? `<p><em>Mitigation: ${c.mitigation}</em></p>` : ''}
            </div>
        `).join('')}
    </div>
    ` : ''}

    ${content.asks?.length > 0 ? `
    <div class="section">
        <h2>Where You Can Help</h2>
        ${content.asks.map(a => `
            <div class="ask">
                <strong>${a.type || 'Request'}:</strong> ${a.description || ''}
            </div>
        `).join('')}
    </div>
    ` : ''}

    <div class="closing">
        ${content.closingNote || 'Thank you for your continued support.'}
        <br><br>
        — ${context.founderName}
    </div>
</body>
</html>`;
    }

    // Default/fallback HTML
    return `<html><body><pre>${JSON.stringify(content, null, 2)}</pre></body></html>`;
}

/**
 * Generate Markdown version of report
 */
function generateReportMarkdown(content, template, context) {
    if (template === 'monthly_update') {
        let md = `# ${context.companyName} Investor Update\n\n`;
        md += `**Period:** ${context.period}\n\n`;
        md += `---\n\n`;
        md += `## Executive Summary\n\n${content.executiveSummary || ''}\n\n`;

        if (content.highlights?.length > 0) {
            md += `## Highlights\n\n`;
            content.highlights.forEach(h => {
                md += `### ${h.title || ''}\n${h.description || ''}\n`;
                if (h.metric) md += `**${h.metric}**\n`;
                md += '\n';
            });
        }

        md += `## Key Metrics\n\n`;
        md += `| Metric | Value | Change | Notes |\n`;
        md += `|--------|-------|--------|-------|\n`;
        Object.entries(content.metrics || {}).forEach(([key, m]) => {
            md += `| ${key} | ${m.value || '-'} | ${m.change || '-'} | ${m.commentary || ''} |\n`;
        });
        md += '\n';

        if (content.challenges?.length > 0) {
            md += `## Challenges\n\n`;
            content.challenges.forEach(c => {
                md += `### ${c.title || ''}\n${c.description || ''}\n`;
                if (c.mitigation) md += `*Mitigation: ${c.mitigation}*\n`;
                md += '\n';
            });
        }

        if (content.asks?.length > 0) {
            md += `## Where You Can Help\n\n`;
            content.asks.forEach(a => {
                md += `- **${a.type || 'Request'}:** ${a.description || ''}\n`;
            });
            md += '\n';
        }

        md += `---\n\n`;
        md += `*${content.closingNote || 'Thank you for your continued support.'}*\n\n`;
        md += `— ${context.founderName}\n`;

        return md;
    }

    return `# Investor Update\n\n\`\`\`json\n${JSON.stringify(content, null, 2)}\n\`\`\``;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Format period string for display
 */
function formatPeriod(period) {
    if (period.includes('Q')) {
        const [year, quarter] = period.split('-Q');
        return `Q${quarter} ${year}`;
    }

    const [year, month] = period.split('-');
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    return `${monthNames[parseInt(month) - 1]} ${year}`;
}

/**
 * Regenerate report with updated inputs
 */
async function regenerateReport(userId, updateId, options = {}) {
    // Get existing report
    const existing = await investorUpdates.getInvestorUpdate(updateId, userId);

    if (!existing) {
        throw new Error('Report not found');
    }

    // Merge options
    const mergedOptions = {
        template: existing.template,
        period: existing.period,
        customHighlights: options.highlights || existing.highlights,
        customChallenges: options.challenges || existing.challenges,
        customAsks: options.asks || existing.asks,
        ...options
    };

    // Delete old report
    await investorUpdates.deleteInvestorUpdate(updateId, userId);

    // Generate new report
    return generateReport(userId, mergedOptions);
}

module.exports = {
    generateReport,
    regenerateReport,
    formatPeriod,
    REPORT_PROMPTS
};
