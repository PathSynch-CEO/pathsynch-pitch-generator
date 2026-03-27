/**
 * Visual Engine Orchestrator
 *
 * Runs Gemini data visualizations and Imagen 3 hero imagery
 * in parallel with graceful degradation.
 *
 * visualStyle: none | data-driven | cinematic | both
 * Credits: data-driven=35, cinematic=35, both=60, none=0
 */

const geminiVisuals = require('./geminiVisuals');
const imagenHero = require('./imagenHero');

/**
 * Generate visual assets for a pitch
 *
 * @param {Object} params
 * @param {string} params.cardType
 * @param {string} params.visualStyle - none|data-driven|cinematic|both
 * @param {Object} params.enrichmentData
 * @param {string} params.pitchContent - generated HTML
 * @param {string} params.businessName
 * @param {string} params.industry
 * @param {string} params.city
 * @param {string} params.primaryColor
 * @param {string} params.accentColor
 * @param {string} params.userId
 * @param {string} params.pitchId
 * @returns {Promise<{dataViz: string|null, heroImage: string|null}>}
 */
async function generateVisuals(params) {
    const { visualStyle } = params;

    if (!visualStyle || visualStyle === 'none') {
        return { dataViz: null, heroImage: null };
    }

    const runDataViz = visualStyle === 'data-driven' || visualStyle === 'both';
    const runHero = visualStyle === 'cinematic' || visualStyle === 'both';

    console.log(`[VisualEngine] Running: dataViz=${runDataViz}, hero=${runHero} for ${params.businessName}`);
    const startTime = Date.now();

    const [dataVizResult, heroResult] = await Promise.allSettled([
        runDataViz
            ? geminiVisuals.generateDataViz(params)
            : Promise.resolve(null),
        runHero
            ? imagenHero.generateHeroImage(params)
            : Promise.resolve(null)
    ]);

    const dataViz = dataVizResult.status === 'fulfilled' ? dataVizResult.value : null;
    const heroImage = heroResult.status === 'fulfilled' ? heroResult.value : null;

    if (dataVizResult.status === 'rejected') {
        console.warn('[VisualEngine] Data viz failed:', dataVizResult.reason?.message);
    }
    if (heroResult.status === 'rejected') {
        console.warn('[VisualEngine] Hero image failed:', heroResult.reason?.message);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[VisualEngine] Completed in ${elapsed}ms — dataViz: ${dataViz ? 'yes' : 'no'}, hero: ${heroImage ? 'yes' : 'no'}`);

    return { dataViz, heroImage };
}

module.exports = { generateVisuals };
