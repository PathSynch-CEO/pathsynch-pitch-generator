'use strict';

/**
 * samNormalizer.js — Normalize SAM.gov API records into GovOpportunity schema.
 */

const crypto = require('crypto');

/**
 * Normalize a SAM.gov record into a GovOpportunity document.
 *
 * @param {object} samRecord — raw SAM.gov opportunity object
 * @param {string} profileId
 * @param {string} userId
 * @returns {object} — GovOpportunity-shaped document
 */
function normalizeOpportunity(samRecord, profileId, userId) {
    if (!samRecord) return null;

    const noticeId = samRecord.noticeId || null;
    const canonicalKey = noticeId
        ? crypto.createHash('sha1').update(`sam_gov:${noticeId}`).digest('hex')
        : crypto.createHash('sha1').update(`sam_gov:${Date.now()}:${Math.random()}`).digest('hex');

    // Parse dates safely
    const dueDateRaw   = samRecord.responseDeadLine || samRecord.reponseDeadLine || null;
    const postedRaw    = samRecord.postedDate || null;
    const archiveDateRaw = samRecord.archiveDate || null;

    const dueDate      = _safeParseDate(dueDateRaw);
    const postedDate   = _safeParseDate(postedRaw);
    const archiveDate  = _safeParseDate(archiveDateRaw);

    const dateParseStatus = _determineDateParseStatus(dueDateRaw, dueDate);

    // Parse org hierarchy: "DEPT.AGENCY.OFFICE" or "DEPT/AGENCY/OFFICE"
    const { agencyName, departmentName } = _parseOrgHierarchy(samRecord.fullParentPathName);

    // Location from officeAddress
    const location = _parseLocation(samRecord.officeAddress);

    // NAICS
    const naicsCodes = samRecord.naicsCode ? [String(samRecord.naicsCode)] : [];

    // Set-aside: check multiple fields, use first non-null
    const setAside = samRecord.setAsideCode
        || samRecord.typeOfSetAside
        || samRecord.typeOfSetAsideDescription
        || samRecord.setAside
        || null;

    // Description: if it's a URL, store in descriptionUrl, not as body text
    const rawDesc = samRecord.description || '';
    const isDescUrl = typeof rawDesc === 'string' && /^https?:\/\//i.test(rawDesc.trim());
    const description    = isDescUrl ? null : (rawDesc || '').substring(0, 5000);
    const descriptionUrl = isDescUrl ? rawDesc.trim() : null;

    return {
        userId,
        profileIds:        [profileId],
        primarySource:     'sam_gov',
        sourceConfidence:  'high',
        canonicalKey,

        title:             samRecord.title || 'Untitled Opportunity',
        description,
        buyerName:         agencyName || departmentName || null,
        agencyName,
        departmentName,
        solicitationNumber: samRecord.solicitationNumber || null,
        noticeType:        samRecord.type || null,

        location,
        naicsCodes,
        setAside,
        estimatedValue:    _parseNumber(samRecord.award?.amount || samRecord.estimatedValue) || null,

        dueDate:           dueDate ? dueDate.toISOString() : null,
        postedDate:        postedDate ? postedDate.toISOString() : null,
        archiveDate:       archiveDate ? archiveDate.toISOString() : null,
        rawDates: {
            dueDateRaw:     dueDateRaw,
            postedDateRaw:  postedRaw,
            archiveDateRaw: archiveDateRaw,
        },
        dateParseStatus,

        sourceRefs: [{
            source:           'sam_gov',
            sourceExternalId: noticeId,
            sourceUrl:        samRecord.uiLink || null,
            descriptionUrl,
            fetchedAt:        new Date().toISOString(),
        }],

        // Scoring fields (populated by PR #3)
        fit:              null,
        awardContext:     null,
        checklistAnswers: null,

        // Workflow
        analysisStatus:   'pending',
        pursuitStatus:    'new',
        archived:         false,

        createdAt:        null, // Set by caller via serverTimestamp
        updatedAt:        null,
    };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _safeParseDate(raw) {
    if (!raw) return null;
    if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
}

function _determineDateParseStatus(rawDue, parsedDue) {
    if (!rawDue) return 'missing';
    if (parsedDue) return 'parsed';
    return 'needs_review';
}

function _parseOrgHierarchy(fullPath) {
    if (!fullPath || typeof fullPath !== 'string') {
        return { agencyName: null, departmentName: null };
    }

    // Split on dots, slashes, or " > "
    const parts = fullPath.split(/[./>]+/).map(s => s.trim()).filter(Boolean);

    if (parts.length >= 3) {
        return { departmentName: parts[0], agencyName: parts[1] };
    }
    if (parts.length === 2) {
        return { departmentName: parts[0], agencyName: parts[1] };
    }
    if (parts.length === 1) {
        return { agencyName: parts[0], departmentName: null };
    }
    return { agencyName: null, departmentName: null };
}

function _parseLocation(officeAddress) {
    if (!officeAddress) return null;

    if (typeof officeAddress === 'string') {
        // Try to extract city, state from "City, State ZIP" format
        const parts = officeAddress.split(',').map(s => s.trim());
        return {
            city:    parts[0] || null,
            state:   parts[1]?.replace(/\d+/g, '').trim() || null,
            country: 'US',
            raw:     officeAddress,
        };
    }

    if (typeof officeAddress === 'object') {
        return {
            city:    officeAddress.city || null,
            state:   officeAddress.state || null,
            country: officeAddress.country || 'US',
            zipcode: officeAddress.zipcode || null,
        };
    }

    return null;
}

function _parseNumber(val) {
    if (val === null || val === undefined) return null;
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
}

module.exports = {
    normalizeOpportunity,
    // Exported for testing
    _safeParseDate,
    _parseOrgHierarchy,
    _parseLocation,
    _determineDateParseStatus,
};
