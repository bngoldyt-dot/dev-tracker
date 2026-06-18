/**
 * github.service.js
 * Agent 1 + Agent 2 + Agent 3 — Core GitHub business logic.
 *
 * Responsibilities:
 *  - Exchange OAuth code for access_token (Agent 1)
 *  - Link GitHub account to existing DevTracker user (Agent 1)
 *  - Activate the 30-day Pro trial on first link (Agent 2)
 *  - Fetch & cache repos from GitHub API (Agent 3)
 *  - Select repos + persist to linkedRepos (Agent 3)
 *  - Compute trial status for the UI banner (Agent 2)
 */
const axios = require("axios");
const ApiError = require("../../../utils/apiErrors");
const { encryptToken, decryptToken } = require("../../../utils/crypto.helper");
const { startProTrial, getTrialStatus } = require("../../../utils/trial.helper");
const {
  findByEmail,
  updateGithubData,
  setLinkedRepos,
  getGithubSlice,
} = require("../repositories/github.repository");
const Developer = require("../../auth/schemas/developer.schema");
const Project = require("../../auth/schemas/project.schema");

// ─── In-memory cache for repo lists ──────────────────────────────────────────
// Lightweight Map cache: key = developerId, value = { data, expiresAt }
// TTL: 5 minutes — good balance between freshness and API rate limits.
const repoCache = new Map();
const REPO_CACHE_TTL_MS = 5 * 60 * 1000;

// ─── Agent 1: OAuth Token Exchange ───────────────────────────────────────────

/**
 * Exchanges a GitHub OAuth `code` for an access_token.
 * @param {string} code  - Short-lived code from GitHub redirect
 * @returns {Promise<string>} Raw GitHub access token
 */
const exchangeCodeForToken = async (code) => {
  const response = await axios.post(
    "https://github.com/login/oauth/access_token",
    {
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    },
    { headers: { Accept: "application/json" } }
  );

  const accessToken = response.data.access_token;
  if (!accessToken) {
    throw new ApiError(401, "GitHub code exchange failed — invalid or expired code.");
  }
  return accessToken;
};

/**
 * Fetches the authenticated GitHub user's profile.
 * @param {string} accessToken
 * @returns {Promise<object>} GitHub user object { id, login, name, email, avatar_url }
 */
const fetchGithubProfile = async (accessToken) => {
  const { data } = await axios.get("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "DevTracker-API",
    },
  });
  return data;
};

// ─── Agent 1 + Agent 2: Link GitHub Account + Start Trial ────────────────────

/**
 * Links a GitHub account to an existing DevTracker user.
 * Activates the 30-day Pro trial on first-time linkage (idempotent).
 *
 * @param {string} developerId  - The authenticated DevTracker user's _id
 * @param {string} code         - GitHub OAuth code
 * @returns {Promise<{ trialStarted: boolean, proTrialEndDate: Date }>}
 */
const linkGithubAccount = async (developerId, code) => {
  // Step 1 — Exchange code for token
  const rawToken = await exchangeCodeForToken(code);

  // Step 2 — Fetch GitHub profile
  const ghProfile = await fetchGithubProfile(rawToken);
  const { id: githubId, login: githubLogin } = ghProfile;

  // Step 3 removed: Allow multiple DevTracker accounts to link to the same GitHub account.

  // Step 4 — Load the current developer document
  const developer = await Developer.findById(developerId);
  if (!developer) throw new ApiError(404, "Developer not found.");

  // Step 5 — Activate trial if this is the first GitHub link
  const trialStarted = startProTrial(developer); // Agent 2 helper — idempotent

  // Step 6 — Encrypt the token using the CryptoService before persisting
  const encryptedToken = encryptToken(rawToken);

  // Step 7 — Persist all GitHub data atomically
  developer.github = {
    ...developer.github.toObject(),
    githubId: String(githubId),
    githubToken: encryptedToken,
    githubLogin,
    isPro: developer.github.isPro || false,
    proTrialStartDate: developer.github.proTrialStartDate,
    proTrialEndDate: developer.github.proTrialEndDate,
  };

  await developer.save();

  return {
    trialStarted,
    proTrialEndDate: developer.github.proTrialEndDate,
    githubLogin,
  };
};

// ─── Agent 3: Repos — Fetch (with cache) ─────────────────────────────────────

/**
 * Lists the authenticated user's GitHub repositories.
 * Results are cached per-developer for REPO_CACHE_TTL_MS (5 min).
 *
 * @param {string} developerId  - DevTracker user _id
 * @returns {Promise<Array>} Array of simplified repo objects
 */
