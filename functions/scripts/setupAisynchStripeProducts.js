'use strict';

/**
 * setupAisynchStripeProducts.js
 * One-time setup script — creates AIsynch Stripe product and prices.
 *
 * Run ONCE before Phase 1A deploy:
 *   node functions/scripts/setupAisynchStripeProducts.js
 *
 * Output: Copy the price IDs into functions/.env as:
 *   AISYNCH_STARTER_PRICE_ID=price_XXXXX
 *   AISYNCH_GROWTH_PRICE_ID=price_XXXXX
 *   AISYNCH_SCALE_PRICE_ID=price_XXXXX
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

var stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;

async function setup() {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY not set in .env');
    process.exit(1);
  }

  console.log('[AIsynch Setup] Creating Stripe product...');

  var product = await stripe.products.create({
    name: 'AIsynch — AI Visibility Intelligence',
    description: 'AI Readiness scoring, visibility monitoring, and citation analysis for local businesses',
    metadata: { pathsynch_product: 'aisynch' }
  });

  console.log('[AIsynch Setup] Product created:', product.id);
  console.log('[AIsynch Setup] Creating price tiers...');

  var starterMonthly = await stripe.prices.create({
    product: product.id,
    unit_amount: 4900,
    currency: 'usd',
    recurring: { interval: 'month' },
    nickname: 'AIsynch Starter Monthly',
    metadata: { tier: 'starter', product: 'aisynch' }
  });

  var growthMonthly = await stripe.prices.create({
    product: product.id,
    unit_amount: 9900,
    currency: 'usd',
    recurring: { interval: 'month' },
    nickname: 'AIsynch Growth Monthly',
    metadata: { tier: 'growth', product: 'aisynch' }
  });

  var scaleMonthly = await stripe.prices.create({
    product: product.id,
    unit_amount: 19900,
    currency: 'usd',
    recurring: { interval: 'month' },
    nickname: 'AIsynch Scale Monthly',
    metadata: { tier: 'scale', product: 'aisynch' }
  });

  console.log('\n[AIsynch Setup] ✓ All Stripe resources created.\n');
  console.log('Add these to functions/.env:');
  console.log('AISYNCH_STARTER_PRICE_ID=' + starterMonthly.id);
  console.log('AISYNCH_GROWTH_PRICE_ID=' + growthMonthly.id);
  console.log('AISYNCH_SCALE_PRICE_ID=' + scaleMonthly.id);
  console.log('\nProduct ID (for reference): ' + product.id);
}

setup().catch(function(err) {
  console.error('[AIsynch Setup] Error:', err.message);
  process.exit(1);
});
