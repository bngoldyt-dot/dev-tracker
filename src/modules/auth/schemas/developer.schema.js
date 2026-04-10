const mongoose = require("mongoose");
const { githubEmbeddedSchema } = require("./github.embedded.schema");

const developerSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "name is required"], minlength: 3 },
    email: {
      type: String,
      required: [true, "email is required"],
      unique: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        "Please fill a valid email address",
      ],
    },
    password: {
      type: String,
      required: [true, "password is required"],
      minlength: 8,
    },
    role: {
      type: String,
      enum: ["developer", "admin"],
      default: "developer",
      lowercase: true,
    },


    subscription: {
      plan: {
        type: String,
        enum: ["free", "pro", "enterprise"],
        default: "free"
      },
      isPremium: { type: Boolean, default: false },
      stripeCustomerId: { type: String }, // هنحتاجه لما نربط Stripe
      status: {
        type: String,
        enum: ["trialing", "active", "past_due", "canceled", "free"],
        default: "free"
      },
      currentPeriodEnd: { type: Date },
      trialEndsAt: { type: Date },
      paymobSubscriptionId: { type: String },
      stripeSubscriptionId: { type: String },
      interval: {
        type: String,
        enum: ["monthly", "yearly"],
        default: "monthly"
      },
      currency: {
        type: String,
        enum: ["EGP", "USD"],
        default: "USD"
      }
    },
    projectCount: {
      type: Number,
      default: 0
    },

    // ── GitHub Integration ────────────────────────────────────────────────
    github: { type: githubEmbeddedSchema, default: () => ({}) },
    // ------------------------------------------

    resetOTP: { type: String },
    resetOTPExpires: { type: Date },
    resetOTPAttempts: {
      type: Number,
      default: 0,
    },

    teams: [{
      adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Developer"
      },
      joinedAt: {
        type: Date,
        default: Date.now
      },
      permissions: {
        canCreateProjects: { type: Boolean, default: false },
        canEditProjects: { type: Boolean, default: false },
        canDeleteProjects: { type: Boolean, default: false },
        canManageTasks: { type: Boolean, default: false },
        canSeeFinancials: { type: Boolean, default: false }
      }
    }],

    resetOTPLastRequest: {
      type: Date,
    }
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
// Sparse so docs without a githubId don't consume index space
developerSchema.index({ "github.githubId": 1 }, { sparse: true });

module.exports = mongoose.model("Developer", developerSchema, "developers");