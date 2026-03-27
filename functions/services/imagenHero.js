/**
 * Imagen 3 Hero Image Generator
 *
 * Generates cinematic hero photography for pitch covers
 * via Vertex AI Imagen 3.0 API. Authenticated with
 * google-auth-library (same pattern as vertexSearch.js).
 *
 * Graceful degradation: returns null on any failure.
 */

const { GoogleAuth } = require('google-auth-library');

const IMAGEN_ENDPOINT = process.env.IMAGEN_API_ENDPOINT || '';

const ATMOSPHERE = {
    restaurant: 'warm interior lighting, upscale dining atmosphere, inviting ambiance',
    healthcare: 'clean modern medical office, professional healthcare environment',
    dental: 'clean modern dental office, professional healthcare environment',
    fitness: 'bright modern gym interior, natural light, energetic atmosphere',
    retail: 'well-lit retail storefront, inviting entrance, professional display',
    home_services: 'clean suburban home exterior, professional service vehicle in driveway',
    hvac: 'clean suburban home exterior, professional HVAC unit, well-maintained property',
    auto: 'modern auto repair shop, professional service bay, clean environment',
    automotive: 'modern auto repair shop, professional service bay, clean environment',
    legal: 'professional law office, mahogany desk, confident atmosphere',
    financial: 'modern financial office, glass walls, professional environment',
    technology: 'modern tech office, open workspace, bright natural light',
    construction: 'professional construction site, organized, safety-conscious environment',
    real_estate: 'beautiful modern home exterior, well-landscaped, curb appeal',
    default: 'professional local business environment, clean and inviting, natural light'
};

let authClient = null;

async function getAuthClient() {
    if (!authClient) {
        const auth = new GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });
        authClient = await auth.getClient();
    }
    return authClient;
}

function getAtmosphere(industry) {
    if (!industry) return ATMOSPHERE.default;
    const key = industry.toLowerCase().replace(/[^a-z]/g, '_').replace(/_+/g, '_');
    if (ATMOSPHERE[key]) return ATMOSPHERE[key];
    for (const [k, v] of Object.entries(ATMOSPHERE)) {
        if (key.includes(k) || k.includes(key)) return v;
    }
    return ATMOSPHERE.default;
}

/**
 * Generate a cinematic hero image for a business pitch
 *
 * @param {Object} params
 * @param {string} params.businessName
 * @param {string} params.industry
 * @param {string} params.city
 * @returns {Promise<string|null>} data:image/png;base64,... or null
 */
async function generateHeroImage(params) {
    const { businessName, industry, city } = params;

    if (!IMAGEN_ENDPOINT) {
        console.warn('[ImagenHero] IMAGEN_API_ENDPOINT not set — skipping');
        return null;
    }

    const atmosphere = getAtmosphere(industry);
    const locationText = city ? ` located in ${city}` : '';
    const industryText = industry || 'local business';

    const prompt = `A professional hero photograph for a ${industryText} business called ${businessName}${locationText}. ${atmosphere}. Cinematic lighting, realistic photography style, warm and professional tone. No text, no logos, no people's faces. High resolution, suitable for a business pitch cover page. Aspect ratio 16:9.`;

    try {
        const client = await getAuthClient();

        const response = await client.request({
            url: IMAGEN_ENDPOINT,
            method: 'POST',
            data: {
                instances: [{ prompt }],
                parameters: {
                    sampleCount: 1,
                    aspectRatio: '16:9',
                    safetyFilterLevel: 'block_few',
                    personGeneration: 'dont_allow'
                }
            },
            timeout: 15000
        });

        const predictions = response.data?.predictions;
        if (!predictions || predictions.length === 0) {
            console.warn('[ImagenHero] No predictions returned');
            return null;
        }

        const base64 = predictions[0].bytesBase64Encoded;
        if (!base64) {
            console.warn('[ImagenHero] No image bytes in prediction');
            return null;
        }

        console.log(`[ImagenHero] Generated hero image for "${businessName}" (${(base64.length / 1024).toFixed(0)}KB)`);
        return `data:image/png;base64,${base64}`;
    } catch (error) {
        console.error('[ImagenHero] Failed:', error.message);
        return null;
    }
}

module.exports = { generateHeroImage };
