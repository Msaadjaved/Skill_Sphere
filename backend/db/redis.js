// db/redis.js – Direct redis v4 driver (no ORM)
const { createClient } = require("redis");

let client;

async function connectRedis() {
  if (client?.isReady) return client;

  client = createClient({
    socket: {
      host: process.env.REDIS_HOST || "redis",
      port: parseInt(process.env.REDIS_PORT) || 6379,
      reconnectStrategy: (retries) => Math.min(retries * 50, 2000),
    },
  });

  client.on("error", (err) => console.error("Redis error:", err));
  client.on("reconnecting", () => console.log("Redis reconnecting..."));

  await client.connect();
  console.log("✅ Redis connected");
  return client;
}

function getRedis() {
  if (!client?.isReady) throw new Error("Redis not connected.");
  return client;
}

async function closeRedis() {
  if (client) await client.quit();
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Cache wrapper using Redis Strings with TTL.
 * Returns cached value if exists, otherwise calls fn() and caches the result.
 * Used for: course list, dashboard stats, aggregation results.
 */
async function withCache(key, fn, ttlSeconds = 300) {
  const r = getRedis();
  const cached = await r.get(key);
  if (cached) return JSON.parse(cached);

  const fresh = await fn();
  await r.set(key, JSON.stringify(fresh), { EX: ttlSeconds });
  return fresh;
}

/**
 * Session helpers using Redis Hashes.
 * Each session is stored as a Hash: session:{sessionId} → { id, username, email }
 * No JSON.stringify needed — each field is stored and retrieved directly.
 * TTL of 24 hours (86400 seconds) is set on the Hash key.
 */
const sessions = {
  async set(sessionId, userData, ttlSeconds = 86400) {
    const r = getRedis();
    // Store each user field as a separate Hash field — clean and readable
    await r.hSet(`session:${sessionId}`, {
      id: userData.id,
      username: userData.username,
      email: userData.email,
    });
    // Set expiry on the whole Hash key
    await r.expire(`session:${sessionId}`, ttlSeconds);
  },

  async get(sessionId) {
    const r = getRedis();
    // hGetAll returns all fields of the Hash as a plain object
    const data = await r.hGetAll(`session:${sessionId}`);
    // Returns null if session does not exist (empty object means no key)
    return Object.keys(data).length > 0 ? data : null;
  },

  async del(sessionId) {
    const r = getRedis();
    await r.del(`session:${sessionId}`);
  },
};

/**
 * Leaderboard helpers using Redis Sorted Sets + Hash for name mapping.
 *
 * Sorted Set "leaderboard:global":
 *   member = userId, score = points
 *   Allows O(log N) insert and O(log N + K) ranked range queries.
 *
 * Hash "leaderboard:names":
 *   field = userId, value = username
 *   Maps userId → username for display since Sorted Set only stores the member.
 *   No stringify needed — plain string key-value mapping.
 */
const leaderboard = {
  async addScore(userId, username, points) {
    const r = getRedis();
    // Add to Sorted Set with score
    await r.zAdd("leaderboard:global", [{ score: points, value: userId }]);
    // Map userId → username in Hash directly (no stringify)
    await r.hSet("leaderboard:names", userId, username);
  },

  async incrementScore(userId, username, delta = 10) {
    const r = getRedis();
    // Atomically increment the score in the Sorted Set
    const newScore = await r.zIncrBy("leaderboard:global", delta, userId);
    // Update name mapping in Hash
    await r.hSet("leaderboard:names", userId, username);
    return newScore;
  },

  async getTop(n = 10) {
    const r = getRedis();
    // Get top N members with scores, highest first (REV = true)
    const entries = await r.zRangeWithScores("leaderboard:global", 0, n - 1, {
      REV: true,
    });
    // Get all userId → username mappings from Hash in one call
    const names = await r.hGetAll("leaderboard:names");
    return entries.map((e, i) => ({
      rank: i + 1,
      userId: e.value,
      username: names[e.value] || "Unknown",
      points: e.score,
    }));
  },

  async getUserRank(userId) {
    const r = getRedis();
    // zRevRank returns 0-based rank from highest score (0 = 1st place)
    const rank = await r.zRevRank("leaderboard:global", userId);
    const score = await r.zScore("leaderboard:global", userId);
    return { rank: rank !== null ? rank + 1 : null, points: score || 0 };
  },
};

module.exports = {
  connectRedis,
  getRedis,
  closeRedis,
  withCache,
  leaderboard,
  sessions,
};
