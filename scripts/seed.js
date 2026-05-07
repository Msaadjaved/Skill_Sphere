#!/usr/bin/env node
// scripts/seed.js – Creates sample data in MongoDB, Neo4j, and Redis
// Usage: node scripts/seed.js
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { MongoClient } = require("mongodb");
const neo4j = require("neo4j-driver");
const { createClient } = require("redis");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcryptjs");

// ─── Config ───────────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || "skillsphere";
const NEO4J_URI = process.env.NEO4J_URI;
const NEO4J_USER = process.env.NEO4J_USER || "neo4j";
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD;
const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = parseInt(process.env.REDIS_PORT) || 6379;

async function getEmbedding(text) {
  const response = await fetch(
    "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: text }),
    }
  );
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("HF failed: " + JSON.stringify(data));
  return Array.isArray(data[0]) ? data[0] : data;
}

// ─── Sample Data ──────────────────────────────────────────────────────────
const SKILLS = [
  "JavaScript", "Python", "Machine Learning", "React", "Node.js",
  "SQL", "Docker", "Kubernetes", "Data Science", "GraphQL",
  "TypeScript", "MongoDB", "Redis", "Neo4j", "AWS",
];

const USERS_DATA = [
  { username: "alice_dev", email: "alice@example.com", skills: ["JavaScript", "React", "TypeScript"] },
  { username: "bob_ml", email: "bob@example.com", skills: ["Python", "Machine Learning", "Data Science"] },
  { username: "carol_dba", email: "carol@example.com", skills: ["MongoDB", "Redis", "Neo4j", "SQL"] },
  { username: "david_devops", email: "david@example.com", skills: ["Docker", "Kubernetes", "AWS"] },
  { username: "eva_full", email: "eva@example.com", skills: ["JavaScript", "Node.js", "Python", "Docker"] },
];

const COURSES_DATA = [
  {
    title: "React from Zero to Hero",
    description: "Master React.js from scratch. Learn hooks, state management, component patterns, and build real-world applications with React and TypeScript. Covers testing with Jest and deploying to production.",
    tags: ["React", "JavaScript", "TypeScript"],
    difficulty: "intermediate",
    duration: 120,
  },
  {
    title: "Machine Learning with Python",
    description: "Comprehensive introduction to machine learning using Python. Covers supervised and unsupervised learning, neural networks, scikit-learn, TensorFlow basics, and deploying ML models to production.",
    tags: ["Python", "Machine Learning", "Data Science"],
    difficulty: "advanced",
    duration: 180,
  },
  {
    title: "MongoDB: The Complete Guide",
    description: "Deep dive into MongoDB document database. Learn schema design, aggregation pipelines, indexing strategies, transactions, Atlas Vector Search, and building production-ready applications.",
    tags: ["MongoDB", "SQL"],
    difficulty: "beginner",
    duration: 90,
  },
  {
    title: "Docker and Kubernetes Mastery",
    description: "Learn containerization with Docker and orchestration with Kubernetes. Build, ship, and run applications at scale. Covers Docker Compose, Helm charts, CI/CD pipelines, and AWS EKS deployment.",
    tags: ["Docker", "Kubernetes", "AWS"],
    difficulty: "advanced",
    duration: 150,
  },
  {
    title: "Graph Databases with Neo4j",
    description: "Explore the power of graph databases using Neo4j. Learn Cypher query language, model complex relationships, build recommendation engines, and apply graph algorithms to real-world problems.",
    tags: ["Neo4j", "GraphQL"],
    difficulty: "intermediate",
    duration: 100,
  },
  {
    title: "Node.js Backend Development",
    description: "Build scalable REST APIs and microservices with Node.js and Express. Covers authentication with JWT, Redis caching, MongoDB integration, testing, and deploying to production servers.",
    tags: ["Node.js", "JavaScript", "Redis"],
    difficulty: "intermediate",
    duration: 110,
  },
  {
    title: "Python for Data Science",
    description: "Learn Python fundamentals and apply them to data science. Covers pandas, NumPy, data visualization with matplotlib, Jupyter notebooks, and exploratory data analysis on real datasets.",
    tags: ["Python", "Data Science"],
    difficulty: "beginner",
    duration: 80,
  },
  {
    title: "AWS Cloud Practitioner",
    description: "Get started with Amazon Web Services. Covers core AWS services including EC2, S3, RDS, Lambda, and VPC. Prepares you for the AWS Cloud Practitioner certification exam with hands-on labs.",
    tags: ["AWS", "Docker"],
    difficulty: "beginner",
    duration: 70,
  },
];

