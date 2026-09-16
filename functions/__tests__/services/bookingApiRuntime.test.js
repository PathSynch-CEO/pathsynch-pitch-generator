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
        const hostDirectory = {};
        const mailer = {};
        const orchestrator = {};
        const cancellation = {};
        const rateLimiter = {};
        const orchestratorFactory = jest.fn().mockReturnValue(orchestrator);
        const cancellationFactory = jest.fn().mockReturnValue(cancellation);

        expect(createBookingApiRuntime({
            persistence,
            provider,
            hostDirectory,
            mailer,
            orchestratorFactory,
            cancellationFactory,
            rateLimiter
        })).toEqual({ persistence, hostDirectory, mailer, orchestrator, cancellation, rateLimiter });
        expect(orchestratorFactory).toHaveBeenCalledWith({ persistence, provider, hostDirectory, mailer });
        expect(cancellationFactory).toHaveBeenCalledWith({ persistence, provider, mailer });
    });

    test('wires the production cancellation evidence verifier into persistence construction', () => {
        const verifiedEvidence = jest.fn();
        const cancellationDeliveryEvidence = { verify: verifiedEvidence };
        const persistence = {};
        const persistenceFactory = jest.fn().mockReturnValue(persistence);
        const provider = {};
        const hostDirectory = {};
        const mailer = {};
        const orchestratorFactory = jest.fn().mockReturnValue({});
        const cancellationFactory = jest.fn().mockReturnValue({});

        createBookingApiRuntime({
            persistenceFactory,
            cancellationDeliveryEvidence,
            provider,
            hostDirectory,
            mailer,
            orchestratorFactory,
            cancellationFactory,
            rateLimiter: {}
        });

        expect(persistenceFactory).toHaveBeenCalledWith({
            verifyCancellationDeliveryEvidence: verifiedEvidence
        });
    });
});
