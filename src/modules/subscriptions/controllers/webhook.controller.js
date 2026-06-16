const crypto = require('crypto');
const stripeService = require('../services/stripe.service');
const Developer = require('../../auth/schemas/developer.schema');
const Plan = require('../schemas/plan.schema');
exports.handleStripeWebhook = async (req, res, next) => {
  const signature = req.headers['stripe-signature'];
  let event;

  console.log(">>> [Stripe Webhook] Received request headers:", JSON.stringify(req.headers));
  console.log(">>> [Stripe Webhook] Is req.body a Buffer?:", Buffer.isBuffer(req.body), "Type of req.body:", typeof req.body);

  // 1. تحويل الـ Body من Buffer لـ JSON (عشان Postman يشتغل)
  let rawBody = req.body;
  if (Buffer.isBuffer(req.body)) {
    try {
      rawBody = JSON.parse(req.body.toString());
      console.log(">>> [Stripe Webhook] Successfully parsed raw body to JSON.");
    } catch (e) {
      console.error(">>> [Stripe Webhook] Failed to parse raw body Buffer to JSON:", e.message);
    }
  }

  // 2. تخطي التوقيع للتجربة اليدوية أو في حال عدم وجوده
  if (!signature) {
    console.log("⚠️ Warning: No Stripe Signature found, bypassing for testing...");
    event = rawBody; // استخدم الـ Body اللي حولناه فوق
  } else {
    try {
      console.log(">>> [Stripe Webhook] Attempting signature verification...");
      event = stripeService.constructWebhookEvent(req.body, signature);
      console.log("✅ [Stripe Webhook] Signature verified successfully! Event Type:", event.type);
    } catch (err) {
      console.error(`❌ [Stripe Webhook] Signature Verification Error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }

  // 3. التحديث الفعلي
  try {
    if (event && event.type === 'checkout.session.completed') {
      const session = event.data.object;

      // 1. استخراج الداتا الممكنة
      const metadataDeveloperId = session.metadata?.developerId;
      const clientId = session.client_reference_id;
      const planId = session.metadata?.planId;
      const stripeCustomerId = session.customer;

      console.log(">>> [Stripe Webhook] checkout.session.completed processing...");
      console.log("Metadata:", JSON.stringify(session.metadata));
      console.log("Client Reference ID (clientId):", clientId);
      console.log("Customer ID:", stripeCustomerId);

      let developer = null;

      // 2. البحث عن المطور بأكثر من طريقة عشان لو بتجرب من Postman أو CLI
      if (metadataDeveloperId) {
        console.log(">>> Searching developer by metadataDeveloperId:", metadataDeveloperId);
        developer = await Developer.findById(metadataDeveloperId);
      }
      if (!developer && clientId) {
        console.log(">>> Searching developer by clientId:", clientId);
        developer = await Developer.findById(clientId);
      }
      if (!developer && stripeCustomerId) {
        console.log(">>> Searching developer by stripeCustomerId:", stripeCustomerId);
        developer = await Developer.findOne({ "subscription.stripeCustomerId": stripeCustomerId });
      }

      // لو ملقيناش المطور خالص، نطلع إيرور ومكملش
      if (!developer) {
        console.error(`❌ ERROR: Could not find Developer in DB! Metadata ID: ${metadataDeveloperId}, Client ID: ${clientId}, Customer ID: ${stripeCustomerId}`);
        return res.status(200).json({ received: true, error: "Developer not found" });
      }

      console.log("✅ Developer found in DB:", developer.email);

      // 3. تحديد الخطة (Plan)
      let planTier = "pro";
      let planInterval = "monthly";

      if (planId) {
        const dbPlan = await Plan.findById(planId);
        if (dbPlan) {
          planTier = dbPlan.tier;
          planInterval = dbPlan.interval;
          console.log(`✅ Plan found in DB: ${planTier} / ${planInterval}`);
        } else {
          console.log("⚠️ Plan ID from metadata not found in DB. Defaulting to 'pro'.");
        }
      }

      // 4. تحديث داتا المطور بالطريقة الأضمن في Mongoose
      if (!developer.subscription) {
        developer.subscription = {};
      }

      developer.subscription.status = "active";
      developer.subscription.isPremium = true;
      developer.subscription.plan = planTier;
      developer.subscription.stripeCustomerId = stripeCustomerId;
      developer.subscription.stripeSubscriptionId = session.subscription;
      developer.subscription.interval = planInterval;

      // السطر ده هو السر! بيجبر مونجوز يحفظ التعديلات في الكائنات المتداخلة (Nested Objects)
      developer.markModified("subscription");
      await developer.save();

      console.log("🎉🎉🎉 SUCCESS: Developer updated perfectly in Atlas! isPremium:", developer.subscription.isPremium);
    } else {
      console.log("ℹ️ Event received but not processed (ignored event type):", event?.type);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error("Internal Error:", error);
    res.status(500).send("Internal Error");
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
      .createHmac('sha512', process.env.PAYMOB_HMAC)
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
        $set: {
          "subscription.status": "active",
          "subscription.isPremium": true,
          "subscription.paymobSubscriptionId": obj.order.id.toString(),
        }
      });
    } else {
      await Developer.findByIdAndUpdate(developerId, {
        $set: { "subscription.status": "past_due" }
      });
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error("Paymob Webhook Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
