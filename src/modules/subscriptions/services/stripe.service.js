const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Developer = require('../../auth/schemas/developer.schema');
const Plan = require('../schemas/plan.schema');
const ApiError = require('../../../utils/apiErrors');

const createStripeCustomer = async (developer) => {
  try {
    if (developer.subscription && developer.subscription.stripeCustomerId) {
      return developer.subscription.stripeCustomerId;
    }

    const customer = await stripe.customers.create({
      email: developer.email,
      name: developer.name,
      metadata: {
        developerId: developer._id.toString()
      }
    });

    developer.subscription = developer.subscription || {};
    developer.subscription.stripeCustomerId = customer.id;
    await developer.save();

    return customer.id;
  } catch (error) {
    throw new ApiError(500, `Stripe Customer Creation Failed: ${error.message}`);
  }
};

const createCheckoutSession = async ({ developer, planId, successUrl, cancelUrl }) => {
  try {
    const plan = await Plan.findById(planId);
    if (!plan || !plan.stripeProductId) {
      throw new ApiError(400, "Invalid plan or missing Stripe Product ID");
    }

    const customerId = await createStripeCustomer(developer);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer: customerId,
      line_items: [
        {
          // NOTE: plan.stripeProductId MUST be the Stripe Price ID (starts with price_)
          price: plan.stripePriceId || plan.stripeProductId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: developer._id.toString(),
      metadata: {
        developerId: developer._id.toString(),
        planId: planId.toString(),
      }
    });

    return {
      sessionId: session.id,
      url: session.url
    };
  } catch (error) {
    throw new ApiError(500, `Stripe Checkout Session Failed: ${error.message}`);
  }
};

const cancelStripeSubscription = async (stripeSubscriptionId) => {
  try {
    const deletedSubscription = await stripe.subscriptions.cancel(stripeSubscriptionId);
    return deletedSubscription;
  } catch (error) {
    throw new ApiError(500, `Stripe Cancel Failed: ${error.message}`);
  }
};

const constructWebhookEvent = (rawBody, signature) => {
  try {
    return stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    throw new ApiError(400, `Webhook Error: ${error.message}`);
  }
};

module.exports = {
  createStripeCustomer,
  createCheckoutSession,
  cancelStripeSubscription,
  constructWebhookEvent
};
