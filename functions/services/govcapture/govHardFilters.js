'use strict';

/**
 * govHardFilters.js — Hard disqualification filters for gov opportunities.
 *
 * Pure function, no Firestore, no AI.
 * Missing/null fields do NOT disqualify — only positive mismatches.
 */

/**
 * @param {object} opportunity — normalized GovOpportunity
 * @param {object} profile — GovProfile
 * @returns {{ passed: boolean, disqualifyReason: string|null }}
 */
function applyHardFilters(opportunity, profile) {
    const now = new Date();

    // Past due
    if (opportunity.dueDate) {
        const due = new Date(opportunity.dueDate);
        if (!isNaN(due.getTime()) && due < now) {
            return { passed: false, disqualifyReason: 'DISQ_PAST_DUE' };
        }
    }

    // Insufficient lead time
    const deadlineMin = profile.filters?.deadlineMinimumDays;
    if (deadlineMin && opportunity.dueDate) {
        const due = new Date(opportunity.dueDate);
        if (!isNaN(due.getTime())) {
            const daysLeft = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
            if (daysLeft < deadlineMin) {
                return { passed: false, disqualifyReason: 'DISQ_SHORT_DEADLINE' };
            }
        }
    }

    // Geography mismatch (only when requiredGeographies is non-empty)
    const reqGeo = profile.filters?.geographyRequired;
    if (Array.isArray(reqGeo) && reqGeo.length > 0 && opportunity.location?.state) {
        const state = opportunity.location.state.toUpperCase().trim();
        const allowed = reqGeo.map(g => g.toUpperCase().trim());
        if (!allowed.includes(state)) {
            return { passed: false, disqualifyReason: 'DISQ_OUTSIDE_GEOGRAPHY' };
        }
    }

    // Buyer type mismatch (only when requiredBuyerTypes is non-empty)
    const reqBuyer = profile.filters?.requiredBuyerTypes;
    if (Array.isArray(reqBuyer) && reqBuyer.length > 0 && opportunity.buyerName) {
        const buyerLower = opportunity.buyerName.toLowerCase();
        const matched = reqBuyer.some(bt => buyerLower.includes(bt.toLowerCase()));
        if (!matched) {
            return { passed: false, disqualifyReason: 'DISQ_BUYER_TYPE_MISMATCH' };
        }
    }

    // Set-aside exclusion
    const excludedSetAsides = profile.filters?.excludedSetAsides;
    if (Array.isArray(excludedSetAsides) && excludedSetAsides.length > 0 && opportunity.setAside) {
        const saLower = opportunity.setAside.toLowerCase();
        if (excludedSetAsides.some(ex => saLower.includes(ex.toLowerCase()))) {
            return { passed: false, disqualifyReason: 'DISQ_SET_ASIDE_EXCLUDED' };
        }
    }

    // Below min value
    const minVal = profile.filters?.minContractValue;
    if (minVal != null && opportunity.estimatedValue != null && opportunity.estimatedValue < minVal) {
        return { passed: false, disqualifyReason: 'DISQ_BELOW_MIN_VALUE' };
    }

    // Above max value
    const maxVal = profile.filters?.maxContractValue;
    if (maxVal != null && opportunity.estimatedValue != null && opportunity.estimatedValue > maxVal) {
        return { passed: false, disqualifyReason: 'DISQ_ABOVE_MAX_VALUE' };
    }

    return { passed: true, disqualifyReason: null };
}

module.exports = { applyHardFilters };
