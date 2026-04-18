/**
 * onboarding.service.js
 * ══════════════════════════════════════════════════════════════════
 * OnboardingService — The Public-Facing Service Layer
 *
 * This is the integration point for TeamMemberController.
 * It provides a clean, single-method API that the controller calls
 * after a developer accepts an invitation.
 *
 * Architecture:
 *   Controller → OnboardingService → OnboardingOrchestrator → Agents
 *
 * The service handles:
 *   • Input validation before handing off to the orchestrator
 *   • Fire-and-forget mode (non-blocking) for controller integration
 *   • Await mode (blocking) when the controller needs the result
 * ══════════════════════════════════════════════════════════════════
 */

const { runOnboardingPipeline } = require("./onboarding.orchestrator");
const ApiError = require("../../utils/apiErrors");

/**
 * Triggers the full onboarding pipeline for a developer who just joined a project.
 * Can be awaited for the result, or called fire-and-forget style.
 *
 * @param {object} params
 * @param {string} params.projectId    — MongoDB ObjectId (string) of the project
 * @param {string} params.newMemberId  — MongoDB ObjectId (string) of the newcomer
 * @param {object} [params.options]
 * @param {boolean} [params.options.waitForResult=false] — If true, awaits full result; if false, fires async
 * @returns {Promise<import('./onboarding.orchestrator').OnboardingResult | { triggered: true }>}
 */
const triggerOnboarding = async ({ projectId, newMemberId, options = {} }) => {
  const { waitForResult = false } = options;

  // ── Validation ─────────────────────────────────────────────────────────────
  if (!projectId) throw new ApiError(400, "projectId is required to trigger onboarding.");
  if (!newMemberId) throw new ApiError(400, "newMemberId is required to trigger onboarding.");

  // ── Fire-and-forget mode (default for controller use) ──────────────────────
  // The controller doesn't need to wait for the onboarding message to be generated.
  // It dispatches the pipeline, returns immediately, and Socket.io delivers the result.
  if (!waitForResult) {
    // Intentionally NOT awaited — runs in the background
    runOnboardingPipeline({ projectId, newMemberId }).catch((err) => {
      console.error(`[OnboardingService] Unhandled pipeline error (fire-and-forget): ${err.message}`);
    });

    return { triggered: true };
  }

  // ── Await mode (for testing or synchronous flows) ──────────────────────────
  return await runOnboardingPipeline({ projectId, newMemberId });
};

module.exports = { triggerOnboarding };
