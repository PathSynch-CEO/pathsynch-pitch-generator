/**
 * Onboarding Templates Configuration
 *
 * Getting Started checklists and templates by industry.
 * Customized onboarding completion tasks based on business type.
 * Maps to NAICS codes and industry categories from industryIntelligence.js
 *
 * @version 1.0.0
 * @created 2026-02-12
 */

// ============================================
// GETTING STARTED CHECKLISTS BY INDUSTRY
// ============================================

const GETTING_STARTED_CHECKLISTS = {
    // ============================================
    // FOOD & BEVERAGE
    // ============================================
    'Food & Beverage': {
        default: [
            {
                id: 'upload-photos',
                title: 'Upload your menu or signature dish photos',
                description: 'Visual content helps personalize your pitches',
                icon: '📸',
                action: { type: 'navigate', path: '#settings', section: 'branding' },
                autoComplete: { field: 'branding.logoUrl', condition: 'exists' }
            },
            {
                id: 'connect-google',
                title: 'Connect your Google Business Profile',
                description: 'Import your reviews and business hours automatically',
                icon: '🔗',
                action: { type: 'external', url: 'pathmanager://integrations/google' },
                autoComplete: { pathManagerField: 'googleIntegrations.gmb', condition: 'connected' }
            },
            {
                id: 'create-first-pitch',
                title: 'Create your first pitch for a food distributor or local partnership',
                description: 'Try a Level 2 one-pager to see the full experience',
                icon: '🎯',
                action: { type: 'navigate', path: '#create', params: { level: 2 } },
                autoComplete: { field: 'pitchCount', condition: 'gte', value: 1 }
            },
            {
                id: 'review-highlights',
                title: 'Review your rating highlights',
                description: 'See what customers love about your business',
                icon: '⭐',
                action: { type: 'navigate', path: '#analytics' },
                condition: { pathManagerField: 'dashboard.rating', condition: 'gte', value: 4.0 },
                dynamicTitle: (data) => data?.dashboard?.rating
                    ? `Review your ${data.dashboard.rating}-star rating highlights`
                    : 'Review your rating highlights'
            }
        ],
        'Full Service Restaurant': [
            {
                id: 'private-events',
                title: 'Highlight your private event offerings',
                description: 'Add catering and private dining to your products',
                icon: '🍽️',
                action: { type: 'navigate', path: '#settings', section: 'products' }
            },
            {
                id: 'seasonal-menu',
                title: 'Showcase your seasonal specialties',
                description: 'Update your product list with current offerings',
                icon: '🍂',
                action: { type: 'navigate', path: '#settings', section: 'products' }
            }
        ],
        'Fast Casual': [
            {
                id: 'loyalty-program',
                title: 'Set up your loyalty program pitch',
                description: 'Attract corporate lunch accounts',
                icon: '🎁',
                action: { type: 'navigate', path: '#create', params: { targetIndustry: 'Corporate' } }
            },
            {
                id: 'catering-menu',
                title: 'Add your catering menu options',
                description: 'Great for corporate and event pitches',
                icon: '📋',
                action: { type: 'navigate', path: '#settings', section: 'products' }
            }
        ],
        'Coffee & Cafe': [
            {
                id: 'wholesale-pitch',
                title: 'Create a wholesale coffee pitch',
                description: 'Target local offices and restaurants',
                icon: '☕',
                action: { type: 'navigate', path: '#create' }
            }
        ],
        'Bar & Nightlife': [
            {
                id: 'event-pitch',
                title: 'Create an event hosting pitch',
                description: 'Target corporate event planners',
                icon: '🎉',
                action: { type: 'navigate', path: '#create' }
            }
        ]
    },

    // ============================================
    // TECHNOLOGY & SAAS
    // ============================================
    'Technology & SaaS': {
        default: [
            {
                id: 'add-features',
                title: 'Add your product features and pricing',
                description: 'Define your product tiers for pitch personalization',
                icon: '💻',
                action: { type: 'navigate', path: '#settings', section: 'products' },
                autoComplete: { field: 'products.length', condition: 'gte', value: 1 }
            },
            {
                id: 'define-icp',
                title: 'Define your ideal customer profile',
                description: 'Who are your best-fit customers?',
                icon: '🎯',
                action: { type: 'navigate', path: '#settings', section: 'icp' },
                autoComplete: { field: 'icps.length', condition: 'gte', value: 1 }
            },
            {
                id: 'create-enterprise-deck',
                title: 'Create your first enterprise deck for a prospect',
                description: 'Level 3 decks are perfect for SaaS sales',
                icon: '📊',
                action: { type: 'navigate', path: '#create', params: { level: 3 } },
                autoComplete: { field: 'pitchCount', condition: 'gte', value: 1 }
            },
            {
                id: 'case-study',
                title: 'Add a customer case study',
                description: 'Social proof strengthens your pitches',
                icon: '📝',
                action: { type: 'navigate', path: '#settings', section: 'products' }
            }
        ],
        'SaaS Products': [
            {
                id: 'api-docs',
                title: 'Link your API documentation',
                description: 'Technical buyers want to see integration options',
                icon: '🔌',
                action: { type: 'navigate', path: '#settings', section: 'products' }
            },
            {
                id: 'pricing-tiers',
                title: 'Define your pricing tiers',
                description: 'Help us recommend the right plan to prospects',
                icon: '💰',
                action: { type: 'navigate', path: '#settings', section: 'products' }
            }
        ],
        'Software Development': [
            {
                id: 'portfolio',
                title: 'Add your project portfolio',
                description: 'Showcase your best work',
                icon: '🖥️',
                action: { type: 'navigate', path: '#settings', section: 'products' }
            }
        ],
        'IT Services': [
            {
                id: 'certifications',
                title: 'Add your certifications',
                description: 'Microsoft, AWS, Cisco credentials build trust',
                icon: '🏆',
                action: { type: 'navigate', path: '#settings', section: 'company' }
            }
        ]
    },

    // ============================================
    // HOME SERVICES
    // ============================================
    'Home Services': {
        default: [
            {
                id: 'service-area',
                title: 'Add your service area and specialties',
                description: 'Define your coverage zone for targeted pitches',
                icon: '📍',
                action: { type: 'navigate', path: '#settings', section: 'company' },
                autoComplete: { field: 'companyProfile.address', condition: 'exists' }
            },
            {
                id: 'showcase-reviews',
                title: 'Showcase your customer reviews',
                description: 'Trust is everything in home services',
                icon: '⭐',
                action: { type: 'external', url: 'pathmanager://reviews' },
                autoComplete: { pathManagerField: 'dashboard.totalReviews', condition: 'gte', value: 10 }
            },
            {
                id: 'property-management-pitch',
                title: 'Create your first pitch for a property management company',
                description: 'Great recurring revenue opportunity',
                icon: '🏠',
                action: { type: 'navigate', path: '#create', params: { targetIndustry: 'Property Management' } },
                autoComplete: { field: 'pitchCount', condition: 'gte', value: 1 }
            },
            {
                id: 'before-after',
                title: 'Upload before/after project photos',
                description: 'Visual proof of your quality work',
                icon: '📸',
                action: { type: 'navigate', path: '#settings', section: 'branding' }
            }
        ],
        'Roofing': [
            {
                id: 'insurance-partnerships',
                title: 'Create a pitch for insurance adjusters',
                description: 'Storm damage claims need trusted contractors',
                icon: '🏗️',
                action: { type: 'navigate', path: '#create', params: { targetIndustry: 'Insurance' } }
            },
            {
                id: 'certifications',
                title: 'Add your manufacturer certifications',
                description: 'GAF, Owens Corning, CertainTeed credentials matter',
                icon: '🏆',
                action: { type: 'navigate', path: '#settings', section: 'company' }
            }
        ],
        'Plumbing & HVAC': [
            {
                id: 'maintenance-contracts',
                title: 'Pitch maintenance contracts to property managers',
                description: 'Reliable revenue stream',
                icon: '🔧',
                action: { type: 'navigate', path: '#create', params: { targetIndustry: 'Property Management' } }
            },
            {
                id: 'emergency-services',
                title: 'Highlight your 24/7 emergency services',
                description: 'Key differentiator for commercial clients',
                icon: '🚨',
                action: { type: 'navigate', path: '#settings', section: 'products' }
            }
        ],
        'Electrical': [
            {
                id: 'commercial-pitch',
                title: 'Create a commercial electrical pitch',
                description: 'Target general contractors and property managers',
                icon: '⚡',
                action: { type: 'navigate', path: '#create' }
            }
        ],
        'Landscaping': [
            {
                id: 'seasonal-services',
                title: 'Define your seasonal service packages',
                description: 'Spring cleanup, fall prep, snow removal',
                icon: '🌳',
                action: { type: 'navigate', path: '#settings', section: 'products' }
            }
        ]
    },

    // ============================================
    // HEALTH & WELLNESS
    // ============================================
    'Health & Wellness': {
        default: [
            {
                id: 'services-list',
                title: 'List your services and specializations',
                description: 'Help us understand your full offering',
                icon: '💪',
                action: { type: 'navigate', path: '#settings', section: 'products' },
                autoComplete: { field: 'products.length', condition: 'gte', value: 1 }
            },
            {
                id: 'connect-google',
                title: 'Connect your Google Business Profile',
                description: 'Import reviews and build trust',
                icon: '🔗',
                action: { type: 'external', url: 'pathmanager://integrations/google' },
                autoComplete: { pathManagerField: 'googleIntegrations.gmb', condition: 'connected' }
            },
            {
                id: 'corporate-wellness',
                title: 'Create a corporate wellness pitch',
                description: 'Target HR departments at local businesses',
                icon: '🏢',
                action: { type: 'navigate', path: '#create', params: { targetIndustry: 'Corporate' } },
                autoComplete: { field: 'pitchCount', condition: 'gte', value: 1 }
            }
        ],
        'Gym & Fitness': [
            {
                id: 'membership-tiers',
                title: 'Define your membership tiers',
                description: 'Show prospects your pricing options',
                icon: '🎫',
                action: { type: 'navigate', path: '#settings', section: 'products' }
            },
            {
                id: 'corporate-membership',
                title: 'Create a corporate membership pitch',
                description: 'Target local employers for group rates',
                icon: '🏋️',
                action: { type: 'navigate', path: '#create' }
            }
        ],
        'Medical Practice': [
            {
                id: 'specialties',
                title: 'List your medical specialties',
                description: 'Helps with referral pitches',
                icon: '🩺',
                action: { type: 'navigate', path: '#settings', section: 'products' }
            }
        ],
        'Dental Practice': [
            {
                id: 'insurance-networks',
                title: 'List your insurance networks',
                description: 'Important for corporate pitches',
                icon: '🦷',
                action: { type: 'navigate', path: '#settings', section: 'products' }
            }
        ],
        'Spa & Massage': [
            {
                id: 'packages',
                title: 'Define your service packages',
                description: 'Corporate wellness packages are popular',
                icon: '💆',
                action: { type: 'navigate', path: '#settings', section: 'products' }
            }
        ]
    },

    // ============================================
    // PROFESSIONAL SERVICES
    // ============================================
    'Professional Services': {
        default: [
            {
                id: 'expertise-areas',
                title: 'Define your areas of expertise',
                description: 'Help us match you with the right prospects',
                icon: '📋',
                action: { type: 'navigate', path: '#settings', section: 'products' },
                autoComplete: { field: 'products.length', condition: 'gte', value: 1 }
            },
            {
                id: 'credentials',
                title: 'Add your credentials and certifications',
                description: 'Build trust with professional designations',
                icon: '🏆',
                action: { type: 'navigate', path: '#settings', section: 'company' }
            },
            {
                id: 'referral-pitch',
                title: 'Create a referral partnership pitch',
                description: 'Target complementary professionals',
                icon: '🤝',
                action: { type: 'navigate', path: '#create', params: { level: 2 } },
                autoComplete: { field: 'pitchCount', condition: 'gte', value: 1 }
            }
        ],
        'Legal': [
            {
                id: 'practice-areas',
                title: 'Define your practice areas',
                description: 'Help referral partners understand your focus',
                icon: '⚖️',
                action: { type: 'navigate', path: '#settings', section: 'products' }
            }
        ],
        'Accounting': [
            {
                id: 'services-breakdown',
                title: 'Break down your service offerings',
                description: 'Tax, audit, advisory, bookkeeping',
                icon: '📊',
                action: { type: 'navigate', path: '#settings', section: 'products' }
            }
        ],
        'Real Estate': [
            {
                id: 'market-focus',
                title: 'Define your market focus',
                description: 'Residential, commercial, luxury',
                icon: '🏠',
                action: { type: 'navigate', path: '#settings', section: 'products' }
            }
        ],
        'Insurance': [
            {
                id: 'coverage-types',
                title: 'List your coverage types',
                description: 'Personal, commercial, specialty lines',
                icon: '🛡️',
                action: { type: 'navigate', path: '#settings', section: 'products' }
            }
        ]
    },

    // ============================================
    // RETAIL
    // ============================================
    'Retail': {
        default: [
            {
                id: 'product-categories',
                title: 'Define your product categories',
                description: 'Help us understand your inventory',
                icon: '🏪',
                action: { type: 'navigate', path: '#settings', section: 'products' },
                autoComplete: { field: 'products.length', condition: 'gte', value: 1 }
            },
            {
                id: 'connect-google',
                title: 'Connect your Google Business Profile',
                description: 'Showcase your store and reviews',
                icon: '🔗',
                action: { type: 'external', url: 'pathmanager://integrations/google' }
            },
            {
                id: 'wholesale-pitch',
                title: 'Create a wholesale partnership pitch',
                description: 'Target suppliers and distributors',
                icon: '📦',
                action: { type: 'navigate', path: '#create' },
                autoComplete: { field: 'pitchCount', condition: 'gte', value: 1 }
            }
        ]
    },

    // ============================================
    // AUTOMOTIVE
    // ============================================
    'Automotive': {
        default: [
            {
                id: 'services-list',
                title: 'List your services and specialties',
                description: 'What do you do best?',
                icon: '🚗',
                action: { type: 'navigate', path: '#settings', section: 'products' },
                autoComplete: { field: 'products.length', condition: 'gte', value: 1 }
            },
            {
                id: 'connect-google',
                title: 'Connect your Google Business Profile',
                description: 'Reviews matter in automotive',
                icon: '🔗',
                action: { type: 'external', url: 'pathmanager://integrations/google' }
            },
            {
                id: 'fleet-pitch',
                title: 'Create a fleet services pitch',
                description: 'Target property managers and businesses',
                icon: '🚐',
                action: { type: 'navigate', path: '#create', params: { targetIndustry: 'Fleet Management' } },
                autoComplete: { field: 'pitchCount', condition: 'gte', value: 1 }
            }
        ],
        'Auto Repair': [
            {
                id: 'specializations',
                title: 'List your brand specializations',
                description: 'European, Japanese, domestic, etc.',
                icon: '🔧',
                action: { type: 'navigate', path: '#settings', section: 'products' }
            }
        ]
    },

    // ============================================
    // SALON & BEAUTY
    // ============================================
    'Salon & Beauty': {
        default: [
            {
                id: 'services-menu',
                title: 'Add your service menu',
                description: 'List your offerings and price ranges',
                icon: '💇',
                action: { type: 'navigate', path: '#settings', section: 'products' },
                autoComplete: { field: 'products.length', condition: 'gte', value: 1 }
            },
            {
                id: 'connect-google',
                title: 'Connect your Google Business Profile',
                description: 'Reviews drive new clients',
                icon: '🔗',
                action: { type: 'external', url: 'pathmanager://integrations/google' }
            },
            {
                id: 'bridal-pitch',
                title: 'Create a bridal services pitch',
                description: 'Target wedding planners and venues',
                icon: '💒',
                action: { type: 'navigate', path: '#create' },
                autoComplete: { field: 'pitchCount', condition: 'gte', value: 1 }
            }
        ]
    },

    // ============================================
    // MANUFACTURING
    // ============================================
    'Manufacturing': {
        default: [
            {
                id: 'capabilities',
                title: 'Define your manufacturing capabilities',
                description: 'Materials, processes, certifications',
                icon: '🏭',
                action: { type: 'navigate', path: '#settings', section: 'products' },
                autoComplete: { field: 'products.length', condition: 'gte', value: 1 }
            },
            {
                id: 'certifications',
                title: 'Add your quality certifications',
                description: 'ISO, AS9100, IATF 16949, etc.',
                icon: '🏆',
                action: { type: 'navigate', path: '#settings', section: 'company' }
            },
            {
                id: 'oem-pitch',
                title: 'Create a pitch for OEM partnerships',
                description: 'Target larger manufacturers',
                icon: '🤝',
                action: { type: 'navigate', path: '#create', params: { level: 3 } },
                autoComplete: { field: 'pitchCount', condition: 'gte', value: 1 }
            }
        ]
    },

    // ============================================
    // EDUCATION & TRAINING
    // ============================================
    'Education & Training': {
        default: [
            {
                id: 'programs',
                title: 'List your programs and courses',
                description: 'Help us understand your offerings',
                icon: '📚',
                action: { type: 'navigate', path: '#settings', section: 'products' },
                autoComplete: { field: 'products.length', condition: 'gte', value: 1 }
            },
            {
                id: 'outcomes',
                title: 'Add your success metrics',
                description: 'Graduation rates, job placement, certifications',
                icon: '📈',
                action: { type: 'navigate', path: '#settings', section: 'products' }
            },
            {
                id: 'corporate-training',
                title: 'Create a corporate training pitch',
                description: 'Target HR and L&D departments',
                icon: '🏢',
                action: { type: 'navigate', path: '#create' },
                autoComplete: { field: 'pitchCount', condition: 'gte', value: 1 }
            }
        ]
    }
};

