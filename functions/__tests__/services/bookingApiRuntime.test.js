'use strict';

const { createBookingApiRuntime } = require('../../services/booking/bookingApiRuntime');

describe('SynchIntro booking API runtime', () => {
    test('normalizes provider configuration failures without leaking the provider error', () => {
        const secret = 'secret-api-key-value';
        const providerFactory = () => {
            throw new Error(`provider failed with ${secret}`);
        };

        let received;
        try {
            createBookingApiRuntime({ persistence: {}, providerFactory });
        } catch (error) {
            received = error;
        }

        expect(received).toMatchObject({
            code: 'SCHEDULING_PROVIDER_UNAVAILABLE',
            status: 503,
            message: 'The scheduling provider is not configured',
            details: null
        });
        expect(JSON.stringify(received)).not.toContain(secret);
    });

    test('constructs orchestration only behind the injected runtime boundary', () => {
        const persistence = {};
        const provider = {};
        const orchestrator = {};
        const rateLimiter = {};
        const orchestratorFactory = jest.fn().mockReturnValue(orchestrator);

        expect(createBookingApiRuntime({
            persistence,
            provider,
            orchestratorFactory,
            rateLimiter
        })).toEqual({ persistence, orchestrator, rateLimiter });
        expect(orchestratorFactory).toHaveBeenCalledWith({ persistence, provider });
    });
});
