/**
 * contextSynthesizer.agent.js
 * ══════════════════════════════════════════════════════════════════
 * AGENT 2 — The Context Synthesizer
 *
 * Responsibility:
 *   Receives raw mined data from Agent 1, filters noise, and structures
 *   it into a clean, signal-rich "ProjectBrief" ready for the AI writer.
 *
 * Intelligence Logic:
 *   • Identifies "priority files" — config/infra files that are
 *     high-leverage for a newcomer (env files, CI configs, docker, etc.)
 *   • Detects "bottleneck patterns" — signs of technical debt or
 *     complexity a newcomer should be aware of immediately.
 *   • Curates the tech stack — groups deps into meaningful categories
 *     (Runtime, Framework, DB, DevOps, Testing) instead of a raw list.
 *   • Scores urgency of the first task based on deadline proximity.
 *
 * Input  → RawMinedData (from dataMiner.agent.js)
 * Output → ProjectBrief (fed directly into personaWriter.agent.js)
 * ══════════════════════════════════════════════════════════════════
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Files a newcomer must locate immediately — architectural anchors */
const PRIORITY_FILE_PATTERNS = [
  { pattern: /\.env(\.example)?$/, label: "Environment Config" },
  { pattern: /docker-compose\.ya?ml$/, label: "Docker Compose" },
  { pattern: /dockerfile$/i, label: "Dockerfile" },
  { pattern: /\.github\/workflows\/.+\.ya?ml$/, label: "CI/CD Pipeline" },
  { pattern: /src\/app\.js$|src\/server\.js$|index\.js$/, label: "App Entry Point" },
  { pattern: /package\.json$/, label: "Dependency Manifest" },
  { pattern: /README\.md$/i, label: "README" },
  { pattern: /prisma\/schema\.prisma$|schema\.graphql$/, label: "Data Schema" },
];

/** Known "bottleneck" package signatures — heavy or risk-prone dependencies */
const BOTTLENECK_PACKAGES = {
  "webpack": "Complex build pipeline — review webpack.config.js first",
  "babel": "Transpilation layer active — check .babelrc for quirks",
  "sequelize": "ORM in use — DB migrations require careful handling",
  "typeorm": "ORM in use — check ormconfig and entity decorators",
  "socket.io": "Real-time WebSocket layer present — event namespacing matters",
  "bullmq": "Background job queue active — workers run separately",
  "redis": "Redis dependency — ensure local instance is running",
  "puppeteer": "Headless browser present — memory-heavy in CI",
  "passport": "Multi-strategy auth layer — review strategy configs",
  "graphql": "GraphQL API — review schema and resolvers before diving in",
  "grpc": "gRPC service mesh — protobuf compilation step required",
  "kafkajs": "Kafka message broker — consumer groups need coordination",
};

