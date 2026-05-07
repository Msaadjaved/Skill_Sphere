// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const { getMongo } = require("../db/mongo");
const { sessions, leaderboard } = require("../db/redis");
const { runNeo4j } = require("../db/neo4j");

const router = express.Router();

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const { username, email, password, skills = [] } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: "username, email and password are required" });
    }

    const db = getMongo();
    const existing = await db.collection("users").findOne({ email });
    if (existing) return res.status(409).json({ error: "Email already registered" });

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    const user = {
      _id: userId,
      username,
      email,
      passwordHash,
      skills,
      createdAt: new Date(),
      enrolledCourses: [],
    };

    await db.collection("users").insertOne(user);

    // Create user node + skill nodes in Neo4j
    await runNeo4j(
      `MERGE (u:User {id: $id})
       SET u.username = $username, u.email = $email, u.createdAt = datetime()`,
      { id: userId, username, email }
    );

    for (const skill of skills) {
      await runNeo4j(
        `MERGE (s:Skill {name: $skill})
         WITH s
         MATCH (u:User {id: $userId})
         MERGE (u)-[:HAS_SKILL]->(s)`,
        { skill, userId }
      );
    }

    // Initialize leaderboard entry
    await leaderboard.addScore(userId, username, 0);

    const sessionId = uuidv4();
    await sessions.set(sessionId, { id: userId, username, email });

    res.status(201).json({ sessionId, user: { id: userId, username, email, skills } });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const db = getMongo();

    const user = await db.collection("users").findOne({ email });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    const sessionId = uuidv4();
    await sessions.set(sessionId, {
      id: user._id,
      username: user.username,
      email: user.email,
    });

    res.json({
      sessionId,
      user: { id: user._id, username: user.username, email: user.email, skills: user.skills },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/logout
router.post("/logout", async (req, res) => {
  const sessionId = req.headers["x-session-id"];
  if (sessionId) await sessions.del(sessionId);
  res.json({ message: "Logged out" });
});

module.exports = router;
