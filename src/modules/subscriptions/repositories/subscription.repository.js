const Developer = require("../../auth/schemas/developer.schema");
const Plan = require("../schemas/plan.schema");

const getActivePlan = async (userId) => {
  const developer = await Developer.findById(userId).lean();
  if (!developer) return null;

  const planTier = developer.subscription?.plan || "free";
  const interval = developer.subscription?.interval || "monthly";
  const currency = developer.subscription?.currency || "USD";

  const planInfo = await Plan.findOne({
    tier: planTier,
    interval,
    currency,
    isActive: true,
  }).lean();

  if (developer.subscription) {
    developer.subscription.planDetails = planInfo;
  }

  return developer;
};

const updateSubscriptionStatus = async (userId, updateObj) => {
  const updateData = {};
  for (const [key, value] of Object.entries(updateObj)) {
    updateData[`subscription.${key}`] = value;
  }

  return await Developer.findByIdAndUpdate(
    userId,
    { $set: updateData },
    { new: true }
  );
};

const checkTrialExpiry = async (userId) => {
  const developer = await Developer.findById(userId);
  if (!developer || !developer.subscription || !developer.subscription.trialEndsAt) {
    return false;
  }
  
  return developer.subscription.trialEndsAt < new Date();
};

const getSubscriptionByCurrency = async (userId) => {
  const developer = await Developer.findById(userId);
  return developer?.subscription?.currency || "USD";
};

module.exports = {
  getActivePlan,
  updateSubscriptionStatus,
  checkTrialExpiry,
  getSubscriptionByCurrency
};
