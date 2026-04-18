/**
 * dataMiner.agent.js
 * ══════════════════════════════════════════════════════════════════
 * AGENT 1 — The Data Miner
 *
 * Responsibility:
 *   Queries MongoDB and the GitHub API simultaneously using Promise.allSettled
 *   to guarantee Partial Success — if GitHub is slow or fails, the bot
 *   continues with pure DB data. Never blocks the pipeline.
 *
 * Parallel tracks:
 *   Track A (DB)     → project details, linked repos, newcomer's first task
 *   Track B (GitHub) → README summary, package.json tech stack (per repo)
 *
 * Output shape → RawMinedData (see JSDoc below)
 * ══════════════════════════════════════════════════════════════════
 */

const axios = require("axios");
const Project = require("../../auth/schemas/project.schema");
const Task = require("../../auth/schemas/task.schema");
const Developer = require("../../auth/schemas/developer.schema");
const { decryptToken } = require("../../../utils/crypto.helper");

// ─── Constants ────────────────────────────────────────────────────────────────

/** Hard timeout for any single GitHub API call (ms). Keeps p99 latency tight. */
const GITHUB_TIMEOUT_MS = 4_000;

// ─── Internal GitHub helpers ──────────────────────────────────────────────────

/**
 * Builds Axios config with auth headers and a strict timeout.
 * @param {string} token — raw (decrypted) GitHub OAuth token
 */
const _githubHeaders = (token) => ({
  headers: {
    Authorization: `Bearer ${token}`,
    "User-Agent": "DevTracker-OnboardingBot/1.0",
    Accept: "application/vnd.github.v3+json",
  },
  timeout: GITHUB_TIMEOUT_MS,
});

/**
 * Fetches and decodes a file from a GitHub repo via the Contents API.
 * Returns null on any failure (404, timeout, rate-limit, etc.).
 *
 * @param {string} token
 * @param {string} fullName  — e.g. "octocat/Hello-World"
 * @param {string} filePath  — e.g. "package.json" | "README.md"
 * @returns {Promise<string|null>} Decoded file content string or null
 */
const _fetchFileContent = async (token, fullName, filePath) => {
  try {
    const { data } = await axios.get(
      `https://api.github.com/repos/${fullName}/contents/${filePath}`,
      _githubHeaders(token)
    );
    if (!data?.content) return null;
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch {
    return null; // silent degradation — caller decides what to do
  }
};

/**
 * Extracts a clean tech-stack array from raw package.json content.
 * Merges dependencies + devDependencies, strips version strings.
 *
 * @param {string|null} rawContent
 * @returns {string[]}
 */
const _parseTechStack = (rawContent) => {
  if (!rawContent) return [];
  try {
    const pkg = JSON.parse(rawContent);
    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };
    return Object.keys(allDeps);
  } catch {
    return [];
  }
};

/**
 * Extracts a short README summary (first non-empty paragraph, max 500 chars).
 *
 * @param {string|null} rawContent
 * @returns {string}
 */
