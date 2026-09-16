'use strict';

const { createRouter } = require('../utils/router');
const {
    CancellationDeliveryEvidenceError,
    getCancellationDeliveryEvidenceStore
} = require('../services/booking/bookingCancellationDeliveryEvidence');

function createSendGridEventWebhookRouter(options = {}) {
    const router = createRouter();
    const getStore = options.getStore || getCancellationDeliveryEvidenceStore;
    router.post('/sendgrid/events', async (req, res) => {
        try {
            await getStore().ingestSignedWebhook(req);
            return res.status(204).send();
        } catch (error) {
            const status = error instanceof CancellationDeliveryEvidenceError ? error.status : 503;
            if (status === 503 && error && Number.isSafeInteger(error.retryAfterSeconds)
                && error.retryAfterSeconds > 0) {
                res.set('Retry-After', String(error.retryAfterSeconds));
            }
            return res.status(status).json({
                success: false,
                error: status === 503
                    ? 'SendGrid event verification is unavailable'
                    : 'SendGrid event request was rejected'
            });
        }
    });
    return router;
}

module.exports = createSendGridEventWebhookRouter();
module.exports.createSendGridEventWebhookRouter = createSendGridEventWebhookRouter;
