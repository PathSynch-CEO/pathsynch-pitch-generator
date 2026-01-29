/**
 * Validation Middleware Tests
 */

const { schemas, validate, validateBody, sanitizeString } = require('../../middleware/validation');

describe('Validation Middleware', () => {
  describe('schemas', () => {
    it('should have all required schemas defined', () => {
      const requiredSchemas = [
        'generatePitch',
        'generateNarrative',
        'teamInvite',
        'marketReport',
        'savedSearch',
        'analyticsTrack',
        'userSettings',
        'pitchUpdate',
        'emailContent',
        'stripeCheckout'
      ];

      requiredSchemas.forEach(schema => {
        expect(schemas[schema]).toBeDefined();
      });
    });
  });

  describe('validateBody', () => {
    describe('generatePitch schema', () => {
      it('should validate valid pitch input', () => {
        const input = {
          businessName: 'Test Business',
          contactName: 'John Doe',
          industry: 'Restaurant',
          pitchLevel: 2,
          monthlyVisits: 500
        };

        const result = validateBody(input, 'generatePitch');

        expect(result.valid).toBe(true);
        expect(result.value.businessName).toBe('Test Business');
      });

      it('should require businessName', () => {
        const input = {
          industry: 'Restaurant'
        };

        const result = validateBody(input, 'generatePitch');

        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({ field: 'businessName' })
        );
      });

      it('should apply default pitchLevel', () => {
        const input = {
          businessName: 'Test'
        };

        const result = validateBody(input, 'generatePitch');

        expect(result.valid).toBe(true);
        expect(result.value.pitchLevel).toBe(1);
      });

      it('should reject invalid pitchLevel', () => {
        const input = {
          businessName: 'Test',
          pitchLevel: 5
        };

        const result = validateBody(input, 'generatePitch');

        expect(result.valid).toBe(false);
      });

      it('should validate branding colors', () => {
        const input = {
          businessName: 'Test',
          branding: {
            primaryColor: '#FF5500',
            accentColor: '#00FF00'
          }
        };

        const result = validateBody(input, 'generatePitch');

        expect(result.valid).toBe(true);
      });

      it('should reject invalid color format', () => {
        const input = {
          businessName: 'Test',
          branding: {
            primaryColor: 'red'
          }
        };

        const result = validateBody(input, 'generatePitch');

        expect(result.valid).toBe(false);
      });

      it('should strip unknown fields', () => {
        const input = {
          businessName: 'Test',
          unknownField: 'should be removed'
        };

        const result = validateBody(input, 'generatePitch');

        expect(result.valid).toBe(true);
        expect(result.value.unknownField).toBeUndefined();
      });
    });

    describe('teamInvite schema', () => {
      it('should validate valid invite', () => {
        const input = {
          email: 'user@example.com',
          role: 'admin'
        };

        const result = validateBody(input, 'teamInvite');

        expect(result.valid).toBe(true);
        expect(result.value.email).toBe('user@example.com');
      });

      it('should require valid email', () => {
        const input = {
          email: 'invalid-email',
          role: 'member'
        };

        const result = validateBody(input, 'teamInvite');

        expect(result.valid).toBe(false);
        expect(result.errors[0].field).toBe('email');
      });

      it('should only allow valid roles', () => {
        const input = {
          email: 'user@example.com',
          role: 'superadmin'
        };

        const result = validateBody(input, 'teamInvite');

        expect(result.valid).toBe(false);
      });

      it('should default role to member', () => {
        const input = {
          email: 'user@example.com'
        };

        const result = validateBody(input, 'teamInvite');

        expect(result.valid).toBe(true);
        expect(result.value.role).toBe('member');
      });

      it('should lowercase email', () => {
        const input = {
          email: 'USER@EXAMPLE.COM'
        };

        const result = validateBody(input, 'teamInvite');

        expect(result.valid).toBe(true);
        expect(result.value.email).toBe('user@example.com');
      });
    });

    describe('analyticsTrack schema', () => {
      it('should validate valid tracking event', () => {
        const input = {
          pitchId: 'pitch_123',
          event: 'view'
        };

        const result = validateBody(input, 'analyticsTrack');

        expect(result.valid).toBe(true);
      });

      it('should require pitchId', () => {
        const input = {
          event: 'view'
        };

        const result = validateBody(input, 'analyticsTrack');

        expect(result.valid).toBe(false);
      });

      it('should only allow valid events', () => {
        const validEvents = ['view', 'cta_click', 'share', 'download'];

        validEvents.forEach(event => {
          const result = validateBody({ pitchId: 'test', event }, 'analyticsTrack');
          expect(result.valid).toBe(true);
        });

        const invalidResult = validateBody(
          { pitchId: 'test', event: 'invalid_event' },
          'analyticsTrack'
        );
        expect(invalidResult.valid).toBe(false);
      });

      it('should allow optional data object', () => {
        const input = {
          pitchId: 'pitch_123',
          event: 'view',
          data: { source: 'email', campaign: 'test' }
        };

        const result = validateBody(input, 'analyticsTrack');

        expect(result.valid).toBe(true);
        expect(result.value.data).toEqual({ source: 'email', campaign: 'test' });
      });
    });

    describe('marketReport schema', () => {
      it('should validate valid market report input', () => {
        const input = {
          city: 'San Francisco',
          state: 'CA',
          industry: 'Restaurant'
        };

        const result = validateBody(input, 'marketReport');

        expect(result.valid).toBe(true);
      });

      it('should require city, state, and industry', () => {
        const result = validateBody({}, 'marketReport');

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThanOrEqual(3);
      });

      it('should validate ZIP code format', () => {
        const validZips = ['12345', '12345-6789'];
        const invalidZips = ['1234', '123456', 'ABCDE'];

        validZips.forEach(zip => {
          const result = validateBody(
            { city: 'Test', state: 'CA', industry: 'Test', zipCode: zip },
            'marketReport'
          );
          expect(result.valid).toBe(true);
        });

        invalidZips.forEach(zip => {
          const result = validateBody(
            { city: 'Test', state: 'CA', industry: 'Test', zipCode: zip },
            'marketReport'
          );
          expect(result.valid).toBe(false);
        });
      });

      it('should validate company size', () => {
        const validSizes = ['small', 'medium', 'large', 'enterprise'];

        validSizes.forEach(size => {
          const result = validateBody(
            { city: 'Test', state: 'CA', industry: 'Test', companySize: size },
            'marketReport'
          );
          expect(result.valid).toBe(true);
        });
      });

      it('should validate radius range', () => {
        const validResult = validateBody(
          { city: 'Test', state: 'CA', industry: 'Test', radius: 10000 },
          'marketReport'
        );
        expect(validResult.valid).toBe(true);

        const tooSmall = validateBody(
          { city: 'Test', state: 'CA', industry: 'Test', radius: 500 },
          'marketReport'
        );
        expect(tooSmall.valid).toBe(false);

        const tooLarge = validateBody(
          { city: 'Test', state: 'CA', industry: 'Test', radius: 100000 },
          'marketReport'
        );
        expect(tooLarge.valid).toBe(false);
      });
    });

    describe('unknown schema', () => {
      it('should return error for unknown schema', () => {
        const result = validateBody({}, 'nonExistentSchema');

        expect(result.valid).toBe(false);
        expect(result.errors[0].field).toBe('_schema');
      });
    });
  });

  describe('validate middleware', () => {
    it('should pass validation and call next', () => {
      const middleware = validate('analyticsTrack');

      const req = {
        body: { pitchId: 'test', event: 'view' }
      };
      const res = global.testUtils.mockResponse();
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.body.pitchId).toBe('test');
      expect(req.body.event).toBe('view');
    });

    it('should return 400 on validation failure', () => {
      const middleware = validate('analyticsTrack');

      const req = {
        body: { event: 'view' } // missing pitchId
      };
      const res = global.testUtils.mockResponse();
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Validation failed');
    });

    it('should throw for unknown schema', () => {
      expect(() => validate('unknownSchema')).toThrow('Unknown validation schema');
    });
  });

  describe('sanitizeString', () => {
    it('should escape HTML entities', () => {
      expect(sanitizeString('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );
    });

    it('should escape ampersands', () => {
      expect(sanitizeString('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });

    it('should escape quotes', () => {
      expect(sanitizeString("It's a \"test\"")).toBe("It&#x27;s a &quot;test&quot;");
    });

    it('should return non-strings unchanged', () => {
      expect(sanitizeString(123)).toBe(123);
      expect(sanitizeString(null)).toBe(null);
      expect(sanitizeString(undefined)).toBe(undefined);
    });

    it('should handle empty string', () => {
      expect(sanitizeString('')).toBe('');
    });
  });
});
