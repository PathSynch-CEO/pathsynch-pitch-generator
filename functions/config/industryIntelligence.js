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
            topChannels: ['Google Business Profile', 'Instagram', 'Yelp', 'Local SEO', 'Food delivery apps']
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
            topChannels: ['Google Business Profile', 'OpenTable/Resy', 'Instagram', 'Yelp', 'Local food blogs']
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
            topChannels: ['Google Business Profile', 'Delivery apps (DoorDash, UberEats)', 'Social media', 'Loyalty apps']
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
            topChannels: ['Instagram', 'Google Business Profile', 'Mobile ordering', 'Local partnerships']
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
            topChannels: ['Instagram', 'Facebook Events', 'Google Business Profile', 'Local event listings', 'Influencer partnerships']
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
            topChannels: ['Google Local Services Ads', 'Google Business Profile', 'HomeAdvisor/Angi', 'Referrals', 'Facebook']
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
            topChannels: ['Google Local Services Ads', 'Google Business Profile', 'HomeAdvisor', 'Door-to-door (storm)', 'Referrals', 'Facebook']
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
            topChannels: ['Google Business Profile', 'Nextdoor', 'HomeAdvisor', 'Referral programs', 'Local SEO']
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
            topChannels: ['Industry relationships', 'LinkedIn', 'Trade associations', 'Commercial property databases', 'Referrals']
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
            topChannels: ['Google Local Services Ads', 'Google Business Profile', 'Direct mail', 'Radio/TV', 'Service Titan leads']
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
            topChannels: ['Google Business Profile', 'Contractor referrals', 'Home builder relationships', 'Angi/HomeAdvisor']
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
            topChannels: ['Door hangers', 'Yard signs', 'Google Business Profile', 'Nextdoor', 'Referrals']
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
            topChannels: ['Houzz', 'Referrals', 'Google Business Profile', 'Instagram (project photos)', 'Builder associations']
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
            topChannels: ['Google Business Profile', 'Nextdoor', 'HomeAdvisor', 'Realtor referrals', 'Yard signs']
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
            topChannels: ['Google Business Profile', 'Door-to-door', 'Direct mail', 'Google Ads', 'Referral programs']
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
            topChannels: ['Google Business Profile', 'Nextdoor', 'Thumbtack', 'Facebook groups', 'Referrals']
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
            topChannels: ['Google Business Profile', 'Referrals', 'Social media', 'Insurance networks', 'Local SEO']
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
            topChannels: ['Instagram', 'Facebook Ads', 'Google Business Profile', 'Referral programs', 'Corporate partnerships']
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
            topChannels: ['Google Business Profile', 'Insurance directories', 'Physician referrals', 'Healthgrades/Zocdoc']
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
            topChannels: ['Google Business Profile', 'Google Ads', 'Insurance networks', 'Direct mail', 'Referrals']
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
            topChannels: ['Google Business Profile', 'Attorney referrals', 'Google Ads', 'Community events', 'Social media']
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
            topChannels: ['Instagram', 'Google Business Profile', 'Yelp', 'Local partnerships', 'Email marketing']
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
            topChannels: ['Referrals', 'LinkedIn', 'Speaking/Events', 'Content marketing', 'Industry associations']
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
            topChannels: ['Google Ads', 'TV/Radio', 'Referral networks', 'Google Business Profile', 'Avvo/FindLaw']
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
            topChannels: ['Referrals', 'LinkedIn', 'Industry networking', 'Content marketing', 'Strategic alliances']
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
            topChannels: ['Zillow/Realtor.com', 'Google Business Profile', 'Social media', 'Sphere marketing', 'Open houses']
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
            topChannels: ['Referrals', 'Google Business Profile', 'Community involvement', 'Cross-sell campaigns', 'LinkedIn']
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
            topChannels: ['Google Business Profile', 'Google Ads', 'Referrals', 'Direct mail', 'AutoVitals/repair shop marketing']
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
            topChannels: ['Google Business Profile', 'Google Ads', 'Referrals', 'AutoVitals', 'Direct mail/postcards']
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
            topChannels: ['Insurance DRP programs', 'Google Business Profile', 'Towing company relationships', 'Referrals']
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
            topChannels: ['Third-party sites (Cars.com, AutoTrader)', 'Google Ads', 'Social media', 'OEM co-op', 'Email/CRM']
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
            topChannels: ['Google Business Profile', 'Instagram', 'Email marketing', 'Local events', 'Loyalty programs']
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
            topChannels: ['Google Business Profile', 'Facebook', 'Local advertising', 'Community events', 'Loyalty programs']
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
            topChannels: ['Instagram', 'Google Business Profile', 'Email marketing', 'Influencer partnerships', 'Local events']
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
            topChannels: ['Google Business Profile', 'Google Ads', 'Local SEO', 'Tech forums/communities', 'Service partnerships']
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
            topChannels: ['Instagram', 'Google Business Profile', 'Referrals', 'Yelp', 'Booking apps (Vagaro, Fresha)']
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
            topChannels: ['Instagram', 'Google Business Profile', 'Yelp', 'Referral programs', 'Walk-in traffic']
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
            topChannels: ['Instagram', 'Facebook', 'Google Business Profile', 'Groupon (strategically)', 'Email marketing']
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
            topChannels: ['Google Business Profile', 'Walk-in traffic', 'Yelp', 'Instagram', 'Loyalty programs']
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
            topChannels: ['Content marketing', 'LinkedIn', 'Product-led growth', 'Paid search', 'Partnerships']
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
            topChannels: ['Clutch/G2', 'LinkedIn', 'Referrals', 'Tech conferences', 'GitHub presence']
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
            topChannels: ['Referrals', 'Local networking', 'LinkedIn', 'Google Business Profile', 'Vendor partnerships']
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
            topChannels: ['Content marketing', 'Tech communities', 'Partner ecosystems', 'Conferences', 'Direct sales']
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
            topChannels: ['Product-led growth', 'Content/SEO', 'G2/Capterra reviews', 'Paid ads', 'Partnerships']
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
            topChannels: ['Referrals', 'LinkedIn thought leadership', 'Speaking/conferences', 'Case studies', 'Strategic partnerships']
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
            topChannels: ['Community presence', 'Digital marketing', 'Referrals', 'Financial advisor networks', 'Events']
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
            topChannels: ['Business development', 'Community events', 'Referral networks', 'Chamber of Commerce', 'LinkedIn']
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
            topChannels: ['Community sponsorships', 'SEO/SEM', 'Member referrals', 'Employer partnerships', 'Social media']
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
            topChannels: ['Relationship networks', 'Industry conferences', 'Thought leadership', 'Alumni networks']
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
            topChannels: ['Client referrals', 'COI networks (CPAs, attorneys)', 'LinkedIn', 'Seminars/webinars', 'Content marketing']
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
            topChannels: ['ISV/software partnerships', 'Direct sales', 'Reseller channels', 'Trade shows', 'Digital marketing']
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
            topChannels: ['Trade shows', 'Industry associations', 'Manufacturer reps', 'Direct sales', 'LinkedIn']
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
            topChannels: ['Referrals', 'Industry directories', 'Trade shows', 'Google Business Profile', 'LinkedIn']
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
            topChannels: ['Trade shows', 'Direct sales', 'Manufacturer reps', 'Industry publications', 'Technical webinars']
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
            topChannels: ['Food industry trade shows', 'Broker/distributor networks', 'Industry certifications', 'Buyer outreach']
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
            topChannels: ['Trade associations', 'B2B directories', 'Referrals', 'Industry publications']
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
            topChannels: ['Load boards', 'Broker relationships', 'Direct shipper contracts', 'Industry associations']
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
            topChannels: ['GDS systems', 'OTAs', 'Loyalty programs', 'Corporate contracts', 'Direct booking']
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
            topChannels: ['Charter brokers', 'High-net-worth networks', 'Corporate travel managers', 'Referrals', 'Jet card programs']
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
            topChannels: ['Aviation directories', 'Airport relationships', 'Trade shows', 'Direct pilot outreach', 'ForeFlight/aviation apps']
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
            topChannels: ['Load boards (DAT, Truckstop)', 'Broker relationships', '3PL partnerships', 'Shipper direct contracts']
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
            topChannels: ['3PL RFPs', 'Freight broker partnerships', 'Commercial real estate networks', 'Industry associations']
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
            topChannels: ['Regulatory proceedings', 'Industry associations', 'Community relations', 'Government affairs']
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
            topChannels: ['Utility RFPs', 'PPA negotiations', 'Industry conferences', 'Government incentive programs']
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
            topChannels: ['Utility procurement portals', 'Industry relationships', 'Trade associations', 'Bonding/insurance networks']
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
            topChannels: ['AWWA conferences', 'State regulatory filings', 'Municipal associations', 'Engineering consultants']
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
            topChannels: ['Co-ops', 'Ag retailers', 'Farm shows', 'Industry publications', 'Direct buyer relationships']
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
            topChannels: ['Grain elevators', 'Co-op relationships', 'Farm shows', 'Ag retailers', 'Direct contracts']
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
            topChannels: ['Auction markets', 'Processor contracts', 'Breed associations', 'Veterinary networks']
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
            topChannels: ['Timber buyers', 'Forest product mills', 'Consulting foresters', 'Conservation programs']
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
            topChannels: ['CoStar/LoopNet', 'Broker relationships', 'Industry associations', 'Direct tenant outreach']
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
            topChannels: ['CRE brokers', 'CoStar/LoopNet', 'Industry events', 'Tenant rep relationships', 'Direct outreach']
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
            topChannels: ['Owner referrals', 'Industry associations (IREM, BOMA)', 'Commercial broker networks', 'LinkedIn']
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
            topChannels: ['SEO/SEM', 'Social media', 'High school counselors', 'Employer partnerships', 'Alumni networks']
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
            topChannels: ['College fairs', 'High school visits', 'Digital marketing', 'Alumni networks', 'Athletic programs']
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
            topChannels: ['HR/L&D conferences', 'LinkedIn', 'Content marketing', 'Referrals', 'Industry partnerships']
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
            topChannels: ['Google ads', 'Local SEO', 'Social media', 'Employer partnerships', 'Community outreach']
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
            topChannels: ['Google Business Profile', 'Social media', 'Referrals', 'Industry-specific channels', 'Paid advertising']
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
            topChannels: ['Digital marketing', 'Referrals', 'Industry networks', 'Local advertising']
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
            topChannels: ['Google Business Profile', 'Social media', 'Referrals', 'Local advertising']
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
        topChannels: ['Google Business Profile', 'Social media', 'Referrals']
    };
}

module.exports = {
    INDUSTRY_INTELLIGENCE,
    getIndustryIntelligence
};
