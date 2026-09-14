'use strict';

const { createBookingPersistence } = require('./bookingPersistence');
const { createNylasSchedulingProvider } = require('./nylasSchedulingProvider');
const { createBookingOrchestrator } = require('./bookingOrchestrator');
const { createBookingHostDirectory } = require('./bookingHostDirectory');
const { createBookingConfirmationMailer } = require('./bookingConfirmationEmail');
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
    let hostDirectory;
    let mailer;
    try {
        provider = options.provider || (options.providerFactory || createNylasSchedulingProvider)();
        hostDirectory = options.hostDirectory || (options.hostDirectoryFactory || createBookingHostDirectory)();
        mailer = options.mailer || (options.mailerFactory || createBookingConfirmationMailer)();
    } catch (_) {
        throw new ApiError(
            ErrorCodes.SCHEDULING_PROVIDER_UNAVAILABLE,
            'The scheduling provider is not configured'
        );
    }
    return Object.freeze({
        persistence,
        hostDirectory,
        mailer,
        orchestrator: (options.orchestratorFactory || createBookingOrchestrator)({
            persistence, provider, hostDirectory, mailer
        }),
        rateLimiter: options.rateLimiter || getBookingApiRateLimiter()
    });
}

function getBookingApiRuntime() {
    if (!runtime) runtime = createBookingApiRuntime();
    return runtime;
}

module.exports = { createBookingApiRuntime, getBookingApiRuntime, getBookingApiRateLimiter };
