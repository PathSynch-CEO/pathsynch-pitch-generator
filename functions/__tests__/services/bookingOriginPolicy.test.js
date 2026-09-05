'use strict';

const {
    bookingAllowedOrigins,
    corsOptionsForRequest,
    isBookingApiRequest
} = require('../../services/booking/bookingOriginPolicy');

function evaluateOrigin(options, origin) {
    return new Promise((resolve) => {
        options.origin(origin, (error, allowed) => resolve({ error, allowed }));
    });
}

describe('SynchIntro booking origin policy', () => {
    const production = {
        NODE_ENV: 'production',
        SYNCHINTRO_ALLOWED_ORIGINS: 'https://approved.example,* ,http://localhost:3000'
    };

    test('recognizes both supported version prefixes', () => {
        expect(isBookingApiRequest({ path: '/v1/booking-sessions' })).toBe(true);
        expect(isBookingApiRequest({ path: '/api/v1/booking-sessions/bks_1/availability' })).toBe(true);
        expect(isBookingApiRequest({ path: '/v1/health' })).toBe(false);
    });

    test('keeps production booking origins exact and never enables wildcard or localhost', () => {
        expect(bookingAllowedOrigins(production)).toEqual(['https://approved.example']);
    });

    test('allows an approved production browser origin and rejects an unapproved one', async () => {
        const options = corsOptionsForRequest({ path: '/v1/booking-sessions' }, production);
        await expect(evaluateOrigin(options, 'https://approved.example'))
            .resolves.toEqual({ error: null, allowed: true });
        const denied = await evaluateOrigin(options, 'https://evil.example');
        expect(denied.error).toBeInstanceOf(Error);
        expect(denied.allowed).toBeUndefined();
    });

    test('rejects no-Origin production requests and allows them only in local runtimes', async () => {
        const productionOptions = corsOptionsForRequest({ path: '/v1/booking-sessions' }, production);
        const denied = await evaluateOrigin(productionOptions, undefined);
        expect(denied.error).toBeInstanceOf(Error);
        expect(denied.allowed).toBeUndefined();

        const testOptions = corsOptionsForRequest(
            { path: '/v1/booking-sessions' },
            { NODE_ENV: 'test', SYNCHINTRO_ALLOWED_ORIGINS: 'http://localhost:3000' }
        );
        await expect(evaluateOrigin(testOptions, undefined))
            .resolves.toEqual({ error: null, allowed: true });
    });
});
