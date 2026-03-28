/**
 * Preferences API — Smart Mode defaults
 * GET /preferences/smart-mode
 *
 * Aggregates last 20 pitch_generated events to infer user preferences.
 * Returns default card, level, visual style, city, industry with confidence.
 */

const admin = require('firebase-admin');

function getMostFrequent(arr) {
    if (!arr.length) return null;
    const counts = arr.reduce((acc, val) => {
        if (val) acc[val] = (acc[val] || 0) + 1;
        return acc;
    }, {});
    return Object.entries(counts)
        .sort(([, a], [, b]) => b - a)[0]?.[0] || null;
}

async function getSmartModeDefaults(req, res) {
    try {
        const userId = req.userId;

        const snapshot = await admin.firestore()
            .collection('userEvents')
            .doc(userId)
            .collection('events')
            .where('eventType', '==', 'pitch_generated')
            .orderBy('timestamp', 'desc')
            .limit(20)
            .get();

        const events = snapshot.docs.map(doc => doc.data());
        const sampleSize = events.length;

        if (sampleSize < 5) {
            return res.status(200).json({
                success: true,
                confidence: 'low',
                sampleSize
            });
        }

        const properties = events.map(e => e.properties || {});

        const defaultCard = getMostFrequent(
            properties.map(p => p.cardType)
                .filter(c => c && c !== 'standard')
        );
        const defaultLevel = getMostFrequent(
            properties.map(p => {
                const v = p.pitchLevel || p.level;
                return v != null ? String(v) : null;
            }).filter(Boolean)
        );
        const defaultVisual = getMostFrequent(
            properties.map(p => p.visualStyle)
                .filter(v => v && v !== 'none')
        );
        const defaultCity = getMostFrequent(
            properties.map(p => p.city).filter(Boolean)
        );
        const defaultIndustry = getMostFrequent(
            properties.map(p => p.industry).filter(Boolean)
        );

        const confidence = sampleSize >= 15 ? 'high'
            : sampleSize >= 5 ? 'medium' : 'low';

        return res.status(200).json({
            success: true,
            defaultCard,
            defaultLevel,
            defaultVisual,
            defaultCity,
            defaultIndustry,
            confidence,
            sampleSize
        });
    } catch (error) {
        console.error('[Preferences] smart-mode error:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Failed to load preferences'
        });
    }
}

module.exports = { getSmartModeDefaults };
