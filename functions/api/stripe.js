/**
 * Stripe API Handlers
 *
 * Handles subscription management, checkout, and webhooks
 *
 * TODO: Stripe SDK at v14, needs upgrade to v22. See SYNCHINTRO_AUDIT_REPORT_2026-05-05.md F-008
 * APIs in use: customers.create, checkout.sessions.create, billingPortal.sessions.create,
 * webhooks.constructEvent — all stable across v14→v22. Low migration risk.
 * Breaking changes to review: constructor apiVersion parameter (v16+), TypeScript strict types.
 */

const admin = require('firebase-admin');
const { PLANS } = require('../config/stripe');
const { getUserPlan } = require('../middleware/planGate');
const emailService = require('../services/email');
const { billingDecision, nextRecord, resolveAuthority, recordShapeValid, validId } = require('../services/entitlementAuthority');
const { normalizePlan } = require('../services/planCatalog');

// Initialize Stripe with secret key
let stripe = null;
function getStripe() {
    if (!stripe) {
        const Stripe = require('stripe');
        stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    }
    return stripe;
}

const db = admin.firestore();

function billingAccountBindingValid(binding, userId) {
    return binding?.schemaVersion === 1 && binding.provider === 'stripe' &&
        binding.subjectUid === userId && validId(binding.providerCustomerId);
}

async function establishNewCustomerBinding(userId, proposedCustomerId) {
    const accountRef = db.collection('billingAccountBindings').doc(userId);
    const customerRef = db.collection('billingCustomerBindings').doc(proposedCustomerId);
    return db.runTransaction(async tx => {
        const [account, customer] = await Promise.all([tx.get(accountRef), tx.get(customerRef)]);
        if (account.exists) {
            const binding = account.data();
            if (!billingAccountBindingValid(binding, userId)) throw new Error('BILLING_BINDING_UNRESOLVED');
            return binding.providerCustomerId;
        }
        if (customer.exists) throw new Error('BILLING_BINDING_UNRESOLVED');
        const binding = { schemaVersion: 1, provider: 'stripe', providerCustomerId: proposedCustomerId,
            subjectUid: userId, establishedBy: 'checkout', createdAt: admin.firestore.FieldValue.serverTimestamp() };
        tx.create(accountRef, binding);
        tx.create(customerRef, binding);
        return proposedCustomerId;
    });
}

/**
 * Create a Stripe Checkout Session for subscription upgrade
 */
