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

const crypto = require('crypto');
const admin = require('firebase-admin');
const { PLANS } = require('../config/stripe');
const { getUserPlan } = require('../middleware/planGate');
const emailService = require('../services/email');
const { billingDecision, nextRecord, resolveAuthority, recordShapeValid, validId, instant } = require('../services/entitlementAuthority');
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
// Stripe requires expires_at to be at least 30 minutes after provider-side creation.
const CHECKOUT_SESSION_MS = 31 * 60 * 1000;
// If session recording fails, the protected reservation must outlive the provider session.
const CHECKOUT_RESERVATION_MS = 32 * 60 * 1000;
// A paid/completed session remains fenced while lifecycle delivery or operator reconciliation settles.
const CHECKOUT_SETTLEMENT_MS = 7 * 24 * 60 * 60 * 1000;
// Retain a session-created fence while delayed provider lifecycle webhooks are retried.
const CHECKOUT_PROVIDER_WEBHOOK_GRACE_MS = CHECKOUT_SETTLEMENT_MS;

function billingError(code) {
    return Object.assign(new Error(code), { code });
}

function checkoutAssignmentConflict(data, userId, now = new Date()) {
    if (data && !recordShapeValid(data, userId)) return 'ASSIGNMENT_UNRESOLVED';
    if (data?.authorities?.billing?.providerStatus === 'reconciliation_required') {
        return 'BILLING_AUTHORITY_RECONCILIATION_REQUIRED';
    }
    if (resolveAuthority(data, userId, now).active.some(authority => authority.source === 'billing')) {
        return 'ACTIVE_SUBSCRIPTION_EXISTS';
    }
    return null;
}

function assertCheckoutAssignmentAvailable(data, userId, now = new Date()) {
    const conflict = checkoutAssignmentConflict(data, userId, now);
    if (conflict) throw billingError(conflict);
}

function checkoutReservationValid(data, userId) {
    return data?.schemaVersion === 1 && data.subjectUid === userId && validId(data.attemptId) &&
        validId(data.priceId) && !!normalizePlan(data.planId) &&
        ['pending', 'session_created', 'completed'].includes(data.status) &&
        (data.status !== 'completed' || !!instant(data.completedAt)) &&
        !!instant(data.createdAt) && !!instant(data.expiresAt) &&
        (data.providerCustomerId == null || validId(data.providerCustomerId)) &&
        (data.providerSessionId == null || validId(data.providerSessionId));
}

async function beginCheckoutReservation(userId, priceId, planId, now = new Date()) {
    const attemptId = crypto.randomUUID();
    const reservationRef = db.collection('billingCheckoutReservations').doc(userId);
    const assignmentRef = db.collection('accountPlanAssignments').doc(userId);
    await db.runTransaction(async tx => {
        const [assignment, reservation] = await Promise.all([tx.get(assignmentRef), tx.get(reservationRef)]);
        const assignmentData = assignment.exists ? assignment.data() : null;
        assertCheckoutAssignmentAvailable(assignmentData, userId, now);
        if (reservation.exists) {
            const current = reservation.data();
            if (!checkoutReservationValid(current, userId)) throw billingError('CHECKOUT_RESERVATION_UNRESOLVED');
            if (instant(current.expiresAt) > now) throw billingError('CHECKOUT_IN_PROGRESS');
        }
        tx.set(reservationRef, {
            schemaVersion: 1, subjectUid: userId, attemptId, priceId, planId: normalizePlan(planId),
            status: 'pending', providerCustomerId: null, providerSessionId: null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: admin.firestore.Timestamp.fromMillis(now.getTime() + CHECKOUT_RESERVATION_MS),
        });
    });
    return { attemptId, providerExpiresAt: Math.floor((now.getTime() + CHECKOUT_SESSION_MS) / 1000) };
}

