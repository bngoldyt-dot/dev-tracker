/**
 * personaWriter.agent.js
 * ══════════════════════════════════════════════════════════════════
 * AGENT 3 — The Persona Writer (Gemini Integration)
 *
 * Responsibility:
 *   Takes the structured ProjectBrief from Agent 2 and calls the
 *   Gemini API to generate a high-tech, welcoming onboarding message
 *   with a Glassmorphism-vibe tone — precise, elegant, no fluff.
 *
 * System Prompt Design Philosophy:
 *   The system prompt establishes a hard persona: "ARIA" (Automated
 *   Repository Intelligence Assistant). ARIA speaks like a senior
 *   engineer who respects the newcomer's time — dense with signal,
 *   zero with noise. Tone: dark-mode, elite, warm.
 *
 * Gemini Model: gemini-1.5-flash (fast, cost-efficient for this use case)
 * Fallback: If Gemini fails, a structured fallback message is returned.
 * ══════════════════════════════════════════════════════════════════
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");

// ─── Gemini Client (lazy singleton) ──────────────────────────────────────────

let _geminiClient = null;

const _getGeminiClient = () => {
  if (_geminiClient) return _geminiClient;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "[PersonaWriter] GEMINI_API_KEY is not set. Add it to your .env file."
    );
  }

  _geminiClient = new GoogleGenerativeAI(apiKey);
  return _geminiClient;
};

// ─── System Prompt ────────────────────────────────────────────────────────────

/**
 * The core system prompt defining ARIA's persona and output contract.
 * This is the "DNA" of the onboarding message — every word is intentional.
 */
const ARIA_SYSTEM_PROMPT = `
You are ARIA — Automated Repository Intelligence Assistant — an elite AI embedded inside DevTrack, a SaaS platform for managing high-performance developer squads.

Your mission: Generate a single, polished onboarding message for a developer who just joined a project. The message must feel like it came from the most experienced engineer on the team — someone who respects the newcomer's intelligence and their time.

## TONE DIRECTIVES (Non-negotiable)
- Glassmorphism aesthetic: clean, layered, high-contrast — like a dark dashboard with glowing accents.
- Confident but not arrogant. Warm but not generic. Dense with signal, zero with noise.
- Use subtle tech metaphors naturally — don't overdo it.
- No corporate filler phrases: no "excited to have you", no "feel free to reach out", no "onboarding journey".
- Address the developer by name.

## OUTPUT STRUCTURE (Always in this exact format)
Your entire response must be a valid JSON object with this shape:

{
  "subject": "<A crisp, impactful subject line — max 10 words>",
  "greeting": "<One powerful opening line — sets the tone immediately>",
  "projectSnapshot": "<2-3 sentences: what the project is, its stack highlights, and its current pulse>",
  "priorityFiles": "<Bullet-list (markdown) of the 3-5 files/dirs to open first — with WHY for each>",
  "bottleneckAlerts": "<Bullet-list (markdown) of any risk zones or complexity hot-spots. If none, write: 'All clear on the radar — standard complexity for this stack.'>",
  "firstMission": "<The newcomer's first task — title, estimated effort, deadline urgency, and a one-line strategic tip>",
  "closingSignal": "<A single memorable line — like a handshake from the codebase itself>"
}

## RULES
1. ALL fields are required. Never omit a field.
2. "projectSnapshot" must name the actual tech stack — not vague references like "modern stack".
3. "priorityFiles" must use actual file/directory paths when provided. Be specific.
4. "bottleneckAlerts" must reference actual package names if bottlenecks were detected.
5. "firstMission" must include the urgency level if the task is urgent.
6. Keep the total message scannable — not a wall of text.
7. The JSON must be parseable by JSON.parse() — no trailing commas, no markdown fences around the JSON.
`;

// ─── Prompt Builder ───────────────────────────────────────────────────────────

/**
 * Converts a ProjectBrief into a rich, factual user-turn prompt.
 * feeds Gemini all the structured data it needs to generate ARIA's message.
 *
 * @param {import('./contextSynthesizer.agent').ProjectBrief} brief
 * @returns {string} User-turn prompt string
 */
const _buildUserPrompt = (brief) => {
  const {
    developer,
    project,
    techStackMap,
    techStackFlat,
    readmeSummaries,
    activeRepos,
    bottlenecks,
    priorityFiles,
    firstTask,
    dataSourceFlags,
  } = brief;

  // Format tech stack for readability
  const stackSummary = Object.entries(techStackMap)
    .map(([cat, pkgs]) => `  ${cat}: ${pkgs.join(", ")}`)
    .join("\n");

  // Format README summaries
  const readmeSection =
    readmeSummaries.length > 0
      ? readmeSummaries
          .map((r) => `  [${r.repoName}] ${r.summary}`)
          .join("\n")
      : "  No README data available.";

  // Format bottlenecks
  const bottleneckSection =
    bottlenecks.length > 0
      ? bottlenecks.map((b) => `  ⚠ ${b.package}: ${b.warning}`).join("\n")
      : "  None detected.";

  // Format priority files
  const prioritySection = priorityFiles
    .slice(0, 5)
    .map((f) => `  → ${f.filename} (${f.reason})`)
    .join("\n");

  // Format task
  const taskSection = firstTask
    ? `
  Title: "${firstTask.title}"
  Estimated Hours: ${firstTask.estimatedHours ?? "not specified"}
  Deadline: ${firstTask.deadline ? new Date(firstTask.deadline).toDateString() : "no deadline"}
  Urgency: ${firstTask.urgency.label}
  Days Until Deadline: ${firstTask.urgency.daysUntilDeadline ?? "N/A"}`
    : "  No task assigned yet.";

  // Data source note
  const dataNote = !dataSourceFlags.githubAvailable
    ? `\nNOTE: GitHub API was unavailable during mining (${dataSourceFlags.githubError || "unknown error"}). Stack data sourced from DB metadata only.`
    : "";

  return `
Generate an onboarding message for the following developer and project context.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEVELOPER PROFILE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Name: ${developer.name}
  GitHub: ${developer.githubLogin ? `@${developer.githubLogin}` : "not linked"}
  Email: ${developer.email || "on file"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROJECT CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Project Name: ${project.name}
  Client: ${project.clientName || "Internal"}
  Description: ${project.description}
  Status: ${project.status}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TECH STACK (categorized)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${stackSummary || "  Stack data unavailable."}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ACTIVE REPOSITORIES (${activeRepos.length})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${activeRepos.map((r) => `  - ${r.fullName || r.name}`).join("\n") || "  No repos linked."}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
README SUMMARIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${readmeSection}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRIORITY FILES (recommend these to the newcomer)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${prioritySection}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BOTTLENECK ALERTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${bottleneckSection}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIRST MISSION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${taskSection}
${dataNote}

Now generate the onboarding message JSON as specified. Remember: signal over noise. Make every word count.
`.trim();
};

