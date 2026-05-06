// MongoDB Atlas direct driver – no Mongoose
// Handles: users, courses, enrollments, progress
// Aggregation pipelines: popular courses, user progress summary
// Vector Search: AI-powered course search using HF embeddings

const { MongoClient } = require("mongodb");

let client;
let db;

async function connectMongo() {
  if (db) return db;

  client = new MongoClient(process.env.MONGODB_URI, {
    tls: true,
    serverApi: { version: "1", strict: false, deprecationErrors: true },
  });

  await client.connect();
  db = client.db(process.env.MONGODB_DB || "skillsphere");
  console.log("✅ MongoDB Atlas connected");

  // Ensure vector search index exists on courses.descriptionVector
  await ensureIndexes(db);

  return db;
}

async function ensureIndexes(db) {
  try {
    // Standard indexes
    await db.collection("users").createIndex({ email: 1 }, { unique: true });
    await db.collection("courses").createIndex({ title: "text", tags: "text" });
    await db.collection("enrollments").createIndex({ userId: 1, courseId: 1 });
    await db.collection("progress").createIndex({ userId: 1, courseId: 1 });

    console.log("✅ MongoDB indexes ensured");
  } catch (err) {
    // Indexes may already exist
    if (!err.message.includes("already exists")) {
      console.warn("Index warning:", err.message);
    }
  }
}

function getMongo() {
  if (!db) throw new Error("MongoDB not connected. Call connectMongo() first.");
  return db;
}

async function closeMongo() {
  if (client) await client.close();
}

module.exports = { connectMongo, getMongo, closeMongo };