async function createCheckoutSession(req, res) {
    try {
        const { priceId, planName, billing = 'monthly' } = req.body;
        const userId = req.userId;

        if (!userId || userId === 'anonymous') {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const stripeClient = getStripe();

        // Determine the actual Stripe price ID to use
        let actualPriceId = priceId;

        // If planName is provided, try to get dynamic price from Firestore
        if (planName && !priceId) {
            try {
                const pricingService = require('../services/pricingService');
                const stripePrices = await pricingService.getStripePriceIds(planName.toLowerCase());

                if (stripePrices) {
                    actualPriceId = billing === 'annual' ? stripePrices.annual : stripePrices.monthly;
                }
            } catch (e) {
                console.log('Could not fetch dynamic price, falling back to config:', e.message);
            }
        }

        // Fallback to config if still no price ID
        if (!actualPriceId && planName) {
            const plan = PLANS[planName.toLowerCase()];
            if (plan?.stripePriceId) {
                actualPriceId = plan.stripePriceId;
            }
        }

        if (!actualPriceId) {
            return res.status(400).json({
                success: false,
                error: 'Price ID is required or plan not found'
            });
        }

        const checkoutPlan = await resolveBillingPlan(actualPriceId);
        const requestedPlan = planName ? normalizePlan(planName) : null;
        if (!checkoutPlan || (planName && (!requestedPlan || requestedPlan !== checkoutPlan.name))) {
            return res.status(400).json({ success: false, error: 'Price and plan selection could not be verified', code: 'BILLING_PRICE_UNRESOLVED' });
        }

        // Get or create Stripe customer
        const [userDoc, assignmentDoc, accountBindingDoc] = await Promise.all([
            db.collection('users').doc(userId).get(),
            db.collection('accountPlanAssignments').doc(userId).get(),
            db.collection('billingAccountBindings').doc(userId).get(),
        ]);
        const userData = userDoc.exists ? userDoc.data() : {};
        const assignmentData = assignmentDoc.exists ? assignmentDoc.data() : null;
        if (assignmentData && !recordShapeValid(assignmentData, userId)) {
            return res.status(409).json({ success: false, error: 'Billing assignment requires reconciliation', code: 'ASSIGNMENT_UNRESOLVED' });
        }
        if (resolveAuthority(assignmentData, userId, new Date()).active.some(authority => authority.source === 'billing')) {
            return res.status(409).json({ success: false, error: 'Manage the existing subscription before starting another checkout', code: 'ACTIVE_SUBSCRIPTION_EXISTS' });
        }

        const accountBinding = accountBindingDoc.exists ? accountBindingDoc.data() : null;
        if (accountBinding && !billingAccountBindingValid(accountBinding, userId)) {
            return res.status(409).json({ success: false, error: 'Billing customer binding requires reconciliation', code: 'BILLING_BINDING_UNRESOLVED' });
        }
        if (!accountBinding && userData.stripeCustomerId) {
            return res.status(409).json({ success: false, error: 'Existing billing customer requires protected binding reconciliation', code: 'BILLING_BINDING_RECONCILIATION_REQUIRED' });
        }
        let customerId = accountBinding?.providerCustomerId || null;

        if (!customerId) {
            // Create new Stripe customer
            const customer = await stripeClient.customers.create({
                email: req.userEmail,
                metadata: {
                    firebaseUserId: userId
                }
            });
            if (!validId(customer?.id)) throw new Error('BILLING_CUSTOMER_UNRESOLVED');
            customerId = await establishNewCustomerBinding(userId, customer.id);

            // Compatibility projection only. Protected bindings remain authoritative.
            await db.collection('users').doc(userId).set({
                stripeCustomerId: customerId
            }, { merge: true });
        }

        // Create checkout session
        const session = await stripeClient.checkout.sessions.create({
            customer: customerId,
            payment_method_types: ['card'],
            line_items: [
                {
                    price: actualPriceId,
                    quantity: 1
                }
            ],
            mode: 'subscription',
            allow_promotion_codes: true, // Enable promo code field at checkout
            success_url: `${req.headers.origin || 'https://app.synchintro.ai'}/#settings?subscription=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${req.headers.origin || 'https://app.synchintro.ai'}/#settings?subscription=canceled`,
            metadata: {
                firebaseUserId: userId,
                planName: checkoutPlan.name
            },
            subscription_data: {
                metadata: {
                    firebaseUserId: userId,
                    planName: checkoutPlan.name
                }
            }
        });

        return res.status(200).json({
            success: true,
            sessionId: session.id,
            url: session.url
        });

    } catch (error) {
        console.error('Error creating checkout session:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to create checkout session',
            message: error.message
        });
    }
}

/**
 * Create a Stripe Billing Portal Session
 */
async function createPortalSession(req, res) {
    try {
        const userId = req.userId;

        if (!userId || userId === 'anonymous') {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const accountBindingDoc = await db.collection('billingAccountBindings').doc(userId).get();
        const accountBinding = accountBindingDoc.exists ? accountBindingDoc.data() : null;
        if (!accountBinding) {
            return res.status(400).json({
                success: false,
                error: 'No subscription found',
                message: 'You do not have an active subscription to manage.'
            });
        }
        if (!billingAccountBindingValid(accountBinding, userId)) {
            return res.status(409).json({ success: false, error: 'Billing customer binding requires reconciliation', code: 'BILLING_BINDING_UNRESOLVED' });
        }

        const stripeClient = getStripe();

        const session = await stripeClient.billingPortal.sessions.create({
            customer: accountBinding.providerCustomerId,
            return_url: `${req.headers.origin || 'https://pathsynch-pitch-creation.web.app'}/settings.html`
        });

        return res.status(200).json({
            success: true,
            url: session.url
        });

    } catch (error) {
        console.error('Error creating portal session:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to create portal session',
            message: error.message
        });
    }
}

/**
 * Handle Stripe Webhooks
 */
