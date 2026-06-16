const paymobService = require('../services/paymob.service');
const stripeService = require('../services/stripe.service');
const Plan = require('../schemas/plan.schema');
const ApiError = require('../../../utils/apiErrors');
const Developer = require('../../auth/schemas/developer.schema');

exports.checkout = async (req, res, next) => {
  try {
    const { planId, currency } = req.body;
    const developer = req.user;

    if (!planId || !currency) {
      return next(new ApiError(400, 'planId and currency are required'));
    }

    const plan = await Plan.findById(planId);
    if (!plan) {
      return next(new ApiError(404, 'Plan not found'));
    }

    // NOTE: We do NOT update isPremium here.
    // The webhook handler is the ONLY place that sets isPremium:true,
    // because only Stripe/Paymob can confirm a successful payment.
    // Saving temp info (currency, planId) to DB safely without touching isPremium.
    await Developer.findByIdAndUpdate(developer._id, {
      $set: {
        "subscription.currency": currency,
        "subscription.planIdTemp": planId,
      }
    });

    if (currency === "EGP") {
      const token = await paymobService.getAuthToken();
      const amountCents = plan.price * 100;
      const merchantOrderId = `${developer._id}_${Date.now()}`;

      const orderId = await paymobService.registerOrder({
        token,
        amountCents,
        currency: "EGP",
        merchantOrderId
      });

      const paymentKey = await paymobService.getPaymentKey({
        token,
        orderId,
        amountCents,
        developer,
        integrationId: process.env.PAYMOB_INTEGRATION_ID
      });

      const iframeUrl = paymobService.buildIframeUrl(paymentKey);
      return res.status(200).json({ iframeUrl });

    } else if (currency === "USD") {
      const successUrl = `${process.env.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${process.env.FRONTEND_URL}/payment-cancel`;

      const { url } = await stripeService.createCheckoutSession({
        developer,
        planId,
        successUrl,
        cancelUrl
      });

      return res.status(200).json({ checkoutUrl: url });
    } else {
      return next(new ApiError(400, 'Invalid currency'));
    }
  } catch (error) {
    next(error);
  }
};

exports.getSubscriptionStatus = async (req, res, next) => {
  try {
    return res.status(200).json({
      status: 'success',
      data: {
        subscription: req.user.subscription
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.cancelSubscription = async (req, res, next) => {
  try {
    const developer = req.user;

    if (!developer.subscription) {
      return next(new ApiError(400, 'No active subscription found'));
    }

    const { currency } = developer.subscription;

    if (currency === "USD") {
      const subId = developer.subscription.stripeSubscriptionId || developer.subscription.paymobSubscriptionId;
      if (subId) {
        await stripeService.cancelStripeSubscription(subId);
      }
    } else if (currency === "EGP") {
      // Paymob cancel logic would go here if they had an API for it
    }

    developer.subscription.status = "canceled";
    await developer.save();

    return res.status(200).json({
      status: 'success',
      message: 'Subscription canceled successfully',
      data: {
        subscription: developer.subscription
      }
    });

  } catch (error) {
    next(error);
  }
};

exports.getAllPlans = async (req, res, next) => {
  try {
    const plans = await Plan.find();
    return res.status(200).json({
      status: 'success',
      data: {
        plans
      }
    });
  } catch (error) {
    next(error);
  }
};
