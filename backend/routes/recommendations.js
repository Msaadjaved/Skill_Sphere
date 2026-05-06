// routes/recommendations.js – Neo4j graph traversal queries
const express = require("express");
const { runNeo4j } = require("../db/neo4j");
const { getMongo } = require("../db/mongo");
const { withCache } = require("../db/redis");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/**
 * GET /api/recommendations/friends
 *
 * PATH TRAVERSAL QUERY #1 – Friend Recommendations via Mutual Follows
 * Finds users that your followed users also follow (2-hop traversal).
 * Returns users you don't already follow, ranked by how many mutual
 * connections you share.
 *
 * Graph pattern:  (me)-[:FOLLOWS]->(mutual)-[:FOLLOWS]->(recommended)
 */
router.get("/friends", requireAuth, async (req, res) => {
  try {
    const records = await runNeo4j(
      `MATCH (me:User {id: $userId})-[:FOLLOWS]->(mutual:User)-[:FOLLOWS]->(recommended:User)
       WHERE recommended.id <> $userId
         AND NOT (me)-[:FOLLOWS]->(recommended)
       WITH recommended, count(mutual) AS mutualCount
       ORDER BY mutualCount DESC
       LIMIT 10
       RETURN recommended.id AS id,
              recommended.username AS username,
              mutualCount`,
      { userId: req.user.id }
    );

    const friends = records.map((r) => ({
      id: r.get("id"),
      username: r.get("username"),
      mutualConnections: r.get("mutualCount").toNumber(),
    }));

    res.json({ recommendations: friends });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/recommendations/courses
 *
 * ─── Course Recommendations via Peer Skills ───
 * PATH TRAVERSAL QUERY #2 – Course Recommendations via Shared Skills
 * Finds courses that teach skills your followed users have,
 * but you haven't enrolled in yet.
 *
 * Graph pattern:
 *  (me)-[:FOLLOWS]->(peer)-[:HAS_SKILL]->(skill)<-[:TEACHES]-(course)
 *  WHERE me is NOT ENROLLED_IN course
 */
router.get("/courses", requireAuth, async (req, res) => {
  try {
    const records = await runNeo4j(
      `MATCH (me:User {id: $userId})-[:FOLLOWS]->(peer:User)-[:HAS_SKILL]->(skill:Skill)
       MATCH (course:Course)-[:TEACHES]->(skill)
       WHERE NOT (me)-[:ENROLLED_IN]->(course)
       WITH course, skill, count(peer) AS peerCount
       ORDER BY peerCount DESC
       LIMIT 10
       RETURN course.id AS id,
              course.title AS title,
              course.difficulty AS difficulty,
              collect(DISTINCT skill.name) AS relatedSkills,
              peerCount`,
      { userId: req.user.id }
    );

    const courses = records.map((r) => ({
      id: r.get("id"),
      title: r.get("title"),
      difficulty: r.get("difficulty"),
      relatedSkills: r.get("relatedSkills"),
      endorsedByPeers: r.get("peerCount").toNumber(),
    }));

    res.json({ recommendations: courses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/recommendations/skills
 *
 * ─── Skill Gap Analysis ───
 * PATH TRAVERSAL QUERY #3 – Skill Gap Recommendations
 * Finds skills that users similar to you (who share at least one skill)
 * have, but you don't yet.
 *
 * Graph pattern:
 *  (me)-[:HAS_SKILL]->(shared)<-[:HAS_SKILL]-(similar)-[:HAS_SKILL]->(missing)
 *  WHERE me does NOT have (missing)
 */
router.get("/skills", requireAuth, async (req, res) => {
  try {
    const records = await runNeo4j(
      `MATCH (me:User {id: $userId})-[:HAS_SKILL]->(shared:Skill)<-[:HAS_SKILL]-(similar:User)
       MATCH (similar)-[:HAS_SKILL]->(missing:Skill)
       WHERE NOT (me)-[:HAS_SKILL]->(missing)
         AND missing <> shared
       WITH missing, count(similar) AS frequency
       ORDER BY frequency DESC
       LIMIT 10
       RETURN missing.name AS skill, frequency`,
      { userId: req.user.id }
    );

    const skills = records.map((r) => ({
      skill: r.get("skill"),
      frequency: r.get("frequency").toNumber(),
    }));

    res.json({ recommendations: skills });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/recommendations/shortest-path/:targetId
 *
 * ─── Shortest Connection Path ───
 * PATH TRAVERSAL QUERY #4 – Shortest Connection Path
 * Returns the shortest FOLLOWS path between the current user and a target user.
 * Useful for "how do I know this person?".
 *
 * Uses Neo4j's built-in shortestPath algorithm.
 */
router.get("/shortest-path/:targetId", requireAuth, async (req, res) => {
  try {
    const records = await runNeo4j(
      `MATCH path = shortestPath(
         (start:User {id: $startId})-[:FOLLOWS*1..6]->(end:User {id: $endId})
       )
       RETURN [node IN nodes(path) | node.username] AS chain,
              length(path) AS hops`,
      { startId: req.user.id, endId: req.params.targetId }
    );

    if (records.length === 0) {
      return res.json({ connected: false, message: "No connection found within 6 hops" });
    }

    const r = records[0];
    res.json({
      connected: true,
      chain: r.get("chain"),
      hops: r.get("hops").toNumber(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
