/**
 * server.js — Graceful Shutdown Handler
 *
 * Intercepts OS termination signals (SIGTERM from Railway on deploys/scaling,
 * SIGINT from Ctrl+C in local dev) and shuts down cleanly:
 *
 *  1. Stop accepting new HTTP connections (server.close)
 *  2. Close BullMQ queues (stops job scheduling)
 *  3. Disconnect from MongoDB (flushes pending writes)
 *  4. Exit with code 0 (success) or 1 (timeout)
 *
 * WHY THIS MATTERS:
 *  Without this, Railway's SIGTERM causes an immediate Node.js crash mid-request,
 *  which can corrupt in-flight MongoDB writes and lose BullMQ jobs silently.
 */
const mongoose = require("mongoose");
const { server, autoCompleteQueue, taskSyncQueue } = require("./app");

// ── Graceful shutdown function ────────────────────────────────────────────────
const shutdown = async (signal) => {
  console.log(`\n[${signal}] Graceful shutdown initiated...`);

  // Force-kill if cleanup takes longer than 10 seconds (prevents hanging deploys)
  const forceExit = setTimeout(() => {
    console.error("[SHUTDOWN] Forced exit after 10s timeout.");
    process.exit(1);
  }, 10_000);

  try {
    // 1. Stop accepting new HTTP requests (existing ones finish naturally)
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    console.log("  ✅ HTTP server closed");

    // 2. Close BullMQ queues gracefully (no new jobs accepted)
    await autoCompleteQueue.close();
    await taskSyncQueue.close();
    console.log("  ✅ BullMQ queues closed");

    // 3. Close Mongoose connection (flushes pending write buffer)
    await mongoose.connection.close();
    console.log("  ✅ MongoDB connection closed");

    clearTimeout(forceExit);
    console.log("[SHUTDOWN] Clean exit. Goodbye.");
    process.exit(0);

  } catch (err) {
    console.error("[SHUTDOWN] Error during shutdown:", err.message);
    clearTimeout(forceExit);
    process.exit(1);
  }
};

// ── Signal handlers ───────────────────────────────────────────────────────────
process.on("SIGTERM", () => shutdown("SIGTERM")); // Railway deploy / scale-down
process.on("SIGINT",  () => shutdown("SIGINT"));  // Ctrl+C in local dev

// ── Unhandled rejection safety net ───────────────────────────────────────────
// Catches unhandled promise rejections that would otherwise silently corrupt state
process.on("unhandledRejection", (reason) => {
  console.error(
    JSON.stringify({
      level: "error",
      event: "unhandledRejection",
      timestamp: new Date().toISOString(),
      reason: reason?.message || String(reason),
      stack: reason?.stack,
    })
  );
  // Do NOT exit — let the error middleware handle it if possible.
  // Only exit if the app is truly unrecoverable (you can add a threshold here).
});

process.on("uncaughtException", (err) => {
  console.error(
    JSON.stringify({
      level: "error",
      event: "uncaughtException",
      timestamp: new Date().toISOString(),
      error: err.message,
      stack: err.stack,
    })
  );
  // uncaughtException leaves the app in an undefined state — must exit.
  shutdown("uncaughtException");
});
