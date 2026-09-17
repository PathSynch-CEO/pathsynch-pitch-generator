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

    test('composes governed recovery only when provider readback is supported', () => {
        const recoveryPersistence = {};
        const recovery = {};
        const recoveryPersistenceFactory = jest.fn().mockReturnValue(recoveryPersistence);
        const recoveryFactory = jest.fn().mockReturnValue(recovery);
        const provider = {
            getBooking: jest.fn(),
            getEvent: jest.fn()
        };
        const persistence = {};
        const mailer = {};

        const result = createBookingApiRuntime({
            persistence,
            provider,
            hostDirectory: {},
            mailer,
            orchestratorFactory: jest.fn().mockReturnValue({}),
            cancellationFactory: jest.fn().mockReturnValue({}),
            recoveryPersistenceFactory,
            recoveryFactory,
            cancellationDeliveryEvidence: { verify: jest.fn(), write: jest.fn() },
            rateLimiter: {}
        });

        expect(recoveryPersistenceFactory).toHaveBeenCalledTimes(1);
        expect(recoveryFactory).toHaveBeenCalledWith({
            persistence: recoveryPersistence,
            provider,
            mailer,
            evidenceStore: expect.objectContaining({ verify: expect.any(Function) })
        });
        expect(result).toEqual(expect.objectContaining({ recoveryPersistence, recovery }));
    });

    test('keeps the legacy runtime shape when provider readback is unavailable', () => {
        const recoveryPersistenceFactory = jest.fn();
        const recoveryFactory = jest.fn();
        const result = createBookingApiRuntime({
            persistence: {},
            provider: {},
            hostDirectory: {},
            mailer: {},
            orchestratorFactory: jest.fn().mockReturnValue({}),
            cancellationFactory: jest.fn().mockReturnValue({}),
            recoveryPersistenceFactory,
            recoveryFactory,
            rateLimiter: {}
        });

        expect(recoveryPersistenceFactory).not.toHaveBeenCalled();
        expect(recoveryFactory).not.toHaveBeenCalled();
        expect(result).not.toHaveProperty('recovery');
        expect(result).not.toHaveProperty('recoveryPersistence');
    });
});