/** Tech stack categorization map */
const STACK_CATEGORIES = {
  Runtime:   ["node", "bun", "deno", "ts-node", "tsx"],
  Framework: ["express", "fastify", "nest", "@nestjs/core", "koa", "hapi", "next", "nuxt", "remix", "sveltekit"],
  Database:  ["mongoose", "mongodb", "sequelize", "typeorm", "prisma", "pg", "mysql2", "knex", "redis", "ioredis"],
  Auth:      ["jsonwebtoken", "bcrypt", "bcryptjs", "passport", "passport-jwt", "passport-local"],
  DevOps:    ["docker", "dotenv", "cross-env", "pm2", "nodemon", "ts-node-dev"],
  Testing:   ["jest", "mocha", "chai", "supertest", "vitest", "cypress", "@testing-library"],
  Realtime:  ["socket.io", "ws", "ably", "pusher"],
  Queue:     ["bullmq", "bull", "kafkajs", "amqplib"],
  Cloud:     ["aws-sdk", "@aws-sdk", "firebase-admin", "googleapis", "@google-cloud"],
  AI:        ["@google/generative-ai", "openai", "langchain", "anthropic"],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Categorizes a flat tech stack array into labeled groups.
 * Packages not matching any category land in "Other".
 *
 * @param {string[]} techStack
 * @returns {Object.<string, string[]>} e.g. { Framework: ['express'], DB: ['mongoose'] }
 */
const _categorizeTechStack = (techStack) => {
  const categorized = {};
  const matched = new Set();

  Object.entries(STACK_CATEGORIES).forEach(([category, keywords]) => {
    const found = techStack.filter((pkg) =>
      keywords.some((kw) => pkg === kw || pkg.startsWith(kw))
    );
    if (found.length > 0) {
      categorized[category] = found;
      found.forEach((p) => matched.add(p));
    }
  });

  const other = techStack.filter((p) => !matched.has(p));
  if (other.length > 0) categorized["Other"] = other.slice(0, 10); // cap noise

  return categorized;
};

/**
 * Detects bottleneck packages in the tech stack.
 *
 * @param {string[]} techStack
 * @returns {Array<{ package: string, warning: string }>}
 */
const _detectBottlenecks = (techStack) => {
  return Object.entries(BOTTLENECK_PACKAGES)
    .filter(([pkg]) => techStack.includes(pkg))
    .map(([pkg, warning]) => ({ package: pkg, warning }));
};

/**
 * Determines priority files a newcomer should look at first.
 * Currently operates on repo names as placeholders for actual file trees
 * (a real tree crawl requires GitHub Trees API — out of scope for this agent).
 *
 * @param {Object[]} activeRepos
 * @param {string[]} techStack
 * @returns {Array<{ filename: string, reason: string }>}
 */
const _identifyPriorityFiles = (activeRepos, techStack) => {
  const priorities = [];

  // Always recommend these regardless of stack
  priorities.push({ filename: ".env / .env.example", reason: "Environment variables — required for local setup" });
  priorities.push({ filename: "README.md", reason: "Project overview and setup instructions" });
  priorities.push({ filename: "package.json", reason: "Dependency manifest and npm scripts" });

  // Stack-conditional recommendations
  if (techStack.includes("mongoose") || techStack.includes("mongodb")) {
    priorities.push({ filename: "src/models/ or schemas/", reason: "MongoDB schemas define the entire data model" });
  }
  if (techStack.includes("prisma")) {
    priorities.push({ filename: "prisma/schema.prisma", reason: "Prisma schema — source of truth for DB structure" });
  }
  if (techStack.some((p) => p.startsWith("@nestjs"))) {
    priorities.push({ filename: "src/app.module.ts", reason: "NestJS root module — maps the entire dependency graph" });
  }
  if (techStack.includes("bullmq") || techStack.includes("bull")) {
    priorities.push({ filename: "src/queues/ or workers/", reason: "Job queue workers run as separate processes" });
  }
  if (techStack.includes("socket.io")) {
    priorities.push({ filename: "src/gateways/ or sockets/", reason: "WebSocket event handlers — real-time logic lives here" });
  }

  return priorities;
};

/**
 * Evaluates the urgency of the newcomer's first task.
 *
 * @param {Object|null} firstTask
 * @returns {{ label: string, daysUntilDeadline: number|null, isUrgent: boolean }}
 */
const _assessTaskUrgency = (firstTask) => {
  if (!firstTask) return { label: "No task assigned yet", daysUntilDeadline: null, isUrgent: false };

  if (!firstTask.deadline) {
    return { label: "No deadline set", daysUntilDeadline: null, isUrgent: false };
  }

  const now = new Date();
  const deadline = new Date(firstTask.deadline);
  const msRemaining = deadline - now;
  const daysUntilDeadline = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));

  if (daysUntilDeadline <= 0) {
    return { label: "OVERDUE", daysUntilDeadline, isUrgent: true };
  } else if (daysUntilDeadline <= 3) {
    return { label: "CRITICAL — due in <3 days", daysUntilDeadline, isUrgent: true };
  } else if (daysUntilDeadline <= 7) {
    return { label: "HIGH — due this week", daysUntilDeadline, isUrgent: false };
  } else {
    return { label: "NORMAL", daysUntilDeadline, isUrgent: false };
  }
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ProjectBrief
 * @property {Object}   developer        — newcomer identity
 * @property {Object}   project          — project metadata
 * @property {Object}   techStackMap     — categorized tech stack
 * @property {string[]} techStackFlat    — raw flat list (for Gemini context)
 * @property {Object[]} readmeSummaries  — per-repo summaries
 * @property {Object[]} activeRepos      — active GitHub repos
 * @property {Object[]} bottlenecks      — detected risk packages + warnings
 * @property {Object[]} priorityFiles    — files newcomer should open first
 * @property {Object}   firstTask        — first assigned task with urgency
 * @property {Object}   dataSourceFlags  — { githubAvailable: bool, githubError: string|null }
 */

/**
 * Entry point for Agent 2.
 * Synthesizes raw mined data into a structured, signal-rich Project Brief.
 *
 * @param {import('./dataMiner.agent').RawMinedData} rawData
 * @returns {ProjectBrief}
 */
const runContextSynthesizer = (rawData) => {
  const {
    project,
    firstTask,
    newMember,
    techStack = [],
    readmeSummaries = [],
    activeRepos = [],
    githubSuccess,
    githubError,
  } = rawData;

  // ── 1. Categorize the tech stack ──────────────────────────────────────────
  const techStackMap = _categorizeTechStack(techStack);

  // ── 2. Detect bottlenecks ──────────────────────────────────────────────────
  const bottlenecks = _detectBottlenecks(techStack);

  // ── 3. Identify priority files ─────────────────────────────────────────────
  const priorityFiles = _identifyPriorityFiles(activeRepos, techStack);

  // ── 4. Assess first task urgency ───────────────────────────────────────────
  const taskUrgency = _assessTaskUrgency(firstTask);

  // ── 5. Curate README summaries — drop empty/placeholder ones ──────────────
  const curatedReadmes = readmeSummaries.filter(
    (r) => r.summary && r.summary !== "No README available." && r.summary !== "No summary extractable."
  );

  // ── 6. Build the structured brief ──────────────────────────────────────────
  /** @type {ProjectBrief} */
  const brief = {
    developer: {
      id: newMember?.id || "unknown",
      name: newMember?.name || "Developer",
      email: newMember?.email || null,
      githubLogin: newMember?.githubLogin || null,
    },
    project: {
      id: project?.id || "unknown",
      name: project?.name || "Unnamed Project",
      description: project?.description || "No description provided.",
      clientName: project?.clientName || null,
      status: project?.status || "active",
    },
    techStackMap,
    techStackFlat: techStack.slice(0, 50), // cap at 50 for Gemini token budget
    readmeSummaries: curatedReadmes,
    activeRepos,
    bottlenecks,
    priorityFiles,
    firstTask: firstTask
      ? {
          title: firstTask.title,
          estimatedHours: firstTask.estimatedHours,
          deadline: firstTask.deadline,
          status: firstTask.status,
          urgency: taskUrgency,
        }
      : null,
    dataSourceFlags: {
      githubAvailable: githubSuccess,
      githubError: githubError || null,
    },
  };

  // ── Dev-mode logging ───────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[ContextSynthesizer] ✅ Brief built — Stack categories: ${Object.keys(techStackMap).join(", ")} | Bottlenecks: ${bottlenecks.length} | GitHub: ${githubSuccess ? "✓" : "✗ degraded"}`
    );
  }

  return brief;
};

module.exports = { runContextSynthesizer };
