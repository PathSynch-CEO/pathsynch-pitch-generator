'use strict';

const REQUIRED_METHODS = Object.freeze([
    'getAvailability',
    'createBooking',
    'rescheduleBooking',
    'cancelBooking',
    'verifyWebhook'
]);

function providerError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function assertSchedulingProvider(provider) {
    if (!provider || REQUIRED_METHODS.some((method) => typeof provider[method] !== 'function')) {
        throw providerError('INVALID_SCHEDULING_PROVIDER', 'Scheduling provider does not satisfy the booking contract');
    }
    return provider;
}

function createUnconfiguredSchedulingProvider(name = 'nylas') {
    const reject = async () => {
        throw providerError('PROVIDER_NOT_CONFIGURED', `${name} scheduling is not configured`);
    };
    return Object.freeze({
        name,
        configured: false,
        getAvailability: reject,
        createBooking: reject,
        rescheduleBooking: reject,
        cancelBooking: reject,
        verifyWebhook: reject
    });
}

module.exports = {
    REQUIRED_METHODS,
    assertSchedulingProvider,
    createUnconfiguredSchedulingProvider
};
