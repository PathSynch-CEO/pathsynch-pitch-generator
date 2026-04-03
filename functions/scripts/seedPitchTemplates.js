/**
 * Seed Script: pitchTemplates Collection
 *
 * Uploads the Review Audit One-Pager template to Firestore.
 * Run from functions/ directory:
 *   node scripts/seedPitchTemplates.js
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS env var pointing to service account key:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS="C:/Users/tdh35/pathsynch-pitch-creation-c6d08f00a3fc.json"
 */

const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin with explicit credentials for local script use
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: 'pathsynch-pitch-creation'
    });
}

const db = admin.firestore();

// The template payload — loaded inline so no file path dependency at runtime
const template = {
    "templateId": "review-audit-onepager-v1",
    "templateName": "Review Audit One-Pager",
    "templateType": "L2_ONE_PAGER",
    "version": "1.0.0",
    "createdFrom": "Brewhouse Cafe - March 2026",
    "description": "Single-page review audit pitch for local businesses. Combines review data, complaint pattern analysis, positive review highlights, and a PathSynch solution package. Designed to be handed to a business owner in person or sent as a follow-up.",
    "layout": {
        "pageSize": "letter",
        "orientation": "portrait",
        "margins": { "top": 0.5, "right": 0.6, "bottom": 0.5, "left": 0.6 },
        "colorScheme": {
            "primary": "#0D9488",
            "accent": "#F59E0B",
            "dark": "#111827",
            "muted": "#6B7280",
            "background": "#FCFBF8",
            "cardBg": "#F9FAFB",
            "alertRed": "#EF4444",
            "successGreen": "#10B981"
        },
        "fonts": {
            "display": "Syne",
            "body": "DM Sans",
            "fallback": "Helvetica"
        }
    },
    "sections": [
        {
            "sectionId": "header",
            "sectionName": "Header Bar",
            "order": 1,
            "required": true,
            "layout": "horizontal_bar",
            "fields": [
                {
                    "fieldId": "logo",
                    "type": "image",
                    "source": "sellerProfile.branding.logo",
                    "fallback": "PathSynch Labs text logo",
                    "position": "left"
                },
                {
                    "fieldId": "preparedFor",
                    "type": "text",
                    "template": "PREPARED FOR {{prospectName}}",
                    "source": "prospect.businessName",
                    "position": "right",
                    "style": { "font": "display", "size": 10, "weight": "bold", "color": "primary" }
                }
            ]
        },
        {
            "sectionId": "decisionMaker",
            "sectionName": "Decision Maker Line",
            "order": 2,
            "required": false,
            "condition": "prospect.decisionMaker.name !== null",
            "layout": "single_line",
            "fields": [
                {
                    "fieldId": "contactNames",
                    "type": "text",
                    "template": "{{prospect.decisionMaker.name}}",
                    "style": { "font": "body", "size": 9, "color": "muted" }
                }
            ]
        },
        {
            "sectionId": "auditSummary",
            "sectionName": "Review Audit Summary",
            "order": 3,
            "required": true,
            "layout": "callout_box",
            "description": "Teal-bordered box with a 2-3 sentence executive summary. Must include: current rating, review count, the core problem pattern, and a time-sensitive hook.",
            "fields": [
                {
                    "fieldId": "summaryIcon",
                    "type": "icon",
                    "value": "alert_circle",
                    "position": "left"
                },
                {
                    "fieldId": "summaryLabel",
                    "type": "text",
                    "value": "Review Audit",
                    "style": { "font": "body", "size": 8, "weight": "bold", "color": "primary" }
                },
                {
                    "fieldId": "summaryDate",
                    "type": "text",
                    "template": "{{currentMonth}} {{currentYear}}",
                    "style": { "font": "body", "size": 8, "color": "muted" }
                },
                {
                    "fieldId": "summaryBody",
                    "type": "ai_generated",
                    "promptTemplate": "Write a 2-3 sentence review audit summary for {{prospect.businessName}}. Include: {{prospect.rating}} stars, {{prospect.reviewCount}} reviews. The core problem pattern is: {{analysis.topComplaintPattern}}. End with a time-sensitive urgency hook relevant to their business context. Maximum 50 words. No generic phrases.",
                    "style": { "font": "body", "size": 9, "color": "dark" }
                }
            ]
        },
        {
            "sectionId": "headline",
            "sectionName": "Headline Block",
            "order": 4,
            "required": true,
            "layout": "two_line_headline",
            "description": "Two-line headline. Line 1 is the identity/strength. Line 2 is the problem/blind spot. Pattern: '[What they are known for]. [What is breaking].'",
            "fields": [
                {
                    "fieldId": "headlineLine1",
                    "type": "ai_generated",
                    "promptTemplate": "Write a bold identity statement for {{prospect.businessName}} in {{prospect.city}}. What are they known for? Use their own customers' words from reviews. Maximum 8 words. Example: 'Atlanta's #1 Soccer Bar.'",
                    "style": { "font": "display", "size": 22, "weight": "bold", "color": "dark" }
                },
                {
                    "fieldId": "headlineLine2",
                    "type": "ai_generated",
                    "promptTemplate": "Write a 4-6 word problem statement that names the blind spot revealed by their reviews. Pattern: '[Category] Is the Blind Spot.' Example: 'Service Is the Blind Spot.'",
                    "style": { "font": "display", "size": 22, "weight": "bold", "color": "accent" }
                }
            ]
        },
        {
            "sectionId": "narrativeParagraph",
            "sectionName": "Narrative Context Paragraph",
            "order": 5,
            "required": true,
            "layout": "prose_block",
            "description": "4-6 sentence paragraph that tells the story: what the business does well, what the review data reveals as the problem pattern, and why NOW is the moment to fix it.",
            "fields": [
                {
                    "fieldId": "narrativeBody",
                    "type": "ai_generated",
                    "promptTemplate": "Write a 4-6 sentence narrative paragraph for {{prospect.businessName}}. Structure: (1) What they are celebrated for by customers. (2) What the last 6 months of reviews reveal as the recurring problem. (3) A specific urgency hook tied to their business context. Use specific review quotes or paraphrases. Write in second person. No bullet points. Maximum 80 words.",
                    "style": { "font": "body", "size": 9, "lineHeight": 1.4, "color": "dark" }
                }
            ]
        },
        {
            "sectionId": "statCards",
            "sectionName": "Key Metrics Strip",
            "order": 6,
            "required": true,
            "layout": "horizontal_cards",
            "cardCount": 4,
            "description": "Four stat cards in a row.",
            "fields": [
                {
                    "fieldId": "stat1",
                    "type": "stat_card",
                    "numberSource": "prospect.rating",
                    "numberFormat": "{{value}} star",
                    "label": "GOOGLE RATING",
                    "sublabel": "{{prospect.reviewCount}} reviews",
                    "style": { "numberColor": "dark", "numberSize": 24, "labelColor": "muted" }
                },
                {
                    "fieldId": "stat2",
                    "type": "stat_card",
                    "numberSource": "prospect.reviewCount",
                    "numberFormat": "{{value}}",
                    "label": "TOTAL REVIEWS",
                    "sublabelSource": "analysis.reviewVolumeAssessment",
                    "style": { "numberColor": "dark", "numberSize": 24, "labelColor": "muted" }
                },
                {
                    "fieldId": "stat3",
                    "type": "stat_card",
                    "numberSource": "analysis.complaintFrequency",
                    "numberFormat": "~{{value}}/mo",
                    "label": "{{analysis.topComplaintCategory | uppercase}} COMPLAINTS",
                    "sublabel": "",
                    "style": { "numberColor": "alertRed", "numberSize": 24, "labelColor": "muted" }
                },
                {
                    "fieldId": "stat4",
                    "type": "stat_card",
                    "numberSource": "prospect.ownerResponseCount",
                    "numberFormat": "{{value}}",
                    "label": "OWNER RESPONSES TO NEGATIVES",
                    "sublabel": "",
                    "style": { "numberColor": "alertRed", "numberSize": 24, "labelColor": "muted" }
                }
            ]
        },
        {
            "sectionId": "complaintPatterns",
            "sectionName": "Top Complaint Patterns",
            "order": 7,
            "required": true,
            "layout": "numbered_pattern_list",
            "maxItems": 3,
            "fields": [
                {
                    "fieldId": "sectionTitle",
                    "type": "text",
                    "value": "TOP COMPLAINT PATTERNS",
                    "style": { "font": "display", "size": 10, "weight": "bold", "color": "dark" }
                },
                {
                    "fieldId": "patterns",
                    "type": "ai_generated_list",
                    "promptTemplate": "Analyze the reviews for {{prospect.businessName}} and identify the top 3 complaint patterns. For each pattern, provide: (1) count of reviews mentioning it as 'X+', (2) category label in caps (e.g., 'SLOW SERVICE / IGNORED'), (3) exactly 3 short verbatim snippets from actual reviews, each under 12 words, in quotes. Return as structured JSON array.",
                    "itemLayout": {
                        "count": { "style": { "color": "alertRed", "weight": "bold" } },
                        "category": { "style": { "font": "body", "weight": "bold", "size": 9 } },
                        "snippets": { "style": { "font": "body", "size": 8, "color": "muted", "italic": true } }
                    }
                }
            ]
        },
        {
            "sectionId": "customerLove",
            "sectionName": "What Customers Love",
            "order": 8,
            "required": true,
            "layout": "bullet_list_with_header",
            "maxItems": 4,
            "fields": [
                {
                    "fieldId": "sectionTitle",
                    "type": "text",
                    "template": "WHAT CUSTOMERS LOVE -- PROTECT THIS",
                    "style": { "font": "display", "size": 10, "weight": "bold", "color": "successGreen" }
                },
                {
                    "fieldId": "lovePoints",
                    "type": "ai_generated_list",
                    "promptTemplate": "From positive reviews of {{prospect.businessName}}, identify 4 specific things customers love. For each: a bold category label, then a supporting detail with a short review quote. If individual staff members are praised by name, include one bullet listing those names. Maximum 20 words per bullet. Return as JSON array of {label, detail} objects.",
                    "itemLayout": {
                        "label": { "style": { "weight": "bold", "color": "dark" } },
                        "detail": { "style": { "color": "muted", "italic": true } }
                    }
                }
            ]
        },
        {
            "sectionId": "solution",
            "sectionName": "PathSynch Solution Block",
            "order": 9,
            "required": true,
            "layout": "solution_card",
            "description": "Dark background section with PathSynch solution.",
            "fields": [
                {
                    "fieldId": "solutionTitle",
                    "type": "text",
                    "value": "THE PATHSYNCH SOLUTION",
                    "style": { "font": "display", "size": 10, "weight": "bold", "color": "white" }
                },
                {
                    "fieldId": "solutionSubtitle",
                    "type": "ai_generated",
                    "promptTemplate": "Write a 4-8 word subtitle for the solution section. Pattern: '[Number] Tools. One Dashboard. [Prospect-specific detail].' Example: 'Six Tools. One Dashboard. Both Locations.'",
                    "style": { "font": "display", "size": 14, "color": "white" }
                },
                {
                    "fieldId": "outcomeMetrics",
                    "type": "metric_cards",
                    "cardCount": 4,
                    "metricsSource": "analysis.projectedOutcomes",
                    "description": "4 projected outcome metrics.",
                    "style": { "cardBg": "rgba(255,255,255,0.1)", "numberColor": "accent", "labelColor": "white" }
                },
                {
                    "fieldId": "productList",
                    "type": "product_line_items",
                    "source": "pitch.recommendedProducts",
                    "description": "List of PathSynch products with brief description."
                },
                {
                    "fieldId": "pricingPackage",
                    "type": "pricing_block",
                    "layout": "package_card",
                    "fields": {
                        "packageName": "{{prospect.businessName}} Package",
                        "lineItems": "pitch.pricingLineItems",
                        "setupFee": "pitch.setupFee",
                        "monthlyTotal": "pitch.monthlyTotal",
                        "highlight": "pitch.pricingHighlight"
                    },
                    "style": { "bg": "primary", "textColor": "white", "priceSize": 28 }
                }
            ]
        },
        {
            "sectionId": "urgencyBadge",
            "sectionName": "Urgency Badge",
            "order": 10,
            "required": false,
            "condition": "analysis.urgencyHook !== null",
            "layout": "badge_pill",
            "fields": [
                {
                    "fieldId": "urgencyLabel",
                    "type": "ai_generated",
                    "promptTemplate": "Generate a 3-5 word urgency badge label for {{prospect.businessName}} based on their business context. Must reference a specific upcoming event, season, or business milestone. All caps. Examples: 'FIFA WORLD CUP READY', 'HOLIDAY SEASON PREP', 'GRAND OPENING READY'.",
                    "style": { "bg": "accent", "color": "dark", "weight": "bold", "size": 8 }
                },
                {
                    "fieldId": "urgencyDetail",
                    "type": "ai_generated",
                    "promptTemplate": "Write a 1-sentence detail for the urgency badge. Connect the prospect's situation to the time-sensitive opportunity. Maximum 25 words.",
                    "style": { "font": "body", "size": 8, "color": "muted" }
                }
            ]
        },
        {
            "sectionId": "closingCTA",
            "sectionName": "Closing CTA",
            "order": 11,
            "required": true,
            "layout": "cta_line",
            "fields": [
                {
                    "fieldId": "ctaLine",
                    "type": "ai_generated",
                    "promptTemplate": "Write a single closing line for {{prospect.businessName}} pitch. Pattern: 'Let's turn [their asset] into [outcome] -- [scope].' Maximum 20 words. Example: 'Let's turn 1,132 reviews into your strongest asset -- across both locations.'",
                    "style": { "font": "body", "size": 9, "italic": true, "color": "dark" }
                }
            ]
        },
        {
            "sectionId": "footer",
            "sectionName": "Footer",
            "order": 12,
            "required": true,
            "layout": "footer_bar",
            "fields": [
                {
                    "fieldId": "meetingCTA",
                    "type": "text",
                    "value": "15-minute walkthrough",
                    "style": { "font": "body", "size": 7, "color": "muted" }
                },
                {
                    "fieldId": "contactEmail",
                    "type": "text",
                    "source": "sellerProfile.email",
                    "fallback": "hello@pathsynch.com"
                },
                {
                    "fieldId": "websites",
                    "type": "text",
                    "value": "pathsynch.com | synchintro.ai | referralsynch.com"
                },
                {
                    "fieldId": "sellerInfo",
                    "type": "text",
                    "template": "{{sellerProfile.name}} | {{sellerProfile.title}}, {{sellerProfile.company}} | {{sellerProfile.address}}",
                    "style": { "font": "body", "size": 7, "color": "muted" }
                }
            ]
        }
    ],
    "dataRequirements": {
        "required": [
            "prospect.businessName",
            "prospect.city",
            "prospect.state",
            "prospect.rating",
            "prospect.reviewCount"
        ],
        "enrichmentSources": [
            {
                "source": "googlePlaces",
                "provides": ["prospect.rating", "prospect.reviewCount", "prospect.website", "prospect.address"],
                "creditCost": 0
            },
            {
                "source": "dataForSEO_reviews",
                "provides": ["analysis.reviewSnippets", "analysis.complaintPatterns", "analysis.positivePatterns", "prospect.ownerResponseCount"],
                "creditCost": 85
            },
            {
                "source": "serper_owner",
                "provides": ["prospect.decisionMaker.name", "prospect.decisionMaker.title"],
                "creditCost": 5
            },
            {
                "source": "gemini_analysis",
                "provides": ["analysis.topComplaintPattern", "analysis.urgencyHook", "analysis.projectedOutcomes"],
                "creditCost": 0,
                "note": "Uses data already in memory from other enrichment calls"
            }
        ],
        "totalCreditCost": {
            "minimum": 85,
            "withOwnerEnrichment": 90,
            "description": "85cr for review analysis card + 5cr for owner enrichment. Gemini generation uses data already fetched."
        }
    },
    "generationRules": {
        "tone": "Direct, data-driven, respectful. You are showing them their own data, not lecturing them. Lead with what they do well before showing the gap.",
        "perspective": "Written FOR a salesperson TO hand to a business owner. The owner should feel understood, not attacked.",
        "constraints": [
            "Never use generic phrases like 'high level of customer satisfaction' or 'room for improvement'",
            "Always include at least 3 verbatim review snippets as evidence",
            "Always include a 'What Customers Love' section before showing problems",
            "Pricing must be specific to the prospect, not generic tier pricing",
            "Urgency hook must reference something real and time-specific to the business",
            "No em dashes in any generated text",
            "Maximum 1 page, no exceptions"
        ]
    }
};

async function seedPitchTemplates() {
    const docId = 'review-audit-onepager-v1';
    const ref = db.collection('pitchTemplates').doc(docId);

    const payload = {
        ...template,
        // Firestore metadata
        isDefault: true,
        isSystemDefault: true,
        industry: 'all',
        createdBy: 'system',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await ref.set(payload, { merge: false });
    console.log(`[seedPitchTemplates] Uploaded pitchTemplates/${docId}`);
    console.log(`  templateType: ${template.templateType}`);
    console.log(`  industry: all`);
    console.log(`  isDefault: true`);
    console.log(`  isSystemDefault: true`);
    console.log(`  sections: ${template.sections.length}`);
}

seedPitchTemplates()
    .then(() => {
        console.log('[seedPitchTemplates] Done.');
        process.exit(0);
    })
    .catch(err => {
        console.error('[seedPitchTemplates] FAILED:', err);
        process.exit(1);
    });
