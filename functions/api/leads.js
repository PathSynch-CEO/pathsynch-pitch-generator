/**
 * Lead Capture API
 *
 * Handles free mini-report generation and email capture
 * No authentication required - public endpoint for lead generation
 */

const admin = require('firebase-admin');
const googlePlaces = require('../services/googlePlaces');
const census = require('../services/census');
const geography = require('../services/geography');
const naics = require('../config/naics');
const marketMetrics = require('../services/marketMetrics');

const db = admin.firestore();

/**
 * Generate a free mini-report and capture lead
 */
async function generateMiniReport(req, res) {
    try {
        const { email, city, state, industry, source = 'website' } = req.body;

        // Validate required fields
        if (!email || !email.includes('@')) {
            return res.status(400).json({
                success: false,
                error: 'Valid email is required'
            });
        }

        if (!industry) {
            return res.status(400).json({
                success: false,
                error: 'Industry is required'
            });
        }

        if (!city && !state) {
            return res.status(400).json({
                success: false,
                error: 'Location (city or state) is required'
            });
        }

        // Normalize email
        const normalizedEmail = email.toLowerCase().trim();

        // Check if lead already exists
        const existingLead = await db.collection('leads')
            .where('email', '==', normalizedEmail)
            .limit(1)
            .get();

        const isReturningLead = !existingLead.empty;

        // Convert industry to NAICS
        const naicsCodes = naics.getNaicsByDisplay(industry);
        const naicsCode = naicsCodes[0] || '722511';
        const industryDetails = naics.getNaicsDetails(naicsCode);

        // Get geography
        const geo = geography.getCensusGeography(city, state, null);

        // Build location string
        const locationString = `${city || ''}, ${state || ''}`.trim().replace(/^,\s*|,\s*$/g, '');

        // Fetch basic data (limited scope for free tier)
        const [competitorResult, demographicResult] = await Promise.all([
            googlePlaces.findCompetitors(locationString, industryDetails?.placesKeyword || industry, 5000),
            fetchBasicDemographics(geo)
        ]);

        const competitors = competitorResult.competitors || [];
        const demographics = demographicResult?.data || {};

        // Calculate basic metrics
        const saturation = marketMetrics.calculateSaturationScore(
            competitors,
            demographics,
            naicsCode,
            5000
        );

        const marketSize = marketMetrics.calculateMarketSize(
            demographics,
            naicsCode,
            competitors
        );

        // Prepare mini report data (limited info)
        const miniReport = {
            location: {
                city: city || null,
                state: state || null,
                display: locationString
            },
            industry: {
                name: industry,
                naicsCode: naicsCode
            },
            metrics: {
                competitorCount: competitors.length,
                saturationLevel: saturation.level,
                saturationScore: saturation.score,
                marketSizeEstimate: marketSize.totalAddressableMarket,
                population: demographics.population || null,
                medianIncome: demographics.medianIncome || null
            },
            // Teaser - show what's locked
            lockedFeatures: [
                'Opportunity Score (0-100)',
                'Detailed competitor list with ratings',
                'Age & income demographics',
                'Growth rate projections',
                'AI-powered recommendations',
                'PDF export'
            ],
            generatedAt: new Date().toISOString()
        };

        // Save or update lead
        const leadData = {
            email: normalizedEmail,
            city: city || null,
            state: state || null,
            industry: industry,
            naicsCode: naicsCode,
            source: source,
            miniReportGenerated: true,
            metrics: {
                competitorCount: competitors.length,
                saturationLevel: saturation.level,
                marketSize: marketSize.totalAddressableMarket
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        if (isReturningLead) {
            // Update existing lead
            const leadDoc = existingLead.docs[0];
            await leadDoc.ref.update({
                ...leadData,
                reportCount: admin.firestore.FieldValue.increment(1),
                searches: admin.firestore.FieldValue.arrayUnion({
                    city, state, industry,
                    timestamp: new Date().toISOString()
                })
            });
        } else {
            // Create new lead
            await db.collection('leads').add({
                ...leadData,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                reportCount: 1,
                searches: [{
                    city, state, industry,
                    timestamp: new Date().toISOString()
                }],
                converted: false,
                tags: ['mini-report']
            });
        }

        // Track analytics
        await trackLeadEvent(normalizedEmail, isReturningLead ? 'repeat_report' : 'new_lead', {
            city, state, industry
        });

        return res.status(200).json({
            success: true,
            data: miniReport,
            isReturningUser: isReturningLead,
            cta: {
                title: 'Unlock Full Market Intelligence',
                description: 'Get detailed competitor analysis, opportunity scores, and AI recommendations',
                buttonText: 'Start Free Trial',
                buttonUrl: '/signup.html?source=mini-report&email=' + encodeURIComponent(normalizedEmail)
            }
        });

    } catch (error) {
        console.error('Error generating mini report:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to generate report',
            message: error.message
        });
    }
}

/**
 * Fetch basic demographics (simplified for lead magnet)
 */
async function fetchBasicDemographics(geo) {
    try {
        if (geo.placeFips) {
            const result = await census.getDemographicsAtPlace(geo.placeFips, geo.stateFips);
            if (result?.success) return result;
        }
        if (geo.countyFips) {
            const result = await census.getDemographicsAtCounty(geo.countyFips, geo.stateFips);
            if (result?.success) return result;
        }
        return await census.getDemographics(geo.stateFips);
    } catch (error) {
        console.error('Demographics fetch error:', error);
        return { data: {} };
    }
}

/**
 * Track lead events for analytics
 */
async function trackLeadEvent(email, eventType, metadata = {}) {
    try {
        await db.collection('leadEvents').add({
            email,
            eventType,
            metadata,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        console.error('Failed to track lead event:', error);
    }
}

/**
 * Get lead statistics (admin only)
 */
async function getLeadStats(req, res) {
    try {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        // Get total leads
        const allLeads = await db.collection('leads').get();
        const totalLeads = allLeads.size;

        // Get recent leads (last 30 days)
        const recentLeads = await db.collection('leads')
            .where('createdAt', '>=', thirtyDaysAgo)
            .get();

        // Get leads from last 7 days
        const weekLeads = await db.collection('leads')
            .where('createdAt', '>=', sevenDaysAgo)
            .get();

        // Get converted leads
        const convertedLeads = await db.collection('leads')
            .where('converted', '==', true)
            .get();

        // Industry breakdown
        const industryCount = {};
        allLeads.docs.forEach(doc => {
            const industry = doc.data().industry || 'Unknown';
            industryCount[industry] = (industryCount[industry] || 0) + 1;
        });

        // Top locations
        const locationCount = {};
        allLeads.docs.forEach(doc => {
            const data = doc.data();
            const location = [data.city, data.state].filter(Boolean).join(', ') || 'Unknown';
            locationCount[location] = (locationCount[location] || 0) + 1;
        });

        const topLocations = Object.entries(locationCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([location, count]) => ({ location, count }));

        return res.status(200).json({
            success: true,
            data: {
                totalLeads,
                last30Days: recentLeads.size,
                last7Days: weekLeads.size,
                convertedLeads: convertedLeads.size,
                conversionRate: totalLeads > 0
                    ? ((convertedLeads.size / totalLeads) * 100).toFixed(1) + '%'
                    : '0%',
                byIndustry: industryCount,
                topLocations
            }
        });

    } catch (error) {
        console.error('Error getting lead stats:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get lead statistics'
        });
    }
}

/**
 * Export leads as CSV (admin only)
 */
async function exportLeads(req, res) {
    try {
        const leads = await db.collection('leads')
            .orderBy('createdAt', 'desc')
            .limit(1000)
            .get();

        const rows = [
            ['Email', 'City', 'State', 'Industry', 'Source', 'Reports', 'Converted', 'Created']
        ];

        leads.docs.forEach(doc => {
            const data = doc.data();
            rows.push([
                data.email,
                data.city || '',
                data.state || '',
                data.industry || '',
                data.source || '',
                data.reportCount || 1,
                data.converted ? 'Yes' : 'No',
                data.createdAt?.toDate?.()?.toISOString?.() || ''
            ]);
        });

        const csv = rows.map(row =>
            row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
        ).join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=leads_export.csv');
        return res.send(csv);

    } catch (error) {
        console.error('Error exporting leads:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to export leads'
        });
    }
}

module.exports = {
    generateMiniReport,
    getLeadStats,
    exportLeads
};
