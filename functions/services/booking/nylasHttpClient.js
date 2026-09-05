'use strict';

const DEFAULT_BASE_URL = 'https://api.us.nylas.com';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

const ERROR_CATEGORIES = Object.freeze({
    REJECTED: 'rejected',
    AMBIGUOUS: 'ambiguous',
    UNAVAILABLE: 'unavailable',
    MALFORMED: 'malformed'
});

class NylasHttpError extends Error {
    constructor(category, operation, options = {}) {
        super(options.message || 'Nylas request failed');
        this.name = 'NylasHttpError';
        this.code = 'NYLAS_HTTP_ERROR';
        this.category = category;
        this.operation = operation;
        this.status = options.status || null;
        this.providerErrorType = options.providerErrorType || null;
    }
}

function malformed(operation) {
    return new NylasHttpError(ERROR_CATEGORIES.MALFORMED, operation, {
        message: 'Nylas returned a malformed response'
    });
}

async function readBoundedText(response, maximumBytes, operation) {
    const length = Number(response.headers && response.headers.get
        ? response.headers.get('content-length')
        : NaN);
    if (Number.isFinite(length) && length > maximumBytes) throw malformed(operation);

    if (!response.body || typeof response.body.getReader !== 'function') {
        const text = await response.text();
        if (Buffer.byteLength(text, 'utf8') > maximumBytes) throw malformed(operation);
        return text;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maximumBytes) {
                await reader.cancel();
                throw malformed(operation);
            }
            chunks.push(Buffer.from(value));
        }
    } finally {
        if (reader.releaseLock) reader.releaseLock();
    }
    return Buffer.concat(chunks).toString('utf8');
}

function parseResponseText(text, operation) {
    if (!text) throw malformed(operation);
    try {
        return JSON.parse(text);
    } catch (_) {
        throw malformed(operation);
    }
}

function safeProviderType(payload) {
    const value = payload && payload.error && payload.error.type;
    return typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value) ? value : null;
}

function classifyHttpFailure(status, method) {
    if (method === 'POST' && (status === 408 || status === 425 || status === 429 || status >= 500)) {
        return ERROR_CATEGORIES.AMBIGUOUS;
    }
    if (status >= 400 && status < 500) return ERROR_CATEGORIES.REJECTED;
    return ERROR_CATEGORIES.UNAVAILABLE;
}

function createNylasHttpClient(options = {}) {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const apiKey = String(options.apiKey || '').trim();
    const baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    const maximumBytes = Number.isInteger(options.maximumBytes)
        ? options.maximumBytes
        : DEFAULT_MAX_RESPONSE_BYTES;
    if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
    if (!apiKey) {
        const error = new Error('Nylas scheduling is not configured');
        error.code = 'PROVIDER_NOT_CONFIGURED';
        throw error;
    }

    async function request({ method = 'GET', path, query, body, operation }) {
        const url = new URL(`${baseUrl}${path}`);
        for (const [key, value] of Object.entries(query || {})) {
            if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        let response;
        try {
            response = await fetchImpl(url, {
                method,
                headers: {
                    Accept: 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: controller.signal
            });
        } catch (error) {
            clearTimeout(timeout);
            const ambiguous = method === 'POST';
            throw new NylasHttpError(
                ambiguous ? ERROR_CATEGORIES.AMBIGUOUS : ERROR_CATEGORIES.UNAVAILABLE,
                operation,
                { message: controller.signal.aborted ? 'Nylas request timed out' : 'Nylas transport failed' }
            );
        }

        try {
            let text;
            try {
                text = await readBoundedText(response, maximumBytes, operation);
            } catch (error) {
                if (error instanceof NylasHttpError) throw error;
                throw new NylasHttpError(
                    method === 'POST' ? ERROR_CATEGORIES.AMBIGUOUS : ERROR_CATEGORIES.UNAVAILABLE,
                    operation,
                    { message: 'Nylas response transport failed' }
                );
            }
            if (!response.ok) {
                let payload = null;
                try {
                    payload = text ? JSON.parse(text) : null;
                } catch (_) {
                    // An error response body is advisory; status determines the safe classification.
                }
                throw new NylasHttpError(classifyHttpFailure(response.status, method), operation, {
                    status: response.status,
                    providerErrorType: safeProviderType(payload)
                });
            }
            const payload = parseResponseText(text, operation);
            if (!payload || typeof payload !== 'object' || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
                throw malformed(operation);
            }
            return payload.data;
        } finally {
            clearTimeout(timeout);
        }
    }

    return Object.freeze({ request });
}

module.exports = {
    DEFAULT_BASE_URL,
    DEFAULT_TIMEOUT_MS,
    DEFAULT_MAX_RESPONSE_BYTES,
    ERROR_CATEGORIES,
    NylasHttpError,
    createNylasHttpClient
};
