/**
 * onboarding.orchestrator.js
 * ══════════════════════════════════════════════════════════════════
 * OnboardingOrchestrator — The Master Conductor
 *
 * Manages the full 3-agent pipeline with a parallel-first strategy:
 *
 *   Phase 1 (Parallel):
 *     ├── Agent 1A: DB Mining      ──┐
 *     └── Agent 1B: GitHub Mining  ──┴──→ RawMinedData (merged)
 *
 *   Phase 2 (Sequential, awaits Phase 1):
 *     └── Agent 2: Context Synthesizer ──→ ProjectBrief
 *
 *   Phase 3 (Sequential, awaits Phase 2):
 *     └── Agent 3: Persona Writer (Gemini) ──→ OnboardingMessage
 *
 * Guarantees:
 *   • Partial success — GitHub failure never blocks the pipeline
 *   • Total pipeline timeout via Promise.race (configurable)
 *   • All errors are caught, logged, and surfaced gracefully
 *   • Socket.io notification dispatched on completion
 *   • Full execution metadata returned for observability
 *
 * ══════════════════════════════════════════════════════════════════
 */

const { runDataMiner } = require("./agents/dataMiner.agent");
const { runContextSynthesizer } = require("./agents/contextSynthesizer.agent");
const { runPersonaWriter } = require("./agents/personaWriter.agent");

// ─── Constants ────────────────────────────────────────────────────────────────

/** Hard ceiling for the entire onboarding pipeline (ms). Prevents runaway requests. */
const PIPELINE_TIMEOUT_MS = parseInt(process.env.ONBOARDING_TIMEOUT_MS, 10) || 15_000;

// ─── Pipeline Timeout Wrapper ─────────────────────────────────────────────────

/**
 * Races a promise against a timeout.
 * @param {Promise} promise
 * @param {number}  ms        — timeout in milliseconds
 * @param {string}  label     — for the timeout error message
 */