async function handleWebhook(req, res) {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        if (typeof sig !== 'string' || !sig || typeof webhookSecret !== 'string' || !webhookSecret) {
            throw new Error('Missing webhook signature configuration');
        }
        const stripeClient = getStripe();
        event = stripeClient.webhooks.constructEvent(
            req.rawBody || req.body,
            sig,
            webhookSecret
        );
        if (!event || typeof event.id !== 'string' || !Number.isSafeInteger(event.created) ||
            typeof event.type !== 'string' || !event.data?.object) throw new Error('Invalid verified event shape');
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }

    console.log('Stripe webhook received:', event.type);

    try {
        switch (event.type) {
            case 'checkout.session.completed':
                await handleCheckoutComplete(event.data.object);
                break;

            case 'customer.subscription.created':
            case 'customer.subscription.updated':
                await handleSubscriptionUpdate(event);
                break;

            case 'customer.subscription.deleted':
                await handleSubscriptionDeleted(event);
                break;

            case 'invoice.paid':
                await handleInvoicePaid(event.data.object);
                break;

            case 'invoice.payment_failed':
                await handlePaymentFailed(event.data.object);
                break;

            default:
                console.log(`Unhandled event type: ${event.type}`);
        }

        return res.status(200).json({ received: true });

    } catch (error) {
        console.error('Error processing webhook:', error);
        return res.status(500).json({ error: 'Webhook processing failed' });
    }
}

/**
 * Handle successful checkout
 */
async function handleCheckoutComplete(session) {
    const userId = session.metadata?.firebaseUserId;

    if (!userId) {
        console.error('No Firebase user ID in checkout session');
        return;
    }

    console.log('Checkout completed for user:', userId);

    // Send subscription confirmation email
    try {
        const identity = await admin.auth().getUser(userId);
        const userEmail = identity.disabled ? null : identity.email;
        const planName = session.metadata?.planName || 'growth';

        if (userEmail) {
            await emailService.sendSubscriptionEmail(userEmail, {
                plan: planName,
                amount: session.amount_total ? session.amount_total / 100 : null,
                interval: 'month'
            });
            console.log('Subscription confirmation email sent to:', userEmail);
        }
    } catch (emailError) {
        console.error('Failed to send subscription email:', emailError);
        // Don't fail checkout if email fails
    }

    // The subscription will be handled by subscription.created webhook
}

/**
 * Handle subscription create/update
 */
async function billingSubject(subscription) {
    const customerId = subscription?.customer;
    if (!validId(customerId)) throw new Error('BILLING_CUSTOMER_UNRESOLVED');
    const metadataUid = subscription.metadata?.firebaseUserId;
    if (!validId(metadataUid)) throw new Error('BILLING_SUBJECT_UNRESOLVED');
    return metadataUid;
}

async function handleSubscriptionUpdate(event) {
    const subscription = event.data.object;
    const userId = await billingSubject(subscription);
    await updateUserSubscription(userId, subscription, event);
}

async function resolveBillingPlan(priceId, reader = null) {
    if (typeof priceId !== 'string' || !priceId) return null;
    const matches = new Set();
    for (const [planId, plan] of Object.entries(PLANS)) {
        if (plan?.stripePriceId === priceId) {
            const canonical = normalizePlan(planId);
            if (canonical) matches.add(canonical);
        }
    }
    const pricingRef = db.collection('platformConfig').doc('pricing');
    const pricing = await (reader && typeof reader.get === 'function' ? reader.get(pricingRef) : pricingRef.get());
    if (pricing.exists) {
        const tiers = pricing.data()?.tiers;
        if (!tiers || typeof tiers !== 'object' || Array.isArray(tiers)) {
            const configured = [...matches];
            return configured.length === 1 ? { ...PLANS[configured[0]], name: configured[0] } : null;
        }
        for (const planId of Object.keys(PLANS)) {
            const prices = tiers[planId]?.stripe?.prices;
            if (prices && (prices.monthly === priceId || prices.annual === priceId)) matches.add(planId);
        }
    }
    const names = [...matches];
    return names.length === 1 ? { ...PLANS[names[0]], name: names[0] } : null;
}

/**
 * Update user's subscription in Firestore
 */
