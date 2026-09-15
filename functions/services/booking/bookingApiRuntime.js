'use strict';

const { createBookingPersistence } = require('./bookingPersistence');
const { createNylasSchedulingProvider } = require('./nylasSchedulingProvider');
const { createBookingOrchestrator } = require('./bookingOrchestrator');
const { createBookingCancellationService } = require('./bookingCancellation');
const { createBookingHostDirectory } = require('./bookingHostDirectory');
const { createBookingConfirmationMailer } = require('./bookingConfirmationEmail');
const { createBookingApiRateLimiter } = require('./bookingApiRateLimiter');
const { createCancellationDeliveryEvidenceStore } = require('./bookingCancellationDeliveryEvidence');
const { ApiError, ErrorCodes } = require('../../middleware/errorHandler');

let runtime;
let rateLimiter;

function getBookingApiRateLimiter() {
    if (!rateLimiter) rateLimiter = createBookingApiRateLimiter();
    return rateLimiter;
}

function createBookingApiRuntime(options = {}) {
    const cancellationDeliveryEvidence = options.cancellationDeliveryEvidence
        || (!options.persistence ? createCancellationDeliveryEvidenceStore() : null);
    const persistence = options.persistence || (options.persistenceFactory || createBookingPersistence)({
        verifyCancellationDeliveryEvidence: cancellationDeliveryEvidence.verify
    });
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
    const orchestrator = (options.orchestratorFactory || createBookingOrchestrator)({
        persistence, provider, hostDirectory, mailer
    });
    const cancellation = (options.cancellationFactory || createBookingCancellationService)({
        persistence, provider, mailer
    });
    return Object.freeze({
        persistence,
        hostDirectory,
        mailer,
        orchestrator,
        cancellation,
        rateLimiter: options.rateLimiter || getBookingApiRateLimiter()
    });
}

function getBookingApiRuntime() {
    if (!runtime) runtime = createBookingApiRuntime();
    return runtime;
}

module.exports = { createBookingApiRuntime, getBookingApiRuntime, getBookingApiRateLimiter };