// ============================================
// PRODUCT TEMPLATES BY INDUSTRY
// ============================================

const PRODUCT_TEMPLATES = {
    'Food & Beverage': [
        {
            name: 'Dine-In Experience',
            description: 'Full-service dining with seasonal menus',
            isPrimary: true,
            template: true
        },
        {
            name: 'Catering Services',
            description: 'Off-site catering for corporate events and private parties',
            template: true
        },
        {
            name: 'Private Events',
            description: 'Exclusive venue rental for celebrations and business dinners',
            template: true
        },
        {
            name: 'Takeout & Delivery',
            description: 'Convenient ordering for home and office',
            template: true
        }
    ],
    'Technology & SaaS': [
        {
            name: 'Core Platform',
            description: 'Main software product with essential features',
            isPrimary: true,
            template: true
        },
        {
            name: 'Professional Services',
            description: 'Implementation, training, and custom development',
            template: true
        },
        {
            name: 'Support & Maintenance',
            description: 'Ongoing technical support and updates',
            template: true
        },
        {
            name: 'Enterprise Add-ons',
            description: 'Advanced features for larger organizations',
            template: true
        }
    ],
    'Home Services': [
        {
            name: 'Residential Services',
            description: 'Home repair and maintenance for homeowners',
            isPrimary: true,
            template: true
        },
        {
            name: 'Commercial Services',
            description: 'Service for businesses and property managers',
            template: true
        },
        {
            name: 'Emergency Services',
            description: '24/7 emergency response',
            template: true
        },
        {
            name: 'Maintenance Plans',
            description: 'Recurring service contracts',
            template: true
        }
    ],
    'Health & Wellness': [
        {
            name: 'Individual Sessions',
            description: 'One-on-one appointments and consultations',
            isPrimary: true,
            template: true
        },
        {
            name: 'Group Programs',
            description: 'Classes and group training sessions',
            template: true
        },
        {
            name: 'Corporate Wellness',
            description: 'Workplace health and wellness programs',
            template: true
        },
        {
            name: 'Membership Plans',
            description: 'Monthly or annual membership options',
            template: true
        }
    ],
    'Professional Services': [
        {
            name: 'Consulting',
            description: 'Expert advice and strategic guidance',
            isPrimary: true,
            template: true
        },
        {
            name: 'Project Work',
            description: 'Defined scope engagements',
            template: true
        },
        {
            name: 'Retainer Services',
            description: 'Ongoing advisory and support',
            template: true
        },
        {
            name: 'Training & Workshops',
            description: 'Educational sessions for teams',
            template: true
        }
    ]
};

