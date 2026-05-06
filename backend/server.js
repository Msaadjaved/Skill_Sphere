// server.js – SkillSphere API Entry Point
require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { connectMongo } = require("./db/mongo");
const { connectNeo4j } = require("./db/neo4j");
const { connectRedis } = require("./db/redis");

const authRoutes = require("./routes/auth");
const coursesRoutes = require("./routes/courses");
const usersRoutes = require("./routes/users");
const recommendationsRoutes = require("./routes/recommendations");
const dashboardRoutes = require("./routes/dashboard");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Routes ──────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/courses", coursesRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/recommendations", recommendationsRoutes);
app.use("/api/dashboard", dashboardRoutes);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Startup ─────────────────────────────────────────────────────────────
async function start() {
  try {
    await connectMongo();
    await connectNeo4j();
    await connectRedis();

    app.listen(PORT, () => {
      console.log(`\n🚀 SkillSphere API running!`);
      console.log(`   Frontend:     http://localhost:8080`);
      console.log(`   Backend API:  http://localhost:${PORT}`);
      console.log(`   Health check: http://localhost:${PORT}/health\n`);
    });
  } catch (err) {
    console.error("❌ Startup failed:", err);
    process.exit(1);
  }
}

start();
