/**
 * Stripe SDK Mock
 *
 * Provides mock implementations for Stripe SDK used in testing.
 */

const mockStripe = jest.fn(() => ({
  customers: {
    create: jest.fn().mockResolvedValue({ id: 'cus_test123' }),
    retrieve: jest.fn().mockResolvedValue({ id: 'cus_test123', email: 'test@example.com' }),
    update: jest.fn().mockResolvedValue({ id: 'cus_test123' }),
    del: jest.fn().mockResolvedValue({ id: 'cus_test123', deleted: true })
  },

  subscriptions: {
    create: jest.fn().mockResolvedValue({
      id: 'sub_test123',
      status: 'active',
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
    }),
    retrieve: jest.fn().mockResolvedValue({
      id: 'sub_test123',
      status: 'active'
    }),
    update: jest.fn().mockResolvedValue({ id: 'sub_test123' }),
    cancel: jest.fn().mockResolvedValue({ id: 'sub_test123', status: 'canceled' }),
    list: jest.fn().mockResolvedValue({ data: [] })
  },

  checkout: {
    sessions: {
      create: jest.fn().mockResolvedValue({
        id: 'cs_test123',
        url: 'https://checkout.stripe.com/test'
      }),
      retrieve: jest.fn().mockResolvedValue({ id: 'cs_test123' })
    }
  },

  billingPortal: {
    sessions: {
      create: jest.fn().mockResolvedValue({
        id: 'bps_test123',
        url: 'https://billing.stripe.com/test'
      })
    }
  },

  webhooks: {
    constructEvent: jest.fn((payload, signature, secret) => {
      // Parse the payload if it's a string
      const event = typeof payload === 'string' ? JSON.parse(payload) : payload;
      return event;
    })
  },

  subscriptionItems: {
    create: jest.fn().mockResolvedValue({
      id: 'si_test123',
      subscription: 'sub_test123',
      price: { id: 'price_test123', metadata: { product: 'aisynch', tier: 'starter' } }
    }),
    del: jest.fn().mockResolvedValue({ id: 'si_test123', deleted: true })
  },

  prices: {
    create: jest.fn().mockResolvedValue({
      id: 'price_test_new123',
      unit_amount: 4900,
      currency: 'usd'
    }),
    retrieve: jest.fn().mockResolvedValue({
      id: 'price_test123',
      unit_amount: 4900,
      currency: 'usd'
    })
  },

  products: {
    create: jest.fn().mockResolvedValue({
      id: 'prod_test_new123',
      name: 'AIsynch — AI Visibility Intelligence'
    }),
    retrieve: jest.fn().mockResolvedValue({
      id: 'prod_test123',
      name: 'Test Plan'
    })
  }
}));

module.exports = mockStripe;
