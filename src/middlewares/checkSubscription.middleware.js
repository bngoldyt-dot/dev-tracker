const Developer = require("../modules/auth/schemas/developer.schema");

const checkSubscription = (requiresPremium = false) => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      
      if (!user || !user.subscription) {
        return res.status(403).json({ error: "subscription_required" });
      }

      const { status, trialEndsAt } = user.subscription;
      const now = new Date();

      if (status === "trialing" && trialEndsAt && trialEndsAt < now) {
        await Developer.findByIdAndUpdate(
          user._id,
          { $set: { "subscription.status": "canceled" } }
        );
        
        user.subscription.status = "canceled";

        return res.status(403).json({
          error: "trial_expired",
          message: "Your trial has ended. Please subscribe."
        });
      }

      const currentStatus = user.subscription.status;

      if (currentStatus === "canceled" || currentStatus === "past_due") {
        return res.status(403).json({ error: "subscription_required" });
      }

      if (currentStatus === "free" && requiresPremium) {
        return res.status(403).json({ error: "upgrade_required" });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

module.exports = checkSubscription;
