/**
 * Narrative Validator Service
 *
 * Quality validation and auto-fix for generated narratives
 */

const { validateNarrative: claudeValidate } = require('./claudeClient');
const { NARRATIVE_VALIDATOR_PROMPT } = require('./prompts/narrativeValidatorPrompt');
const { CLAUDE_CONFIG } = require('../config/claude');

/**
 * Validate a narrative against original business data
 * @param {Object} narrative - Generated narrative
 * @param {Object} originalData - Original business data
 * @returns {Promise<Object>} Validation result
 */
async function validate(narrative, originalData) {
    const result = await claudeValidate(NARRATIVE_VALIDATOR_PROMPT, narrative, originalData);

    // Ensure validation has required fields
    const validation = normalizeValidation(result.validation);

    return {
        validation,
        usage: result.usage
    };
}

/**
 * Normalize validation result to ensure consistent structure
 */
function normalizeValidation(validation) {
    return {
        isValid: Boolean(validation.isValid),
        score: Math.min(100, Math.max(0, Number(validation.score) || 0)),
        breakdown: {
            factualConsistency: Number(validation.breakdown?.factualConsistency) || 0,
            toneAppropriateness: Number(validation.breakdown?.toneAppropriateness) || 0,
            claimValidity: Number(validation.breakdown?.claimValidity) || 0,
            completeness: Number(validation.breakdown?.completeness) || 0,
            coherence: Number(validation.breakdown?.coherence) || 0
        },
        issues: Array.isArray(validation.issues)
            ? validation.issues.map(normalizeIssue)
            : [],
        autoFixes: Array.isArray(validation.autoFixes)
            ? validation.autoFixes.map(normalizeFix)
            : [],
        summary: String(validation.summary || 'Validation completed.')
    };
}

/**
 * Normalize a single issue
 */
function normalizeIssue(issue) {
    const validSeverities = ['critical', 'major', 'minor', 'suggestion'];
    const validCategories = ['factual', 'tone', 'claims', 'completeness', 'coherence'];

    return {
        severity: validSeverities.includes(issue.severity) ? issue.severity : 'minor',
        category: validCategories.includes(issue.category) ? issue.category : 'completeness',
        message: String(issue.message || 'Unknown issue'),
        field: String(issue.field || 'unknown'),
        suggestion: String(issue.suggestion || '')
    };
}

/**
 * Normalize a single auto-fix
 */
function normalizeFix(fix) {
    return {
        field: String(fix.field || ''),
        currentValue: fix.currentValue,
        suggestedValue: fix.suggestedValue,
        reason: String(fix.reason || '')
    };
}

/**
 * Apply auto-fixes to a narrative
 * @param {Object} narrative - Original narrative
 * @param {Array} autoFixes - Auto-fixes to apply
 * @returns {Object} Fixed narrative
 */
function applyAutoFixes(narrative, autoFixes) {
    if (!Array.isArray(autoFixes) || autoFixes.length === 0) {
        return narrative;
    }

    // Deep clone the narrative
    const fixed = JSON.parse(JSON.stringify(narrative));

    for (const fix of autoFixes) {
        if (!fix.field || fix.suggestedValue === undefined) {
            continue;
        }

        try {
            setNestedValue(fixed, fix.field, fix.suggestedValue);
        } catch (error) {
            console.warn(`Failed to apply auto-fix for ${fix.field}:`, error.message);
        }
    }

    return fixed;
}

/**
 * Set a nested value in an object using dot notation
 * Supports array indices like 'painPoints[0].title'
 */
function setNestedValue(obj, path, value) {
    const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const index = parseInt(part, 10);

        if (!isNaN(index)) {
            if (!Array.isArray(current)) {
                throw new Error(`Expected array at ${parts.slice(0, i).join('.')}`);
            }
            if (!current[index]) {
                current[index] = {};
            }
            current = current[index];
        } else {
            if (!current[part]) {
                current[part] = {};
            }
            current = current[part];
        }
    }

    const lastPart = parts[parts.length - 1];
    const lastIndex = parseInt(lastPart, 10);

    if (!isNaN(lastIndex) && Array.isArray(current)) {
        current[lastIndex] = value;
    } else {
        current[lastPart] = value;
    }
}

/**
 * Quick validation without AI (structure and basic checks only)
 * Use this for fast validation before AI validation
 * @param {Object} narrative - Narrative to validate
 * @returns {Object} Quick validation result
 */
