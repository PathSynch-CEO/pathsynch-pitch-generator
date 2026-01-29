/**
 * Router Utility Tests
 */

const { Router, createRouter, combineRouters } = require('../../utils/router');

describe('Router', () => {
  let router;

  beforeEach(() => {
    router = createRouter();
  });

  describe('createRouter', () => {
    it('should create a new Router instance', () => {
      const r = createRouter();
      expect(r).toBeInstanceOf(Router);
      expect(r.routes).toEqual([]);
    });
  });

  describe('route registration', () => {
    it('should register GET routes', () => {
      router.get('/users', () => {});
      expect(router.routes).toHaveLength(1);
      expect(router.routes[0].method).toBe('GET');
      expect(router.routes[0].pattern).toBe('/users');
    });

    it('should register POST routes', () => {
      router.post('/users', () => {});
      expect(router.routes[0].method).toBe('POST');
    });

    it('should register PUT routes', () => {
      router.put('/users/:id', () => {});
      expect(router.routes[0].method).toBe('PUT');
    });

    it('should register PATCH routes', () => {
      router.patch('/users/:id', () => {});
      expect(router.routes[0].method).toBe('PATCH');
    });

    it('should register DELETE routes', () => {
      router.delete('/users/:id', () => {});
      expect(router.routes[0].method).toBe('DELETE');
    });

    it('should support method chaining', () => {
      router
        .get('/users', () => {})
        .post('/users', () => {})
        .delete('/users/:id', () => {});

      expect(router.routes).toHaveLength(3);
    });

    it('should register multiple handlers', () => {
      const middleware = () => {};
      const handler = () => {};

      router.get('/users', middleware, handler);
      expect(router.routes[0].handlers).toHaveLength(2);
    });
  });

  describe('route matching', () => {
    it('should match exact paths', () => {
      router.get('/users', () => {});

      const match = router.match('GET', '/users');
      expect(match).not.toBeNull();
      expect(match.pattern).toBe('/users');
    });

    it('should not match different paths', () => {
      router.get('/users', () => {});

      const match = router.match('GET', '/posts');
      expect(match).toBeNull();
    });

    it('should not match different methods', () => {
      router.get('/users', () => {});

      const match = router.match('POST', '/users');
      expect(match).toBeNull();
    });

    it('should extract path parameters', () => {
      router.get('/users/:id', () => {});

      const match = router.match('GET', '/users/123');
      expect(match).not.toBeNull();
      expect(match.params).toEqual({ id: '123' });
    });

    it('should extract multiple path parameters', () => {
      router.get('/users/:userId/posts/:postId', () => {});

      const match = router.match('GET', '/users/123/posts/456');
      expect(match).not.toBeNull();
      expect(match.params.userId).toBe('123');
      expect(match.params.postId).toBe('456');
    });

    it('should match paths with static segments between params', () => {
      router.get('/pitch/share/:shareId', () => {});

      const match = router.match('GET', '/pitch/share/abc123');
      expect(match).not.toBeNull();
      expect(match.params.shareId).toBe('abc123');
    });

    it('should handle paths with special characters in params', () => {
      router.get('/files/:filename', () => {});

      const match = router.match('GET', '/files/my-file.txt');
      expect(match.params).toEqual({ filename: 'my-file.txt' });
    });

    it('should match case-insensitively for methods', () => {
      router.get('/users', () => {});

      const match = router.match('get', '/users');
      expect(match).not.toBeNull();
    });

    it('should return first matching route', () => {
      // Note: Order matters - more specific routes should be registered first
      router.get('/users/all', () => 'all');
      router.get('/users/:id', () => 'specific');

      const match = router.match('GET', '/users/all');
      // First registered route matches
      expect(match.pattern).toBe('/users/all');
    });
  });

  describe('handle', () => {
    it('should call handler for matching route', async () => {
      const handler = jest.fn((req, res) => {
        res.status(200).json({ success: true });
      });

      router.get('/users', handler);

      const req = global.testUtils.mockRequest({ method: 'GET', path: '/users' });
      const res = global.testUtils.mockResponse();

      const handled = await router.handle(req, res);

      expect(handled).toBe(true);
      expect(handler).toHaveBeenCalledWith(req, res, expect.any(Function));
    });

    it('should return false for non-matching route', async () => {
      router.get('/users', () => {});

      const req = global.testUtils.mockRequest({ method: 'GET', path: '/posts' });
      const res = global.testUtils.mockResponse();

      const handled = await router.handle(req, res);
      expect(handled).toBe(false);
    });

    it('should attach params to request', async () => {
      let capturedParams;
      router.get('/users/:id', (req, res) => {
        capturedParams = req.params;
        res.json({});
      });

      const req = global.testUtils.mockRequest({ method: 'GET', path: '/users/123' });
      const res = global.testUtils.mockResponse();

      await router.handle(req, res);

      expect(capturedParams).toEqual({ id: '123' });
    });

    it('should run middleware in sequence', async () => {
      const callOrder = [];

      const middleware1 = (req, res, next) => {
        callOrder.push('middleware1');
        next();
      };

      const middleware2 = (req, res, next) => {
        callOrder.push('middleware2');
        next();
      };

      const handler = (req, res) => {
        callOrder.push('handler');
        res.json({});
      };

      router.get('/users', middleware1, middleware2, handler);

      const req = global.testUtils.mockRequest({ method: 'GET', path: '/users' });
      const res = global.testUtils.mockResponse();

      await router.handle(req, res);

      expect(callOrder).toEqual(['middleware1', 'middleware2', 'handler']);
    });

    it('should stop if middleware does not call next', async () => {
      const callOrder = [];

      const middleware = (req, res, next) => {
        callOrder.push('middleware');
        res.status(401).json({ error: 'Unauthorized' });
        // Note: not calling next()
      };

      const handler = (req, res) => {
        callOrder.push('handler');
        res.json({});
      };

      router.get('/users', middleware, handler);

      const req = global.testUtils.mockRequest({ method: 'GET', path: '/users' });
      const res = global.testUtils.mockResponse();

      await router.handle(req, res);

      expect(callOrder).toEqual(['middleware']);
      expect(res.statusCode).toBe(401);
    });

    it('should handle async handlers', async () => {
      const handler = async (req, res) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        res.json({ async: true });
      };

      router.get('/async', handler);

      const req = global.testUtils.mockRequest({ method: 'GET', path: '/async' });
      const res = global.testUtils.mockResponse();

      await router.handle(req, res);

      expect(res.body).toEqual({ async: true });
    });
  });

  describe('getRoutes', () => {
    it('should return list of registered routes', () => {
      router.get('/users', () => {});
      router.post('/users', () => {});
      router.get('/users/:id', () => {});

      const routes = router.getRoutes();

      expect(routes).toEqual([
        { method: 'GET', pattern: '/users' },
        { method: 'POST', pattern: '/users' },
        { method: 'GET', pattern: '/users/:id' }
      ]);
    });
  });

  describe('combineRouters', () => {
    it('should combine multiple routers', () => {
      const router1 = createRouter();
      router1.get('/users', () => {});

      const router2 = createRouter();
      router2.get('/posts', () => {});

      const combined = combineRouters(router1, router2);

      expect(combined.routes).toHaveLength(2);
      expect(combined.match('GET', '/users')).not.toBeNull();
      expect(combined.match('GET', '/posts')).not.toBeNull();
    });

    it('should preserve route order', () => {
      const router1 = createRouter();
      router1.get('/first', () => {});

      const router2 = createRouter();
      router2.get('/second', () => {});

      const combined = combineRouters(router1, router2);

      expect(combined.routes[0].pattern).toBe('/first');
      expect(combined.routes[1].pattern).toBe('/second');
    });
  });
});
