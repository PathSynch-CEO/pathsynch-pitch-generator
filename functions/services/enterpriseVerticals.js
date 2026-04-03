/**
 * Enterprise Vertical System
 * Industry-specific context objects for enterprise-grade Market Intelligence reports.
 * Used when enterpriseMode=true in report generation.
 * Scale/Enterprise plan only.
 */

const ENTERPRISE_VERTICALS = {
    aviation: {
        vertical: 'Aviation & Airline Catering',
        primaryBuyer: 'VP of Operations, Director of Inflight Services, CFO',
        salesCycleMonths: '12-18',
        targetAccounts: [
            'Airlines (major carriers, regional carriers, low-cost carriers)',
            'Airline catering companies (Gate Gourmet, LSG Sky Chefs, DO & CO, dnata)'
        ],
        competitiveDimensions: [
            'Inventory waste percentage (industry avg 25-30% beverage waste)',
            'Manual counting hours per flight cycle',
            'Onboard inventory cost as % of operating expense',
            'Sustainability reporting requirements — waste reduction targets'
        ],
        procurementSignals: [
            'New route announcements — more flights = more inventory complexity',
            'Fleet expansion — new aircraft types = new inventory configurations',
            'Catering contract renewals — typically 3-5 year cycles',
            'Sustainability initiative announcements mentioning waste reduction',
            'New COO or VP Operations hire — new leadership = new vendor evaluation',
            'Earnings call language about onboard costs or operational efficiency'
        ],
        financialKeywords: [
            'onboard inventory', 'catering costs', 'food and beverage waste',
            'operational efficiency', 'cost per flight', 'inventory management',
            'supply chain optimization', 'waste reduction target'
        ],
        regulatorySignals: [
            'IATA sustainability reporting requirements',
            'Carbon offset mandates affecting payload weight',
            'Food safety compliance changes for inflight catering'
        ],
        theorgTitles: [
            'VP Operations', 'Director Inflight Services', 'Head of Catering',
            'Chief Operating Officer', 'VP Supply Chain', 'Director Procurement'
        ]
    },

    healthcare: {
        vertical: 'Healthcare & Hospital Systems',
        primaryBuyer: 'COO, VP Operations, Director Supply Chain, Director Materials Management',
        salesCycleMonths: '9-15',
        targetAccounts: [
            'Regional hospital systems (50+ bed facilities)',
            'Academic medical centers',
            'Multi-facility health networks'
        ],
        competitiveDimensions: [
            'Medical supply waste and expiration losses',
            'Asset tracking compliance (Joint Commission requirements)',
            'Inventory carrying costs vs. patient census fluctuation',
            'Capital equipment utilization rates'
        ],
        procurementSignals: [
            'New facility opening or expansion announcement',
            'Joint Commission accreditation review cycle (every 3 years)',
            'New COO or VP Operations hire',
            'Supply chain efficiency initiative in annual report',
            'Government compliance mandate affecting medical inventory tracking',
            'Merger or acquisition creating integration complexity'
        ],
        financialKeywords: [
            'supply chain costs', 'inventory management', 'asset utilization',
            'medical supply waste', 'operational efficiency', 'materials management',
            'supply expense', 'purchasing efficiency', 'procurement costs'
        ],
        theorgTitles: [
            'Chief Operating Officer', 'VP Operations', 'Director Supply Chain',
            'Director Materials Management', 'VP Support Services', 'CFO'
        ]
    },

    university: {
        vertical: 'University & Campus Operations',
        primaryBuyer: 'VP Finance, VP Facilities, Director Dining Services, Procurement Director',
        salesCycleMonths: '6-12',
        budgetCycle: 'July fiscal year start — pitch Q4 (Apr-Jun) for next year budget',
        targetAccounts: [
            'State universities (10,000+ enrollment)',
            'Private universities with large dining programs',
            'University real estate foundations and facilities departments'
        ],
        competitiveDimensions: [
            'Dining program food waste and sustainability reporting',
            'Campus asset tracking across distributed buildings',
            'Athletic department equipment inventory',
            'Research lab supply and reagent inventory compliance'
        ],
        procurementSignals: [
            'Enrollment growth announcement',
            'New building or facility project',
            'Dining contract renewal (typically 5-7 year cycles)',
            'Sustainability commitment announcement (carbon neutral targets)',
            'New VP Finance or Facilities hire',
            'State budget allocation for campus modernization'
        ],
        financialKeywords: [
            'dining services', 'food waste', 'campus operations', 'facilities management',
            'asset management', 'inventory control', 'procurement efficiency',
            'operational costs', 'sustainability goals'
        ],
        theorgTitles: [
            'VP Finance', 'VP Facilities Management', 'Director Dining Services',
            'Director Procurement', 'Chief Financial Officer', 'Director Operations'
        ]
    }
};

function getEnterpriseVertical(key) {
    return ENTERPRISE_VERTICALS[key] || null;
}

function listEnterpriseVerticals() {
    return Object.entries(ENTERPRISE_VERTICALS).map(([key, v]) => ({
        key,
        label: v.vertical,
        primaryBuyer: v.primaryBuyer,
        salesCycle: v.salesCycleMonths
    }));
}

module.exports = { ENTERPRISE_VERTICALS, getEnterpriseVertical, listEnterpriseVerticals };