// ============================================
// ICP TEMPLATES BY INDUSTRY
// ============================================

const ICP_TEMPLATES = {
    'Food & Beverage': [
        {
            name: 'Local Food Distributors',
            targetIndustries: ['Food Distribution', 'Wholesale'],
            companySizes: ['11-50', '51-200'],
            painPoints: [
                'Finding reliable local suppliers',
                'Quality consistency',
                'Delivery logistics',
                'Menu variety demands'
            ],
            decisionMakers: ['Purchasing Manager', 'Regional Buyer', 'Operations Director'],
            template: true
        },
        {
            name: 'Corporate Catering Buyers',
            targetIndustries: ['Technology', 'Finance', 'Professional Services'],
            companySizes: ['51-200', '201+'],
            painPoints: [
                'Reliable recurring lunch orders',
                'Dietary accommodations',
                'Budget management',
                'Quality for client meetings'
            ],
            decisionMakers: ['Office Manager', 'Executive Assistant', 'Facilities Manager'],
            template: true
        },
        {
            name: 'Event Planners',
            targetIndustries: ['Event Planning', 'Hospitality', 'Corporate'],
            companySizes: ['2-10', '11-50'],
            painPoints: [
                'Reliable catering partners',
                'Menu flexibility',
                'On-time delivery',
                'Budget constraints'
            ],
            decisionMakers: ['Event Coordinator', 'Wedding Planner', 'Meeting Planner'],
            template: true
        }
    ],
    'Technology & SaaS': [
        {
            name: 'Mid-Market Companies',
            targetIndustries: ['Technology', 'Finance', 'Healthcare', 'Professional Services'],
            companySizes: ['51-200', '201+'],
            painPoints: [
                'Scaling operations efficiently',
                'Integration with existing systems',
                'Data security concerns',
                'User adoption challenges'
            ],
            decisionMakers: ['CTO', 'VP Engineering', 'IT Director', 'Head of Operations'],
            template: true
        },
        {
            name: 'Enterprise Accounts',
            targetIndustries: ['Fortune 500', 'Large Enterprise'],
            companySizes: ['201+'],
            painPoints: [
                'Compliance requirements',
                'Custom integration needs',
                'Global deployment',
                'Vendor consolidation'
            ],
            decisionMakers: ['CIO', 'CISO', 'VP IT', 'Procurement Director'],
            template: true
        },
        {
            name: 'Startup & SMB',
            targetIndustries: ['Technology', 'E-commerce', 'Professional Services'],
            companySizes: ['2-10', '11-50'],
            painPoints: [
                'Limited budget',
                'Need to move fast',
                'Lack of internal expertise',
                'Scalability concerns'
            ],
            decisionMakers: ['Founder', 'CEO', 'Head of Product'],
            template: true
        }
    ],
    'Home Services': [
        {
            name: 'Property Management Companies',
            targetIndustries: ['Property Management', 'Real Estate'],
            companySizes: ['11-50', '51-200'],
            painPoints: [
                'Reliable contractor network',
                'Emergency response availability',
                'Consistent pricing',
                'Tenant satisfaction'
            ],
            decisionMakers: ['Property Manager', 'Maintenance Director', 'Operations Manager'],
            template: true
        },
        {
            name: 'Commercial Building Owners',
            targetIndustries: ['Commercial Real Estate', 'Healthcare', 'Retail'],
            companySizes: ['11-50', '51-200'],
            painPoints: [
                'Building maintenance costs',
                'Code compliance',
                'Tenant retention',
                'Energy efficiency'
            ],
            decisionMakers: ['Facilities Manager', 'Building Owner', 'Asset Manager'],
            template: true
        },
        {
            name: 'General Contractors',
            targetIndustries: ['Construction', 'Real Estate Development'],
            companySizes: ['11-50', '51-200'],
            painPoints: [
                'Subcontractor reliability',
                'Project timelines',
                'Quality control',
                'Licensing and insurance'
            ],
            decisionMakers: ['Project Manager', 'Owner', 'Superintendent'],
            template: true
        }
    ],
    'Professional Services': [
        {
            name: 'Referral Partners',
            targetIndustries: ['Legal', 'Accounting', 'Financial Services', 'Real Estate'],
            companySizes: ['2-10', '11-50'],
            painPoints: [
                'Finding quality referral partners',
                'Client handoff process',
                'Reciprocal referrals',
                'Service quality assurance'
            ],
            decisionMakers: ['Managing Partner', 'Business Development Director', 'Owner'],
            template: true
        },
        {
            name: 'Small Business Owners',
            targetIndustries: ['Retail', 'Restaurant', 'Home Services', 'Healthcare'],
            companySizes: ['solo', '2-10', '11-50'],
            painPoints: [
                'Time constraints',
                'Compliance complexity',
                'Cash flow management',
                'Growth planning'
            ],
            decisionMakers: ['Owner', 'CEO', 'Office Manager'],
            template: true
        }
    ]
};