const _withTimeout = (promise, ms, label) => {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`[Orchestrator] ${label} timed out after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} OnboardingResult
 * @property {boolean} success
 * @property {Object}  message          — the onboarding message (or error fallback)
 * @property {Object}  meta             — execution metadata for observability
 * @property {string}  [error]          — top-level error message if pipeline failed
 */

/**
 * Runs the full 3-agent onboarding pipeline and notifies the newcomer via Socket.io.
 *
 * @param {object} params
 * @param {string} params.projectId    — MongoDB ObjectId of the project
 * @param {string} params.newMemberId  — MongoDB ObjectId of the joining developer
 * @returns {Promise<OnboardingResult>}
 */
const runOnboardingPipeline = async ({ projectId, newMemberId }) => {
  const startedAt = Date.now();
  const meta = {
    projectId,
    newMemberId,
    startedAt: new Date(startedAt).toISOString(),
    phases: {},
  };

  console.log(`\n[Orchestrator] 🚀 Onboarding pipeline started — Project: ${projectId} | Developer: ${newMemberId}`);

  try {
    // ════════════════════════════════════════════════════════════════
    // PHASE 1 — Data Mining (parallel DB + GitHub)
    // Agent 1 runs both tracks internally via Promise.allSettled
    // ════════════════════════════════════════════════════════════════
    const phase1Start = Date.now();

    const rawData = await _withTimeout(
      runDataMiner(projectId, newMemberId),
      PIPELINE_TIMEOUT_MS * 0.6, // give Phase 1 up to 60% of total budget
      "Phase 1 (Data Mining)"
    );

    meta.phases.dataMining = {
      durationMs: Date.now() - phase1Start,
      githubAvailable: rawData.githubSuccess,
      githubError: rawData.githubError || null,
      techStackCount: rawData.techStack?.length || 0,
      reposFound: rawData.activeRepos?.length || 0,
    };

    console.log(
      `[Orchestrator] ✅ Phase 1 complete — ${meta.phases.dataMining.durationMs}ms | GitHub: ${rawData.githubSuccess ? "✓" : "✗ degraded"}`
    );

    // ════════════════════════════════════════════════════════════════
    // PHASE 2 — Context Synthesis (synchronous — pure data transformation)
    // ════════════════════════════════════════════════════════════════
    const phase2Start = Date.now();

    // runContextSynthesizer is synchronous (pure transformation, no I/O)
    const brief = runContextSynthesizer(rawData);

    meta.phases.contextSynthesis = {
      durationMs: Date.now() - phase2Start,
      bottlenecksDetected: brief.bottlenecks?.length || 0,
      priorityFilesIdentified: brief.priorityFiles?.length || 0,
    };

    console.log(
      `[Orchestrator] ✅ Phase 2 complete — ${meta.phases.contextSynthesis.durationMs}ms | Bottlenecks: ${brief.bottlenecks.length}`
    );

    // ════════════════════════════════════════════════════════════════
    // PHASE 3 — Persona Writing (Gemini API call)
    // ════════════════════════════════════════════════════════════════
    const phase3Start = Date.now();

    const message = await _withTimeout(
      runPersonaWriter(brief),
      15000, // Phase 3 timeout explicitly increased to 15 seconds
      "Phase 3 (Persona Writer / Gemini)"
    );

    meta.phases.personaWriting = {
      durationMs: Date.now() - phase3Start,
      usedFallback: message._fallback === true,
    };

    console.log(
      `[Orchestrator] ✅ Phase 3 complete — ${meta.phases.personaWriting.durationMs}ms | Fallback: ${message._fallback ? "yes" : "no"}`
    );

    // ════════════════════════════════════════════════════════════════
    // NOTIFICATION — Push message via Socket.io (if server has it)
    // ════════════════════════════════════════════════════════════════
    if (global.io) {
      global.io.to(newMemberId.toString()).emit("onboarding_message", {
        type: "ARIA_ONBOARDING",
        projectId,
        message,
        generatedAt: new Date().toISOString(),
      });
      console.log(`[Orchestrator] 📡 Socket.io notification dispatched to developer ${newMemberId}`);
    }

    // ── Final metadata ─────────────────────────────────────────────
    meta.totalDurationMs = Date.now() - startedAt;
    meta.completedAt = new Date().toISOString();

    console.log(`[Orchestrator] 🏁 Pipeline complete — Total: ${meta.totalDurationMs}ms\n`);

    return {
      success: true,
      message,
      meta,
    };

  } catch (error) {
    const totalDurationMs = Date.now() - startedAt;
    
    // Determine which phase failed based on metadata
    let failedPhase = "Unknown Phase";
    if (!meta.phases.dataMining) failedPhase = "Phase 1 (Data Mining)";
    else if (!meta.phases.contextSynthesis) failedPhase = "Phase 2 (Context Synthesis)";
    else if (!meta.phases.personaWriting) failedPhase = "Phase 3 (Persona Writer / Gemini)";

    console.error(`[Orchestrator] ❌ Pipeline failed at ${failedPhase} after ${totalDurationMs}ms. Reason: ${error.message}`);
    if (error.stack) console.error(`[Orchestrator] Stack Trace:`, error.stack);

    // Return a graceful error state — never throw out to the controller
    return {
      success: false,
      message: {
        subject: "Welcome to the team — Manual onboarding in progress",
        greeting: "Welcome aboard! Our automated system hit a snag, but your team lead will brief you shortly.",
        projectSnapshot: "Project context is being prepared manually.",
        priorityFiles: "- Contact your team lead for the initial orientation.",
        bottleneckAlerts: "Automated analysis unavailable.",
        firstMission: "Sync with your team lead to receive your first task.",
        closingSignal: "The stack awaits. You've got this.",
        _fallback: true,
        _pipelineError: true,
      },
      meta: {
        ...meta,
        totalDurationMs,
        completedAt: new Date().toISOString(),
        error: error.message,
      },
      error: error.message,
    };
  }
};

module.exports = { runOnboardingPipeline };
