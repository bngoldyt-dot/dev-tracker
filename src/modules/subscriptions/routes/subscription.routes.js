const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscription.controller');
const webhookController = require('../controllers/webhook.controller');
const { protect } = require('../../../middlewares/auth.middleware');

// -------------------------------------------------------------
// Webhook Routes (MUST NOT use protect)
// -------------------------------------------------------------

// NOTE: Webhook for Stripe MUST use express.raw() to parse the raw body string for signature verification
router.post(
  '/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  webhookController.handleStripeWebhook
);

// Webhook for Paymob
router.post(
  '/webhooks/paymob', 
  webhookController.handlePaymobWebhook
);

// -------------------------------------------------------------
// Protected Routes
// -------------------------------------------------------------

// Mount protect middleware on all subsequent /subscribe routes
router.use(protect);

router.post('/checkout', subscriptionController.checkout);
router.get('/status', subscriptionController.getSubscriptionStatus);
router.post('/cancel', subscriptionController.cancelSubscription);

module.exports = router;
