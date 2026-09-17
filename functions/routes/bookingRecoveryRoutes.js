'use strict';

const { createRouter } = require('../utils/router');
const { requireRecoveryOperator } = require('../middleware/adminAuth');
const { requireRecoveryRateLimit } = require('../services/booking/bookingRecoveryRateLimiter');
const { getBookingApiRuntime } = require('../services/booking/bookingApiRuntime');
const { normalizeRecoveryOperationId } = require('../services/booking/bookingRecoveryPersistence');
const { ApiError, ErrorCodes, handleError } = require('../middleware/errorHandler');

const MAX_BODY_BYTES = 4 * 1024;

function assertNoQuery(req) {
    if (req.query && Object.keys(req.query).length) {
        throw new ApiError(ErrorCodes.INVALID_INPUT, 'Query parameters are not supported');
    }
}

function decodePathParameter(value) {
    try {
        return decodeURIComponent(String(value || ''));
    } catch (_) {
        throw new ApiError(ErrorCodes.INVALID_INPUT, 'Recovery path parameter is invalid');
    }
}

function assertJsonBody(req, allowed) {
    const contentType = String(req.get?.('content-type') || req.headers?.['content-type'] || '').toLowerCase();
    if (contentType.split(';', 1)[0].trim() !== 'application/json') {
        throw new ApiError(ErrorCodes.UNSUPPORTED_MEDIA_TYPE, 'Content type must be application/json');
    }
    const body = req.body;
    const parsedBytes = Buffer.byteLength(JSON.stringify(body === undefined ? null : body));
    const rawBytes = Buffer.isBuffer(req.rawBody) ? req.rawBody.length : 0;
    if (Math.max(parsedBytes, rawBytes) > MAX_BODY_BYTES) {
        throw new ApiError(ErrorCodes.REQUEST_TOO_LARGE, 'Request body is too large');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).some((key) => !allowed.has(key))) {
        throw new ApiError(ErrorCodes.INVALID_INPUT, 'Recovery request is invalid');
    }
    return body;
}

function createBookingRecoveryRouter(options = {}) {
    const router = createRouter();
    const authorize = options.authorize || requireRecoveryOperator;
    const rateLimit = options.rateLimit || requireRecoveryRateLimit;
    const getRuntime = options.getRuntime || getBookingApiRuntime;

    router.get('/admin/synchintro/synthetic-recovery', authorize, rateLimit, async (req, res) => {
        try {
            assertNoQuery(req);
            const data = await getRuntime().recovery.inventory();
            return res.status(200).json({ success: true, data });
        } catch (error) {
            return handleError(error, res, 'SynchIntro synthetic recovery inventory');
        }
    });

    router.get('/admin/synchintro/synthetic-recovery/receipts/:recoveryOperationId', authorize, rateLimit, async (req, res) => {
        try {
            assertNoQuery(req);
            const recoveryOperationId = normalizeRecoveryOperationId(
                decodePathParameter(req.params.recoveryOperationId)
            );
            const receipt = await getRuntime().recoveryPersistence.readReceipt(
                recoveryOperationId,
                req.recoveryActor
            );
            return res.status(200).json({ success: true, data: receipt });
        } catch (error) {
            return handleError(error, res, 'SynchIntro synthetic recovery receipt');
        }
    });

    router.get('/admin/synchintro/synthetic-recovery/:reference', authorize, rateLimit, async (req, res) => {
        try {
            assertNoQuery(req);
            const data = await getRuntime().recovery.inspect(req.params.reference);
            return res.status(200).json({ success: true, data });
        } catch (error) {
            return handleError(error, res, 'SynchIntro synthetic recovery inspect');
        }
    });

    router.post('/admin/synchintro/synthetic-recovery/:reference/dry-run', authorize, rateLimit, async (req, res) => {
        try {
            assertNoQuery(req);
            assertJsonBody(req, new Set());
            const data = await getRuntime().recovery.dryRun(req.params.reference, req.recoveryActor);
            return res.status(200).json({ success: true, data });
        } catch (error) {
            return handleError(error, res, 'SynchIntro synthetic recovery dry-run');
        }
    });

    router.post('/admin/synchintro/synthetic-recovery/:reference/execute', authorize, rateLimit, async (req, res) => {
        try {
            assertNoQuery(req);
            const body = assertJsonBody(req, new Set(['recovery_operation_id']));
            if (Object.keys(body).length !== 1) {
                throw new ApiError(ErrorCodes.INVALID_INPUT, 'Recovery request is invalid');
            }
            const recoveryOperationId = normalizeRecoveryOperationId(body.recovery_operation_id);
            const data = await getRuntime().recovery.execute({
                reference: req.params.reference,
                recovery_operation_id: recoveryOperationId,
                actor: req.recoveryActor
            });
            return res.status(200).json({ success: true, data });
        } catch (error) {
            return handleError(error, res, 'SynchIntro synthetic recovery execute');
        }
    });

    return router;
}

const bookingRecoveryRoutes = createBookingRecoveryRouter();

module.exports = bookingRecoveryRoutes;
module.exports.createBookingRecoveryRouter = createBookingRecoveryRouter;
module.exports.MAX_BODY_BYTES = MAX_BODY_BYTES;