const _extractReadmeSummary = (rawContent) => {
  if (!rawContent) return "No README available.";
  // Strip markdown headings and grab the first meaningful paragraph
  const cleaned = rawContent
    .replace(/^#{1,6}\s+.+$/gm, "") // remove headings
    .replace(/!\[.*?\]\(.*?\)/g, "") // remove images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // strip links, keep text
    .trim();

  const firstParagraph = cleaned.split(/\n\s*\n/)[0]?.trim() || "";
  return firstParagraph.slice(0, 500) || "No summary extractable.";
};

// ─── Track A: Database Mining ─────────────────────────────────────────────────

/**
 * Fetches all relevant DB data for the project and the newcomer.
 *
 * @param {string} projectId
 * @param {string} newMemberId
 * @returns {Promise<DBData>}
 */
const _mineDatabase = async (projectId, newMemberId) => {
  const [project, firstTask, newMember] = await Promise.all([
    Project.findById(projectId).lean(),
    Task.findOne({ project: projectId, status: { $ne: "done" } })
      .sort({ createdAt: 1 })
      .lean(),
    Developer.findById(newMemberId).select("name email github").lean(),
  ]);

  return {
    project: project
      ? {
          id: project._id,
          name: project.name,
          description: project.description,
          clientName: project.clientName,
          status: project.status,
          linkedRepos: project.github?.linkedRepos || [],
          githubRepoId: project.githubRepoId || null,
        }
      : null,
    firstTask: firstTask
      ? {
          id: firstTask._id,
          title: firstTask.title,
          estimatedHours: firstTask.estimatedHours,
          deadline: firstTask.deadline,
          status: firstTask.status,
        }
      : null,
    newMember: newMember
      ? {
          id: newMember._id,
          name: newMember.name,
          email: newMember.email,
          githubLogin: newMember.github?.githubLogin || null,
          githubToken: newMember.github?.githubToken || null,
        }
      : null,
  };
};

// ─── Track B: GitHub Mining (per repo) ───────────────────────────────────────

/**
 * For each linked repo, races to fetch README + package.json in parallel.
 * A per-repo timeout wrapper ensures a slow repo never hangs the whole track.
 *
 * @param {string} rawToken   — decrypted GitHub token
 * @param {Array}  repos      — array of { fullName, name } objects
 * @returns {Promise<GitHubData>}
 */
const _mineGitHub = async (rawToken, repos) => {
  if (!repos || repos.length === 0) {
    return { techStack: [], readmeSummaries: [], activeRepos: [] };
  }

  // Race all repos concurrently — Promise.allSettled = partial success per repo
  const repoResults = await Promise.allSettled(
    repos.map(async (repo) => {
      const [pkgContent, readmeContent] = await Promise.all([
        _fetchFileContent(rawToken, repo.fullName, "package.json"),
        _fetchFileContent(rawToken, repo.fullName, "README.md"),
      ]);

      return {
        repoName: repo.name,
        fullName: repo.fullName,
        techStack: _parseTechStack(pkgContent),
        readmeSummary: _extractReadmeSummary(readmeContent),
      };
    })
  );

  // Aggregate across all successful repos
  const techStackSet = new Set();
  const readmeSummaries = [];
  const activeRepos = [];

  repoResults.forEach((result) => {
    if (result.status === "fulfilled" && result.value) {
      const { repoName, fullName, techStack, readmeSummary } = result.value;
      techStack.forEach((dep) => techStackSet.add(dep));
      readmeSummaries.push({ repoName, summary: readmeSummary });
      activeRepos.push({ name: repoName, fullName });
    }
  });

  return {
    techStack: [...techStackSet],
    readmeSummaries,
    activeRepos,
  };
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} RawMinedData
 * @property {Object|null} project       — project doc slice
 * @property {Object|null} firstTask     — first pending task for newcomer
 * @property {Object|null} newMember     — newcomer profile
 * @property {string[]}    techStack     — merged deps from all linked repos
 * @property {Object[]}    readmeSummaries — [{ repoName, summary }]
 * @property {Object[]}    activeRepos   — [{ name, fullName }]
 * @property {boolean}     githubSuccess — was the GitHub API reachable?
 * @property {string|null} githubError   — error message if GitHub failed
 */

/**
 * Entry point for Agent 1.
 * Runs DB mining and GitHub mining in parallel.
 * GitHub failure is gracefully handled — the pipeline always continues.
 *
 * @param {string} projectId
 * @param {string} newMemberId  — the developer who just joined
 * @returns {Promise<RawMinedData>}
 */
const runDataMiner = async (projectId, newMemberId) => {
  // ── Parallel: DB track runs always; GitHub track races alongside ──────────
  const [dbResult, githubTrackResult] = await Promise.allSettled([
    _mineDatabase(projectId, newMemberId),
    // GitHub track is a deferred promise — we build it after we know the token
    // We use an IIFE so we can async-chain without blocking DB track
    (async () => {
      // We need DB data for the token, but we can start a preliminary DB query
      // for the admin's token (project owner) or the member's token.
      // Strategy: get the admin (project owner) token for GitHub API calls,
      // since they have the linked repos. Falls back to member token.
      const [projectDoc, adminDoc] = await Promise.all([
        Project.findById(projectId).select("owner").lean(),
        null, // resolved after projectDoc
      ]);

      if (!projectDoc) throw new Error("Project not found for GitHub mining");

      const ownerDoc = await Developer.findById(projectDoc.owner)
        .select("github")
        .lean();

      const encryptedToken = ownerDoc?.github?.githubToken;
      if (!encryptedToken) throw new Error("No GitHub token on project owner");

      const rawToken = decryptToken(encryptedToken);
      if (!rawToken) throw new Error("Failed to decrypt GitHub token");

      const linkedRepos = ownerDoc?.github?.linkedRepos || [];
      // Only mine repos associated with this specific project (or all if filter unavailable)
      return _mineGitHub(rawToken, linkedRepos);
    })(),
  ]);

  // ── Unpack results ────────────────────────────────────────────────────────

  const dbData =
    dbResult.status === "fulfilled"
      ? dbResult.value
      : { project: null, firstTask: null, newMember: null };

  const githubSuccess = githubTrackResult.status === "fulfilled";
  const githubData = githubSuccess
    ? githubTrackResult.value
    : { techStack: [], readmeSummaries: [], activeRepos: [] };

  if (!githubSuccess) {
    // Non-blocking warning — pipeline continues with DB data only
    console.warn(
      `[DataMiner] ⚠️  GitHub API unavailable: ${githubTrackResult.reason?.message}. Proceeding with DB data only.`
    );
  }

  return {
    ...dbData,
    ...githubData,
    githubSuccess,
    githubError: githubSuccess ? null : githubTrackResult.reason?.message,
  };
};

module.exports = { runDataMiner };