// ─── Fallback Message (if Gemini is unavailable) ──────────────────────────────

/**
 * Generates a structured fallback onboarding message without Gemini.
 * Ensures the onboarding flow never fails completely.
 *
 * @param {import('./contextSynthesizer.agent').ProjectBrief} brief
 * @returns {Object} Fallback message object
 */
const _buildFallbackMessage = (brief) => {
  const { developer, project, priorityFiles, firstTask, techStackMap } = brief;
  const topCategories = Object.keys(techStackMap).slice(0, 3).join(", ");

  return {
    subject: `Welcome to ${project.name}, ${developer.name}`,
    greeting: `${developer.name} — you're now authenticated into the ${project.name} codebase. ARIA is standing by.`,
    projectSnapshot: `${project.name} is a ${project.status} project ${project.clientName ? `for ${project.clientName}` : ""}. The stack runs on ${topCategories || "a modern backend stack"}. ${project.description || ""}`,
    priorityFiles: priorityFiles
      .slice(0, 4)
      .map((f) => `- **${f.filename}** — ${f.reason}`)
      .join("\n"),
    bottleneckAlerts: "Automated analysis unavailable — perform manual dependency review.",
    firstMission: firstTask
      ? `Task: **${firstTask.title}** | Est: ${firstTask.estimatedHours ?? "TBD"} hrs | Urgency: ${firstTask.urgency.label}`
      : "No task assigned yet — sync with team lead for initial scope.",
    closingSignal: "The stack is live. The clock is ticking. Ship clean code.",
    _fallback: true,
  };
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} OnboardingMessage
 * @property {string}  subject
 * @property {string}  greeting
 * @property {string}  projectSnapshot
 * @property {string}  priorityFiles      — markdown bullet list
 * @property {string}  bottleneckAlerts   — markdown bullet list
 * @property {string}  firstMission
 * @property {string}  closingSignal
 * @property {boolean} [_fallback]        — present and true if Gemini was unavailable
 */

/**
 * Entry point for Agent 3.
 * Sends the project brief to Gemini and returns a parsed onboarding message object.
 * Falls back to a structured message if Gemini is unavailable.
 *
 * @param {import('./contextSynthesizer.agent').ProjectBrief} brief
 * @returns {Promise<OnboardingMessage>}
 */
const runPersonaWriter = async (brief) => {
  try {
    const client = _getGeminiClient();
    const model = client.getGenerativeModel({
      model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
      systemInstruction: ARIA_SYSTEM_PROMPT,
      generationConfig: {
        temperature: 0.75,       // balanced creativity — precise but not robotic
        topP: 0.9,
        maxOutputTokens: 1024,   // keeps response tight and parseable
        responseMimeType: "application/json", // force JSON output mode
      },
    });

    const userPrompt = _buildUserPrompt(brief);

    const result = await model.generateContent(userPrompt);
    const rawText = result.response.text();

    // ── Parse and validate the JSON response ──────────────────────────────
    let parsed;
    try {
      // Strip potential markdown fences if model still wraps in ```json
      const cleaned = rawText.replace(/^```(?:json)?\n?/i, "").replace(/```$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("[PersonaWriter] ⚠️  Gemini returned unparseable JSON. Raw response:", rawText);
      return _buildFallbackMessage(brief);
    }

    // Validate required fields
    const requiredFields = ["subject", "greeting", "projectSnapshot", "priorityFiles", "bottleneckAlerts", "firstMission", "closingSignal"];
    const missingFields = requiredFields.filter((f) => !parsed[f]);

    if (missingFields.length > 0) {
      console.warn(`[PersonaWriter] ⚠️  Gemini response missing fields: ${missingFields.join(", ")}. Merging with fallback.`);
      const fallback = _buildFallbackMessage(brief);
      return { ...fallback, ...parsed }; // fill gaps with fallback values
    }

    console.log(`[PersonaWriter] ✅ ARIA message generated for ${brief.developer.name} on project "${brief.project.name}"`);
    return parsed;

  } catch (error) {
    console.error(`[PersonaWriter] ⚠️  Gemini API call failed: ${error.message}. Returning fallback.`);
    return _buildFallbackMessage(brief);
  }
};

module.exports = { runPersonaWriter, ARIA_SYSTEM_PROMPT };
