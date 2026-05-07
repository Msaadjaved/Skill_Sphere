// routes/users.js
const express = require("express");
const { getMongo } = require("../db/mongo");
const { runNeo4j } = require("../db/neo4j");
const { requireAuth } = require("../middleware/auth");
const { withCache, leaderboard } = require("../db/redis");

const router = express.Router();

// ─── GET /api/users/me ─────────────────────────────────────────────────────
router.get("/me", requireAuth, async (req, res) => {
  try {
    const db = getMongo();
    const user = await db
      .collection("users")
      .findOne({ _id: req.user.id }, { projection: { passwordHash: 0 } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const enrollments = await db
      .collection("enrollments")
      .find({ userId: req.user.id })
      .toArray();

    const progress = await db
      .collection("progress")
      .find({ userId: req.user.id })
      .toArray();

    const rank = await leaderboard.getUserRank(req.user.id);

    res.json({ ...user, enrollments, progress, rank });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/users/follow/:targetId – Follow a user ─────────────────────
router.post("/follow/:targetId", requireAuth, async (req, res) => {
  try {
    const followerId = req.user.id;
    const { targetId } = req.params;

    if (followerId === targetId) {
      return res.status(400).json({ error: "Cannot follow yourself" });
    }

    // Neo4j: Create FOLLOWS relationship
    await runNeo4j(
      `MATCH (follower:User {id: $followerId}), (target:User {id: $targetId})
       MERGE (follower)-[:FOLLOWS]->(target)`,
      { followerId, targetId }
    );

    res.json({ message: "Now following user" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/users/follow/:targetId – Unfollow ───────────────────────
router.delete("/follow/:targetId", requireAuth, async (req, res) => {
  try {
    await runNeo4j(
      `MATCH (follower:User {id: $followerId})-[r:FOLLOWS]->(target:User {id: $targetId})
       DELETE r`,
      { followerId: req.user.id, targetId: req.params.targetId }
    );
    res.json({ message: "Unfollowed" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/users/:id – Public profile ──────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const db = getMongo();
    const user = await db
      .collection("users")
      .findOne({ _id: req.params.id }, { projection: { passwordHash: 0, email: 0 } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const rank = await leaderboard.getUserRank(req.params.id);
    res.json({ ...user, rank });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