async function applyBillingAuthorityEvent(userId, subscription, event) {
    const priceId = subscription?.items?.data?.[0]?.price?.id;
    const assignmentRef = db.collection('accountPlanAssignments').doc(userId);
    const receiptRef = db.collection('billingAuthorityEvents').doc(event.id);
    const customerBindingRef = db.collection('billingCustomerBindings').doc(subscription.customer);
    const accountBindingRef = db.collection('billingAccountBindings').doc(userId);
    const userRef = db.collection('users').doc(userId);
    const subscriptionRef = db.collection('subscriptions').doc(subscription.id);
    return db.runTransaction(async tx => {
        const receipt = await tx.get(receiptRef);
        if (receipt.exists) return { action: 'duplicate', planName: null };
        const [previous, user, customerBinding, accountBinding, planInfo] = await Promise.all([
            tx.get(assignmentRef), tx.get(userRef), tx.get(customerBindingRef), tx.get(accountBindingRef), resolveBillingPlan(priceId, tx),
        ]);
        const planName = planInfo?.name || null;
        if (!user.exists || subscription.metadata?.firebaseUserId !== userId) throw new Error('BILLING_SUBJECT_MISMATCH');
        const binding = customerBinding.exists ? customerBinding.data() : null;
        if (binding && (binding.schemaVersion !== 1 || binding.provider !== 'stripe' ||
            binding.providerCustomerId !== subscription.customer || binding.subjectUid !== userId)) {
            throw new Error('BILLING_SUBJECT_MISMATCH');
        }
        const account = accountBinding.exists ? accountBinding.data() : null;
        if (account && (!billingAccountBindingValid(account, userId) ||
            account.providerCustomerId !== subscription.customer)) throw new Error('BILLING_SUBJECT_MISMATCH');
        const previousData = previous.exists ? previous.data() : null;
        const decision = billingDecision(previousData, userId, event, subscription, planName);
        const receiptData = { schemaVersion: 1, eventId: event.id, eventType: event.type,
            eventCreated: event.created, subjectUid: userId, providerSubscriptionId: subscription.id,
            result: decision.action, processedAt: admin.firestore.FieldValue.serverTimestamp() };
        if (decision.action === 'stale') { tx.set(receiptRef, receiptData); return { action: 'stale', planName }; }
        if (decision.action === 'duplicate') { tx.set(receiptRef, receiptData); return { action: 'duplicate', planName }; }
        let record;
        try { record = nextRecord(previousData, userId, 'billing', decision.authority); }
        catch (_) { throw new Error('ASSIGNMENT_UNRESOLVED'); }
        tx.set(assignmentRef, record);
        tx.create(assignmentRef.collection('history').doc(String(record.revision)), {
            ...record, changeSource: 'billing', changedAuthority: decision.authority,
            providerEventId: event.id, providerEventCreated: event.created,
        });
        tx.set(receiptRef, receiptData);
        if (!customerBinding.exists) {
            tx.create(customerBindingRef, { schemaVersion: 1, provider: 'stripe',
                providerCustomerId: subscription.customer, subjectUid: userId,
                establishedByEventId: event.id, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        }
        if (!accountBinding.exists) {
            tx.create(accountBindingRef, { schemaVersion: 1, provider: 'stripe',
                providerCustomerId: subscription.customer, subjectUid: userId,
                establishedByEventId: event.id, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        }
        const subscriptionData = {
            id: subscription.id, stripeSubscriptionId: subscription.id, stripeCustomerId: subscription.customer,
            userId, status: subscription.status, cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (planName) subscriptionData.plan = planName;
        if (Number.isSafeInteger(subscription.current_period_start)) subscriptionData.currentPeriodStart = admin.firestore.Timestamp.fromMillis(subscription.current_period_start * 1000);
        if (Number.isSafeInteger(subscription.current_period_end)) subscriptionData.currentPeriodEnd = admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000);
        if (event.type === 'customer.subscription.deleted') subscriptionData.canceledAt = admin.firestore.FieldValue.serverTimestamp();
        const userUpdate = { stripeCustomerId: subscription.customer, stripeSubscriptionId: subscription.id,
            subscriptionStatus: subscription.status, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
        userUpdate.plan = resolveAuthority(record, userId, new Date()).plan || 'starter';
        tx.set(subscriptionRef, subscriptionData, { merge: true });
        tx.set(userRef, userUpdate, { merge: true });
        return { action: decision.action, planName, revision: record.revision };
    });
}

async function updateUserSubscription(userId, subscription, event) {
    const authority = await applyBillingAuthorityEvent(userId, subscription, event);
    console.log(`Processed billing authority for ${userId}: ${authority.action}`);
    return authority;
}

/**
 * Handle subscription deletion/cancellation
 */
async function handleSubscriptionDeleted(event) {
    const subscription = event.data.object;
    const userId = await billingSubject(subscription);
    const authority = await applyBillingAuthorityEvent(userId, subscription, event);
    console.log(`Processed terminal billing authority for ${userId}: ${authority.action}`);
    return authority;
}

/**
 * Handle successful invoice payment
 */
async function handleInvoicePaid(invoice) {
    console.log('Invoice paid:', invoice.id);
    // Could send confirmation email, update billing history, etc.
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(invoice) {
    // Invoice failure alone is not plan authority and may arrive without the
    // immutable subscription subject metadata. Wait for the provider's signed
    // subscription lifecycle object, which applies grace/dunning semantics.
    console.log('Invoice payment failed; awaiting subscription lifecycle state:', invoice.id);
}

/**
 * Get current subscription status
 */
async function getSubscription(req, res) {
    try {
        const userId = req.userId;

        if (!userId || userId === 'anonymous') {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};

        // Display the protected account assignment; profile/billing hints cannot grant capacity.
        // plan-gate-exempt(#129): billing reads the individual account's own subscription — the
        // thing being charged is this uid, not the workspace it belongs to. Display/billing, not a
        // gate; revisit if this response ever drives feature visibility.
        const planName = await getUserPlan(userId);

        // Try to get pricing from Firestore (Admin Panel), fall back to hardcoded config
        let planDetails = PLANS[planName] || null;
        try {
            const pricingDoc = await db.collection('platformConfig').doc('pricing').get();
            if (pricingDoc.exists) {
                const firestorePricing = pricingDoc.data();
                const firestoreTier = firestorePricing.tiers?.[planName];
                if (planDetails && firestoreTier) {
                    // Map Firestore pricing format to expected format
                    planDetails = {
                        name: firestoreTier.name,
                        price: firestoreTier.monthlyPrice,
                        priceAnnual: firestoreTier.annualPrice,
                        limits: {
                            pitchesPerMonth: firestoreTier.pitchLimit,
                            icpLimit: firestoreTier.icpLimit,
                            workspacesLimit: firestoreTier.workspacesLimit,
                            ...PLANS[planName]?.limits // Keep other limits from hardcoded config
                        },
                        features: firestoreTier.features || PLANS[planName]?.features || []
                    };
                }
            }
        } catch (e) {
            console.log('Using hardcoded pricing, Firestore fetch failed:', e.message);
        }

        // Get subscription details if exists
        let subscription = null;
        if (userData.stripeSubscriptionId) {
            const subDoc = await db.collection('subscriptions').doc(userData.stripeSubscriptionId).get();
            if (subDoc.exists) {
                subscription = subDoc.data();
            }
        }

        // Get current usage
        const now = new Date();
        const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const usageId = `${userId}_${period}`;
        const usageDoc = await db.collection('usage').doc(usageId).get();
        const usage = usageDoc.exists ? usageDoc.data() : { pitchesGenerated: 0 };

        return res.status(200).json({
            success: true,
            data: {
                plan: planName,
                entitlementStatus: planDetails ? 'resolved' : 'unresolved',
                planDetails: planDetails ? {
                    name: planDetails.name,
                    price: planDetails.price,
                    priceAnnual: planDetails.priceAnnual,
                    limits: planDetails.limits,
                    features: planDetails.features
                } : null,
                subscription: subscription ? {
                    status: subscription.status,
                    currentPeriodEnd: subscription.currentPeriodEnd,
                    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd
                } : null,
                usage: {
                    pitchesGenerated: usage.pitchesGenerated || 0,
                    bulkUploadsThisMonth: usage.bulkUploadsThisMonth || 0,
                    marketReportsThisMonth: usage.marketReportsThisMonth || 0,
                    period: period
                }
            }
        });

    } catch (error) {
        console.error('Error getting subscription:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get subscription details'
        });
    }
}

module.exports = {
    createCheckoutSession,
    createPortalSession,
    handleWebhook,
    getSubscription,
    _billingSubject: billingSubject,
    _resolveBillingPlan: resolveBillingPlan,
    _handleCheckoutComplete: handleCheckoutComplete,
    _applyBillingAuthorityEvent: applyBillingAuthorityEvent,
    _updateUserSubscription: updateUserSubscription,
    _handleSubscriptionUpdate: handleSubscriptionUpdate,
    _handleSubscriptionDeleted: handleSubscriptionDeleted,
};
