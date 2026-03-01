/**
 * Error Handling Middleware
 *
 * Provides consistent, secure error responses that don't leak internal details.
 */

// Error codes for common scenarios
const ErrorCodes = {
    // 400 errors
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    BAD_REQUEST: 'BAD_REQUEST',
    MISSING_FIELD: 'MISSING_FIELD',
    INVALID_INPUT: 'INVALID_INPUT',
    // 401/403 errors
    AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
    UNAUTHORIZED: 'UNAUTHORIZED',
    AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
    SESSION_EXPIRED: 'SESSION_EXPIRED',
    // 404 errors
    NOT_FOUND: 'NOT_FOUND',
    RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
    USER_NOT_FOUND: 'USER_NOT_FOUND',
    PITCH_NOT_FOUND: 'PITCH_NOT_FOUND',
    // 409 errors
    CONFLICT: 'CONFLICT',
    ALREADY_EXISTS: 'ALREADY_EXISTS',
    // 429 errors
    RATE_LIMIT: 'RATE_LIMIT',
    LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
    PITCH_LIMIT_REACHED: 'PITCH_LIMIT_REACHED',
    // 500 errors
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
    AI_SERVICE_ERROR: 'AI_SERVICE_ERROR',
    DATABASE_ERROR: 'DATABASE_ERROR'
};

// User-friendly error messages (don't expose internals)
const ErrorMessages = {
    [ErrorCodes.VALIDATION_ERROR]: 'Invalid request data',
    [ErrorCodes.BAD_REQUEST]: 'Invalid request',
    [ErrorCodes.MISSING_FIELD]: 'Required field is missing',
    [ErrorCodes.INVALID_INPUT]: 'Invalid input provided',
    [ErrorCodes.AUTHENTICATION_ERROR]: 'Authentication required',
    [ErrorCodes.UNAUTHORIZED]: 'Authentication required',
    [ErrorCodes.AUTHORIZATION_ERROR]: 'You don\'t have permission for this action',
    [ErrorCodes.SESSION_EXPIRED]: 'Your session has expired. Please log in again.',
    [ErrorCodes.NOT_FOUND]: 'Resource not found',
    [ErrorCodes.RESOURCE_NOT_FOUND]: 'The requested resource was not found',
    [ErrorCodes.USER_NOT_FOUND]: 'User not found',
    [ErrorCodes.PITCH_NOT_FOUND]: 'Pitch not found',
    [ErrorCodes.CONFLICT]: 'Resource conflict',
    [ErrorCodes.ALREADY_EXISTS]: 'This resource already exists',
    [ErrorCodes.RATE_LIMIT]: 'Too many requests. Please try again later.',
    [ErrorCodes.LIMIT_EXCEEDED]: 'You have reached your plan limit',
    [ErrorCodes.PITCH_LIMIT_REACHED]: 'Monthly pitch limit reached. Please upgrade your plan.',
    [ErrorCodes.INTERNAL_ERROR]: 'An unexpected error occurred. Please try again.',
    [ErrorCodes.EXTERNAL_SERVICE_ERROR]: 'A service is temporarily unavailable. Please try again.',
    [ErrorCodes.AI_SERVICE_ERROR]: 'AI service is temporarily unavailable. Please try again.',
    [ErrorCodes.DATABASE_ERROR]: 'Database error. Please try again.'
};

// HTTP status codes for error types
const ErrorStatus = {
    // 400 errors
    [ErrorCodes.VALIDATION_ERROR]: 400,
    [ErrorCodes.BAD_REQUEST]: 400,
    [ErrorCodes.MISSING_FIELD]: 400,
    [ErrorCodes.INVALID_INPUT]: 400,
    // 401/403 errors
    [ErrorCodes.AUTHENTICATION_ERROR]: 401,
    [ErrorCodes.UNAUTHORIZED]: 401,
    [ErrorCodes.SESSION_EXPIRED]: 401,
    [ErrorCodes.AUTHORIZATION_ERROR]: 403,
    // 404 errors
    [ErrorCodes.NOT_FOUND]: 404,
    [ErrorCodes.RESOURCE_NOT_FOUND]: 404,
    [ErrorCodes.USER_NOT_FOUND]: 404,
    [ErrorCodes.PITCH_NOT_FOUND]: 404,
    // 409 errors
    [ErrorCodes.CONFLICT]: 409,
    [ErrorCodes.ALREADY_EXISTS]: 409,
    // 429 errors
    [ErrorCodes.RATE_LIMIT]: 429,
    [ErrorCodes.LIMIT_EXCEEDED]: 429,
    [ErrorCodes.PITCH_LIMIT_REACHED]: 429,
    // 500 errors
    [ErrorCodes.INTERNAL_ERROR]: 500,
    [ErrorCodes.DATABASE_ERROR]: 500,
    [ErrorCodes.EXTERNAL_SERVICE_ERROR]: 503,
    [ErrorCodes.AI_SERVICE_ERROR]: 503
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

/**
 * Helper to quickly throw common errors
 * Usage: throw notFound('Pitch') or throw badRequest('Email is required')
 */
const notFound = (resource = 'Resource') => new ApiError(ErrorCodes.NOT_FOUND, `${resource} not found`);
const badRequest = (message) => new ApiError(ErrorCodes.BAD_REQUEST, message);
const unauthorized = (message = 'Authentication required') => new ApiError(ErrorCodes.UNAUTHORIZED, message);
const forbidden = (message = "You don't have permission for this action") => new ApiError(ErrorCodes.AUTHORIZATION_ERROR, message);
const conflict = (message) => new ApiError(ErrorCodes.CONFLICT, message);
const rateLimited = (message = 'Too many requests') => new ApiError(ErrorCodes.RATE_LIMIT, message);
const serverError = (message = 'An unexpected error occurred') => new ApiError(ErrorCodes.INTERNAL_ERROR, message);

module.exports = {
    ErrorCodes,
    ErrorMessages,
    ApiError,
    isOperationalError,
    createErrorResponse,
    handleError,
    asyncHandler,
    mapError,
    getErrorForLogging,
    // Error helpers
    notFound,
    badRequest,
    unauthorized,
    forbidden,
    conflict,
    rateLimited,
    serverError
};
