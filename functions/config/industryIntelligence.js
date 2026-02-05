/**
 * Industry Intelligence Configuration
 *
 * Sales intelligence data organized by industry/sub-industry:
 * - Decision maker titles
 * - Key pain points
 * - Primary KPIs
 * - Top marketing channels
 *
 * Sources: Sales experience, ICP research, industry reference material,
 * discovery calls, win/loss reviews, customer reporting dashboards
 */

const INDUSTRY_INTELLIGENCE = {
    // ============================================
    // FOOD & BEVERAGE
    // ============================================
    'Food & Beverage': {
        default: {
            decisionMakers: ['Owner', 'General Manager', 'Marketing Manager'],
            painPoints: [
                'Inconsistent foot traffic and seasonal fluctuations',
                'Difficulty standing out in competitive local market',
                'Managing online reputation across review platforms',
                'High customer acquisition costs'
            ],
            primaryKPIs: ['Daily covers/transactions', 'Average ticket size', 'Google rating', 'Table turnover rate'],
            topChannels: ['Google Business Profile', 'Instagram', 'Yelp', 'Local SEO', 'Food delivery apps'],
            prospecting: {
                bestMonths: [1, 2],
                bestMonthsLabel: 'January-February',
                reasoning: 'Restaurants set annual budgets in January after holiday revenue peaks',
                worstMonths: [11, 12],
                worstReason: 'Too busy during holiday rush to take meetings',
                buyerMindset: 'Post-holiday budget planning, looking for operational improvements',
                approachTip: 'Lead with cost savings from holiday season data'
            },
            calendar: {
                buyingCycle: 'Annual (January budget setting)',
                contractRenewal: 'Q4 (October-December)',
                keyEvents: [
                    { name: 'National Restaurant Association Show', month: 5, type: 'trade_show' },
                    { name: 'Holiday season prep', month: 9, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '2-4 weeks from first meeting'
            }
        },
        'Full Service Restaurant': {
            decisionMakers: ['Owner', 'General Manager', 'Marketing Director'],
            painPoints: [
                'Inconsistent reservations and walk-in traffic',
                'Managing online reputation across multiple platforms',
                'Competing with delivery apps and ghost kitchens',
                'Staff retention and training costs'
            ],
            primaryKPIs: ['Daily covers', 'Average check size', 'Table turnover', 'Google/Yelp rating', 'Repeat customer rate'],
            topChannels: ['Google Business Profile', 'OpenTable/Resy', 'Instagram', 'Yelp', 'Local food blogs'],
            prospecting: {
                bestMonths: [1, 2],
                bestMonthsLabel: 'January-February',
                reasoning: 'Post-holiday lull gives owners time to evaluate vendors and plan the year',
                worstMonths: [11, 12],
                worstReason: 'Holiday private events and peak dining season consume all attention',
                buyerMindset: 'Reflecting on holiday performance, open to tools that boost slow months',
                approachTip: 'Reference their holiday season review volume and suggest capturing more year-round'
            },
            calendar: {
                buyingCycle: 'Annual (January budget setting)',
                contractRenewal: 'Q4 (October-December)',
                keyEvents: [
                    { name: 'National Restaurant Association Show', month: 5, type: 'trade_show' },
                    { name: 'Holiday menu/event planning', month: 9, type: 'buying_cycle' },
                    { name: 'Restaurant Week (varies by city)', month: 1, type: 'industry_event' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '2-4 weeks from first meeting'
            }
        },
        'Fast Casual': {
            decisionMakers: ['Owner/Franchisee', 'District Manager', 'Marketing Manager'],
            painPoints: [
                'High competition from chains and delivery',
                'Speed of service vs. quality balance',
                'Labor costs and scheduling efficiency',
                'Mobile ordering adoption'
            ],
            primaryKPIs: ['Transactions per hour', 'Average ticket', 'Speed of service', 'Online order percentage'],
            topChannels: ['Google Business Profile', 'Delivery apps (DoorDash, UberEats)', 'Social media', 'Loyalty apps'],
            prospecting: {
                bestMonths: [1, 2, 3],
                bestMonthsLabel: 'January-March',
                reasoning: 'New year planning and franchisee budget cycles align with Q1',
                worstMonths: [6, 7],
                worstReason: 'Summer staffing challenges and peak lunch traffic dominate focus',
                buyerMindset: 'Looking for efficiency gains and digital ordering solutions',
                approachTip: 'Emphasize mobile ordering and loyalty program ROI data'
            },
            calendar: {
                buyingCycle: 'Quarterly (franchise review cycles)',
                contractRenewal: 'Q4 (October-December)',
                keyEvents: [
                    { name: 'National Restaurant Association Show', month: 5, type: 'trade_show' },
                    { name: 'Franchise planning cycle', month: 10, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '2-3 weeks from first meeting'
            }
        },
        'Coffee & Cafe': {
            decisionMakers: ['Owner', 'Manager', 'Marketing Lead'],
            painPoints: [
                'Morning rush capacity constraints',
                'Competing with chains like Starbucks',
                'Building consistent afternoon traffic',
                'Differentiating product offerings'
            ],
            primaryKPIs: ['Transactions per day', 'Average ticket', 'Loyalty program usage', 'Peak hour efficiency'],
            topChannels: ['Instagram', 'Google Business Profile', 'Mobile ordering', 'Local partnerships'],
            prospecting: {
                bestMonths: [1, 2, 9],
                bestMonthsLabel: 'January-February, September',
                reasoning: 'Post-holiday reset and back-to-school bring new routine-building customers',
                worstMonths: [6, 7],
                worstReason: 'Summer slowdown as routines break; iced coffee demand masks lower traffic',
                buyerMindset: 'Focused on loyalty programs and afternoon traffic strategies',
                approachTip: 'Show how review management and loyalty drive repeat morning visits'
            },
            calendar: {
                buyingCycle: 'Semi-annual (January and July reviews)',
                contractRenewal: 'Q4 (November-December)',
                keyEvents: [
                    { name: 'Specialty Coffee Expo', month: 4, type: 'trade_show' },
                    { name: 'Fall seasonal menu launch', month: 9, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [11, 12],
                decisionTimeline: '1-2 weeks from first meeting'
            }
        },
        'Bar & Nightlife': {
            decisionMakers: ['Owner', 'General Manager', 'Events Coordinator'],
            painPoints: [
                'Inconsistent weekday traffic',
                'Event planning and promotion',
                'Managing reviews and reputation',
                'Competing for the weekend crowd'
            ],
            primaryKPIs: ['Covers per night', 'Revenue per customer', 'Event attendance', 'Social media engagement'],
            topChannels: ['Instagram', 'Facebook Events', 'Google Business Profile', 'Local event listings', 'Influencer partnerships'],
            prospecting: {
                bestMonths: [1, 2, 9],
                bestMonthsLabel: 'January-February, September',
                reasoning: 'Post-holiday and post-summer lulls create urgency for new traffic strategies',
                worstMonths: [12],
                worstReason: 'Holiday party season and NYE planning consume all bandwidth',
                buyerMindset: 'Looking for ways to fill weeknight events and build social following',
                approachTip: 'Lead with event promotion and social media engagement case studies'
            },
            calendar: {
                buyingCycle: 'Semi-annual (January and August)',
                contractRenewal: 'Q4 (October-November)',
                keyEvents: [
                    { name: 'Nightclub & Bar Show', month: 3, type: 'trade_show' },
                    { name: 'Holiday party season kickoff', month: 10, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [10, 11],
                decisionTimeline: '1-3 weeks from first meeting'
            }
        }
    },

    // ============================================
    // HOME SERVICES
    // ============================================
    'Home Services': {
        default: {
            decisionMakers: ['Owner', 'Operations Manager', 'Office Manager'],
            painPoints: [
                'Inconsistent lead flow and seasonality',
                'High cost per lead from paid channels',
                'Managing online reputation and reviews',
                'Scheduling efficiency and route optimization'
            ],
            primaryKPIs: ['Leads per month', 'Booking rate', 'Average job value', 'Google rating', 'Customer lifetime value'],
            topChannels: ['Google Local Services Ads', 'Google Business Profile', 'HomeAdvisor/Angi', 'Referrals', 'Facebook'],
            prospecting: {
                bestMonths: [1, 2, 3],
                bestMonthsLabel: 'January-March',
                reasoning: 'Pre-season planning before spring rush; owners booking marketing for busy months',
                worstMonths: [6, 7, 8],
                worstReason: 'Peak service season leaves no time for vendor meetings',
                buyerMindset: 'Preparing for busy season, investing in lead generation',
                approachTip: 'Show how better reviews during busy season pay off year-round'
            },
            calendar: {
                buyingCycle: 'Annual (Q1 pre-season)',
                contractRenewal: 'Q4 (November-December)',
                keyEvents: [
                    { name: 'International Builders Show', month: 2, type: 'trade_show' },
                    { name: 'Spring marketing ramp-up', month: 3, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [11, 12, 1],
                decisionTimeline: '1-3 weeks from first meeting'
            }
        },
        'Roofing': {
            decisionMakers: ['Owner', 'Sales Manager', 'Operations Manager'],
            painPoints: [
                'High cost per lead ($150-400)',
                'Long sales cycles and multiple touchpoints',
                'Storm/weather dependency for demand',
                'Competition from national brands and storm chasers',
                'Insurance claim complexity'
            ],
            primaryKPIs: ['Leads per month', 'Close rate', 'Average job value ($8K-15K)', 'Cost per acquisition', 'Google reviews'],
            topChannels: ['Google Local Services Ads', 'Google Business Profile', 'HomeAdvisor', 'Door-to-door (storm)', 'Referrals', 'Facebook'],
            prospecting: {
                bestMonths: [1, 2, 3],
                bestMonthsLabel: 'January-March',
                reasoning: 'Pre-storm season planning; owners investing in lead gen before spring demand',
                worstMonths: [5, 6, 7],
                worstReason: 'Storm season and peak installation keeps crews and owners fully booked',
                buyerMindset: 'Looking to lock in marketing spend before busy season hits',
                approachTip: 'Lead with cost-per-lead reduction and review generation for trust building'
            },
            calendar: {
                buyingCycle: 'Annual (Q1 pre-season)',
                contractRenewal: 'Q4 (October-December)',
                keyEvents: [
                    { name: 'International Roofing Expo', month: 2, type: 'trade_show' },
                    { name: 'Storm season prep', month: 3, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [11, 12, 1],
                decisionTimeline: '2-4 weeks from first meeting'
            }
        },
        'Residential Roofing': {
            decisionMakers: ['Owner', 'Sales Manager', 'Estimator'],
            painPoints: [
                'Seasonal demand fluctuations',
                'Competing on price vs. quality',
                'Building trust with homeowners',
                'Managing subcontractor quality'
            ],
            primaryKPIs: ['Estimates given', 'Close rate', 'Average ticket', 'Referral rate', 'Review score'],
            topChannels: ['Google Business Profile', 'Nextdoor', 'HomeAdvisor', 'Referral programs', 'Local SEO'],
            prospecting: {
                bestMonths: [1, 2, 3],
                bestMonthsLabel: 'January-March',
                reasoning: 'Pre-season budget planning before spring estimates ramp up',
                worstMonths: [5, 6, 7],
                worstReason: 'Peak installation season; crews and sales teams fully deployed',
                buyerMindset: 'Investing in lead quality and trust-building tools before busy season',
                approachTip: 'Highlight how strong reviews reduce price objections from homeowners'
            },
            calendar: {
                buyingCycle: 'Annual (Q1 pre-season)',
                contractRenewal: 'Q4 (November-December)',
                keyEvents: [
                    { name: 'International Roofing Expo', month: 2, type: 'trade_show' },
                    { name: 'Spring estimate season begins', month: 4, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [11, 12, 1],
                decisionTimeline: '2-3 weeks from first meeting'
            }
        },
        'Commercial Roofing': {
            decisionMakers: ['Owner', 'Business Development Manager', 'Project Manager'],
            painPoints: [
                'Long bid-to-close cycles (3-12 months)',
                'Relationship-driven sales process',
                'Bonding and insurance requirements',
                'Competing against large national contractors'
            ],
            primaryKPIs: ['Bid volume', 'Win rate', 'Average contract value', 'Project margin', 'Repeat client rate'],
            topChannels: ['Industry relationships', 'LinkedIn', 'Trade associations', 'Commercial property databases', 'Referrals'],
            prospecting: {
                bestMonths: [1, 2, 10],
                bestMonthsLabel: 'January-February, October',
                reasoning: 'Q1 planning and Q4 budget allocation for property managers',
                worstMonths: [6, 7, 8],
                worstReason: 'Peak construction season with full project backlogs',
                buyerMindset: 'Focused on bid pipeline and relationship development tools',
                approachTip: 'Emphasize credibility and online presence for winning bids against nationals'
            },
            calendar: {
                buyingCycle: 'Annual (aligned with construction calendar)',
                contractRenewal: 'Q4 (October-December)',
                keyEvents: [
                    { name: 'International Roofing Expo', month: 2, type: 'trade_show' },
                    { name: 'Property manager budget planning', month: 10, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '4-8 weeks from first meeting'
            }
        },
        'Plumbing & HVAC': {
            decisionMakers: ['Owner', 'Service Manager', 'Dispatcher'],
            painPoints: [
                'Emergency call unpredictability',
                'Seasonal demand (HVAC especially)',
                'Technician recruitment and retention',
                'Upselling maintenance plans'
            ],
            primaryKPIs: ['Calls per day', 'Average ticket', 'Membership plan conversions', 'Technician utilization', 'Response time'],
            topChannels: ['Google Local Services Ads', 'Google Business Profile', 'Direct mail', 'Radio/TV', 'Service Titan leads'],
            prospecting: {
                bestMonths: [3, 4, 9, 10],
                bestMonthsLabel: 'March-April, September-October',
                reasoning: 'Shoulder seasons between heating/cooling peaks allow planning time',
                worstMonths: [1, 7],
                worstReason: 'Peak heating (Jan) and cooling (Jul) emergencies dominate all resources',
                buyerMindset: 'Looking to build maintenance plan base and improve review capture',
                approachTip: 'Show how review velocity during peak seasons drives year-round leads'
            },
            calendar: {
                buyingCycle: 'Semi-annual (spring and fall shoulder seasons)',
                contractRenewal: 'Varies (often annual from sign date)',
                keyEvents: [
                    { name: 'AHR Expo', month: 1, type: 'trade_show' },
                    { name: 'Spring AC tune-up season', month: 4, type: 'buying_cycle' },
                    { name: 'Fall heating prep season', month: 9, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [11, 12],
                decisionTimeline: '1-3 weeks from first meeting'
            }
        },
        'Electrical': {
            decisionMakers: ['Owner', 'Operations Manager', 'Lead Electrician'],
            painPoints: [
                'Mix of emergency vs. planned work',
                'Commercial vs. residential balance',
                'Permit and inspection delays',
                'Competing with handymen on small jobs'
            ],
            primaryKPIs: ['Jobs per week', 'Average job value', 'Commercial/residential mix', 'Google rating'],
            topChannels: ['Google Business Profile', 'Contractor referrals', 'Home builder relationships', 'Angi/HomeAdvisor'],
            prospecting: {
                bestMonths: [1, 2, 3],
                bestMonthsLabel: 'January-March',
                reasoning: 'Pre-construction season planning; new home builds ramp up in spring',
                worstMonths: [6, 7],
                worstReason: 'Peak construction and renovation season keeps all hands busy',
                buyerMindset: 'Planning marketing for upcoming construction season',
                approachTip: 'Highlight how reviews differentiate from unlicensed handymen'
            },
            calendar: {
                buyingCycle: 'Annual (Q1 planning)',
                contractRenewal: 'Q4 (November-December)',
                keyEvents: [
                    { name: 'International Builders Show', month: 2, type: 'trade_show' },
                    { name: 'Construction season kickoff', month: 4, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [11, 12, 1],
                decisionTimeline: '1-3 weeks from first meeting'
            }
        },
        'Landscaping': {
            decisionMakers: ['Owner', 'Operations Manager', 'Sales/Estimator'],
            painPoints: [
                'Extreme seasonality (spring peak)',
                'Crew management and retention',
                'Upselling from maintenance to hardscape',
                'Weather-related scheduling challenges'
            ],
            primaryKPIs: ['Recurring revenue %', 'Crew utilization', 'Average contract value', 'Customer retention rate'],
            topChannels: ['Door hangers', 'Yard signs', 'Google Business Profile', 'Nextdoor', 'Referrals'],
            prospecting: {
                bestMonths: [1, 2, 11, 12],
                bestMonthsLabel: 'November-February',
                reasoning: 'Off-season gives owners time to plan and invest in marketing for spring',
                worstMonths: [4, 5, 6],
                worstReason: 'Spring rush is all-consuming with new contracts and seasonal startups',
                buyerMindset: 'Planning for next season, looking to lock in recurring contracts',
                approachTip: 'Show how winter marketing efforts fill the spring pipeline'
            },
            calendar: {
                buyingCycle: 'Annual (winter planning for spring)',
                contractRenewal: 'Q1 (January-March annual renewals)',
                keyEvents: [
                    { name: 'National Association of Landscape Professionals conference', month: 10, type: 'trade_show' },
                    { name: 'Spring contract signing season', month: 2, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [11, 12, 1],
                decisionTimeline: '2-4 weeks from first meeting'
            }
        },
        'General Contractor': {
            decisionMakers: ['Owner', 'Project Manager', 'Estimator'],
            painPoints: [
                'Long project timelines affecting cash flow',
                'Subcontractor coordination and quality',
                'Scope creep and change orders',
                'Material cost fluctuations'
            ],
            primaryKPIs: ['Backlog value', 'Project margins', 'Change order rate', 'Referral rate', 'On-time completion'],
            topChannels: ['Houzz', 'Referrals', 'Google Business Profile', 'Instagram (project photos)', 'Builder associations'],
            prospecting: {
                bestMonths: [1, 2, 10],
                bestMonthsLabel: 'January-February, October',
                reasoning: 'Q1 planning for new builds; October for next-year project pipeline',
                worstMonths: [5, 6, 7],
                worstReason: 'Peak construction season with multiple active projects',
                buyerMindset: 'Building backlog for next season, focused on referral generation',
                approachTip: 'Showcase portfolio visibility and review generation for high-ticket projects'
            },
            calendar: {
                buyingCycle: 'Annual (Q1 and Q4 planning)',
                contractRenewal: 'Varies by project cycle',
                keyEvents: [
                    { name: 'International Builders Show', month: 2, type: 'trade_show' },
                    { name: 'NAHB events', month: 6, type: 'trade_show' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '2-4 weeks from first meeting'
            }
        },
        'Painting': {
            decisionMakers: ['Owner', 'Estimator', 'Crew Lead'],
            painPoints: [
                'Low barriers to entry = high competition',
                'Weather-dependent scheduling',
                'Balancing residential vs. commercial',
                'Differentiating beyond price'
            ],
            primaryKPIs: ['Estimates per week', 'Close rate', 'Average job value', 'Crew productivity', 'Reviews'],
            topChannels: ['Google Business Profile', 'Nextdoor', 'HomeAdvisor', 'Realtor referrals', 'Yard signs'],
            prospecting: {
                bestMonths: [1, 2, 11, 12],
                bestMonthsLabel: 'November-February',
                reasoning: 'Off-season for exterior painting; owners planning spring campaigns',
                worstMonths: [5, 6, 7],
                worstReason: 'Peak painting season with full crew schedules',
                buyerMindset: 'Looking to differentiate and build referral pipeline for busy season',
                approachTip: 'Emphasize how reviews overcome low-barrier-to-entry competition'
            },
            calendar: {
                buyingCycle: 'Annual (winter planning)',
                contractRenewal: 'Q4 (November-December)',
                keyEvents: [
                    { name: 'Painting Contractors Association events', month: 3, type: 'trade_show' },
                    { name: 'Spring estimate season', month: 3, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [11, 12, 1],
                decisionTimeline: '1-2 weeks from first meeting'
            }
        },
        'Pest Control': {
            decisionMakers: ['Owner', 'Branch Manager', 'Sales Manager'],
            painPoints: [
                'Converting one-time to recurring customers',
                'Seasonal demand spikes (spring/summer)',
                'Route density for profitability',
                'Competition from national brands'
            ],
            primaryKPIs: ['Recurring customer count', 'Monthly recurring revenue', 'Stop density', 'Retention rate'],
            topChannels: ['Google Business Profile', 'Door-to-door', 'Direct mail', 'Google Ads', 'Referral programs'],
            prospecting: {
                bestMonths: [1, 2, 3],
                bestMonthsLabel: 'January-March',
                reasoning: 'Pre-bug season planning; owners ramping up sales teams for spring',
                worstMonths: [5, 6, 7],
                worstReason: 'Peak bug season means all focus on service delivery and door-to-door sales',
                buyerMindset: 'Building recurring customer base before seasonal demand hits',
                approachTip: 'Show how review generation converts one-time calls to recurring plans'
            },
            calendar: {
                buyingCycle: 'Annual (Q1 planning)',
                contractRenewal: 'Q4 (varies by contract anniversary)',
                keyEvents: [
                    { name: 'PestWorld conference', month: 10, type: 'trade_show' },
                    { name: 'Spring selling season launch', month: 3, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [11, 12, 1],
                decisionTimeline: '2-3 weeks from first meeting'
            }
        },
        'Cleaning Services': {
            decisionMakers: ['Owner', 'Operations Manager', 'Office Manager'],
            painPoints: [
                'High employee turnover',
                'Quality consistency across crews',
                'Converting one-time to recurring',
                'Competing on price'
            ],
            primaryKPIs: ['Recurring clients', 'Revenue per cleaner', 'Customer retention', 'Average job value'],
            topChannels: ['Google Business Profile', 'Nextdoor', 'Thumbtack', 'Facebook groups', 'Referrals'],
            prospecting: {
                bestMonths: [1, 8, 9],
                bestMonthsLabel: 'January, August-September',
                reasoning: 'New year deep-clean demand and back-to-school routine changes drive interest',
                worstMonths: [6, 7],
                worstReason: 'Summer vacations reduce demand; owners focused on staffing gaps',
                buyerMindset: 'Growing recurring base and reducing reliance on one-time bookings',
                approachTip: 'Focus on review-driven trust to justify premium pricing over competitors'
            },
            calendar: {
                buyingCycle: 'Quarterly (rolling new client acquisition)',
                contractRenewal: 'Annual from sign date',
                keyEvents: [
                    { name: 'ISSA Show', month: 11, type: 'trade_show' },
                    { name: 'Spring cleaning season', month: 3, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [11, 12],
                decisionTimeline: '1-2 weeks from first meeting'
            }
        }
    },

    // ============================================
    // HEALTH & WELLNESS
    // ============================================
    'Health & Wellness': {
        default: {
            decisionMakers: ['Owner/Practitioner', 'Practice Manager', 'Marketing Coordinator'],
            painPoints: [
                'Patient/member acquisition costs',
                'No-show rates and scheduling efficiency',
                'Insurance reimbursement complexity',
                'Building consistent referral pipeline'
            ],
            primaryKPIs: ['New patients/members per month', 'Retention rate', 'Average revenue per patient', 'No-show rate'],
            topChannels: ['Google Business Profile', 'Referrals', 'Social media', 'Insurance networks', 'Local SEO'],
            prospecting: {
                bestMonths: [1, 9, 10],
                bestMonthsLabel: 'January, September-October',
                reasoning: 'New Year health resolutions and fall open enrollment drive patient acquisition focus',
                worstMonths: [6, 7, 12],
                worstReason: 'Summer vacations and holiday season reduce patient flow and decision-making',
                buyerMindset: 'Focused on patient acquisition and reducing no-shows',
                approachTip: 'Lead with patient acquisition cost reduction and online reputation impact'
            },
            calendar: {
                buyingCycle: 'Annual (Q4 planning for next year)',
                contractRenewal: 'Q4 (October-December)',
                keyEvents: [
                    { name: 'Open enrollment season', month: 10, type: 'buying_cycle' },
                    { name: 'New Year resolution surge', month: 1, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '2-4 weeks from first meeting'
            }
        },
        'Gym & Fitness': {
            decisionMakers: ['Owner', 'General Manager', 'Membership Director'],
            painPoints: [
                'January surge vs. summer slump',
                'Member retention after 90 days',
                'Competition from boutique studios and apps',
                'Upselling personal training'
            ],
            primaryKPIs: ['Monthly new members', 'Retention rate', 'Revenue per member', 'Personal training attach rate'],
            topChannels: ['Instagram', 'Facebook Ads', 'Google Business Profile', 'Referral programs', 'Corporate partnerships'],
            prospecting: {
                bestMonths: [9, 10, 11],
                bestMonthsLabel: 'September-November',
                reasoning: 'Planning for January rush; investing in marketing to capture New Year signups',
                worstMonths: [1, 2],
                worstReason: 'January surge keeps staff busy onboarding new members',
                buyerMindset: 'Preparing for biggest acquisition month; focused on retention tools',
                approachTip: 'Show how review management and engagement tools improve 90-day retention'
            },
            calendar: {
                buyingCycle: 'Annual (Q4 planning for January)',
                contractRenewal: 'Q4 (October-November)',
                keyEvents: [
                    { name: 'IHRSA Conference', month: 3, type: 'trade_show' },
                    { name: 'New Year membership push', month: 1, type: 'buying_cycle' },
                    { name: 'Summer challenge season', month: 5, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [9, 10, 11],
                decisionTimeline: '2-3 weeks from first meeting'
            }
        },
        'Medical Practice': {
            decisionMakers: ['Physician/Owner', 'Practice Administrator', 'Office Manager'],
            painPoints: [
                'Insurance reimbursement declining',
                'Patient acquisition cost rising',
                'Online reputation management',
                'Staff turnover and training'
            ],
            primaryKPIs: ['New patient volume', 'Patient retention', 'Revenue per visit', 'Online reviews', 'No-show rate'],
            topChannels: ['Google Business Profile', 'Insurance directories', 'Physician referrals', 'Healthgrades/Zocdoc'],
            prospecting: {
                bestMonths: [1, 2, 10],
                bestMonthsLabel: 'January-February, October',
                reasoning: 'New year deductible resets drive patient volume; fall open enrollment planning',
                worstMonths: [6, 7, 12],
                worstReason: 'Summer vacation coverage and holiday slowdown limit decision-making',
                buyerMindset: 'Seeking patient volume growth and reputation management solutions',
                approachTip: 'Lead with patient acquisition cost data and Healthgrades/Google review impact'
            },
            calendar: {
                buyingCycle: 'Annual (Q4 budget, Q1 execution)',
                contractRenewal: 'Q4 (October-December)',
                keyEvents: [
                    { name: 'MGMA annual conference', month: 10, type: 'trade_show' },
                    { name: 'Open enrollment impact', month: 11, type: 'buying_cycle' },
                    { name: 'Deductible reset surge', month: 1, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [9, 10, 11],
                decisionTimeline: '4-6 weeks from first meeting'
            }
        },
        'Dental Practice': {
            decisionMakers: ['Dentist/Owner', 'Office Manager', 'Treatment Coordinator'],
            painPoints: [
                'New patient acquisition costs ($200-500)',
                'Treatment acceptance rates',
                'Insurance vs. fee-for-service balance',
                'Hygiene reactivation'
            ],
            primaryKPIs: ['New patients per month', 'Treatment acceptance rate', 'Hygiene recall rate', 'Production per visit'],
            topChannels: ['Google Business Profile', 'Google Ads', 'Insurance networks', 'Direct mail', 'Referrals'],
            prospecting: {
                bestMonths: [1, 2, 9],
                bestMonthsLabel: 'January-February, September',
                reasoning: 'New year insurance benefits reset; back-to-school checkups in fall',
                worstMonths: [6, 7, 12],
                worstReason: 'Summer and holiday vacations reduce patient flow and office availability',
                buyerMindset: 'Focused on filling hygiene chairs and reactivating lapsed patients',
                approachTip: 'Show how reviews and online presence reduce cost per new patient acquisition'
            },
            calendar: {
                buyingCycle: 'Annual (Q4 planning)',
                contractRenewal: 'Q4 (November-December)',
                keyEvents: [
                    { name: 'ADA Annual Meeting', month: 10, type: 'trade_show' },
                    { name: 'Benefits use-it-or-lose-it push', month: 11, type: 'buying_cycle' },
                    { name: 'Back-to-school checkup season', month: 8, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '2-4 weeks from first meeting'
            }
        },
        'Chiropractic': {
            decisionMakers: ['Chiropractor/Owner', 'Office Manager', 'Front Desk Lead'],
            painPoints: [
                'Converting first visits to care plans',
                'Personal injury case management',
                'Insurance vs. cash pay balance',
                'Competing with PTs and other providers'
            ],
            primaryKPIs: ['New patients', 'Visit frequency', 'Care plan conversions', 'PI case value', 'Retention'],
            topChannels: ['Google Business Profile', 'Attorney referrals', 'Google Ads', 'Community events', 'Social media'],
            prospecting: {
                bestMonths: [1, 2, 9],
                bestMonthsLabel: 'January-February, September',
                reasoning: 'New year wellness goals and fall sports injuries drive new patient interest',
                worstMonths: [6, 7],
                worstReason: 'Summer slowdown as patients travel; fewer auto accidents',
                buyerMindset: 'Growing new patient volume and building attorney referral networks',
                approachTip: 'Emphasize how Google reviews build trust for first-visit conversion'
            },
            calendar: {
                buyingCycle: 'Annual (Q4 planning)',
                contractRenewal: 'Annual from sign date',
                keyEvents: [
                    { name: 'Parker Seminars', month: 1, type: 'trade_show' },
                    { name: 'ChiroFest', month: 8, type: 'trade_show' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '1-3 weeks from first meeting'
            }
        },
        'Spa & Massage': {
            decisionMakers: ['Owner', 'Spa Director', 'Front Desk Manager'],
            painPoints: [
                'Therapist retention and scheduling',
                'Gift card redemption timing',
                'Upselling packages and memberships',
                'Seasonal demand fluctuations'
            ],
            primaryKPIs: ['Bookings per week', 'Average ticket', 'Membership conversions', 'Therapist utilization', 'Gift card sales'],
            topChannels: ['Instagram', 'Google Business Profile', 'Yelp', 'Local partnerships', 'Email marketing'],
            prospecting: {
                bestMonths: [1, 2, 9],
                bestMonthsLabel: 'January-February, September',
                reasoning: 'Post-holiday gift card redemption creates engagement; fall planning for holiday gift card push',
                worstMonths: [11, 12],
                worstReason: 'Holiday gift card sales and holiday bookings consume all staff bandwidth',
                buyerMindset: 'Converting gift card customers to memberships; building slow-month traffic',
                approachTip: 'Show how review capture during gift card redemptions builds long-term clientele'
            },
            calendar: {
                buyingCycle: 'Semi-annual (Q1 and Q3 planning)',
                contractRenewal: 'Annual from sign date',
                keyEvents: [
                    { name: 'International Spa Association conference', month: 9, type: 'trade_show' },
                    { name: 'Holiday gift card season', month: 11, type: 'buying_cycle' },
                    { name: 'Valentine\'s Day promotions', month: 1, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [8, 9, 10],
                decisionTimeline: '1-3 weeks from first meeting'
            }
        }
    },

    // ============================================
    // PROFESSIONAL SERVICES
    // ============================================
    'Professional Services': {
        default: {
            decisionMakers: ['Partner', 'Managing Director', 'Business Development Lead'],
            painPoints: [
                'Commoditization and fee pressure',
                'Building consistent referral pipeline',
                'Differentiating expertise',
                'Long sales cycles'
            ],
            primaryKPIs: ['New clients per quarter', 'Revenue per client', 'Realization rate', 'Referral rate'],
            topChannels: ['Referrals', 'LinkedIn', 'Speaking/Events', 'Content marketing', 'Industry associations'],
            prospecting: {
                bestMonths: [1, 2, 9, 10],
                bestMonthsLabel: 'January-February, September-October',
                reasoning: 'Q1 new business push and Q4 budget planning create openness to partnerships',
                worstMonths: [4, 7, 8, 12],
                worstReason: 'Tax season (Apr), summer vacations, and holiday breaks limit availability',
                buyerMindset: 'Focused on differentiation and building referral pipeline for the year',
                approachTip: 'Lead with thought leadership positioning and client testimonial management'
            },
            calendar: {
                buyingCycle: 'Quarterly (partner meeting cadence)',
                contractRenewal: 'Annual (varies by firm)',
                keyEvents: [
                    { name: 'Fiscal year planning', month: 10, type: 'buying_cycle' },
                    { name: 'Q1 business development push', month: 1, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '4-8 weeks from first meeting'
            }
        },
        'Legal': {
            decisionMakers: ['Managing Partner', 'Senior Partner', 'Marketing Director', 'Intake Manager'],
            painPoints: [
                'High cost per case ($500-2000+ for PI)',
                'Intake conversion rates',
                'Managing online reputation',
                'Competition from legal tech and ads'
            ],
            primaryKPIs: ['Cases signed per month', 'Cost per signed case', 'Case value', 'Google reviews', 'Intake conversion rate'],
            topChannels: ['Google Ads', 'TV/Radio', 'Referral networks', 'Google Business Profile', 'Avvo/FindLaw'],
            prospecting: {
                bestMonths: [1, 2, 9],
                bestMonthsLabel: 'January-February, September',
                reasoning: 'Post-holiday budget resets; September back-to-business after summer',
                worstMonths: [7, 8, 12],
                worstReason: 'Summer associate rotations and holiday breaks disrupt decision-making',
                buyerMindset: 'Focused on reducing cost per case and improving intake conversion',
                approachTip: 'Show how review management directly impacts case acquisition cost'
            },
            calendar: {
                buyingCycle: 'Annual (partner retreat planning, usually Q4)',
                contractRenewal: 'Annual (January or firm fiscal year)',
                keyEvents: [
                    { name: 'ABA Annual Meeting', month: 8, type: 'trade_show' },
                    { name: 'Legal Marketing Association conference', month: 3, type: 'trade_show' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '4-6 weeks from first meeting'
            }
        },
        'Accounting': {
            decisionMakers: ['Managing Partner', 'Partner', 'Business Development Manager'],
            painPoints: [
                'Tax season capacity constraints',
                'Transitioning to advisory services',
                'Client retention during firm transitions',
                'Technology adoption and efficiency'
            ],
            primaryKPIs: ['New clients per quarter', 'Revenue per client', 'Realization rate', 'Advisory revenue %', 'Retention'],
            topChannels: ['Referrals', 'LinkedIn', 'Industry networking', 'Content marketing', 'Strategic alliances'],
            prospecting: {
                bestMonths: [5, 6, 9, 10],
                bestMonthsLabel: 'May-June, September-October',
                reasoning: 'Post-tax season relief (May-Jun) and pre-year-end planning (Sep-Oct)',
                worstMonths: [1, 2, 3, 4],
                worstReason: 'Tax season is all-consuming for the entire firm',
                buyerMindset: 'Post-tax season: evaluating what worked; fall: planning client acquisition for next year',
                approachTip: 'Position around advisory service marketing and client acquisition beyond tax prep'
            },
            calendar: {
                buyingCycle: 'Annual (post-tax season evaluation)',
                contractRenewal: 'Q2 (May-June post-tax season)',
                keyEvents: [
                    { name: 'AICPA ENGAGE conference', month: 6, type: 'trade_show' },
                    { name: 'Tax season starts', month: 1, type: 'buying_cycle' },
                    { name: 'Year-end planning push', month: 10, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [5, 6, 7],
                decisionTimeline: '4-6 weeks from first meeting'
            }
        },
        'Real Estate': {
            decisionMakers: ['Broker/Owner', 'Team Lead', 'Agent'],
            painPoints: [
                'Lead quality and conversion',
                'Market fluctuations affecting volume',
                'Building personal brand vs. brokerage',
                'Zillow/Redfin disruption'
            ],
            primaryKPIs: ['Transactions closed', 'Average sale price', 'Commission volume', 'Lead conversion rate', 'Sphere touches'],
            topChannels: ['Zillow/Realtor.com', 'Google Business Profile', 'Social media', 'Sphere marketing', 'Open houses'],
            prospecting: {
                bestMonths: [1, 2, 11, 12],
                bestMonthsLabel: 'November-February',
                reasoning: 'Winter slowdown gives agents time to invest in personal brand and tools',
                worstMonths: [4, 5, 6],
                worstReason: 'Spring selling season is peak showing and closing time',
                buyerMindset: 'Building brand presence and lead pipeline for spring market',
                approachTip: 'Show how review volume and Google presence drive direct leads vs. Zillow'
            },
            calendar: {
                buyingCycle: 'Annual (winter planning for spring market)',
                contractRenewal: 'Annual from sign date',
                keyEvents: [
                    { name: 'NAR Annual Conference', month: 11, type: 'trade_show' },
                    { name: 'Spring market prep', month: 2, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [11, 12, 1],
                decisionTimeline: '1-2 weeks from first meeting'
            }
        },
        'Insurance': {
            decisionMakers: ['Agency Owner', 'Principal', 'Producer', 'Account Manager'],
            painPoints: [
                'Retention during renewal season',
                'Cross-selling multiple lines',
                'Competing with direct carriers',
                'Building book value for exit'
            ],
            primaryKPIs: ['Written premium', 'Retention rate', 'Policies per household', 'New business close rate', 'Book value'],
            topChannels: ['Referrals', 'Google Business Profile', 'Community involvement', 'Cross-sell campaigns', 'LinkedIn'],
            prospecting: {
                bestMonths: [1, 2, 5, 6],
                bestMonthsLabel: 'January-February, May-June',
                reasoning: 'Post-renewal evaluation in Q1; mid-year review of book performance',
                worstMonths: [10, 11, 12],
                worstReason: 'Renewal season demands full attention on retention and cross-sell',
                buyerMindset: 'Growing book value and reducing reliance on carrier-provided leads',
                approachTip: 'Emphasize how online reviews build trust vs. direct carrier competition'
            },
            calendar: {
                buyingCycle: 'Annual (post-renewal evaluation)',
                contractRenewal: 'Q4 (October-December)',
                keyEvents: [
                    { name: 'Insurance industry conferences', month: 3, type: 'trade_show' },
                    { name: 'Renewal season', month: 10, type: 'buying_cycle' },
                    { name: 'Open enrollment', month: 11, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '2-4 weeks from first meeting'
            }
        }
    },

    // ============================================
    // AUTOMOTIVE
    // ============================================
    'Automotive': {
        default: {
            decisionMakers: ['Owner', 'Service Manager', 'Shop Foreman'],
            painPoints: [
                'Customer trust and transparency',
                'Competition from dealerships',
                'Technician shortage',
                'Parts cost and availability'
            ],
            primaryKPIs: ['Cars per day', 'Average repair order', 'Labor rate', 'Google reviews', 'Customer return rate'],
            topChannels: ['Google Business Profile', 'Google Ads', 'Referrals', 'Direct mail', 'AutoVitals/repair shop marketing'],
            prospecting: {
                bestMonths: [1, 2, 9],
                bestMonthsLabel: 'January-February, September',
                reasoning: 'Post-holiday slowdown and back-to-school prep create natural engagement windows',
                worstMonths: [6, 7, 12],
                worstReason: 'Summer road-trip season and holiday prep keep bays full',
                buyerMindset: 'Looking to build trust signals and compete against dealerships',
                approachTip: 'Show how reviews directly address trust issues that plague independent shops'
            },
            calendar: {
                buyingCycle: 'Annual (Q1 planning)',
                contractRenewal: 'Q4 (November-December)',
                keyEvents: [
                    { name: 'AAPEX/SEMA Show', month: 11, type: 'trade_show' },
                    { name: 'Spring car care season', month: 3, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [11, 12, 1],
                decisionTimeline: '1-3 weeks from first meeting'
            }
        },
        'Auto Repair': {
            decisionMakers: ['Owner', 'Service Manager', 'Service Advisor'],
            painPoints: [
                'Building trust with customers (perception of upselling)',
                'Competition from dealerships and chains',
                'Technician recruitment and retention',
                'Managing online reputation'
            ],
            primaryKPIs: ['Average repair order', 'Car count', 'Labor rate', 'Parts margin', 'Google rating', 'Return customer rate'],
            topChannels: ['Google Business Profile', 'Google Ads', 'Referrals', 'AutoVitals', 'Direct mail/postcards'],
            prospecting: {
                bestMonths: [1, 2, 9],
                bestMonthsLabel: 'January-February, September',
                reasoning: 'Slower months give shop owners time to think about marketing and growth',
                worstMonths: [6, 7],
                worstReason: 'Summer road trips and AC repair keep all bays full',
                buyerMindset: 'Focused on building trust and competing with dealership service departments',
                approachTip: 'Lead with trust-building through review management and transparency tools'
            },
            calendar: {
                buyingCycle: 'Annual (Q1 planning)',
                contractRenewal: 'Annual from sign date',
                keyEvents: [
                    { name: 'AAPEX Show', month: 11, type: 'trade_show' },
                    { name: 'Spring maintenance season', month: 3, type: 'buying_cycle' },
                    { name: 'Winter prep season', month: 9, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [11, 12, 1],
                decisionTimeline: '1-2 weeks from first meeting'
            }
        },
        'Body Shop': {
            decisionMakers: ['Owner', 'General Manager', 'Estimator'],
            painPoints: [
                'Insurance DRP relationships',
                'Cycle time pressure from insurers',
                'Parts availability and delays',
                'Competition for non-DRP work'
            ],
            primaryKPIs: ['Cycle time', 'CSI scores', 'Supplement capture', 'Revenue per RO', 'DRP vs. non-DRP mix'],
            topChannels: ['Insurance DRP programs', 'Google Business Profile', 'Towing company relationships', 'Referrals'],
            prospecting: {
                bestMonths: [1, 2, 3],
                bestMonthsLabel: 'January-March',
                reasoning: 'Post-holiday insurance renewals; DRP evaluations happen in Q1',
                worstMonths: [11, 12],
                worstReason: 'Holiday season and winter weather claims spike keeps shops at capacity',
                buyerMindset: 'Looking to grow non-DRP work and improve CSI scores',
                approachTip: 'Emphasize how strong reviews help capture non-DRP direct customers'
            },
            calendar: {
                buyingCycle: 'Annual (Q1 evaluation)',
                contractRenewal: 'Varies by DRP agreement',
                keyEvents: [
                    { name: 'SEMA Show', month: 11, type: 'trade_show' },
                    { name: 'DRP performance reviews', month: 1, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [11, 12, 1],
                decisionTimeline: '2-4 weeks from first meeting'
            }
        },
        'Car Dealership': {
            decisionMakers: ['Dealer Principal', 'General Manager', 'Sales Manager', 'Marketing Director'],
            painPoints: [
                'Inventory turn and acquisition',
                'Digital retailing adoption',
                'Service retention for sold vehicles',
                'OEM compliance and incentives'
            ],
            primaryKPIs: ['Units sold', 'Gross per unit', 'Service absorption', 'CSI scores', 'Market share'],
            topChannels: ['Third-party sites (Cars.com, AutoTrader)', 'Google Ads', 'Social media', 'OEM co-op', 'Email/CRM'],
            prospecting: {
                bestMonths: [1, 2, 10],
                bestMonthsLabel: 'January-February, October',
                reasoning: 'Post-year-end close evaluation; October for next-year co-op budget planning',
                worstMonths: [11, 12],
                worstReason: 'Year-end sales push and holiday promotions dominate all attention',
                buyerMindset: 'Evaluating digital retailing tools and reputation management for CSI',
                approachTip: 'Lead with CSI score improvement and service retention data'
            },
            calendar: {
                buyingCycle: 'Annual (January 20-group meetings)',
                contractRenewal: 'Q4 (October-December, aligned with OEM year)',
                keyEvents: [
                    { name: 'NADA Show', month: 1, type: 'trade_show' },
                    { name: 'OEM co-op budget allocation', month: 10, type: 'buying_cycle' },
                    { name: 'Year-end sales event', month: 11, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '4-8 weeks from first meeting'
            }
        }
    },

    // ============================================
    // RETAIL
    // ============================================
    'Retail': {
        default: {
            decisionMakers: ['Owner', 'Store Manager', 'Buyer/Merchandiser'],
            painPoints: [
                'E-commerce competition',
                'Foot traffic decline',
                'Inventory management',
                'Customer loyalty and retention'
            ],
            primaryKPIs: ['Revenue per sq ft', 'Foot traffic', 'Conversion rate', 'Average transaction', 'Inventory turn'],
            topChannels: ['Google Business Profile', 'Instagram', 'Email marketing', 'Local events', 'Loyalty programs'],
            prospecting: {
                bestMonths: [1, 2, 8],
                bestMonthsLabel: 'January-February, August',
                reasoning: 'Post-holiday evaluation of performance; August back-to-school prep',
                worstMonths: [11, 12],
                worstReason: 'Holiday shopping season demands all focus on sales floor and inventory',
                buyerMindset: 'Evaluating what drove holiday traffic; planning for next peak season',
                approachTip: 'Lead with foot traffic and loyalty data to counter e-commerce competition'
            },
            calendar: {
                buyingCycle: 'Semi-annual (post-holiday and back-to-school)',
                contractRenewal: 'Q4 (October-November)',
                keyEvents: [
                    { name: 'NRF Big Show', month: 1, type: 'trade_show' },
                    { name: 'Back-to-school season', month: 8, type: 'buying_cycle' },
                    { name: 'Holiday planning', month: 9, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [9, 10, 11],
                decisionTimeline: '2-3 weeks from first meeting'
            }
        },
        'General Merchandise': {
            decisionMakers: ['Owner', 'Store Manager', 'Merchandise Manager'],
            painPoints: [
                'Amazon/online competition',
                'Maintaining foot traffic',
                'Inventory breadth vs. depth',
                'Seasonal cash flow'
            ],
            primaryKPIs: ['Sales per square foot', 'Inventory turnover', 'Foot traffic', 'Basket size'],
            topChannels: ['Google Business Profile', 'Facebook', 'Local advertising', 'Community events', 'Loyalty programs'],
            prospecting: {
                bestMonths: [1, 2, 8],
                bestMonthsLabel: 'January-February, August',
                reasoning: 'Post-holiday review and back-to-school planning windows',
                worstMonths: [11, 12],
                worstReason: 'Holiday season makes any non-sales conversation impossible',
                buyerMindset: 'Competing with Amazon; seeking local differentiation strategies',
                approachTip: 'Show how local presence and reviews drive in-store visits over Amazon'
            },
            calendar: {
                buyingCycle: 'Semi-annual (Q1 and Q3)',
                contractRenewal: 'Q4 (October-November)',
                keyEvents: [
                    { name: 'NRF Big Show', month: 1, type: 'trade_show' },
                    { name: 'Holiday inventory planning', month: 8, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [9, 10, 11],
                decisionTimeline: '2-3 weeks from first meeting'
            }
        },
        'Clothing': {
            decisionMakers: ['Owner', 'Buyer', 'Store Manager'],
            painPoints: [
                'Fast fashion competition',
                'Sizing and returns',
                'Seasonal inventory timing',
                'Building brand loyalty'
            ],
            primaryKPIs: ['Sell-through rate', 'Average transaction', 'Return rate', 'Customer repeat rate'],
            topChannels: ['Instagram', 'Google Business Profile', 'Email marketing', 'Influencer partnerships', 'Local events'],
            prospecting: {
                bestMonths: [1, 2, 7],
                bestMonthsLabel: 'January-February, July',
                reasoning: 'Post-holiday clearance and mid-year inventory transitions create planning time',
                worstMonths: [11, 12],
                worstReason: 'Holiday shopping and seasonal collection launches demand full attention',
                buyerMindset: 'Building brand loyalty and Instagram presence to drive repeat visits',
                approachTip: 'Emphasize Instagram integration and review-driven brand loyalty'
            },
            calendar: {
                buyingCycle: 'Seasonal (4x/year aligned with fashion seasons)',
                contractRenewal: 'Annual from sign date',
                keyEvents: [
                    { name: 'Spring collection launch', month: 2, type: 'buying_cycle' },
                    { name: 'Fall collection launch', month: 8, type: 'buying_cycle' },
                    { name: 'Holiday shopping season', month: 11, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [1, 7],
                decisionTimeline: '1-3 weeks from first meeting'
            }
        },
        'Electronics': {
            decisionMakers: ['Owner', 'Store Manager', 'Sales Lead'],
            painPoints: [
                'Price transparency/showrooming',
                'Rapid product obsolescence',
                'Service and installation upsells',
                'Competition from big box and Amazon'
            ],
            primaryKPIs: ['Average ticket', 'Attachment rate (accessories/services)', 'Margin per sale', 'Customer satisfaction'],
            topChannels: ['Google Business Profile', 'Google Ads', 'Local SEO', 'Tech forums/communities', 'Service partnerships'],
            prospecting: {
                bestMonths: [1, 2, 8],
                bestMonthsLabel: 'January-February, August',
                reasoning: 'Post-holiday evaluation and back-to-school tech buying planning',
                worstMonths: [11, 12],
                worstReason: 'Black Friday through holiday season is peak sales period',
                buyerMindset: 'Seeking service differentiation to combat showrooming and price comparison',
                approachTip: 'Show how reviews highlighting service/expertise combat showrooming behavior'
            },
            calendar: {
                buyingCycle: 'Semi-annual (post-holiday and back-to-school)',
                contractRenewal: 'Q4 (October-November)',
                keyEvents: [
                    { name: 'CES', month: 1, type: 'trade_show' },
                    { name: 'Back-to-school tech season', month: 8, type: 'buying_cycle' },
                    { name: 'Black Friday prep', month: 10, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [9, 10],
                decisionTimeline: '2-3 weeks from first meeting'
            }
        }
    },

    // ============================================
    // SALON & BEAUTY
    // ============================================
    'Salon & Beauty': {
        default: {
            decisionMakers: ['Owner', 'Salon Manager', 'Lead Stylist'],
            painPoints: [
                'Stylist retention and commission structures',
                'No-shows and late cancellations',
                'Building retail product sales',
                'Standing out in saturated market'
            ],
            primaryKPIs: ['Revenue per stylist', 'Rebooking rate', 'Retail per service ticket', 'No-show rate', 'New client acquisition'],
            topChannels: ['Instagram', 'Google Business Profile', 'Referrals', 'Yelp', 'Booking apps (Vagaro, Fresha)'],
            prospecting: {
                bestMonths: [1, 2, 7],
                bestMonthsLabel: 'January-February, July',
                reasoning: 'Post-holiday slow period and mid-summer lull give owners planning time',
                worstMonths: [4, 5, 11, 12],
                worstReason: 'Prom/wedding season (spring) and holiday party season keep chairs full',
                buyerMindset: 'Looking to fill slow-month appointments and reduce no-shows',
                approachTip: 'Show how reviews and rebooking tools keep chairs full during slow months'
            },
            calendar: {
                buyingCycle: 'Semi-annual (Q1 and mid-year)',
                contractRenewal: 'Annual from sign date',
                keyEvents: [
                    { name: 'International Beauty Show', month: 3, type: 'trade_show' },
                    { name: 'Prom/wedding season prep', month: 3, type: 'buying_cycle' },
                    { name: 'Holiday party season', month: 10, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [11, 12, 1],
                decisionTimeline: '1-2 weeks from first meeting'
            }
        },
        'Hair Salon': {
            decisionMakers: ['Owner', 'Salon Manager', 'Lead Stylist'],
            painPoints: [
                'Stylist turnover and recruitment',
                'No-shows and last-minute cancellations',
                'Retail product attach rate',
                'Differentiating in crowded market'
            ],
            primaryKPIs: ['Average ticket', 'Rebooking rate', 'Stylist productivity', 'Retail sales %', 'New client rate'],
            topChannels: ['Instagram', 'Google Business Profile', 'Yelp', 'Referral programs', 'Walk-in traffic'],
            prospecting: {
                bestMonths: [1, 2, 7],
                bestMonthsLabel: 'January-February, July',
                reasoning: 'Post-holiday and mid-summer slowdowns create openness to new tools',
                worstMonths: [4, 5, 12],
                worstReason: 'Prom, wedding, and holiday seasons keep every stylist booked solid',
                buyerMindset: 'Focused on stylist retention, reducing no-shows, and filling slow days',
                approachTip: 'Highlight Instagram portfolio and review management for new client acquisition'
            },
            calendar: {
                buyingCycle: 'Semi-annual (Q1 and mid-year)',
                contractRenewal: 'Annual from sign date',
                keyEvents: [
                    { name: 'International Beauty Show', month: 3, type: 'trade_show' },
                    { name: 'Bronner Bros show', month: 8, type: 'trade_show' },
                    { name: 'Back-to-school rush', month: 8, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [12, 1],
                decisionTimeline: '1-2 weeks from first meeting'
            }
        },
        'Beauty Salon': {
            decisionMakers: ['Owner', 'Manager', 'Lead Aesthetician'],
            painPoints: [
                'Upselling treatments and packages',
                'Managing treatment room utilization',
                'Competition from med spas',
                'Keeping up with treatment trends'
            ],
            primaryKPIs: ['Revenue per room', 'Treatment mix', 'Package sales', 'Membership conversions', 'Rebooking rate'],
            topChannels: ['Instagram', 'Facebook', 'Google Business Profile', 'Groupon (strategically)', 'Email marketing'],
            prospecting: {
                bestMonths: [1, 2, 9],
                bestMonthsLabel: 'January-February, September',
                reasoning: 'New year self-care resolutions; fall prep before holiday gift card season',
                worstMonths: [11, 12],
                worstReason: 'Holiday gift cards and party-prep bookings fill every treatment room',
                buyerMindset: 'Converting one-time clients to memberships and competing with med spas',
                approachTip: 'Show how reviews differentiate from med spas and build membership conversions'
            },
            calendar: {
                buyingCycle: 'Semi-annual (Q1 and Q3)',
                contractRenewal: 'Annual from sign date',
                keyEvents: [
                    { name: 'International Esthetics Show', month: 6, type: 'trade_show' },
                    { name: 'Holiday gift card season prep', month: 10, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '1-2 weeks from first meeting'
            }
        },
        'Nail Salon': {
            decisionMakers: ['Owner', 'Manager'],
            painPoints: [
                'Price competition and race to bottom',
                'Service speed vs. quality',
                'Building loyalty in transactional business',
                'Health/sanitation compliance'
            ],
            primaryKPIs: ['Services per day', 'Average ticket', 'Repeat customer rate', 'Google rating'],
            topChannels: ['Google Business Profile', 'Walk-in traffic', 'Yelp', 'Instagram', 'Loyalty programs'],
            prospecting: {
                bestMonths: [1, 2, 7],
                bestMonthsLabel: 'January-February, July',
                reasoning: 'Post-holiday and mid-summer slowdowns; fewer walk-ins means more planning time',
                worstMonths: [4, 5, 12],
                worstReason: 'Prom, graduation, and holiday nail art demand keeps every station busy',
                buyerMindset: 'Looking for loyalty tools to rise above price competition',
                approachTip: 'Focus on review-driven quality perception to justify premium pricing'
            },
            calendar: {
                buyingCycle: 'Annual (Q1 planning)',
                contractRenewal: 'Annual from sign date',
                keyEvents: [
                    { name: 'International Beauty Show', month: 3, type: 'trade_show' },
                    { name: 'Prom/graduation season', month: 4, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [12, 1],
                decisionTimeline: '1 week from first meeting'
            }
        }
    },

    // ============================================
    // TECHNOLOGY & SAAS
    // ============================================
    'Technology & SaaS': {
        default: {
            decisionMakers: ['CEO/Founder', 'CTO', 'VP Engineering', 'Head of Product'],
            painPoints: [
                'Customer acquisition cost (CAC) optimization',
                'Churn reduction and retention',
                'Scaling engineering team and infrastructure',
                'Product-market fit and differentiation'
            ],
            primaryKPIs: ['MRR/ARR', 'Churn rate', 'CAC', 'LTV', 'Net Revenue Retention'],
            topChannels: ['Content marketing', 'LinkedIn', 'Product-led growth', 'Paid search', 'Partnerships'],
            prospecting: {
                bestMonths: [1, 2, 9, 10],
                bestMonthsLabel: 'January-February, September-October',
                reasoning: 'Q1 new budget execution and Q4 budget planning create buying windows',
                worstMonths: [7, 8, 12],
                worstReason: 'Summer vacations and holiday freeze periods halt purchasing decisions',
                buyerMindset: 'Focused on CAC optimization and growth tool evaluation',
                approachTip: 'Lead with measurable impact on CAC and customer acquisition metrics'
            },
            calendar: {
                buyingCycle: 'Annual (Q4 budget for Q1 execution)',
                contractRenewal: 'Annual (varies by contract start)',
                keyEvents: [
                    { name: 'SaaStr Annual', month: 9, type: 'trade_show' },
                    { name: 'Q4 budget planning', month: 10, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '4-8 weeks from first meeting'
            }
        },
        'Software Development': {
            decisionMakers: ['CEO', 'CTO', 'VP Engineering', 'Engineering Manager'],
            painPoints: [
                'Talent acquisition and retention',
                'Project delivery timelines',
                'Technical debt management',
                'Client scope creep'
            ],
            primaryKPIs: ['Billable utilization', 'Project margins', 'Developer velocity', 'Client satisfaction', 'Repeat business %'],
            topChannels: ['Clutch/G2', 'LinkedIn', 'Referrals', 'Tech conferences', 'GitHub presence'],
            prospecting: {
                bestMonths: [1, 2, 9],
                bestMonthsLabel: 'January-February, September',
                reasoning: 'New year project planning and fall budget cycles for new engagements',
                worstMonths: [7, 8, 12],
                worstReason: 'Summer vacations and year-end code freezes reduce availability',
                buyerMindset: 'Building client pipeline and improving online credibility on Clutch/G2',
                approachTip: 'Show how review platforms like Clutch/G2 drive enterprise lead generation'
            },
            calendar: {
                buyingCycle: 'Quarterly (project-based)',
                contractRenewal: 'Varies by engagement',
                keyEvents: [
                    { name: 'AWS re:Invent', month: 12, type: 'trade_show' },
                    { name: 'Google I/O', month: 5, type: 'trade_show' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '4-6 weeks from first meeting'
            }
        },
        'IT Services': {
            decisionMakers: ['Owner', 'Operations Manager', 'Technical Director'],
            painPoints: [
                'Recurring revenue vs. break-fix model',
                'MSP competition and pricing pressure',
                'Cybersecurity complexity',
                'Vendor management overhead'
            ],
            primaryKPIs: ['MRR', 'Endpoints managed', 'Response time', 'Client retention', 'Ticket resolution time'],
            topChannels: ['Referrals', 'Local networking', 'LinkedIn', 'Google Business Profile', 'Vendor partnerships'],
            prospecting: {
                bestMonths: [1, 2, 9, 10],
                bestMonthsLabel: 'January-February, September-October',
                reasoning: 'New year IT budget execution and Q4 planning for next year contracts',
                worstMonths: [7, 8, 12],
                worstReason: 'Summer staffing gaps and holiday freeze periods slow decisions',
                buyerMindset: 'Growing managed service base and building trust with local businesses',
                approachTip: 'Emphasize how Google reviews and local presence win SMB managed service deals'
            },
            calendar: {
                buyingCycle: 'Annual (Q4 planning for Q1 execution)',
                contractRenewal: 'Annual (varies by client)',
                keyEvents: [
                    { name: 'IT Nation Connect', month: 11, type: 'trade_show' },
                    { name: 'Cybersecurity awareness month', month: 10, type: 'industry_event' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '2-4 weeks from first meeting'
            }
        },
        'Cloud & Hosting': {
            decisionMakers: ['CTO', 'VP Infrastructure', 'DevOps Lead', 'IT Director'],
            painPoints: [
                'Multi-cloud complexity',
                'Cost optimization and waste',
                'Security and compliance',
                'Migration challenges'
            ],
            primaryKPIs: ['Uptime SLA', 'Cost per workload', 'Customer satisfaction', 'Revenue per customer'],
            topChannels: ['Content marketing', 'Tech communities', 'Partner ecosystems', 'Conferences', 'Direct sales'],
            prospecting: {
                bestMonths: [1, 2, 9, 10],
                bestMonthsLabel: 'January-February, September-October',
                reasoning: 'Annual cloud budget reviews in Q1; Q4 planning for infrastructure changes',
                worstMonths: [7, 8, 12],
                worstReason: 'Summer infrastructure freezes and year-end change freezes',
                buyerMindset: 'Evaluating cost optimization and provider reputation',
                approachTip: 'Lead with trust signals and third-party review presence for enterprise credibility'
            },
            calendar: {
                buyingCycle: 'Annual (Q4 budget planning)',
                contractRenewal: 'Annual (often multi-year)',
                keyEvents: [
                    { name: 'AWS re:Invent', month: 12, type: 'trade_show' },
                    { name: 'KubeCon', month: 10, type: 'trade_show' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '6-12 weeks from first meeting'
            }
        },
        'SaaS Products': {
            decisionMakers: ['CEO/Founder', 'Head of Growth', 'VP Sales', 'Product Manager'],
            painPoints: [
                'User activation and onboarding',
                'Feature adoption rates',
                'Competitive differentiation',
                'Scaling customer success'
            ],
            primaryKPIs: ['MRR/ARR', 'Net Revenue Retention', 'Activation rate', 'Feature adoption', 'NPS'],
            topChannels: ['Product-led growth', 'Content/SEO', 'G2/Capterra reviews', 'Paid ads', 'Partnerships'],
            prospecting: {
                bestMonths: [1, 2, 9, 10],
                bestMonthsLabel: 'January-February, September-October',
                reasoning: 'Q1 growth push with new budgets; Q4 tool evaluation for next year',
                worstMonths: [7, 8, 12],
                worstReason: 'Summer slowdown and holiday season reduce decision-making velocity',
                buyerMindset: 'Focused on growth metrics, review presence on G2/Capterra, and differentiation',
                approachTip: 'Show how review management on G2/Capterra directly impacts deal velocity'
            },
            calendar: {
                buyingCycle: 'Quarterly (board cadence)',
                contractRenewal: 'Annual from sign date',
                keyEvents: [
                    { name: 'SaaStr Annual', month: 9, type: 'trade_show' },
                    { name: 'SaaS industry benchmarks release', month: 1, type: 'industry_event' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '4-8 weeks from first meeting'
            }
        },
        'Tech Consulting': {
            decisionMakers: ['Managing Partner', 'Practice Lead', 'Engagement Manager'],
            painPoints: [
                'Utilization rate management',
                'Knowledge transfer and IP retention',
                'Client dependency on key personnel',
                'Differentiating from larger firms'
            ],
            primaryKPIs: ['Utilization rate', 'Average engagement value', 'Client NPS', 'Repeat engagement rate'],
            topChannels: ['Referrals', 'LinkedIn thought leadership', 'Speaking/conferences', 'Case studies', 'Strategic partnerships'],
            prospecting: {
                bestMonths: [1, 2, 9, 10],
                bestMonthsLabel: 'January-February, September-October',
                reasoning: 'Q1 new engagement planning and Q4 evaluation of consulting partnerships',
                worstMonths: [7, 8, 12],
                worstReason: 'Summer bench time and holiday slowdowns reduce client-side urgency',
                buyerMindset: 'Building pipeline through thought leadership and credibility signals',
                approachTip: 'Position review/testimonial management as pipeline for case study development'
            },
            calendar: {
                buyingCycle: 'Quarterly (engagement-based)',
                contractRenewal: 'Varies by engagement',
                keyEvents: [
                    { name: 'Gartner conferences', month: 10, type: 'trade_show' },
                    { name: 'Q1 consulting engagement kick-off', month: 1, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '4-8 weeks from first meeting'
            }
        }
    },

    // ============================================
    // FINANCE & BANKING
    // ============================================
    'Finance & Banking': {
        default: {
            decisionMakers: ['CEO', 'CFO', 'Chief Banking Officer', 'Branch Manager'],
            painPoints: [
                'Regulatory compliance burden',
                'Digital transformation pressure',
                'Customer acquisition costs',
                'Fintech competition'
            ],
            primaryKPIs: ['Assets under management', 'Net interest margin', 'Cost-to-income ratio', 'Customer acquisition cost'],
            topChannels: ['Community presence', 'Digital marketing', 'Referrals', 'Financial advisor networks', 'Events'],
            prospecting: {
                bestMonths: [1, 2, 9, 10],
                bestMonthsLabel: 'January-February, September-October',
                reasoning: 'Q1 strategic initiative execution and Q4 budget planning cycles',
                worstMonths: [6, 7, 12],
                worstReason: 'Mid-year regulatory reviews and holiday slowdowns limit vendor decisions',
                buyerMindset: 'Focused on digital transformation and customer acquisition efficiency',
                approachTip: 'Lead with community trust-building and online reputation for branch banking'
            },
            calendar: {
                buyingCycle: 'Annual (Q4 budget for Q1 execution)',
                contractRenewal: 'Annual (fiscal year aligned)',
                keyEvents: [
                    { name: 'ABA Annual Convention', month: 10, type: 'trade_show' },
                    { name: 'Q1 strategic planning execution', month: 1, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [9, 10, 11],
                decisionTimeline: '6-12 weeks from first meeting'
            }
        },
        'Commercial Banking': {
            decisionMakers: ['Regional President', 'Commercial Banking Director', 'Relationship Manager'],
            painPoints: [
                'Deposit growth and retention',
                'Loan portfolio quality',
                'Digital banking adoption',
                'SMB relationship management'
            ],
            primaryKPIs: ['Deposit growth', 'Loan origination volume', 'Net interest margin', 'Non-performing loan ratio'],
            topChannels: ['Business development', 'Community events', 'Referral networks', 'Chamber of Commerce', 'LinkedIn'],
            prospecting: {
                bestMonths: [1, 2, 9, 10],
                bestMonthsLabel: 'January-February, September-October',
                reasoning: 'New year business development push and Q4 relationship planning',
                worstMonths: [6, 7, 12],
                worstReason: 'Mid-year reviews and holiday season limit availability',
                buyerMindset: 'Growing SMB relationships and building community presence',
                approachTip: 'Show how online reputation drives business deposit acquisition'
            },
            calendar: {
                buyingCycle: 'Annual (Q4 budget cycle)',
                contractRenewal: 'Annual (fiscal year)',
                keyEvents: [
                    { name: 'ABA Annual Convention', month: 10, type: 'trade_show' },
                    { name: 'Q1 business development kick-off', month: 1, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [9, 10, 11],
                decisionTimeline: '6-12 weeks from first meeting'
            }
        },
        'Credit Union': {
            decisionMakers: ['CEO', 'VP Marketing', 'Branch Manager', 'Member Services Director'],
            painPoints: [
                'Competing with bank marketing budgets',
                'Member engagement and digital adoption',
                'Younger demographic acquisition',
                'Merger and growth pressure'
            ],
            primaryKPIs: ['Member growth', 'Loan-to-share ratio', 'Member satisfaction', 'Digital adoption rate'],
            topChannels: ['Community sponsorships', 'SEO/SEM', 'Member referrals', 'Employer partnerships', 'Social media'],
            prospecting: {
                bestMonths: [1, 2, 9],
                bestMonthsLabel: 'January-February, September',
                reasoning: 'New year marketing budget execution; fall planning for next year campaigns',
                worstMonths: [6, 7, 12],
                worstReason: 'Summer member slowdown and holiday season',
                buyerMindset: 'Growing younger member base and improving digital reputation',
                approachTip: 'Emphasize how reviews and social proof attract younger demographics'
            },
            calendar: {
                buyingCycle: 'Annual (board budget approval in Q4)',
                contractRenewal: 'Annual (calendar year)',
                keyEvents: [
                    { name: 'CUNA GAC conference', month: 3, type: 'trade_show' },
                    { name: 'International Credit Union Day', month: 10, type: 'industry_event' }
                ],
                budgetPlanningMonths: [9, 10, 11],
                decisionTimeline: '6-10 weeks from first meeting'
            }
        },
        'Investment Banking': {
            decisionMakers: ['Managing Director', 'Partner', 'Deal Team Lead'],
            painPoints: [
                'Deal flow generation',
                'Competition for mandates',
                'Talent retention',
                'Market volatility impact'
            ],
            primaryKPIs: ['Deal volume', 'Fee revenue', 'Win rate', 'Average deal size'],
            topChannels: ['Relationship networks', 'Industry conferences', 'Thought leadership', 'Alumni networks'],
            prospecting: {
                bestMonths: [1, 2, 9],
                bestMonthsLabel: 'January-February, September',
                reasoning: 'New year deal pipeline building and post-summer strategic planning',
                worstMonths: [7, 8, 12],
                worstReason: 'Summer associate rotations, vacation season, and year-end deal closings',
                buyerMindset: 'Building brand presence and thought leadership for deal origination',
                approachTip: 'Position around thought leadership and firm reputation management'
            },
            calendar: {
                buyingCycle: 'Annual (Q4 planning)',
                contractRenewal: 'Annual (calendar or fiscal year)',
                keyEvents: [
                    { name: 'Dealmakers Conference', month: 3, type: 'trade_show' },
                    { name: 'Year-end deal closings', month: 12, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '6-12 weeks from first meeting'
            }
        },
        'Financial Advisory': {
            decisionMakers: ['Principal', 'Lead Advisor', 'Practice Manager'],
            painPoints: [
                'AUM growth and client acquisition',
                'Fee compression pressure',
                'Compliance and fiduciary requirements',
                'Technology integration'
            ],
            primaryKPIs: ['AUM', 'Revenue per advisor', 'Client retention', 'New assets flow', 'Client satisfaction'],
            topChannels: ['Client referrals', 'COI networks (CPAs, attorneys)', 'LinkedIn', 'Seminars/webinars', 'Content marketing'],
            prospecting: {
                bestMonths: [1, 2, 5, 9],
                bestMonthsLabel: 'January-February, May, September',
                reasoning: 'New year financial planning rush; post-tax season; fall planning season',
                worstMonths: [4, 7, 12],
                worstReason: 'Tax season referrals peak, summer vacations, and year-end portfolio management',
                buyerMindset: 'Growing AUM through client acquisition and COI referral networks',
                approachTip: 'Show how online reputation drives referral confidence from COI networks'
            },
            calendar: {
                buyingCycle: 'Annual (Q4 practice management review)',
                contractRenewal: 'Annual from sign date',
                keyEvents: [
                    { name: 'FPA Annual Conference', month: 10, type: 'trade_show' },
                    { name: 'Tax season referral peak', month: 3, type: 'buying_cycle' },
                    { name: 'Year-end portfolio reviews', month: 11, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '4-6 weeks from first meeting'
            }
        },
        'Payment Processing': {
            decisionMakers: ['CEO', 'VP Sales', 'Head of Partnerships', 'Product Manager'],
            painPoints: [
                'Merchant churn and pricing pressure',
                'Fraud and risk management',
                'Integration complexity',
                'Regulatory compliance'
            ],
            primaryKPIs: ['Payment volume', 'Merchant count', 'Churn rate', 'Revenue per merchant', 'Fraud rate'],
            topChannels: ['ISV/software partnerships', 'Direct sales', 'Reseller channels', 'Trade shows', 'Digital marketing'],
            prospecting: {
                bestMonths: [1, 2, 9, 10],
                bestMonthsLabel: 'January-February, September-October',
                reasoning: 'Q1 merchant acquisition push and Q4 partnership planning',
                worstMonths: [11, 12],
                worstReason: 'Holiday transaction processing peaks demand all operational focus',
                buyerMindset: 'Reducing merchant churn and building ISV partnership pipeline',
                approachTip: 'Demonstrate how merchant review management reduces churn risk'
            },
            calendar: {
                buyingCycle: 'Annual (Q4 planning for Q1 execution)',
                contractRenewal: 'Annual (varies by partnership)',
                keyEvents: [
                    { name: 'Money20/20', month: 10, type: 'trade_show' },
                    { name: 'ETA TransACT', month: 4, type: 'trade_show' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '4-8 weeks from first meeting'
            }
        }
    },

    // ============================================
    // MANUFACTURING
    // ============================================
    'Manufacturing': {
        default: {
            decisionMakers: ['Owner', 'Plant Manager', 'Operations Director', 'Purchasing Manager'],
            painPoints: [
                'Supply chain disruptions',
                'Labor shortage and retention',
                'Equipment maintenance and downtime',
                'Raw material cost volatility'
            ],
            primaryKPIs: ['OEE (Overall Equipment Effectiveness)', 'On-time delivery', 'Defect rate', 'Inventory turns'],
            topChannels: ['Trade shows', 'Industry associations', 'Manufacturer reps', 'Direct sales', 'LinkedIn'],
            prospecting: {
                bestMonths: [1, 2, 9, 10],
                bestMonthsLabel: 'January-February, September-October',
                reasoning: 'Q1 capital budget execution and Q4 planning for next-year investments',
                worstMonths: [6, 7, 12],
                worstReason: 'Peak production periods and year-end inventory management',
                buyerMindset: 'Evaluating operational tools and vendor relationships for the year',
                approachTip: 'Lead with credibility building for attracting new B2B customers'
            },
            calendar: {
                buyingCycle: 'Annual (Q4 capital budget planning)',
                contractRenewal: 'Annual (fiscal year)',
                keyEvents: [
                    { name: 'IMTS (International Manufacturing Technology Show)', month: 9, type: 'trade_show' },
                    { name: 'Q1 capital budget execution', month: 1, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [9, 10, 11],
                decisionTimeline: '6-12 weeks from first meeting'
            }
        },
        'Machine Shop': {
            decisionMakers: ['Owner', 'Shop Manager', 'Lead Machinist'],
            painPoints: [
                'Skilled machinist shortage',
                'Quoting accuracy and speed',
                'Machine utilization optimization',
                'Quality control consistency'
            ],
            primaryKPIs: ['Machine utilization', 'Quote-to-order rate', 'Scrap rate', 'On-time delivery'],
            topChannels: ['Referrals', 'Industry directories', 'Trade shows', 'Google Business Profile', 'LinkedIn'],
            prospecting: {
                bestMonths: [1, 2, 10],
                bestMonthsLabel: 'January-February, October',
                reasoning: 'New year planning and Q4 customer relationship building',
                worstMonths: [6, 7],
                worstReason: 'Peak production backlogs demand full shop attention',
                buyerMindset: 'Looking to attract new customers and improve quote-to-order rates',
                approachTip: 'Show how online presence and reviews attract new B2B quoting opportunities'
            },
            calendar: {
                buyingCycle: 'Annual (Q1 planning)',
                contractRenewal: 'Annual from sign date',
                keyEvents: [
                    { name: 'IMTS', month: 9, type: 'trade_show' },
                    { name: 'EASTEC/WESTEC regional shows', month: 5, type: 'trade_show' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '2-4 weeks from first meeting'
            }
        },
        'Industrial Equipment': {
            decisionMakers: ['VP Manufacturing', 'Plant Manager', 'Maintenance Director', 'Purchasing'],
            painPoints: [
                'Long sales cycles (6-18 months)',
                'Technical specification complexity',
                'Installation and commissioning',
                'After-sales service requirements'
            ],
            primaryKPIs: ['Backlog', 'Order-to-cash cycle', 'Service revenue %', 'Customer lifetime value'],
            topChannels: ['Trade shows', 'Direct sales', 'Manufacturer reps', 'Industry publications', 'Technical webinars'],
            prospecting: {
                bestMonths: [1, 2, 9, 10],
                bestMonthsLabel: 'January-February, September-October',
                reasoning: 'Capital budget cycles align with Q1 execution and Q4 planning',
                worstMonths: [7, 8, 12],
                worstReason: 'Plant shutdowns for maintenance and year-end capital freeze',
                buyerMindset: 'Building pipeline and improving brand credibility for long sales cycles',
                approachTip: 'Emphasize how strong online presence shortens enterprise sales cycles'
            },
            calendar: {
                buyingCycle: 'Annual (aligned with customer capital budgets)',
                contractRenewal: 'Annual (varies by contract)',
                keyEvents: [
                    { name: 'IMTS', month: 9, type: 'trade_show' },
                    { name: 'Pack Expo', month: 10, type: 'trade_show' }
                ],
                budgetPlanningMonths: [9, 10, 11],
                decisionTimeline: '8-16 weeks from first meeting'
            }
        },
        'Food Manufacturing': {
            decisionMakers: ['Owner', 'Production Manager', 'Quality Manager', 'Purchasing Director'],
            painPoints: [
                'Food safety and compliance',
                'Ingredient cost volatility',
                'Shelf life and freshness',
                'Retail/distributor requirements'
            ],
            primaryKPIs: ['Yield', 'Compliance audit scores', 'Customer complaints', 'Production efficiency'],
            topChannels: ['Food industry trade shows', 'Broker/distributor networks', 'Industry certifications', 'Buyer outreach'],
            prospecting: {
                bestMonths: [1, 2, 6],
                bestMonthsLabel: 'January-February, June',
                reasoning: 'Post-holiday production lull and mid-year retailer planning windows',
                worstMonths: [9, 10, 11],
                worstReason: 'Holiday production ramp-up demands full plant capacity',
                buyerMindset: 'Building retailer relationships and improving brand credibility',
                approachTip: 'Show how B2B reputation management attracts distributor partnerships'
            },
            calendar: {
                buyingCycle: 'Annual (aligned with retail buyer cycles)',
                contractRenewal: 'Annual (varies by distributor agreement)',
                keyEvents: [
                    { name: 'Natural Products Expo West', month: 3, type: 'trade_show' },
                    { name: 'IFT Annual Meeting', month: 7, type: 'trade_show' },
                    { name: 'Holiday production planning', month: 7, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [9, 10, 11],
                decisionTimeline: '4-8 weeks from first meeting'
            }
        },
        'General Manufacturing': {
            decisionMakers: ['Owner', 'General Manager', 'Production Supervisor'],
            painPoints: [
                'Capacity planning and utilization',
                'Quality consistency',
                'Workforce training',
                'Lean implementation'
            ],
            primaryKPIs: ['Production volume', 'Defect rate', 'Labor productivity', 'Inventory turns'],
            topChannels: ['Trade associations', 'B2B directories', 'Referrals', 'Industry publications'],
            prospecting: {
                bestMonths: [1, 2, 10],
                bestMonthsLabel: 'January-February, October',
                reasoning: 'Q1 planning for new customer acquisition and Q4 budget setting',
                worstMonths: [6, 7, 12],
                worstReason: 'Peak production periods and year-end slowdowns',
                buyerMindset: 'Growing customer base and improving market visibility',
                approachTip: 'Lead with B2B directory presence and reputation management for new customer acquisition'
            },
            calendar: {
                buyingCycle: 'Annual (Q4 budget planning)',
                contractRenewal: 'Annual from sign date',
                keyEvents: [
                    { name: 'IMTS', month: 9, type: 'trade_show' },
                    { name: 'Regional manufacturing expos', month: 3, type: 'trade_show' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '4-6 weeks from first meeting'
            }
        }
    },

    // ============================================
    // TRANSPORTATION & LOGISTICS
    // ============================================
    'Transportation & Logistics': {
        default: {
            decisionMakers: ['Owner', 'Operations Manager', 'Fleet Manager', 'Logistics Director'],
            painPoints: [
                'Driver shortage and retention',
                'Fuel cost volatility',
                'Route optimization',
                'Regulatory compliance (DOT, HOS)'
            ],
            primaryKPIs: ['On-time delivery', 'Cost per mile', 'Fleet utilization', 'Driver retention'],
            topChannels: ['Load boards', 'Broker relationships', 'Direct shipper contracts', 'Industry associations'],
            prospecting: {
                bestMonths: [1, 2, 9],
                bestMonthsLabel: 'January-February, September',
                reasoning: 'Post-holiday shipping lull and pre-peak season planning create evaluation windows',
                worstMonths: [10, 11, 12],
                worstReason: 'Peak shipping season (holidays) demands total operational focus',
                buyerMindset: 'Planning for capacity, seeking shipper relationships and brand visibility',
                approachTip: 'Show how online reputation and reviews attract direct shipper contracts'
            },
            calendar: {
                buyingCycle: 'Annual (Q1 planning)',
                contractRenewal: 'Annual (varies by shipper contract)',
                keyEvents: [
                    { name: 'MATS (Mid-America Trucking Show)', month: 3, type: 'trade_show' },
                    { name: 'Peak shipping season prep', month: 9, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '4-6 weeks from first meeting'
            }
        },
        'Commercial Aviation': {
            decisionMakers: ['CEO', 'VP Operations', 'Chief Commercial Officer', 'Revenue Management'],
            painPoints: [
                'Fuel cost hedging',
                'Route profitability optimization',
                'Customer experience differentiation',
                'Regulatory compliance'
            ],
            primaryKPIs: ['Load factor', 'Revenue per available seat mile', 'On-time performance', 'Customer satisfaction'],
            topChannels: ['GDS systems', 'OTAs', 'Loyalty programs', 'Corporate contracts', 'Direct booking'],
            prospecting: {
                bestMonths: [1, 2, 9],
                bestMonthsLabel: 'January-February, September',
                reasoning: 'Post-holiday evaluation and pre-Q4 corporate travel contract planning',
                worstMonths: [6, 7, 12],
                worstReason: 'Peak summer travel and holiday season demand all operational resources',
                buyerMindset: 'Focused on customer experience and loyalty program engagement',
                approachTip: 'Lead with customer satisfaction and review management for loyalty retention'
            },
            calendar: {
                buyingCycle: 'Annual (Q4 planning)',
                contractRenewal: 'Annual (fiscal year)',
                keyEvents: [
                    { name: 'World Aviation Festival', month: 10, type: 'trade_show' },
                    { name: 'IATA Annual General Meeting', month: 6, type: 'trade_show' }
                ],
                budgetPlanningMonths: [9, 10, 11],
                decisionTimeline: '8-16 weeks from first meeting'
            }
        },
        'Charter Aviation': {
            decisionMakers: ['Owner/Operator', 'Director of Operations', 'Sales Director'],
            painPoints: [
                'Aircraft utilization optimization',
                'Empty leg revenue',
                'Customer experience consistency',
                'Safety and maintenance compliance'
            ],
            primaryKPIs: ['Flight hours', 'Utilization rate', 'Revenue per flight hour', 'Customer repeat rate'],
            topChannels: ['Charter brokers', 'High-net-worth networks', 'Corporate travel managers', 'Referrals', 'Jet card programs'],
            prospecting: {
                bestMonths: [1, 2, 9],
                bestMonthsLabel: 'January-February, September',
                reasoning: 'Post-holiday travel lull and pre-Q4 corporate travel planning',
                worstMonths: [6, 7, 12],
                worstReason: 'Peak charter demand for summer vacations and holiday travel',
                buyerMindset: 'Building repeat customer base and improving broker relationships',
                approachTip: 'Emphasize how reputation and reviews drive high-net-worth referrals'
            },
            calendar: {
                buyingCycle: 'Annual (Q1 and Q3 evaluation)',
                contractRenewal: 'Annual (jet card and corporate contracts)',
                keyEvents: [
                    { name: 'NBAA-BACE', month: 10, type: 'trade_show' },
                    { name: 'Corporate travel planning season', month: 9, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '4-8 weeks from first meeting'
            }
        },
        'Aviation Services': {
            decisionMakers: ['General Manager', 'Operations Director', 'FBO Manager', 'Maintenance Director'],
            painPoints: [
                'Competition for based aircraft',
                'Service consistency and speed',
                'Hangar capacity utilization',
                'Fuel margin pressure'
            ],
            primaryKPIs: ['Fuel volume', 'Based aircraft count', 'Ramp transactions', 'Customer satisfaction'],
            topChannels: ['Aviation directories', 'Airport relationships', 'Trade shows', 'Direct pilot outreach', 'ForeFlight/aviation apps'],
            prospecting: {
                bestMonths: [1, 2, 9, 10],
                bestMonthsLabel: 'January-February, September-October',
                reasoning: 'Post-holiday slowdown and pre-peak planning for hangar and fuel contracts',
                worstMonths: [6, 7],
                worstReason: 'Peak flying season keeps FBO ramps and MRO bays at maximum capacity',
                buyerMindset: 'Attracting based aircraft and building pilot loyalty through service reputation',
                approachTip: 'Show how FBO reviews on aviation platforms drive based aircraft decisions'
            },
            calendar: {
                buyingCycle: 'Annual (Q1 contract renewals)',
                contractRenewal: 'Q1 (January-March for hangar leases)',
                keyEvents: [
                    { name: 'NBAA-BACE', month: 10, type: 'trade_show' },
                    { name: 'Sun \'n Fun Aerospace Expo', month: 4, type: 'trade_show' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '4-6 weeks from first meeting'
            }
        },
        'Freight & Trucking': {
            decisionMakers: ['Owner', 'Dispatcher', 'Fleet Manager', 'Safety Director'],
            painPoints: [
                'Driver recruitment and retention',
                'Fuel cost management',
                'Load optimization',
                'Equipment maintenance'
            ],
            primaryKPIs: ['Revenue per truck', 'Miles per gallon', 'Driver turnover', 'On-time delivery %'],
            topChannels: ['Load boards (DAT, Truckstop)', 'Broker relationships', '3PL partnerships', 'Shipper direct contracts'],
            prospecting: {
                bestMonths: [1, 2, 3],
                bestMonthsLabel: 'January-March',
                reasoning: 'Post-peak season evaluation; planning equipment and marketing for the year',
                worstMonths: [10, 11, 12],
                worstReason: 'Peak freight season (holidays) demands all trucks and dispatchers',
                buyerMindset: 'Seeking direct shipper relationships and improving company reputation',
                approachTip: 'Show how reviews and reputation attract direct shipper contracts over load boards'
            },
            calendar: {
                buyingCycle: 'Annual (Q1 planning)',
                contractRenewal: 'Annual (shipper bid season varies)',
                keyEvents: [
                    { name: 'MATS', month: 3, type: 'trade_show' },
                    { name: 'TMC Annual Meeting', month: 3, type: 'trade_show' },
                    { name: 'Peak freight season', month: 10, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [11, 12, 1],
                decisionTimeline: '2-4 weeks from first meeting'
            }
        },
        'Warehousing': {
            decisionMakers: ['Owner', 'General Manager', 'Operations Director', 'Business Development'],
            painPoints: [
                'Space utilization optimization',
                'Labor availability and cost',
                'Inventory accuracy',
                'Technology integration (WMS)'
            ],
            primaryKPIs: ['Utilization rate', 'Order accuracy', 'Throughput per hour', 'Cost per pallet'],
            topChannels: ['3PL RFPs', 'Freight broker partnerships', 'Commercial real estate networks', 'Industry associations'],
            prospecting: {
                bestMonths: [1, 2, 3],
                bestMonthsLabel: 'January-March',
                reasoning: 'Post-peak season capacity review and new customer prospecting',
                worstMonths: [10, 11, 12],
                worstReason: 'Holiday inventory surge fills all available space and staff bandwidth',
                buyerMindset: 'Filling excess capacity and building 3PL client relationships',
                approachTip: 'Emphasize how online reputation drives RFP wins and client acquisition'
            },
            calendar: {
                buyingCycle: 'Annual (Q1 evaluation)',
                contractRenewal: 'Annual (varies by 3PL agreement)',
                keyEvents: [
                    { name: 'MODEX/ProMat', month: 3, type: 'trade_show' },
                    { name: 'Holiday inventory prep', month: 8, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '4-8 weeks from first meeting'
            }
        }
    },

    // ============================================
    // ENERGY & UTILITIES
    // ============================================
    'Energy & Utilities': {
        default: {
            decisionMakers: ['CEO', 'VP Operations', 'Director of Engineering', 'Regulatory Affairs'],
            painPoints: [
                'Regulatory compliance complexity',
                'Infrastructure aging and investment',
                'Renewable energy transition',
                'Customer rate pressure'
            ],
            primaryKPIs: ['Reliability (SAIDI/SAIFI)', 'Cost per kWh', 'Customer satisfaction', 'Renewable mix %'],
            topChannels: ['Regulatory proceedings', 'Industry associations', 'Community relations', 'Government affairs'],
            prospecting: {
                bestMonths: [1, 2, 3],
                bestMonthsLabel: 'January-March',
                reasoning: 'New fiscal year budget execution and regulatory planning cycles',
                worstMonths: [6, 7, 8],
                worstReason: 'Peak demand season (summer cooling) requires full operational focus',
                buyerMindset: 'Evaluating customer engagement tools and community relations improvements',
                approachTip: 'Lead with customer satisfaction improvement and community trust building'
            },
            calendar: {
                buyingCycle: 'Annual (regulatory calendar driven)',
                contractRenewal: 'Annual (fiscal year, often July or January)',
                keyEvents: [
                    { name: 'DistribuTECH', month: 2, type: 'trade_show' },
                    { name: 'EEI Annual Convention', month: 6, type: 'trade_show' }
                ],
                budgetPlanningMonths: [9, 10, 11],
                decisionTimeline: '8-16 weeks from first meeting'
            }
        },
        'Power Generation': {
            decisionMakers: ['Plant Manager', 'VP Generation', 'Chief Operating Officer'],
            painPoints: [
                'Capacity factor optimization',
                'Fuel cost and procurement',
                'Environmental compliance',
                'Grid integration'
            ],
            primaryKPIs: ['Capacity factor', 'Heat rate', 'Forced outage rate', 'Emissions compliance'],
            topChannels: ['Utility RFPs', 'PPA negotiations', 'Industry conferences', 'Government incentive programs'],
            prospecting: {
                bestMonths: [1, 2, 3, 10],
                bestMonthsLabel: 'January-March, October',
                reasoning: 'Shoulder seasons between peak generation allow strategic planning',
                worstMonths: [6, 7, 8],
                worstReason: 'Peak generation demand requires full plant operational focus',
                buyerMindset: 'Building industry credibility and improving stakeholder communications',
                approachTip: 'Emphasize stakeholder trust and community relations reputation management'
            },
            calendar: {
                buyingCycle: 'Annual (regulatory and budget driven)',
                contractRenewal: 'Annual (fiscal year)',
                keyEvents: [
                    { name: 'POWERGEN International', month: 1, type: 'trade_show' },
                    { name: 'PPA negotiation season', month: 9, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [9, 10, 11],
                decisionTimeline: '8-16 weeks from first meeting'
            }
        },
        'Utility Construction': {
            decisionMakers: ['Owner', 'Project Manager', 'Business Development Director'],
            painPoints: [
                'Project bidding and win rate',
                'Skilled labor availability',
                'Safety compliance',
                'Material cost volatility'
            ],
            primaryKPIs: ['Backlog', 'Project margin', 'Safety incident rate', 'On-time completion'],
            topChannels: ['Utility procurement portals', 'Industry relationships', 'Trade associations', 'Bonding/insurance networks'],
            prospecting: {
                bestMonths: [1, 2, 10, 11],
                bestMonthsLabel: 'January-February, October-November',
                reasoning: 'Pre-construction season planning and Q4 bid pipeline development',
                worstMonths: [5, 6, 7],
                worstReason: 'Peak construction season with full project crews deployed',
                buyerMindset: 'Building bid pipeline and improving win rates through credibility',
                approachTip: 'Show how safety records and reviews improve bid competitiveness'
            },
            calendar: {
                buyingCycle: 'Annual (bid calendar driven)',
                contractRenewal: 'Project-based',
                keyEvents: [
                    { name: 'DistribuTECH', month: 2, type: 'trade_show' },
                    { name: 'Construction season kick-off', month: 3, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '4-8 weeks from first meeting'
            }
        },
        'Water Utilities': {
            decisionMakers: ['General Manager', 'Director of Operations', 'Chief Engineer'],
            painPoints: [
                'Infrastructure replacement funding',
                'Water loss reduction',
                'Regulatory compliance (EPA, state)',
                'Rate case management'
            ],
            primaryKPIs: ['Non-revenue water %', 'Compliance status', 'Customer satisfaction', 'O&M cost per MG'],
            topChannels: ['AWWA conferences', 'State regulatory filings', 'Municipal associations', 'Engineering consultants'],
            prospecting: {
                bestMonths: [1, 2, 3],
                bestMonthsLabel: 'January-March',
                reasoning: 'New fiscal year budget execution and infrastructure planning',
                worstMonths: [6, 7, 8],
                worstReason: 'Peak water demand season requires full operational attention',
                buyerMindset: 'Focused on customer communication and rate case public relations',
                approachTip: 'Position around customer communication and public trust during rate cases'
            },
            calendar: {
                buyingCycle: 'Annual (municipal budget cycle)',
                contractRenewal: 'Annual (fiscal year)',
                keyEvents: [
                    { name: 'AWWA Annual Conference', month: 6, type: 'trade_show' },
                    { name: 'Rate case filing season', month: 3, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [9, 10, 11],
                decisionTimeline: '8-16 weeks from first meeting'
            }
        }
    },

    // ============================================
    // AGRICULTURE
    // ============================================
    'Agriculture': {
        default: {
            decisionMakers: ['Owner/Operator', 'Farm Manager', 'Operations Manager'],
            painPoints: [
                'Weather and climate risk',
                'Commodity price volatility',
                'Labor availability',
                'Input cost management'
            ],
            primaryKPIs: ['Yield per acre', 'Cost per bushel', 'Revenue per acre', 'Operating margin'],
            topChannels: ['Co-ops', 'Ag retailers', 'Farm shows', 'Industry publications', 'Direct buyer relationships'],
            prospecting: {
                bestMonths: [11, 12, 1, 2],
                bestMonthsLabel: 'November-February',
                reasoning: 'Post-harvest and winter planning season gives operators time for business decisions',
                worstMonths: [4, 5, 6, 9, 10],
                worstReason: 'Planting season (spring) and harvest season (fall) consume all attention',
                buyerMindset: 'Planning next season inputs, evaluating vendor relationships',
                approachTip: 'Position around market visibility for direct-to-consumer or agritourism'
            },
            calendar: {
                buyingCycle: 'Annual (winter planning for spring)',
                contractRenewal: 'Q1 (January-February for input contracts)',
                keyEvents: [
                    { name: 'Commodity Classic', month: 3, type: 'trade_show' },
                    { name: 'Winter planning season', month: 12, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [11, 12, 1],
                decisionTimeline: '4-8 weeks from first meeting'
            }
        },
        'Crop Farming': {
            decisionMakers: ['Owner', 'Farm Manager', 'Agronomist'],
            painPoints: [
                'Weather dependency and risk',
                'Input cost management (seed, fertilizer)',
                'Land cost and availability',
                'Technology adoption (precision ag)'
            ],
            primaryKPIs: ['Yield per acre', 'Input cost per acre', 'Net margin per acre', 'Land productivity'],
            topChannels: ['Grain elevators', 'Co-op relationships', 'Farm shows', 'Ag retailers', 'Direct contracts'],
            prospecting: {
                bestMonths: [12, 1, 2],
                bestMonthsLabel: 'December-February',
                reasoning: 'Post-harvest evaluation and winter planning for next growing season',
                worstMonths: [4, 5, 9, 10],
                worstReason: 'Planting and harvest seasons are all-consuming',
                buyerMindset: 'Evaluating input suppliers and marketing channels for crop sales',
                approachTip: 'Focus on direct buyer relationships and farm brand visibility'
            },
            calendar: {
                buyingCycle: 'Annual (winter planning)',
                contractRenewal: 'Q1 (January-February)',
                keyEvents: [
                    { name: 'Commodity Classic', month: 3, type: 'trade_show' },
                    { name: 'Farm Progress Show', month: 8, type: 'trade_show' }
                ],
                budgetPlanningMonths: [11, 12, 1],
                decisionTimeline: '4-6 weeks from first meeting'
            }
        },
        'Livestock': {
            decisionMakers: ['Owner', 'Herd Manager', 'Operations Manager'],
            painPoints: [
                'Feed cost volatility',
                'Animal health and biosecurity',
                'Market price fluctuations',
                'Regulatory compliance'
            ],
            primaryKPIs: ['Feed conversion ratio', 'Average daily gain', 'Mortality rate', 'Revenue per head'],
            topChannels: ['Auction markets', 'Processor contracts', 'Breed associations', 'Veterinary networks'],
            prospecting: {
                bestMonths: [11, 12, 1, 2],
                bestMonthsLabel: 'November-February',
                reasoning: 'Post-market season evaluation and winter planning for next year',
                worstMonths: [4, 5, 9, 10],
                worstReason: 'Spring calving/lambing and fall market season demand full attention',
                buyerMindset: 'Building direct-to-consumer channels and breed reputation',
                approachTip: 'Show how online presence drives direct buyer relationships and premium pricing'
            },
            calendar: {
                buyingCycle: 'Annual (winter planning)',
                contractRenewal: 'Q1 (processor contracts)',
                keyEvents: [
                    { name: 'National Western Stock Show', month: 1, type: 'trade_show' },
                    { name: 'Fall market season', month: 9, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [11, 12, 1],
                decisionTimeline: '4-6 weeks from first meeting'
            }
        },
        'Forestry': {
            decisionMakers: ['Owner', 'Forest Manager', 'Operations Supervisor'],
            painPoints: [
                'Long growth cycles and planning',
                'Timber price volatility',
                'Environmental regulations',
                'Fire and pest risk'
            ],
            primaryKPIs: ['Board feet per acre', 'Stumpage value', 'Regeneration success rate', 'Operating cost per acre'],
            topChannels: ['Timber buyers', 'Forest product mills', 'Consulting foresters', 'Conservation programs'],
            prospecting: {
                bestMonths: [1, 2, 3],
                bestMonthsLabel: 'January-March',
                reasoning: 'Pre-harvest season planning and timber contract negotiations',
                worstMonths: [7, 8, 9],
                worstReason: 'Peak harvest season and fire risk management',
                buyerMindset: 'Planning harvest schedules and building buyer relationships',
                approachTip: 'Position around timber buyer relationships and sustainable forestry reputation'
            },
            calendar: {
                buyingCycle: 'Annual (pre-harvest planning)',
                contractRenewal: 'Annual (timber sale contracts)',
                keyEvents: [
                    { name: 'Logging conference/Timber Expo', month: 9, type: 'trade_show' },
                    { name: 'Timber sale season', month: 4, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [11, 12, 1],
                decisionTimeline: '4-8 weeks from first meeting'
            }
        }
    },

    // ============================================
    // COMMERCIAL REAL ESTATE
    // ============================================
    'Commercial Real Estate': {
        default: {
            decisionMakers: ['Owner', 'Asset Manager', 'Property Manager', 'Leasing Director'],
            painPoints: [
                'Vacancy and tenant turnover',
                'Property maintenance costs',
                'Market value fluctuations',
                'Tenant credit quality'
            ],
            primaryKPIs: ['Occupancy rate', 'NOI', 'Cap rate', 'Tenant retention', 'Rent collection rate'],
            topChannels: ['CoStar/LoopNet', 'Broker relationships', 'Industry associations', 'Direct tenant outreach'],
            prospecting: {
                bestMonths: [1, 2, 9, 10],
                bestMonthsLabel: 'January-February, September-October',
                reasoning: 'Q1 leasing push and Q4 budget planning for property improvements',
                worstMonths: [7, 8, 12],
                worstReason: 'Summer vacation season and year-end lease closings limit availability',
                buyerMindset: 'Focused on occupancy rates and tenant acquisition strategies',
                approachTip: 'Show how property reputation and online presence drive tenant inquiries'
            },
            calendar: {
                buyingCycle: 'Annual (Q4 budget for next year)',
                contractRenewal: 'Annual (calendar year)',
                keyEvents: [
                    { name: 'ICSC conferences', month: 5, type: 'trade_show' },
                    { name: 'BOMA International conference', month: 6, type: 'trade_show' },
                    { name: 'Q1 leasing push', month: 1, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [9, 10, 11],
                decisionTimeline: '6-10 weeks from first meeting'
            }
        },
        'Commercial Property': {
            decisionMakers: ['Owner', 'Asset Manager', 'VP Leasing', 'Development Director'],
            painPoints: [
                'Lease-up velocity',
                'Tenant mix optimization',
                'Capital expenditure planning',
                'Market repositioning'
            ],
            primaryKPIs: ['Occupancy', 'Effective rent per SF', 'Tenant improvement costs', 'Lease term length'],
            topChannels: ['CRE brokers', 'CoStar/LoopNet', 'Industry events', 'Tenant rep relationships', 'Direct outreach'],
            prospecting: {
                bestMonths: [1, 2, 9, 10],
                bestMonthsLabel: 'January-February, September-October',
                reasoning: 'Annual leasing strategy planning and Q4 capex budget allocation',
                worstMonths: [7, 8, 12],
                worstReason: 'Summer slowdown and year-end deal closings',
                buyerMindset: 'Improving lease-up velocity and property market positioning',
                approachTip: 'Emphasize how online property reputation accelerates lease-up timelines'
            },
            calendar: {
                buyingCycle: 'Annual (Q4 budget planning)',
                contractRenewal: 'Annual (calendar year)',
                keyEvents: [
                    { name: 'ICSC conferences', month: 5, type: 'trade_show' },
                    { name: 'Q4 lease negotiation season', month: 10, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [9, 10, 11],
                decisionTimeline: '6-10 weeks from first meeting'
            }
        },
        'Property Management': {
            decisionMakers: ['Owner', 'Regional Manager', 'Property Manager', 'Maintenance Director'],
            painPoints: [
                'Tenant satisfaction and retention',
                'Maintenance cost control',
                'Vendor management',
                'Technology adoption'
            ],
            primaryKPIs: ['Tenant retention rate', 'Response time to requests', 'Operating expense ratio', 'Collections rate'],
            topChannels: ['Owner referrals', 'Industry associations (IREM, BOMA)', 'Commercial broker networks', 'LinkedIn'],
            prospecting: {
                bestMonths: [1, 2, 9, 10],
                bestMonthsLabel: 'January-February, September-October',
                reasoning: 'New year property management contract evaluations and Q4 RFP season',
                worstMonths: [7, 8, 12],
                worstReason: 'Summer turnover season and year-end accounting demand full attention',
                buyerMindset: 'Growing property portfolio and improving tenant satisfaction metrics',
                approachTip: 'Show how tenant review management improves retention and attracts new owners'
            },
            calendar: {
                buyingCycle: 'Annual (Q4 planning)',
                contractRenewal: 'Annual (calendar year)',
                keyEvents: [
                    { name: 'IREM annual conference', month: 10, type: 'trade_show' },
                    { name: 'Lease renewal season', month: 1, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [9, 10, 11],
                decisionTimeline: '4-8 weeks from first meeting'
            }
        }
    },

    // ============================================
    // EDUCATION & TRAINING
    // ============================================
    'Education & Training': {
        default: {
            decisionMakers: ['President/Dean', 'Director of Admissions', 'Marketing Director', 'Program Director'],
            painPoints: [
                'Enrollment and retention',
                'Online competition',
                'Student outcome metrics',
                'Marketing cost per enrollment'
            ],
            primaryKPIs: ['Enrollment', 'Retention rate', 'Graduation rate', 'Job placement rate', 'Cost per enrollment'],
            topChannels: ['SEO/SEM', 'Social media', 'High school counselors', 'Employer partnerships', 'Alumni networks'],
            prospecting: {
                bestMonths: [2, 3, 10, 11],
                bestMonthsLabel: 'February-March, October-November',
                reasoning: 'Post-enrollment evaluation periods and budget planning for next enrollment cycle',
                worstMonths: [8, 9, 1],
                worstReason: 'Back-to-school enrollment rush and January spring semester start',
                buyerMindset: 'Evaluating marketing effectiveness and cost per enrollment',
                approachTip: 'Lead with review impact on prospective student enrollment decisions'
            },
            calendar: {
                buyingCycle: 'Academic year (July-June typically)',
                contractRenewal: 'Annual (fiscal year, often July)',
                keyEvents: [
                    { name: 'Fall enrollment deadline', month: 8, type: 'buying_cycle' },
                    { name: 'Spring enrollment push', month: 11, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [3, 4, 5],
                decisionTimeline: '6-10 weeks from first meeting'
            }
        },
        'Higher Education': {
            decisionMakers: ['President', 'VP Enrollment', 'Director of Marketing', 'Department Chair'],
            painPoints: [
                'Enrollment decline trends',
                'Online education competition',
                'Student debt concerns',
                'Employer relevance of programs'
            ],
            primaryKPIs: ['Applications', 'Yield rate', 'Retention', 'Graduation rate', 'Employment outcomes'],
            topChannels: ['College fairs', 'High school visits', 'Digital marketing', 'Alumni networks', 'Athletic programs'],
            prospecting: {
                bestMonths: [2, 3, 10, 11],
                bestMonthsLabel: 'February-March, October-November',
                reasoning: 'Post-admissions cycle evaluation and fall budget planning windows',
                worstMonths: [8, 9, 5],
                worstReason: 'Fall semester start and May commencement consume all administrative focus',
                buyerMindset: 'Combating enrollment decline with improved online reputation and visibility',
                approachTip: 'Show how reviews and reputation influence prospective student decisions'
            },
            calendar: {
                buyingCycle: 'Academic year (July-June)',
                contractRenewal: 'Annual (July fiscal year start)',
                keyEvents: [
                    { name: 'NACAC conference', month: 9, type: 'trade_show' },
                    { name: 'Application season', month: 11, type: 'buying_cycle' },
                    { name: 'Yield season', month: 4, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [3, 4, 5],
                decisionTimeline: '8-12 weeks from first meeting'
            }
        },
        'Corporate Training': {
            decisionMakers: ['CEO', 'VP Sales', 'Training Director', 'Business Development'],
            painPoints: [
                'Proving ROI to clients',
                'Customization vs. scalability',
                'Trainer retention',
                'Competition from internal L&D teams'
            ],
            primaryKPIs: ['Revenue per trainer', 'Client retention', 'NPS scores', 'Utilization rate'],
            topChannels: ['HR/L&D conferences', 'LinkedIn', 'Content marketing', 'Referrals', 'Industry partnerships'],
            prospecting: {
                bestMonths: [1, 2, 9, 10],
                bestMonthsLabel: 'January-February, September-October',
                reasoning: 'Q1 L&D budget execution and Q4 training budget planning for next year',
                worstMonths: [7, 8, 12],
                worstReason: 'Summer training lull and holiday season reduce decision-making',
                buyerMindset: 'Building credibility to win corporate L&D contracts over internal teams',
                approachTip: 'Emphasize testimonials and case studies as proof of training ROI'
            },
            calendar: {
                buyingCycle: 'Annual (Q4 L&D budget planning)',
                contractRenewal: 'Annual (calendar year)',
                keyEvents: [
                    { name: 'ATD Conference', month: 5, type: 'trade_show' },
                    { name: 'Q1 training kickoff season', month: 1, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [9, 10, 11],
                decisionTimeline: '4-6 weeks from first meeting'
            }
        },
        'Specialty Training': {
            decisionMakers: ['Owner', 'Director', 'Program Manager'],
            painPoints: [
                'Student acquisition cost',
                'Seasonal enrollment patterns',
                'Instructor quality and retention',
                'Certification requirements'
            ],
            primaryKPIs: ['Enrollments', 'Completion rate', 'Certification pass rate', 'Revenue per student'],
            topChannels: ['Google ads', 'Local SEO', 'Social media', 'Employer partnerships', 'Community outreach'],
            prospecting: {
                bestMonths: [1, 5, 9],
                bestMonthsLabel: 'January, May, September',
                reasoning: 'Enrollment cycle transitions create evaluation windows between cohorts',
                worstMonths: [3, 4, 11],
                worstReason: 'Mid-cohort delivery periods demand full instructor and staff attention',
                buyerMindset: 'Reducing student acquisition costs and building enrollment pipeline',
                approachTip: 'Show how reviews and certification pass rates drive enrollment decisions'
            },
            calendar: {
                buyingCycle: 'Semi-annual (between enrollment cycles)',
                contractRenewal: 'Annual from sign date',
                keyEvents: [
                    { name: 'Spring enrollment cycle', month: 1, type: 'buying_cycle' },
                    { name: 'Fall enrollment cycle', month: 8, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '2-4 weeks from first meeting'
            }
        }
    },

    // ============================================
    // OTHER (Custom Industries)
    // ============================================
    'Other': {
        default: {
            decisionMakers: ['Owner', 'General Manager', 'Operations Manager', 'Marketing Lead'],
            painPoints: [
                'Customer acquisition and retention',
                'Competitive differentiation',
                'Operational efficiency',
                'Market visibility'
            ],
            primaryKPIs: ['Revenue growth', 'Customer count', 'Profit margin', 'Customer satisfaction'],
            topChannels: ['Google Business Profile', 'Social media', 'Referrals', 'Industry-specific channels', 'Paid advertising'],
            prospecting: {
                bestMonths: [1, 2, 9, 10],
                bestMonthsLabel: 'January-February, September-October',
                reasoning: 'New year planning and Q4 budget allocation are common decision windows',
                worstMonths: [7, 8, 12],
                worstReason: 'Summer vacations and holiday season reduce decision-making availability',
                buyerMindset: 'Evaluating growth tools and marketing effectiveness',
                approachTip: 'Lead with measurable impact on customer acquisition and retention'
            },
            calendar: {
                buyingCycle: 'Annual (Q4 planning for Q1 execution)',
                contractRenewal: 'Annual from sign date',
                keyEvents: [
                    { name: 'Industry-specific trade show', month: 3, type: 'trade_show' },
                    { name: 'Q1 planning and execution', month: 1, type: 'buying_cycle' }
                ],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '2-4 weeks from first meeting'
            }
        },
        'Custom Industry': {
            decisionMakers: ['Owner', 'Manager', 'Marketing Lead'],
            painPoints: [
                'Customer acquisition',
                'Competition',
                'Operational challenges',
                'Market awareness'
            ],
            primaryKPIs: ['Revenue', 'Customers', 'Retention', 'Growth rate'],
            topChannels: ['Digital marketing', 'Referrals', 'Industry networks', 'Local advertising'],
            prospecting: {
                bestMonths: [1, 2, 9, 10],
                bestMonthsLabel: 'January-February, September-October',
                reasoning: 'Q1 budget execution and Q4 planning are universal business planning windows',
                worstMonths: [7, 8, 12],
                worstReason: 'Summer and holiday season reduce business decision-making',
                buyerMindset: 'Looking for growth tools and competitive differentiation',
                approachTip: 'Focus on measurable ROI and customer acquisition improvements'
            },
            calendar: {
                buyingCycle: 'Annual (varies by industry)',
                contractRenewal: 'Annual from sign date',
                keyEvents: [],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '2-4 weeks from first meeting'
            }
        }
    }
};

/**
 * Get industry intelligence for a given industry and sub-industry
 * @param {string} industry - Main industry category
 * @param {string} subIndustry - Sub-industry (optional)
 * @returns {Object} Industry intelligence data
 */
function getIndustryIntelligence(industry, subIndustry = null) {
    const industryData = INDUSTRY_INTELLIGENCE[industry];

    if (!industryData) {
        // Return generic data if industry not found
        return {
            decisionMakers: ['Owner', 'Manager', 'Marketing Lead'],
            painPoints: [
                'Customer acquisition costs',
                'Competition in local market',
                'Online reputation management',
                'Operational efficiency'
            ],
            primaryKPIs: ['Revenue growth', 'Customer count', 'Customer retention', 'Online reviews'],
            topChannels: ['Google Business Profile', 'Social media', 'Referrals', 'Local advertising'],
            prospecting: {
                bestMonths: [1, 2, 9, 10],
                bestMonthsLabel: 'January-February, September-October',
                reasoning: 'Q1 budget execution and Q4 planning are common decision windows across industries',
                worstMonths: [7, 8, 12],
                worstReason: 'Summer vacations and holiday season reduce decision-making availability',
                buyerMindset: 'Evaluating growth tools and marketing effectiveness',
                approachTip: 'Lead with measurable impact on customer acquisition and online reputation'
            },
            calendar: {
                buyingCycle: 'Annual (Q4 planning for Q1 execution)',
                contractRenewal: 'Annual from sign date',
                keyEvents: [],
                budgetPlanningMonths: [10, 11, 12],
                decisionTimeline: '2-4 weeks from first meeting'
            }
        };
    }

    // Try to get sub-industry specific data first
    if (subIndustry && industryData[subIndustry]) {
        return industryData[subIndustry];
    }

    // Fall back to industry default
    return industryData.default || {
        decisionMakers: ['Owner', 'Manager'],
        painPoints: ['Customer acquisition', 'Competition', 'Reputation management'],
        primaryKPIs: ['Revenue', 'Customers', 'Reviews'],
        topChannels: ['Google Business Profile', 'Social media', 'Referrals'],
        prospecting: {
            bestMonths: [1, 2, 9, 10],
            bestMonthsLabel: 'January-February, September-October',
            reasoning: 'Q1 and Q4 planning windows',
            worstMonths: [7, 8, 12],
            worstReason: 'Summer and holiday season',
            buyerMindset: 'Evaluating growth tools',
            approachTip: 'Lead with measurable ROI'
        },
        calendar: {
            buyingCycle: 'Annual',
            contractRenewal: 'Annual from sign date',
            keyEvents: [],
            budgetPlanningMonths: [10, 11, 12],
            decisionTimeline: '2-4 weeks from first meeting'
        }
    };
}

module.exports = {
    INDUSTRY_INTELLIGENCE,
    getIndustryIntelligence
};
