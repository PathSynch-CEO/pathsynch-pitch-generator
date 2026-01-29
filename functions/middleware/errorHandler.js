/**
 * Error Handling Middleware
 *
 * Provides consistent, secure error responses that don't leak internal details.
 */

// Error codes for common scenarios
const ErrorCodes = {
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
    AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
    NOT_FOUND: 'NOT_FOUND',
    RATE_LIMIT: 'RATE_LIMIT',
    CONFLICT: 'CONFLICT',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
    BAD_REQUEST: 'BAD_REQUEST'
};

// User-friendly error messages (don't expose internals)
const ErrorMessages = {
    [ErrorCodes.VALIDATION_ERROR]: 'Invalid request data',
    [ErrorCodes.AUTHENTICATION_ERROR]: 'Authentication required',
    [ErrorCodes.AUTHORIZATION_ERROR]: 'Access denied',
    [ErrorCodes.NOT_FOUND]: 'Resource not found',
    [ErrorCodes.RATE_LIMIT]: 'Too many requests. Please try again later.',
    [ErrorCodes.CONFLICT]: 'Resource conflict',
    [ErrorCodes.INTERNAL_ERROR]: 'An unexpected error occurred. Please try again.',
    [ErrorCodes.EXTERNAL_SERVICE_ERROR]: 'A service is temporarily unavailable. Please try again.',
    [ErrorCodes.BAD_REQUEST]: 'Invalid request'
};

// HTTP status codes for error types
const ErrorStatus = {
    [ErrorCodes.VALIDATION_ERROR]: 400,
    [ErrorCodes.AUTHENTICATION_ERROR]: 401,
    [ErrorCodes.AUTHORIZATION_ERROR]: 403,
    [ErrorCodes.NOT_FOUND]: 404,
    [ErrorCodes.RATE_LIMIT]: 429,
    [ErrorCodes.CONFLICT]: 409,
    [ErrorCodes.INTERNAL_ERROR]: 500,
    [ErrorCodes.EXTERNAL_SERVICE_ERROR]: 503,
    [ErrorCodes.BAD_REQUEST]: 400
};

/**
 * Custom API Error class
 */
class ApiError extends Error {
    constructor(code, message = null, details = null) {
        super(message || ErrorMessages[code] || 'Unknown error');
        this.code = code;
        this.status = ErrorStatus[code] || 500;
        this.details = details;
        this.isOperational = true; // Distinguishes from programming errors
    }
}

/**
 * Determines if an error is operational (expected) vs programming error
 */
function isOperationalError(error) {
    if (error instanceof ApiError) {
        return error.isOperational;
    }
    return false;
}

/**
 * Safely extracts error information for logging
 */
function getErrorForLogging(error) {
    return {
        message: error.message,
        stack: error.stack,
        code: error.code,
        name: error.name,
        ...(error.details && { details: error.details })
    };
}

/**
 * Creates a safe error response for clients
 * In production, internal error details are hidden
 */
function createErrorResponse(error, includeDetails = false) {
    const isProduction = process.env.NODE_ENV === 'production';

    // For operational errors, we can be more specific
    if (error instanceof ApiError) {
        return {
            success: false,
            error: error.message,
            code: error.code,
            ...(error.details && { details: error.details })
        };
    }

    // For unknown errors, return generic message in production
    if (isProduction && !includeDetails) {
        return {
            success: false,
            error: ErrorMessages[ErrorCodes.INTERNAL_ERROR],
            code: ErrorCodes.INTERNAL_ERROR
        };
    }

    // In development, include more details for debugging
    return {
        success: false,
        error: error.message || 'Unknown error',
        code: ErrorCodes.INTERNAL_ERROR,
        ...(includeDetails && { stack: error.stack })
    };
}

/**
 * Handles an error and sends appropriate response
 * @param {Error} error - The error to handle
 * @param {object} res - Express response object
 * @param {string} context - Context for logging (e.g., endpoint name)
 */
function handleError(error, res, context = 'API') {
    // Log the full error for debugging
    console.error(`[${context}] Error:`, getErrorForLogging(error));

    // Get status code
    const status = error instanceof ApiError ? error.status : 500;

    // Send safe response
    const response = createErrorResponse(error);
    return res.status(status).json(response);
}

/**
 * Wraps an async handler to catch errors
 */
function asyncHandler(fn, context = 'API') {
    return async (req, res, next) => {
        try {
            await fn(req, res, next);
        } catch (error) {
            handleError(error, res, context);
        }
    };
}

/**
 * Maps common error types to ApiError
 */
function mapError(error) {
    // Firebase Auth errors
    if (error.code?.startsWith('auth/')) {
        return new ApiError(ErrorCodes.AUTHENTICATION_ERROR);
    }

    // Firestore errors
    if (error.code === 'permission-denied') {
        return new ApiError(ErrorCodes.AUTHORIZATION_ERROR);
    }
    if (error.code === 'not-found') {
        return new ApiError(ErrorCodes.NOT_FOUND);
    }

    // Stripe errors
    if (error.type?.startsWith('Stripe')) {
        return new ApiError(ErrorCodes.EXTERNAL_SERVICE_ERROR, 'Payment service error');
    }

    // Validation errors (Joi)
    if (error.isJoi) {
        return new ApiError(ErrorCodes.VALIDATION_ERROR, 'Validation failed',
            error.details?.map(d => ({ field: d.path.join('.'), message: d.message }))
        );
    }

    // Return as-is if already an ApiError
    if (error instanceof ApiError) {
        return error;
    }

    // Unknown error - wrap in generic error
    return new ApiError(ErrorCodes.INTERNAL_ERROR);
}

module.exports = {
    ErrorCodes,
    ErrorMessages,
    ApiError,
    isOperationalError,
    createErrorResponse,
    handleError,
    asyncHandler,
    mapError,
    getErrorForLogging
};
