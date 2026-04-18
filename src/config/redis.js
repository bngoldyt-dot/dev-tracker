const Redis = require("ioredis");

const port = process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379;
const host = process.env.REDIS_HOST || "127.0.0.1";
const password = process.env.REDIS_PASSWORD || undefined;

const options = {
  host,
  port,
  password,
  maxRetriesPerRequest: null,
  reconnectOnError(err) {
    if (err.message.includes('limit exceeded')) {
      console.error("🛑 Upstash limit exceeded detected. Banning further connection attempts.");
      return 2; // Magic value in ioredis to completely abort connection
    }
  },
  retryStrategy(times) {
    if (times > 3) return null;
    return Math.min(times * 1000, 3000);
  }
};

// Enable TLS if using Upstash or external secured service
if (host.includes("upstash.io") || process.env.REDIS_TLS === 'true') {
  options.tls = {};
}

const redis = new Redis(options);

redis.on("connect", () => {
  console.log("✅ Redis connected");
});

redis.on("error", (err) => {
  console.error("❌ Redis error:", err.message);
});

module.exports = redis;