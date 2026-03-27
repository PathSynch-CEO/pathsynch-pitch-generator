/**
 * Synthesis Prompt Router — Card-Specific Claude System Instructions
 *
 * Returns card-specific synthesis prompts for Smart Mode analysis cards.
 * Each card type gets a tailored system instruction that directs AI
 * to generate content in a specific analytical format.
 *
 * Used by pitchGenerator.js when smartMode=true and cardType !== 'standard'.
 */

const CARD_PROMPTS = {
    card1: `You are generating a competitor landscape analysis pitch.
Lead with a positioning map (price vs quality). Name the top 3 competitors explicitly from the enrichment data.
Calculate the rating gap (prospect vs neighborhood average).
Identify the value gap — where PathSynch wins for this specific business. Frame every insight around why the prospect needs PathConnect and LocalSynch now.
End with 3 specific data-backed pitch hooks.`,

    card2: `You are generating a reputation health analysis pitch.
Lead with the current rating and review velocity (reviews per month). Score the response rate gap vs industry standard (85%+ response rate is best practice).
Identify the top 3 complaint patterns from available signals. Calculate the revenue impact of their current rating gap. Frame around what this business owner needs to hear before they lose more customers.
Lead product: PathConnect + AI Review Responder.`,

    card3: `You are generating a local market opportunity analysis.
Lead with TAM and opportunity score. Frame the revenue upside: moving from current rating to top quartile = X% more clicks = Y new customers per month.
Include: market size, saturation score, growth rate, demographic fit, competitor count.
Position PathSynch as the mechanism that captures the identified opportunity. Lead product: full suite.`,

    card4: `You are generating a pre-call intelligence brief.
Output format:
1. Company snapshot (2-3 sentences)
2. Why they will take the meeting (trigger event or signal)
3. Suggested opener (tied to a specific data point)
4. 3 talking points (each mapped to a PathSynch product)
5. 2-3 discovery questions (hypotheses to test)
6. Top 2 objections + responses
7. Competitor watch (who else they might talk to)
Be specific. Reference the actual business name, rating, and any trigger events found in enrichment data.`,

    card5: `You are generating a referral potential analysis.
Use the referral calculation data provided to produce:
1. Current estimated monthly referrals
2. Potential monthly referrals with an active program
3. Annual revenue unlocked
4. Recommended reward structure (with specific dollar amount)
5. Payback period
6. Why ReferralSynch is the right solution
Ground every number in the calculation data provided.
Do not estimate — use the exact figures from the data.`,

    card6: `You are generating a GBP completeness audit pitch.
Lead with the overall GBP score (0-100).
Break down the score across dimensions: photos, hours, description, categories, website, Q&A, services, attributes, recent posts.
Identify the single highest-impact missing item.
Estimate the ranking lift from fixing the top gap.
Frame as a LocalSynch engagement recommendation with specific deliverables and timeline.
Lead product: LocalSynch.`,
};

/**
 * Get card-specific synthesis prompt
 *
 * @param {string} cardType - 'card1' through 'card6' or 'standard'
 * @param {Object} enrichmentData - Enrichment data (used for future context injection)
 * @returns {string|null} Card-specific system prompt, or null for standard
 */
function getSynthesisPrompt(cardType, enrichmentData) {
    if (!cardType || cardType === 'standard') {
        return null;
    }

    return CARD_PROMPTS[cardType] || null;
}

module.exports = {
    getSynthesisPrompt,
    CARD_PROMPTS,
};