async function createCheckoutSessionUnderFence(userId, attemptId, customerId, createProviderSession, now = new Date()) {
    const reservationRef = db.collection('billingCheckoutReservations').doc(userId);
    const assignmentRef = db.collection('accountPlanAssignments').doc(userId);
    const accountBindingRef = db.collection('billingAccountBindings').doc(userId);
    const customerBindingRef = db.collection('billingCustomerBindings').doc(customerId);
    return db.runTransaction(async tx => {
        const [assignment, reservation, accountBinding, customerBinding] = await Promise.all([
            tx.get(assignmentRef), tx.get(reservationRef), tx.get(accountBindingRef), tx.get(customerBindingRef),
        ]);
        assertCheckoutAssignmentAvailable(assignment.exists ? assignment.data() : null, userId, now);
        const data = reservation.exists ? reservation.data() : null;
        if (!checkoutReservationValid(data, userId) || data.attemptId !== attemptId || data.status !== 'pending') {
            throw billingError('CHECKOUT_RESERVATION_UNRESOLVED');
        }
        const accountData = accountBinding.exists ? accountBinding.data() : null;
        const customerData = customerBinding.exists ? customerBinding.data() : null;
        if (!billingAccountBindingValid(accountData, userId) || accountData.providerCustomerId !== customerId ||
            !billingAccountBindingValid(customerData, userId) || customerData.providerCustomerId !== customerId) {
            throw billingError('BILLING_BINDING_UNRESOLVED');
        }

        // Keep the assignment and reservation transaction locked through the idempotent provider call.
        // A lifecycle transaction must serialize before this check or after the session fence commits.
        const session = await createProviderSession();
        if (!validId(session?.id)) throw billingError('CHECKOUT_SESSION_UNRESOLVED');
        const existingExpiry = instant(data.expiresAt);
        const providerExpiry = Number.isSafeInteger(session.expires_at)
            ? new Date(session.expires_at * 1000)
            : existingExpiry;
        const webhookExpiry = providerExpiry && new Date(providerExpiry.getTime() + CHECKOUT_PROVIDER_WEBHOOK_GRACE_MS);
        const expiresAt = existingExpiry && (!webhookExpiry || existingExpiry > webhookExpiry) ? existingExpiry : webhookExpiry;
        tx.set(reservationRef, {
            status: 'session_created', providerCustomerId: customerId, providerSessionId: session.id,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
        }, { merge: true });
        return session;
    });
}

async function releaseCheckoutReservation(userId, attemptId) {
    if (!validId(userId) || !validId(attemptId)) return false;
    const reservationRef = db.collection('billingCheckoutReservations').doc(userId);
    return db.runTransaction(async tx => {
        const reservation = await tx.get(reservationRef);
        if (!reservation.exists) return false;
        const data = reservation.data();
        if (data?.subjectUid !== userId || data?.attemptId !== attemptId) return false;
        tx.delete(reservationRef);
        return true;
    });
}

async function markCheckoutSessionCompleted(userId, attemptId, session, now = new Date()) {
    if (!validId(userId) || !validId(attemptId) || !validId(session?.id)) return false;
    const completedAt = instant(now);
    if (!completedAt) throw billingError('CHECKOUT_SESSION_UNRESOLVED');
    const reservationRef = db.collection('billingCheckoutReservations').doc(userId);
    return db.runTransaction(async tx => {
        const reservation = await tx.get(reservationRef);
        if (!reservation.exists) return false;
        const data = reservation.data();
        if (!checkoutReservationValid(data, userId) || data.attemptId !== attemptId ||
            data.providerSessionId !== session.id) throw billingError('CHECKOUT_RESERVATION_UNRESOLVED');
        if (data.status === 'completed') return true;
        const existingExpiry = instant(data.expiresAt);
        const settlementExpiry = new Date(completedAt.getTime() + CHECKOUT_SETTLEMENT_MS);
        const expiresAt = existingExpiry && existingExpiry > settlementExpiry ? existingExpiry : settlementExpiry;
        tx.set(reservationRef, {
            status: 'completed', completedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
        }, { merge: true });
        return true;
    });
}

async function consumeCheckoutReservation(userId, attemptId, providerSessionId = null) {
    if (!validId(userId) || !validId(attemptId)) return false;
    const reservationRef = db.collection('billingCheckoutReservations').doc(userId);
    return db.runTransaction(async tx => {
        const reservation = await tx.get(reservationRef);
        if (!reservation.exists) return false;
        const data = reservation.data();
        if (data?.subjectUid !== userId || data?.attemptId !== attemptId ||
            (data.providerSessionId && providerSessionId && data.providerSessionId !== providerSessionId)) return false;
        tx.delete(reservationRef);
        return true;
    });
}

