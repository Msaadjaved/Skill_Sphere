// routes/courses.js
const express = require("express");
const { ObjectId } = require("mongodb");
const { getMongo } = require("../db/mongo");
const { withCache, getRedis } = require("../db/redis");
const { runNeo4j } = require("../db/neo4j");
const { getEmbedding } = require("../services/embeddings");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// ─── GET /api/courses – List all courses (cached) ─────────────────────────
router.get("/", async (req, res) => {
  try {
    const courses = await withCache(
      "courses:all",
      async () => {
        const db = getMongo();
        return db
          .collection("courses")
          .find({}, { projection: { descriptionVector: 0 } })
          .sort({ enrollmentCount: -1 })
          .toArray();
      },
      120 // 2-min cache
    );
    res.json(courses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/courses/search?q= – Vector Search with fallback ─────────────
router.get("/search", async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: "Query parameter 'q' required" });

    const db = getMongo();

    // 1. Try HF vector search first
    try {
      const queryVector = await getEmbedding(q);

      const pipeline = [
        {
          $vectorSearch: {
            index: "vector_index",
            path: "descriptionVector",
            queryVector: queryVector,
            numCandidates: 50,
            limit: 10,
          },
        },
        {
          $project: {
            descriptionVector: 0,
            score: { $meta: "vectorSearchScore" },
          },
        },
      ];

      const results = await db.collection("courses").aggregate(pipeline).toArray();
      return res.json({ query: q, results, method: "vector" });

    } catch (embeddingErr) {
      // 2. Fallback – keyword search if HF is unavailable
      console.error("EMBEDDING ERROR:", embeddingErr.message);
  
      const results = await db.collection("courses").find(
        { $or: [
          { title: { $regex: q, $options: "i" } },
          { description: { $regex: q, $options: "i" } },
          { tags: { $regex: q, $options: "i" } },
        ]},
        { projection: { descriptionVector: 0 } }
      ).limit(10).toArray();

      return res.json({ query: q, results, method: "keyword_fallback" });
    }

  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/courses/:id – Single course ─────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const db = getMongo();
    const course = await db
      .collection("courses")
      .findOne({ _id: req.params.id }, { projection: { descriptionVector: 0 } });
    if (!course) return res.status(404).json({ error: "Course not found" });
    res.json(course);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/courses – Create course (with embedding) ───────────────────
router.post("/", requireAuth, async (req, res) => {
  try {
    const { title, description, tags = [], difficulty, duration } = req.body;
    if (!title || !description) {
      return res.status(400).json({ error: "title and description required" });
    }

    const { v4: uuidv4 } = require("uuid");
    const courseId = uuidv4();

    // Generate embedding from description
    const descriptionVector = await getEmbedding(description);

    const course = {
      _id: courseId,
      title,
      description,
      tags,
      difficulty: difficulty || "beginner",
      duration: duration || 60,
      enrollmentCount: 0,
      rating: 0,
      createdBy: req.user.id,
      createdAt: new Date(),
      descriptionVector,  // 384-dim vector stored in MongoDB (sentence-transformers/all-MiniLM-L6-v2)
    };

    const db = getMongo();
    await db.collection("courses").insertOne(course);

    // Invalidate course list cache
    await getRedis().del("courses:all");

    // Create Course node in Neo4j
    await runNeo4j(
      `MERGE (c:Course {id: $id})
       SET c.title = $title, c.difficulty = $difficulty
       WITH c
       UNWIND $tags AS tag
       MERGE (s:Skill {name: tag})
       MERGE (c)-[:TEACHES]->(s)`,
      { id: courseId, title, difficulty: difficulty || "beginner", tags }
    );

    res.status(201).json({ ...course, descriptionVector: undefined });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/courses/:id/enroll ─────────────────────────────────────────
router.post("/:id/enroll", requireAuth, async (req, res) => {
  try {
    const { id: courseId } = req.params;
    const { id: userId, username } = req.user;

    const db = getMongo();
    const course = await db.collection("courses").findOne({ _id: courseId });
    if (!course) return res.status(404).json({ error: "Course not found" });

    const existing = await db
      .collection("enrollments")
      .findOne({ userId, courseId });
    if (existing) return res.status(409).json({ error: "Already enrolled" });

    const { v4: uuidv4 } = require("uuid");
    await db.collection("enrollments").insertOne({
      _id: uuidv4(),
      userId,
      courseId,
      enrolledAt: new Date(),
      completedAt: null,
    });

    // Create progress doc
    await db.collection("progress").updateOne(
      { userId, courseId },
      { $setOnInsert: { userId, courseId, percentage: 0, completedLessons: [], updatedAt: new Date() } },
      { upsert: true }
    );

    // Increment enrollment count
    await db
      .collection("courses")
      .updateOne({ _id: courseId }, { $inc: { enrollmentCount: 1 } });

    // Invalidate Redis cache on enrollment
    await getRedis().del("courses:all");

    // Neo4j: User ENROLLED_IN Course
    await runNeo4j(
      `MATCH (u:User {id: $userId}), (c:Course {id: $courseId})
       MERGE (u)-[:ENROLLED_IN]->(c)`,
      { userId, courseId }
    );

    res.json({ message: "Enrolled successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/courses/:id/progress ──────────────────────────────────────
router.patch("/:id/progress", requireAuth, async (req, res) => {
  try {
    const { id: courseId } = req.params;
    const { id: userId, username } = req.user;
    const { percentage } = req.body;

    if (typeof percentage !== "number" || percentage < 0 || percentage > 100) {
      return res.status(400).json({ error: "percentage must be 0–100" });
    }

    const db = getMongo();
    await db.collection("progress").updateOne(
      { userId, courseId },
      { $set: { percentage, updatedAt: new Date() } },
      { upsert: true }
    );

    // Award points on the leaderboard
    const { leaderboard } = require("../db/redis");
    const points = Math.floor(percentage / 10); // 10 pts per 10% completed
    await leaderboard.incrementScore(userId, username, points);

    if (percentage === 100) {
      await db.collection("enrollments").updateOne(
        { userId, courseId },
        { $set: { completedAt: new Date() } }
      );
      // Extra points for completion
      await leaderboard.incrementScore(userId, username, 50);
    }

    res.json({ message: "Progress updated", percentage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
