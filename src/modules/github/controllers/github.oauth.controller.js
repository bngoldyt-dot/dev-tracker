/**
 * github.oauth.controller.js
 * Agent 1 — OAuth 2.0 redirect flow handlers.
 *
 * Route 1: GET /auth/github
 *   → Redirects the browser to GitHub's authorization page.
 *
 * Route 2: GET /auth/github/callback
 *   → GitHub redirects back here with ?code=...
 *   → Exchanges code, links account, activates trial, then redirects to frontend.
 *
 * NOTE: These routes require `protect` ONLY because the user must already be
 * logged in to DevTracker — we are LINKING, not signing up.
 *
 * Flow:
 *   Frontend button click
 *     → GET /auth/github?token=<jwt>
 *     → GitHub OAuth consent screen
 *     → GET /auth/github/callback?code=<code>&state=<jwt>
 *     → Link account + start trial
 *     → Redirect to FRONTEND_GITHUB_SUCCESS_URL with result params
 */
const ApiError = require("../../../utils/apiErrors");
const jwt = require("jsonwebtoken");
const Developer = require("../../auth/schemas/developer.schema");
const { linkGithubAccount } = require("../services/github.service");

// Agent 3 (Refactor): Scopes driven by env to request webhook permissions
const SCOPES = process.env.GITHUB_SCOPES || ["read:user", "user:email", "repo", "admin:repo_hook"].join(" ");

// ─── GET /auth/github ─────────────────────────────────────────────────────────
/**
 * Redirects user to GitHub OAuth with state=<devtracker_jwt>.
 * The JWT is passed as `?token=...` query param by the frontend before redirecting.
 */
const githubOAuthRedirect = (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) return next(new ApiError(400, "DevTracker token is required as ?token=..."));

    // We embed the JWT as `state` so GitHub echoes it back on callback — no session needed.
    const params = new URLSearchParams({
      client_id:    process.env.GITHUB_CLIENT_ID,
      redirect_uri: process.env.GITHUB_CALLBACK_URL,
      scope:        SCOPES,
      state:        token, // stateless CSRF protection via JWT
      prompt:       'login', // force GitHub login screen to avoid identity caching
    });

    const githubUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;
    return res.redirect(githubUrl);
  } catch (error) {
    next(error);
  }
};

// ─── GET /auth/github/callback ────────────────────────────────────────────────
/**
 * Handles GitHub's redirect after user grants permission.
 * Exchanges code, links the account, activates trial, then redirects to frontend.
 */
const githubOAuthCallback = async (req, res, next) => {
  try {
    const { code, state, error: ghError } = req.query;

    const frontendUrl = process.env.FRONTEND_URL || "https://strong-tartufo-f65dca.netlify.app";

    // User denied access on GitHub
    if (ghError) {
      return res.redirect(`${frontendUrl}/github/error?reason=access_denied`);
    }

    if (!code) return next(new ApiError(400, "No code received from GitHub."));
    if (!state) return next(new ApiError(400, "Missing state parameter."));

    // ── 1. LOGIN FLOW ────────────────────────────────────────────────────────
    if (state === "login") {
      const { githubLoginDev } = require("../../auth/services/auth.service");
      const { developer, token } = await githubLoginDev(code);

      const devData = {
        id: developer._id,
        name: developer.name,
        email: developer.email,
        role: developer.role,
      };

      // Redirect to frontend auth/login with token and user data
      return res.redirect(
        `${frontendUrl}/auth/login?token=${token}&user=${encodeURIComponent(
          JSON.stringify(devData)
        )}`
      );
    }

    // ── 2. LINK ACCOUNT FLOW ──────────────────────────────────────────────────
    // Verify the state is a genuine DevTracker JWT
    let decoded;
    try {
      decoded = jwt.verify(state, process.env.JWT_SECRET);
    } catch {
      return next(new ApiError(401, "Invalid or expired DevTracker token in state."));
    }

    // Load developer from token payload
    const developer = await Developer.findById(decoded.id);
    if (!developer) return next(new ApiError(404, "Developer account not found."));

    const developerId = developer._id.toString();

    // Core linking logic (also starts trial)
    const { trialStarted, proTrialEndDate, githubLogin } = await linkGithubAccount(
      developerId,
      code
    );

    // Redirect to frontend success page with trial info as query params
    const frontendBase = process.env.FRONTEND_GITHUB_SUCCESS_URL || `${frontendUrl}/github/success`;
    const params = new URLSearchParams({
      trialStarted:   String(trialStarted),
      githubLogin:    githubLogin || "",
      proTrialEndDate: proTrialEndDate ? proTrialEndDate.toISOString() : "",
    });

    return res.redirect(`${frontendBase}?${params.toString()}`);
  } catch (error) {
    next(error);
  }
};

module.exports = { githubOAuthRedirect, githubOAuthCallback };
