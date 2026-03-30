const crypto = require('crypto');
const stripeService = require('../services/stripe.service');
const Developer = require('../../auth/schemas/developer.schema');
const Plan = require('../schemas/plan.schema');

exports.handleStripeWebhook = async (req, res, next) => {
  const signature = req.headers['stripe-signature'];
  
  let event;
  try {
    event = stripeService.constructWebhookEvent(req.body, signature);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const developerId = session.metadata.developerId;
      const planId = session.metadata.planId;

      const plan = await Plan.findById(planId);
      if (plan && developerId) {
        await Developer.findByIdAndUpdate(developerId, {
          "subscription.status": "active",
          "subscription.isPremium": true,
          "subscription.plan": plan.tier,
          "subscription.stripeSubscriptionId": session.subscription
        });
      }
    }

    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      const stripeCustomerId = invoice.customer;

      if (stripeCustomerId) {
        await Developer.findOneAndUpdate(
          { "subscription.stripeCustomerId": stripeCustomerId },
          { "subscription.status": "past_due" }
        );
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      const stripeCustomerId = subscription.customer;

      if (stripeCustomerId) {
         await Developer.findOneAndUpdate(
          { "subscription.stripeCustomerId": stripeCustomerId },
          { "subscription.status": "canceled" }
        );
      }
    }
    
    if (event.type === 'invoice.paid') {
      const invoice = event.data.object;
      const stripeCustomerId = invoice.customer;

      if (stripeCustomerId) {
        const periodEnd = invoice.lines && invoice.lines.data[0] 
          ? invoice.lines.data[0].period.end * 1000 
          : Date.now();
          
        await Developer.findOneAndUpdate(
          { "subscription.stripeCustomerId": stripeCustomerId },
          { 
            "subscription.status": "active",
            "subscription.currentPeriodEnd": new Date(periodEnd)
          }
        );
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error("Stripe Webhook Processing Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.handlePaymobWebhook = async (req, res, next) => {
  try {
    const { obj } = req.body; 
    const signature = req.query.hmac;

    if (!obj || !signature) {
      return res.status(400).send('Missing payload or signature');
    }

    const hmacFields = [
      'amount_cents',
      'created_at',
      'currency',
      'error_occured',
      'has_parent_transaction',
      'id',
      'integration_id',
      'is_3d_secure',
      'is_auth',
      'is_capture',
      'is_refunded',
      'is_standalone_payment',
      'is_voided',
      'order.id',
      'owner',
      'pending',
      'source_data.pan',
      'source_data.sub_type',
      'source_data.type',
      'success'
    ];

    const getNestedValue = (obj, path) => {
      return path.split('.').reduce((acc, part) => acc && acc[part], obj);
    };

    let concatenatedString = '';
    hmacFields.forEach(field => {
      const val = getNestedValue(obj, field);
      // For boolean strictly convert to "true" or "false"
      if (typeof val === 'boolean') {
        concatenatedString += val ? 'true' : 'false';
      } else if (val !== undefined && val !== null) {
        concatenatedString += val.toString();
      }
    });

    const calculatedHmac = crypto
      .createHmac('sha512', process.env.PAYMOB_HMAC_SECRET)
      .update(concatenatedString)
      .digest('hex');

    if (calculatedHmac !== signature) {
      return res.status(401).send('Invalid signature');
    }

    const isSuccess = obj.success === true;
    const merchantOrderId = obj.order ? obj.order.merchant_order_id : null;

    if (!merchantOrderId) {
      return res.status(400).send('Missing merchant_order_id inside Paymob order');
    }

    const developerId = merchantOrderId.split('_')[0];

    if (isSuccess) {
      await Developer.findByIdAndUpdate(developerId, {
        "subscription.status": "active",
        "subscription.isPremium": true,
        "subscription.paymobSubscriptionId": obj.order.id.toString(), 
      });
    } else {
      await Developer.findByIdAndUpdate(developerId, {
        "subscription.status": "past_due"
      });
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error("Paymob Webhook Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