// ============================================
// GENERIC CHECKLIST (FALLBACK)
// ============================================

const GENERIC_CHECKLIST = [
    {
        id: 'complete-profile',
        title: 'Complete your company profile',
        description: 'Tell us about your business',
        icon: '📝',
        action: { type: 'navigate', path: '#settings', section: 'company' }
    },
    {
        id: 'add-products',
        title: 'Add your products or services',
        description: 'What do you offer?',
        icon: '📦',
        action: { type: 'navigate', path: '#settings', section: 'products' }
    },
    {
        id: 'define-icp',
        title: 'Define your ideal customer',
        description: 'Who are your best prospects?',
        icon: '🎯',
        action: { type: 'navigate', path: '#settings', section: 'icp' }
    },
    {
        id: 'create-pitch',
        title: 'Create your first pitch',
        description: 'See the magic happen',
        icon: '🚀',
        action: { type: 'navigate', path: '#create' }
    }
];

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get checklist for a specific industry/sub-industry
 * @param {string} industry - Primary industry category
 * @param {string} subIndustry - Optional sub-industry
 * @returns {Array} Combined checklist items
 */
function getChecklistForIndustry(industry, subIndustry = null) {
    const industryChecklists = GETTING_STARTED_CHECKLISTS[industry];

    if (!industryChecklists) {
        return GENERIC_CHECKLIST;
    }

    // Start with default checklist for the industry
    const baseChecklist = industryChecklists.default || [];

    // Add sub-industry specific items if available
    const subChecklist = subIndustry && industryChecklists[subIndustry]
        ? industryChecklists[subIndustry]
        : [];

    // Merge without duplicates (by id)
    const combined = [...baseChecklist];
    for (const item of subChecklist) {
        if (!combined.some(c => c.id === item.id)) {
            combined.push(item);
        }
    }

    return combined;
}

