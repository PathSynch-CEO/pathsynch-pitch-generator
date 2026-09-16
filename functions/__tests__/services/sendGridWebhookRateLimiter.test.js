'use strict';

const {
    createSendGridWebhookRateLimiter
} = require('../../services/booking/sendGridWebhookRateLimiter');

describe('SendGrid signed-webhook abuse limiter', () => {
    test('bounds a window and provides retry guidance without external state', async () => {
        let clock = 1_000;
        const enforce = createSendGridWebhookRateLimiter({
            now: () => clock,
            windowMs: 10_000,
            requestsPerWindow: 2
        });

        await expect(enforce()).resolves.toEqual({ allowed: true, remaining: 1 });
        await expect(enforce()).resolves.toEqual({ allowed: true, remaining: 0 });
        await expect(enforce()).resolves.toEqual({ allowed: false, retryAfterSeconds: 10 });

        clock = 11_000;
        await expect(enforce()).resolves.toEqual({ allowed: true, remaining: 1 });
    });

    test('fails closed when its clock is invalid', async () => {
        const enforce = createSendGridWebhookRateLimiter({ now: () => Number.NaN });
        await expect(enforce()).rejects.toThrow('rate-limit clock is invalid');
    });
});