// ─── Seed Functions ───────────────────────────────────────────────────────

async function seedMongo(db, users, courses) {
  console.log("\n📦 Seeding MongoDB...");

  // Clear existing data
  await db.collection("users").deleteMany({});
  await db.collection("courses").deleteMany({});
  await db.collection("enrollments").deleteMany({});
  await db.collection("progress").deleteMany({});

  // Insert users
  const hashedPassword = await bcrypt.hash("password123", 10);
  const userDocs = users.map((u) => ({
    ...u,
    passwordHash: hashedPassword,
    enrolledCourses: [],
    createdAt: new Date(),
  }));
  await db.collection("users").insertMany(userDocs);
  console.log(`  ✅ Inserted ${userDocs.length} users`);

  // Insert courses with embeddings
  console.log("  ⏳ Generating course embeddings (this may take ~30s)...");
  const courseDocs = [];
  for (const c of courses) {
    let descriptionVector = [];
    try {
      descriptionVector = getEmbedding(c.description);
    } catch (e) {
      console.warn(`  ⚠️  Embedding failed for "${c.title}": ${e.message}`);
    }
    courseDocs.push({ ...c, enrollmentCount: 0, rating: 0, createdAt: new Date(), descriptionVector });
  }
  await db.collection("courses").insertMany(courseDocs);
  console.log(`  ✅ Inserted ${courseDocs.length} courses with embeddings`);

  // Create sample enrollments
  const enrollments = [];
  const progressDocs = [];
  const pairs = [
    [users[0]._id, courses[0]._id, 75],
    [users[0]._id, courses[2]._id, 100],
    [users[1]._id, courses[1]._id, 40],
    [users[1]._id, courses[6]._id, 90],
    [users[2]._id, courses[2]._id, 60],
    [users[2]._id, courses[4]._id, 30],
    [users[3]._id, courses[3]._id, 50],
    [users[3]._id, courses[7]._id, 100],
    [users[4]._id, courses[5]._id, 85],
    [users[4]._id, courses[0]._id, 20],
  ];

  for (const [userId, courseId, pct] of pairs) {
    const enrollId = uuidv4();
    enrollments.push({
      _id: enrollId,
      userId,
      courseId,
      enrolledAt: new Date(Date.now() - Math.random() * 30 * 86400000),
      completedAt: pct === 100 ? new Date() : null,
    });
    progressDocs.push({ userId, courseId, percentage: pct, updatedAt: new Date() });
    await db.collection("courses").updateOne({ _id: courseId }, { $inc: { enrollmentCount: 1 } });
  }

  await db.collection("enrollments").insertMany(enrollments);
  await db.collection("progress").insertMany(progressDocs);
  console.log(`  ✅ Inserted ${enrollments.length} enrollments and progress records`);
}