/**
 * Get product templates for an industry
 * @param {string} industry - Primary industry category
 * @returns {Array} Product template objects
 */
function getProductTemplates(industry) {
    return PRODUCT_TEMPLATES[industry] || [];
}

/**
 * Get ICP templates for an industry
 * @param {string} industry - Primary industry category
 * @returns {Array} ICP template objects
 */
function getIcpTemplates(industry) {
    return ICP_TEMPLATES[industry] || [];
}

/**
 * Check if a checklist task is auto-completed based on user data
 * @param {Object} task - Checklist task object
 * @param {Object} userData - User data from Firestore
 * @param {Object} pathManagerData - PathManager data (optional)
 * @returns {boolean} Whether the task is completed
 */
function isTaskCompleted(task, userData, pathManagerData = null) {
    if (!task.autoComplete) return false;

    const { field, pathManagerField, condition, value } = task.autoComplete;

    // Check PathManager field
    if (pathManagerField && pathManagerData) {
        const pmValue = getNestedValue(pathManagerData, pathManagerField);
        return checkCondition(pmValue, condition, value);
    }

    // Check user data field
    if (field && userData) {
        const userValue = getNestedValue(userData, field);
        return checkCondition(userValue, condition, value);
    }

    return false;
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Check a condition against a value
 */
function checkCondition(value, condition, threshold) {
    switch (condition) {
        case 'exists':
            return value !== null && value !== undefined && value !== '';
        case 'connected':
            return value === true || value === 'connected';
        case 'gte':
            return typeof value === 'number' && value >= threshold;
        case 'gt':
            return typeof value === 'number' && value > threshold;
        case 'eq':
            return value === threshold;
        default:
            return false;
    }
}

/**
 * Calculate completion percentage for a checklist
 * @param {Array} checklist - Checklist items
 * @param {Object} userData - User data
 * @param {Object} pathManagerData - PathManager data (optional)
 * @returns {number} Completion percentage (0-100)
 */
function calculateChecklistCompletion(checklist, userData, pathManagerData = null) {
    if (!checklist || checklist.length === 0) return 0;

    const completedCount = checklist.filter(task =>
        isTaskCompleted(task, userData, pathManagerData)
    ).length;

    return Math.round((completedCount / checklist.length) * 100);
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    GETTING_STARTED_CHECKLISTS,
    PRODUCT_TEMPLATES,
    ICP_TEMPLATES,
    GENERIC_CHECKLIST,
    getChecklistForIndustry,
    getProductTemplates,
    getIcpTemplates,
    isTaskCompleted,
    calculateChecklistCompletion
};