function billingAccountBindingValid(binding, userId) {
    return binding?.schemaVersion === 1 && binding.provider === 'stripe' &&
        binding.subjectUid === userId && validId(binding.providerCustomerId);
}

async function cleanupUnusedCustomer(stripeClient, proposedCustomerId) {
    try {
        const protectedBinding = await db.collection('billingCustomerBindings').doc(proposedCustomerId).get();
        if (protectedBinding.exists) return false;
        await stripeClient.customers.del(proposedCustomerId);
        return true;
    } catch (error) {
        console.error('Failed to clean up unused Stripe customer:', error.code || error.message);
        return false;
    }
}

async function establishNewCustomerBinding(userId, proposedCustomerId) {
    const accountRef = db.collection('billingAccountBindings').doc(userId);
    const proposedCustomerRef = db.collection('billingCustomerBindings').doc(proposedCustomerId);
    const assignmentRef = db.collection('accountPlanAssignments').doc(userId);
    return db.runTransaction(async tx => {
        const [assignment, account, proposedCustomer] = await Promise.all([
            tx.get(assignmentRef), tx.get(accountRef), tx.get(proposedCustomerRef),
        ]);
        const assignmentData = assignment.exists ? assignment.data() : null;
        assertCheckoutAssignmentAvailable(assignmentData, userId);
        if (account.exists) {
            const binding = account.data();
            if (!billingAccountBindingValid(binding, userId)) throw billingError('BILLING_BINDING_UNRESOLVED');
            const reverse = binding.providerCustomerId === proposedCustomerId
                ? proposedCustomer
                : await tx.get(db.collection('billingCustomerBindings').doc(binding.providerCustomerId));
            if (!reverse.exists || !billingAccountBindingValid(reverse.data(), userId) ||
                reverse.data().providerCustomerId !== binding.providerCustomerId ||
                (binding.providerCustomerId !== proposedCustomerId && proposedCustomer.exists)) {
                throw billingError('BILLING_BINDING_UNRESOLVED');
            }
            return binding.providerCustomerId;
        }
        if (proposedCustomer.exists) throw billingError('BILLING_BINDING_UNRESOLVED');
        const binding = { schemaVersion: 1, provider: 'stripe', providerCustomerId: proposedCustomerId,
            subjectUid: userId, establishedBy: 'checkout', createdAt: admin.firestore.FieldValue.serverTimestamp() };
        tx.create(accountRef, binding);
        tx.create(proposedCustomerRef, binding);
        return proposedCustomerId;
    });
}

/**
 * Create a Stripe Checkout Session for subscription upgrade
 */
