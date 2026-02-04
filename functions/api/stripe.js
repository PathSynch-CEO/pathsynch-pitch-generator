/**
 * Stripe API Handlers
 *
 * Handles subscription management, checkout, and webhooks
 */

const admin = require('firebase-admin');
const { PLANS, getPlanByPriceId } = require('../config/stripe');
const emailService = require('../services/email');

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

/**
 * Create a Stripe Checkout Session for subscription upgrade
 */
async function createCheckoutSession(req, res) {
    try {
        const { priceId, planName } = req.body;
        const userId = req.userId;

        if (!userId || userId === 'anonymous') {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        if (!priceId) {
            return res.status(400).json({
                success: false,
                error: 'Price ID is required'
            });
        }

        const stripeClient = getStripe();

        // Get or create Stripe customer
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};

        let customerId = userData.stripeCustomerId;

        if (!customerId) {
            // Create new Stripe customer
            const customer = await stripeClient.customers.create({
                email: userData.profile?.email || req.userEmail,
                metadata: {
                    firebaseUserId: userId
                }
            });
            customerId = customer.id;

            // Save customer ID to user document
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
                    price: priceId,
                    quantity: 1
                }
            ],
            mode: 'subscription',
            allow_promotion_codes: true, // Enable promo code field at checkout
            success_url: `${req.headers.origin || 'https://app.synchintro.ai'}/#settings?subscription=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${req.headers.origin || 'https://app.synchintro.ai'}/#settings?subscription=canceled`,
            metadata: {
                firebaseUserId: userId,
                planName: planName || 'unknown'
            },
            subscription_data: {
                metadata: {
                    firebaseUserId: userId,
                    planName: planName || 'unknown'
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

        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};

        if (!userData.stripeCustomerId) {
            return res.status(400).json({
                success: false,
                error: 'No subscription found',
                message: 'You do not have an active subscription to manage.'
            });
        }

        const stripeClient = getStripe();

        const session = await stripeClient.billingPortal.sessions.create({
            customer: userData.stripeCustomerId,
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
        const stripeClient = getStripe();
        event = stripeClient.webhooks.constructEvent(
            req.rawBody || req.body,
            sig,
            webhookSecret
        );
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
                await handleSubscriptionUpdate(event.data.object);
                break;

            case 'customer.subscription.deleted':
                await handleSubscriptionDeleted(event.data.object);
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
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const userEmail = userData.profile?.email || userData.email || session.customer_details?.email;
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
async function handleSubscriptionUpdate(subscription) {
    const userId = subscription.metadata?.firebaseUserId;

    if (!userId) {
        // Try to find user by customer ID
        const customerId = subscription.customer;
        const usersQuery = await db.collection('users')
            .where('stripeCustomerId', '==', customerId)
            .limit(1)
            .get();

        if (usersQuery.empty) {
            console.error('Could not find user for subscription:', subscription.id);
            return;
        }

        const userDoc = usersQuery.docs[0];
        await updateUserSubscription(userDoc.id, subscription);
    } else {
        await updateUserSubscription(userId, subscription);
    }
}

/**
 * Update user's subscription in Firestore
 */
async function updateUserSubscription(userId, subscription) {
    const priceId = subscription.items.data[0]?.price?.id;
    const planInfo = getPlanByPriceId(priceId);
    const planName = planInfo?.name || 'growth';

    const subscriptionData = {
        id: subscription.id,
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: subscription.customer,
        userId: userId,
        plan: planName,
        status: subscription.status,
        currentPeriodStart: admin.firestore.Timestamp.fromMillis(subscription.current_period_start * 1000),
        currentPeriodEnd: admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Update subscriptions collection
    await db.collection('subscriptions').doc(subscription.id).set(subscriptionData, { merge: true });

    // Update user document
    await db.collection('users').doc(userId).set({
        plan: planName,
        stripeCustomerId: subscription.customer,
        stripeSubscriptionId: subscription.id,
        subscriptionStatus: subscription.status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`Updated user ${userId} to plan: ${planName}`);
}

/**
 * Handle subscription deletion/cancellation
 */
async function handleSubscriptionDeleted(subscription) {
    const customerId = subscription.customer;

    const usersQuery = await db.collection('users')
        .where('stripeCustomerId', '==', customerId)
        .limit(1)
        .get();

    if (usersQuery.empty) {
        console.error('Could not find user for deleted subscription:', subscription.id);
        return;
    }

    const userDoc = usersQuery.docs[0];
    const userId = userDoc.id;

    // Update subscriptions collection
    await db.collection('subscriptions').doc(subscription.id).set({
        status: 'canceled',
        canceledAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // Downgrade user to starter plan
    await db.collection('users').doc(userId).set({
        plan: 'starter',
        subscriptionStatus: 'canceled',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`Downgraded user ${userId} to starter plan`);
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
    const customerId = invoice.customer;

    const usersQuery = await db.collection('users')
        .where('stripeCustomerId', '==', customerId)
        .limit(1)
        .get();

    if (!usersQuery.empty) {
        const userDoc = usersQuery.docs[0];

        await db.collection('users').doc(userDoc.id).set({
            subscriptionStatus: 'past_due',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        console.log(`Marked user ${userDoc.id} as past_due`);
    }
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

        // Get plan info
        let planName = 'starter';
        if (typeof userData.plan === 'string') {
            planName = userData.plan;
        } else if (userData.plan?.tier) {
            planName = userData.plan.tier;
        }

        const planDetails = PLANS[planName] || PLANS.starter;

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
                planDetails: {
                    name: planDetails.name,
                    price: planDetails.price,
                    limits: planDetails.limits,
                    features: planDetails.features
                },
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
    getSubscription
};
