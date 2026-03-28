/**
 * Analytics Intelligence Endpoint
 * GET /analytics/intelligence
 *
 * Aggregates userEvents/{userId}/events from Firestore.
 * Returns pitch stats, feature adoption, session patterns, top markets, export stats.
 */

const admin = require('firebase-admin');

const ALL_FEATURES = [
    'create', 'library', 'pitches',
    'market', 'analytics', 'settings',
    'documents', 'visitor_intel'
];

async function getIntelligence(req, res) {
    try {
        const userId = req.userId;
        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

        const snap = await admin.firestore()
            .collection('userEvents')
            .doc(userId)
            .collection('events')
            .where('timestamp', '>', ninetyDaysAgo)
            .orderBy('timestamp', 'desc')
            .limit(500)
            .get();

        const events = snap.docs.map(d => ({
            ...d.data(),
            id: d.id
        }));

        if (!events.length) {
            return res.json({
                success: true,
                hasData: false,
                message: 'No events yet. Use the app to generate intelligence data.',
                rawEventCount: 0
            });
        }

        // ── Pitch stats ──
        const pitchEvents = events.filter(e => e.eventType === 'pitch_generated');
        const byLevel = {};
        const byCard = {};
        const byVisual = {};
        const byIndustry = {};
        const byCity = {};

        pitchEvents.forEach(e => {
            const p = e.properties || {};
            const level = 'l' + (p.pitchLevel || p.level || '?');
            byLevel[level] = (byLevel[level] || 0) + 1;

            const card = p.cardType || 'standard';
            byCard[card] = (byCard[card] || 0) + 1;

            const visual = p.visualStyle || 'none';
            byVisual[visual] = (byVisual[visual] || 0) + 1;

            if (p.industry) {
                byIndustry[p.industry] = (byIndustry[p.industry] || 0) + 1;
            }
            if (p.city) {
                byCity[p.city] = (byCity[p.city] || 0) + 1;
            }
        });

        // Weekly average
        const firstEvent = events[events.length - 1];
        const daysSinceFirst = firstEvent?.timestamp
            ? Math.max(1, Math.floor(
                (Date.now() - firstEvent.timestamp.toMillis()) / (1000 * 60 * 60 * 24)
            ))
            : 1;
        const weeksActive = Math.max(1, daysSinceFirst / 7);
        const avgPerWeek = (pitchEvents.length / weeksActive).toFixed(1);

        // ── Feature adoption ──
        const pageVisits = events.filter(e => e.eventType === 'feature_visited');
        const visitedPages = new Set(
            pageVisits.map(e => e.properties?.page).filter(Boolean)
        );

        const featureAdoption = ALL_FEATURES.map(f => ({
            page: f,
            visited: visitedPages.has(f),
            visitCount: pageVisits.filter(e => e.properties?.page === f).length
        }));

        // ── Credit velocity ──
        const upgradeEvents = events.filter(e => e.eventType === 'upgrade_modal_shown');

        // ── Session patterns ──
        const sessionStarts = events.filter(e => e.eventType === 'session_start');
        const devices = sessionStarts.map(e => e.device).filter(Boolean);
        const deviceCounts = devices.reduce((acc, d) => {
            acc[d] = (acc[d] || 0) + 1;
            return acc;
        }, {});
        const preferredDevice = Object.entries(deviceCounts)
            .sort(([, a], [, b]) => b - a)[0]?.[0] || 'desktop';

        const timeOfDayCounts = events.reduce((acc, e) => {
            if (e.timeOfDay) {
                acc[e.timeOfDay] = (acc[e.timeOfDay] || 0) + 1;
            }
            return acc;
        }, {});
        const preferredTime = Object.entries(timeOfDayCounts)
            .sort(([, a], [, b]) => b - a)[0]?.[0] || 'morning';

        // ── Top markets ──
        const topMarkets = Object.entries(byCity)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([city, count]) => ({
                city,
                count,
                topIndustry: Object.entries(byIndustry)
                    .sort(([, a], [, b]) => b - a)[0]?.[0] || null
            }));

        // ── Exports ──
        const exportEvents = events.filter(e => e.eventType === 'export_used');
        const exportFormats = exportEvents.reduce((acc, e) => {
            const fmt = e.properties?.format || 'unknown';
            acc[fmt] = (acc[fmt] || 0) + 1;
            return acc;
        }, {});

        return res.json({
            success: true,
            hasData: true,
            generatedAt: new Date().toISOString(),
            pitchStats: {
                total: pitchEvents.length,
                avgPerWeek: parseFloat(avgPerWeek),
                byLevel,
                byCard,
                byVisual,
                topIndustry: Object.entries(byIndustry)
                    .sort(([, a], [, b]) => b - a)[0]?.[0] || null,
                topCity: Object.entries(byCity)
                    .sort(([, a], [, b]) => b - a)[0]?.[0] || null
            },
            featureAdoption,
            topMarkets,
            sessionStats: {
                totalSessions: sessionStarts.length,
                preferredDevice,
                preferredTime,
                deviceBreakdown: deviceCounts
            },
            upgradeSignals: {
                modalShownCount: upgradeEvents.length,
                triggers: upgradeEvents.map(e => e.properties?.trigger).filter(Boolean)
            },
            exportStats: {
                total: exportEvents.length,
                byFormat: exportFormats
            },
            rawEventCount: events.length,
            daysSinceFirst
        });

    } catch (e) {
        console.error('[Analytics] Intelligence failed:', e.message);
        return res.status(500).json({
            success: false,
            error: e.message
        });
    }
}

module.exports = { getIntelligence };