async function seedNeo4j(driver, users, courses) {
  console.log("\n🔷 Seeding Neo4j...");
  const session = driver.session();

  try {
    // Clear
    await session.run("MATCH (n) DETACH DELETE n");

    // Create User nodes
    for (const u of users) {
      await session.run(
        `CREATE (u:User {id: $id, username: $username, email: $email})`,
        { id: u._id, username: u.username, email: u.email }
      );
    }

    // Create Skill nodes and HAS_SKILL relationships
    for (const u of users) {
      for (const skill of u.skills) {
        await session.run(
          `MERGE (s:Skill {name: $skill})
           WITH s
           MATCH (u:User {id: $userId})
           MERGE (u)-[:HAS_SKILL]->(s)`,
          { skill, userId: u._id }
        );
      }
    }

    // Create Course nodes and TEACHES relationships
    for (const c of courses) {
      await session.run(
        `CREATE (c:Course {id: $id, title: $title, difficulty: $difficulty})`,
        { id: c._id, title: c.title, difficulty: c.difficulty }
      );
      for (const tag of c.tags) {
        await session.run(
          `MERGE (s:Skill {name: $skill})
           WITH s
           MATCH (c:Course {id: $courseId})
           MERGE (c)-[:TEACHES]->(s)`,
          { skill: tag, courseId: c._id }
        );
      }
    }

    // ENROLLED_IN relationships
    const enrollPairs = [
      [users[0]._id, courses[0]._id],
      [users[0]._id, courses[2]._id],
      [users[1]._id, courses[1]._id],
      [users[2]._id, courses[4]._id],
      [users[3]._id, courses[3]._id],
      [users[4]._id, courses[5]._id],
    ];
    for (const [uid, cid] of enrollPairs) {
      await session.run(
        `MATCH (u:User {id: $uid}), (c:Course {id: $cid}) MERGE (u)-[:ENROLLED_IN]->(c)`,
        { uid, cid }
      );
    }

    // FOLLOWS relationships (social graph)
    const follows = [
      [users[0]._id, users[1]._id],
      [users[0]._id, users[4]._id],
      [users[1]._id, users[2]._id],
      [users[2]._id, users[3]._id],
      [users[3]._id, users[4]._id],
      [users[4]._id, users[0]._id],
      [users[1]._id, users[4]._id],
    ];
    for (const [a, b] of follows) {
      await session.run(
        `MATCH (a:User {id: $a}), (b:User {id: $b}) MERGE (a)-[:FOLLOWS]->(b)`,
        { a, b }
      );
    }

    console.log("  ✅ Created User, Skill, Course nodes and all relationships");
  } finally {
    await session.close();
  }
}

async function seedRedis(redis, users) {
  console.log("\n🔴 Seeding Redis...");

  // Clear leaderboard
  await redis.del("leaderboard:global");
  await redis.del("leaderboard:names");

  // Seed leaderboard with scores
  const scores = [
    [users[0]._id, users[0].username, 350],
    [users[1]._id, users[1].username, 290],
    [users[4]._id, users[4].username, 420],
    [users[2]._id, users[2].username, 180],
    [users[3]._id, users[3].username, 510],
  ];

  for (const [id, name, pts] of scores) {
    await redis.zAdd("leaderboard:global", [{ score: pts, value: id }]);
    await redis.hSet("leaderboard:names", id, name);
  }

  console.log("  ✅ Leaderboard seeded with 5 users");
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log("🌱 SkillSphere Seed Script Starting...\n");

  if (!MONGODB_URI || !NEO4J_URI || !NEO4J_PASSWORD) {
    console.error("❌ Missing required env vars: MONGODB_URI, NEO4J_URI, NEO4J_PASSWORD");
    console.error("   Please create a .env file from .env.example");
    process.exit(1);
  }

  // Assign IDs
  const users = USERS_DATA.map((u) => ({ ...u, _id: uuidv4() }));
  const courses = COURSES_DATA.map((c) => ({ ...c, _id: uuidv4() }));

  // Connect all DBs
  const mongoClient = new MongoClient(MONGODB_URI, { tls: true });
  const neo4jDriver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  const redisClient = createClient({ socket: { host: REDIS_HOST, port: REDIS_PORT } });

  try {
    await mongoClient.connect();
    await neo4jDriver.verifyConnectivity();
    await redisClient.connect();
    console.log("✅ All databases connected");

    const db = mongoClient.db(MONGODB_DB);

    await seedMongo(db, users, courses);
    await seedNeo4j(neo4jDriver, users, courses);
    await seedRedis(redisClient, users);

    console.log("\n✨ Seed complete!");
    console.log("\n📋 Test credentials:");
    console.log("   Email: alice@example.com  |  Password: password123");
    console.log("   Email: bob@example.com    |  Password: password123");
    console.log("\n⚠️  IMPORTANT: Create the Atlas Vector Search index manually!");
    console.log("   Collection: courses  |  Field: descriptionVector  |  Dimensions: 384");
    console.log("   Index name: vector_index  |  Similarity: cosine");
    console.log("   See README.md → Step 4 for full instructions.\n");
  } catch (err) {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  } finally {
    await mongoClient.close();
    await neo4jDriver.close();
    await redisClient.quit();
  }
}

main();
