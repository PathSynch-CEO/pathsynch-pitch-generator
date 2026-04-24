/**
 * Brewhouse Response Schema
 *
 * Vertex AI / Gemini responseSchema for the Executive Brief (and related one-pager styles)
 * that use the "review audit" template structure.
 *
 * Field names are chosen to match the template section field IDs so the output from
 * generateStructured() can be passed directly as aiResults to resolveAllSections()
 * without renaming.
 *
 * Exception: the schema uses 'complaintPatterns' (descriptive) which is mapped back
 * to 'patterns' (the template field ID) in templatePromptBuilder.buildAndExecuteTemplatePrompt().
 *
 * Schema shape:
 * {
 *   summaryBody:       string   — 2-3 sentences, the key audit finding for the alert box
 *   headlineLine1:     string   — Specific to what this business's customers celebrate
 *   headlineLine2:     string   — The blind spot / gap the data reveals (amber accent line)
 *   narrativeBody:     string   — 4-6 sentences quoting actual reviews
 *   complaintPatterns: Array<{ count, category, snippets[3] }> — min 3 patterns
 *   lovePoints:        Array<{ label, detail }> — min 4 love points with review quotes
 *   solutionSubtitle:  string?  — Optional subtitle for the solution block
 *   urgencyLabel:      string?  — Optional: e.g. "SUMMER RUSH"
 *   urgencyDetail:     string?  — Optional: 1 sentence time-sensitive hook
 *   ctaLine:           string   — Specific closing call-to-action referencing review count
 * }
 *
 * Required: summaryBody, headlineLine1, headlineLine2, narrativeBody,
 *           complaintPatterns, lovePoints, ctaLine
 */

'use strict';

const brewhouseResponseSchema = {
    type: 'object',
    properties: {

        summaryBody: {
            type: 'string',
            description: 'The key audit finding shown in the red alert box. 2-3 sentences. Start with the specific complaint pattern data, then connect it to lost revenue or customer trust. Do NOT use generic phrases. Reference the actual rating and review count.'
        },

        headlineLine1: {
            type: 'string',
            description: 'The first headline line (dark text). Must be specific to what this business\'s customers actually celebrate in 5-star reviews. Never use generic phrases like "Trusted Local Business" or "Quality Service Delivered." Quote a specific theme from positive reviews.'
        },

        headlineLine2: {
            type: 'string',
            description: 'The second headline line (amber accent text). Shows the gap or blind spot — the contrast between what customers love and what is quietly driving 1-3 star reviews. Example: "But Silent Complaints Are Costing You Tables."'
        },

        narrativeBody: {
            type: 'string',
            description: '4-6 sentences that walk the owner through the reputation story. Lead with the positive ("Customers consistently praise X"), then pivot to the gap ("Yet our analysis found Y"), then close with the stakes ("Every unanswered complaint costs Z"). Quote actual review phrases verbatim in quotation marks. No em dashes. No generic phrases.'
        },

        complaintPatterns: {
            type: 'array',
            description: 'The top 3 complaint pattern clusters from negative reviews. Each must have exactly 3 verbatim review snippets (under 12 words each). Counts should reflect distinct reviews, not keyword occurrences. For a 4.0-4.5 star business, realistic counts are 3-15 per pattern.',
            items: {
                type: 'object',
                properties: {
                    count: {
                        type: 'string',
                        description: 'Estimated number of reviews with this complaint pattern. Format: "6+" or "4+". Count distinct reviews, not keyword mentions.'
                    },
                    category: {
                        type: 'string',
                        description: 'Category name in ALL CAPS, 2-4 words. Example: "SLOW SERVICE / IGNORED", "WAIT TIMES / SLOW KITCHEN", "RUDE STAFF / ATTITUDE".'
                    },
                    snippets: {
                        type: 'array',
                        description: 'Exactly 3 verbatim review quotes, each under 12 words. Pull from the actual negative review samples provided.',
                        items: { type: 'string' }
                    }
                },
                required: ['count', 'category', 'snippets']
            }
        },

        lovePoints: {
            type: 'array',
            description: 'Minimum 4 items. What customers specifically praise in 5-star reviews. Each item needs a label (category) and a detail that includes a verbatim quote or specific observation from the positive review samples.',
            items: {
                type: 'object',
                properties: {
                    label: {
                        type: 'string',
                        description: 'Category label in Title Case. 2-4 words. Example: "Personalized Care", "Same-Day Availability", "Gentle Touch".'
                    },
                    detail: {
                        type: 'string',
                        description: 'One sentence that includes a specific quote or observation from a positive review. Example: "Multiple reviewers call out Dr. Smith by name for \'making me feel at ease\'."'
                    }
                },
                required: ['label', 'detail']
            }
        },

        solutionSubtitle: {
            type: 'string',
            description: 'Optional. Subtitle for the solution section. 5-10 words describing what changes in 90 days. Example: "Protect What\'s Working, Fix What\'s Quietly Hurting You."'
        },

        urgencyLabel: {
            type: 'string',
            description: 'Optional. Short urgency label for the badge. 1-3 words in caps. Example: "SUMMER RUSH", "HOLIDAY SEASON", "NEW COMPETITOR".'
        },

        urgencyDetail: {
            type: 'string',
            description: 'Optional. 1 sentence time-sensitive hook. Reference a real seasonal peak, local event, or competitive signal for this business and city. Example: "Summer foot traffic peaks in June — every unanswered complaint now costs you a booking."'
        },

        ctaLine: {
            type: 'string',
            description: 'Closing call-to-action. Reference the actual review count. Personal, direct, specific. Example: "With 127 reviews on record, your next 30 days are the most important window to protect this rating — let\'s talk."'
        },

        solutionPackage: {
            type: 'object',
            description: 'The recommended product package for this prospect. Select 2-3 products from the seller\'s available products that best address the complaint patterns. Calculate the correct monthlyTotal by summing ONLY the selected products\' monthly prices.',
            properties: {
                packageName: {
                    type: 'string',
                    description: 'e.g. "Brewhouse Package" or "{BusinessName} Package"'
                },
                products: {
                    type: 'array',
                    description: 'Selected products with pricing. Format each as "Product Name $X/mo" or "Product Name — included". Only list products with actual prices or explicitly included.',
                    items: { type: 'string' }
                },
                setupFee: {
                    type: 'string',
                    description: 'e.g. "$299 one-time setup" or "$0 setup" if no setup fee. Sum any setup fees from selected products.'
                },
                monthlyTotal: {
                    type: 'string',
                    description: 'e.g. "$149/mo" — the sum of ONLY the selected products\' monthly prices. Products listed as "included" count as $0. Format: "$X/mo".'
                }
            },
            required: ['packageName', 'products', 'setupFee', 'monthlyTotal']
        }

    },
    required: [
        'summaryBody',
        'headlineLine1',
        'headlineLine2',
        'narrativeBody',
        'complaintPatterns',
        'lovePoints',
        'ctaLine',
        'solutionPackage'
    ]
};

module.exports = { brewhouseResponseSchema };
