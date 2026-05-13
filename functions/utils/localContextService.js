'use strict';

/**
 * Local Context Service — Market Intel Reports
 *
 * Bridges PathManager Local Intelligence data into SynchIntro reports via HTTP.
 * Calls GET https://api.pathsynch.com/api/v1/local-intelligence/summary
 * with city/state/zipCode query params.
 *
 * Why Option B (HTTP) instead of direct MongoDB:
 * - SynchIntro has no MongoDB client — adding one requires Atlas IP whitelisting
 *   for GCP's dynamic IP ranges (impractical without a VPC connector).
 * - SynchIntro already calls PathManager via HTTP (NemoClaw pattern).
 * - PathManager models (WeatherCondition, LocalEvent, FootTraffic) field names
 *   must be read from EC2 source — not available in this codebase.
 *
 * Graceful degradation: if endpoint is unavailable, returns { status: 'unavailable' }.
 * The section is NEVER shown to the user if status === 'unavailable'.
 */

const PATHMANAGER_API_URL = process.env.PATHMANAGER_API_URL || 'https://api.pathsynch.com';
const PATHMANAGER_LOCAL_INTEL_KEY = process.env.PATHMANAGER_LOCAL_INTEL_KEY || '';

/**
 * Fetch local context for a prospect location from PathManager.
 *
 * @param {Object} location - { city, state, zipCode }
 * @param {string} category - Business category for relevance filtering
 * @returns {Promise<Object|null>}
 */
async function getLocalContext(location, category) {
    if (!PATHMANAGER_LOCAL_INTEL_KEY) {
        console.warn('[LocalContext] PATHMANAGER_LOCAL_INTEL_KEY not set — skipping');
        return null;
    }

    const params = new URLSearchParams({
        city:     location.city     || '',
        state:    location.state    || '',
        zipCode:  location.zipCode  || '',
        category: category          || ''
    });

    try {
        const res = await Promise.race([
            fetch(`${PATHMANAGER_API_URL}/api/v1/local-intelligence/summary?${params}`, {
                method:  'GET',
                headers: {
                    'X-Service-Key': PATHMANAGER_LOCAL_INTEL_KEY,
                    'Content-Type':  'application/json'
                }
            }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), 8000)
            )
        ]);

        if (!res.ok) {
            // 404 = endpoint not yet deployed on PathManager; 503 = EC2 down
            console.warn(`[LocalContext] PathManager returned ${res.status} — skipping local context`);
            return null;
        }

        const body = await res.json();

        // PathManager wraps results in { success, data }
        const data = body.data || body;

        if (!data || (!data.events && !data.weather && !data.footTraffic)) {
            console.warn('[LocalContext] PathManager returned empty payload for', location.city, location.state);
            return null;
        }

        return normalizeLocalContext(data, location);

    } catch (err) {
        // Network error or timeout — silently skip (non-blocking)
        console.warn('[LocalContext] PathManager call failed (non-blocking):', err.message);
        return null;
    }
}

/**
 * Normalize PathManager response into a consistent shape regardless of
 * minor field-name variations across PathManager versions.
 */
function normalizeLocalContext(data, location) {
    const events     = data.events     || null;
    const weather    = data.weather    || null;
    const footTraffic = data.footTraffic || data.foot_traffic || null;

    // Count available sources
    const sourceCount = [events, weather, footTraffic].filter(Boolean).length;
    const status = sourceCount === 3 ? 'complete'
                 : sourceCount  >  0 ? 'partial'
                 :                     'unavailable';

    if (status === 'unavailable') return null;

    return {
        status,
        city:  location.city  || '',
        state: location.state || '',

        events: events ? {
            count:        events.count        || (events.upcoming || []).length || 0,
            eventDensity: events.eventDensity || classifyDensity((events.upcoming || []).length),
            upcoming:     (events.upcoming || []).slice(0, 10).map(e => ({
                name:   e.name  || e.title || 'Event',
                date:   e.date  || e.startDate || null,
                venue:  e.venue || e.location   || null,
                type:   e.type  || e.category   || null,
                source: e.source || null
            })),
            venueTypes: events.venueTypes || []
        } : null,

        weather: weather ? {
            currentTemp:        weather.currentTemp        || weather.temperature     || null,
            currentCondition:   weather.currentCondition   || weather.condition       || null,
            humidity:           weather.humidity                                       || null,
            avgTemp72hr:        weather.avgTemp72hr        || weather.avgTemp          || null,
            weatherSensitivity: weather.weatherSensitivity || classifyWeather(weather)
        } : null,

        footTraffic: footTraffic ? {
            peakHours:       footTraffic.peakHours       || null,
            busiestDay:      footTraffic.busiestDay      || null,
            quietestDay:     footTraffic.quietestDay     || null,
            averageFootfall: footTraffic.averageFootfall || null
        } : null,

        narratives: null  // filled by localContextNarrative.js
    };
}

function classifyDensity(count) {
    if (count > 10) return 'High';
    if (count > 5)  return 'Medium';
    if (count > 0)  return 'Low';
    return 'None';
}

function classifyWeather(w) {
    const temp      = w.temperature || w.currentTemp || 72;
    const condition = (w.condition || w.currentCondition || '').toLowerCase();
    if (condition.includes('rain') || condition.includes('storm')) return 'Weather-sensitive (rain)';
    if (temp > 95)  return 'Weather-sensitive (extreme heat)';
    if (temp < 32)  return 'Weather-sensitive (cold)';
    return 'Favorable';
}

module.exports = { getLocalContext };