const listGithubRepos = async (developerId) => {
  // ── Cache hit ──────────────────────────────────────────────────────────────
  const cached = repoCache.get(developerId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // ── Retrieve + decrypt stored token ────────────────────────────────────────
  const slice = await getGithubSlice(developerId);
  if (!slice || !slice.github || !slice.github.githubToken) {
    throw new ApiError(400, "GitHub account not linked. Please link your GitHub first.");
  }

  const rawToken = decryptToken(slice.github.githubToken);
  if (!rawToken) {
    throw new ApiError(500, "Failed to decrypt GitHub token — token may be corrupted. Please re-link your account.");
  }

  // ── Call GitHub API — paginate up to 200 repos ────────────────────────────
  let repos = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data } = await axios.get("https://api.github.com/user/repos", {
      headers: {
        Authorization: `Bearer ${rawToken}`,
        "User-Agent": "DevTracker-API",
      },
      params: { per_page: perPage, page, sort: "updated", affiliation: "owner" },
    });

    repos = repos.concat(data);
    if (data.length < perPage) break; // last page
    page++;
    if (page > 2) break;             // cap at 200 repos for performance
  }

  // ── Shape response — only expose what the frontend needs ──────────────────
  const shaped = repos.map((r) => ({
    repoId: r.id,
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    htmlUrl: r.html_url,
    description: r.description,
    language: r.language,
    stars: r.stargazers_count,
    updatedAt: r.updated_at,
  }));

  // ── Populate cache ─────────────────────────────────────────────────────────
  repoCache.set(developerId, { data: shaped, expiresAt: Date.now() + REPO_CACHE_TTL_MS });

  return shaped;
};

// ─── Agent 2: Auto-Create Projects from Newly Linked Repos ──────────────────

/**
 * For each newly added GitHub repo, creates a Project document if one doesn't
 * already exist (deduplication by githubRepoId + owner).
 * Uses Promise.allSettled so a single failure never aborts the whole batch.
 *
 * @param {string} ownerId     - Developer's Mongo _id
 * @param {Array}  newRepos    - Only the repos that were just added (diff from existing)
 * @returns {Promise<{ created: number, skipped: number, failed: number }>}
 */
const createProjectsFromRepos = async (ownerId, newRepos) => {
  // Check free-tier limit BEFORE the batch — one DB query instead of per-repo
  const developer = await Developer.findById(ownerId).select('subscription').lean();
  if (!developer) throw new ApiError(404, "Developer not found.");

  const isPremium = developer.subscription?.isPremium === true;
  if (!isPremium) {
    const existingCount = await Project.countDocuments({ owner: ownerId });
    if (existingCount >= 3) {
      // Silently skip instead of throwing — avoids breaking the entire sync
      console.warn(`[createProjectsFromRepos] Free tier limit reached for ${ownerId}. Skipping auto-creation.`);
      return { created: 0, skipped: newRepos.length, failed: 0 };
    }
  }

  const results = await Promise.allSettled(
    newRepos.map(async (repo) => {
      // Guard: skip if project with this githubRepoId already exists for this owner
      const existing = await Project.findOne({
        githubRepoId: repo.repoId,
        owner: ownerId,
      });
      if (existing) return { status: 'skipped', repoId: repo.repoId };

      return await Project.create({
        name: repo.name,
        description: repo.description || `Imported from GitHub: ${repo.fullName}`,
        owner: ownerId,
        githubRepoId: repo.repoId,
        isGithubImport: true,
        // clientName/hourlyRate left as schema defaults (null / 0)
      });
    })
  );

  let created = 0, skipped = 0, failed = 0;
  results.forEach((r) => {
    if (r.status === 'fulfilled') {
      if (r.value?.status === 'skipped') skipped++;
      else created++;
    } else {
      failed++;
      // Duplicate key error (race condition) — treat as skipped, not an error
      if (r.reason?.code === 11000) skipped++;
      else console.error('[createProjectsFromRepos] Failed:', r.reason?.message);
    }
  });

  return { created, skipped, failed };
};

// ─── Agent 3: Select Repos ────────────────────────────────────────────────────

/**
 * Stores the user's selected repos in linkedRepos.
 * Replaces the entire linked-repos list — frontend sends the full desired set.
 *
 * @param {string} developerId
 * @param {Array<object>} repos  - Array of { repoId, name, fullName, private, htmlUrl, language }
 * @returns {Promise<Array>} Updated linkedRepos
 */
const selectRepos = async (developerId, repos) => {
  if (!Array.isArray(repos) || repos.length === 0) {
    throw new ApiError(400, "repos must be a non-empty array.");
  }

  // Validate required fields on each repo entry
  const validated = repos.map((r) => {
    if (!r.repoId || !r.name || !r.fullName) {
      throw new ApiError(
        400,
        `Each repo must include repoId, name, and fullName. Invalid entry: ${JSON.stringify(r)}`
      );
    }
    return {
      repoId: Number(r.repoId),
      name: String(r.name),
      fullName: String(r.fullName),
      private: Boolean(r.private),
      htmlUrl: r.htmlUrl || "",
      description: r.description || null,
      language: r.language || null,
    };
  });

  // ── Agent 1: State Comparison — find newly added repos ───────────────────────
  // Read the current linkedRepos before overwriting, so we can diff
  const currentSlice = await getGithubSlice(developerId);
  const existingRepoIds = new Set(
    (currentSlice?.github?.linkedRepos || []).map((r) => Number(r.repoId))
  );
  const newRepos = validated.filter((r) => !existingRepoIds.has(r.repoId));

  // ── Persist the full new repo list ───────────────────────────────────────────
  const updated = await setLinkedRepos(developerId, validated);
  if (!updated) throw new ApiError(404, "Developer not found.");

  // ── Agent 2: Auto-create projects for newly added repos ──────────────────────
  let projectSummary = { created: 0, skipped: 0, failed: 0 };
  if (newRepos.length > 0) {
    projectSummary = await createProjectsFromRepos(developerId, newRepos);
  }

  return {
    linkedRepos: updated.github.linkedRepos,
    projectSummary,
    newReposCount: newRepos.length,
  };
};