function quickValidate(narrative) {
    const issues = [];
    let score = 100;

    // Check required top-level fields
    const requiredFields = ['businessStory', 'painPoints', 'valueProps', 'proofPoints', 'roiStory', 'solutionFit', 'ctaHooks'];

    for (const field of requiredFields) {
        if (!narrative[field]) {
            issues.push({
                severity: 'critical',
                category: 'completeness',
                message: `Missing required field: ${field}`,
                field,
                suggestion: `Add the ${field} section to the narrative`
            });
            score -= 15;
        }
    }

    // Check businessStory
    if (narrative.businessStory) {
        if (!narrative.businessStory.headline) {
            issues.push({
                severity: 'major',
                category: 'completeness',
                message: 'Missing headline in businessStory',
                field: 'businessStory.headline',
                suggestion: 'Add a compelling headline'
            });
            score -= 5;
        }
        if (!narrative.businessStory.valueProposition) {
            issues.push({
                severity: 'major',
                category: 'completeness',
                message: 'Missing value proposition',
                field: 'businessStory.valueProposition',
                suggestion: 'Add a clear value proposition'
            });
            score -= 5;
        }
    }

    // Check arrays have content
    const arrayChecks = [
        { field: 'painPoints', minLength: 1 },
        { field: 'valueProps', minLength: 1 },
        { field: 'ctaHooks', minLength: 1 }
    ];

    for (const check of arrayChecks) {
        const arr = narrative[check.field];
        if (!Array.isArray(arr) || arr.length < check.minLength) {
            issues.push({
                severity: 'major',
                category: 'completeness',
                message: `${check.field} must have at least ${check.minLength} item(s)`,
                field: check.field,
                suggestion: `Add more items to ${check.field}`
            });
            score -= 10;
        }
    }

    // Ensure score doesn't go below 0
    score = Math.max(0, score);

    return {
        isValid: score >= 70 && !issues.some(i => i.severity === 'critical'),
        score,
        breakdown: {
            factualConsistency: score >= 70 ? 25 : 15,
            toneAppropriateness: score >= 70 ? 18 : 12,
            claimValidity: score >= 70 ? 18 : 12,
            completeness: score >= 70 ? 14 : 8,
            coherence: score >= 70 ? 14 : 10
        },
        issues,
        autoFixes: [],
        summary: issues.length === 0
            ? 'Basic structure validation passed.'
            : `Found ${issues.length} issue(s) in basic validation.`
    };
}

/**
 * Full validation with optional AI enhancement
 * @param {Object} narrative - Narrative to validate
 * @param {Object} originalData - Original business data
 * @param {Object} options - Validation options
 * @returns {Promise<Object>} Full validation result
 */
async function fullValidate(narrative, originalData, options = {}) {
    const { skipAi = false, autoFix = false } = options;

    // Always do quick validation first
    const quickResult = quickValidate(narrative);

    // If critical issues or AI validation is disabled, return quick result
    if (quickResult.issues.some(i => i.severity === 'critical') || skipAi || !CLAUDE_CONFIG.enableAiNarratives) {
        return {
            validation: quickResult,
            usage: { inputTokens: 0, outputTokens: 0 },
            source: 'quick'
        };
    }

    // Do AI validation
    const aiResult = await validate(narrative, originalData);

    // Merge quick and AI results
    const mergedValidation = mergeValidations(quickResult, aiResult.validation);

    // Apply auto-fixes if requested
    let fixedNarrative = null;
    if (autoFix && mergedValidation.autoFixes.length > 0) {
        fixedNarrative = applyAutoFixes(narrative, mergedValidation.autoFixes);
    }

    return {
        validation: mergedValidation,
        usage: aiResult.usage,
        source: 'ai',
        fixedNarrative
    };
}

/**
 * Merge quick and AI validation results
 */
function mergeValidations(quick, ai) {
    // Combine issues, deduplicating by field
    const seenFields = new Set();
    const mergedIssues = [];

    // Add AI issues first (they're more specific)
    for (const issue of ai.issues) {
        if (!seenFields.has(issue.field)) {
            mergedIssues.push(issue);
            seenFields.add(issue.field);
        }
    }

    // Add quick issues that weren't covered
    for (const issue of quick.issues) {
        if (!seenFields.has(issue.field)) {
            mergedIssues.push(issue);
            seenFields.add(issue.field);
        }
    }

    return {
        // Use AI's determination but fail if quick found critical issues
        isValid: ai.isValid && !quick.issues.some(i => i.severity === 'critical'),
        score: ai.score,
        breakdown: ai.breakdown,
        issues: mergedIssues,
        autoFixes: ai.autoFixes,
        summary: ai.summary
    };
}

module.exports = {
    validate,
    quickValidate,
    fullValidate,
    applyAutoFixes
};
