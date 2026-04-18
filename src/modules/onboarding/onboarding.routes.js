const express = require("express");
const { protect } = require("../../middlewares/auth.middleware");
// Assuming there is an admin middleware to verify admin privileges
// const { adminOnly } = require("../middlewares/admin.middleware");
const {
  triggerOnboardingBot,
  triggerOnboardingBotSync,
} = require("./onboarding.controller");

const onboardingRouter = express.Router();

// Both routes require the user to be logged in
onboardingRouter.use(protect);

// To strictly secure, you would add an adminOnly middleware,
// depending on how DevTracker manages RBAC
onboardingRouter.post("/trigger", triggerOnboardingBot);
onboardingRouter.post("/trigger/sync", triggerOnboardingBotSync);

module.exports = { onboardingRouter };
