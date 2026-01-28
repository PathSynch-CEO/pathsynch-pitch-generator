/**
 * Prompts Index
 *
 * Central export for all prompts
 */

const { NARRATIVE_REASONER_PROMPT } = require('./narrativeReasonerPrompt');
const { NARRATIVE_VALIDATOR_PROMPT } = require('./narrativeValidatorPrompt');
const { SALES_PITCH_PROMPT } = require('./salesPitchPrompt');
const { ONE_PAGER_PROMPT } = require('./onePagerPrompt');
const { EMAIL_SEQUENCE_PROMPT } = require('./emailSequencePrompt');
const { LINKEDIN_PROMPT } = require('./linkedInPrompt');
const { EXECUTIVE_SUMMARY_PROMPT } = require('./executiveSummaryPrompt');
const { DECK_PROMPT } = require('./deckPrompt');
const { PROPOSAL_PROMPT } = require('./proposalPrompt');

module.exports = {
    // Core prompts
    NARRATIVE_REASONER_PROMPT,
    NARRATIVE_VALIDATOR_PROMPT,
    // Formatter prompts
    SALES_PITCH_PROMPT,
    ONE_PAGER_PROMPT,
    EMAIL_SEQUENCE_PROMPT,
    LINKEDIN_PROMPT,
    EXECUTIVE_SUMMARY_PROMPT,
    DECK_PROMPT,
    PROPOSAL_PROMPT
};