async function createCheckoutSession(req, res) {
    let checkoutAttemptId = null;
    let providerSessionCreated = false;
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
        const assignmentConflict = checkoutAssignmentConflict(assignmentData, userId);
        if (assignmentConflict) {
            return res.status(409).json({ success: false, error: 'Checkout requires reconciliation or completion', code: assignmentConflict });
        }

        const accountBinding = accountBindingDoc.exists ? accountBindingDoc.data() : null;
        if (accountBinding && !billingAccountBindingValid(accountBinding, userId)) {
            return res.status(409).json({ success: false, error: 'Billing customer binding requires reconciliation', code: 'BILLING_BINDING_UNRESOLVED' });
        }
        if (!accountBinding && userData.stripeCustomerId) {
            return res.status(409).json({ success: false, error: 'Existing billing customer requires protected binding reconciliation', code: 'BILLING_BINDING_RECONCILIATION_REQUIRED' });
        }
        const checkoutReservation = await beginCheckoutReservation(userId, actualPriceId, checkoutPlan.name);
        checkoutAttemptId = checkoutReservation.attemptId;
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
            try {
                customerId = await establishNewCustomerBinding(userId, customer.id);
            } catch (error) {
                await cleanupUnusedCustomer(stripeClient, customer.id);
                throw error;
            }
            if (customerId !== customer.id) await cleanupUnusedCustomer(stripeClient, customer.id);

            // Compatibility projection only. Protected bindings remain authoritative.
            await db.collection('users').doc(userId).set({
                stripeCustomerId: customerId
            }, { merge: true });
        }

        // Create the provider session while the protected assignment, bindings, and reservation are fenced.
        // Stripe idempotency makes a Firestore transaction retry return the same provider session.
        const session = await createCheckoutSessionUnderFence(userId, checkoutAttemptId, customerId, async () => {
            const created = await stripeClient.checkout.sessions.create({
                customer: customerId,
                payment_method_types: ['card'],
                line_items: [
                    {
                        price: actualPriceId,
                        quantity: 1
                    }
                ],
                mode: 'subscription',
                expires_at: checkoutReservation.providerExpiresAt,
                allow_promotion_codes: true, // Enable promo code field at checkout
                success_url: `${req.headers.origin || 'https://app.synchintro.ai'}/#settings?subscription=success&session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${req.headers.origin || 'https://app.synchintro.ai'}/#settings?subscription=canceled`,
                metadata: {
                    firebaseUserId: userId,
                    planName: checkoutPlan.name,
                    checkoutAttemptId
                },
                subscription_data: {
                    metadata: {
                        firebaseUserId: userId,
                        planName: checkoutPlan.name,
                        checkoutAttemptId
                    }
                }
            }, { idempotencyKey: `synchintro-checkout-${checkoutAttemptId}` });
            providerSessionCreated = true;
            return created;
        });

        return res.status(200).json({
            success: true,
            sessionId: session.id,
            url: session.url
        });

    } catch (error) {
        if (checkoutAttemptId && !providerSessionCreated) {
            try { await releaseCheckoutReservation(req.userId, checkoutAttemptId); }
            catch (releaseError) { console.error('Failed to release checkout reservation:', releaseError.message); }
        }
        console.error('Error creating checkout session:', error);
        const conflictCodes = new Set(['ACTIVE_SUBSCRIPTION_EXISTS', 'ASSIGNMENT_UNRESOLVED',
            'BILLING_AUTHORITY_RECONCILIATION_REQUIRED', 'BILLING_BINDING_UNRESOLVED',
            'CHECKOUT_IN_PROGRESS', 'CHECKOUT_RESERVATION_UNRESOLVED']);
        if (conflictCodes.has(error.code || error.message)) {
            return res.status(409).json({ success: false, error: 'Checkout requires reconciliation or completion', code: error.code || error.message });
        }
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

            case 'checkout.session.expired':
                await consumeCheckoutReservation(event.data.object.metadata?.firebaseUserId,
                    event.data.object.metadata?.checkoutAttemptId, event.data.object.id);
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
async function handleCheckoutComplete(session, now = new Date()) {
    const userId = session.metadata?.firebaseUserId;

    if (!userId) {
        console.error('No Firebase user ID in checkout session');
        return;
    }

    await markCheckoutSessionCompleted(userId, session.metadata?.checkoutAttemptId, session, now);
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

    // The subscription lifecycle webhook commits authority and then consumes the reservation.
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
    const checkoutReservationRef = db.collection('billingCheckoutReservations').doc(userId);
    return db.runTransaction(async tx => {
        const receipt = await tx.get(receiptRef);
        if (receipt.exists) return { action: 'duplicate', planName: null };
        const [previous, user, customerBinding, accountBinding, checkoutReservation, planInfo] = await Promise.all([
            tx.get(assignmentRef), tx.get(userRef), tx.get(customerBindingRef), tx.get(accountBindingRef),
            tx.get(checkoutReservationRef), resolveBillingPlan(priceId, tx),
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
        const reservationData = checkoutReservation.exists ? checkoutReservation.data() : null;
        const checkoutFinalized = decision.action === 'applied' || decision.action === 'revoked';
        // Any newly authoritative active or terminal billing state supersedes a valid pending
        // checkout for this account, including lifecycle events from another checkout attempt.
        if (checkoutFinalized && checkoutReservationValid(reservationData, userId)) {
            tx.delete(checkoutReservationRef);
        }
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
    _beginCheckoutReservation: beginCheckoutReservation,
    _releaseCheckoutReservation: releaseCheckoutReservation,
    _consumeCheckoutReservation: consumeCheckoutReservation,
};
