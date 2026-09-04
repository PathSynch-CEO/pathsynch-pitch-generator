'use strict';

const ROUTING_RULE_VERSION = 'booking-routing-v1';

function qualificationRouteKey(qualification) {
    if (qualification && qualification.goal === 'Government opportunity intelligence') {
        return 'public_sector';
    }
    if (qualification && (qualification.goal === 'Automate follow-up' || qualification.team_size === '51+')) {
        return 'growth_systems';
    }
    return 'local_growth';
}

function isSchedulableOwner(owner) {
    return Boolean(
        owner &&
        typeof owner.id === 'string' &&
        owner.id.trim() &&
        owner.active !== false &&
        owner.schedulingEnabled !== false
    );
}

function routingReceipt(owner, source, routeKey) {
    return {
        owner: {
            id: owner.id,
            displayName: owner.displayName || null,
            role: owner.role || null
        },
        source,
        routeKey: routeKey || null,
        ruleVersion: ROUTING_RULE_VERSION
    };
}

function resolveBookingOwner(input) {
    const context = input || {};
    if (isSchedulableOwner(context.existingOwner)) {
        return routingReceipt(context.existingOwner, 'existing_attio_owner');
    }
    if (isSchedulableOwner(context.campaignOwner)) {
        return routingReceipt(context.campaignOwner, 'approved_campaign_owner');
    }

    const routeKey = qualificationRouteKey(context.qualification);
    const qualificationOwner = context.qualificationOwners && context.qualificationOwners[routeKey];
    if (isSchedulableOwner(qualificationOwner)) {
        return routingReceipt(qualificationOwner, 'qualification_rule', routeKey);
    }
    if (isSchedulableOwner(context.roundRobinOwner)) {
        return routingReceipt(context.roundRobinOwner, 'round_robin', routeKey);
    }
    if (isSchedulableOwner(context.fallbackOwner)) {
        return routingReceipt(context.fallbackOwner, 'fallback', routeKey);
    }
    const error = new Error('No schedulable booking owner is configured');
    error.code = 'BOOKING_OWNER_UNAVAILABLE';
    throw error;
}

module.exports = {
    ROUTING_RULE_VERSION,
    qualificationRouteKey,
    isSchedulableOwner,
    resolveBookingOwner
};
