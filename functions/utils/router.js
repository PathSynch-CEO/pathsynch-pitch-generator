/**
 * Simple Router Utility
 *
 * Provides Express-like routing for Firebase Cloud Functions.
 * Supports path parameters (e.g., /users/:id) and method matching.
 */

class Router {
    constructor() {
        this.routes = [];
    }

    /**
     * Register a route handler
     * @param {string} method - HTTP method (GET, POST, PUT, PATCH, DELETE)
     * @param {string} pattern - URL pattern with optional params (e.g., /users/:id)
     * @param {...function} handlers - Middleware and handler functions
     */
    route(method, pattern, ...handlers) {
        const regex = this._patternToRegex(pattern);
        const paramNames = this._extractParamNames(pattern);

        this.routes.push({
            method: method.toUpperCase(),
            pattern,
            regex,
            paramNames,
            handlers
        });

        return this;
    }

    // Convenience methods
    get(pattern, ...handlers) {
        return this.route('GET', pattern, ...handlers);
    }

    post(pattern, ...handlers) {
        return this.route('POST', pattern, ...handlers);
    }

    put(pattern, ...handlers) {
        return this.route('PUT', pattern, ...handlers);
    }

    patch(pattern, ...handlers) {
        return this.route('PATCH', pattern, ...handlers);
    }

    delete(pattern, ...handlers) {
        return this.route('DELETE', pattern, ...handlers);
    }

    /**
     * Match a request to a route
     * @param {string} method - HTTP method
     * @param {string} path - Request path
     * @returns {object|null} Matched route with params, or null
     */
    match(method, path) {
        for (const route of this.routes) {
            if (route.method !== method.toUpperCase()) continue;

            const match = path.match(route.regex);
            if (match) {
                // Extract params
                const params = {};
                route.paramNames.forEach((name, index) => {
                    params[name] = match[index + 1];
                });

                return {
                    handlers: route.handlers,
                    params,
                    pattern: route.pattern
                };
            }
        }

        return null;
    }

    /**
     * Handle a request
     * @param {object} req - Express-like request object
     * @param {object} res - Express-like response object
     * @returns {Promise<boolean>} True if handled, false if no match
     */
    async handle(req, res) {
        const matched = this.match(req.method, req.path);

        if (!matched) {
            return false;
        }

        // Attach params to request
        req.params = { ...req.params, ...matched.params };

        // Run handlers in sequence (middleware pattern)
        for (const handler of matched.handlers) {
            let nextCalled = false;
            const next = () => { nextCalled = true; };

            await handler(req, res, next);

            // If response was sent or next() not called, stop
            if (res.headersSent || !nextCalled) {
                break;
            }
        }

        return true;
    }

    /**
     * Convert a route pattern to a regex
     * @private
     */
    _patternToRegex(pattern) {
        // Use placeholder for param captures to avoid escaping issues
        const PARAM_PLACEHOLDER = '___PARAM___';

        // First, replace :param with placeholder
        let regexStr = pattern
            .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, PARAM_PLACEHOLDER);

        // Escape special regex chars
        regexStr = regexStr
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Replace placeholder with actual capture group
        regexStr = regexStr
            .replace(new RegExp(PARAM_PLACEHOLDER, 'g'), '([^/]+)');

        return new RegExp(`^${regexStr}$`);
    }

    /**
     * Extract parameter names from a pattern
     * @private
     */
    _extractParamNames(pattern) {
        const names = [];
        const regex = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
        let match;
        while ((match = regex.exec(pattern)) !== null) {
            names.push(match[1]);
        }
        return names;
    }

    /**
     * Get all registered routes (for documentation/debugging)
     */
    getRoutes() {
        return this.routes.map(r => ({
            method: r.method,
            pattern: r.pattern
        }));
    }
}

/**
 * Create a new router instance
 */
function createRouter() {
    return new Router();
}

/**
 * Combine multiple routers
 * @param {Router[]} routers - Array of routers to combine
 * @returns {Router} Combined router
 */
function combineRouters(...routers) {
    const combined = new Router();
    for (const router of routers) {
        combined.routes.push(...router.routes);
    }
    return combined;
}

module.exports = {
    Router,
    createRouter,
    combineRouters
};
