/**
 * Diff Calculator Service
 * Calculates structured diffs between pitch versions using fast-json-patch
 */

const jsonpatch = require('fast-json-patch');

// Fields categorized for diff reporting
const FIELD_CATEGORIES = {
    metadata: ['businessName', 'contactName', 'industry', 'subIndustry', 'statedProblem'],
    content: ['htmlContent'],
    formatting: ['pitchLevel', 'hideBranding', 'customPrimaryColor', 'customAccentColor'],
    sharing: ['shared', 'shareId'],
    structure: ['sellerContext']
};

/**
 * Calculate a structured diff between two pitch snapshots.
 * Returns categorized changes for human-readable version history.
 *
 * @param {Object} oldSnapshot - Previous pitch state
 * @param {Object} newSnapshot - New pitch state
 * @returns {Object} Categorized diff: { metadata: [], content: [], formatting: [], structure: [] }
 */
function calculateDiff(oldSnapshot, newSnapshot) {
    if (!oldSnapshot || !newSnapshot) {
        return { metadata: [], content: [], formatting: [], structure: [] };
    }

    const patches = jsonpatch.compare(oldSnapshot, newSnapshot);

    const categorized = {
        metadata: [],
        content: [],
        formatting: [],
        structure: []
    };

    for (const patch of patches) {
        // Extract field name from JSON Pointer (e.g., "/businessName" -> "businessName")
        const fieldPath = patch.path.replace(/^\//, '');
        const topField = fieldPath.split('/')[0];

        const entry = {
            op: patch.op,
            field: fieldPath,
            oldValue: patch.op === 'replace' || patch.op === 'remove' ? summarizeValue(getNestedValue(oldSnapshot, fieldPath)) : undefined,
            newValue: patch.op === 'replace' || patch.op === 'add' ? summarizeValue(patch.value) : undefined
        };

        // Categorize
        let placed = false;
        for (const [category, fields] of Object.entries(FIELD_CATEGORIES)) {
            if (fields.includes(topField)) {
                categorized[category].push(entry);
                placed = true;
                break;
            }
        }

        if (!placed) {
            categorized.structure.push(entry);
        }
    }

    return categorized;
}

/**
 * Generate a human-readable description of changes.
 *
 * @param {Object} diff - Categorized diff from calculateDiff
 * @param {string} changeType - Type of change (edited, formatted, shared, restored)
 * @returns {string} Human-readable summary
 */
function generateDescription(diff, changeType) {
    if (changeType === 'created') return 'Pitch created';
    if (changeType === 'restored') return 'Restored from previous version';

    const parts = [];

    if (diff.metadata.length > 0) {
        const fields = [...new Set(diff.metadata.map(d => friendlyFieldName(d.field)))];
        parts.push(`Updated ${fields.join(', ')}`);
    }

    if (diff.content.length > 0) {
        parts.push('Modified pitch content');
    }

    if (diff.formatting.length > 0) {
        const fields = [...new Set(diff.formatting.map(d => friendlyFieldName(d.field)))];
        parts.push(`Changed ${fields.join(', ')}`);
    }

    if (diff.structure.length > 0) {
        parts.push(`Updated ${diff.structure.length} other field(s)`);
    }

    return parts.length > 0 ? parts.join('; ') : 'Minor changes';
}

/**
 * Detect the type of change based on the diff.
 *
 * @param {Object} diff - Categorized diff
 * @returns {string} Change type: edited | formatted | shared
 */
function detectChangeType(diff) {
    // Check sharing changes
    const sharingChanged = diff.formatting.some(d => d.field === 'shared') ||
        diff.structure.some(d => d.field === 'shared');
    if (sharingChanged && diff.metadata.length === 0 && diff.content.length === 0) {
        return 'shared';
    }

    // Check formatting-only changes
    if (diff.formatting.length > 0 && diff.metadata.length === 0 && diff.content.length === 0) {
        return 'formatted';
    }

    return 'edited';
}

// --- Helpers ---

function getNestedValue(obj, path) {
    return path.split('/').reduce((acc, key) => acc && acc[key], obj);
}

function summarizeValue(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string' && value.length > 100) {
        return value.substring(0, 100) + '...';
    }
    if (typeof value === 'object') {
        return '[object]';
    }
    return value;
}

function friendlyFieldName(field) {
    const names = {
        businessName: 'business name',
        contactName: 'contact name',
        industry: 'industry',
        subIndustry: 'sub-industry',
        statedProblem: 'stated problem',
        htmlContent: 'pitch content',
        pitchLevel: 'pitch level',
        shared: 'sharing status',
        hideBranding: 'branding visibility',
        customPrimaryColor: 'primary color',
        customAccentColor: 'accent color',
        sellerContext: 'seller context'
    };
    return names[field] || field;
}

module.exports = {
    calculateDiff,
    generateDescription,
    detectChangeType,
    FIELD_CATEGORIES
};