// ─── Agent 2: Trial Status ────────────────────────────────────────────────────

/**
 * Returns trial status for the UI banner.
 * @param {string} developerId
 * @returns {Promise<{ isPro, active, daysRemaining, endsAt, githubLogin }>}
 */
const fetchTrialStatus = async (developerId) => {
  const slice = await getGithubSlice(developerId);
  if (!slice || !slice.github) {
    return { isPro: false, active: false, daysRemaining: 0, endsAt: null, githubLinked: false };
  }

  const { proTrialEndDate, githubId, githubLogin, linkedRepos } = slice.github;
  const { active, daysRemaining, endsAt } = getTrialStatus(proTrialEndDate);

  // isPro is true if the user has a paid subscription OR an active trial
  const isPremium = slice.subscription?.isPremium === true;

  // For paid premium users the trial window may have expired (daysRemaining = 0),
  // but we must NOT show "0 days left" — derive days from the subscription end date instead.
  let displayDaysRemaining = daysRemaining;
  let displayEndsAt = endsAt;

  if (isPremium) {
    // Schema field is 'currentPeriodEnd', fallback to 'trialEndsAt'
    const rawEnd = slice.subscription?.currentPeriodEnd
      || slice.subscription?.trialEndsAt
      || null;
    const subEnd = rawEnd ? new Date(rawEnd) : null;

    if (subEnd && subEnd > new Date()) {
      const msLeft = subEnd - new Date();
      displayDaysRemaining = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
      displayEndsAt = subEnd;
    } else {
      // Subscription has no end date or is perpetual — treat as unlimited
      displayDaysRemaining = null;   // null = unlimited, handled in the UI
      displayEndsAt = null;
    }
  }

  return {
    isPro: isPremium || active,          // true for both paid users and active trials
    isPremium,                            // true ONLY for paid subscribers
    githubLinked: !!githubId,
    githubLogin: githubLogin || null,
    active: isPremium || active,         // premium users are always "active"
    daysRemaining: displayDaysRemaining,
    endsAt: displayEndsAt,
    linkedRepos: linkedRepos || [],
  };
};

/**
 * Fetches recent activity from GitHub for the developer's linked repositories.
 */
const fetchDeveloperActivity = async (developerId) => {
  const slice = await getGithubSlice(developerId);
  if (!slice || !slice.github || !slice.github.githubToken) {
    return []; // No linked github
  }

  const { githubToken, githubLogin, linkedRepos } = slice.github;
  if (!githubLogin || !linkedRepos || linkedRepos.length === 0) return [];

  const rawToken = decryptToken(githubToken);
  if (!rawToken) return [];

  try {
    const { data } = await axios.get(`https://api.github.com/users/${githubLogin}/events/public`, {
      headers: {
        Authorization: `Bearer ${rawToken}`,
        "User-Agent": "DevTracker-API",
      },
      params: { per_page: 50 },
    });

    const linkedRepoNames = new Set(linkedRepos.map(r => r.fullName));

    // Filter and format the events
    return data
      .filter(event =>
        (event.type === 'PushEvent' || event.type === 'PullRequestEvent' || event.type === 'IssuesEvent') &&
        linkedRepoNames.has(event.repo?.name)
      )
      .slice(0, 15) // top 15 events
      .map(event => {
        let type = 'push';
        let message = 'Committed code';

        if (event.type === 'PushEvent') {
          type = 'push';
          message = event.payload.commits && event.payload.commits.length > 0
            ? event.payload.commits[0].message.split('\n')[0]
            : 'Pushed commits';
        } else if (event.type === 'PullRequestEvent') {
          type = 'pull_request';
          const action = event.payload.action;
          message = `${action.charAt(0).toUpperCase() + action.slice(1)} PR: ${event.payload.pull_request?.title || ''}`;
        } else if (event.type === 'IssuesEvent') {
          type = 'issues';
          const action = event.payload.action;
          message = `${action.charAt(0).toUpperCase() + action.slice(1)} issue: ${event.payload.issue?.title || ''}`;
        }

        return {
          type,
          repoFullName: event.repo.name,
          message,
          createdAt: event.created_at,
        };
      });
  } catch (error) {
    console.error("[fetchDeveloperActivity] Error fetching GitHub events:", error.message);
    return [];
  }
};

module.exports = {
  linkGithubAccount,
  listGithubRepos,
  selectRepos,
  createProjectsFromRepos,
  fetchTrialStatus,
  exchangeCodeForToken, // exported for OAuth redirect flow
  fetchGithubProfile,
  fetchDeveloperActivity,
};
