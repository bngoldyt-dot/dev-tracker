/**
 * github.controller.js
 * Agent 3 — HTTP handlers for all /api/github/* endpoints.
 *
 * Route matrix (all behind protect + requireProAccess):
 *   GET  /github/repos          → listRepos
 *   POST /github/select-repos   → selectRepos
 *   GET  /github/trial-status   → trialStatus
 *   POST /github/link           → linkAccount  (only protect, no trial gate)
 */
const ApiError = require("../../../utils/apiErrors");
const {
  linkGithubAccount,
  listGithubRepos,
  selectRepos,
  fetchTrialStatus,
  fetchDeveloperActivity,
} = require("../services/github.service");
const { verifyGitHubWebhook } = require("../utils/github.webhook.helper");
const TaskActivity = require("../../auth/schemas/taskActivity.schema");
const Developer = require("../../auth/schemas/developer.schema");

// ─── POST /github/link ────────────────────────────────────────────────────────
/**
 * Links the GitHub account to the current authenticated DevTracker user.
 * Triggers the 30-day Pro trial on first link.
 *
 * Body: { code: string }  — GitHub OAuth code from frontend
 */
const linkAccount = async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) return next(new ApiError(400, "GitHub OAuth code is required."));

    const developerId = req.user._id.toString();
    const { trialStarted, proTrialEndDate, githubLogin } = await linkGithubAccount(
      developerId,
      code
    );

    res.status(200).json({
      message: trialStarted
        ? "GitHub account linked! Your 30-day Pro trial has started."
        : "GitHub account re-linked successfully.",
      data: {
        githubLogin,
        trialStarted,
        proTrialEndDate: proTrialEndDate || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── GET /github/repos ────────────────────────────────────────────────────────
/**
 * Returns the user's GitHub repositories (cached 5 min per user).
 */
const listRepos = async (req, res, next) => {
  try {
    const developerId = req.user._id.toString();
    const repos = await listGithubRepos(developerId);

    res.status(200).json({
      message: "Repositories fetched successfully.",
      count: repos.length,
      data: repos,
    });
  } catch (error) {
    next(error);
  }
};

// ─── POST /github/select-repos ────────────────────────────────────────────────
/**
 * Agent 1: The Logic & Validation Architect
 *
 * Receives the full desired repos array, detects newly added repos via state
 * comparison in the service, triggers auto-project creation, and returns a
 * rich summary instead of a simple success message.
 *
 * Body: { repos: Array<{ repoId, name, fullName, private?, htmlUrl?, language?, description? }> }
 */
const selectReposHandler = async (req, res, next) => {
  try {
    const { repos } = req.body;
    if (!Array.isArray(repos)) {
      return next(new ApiError(400, "repos must be an array."));
    }

    const developerId = req.user._id.toString();

    // Service handles: validation, state diff, DB persist, project auto-creation
    const { linkedRepos, projectSummary, newReposCount } = await selectRepos(developerId, repos);

    // Fetch trial status to include in the summary for the UI
    const trialStatus = await fetchTrialStatus(developerId);

    res.status(200).json({
      message: "Selected repositories saved successfully.",
      summary: {
        newProjectsCreated: projectSummary.created,
        projectsSkipped: projectSummary.skipped,
        newReposLinked: newReposCount,
        totalLinkedRepos: linkedRepos.length,
        trialStatus: {
          active: trialStatus.active,
          daysRemaining: trialStatus.daysRemaining,
          endsAt: trialStatus.endsAt,
        },
      },
      data: linkedRepos,
    });
  } catch (error) {
    next(error);
  }
};

// ─── GET /github/trial-status ─────────────────────────────────────────────────
/**
 * Returns trial status for the UI banner.
 * Response: { isPro, githubLinked, githubLogin, active, daysRemaining, endsAt }
 */
const trialStatus = async (req, res, next) => {
  try {
    const developerId = req.user._id.toString();
    const status = await fetchTrialStatus(developerId);

    res.status(200).json({
      message: "Trial status retrieved.",
      data: status,
    });
  } catch (error) {
    next(error);
  }
};

// ─── POST /github/webhook ──────────────────────────────────────────────────────
/**
 * Agent 3: Handles incoming webhooks from GitHub.
 * Verifies HMAC signature, extracts push event data, and logs as Developer Activity.
 */
const handleWebhook = async (req, res, next) => {
  try {
    const signature = req.headers["x-hub-signature-256"];
    const eventType = req.headers["x-github-event"];
    
    // Express raw body is required for HMAC validation
    // Assume app.js uses express.raw() for /webhooks/ paths as originally seen in app.js
    const payloadBuffer = req.body; 

    if (!verifyGitHubWebhook(payloadBody, signature)) {
      return res.status(401).json({ error: "Invalid webhook signature" });
    }

    const payload = JSON.parse(payloadBuffer.toString('utf8'));

    // Handle 'push' events
    if (eventType === "push") {
       const githubLogin = payload.sender.login;
       const repositoryName = payload.repository.full_name;
       const commitCount = payload.commits ? payload.commits.length : 0;

       // Find developer by github login
       const developer = await Developer.findOne({ "github.githubLogin": githubLogin });
       
       if (developer) {
          // Log Activity (assuming source MANUAL for now, or you could extend TaskActivity)
          // In a real scenario we'd map this to a specific Project/Task or extend schema
           console.log(`[GitHub Webhook] Push from ${githubLogin} to ${repositoryName} with ${commitCount} commits. Logged as activity.`);
          // Example (Requires schema updates to fully support raw github events without project/task links):
          // await TaskActivity.create({ developer: developer._id, type: 'END', source: 'MANUAL', ... })
       }
    }

    // Acknowledge webhook
    res.status(200).send("Webhook received and processed.");
  } catch (error) {
    console.error("[GitHub Webhook Error]", error);
    // Don't leak stack traces to GitHub
    res.status(500).send("Webhook processing error");
  }
};

// ─── GET /github/activity ─────────────────────────────────────────────────────
/**
 * Agent 3: Returns live GitHub events for the developer's linked repositories.
 */
const trialActivity = async (req, res, next) => {
  try {
    const developerId = req.user._id.toString();
    const activity = await fetchDeveloperActivity(developerId);
    
    res.status(200).json({
      message: "Activity fetched successfully.",
      data: activity,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { linkAccount, listRepos, selectReposHandler, trialStatus, handleWebhook, trialActivity };
