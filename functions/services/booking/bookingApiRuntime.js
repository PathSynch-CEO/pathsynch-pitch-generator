'use strict';

const { createBookingPersistence } = require('./bookingPersistence');
const { createNylasSchedulingProvider } = require('./nylasSchedulingProvider');
const { createBookingOrchestrator } = require('./bookingOrchestrator');
const { createBookingApiRateLimiter } = require('./bookingApiRateLimiter');
const { ApiError, ErrorCodes } = require('../../middleware/errorHandler');

let runtime;
let rateLimiter;

function getBookingApiRateLimiter() {
    if (!rateLimiter) rateLimiter = createBookingApiRateLimiter();
    return rateLimiter;
}

function createBookingApiRuntime(options = {}) {
    const persistence = options.persistence || createBookingPersistence();
    let provider;
    try {
        provider = options.provider || (options.providerFactory || createNylasSchedulingProvider)();
    } catch (_) {
        throw new ApiError(
            ErrorCodes.SCHEDULING_PROVIDER_UNAVAILABLE,
            'The scheduling provider is not configured'
        );
    }
    return Object.freeze({
        persistence,
        orchestrator: (options.orchestratorFactory || createBookingOrchestrator)({ persistence, provider }),
        rateLimiter: options.rateLimiter || getBookingApiRateLimiter()
    });
}

function getBookingApiRuntime() {
    if (!runtime) runtime = createBookingApiRuntime();
    return runtime;
}

module.exports = { createBookingApiRuntime, getBookingApiRuntime, getBookingApiRateLimiter };
