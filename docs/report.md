# SkillSphere – Project Report
### Introduction to NoSQL Databases
### EPITA — 2025/2026

---

## 1. Project Idea

SkillSphere is an AI-powered learning and networking platform where users can learn new skills, track their progress, and connect with other learners. The platform demonstrates how three fundamentally different NoSQL databases can be combined in a single real-world application, each handling the type of data it is best suited for.

The core features are:
- User registration and authentication with session management
- Course browsing and enrollment with progress tracking
- AI-powered semantic course search using vector embeddings
- Graph-based recommendations for courses, friends, and skills
- Real-time leaderboard tracking learner points
- Dashboard analytics powered by aggregation pipelines

---

## 2. System Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│   Backend API   │────▶│  MongoDB Atlas  │
│  (nginx:8080)   │     │  (Node.js:3000) │     │  (documents)    │
└─────────────────┘     │                 │────▶│  Neo4j AuraDB   │
                        │                 │     │  (graph)        │
                        │                 │────▶│  Redis          │
                        │                 │     │  (cache/sessions)│
                        │                 │────▶│  Hugging Face   │
                        └─────────────────┘     │  (embeddings)   │
                                                └─────────────────┘
```

All services run in Docker containers orchestrated by Docker Compose. The frontend is served by nginx which also proxies API requests to the Node.js backend. All database drivers are used directly without any ORM or ODM layer (no Mongoose, no OGM).

---

## 3. MongoDB — Document Storage + Vector Search

### Why MongoDB?

MongoDB was chosen as the primary data store because the application data is naturally document-shaped. Users have varying skill sets, courses have flexible tag arrays, and progress data is nested per user per course. MongoDB's flexible schema handles all of this without requiring rigid table definitions.

### Collections

| Collection | Purpose |
|---|---|
| `users` | User profiles, hashed passwords, skill arrays |
| `courses` | Course metadata + 384-dimensional embedding vector |
| `enrollments` | User-course enrollment records with timestamps |
| `progress` | Completion percentage per user per course |

### Vector Search — AI-Powered Course Discovery

When a course is created, its description is sent to the Hugging Face Inference API which returns a 384-dimensional float vector using the `sentence-transformers/all-MiniLM-L6-v2` model. This vector is stored in the `descriptionVector` field of the course document.

When a user searches, their query is also converted to a vector using the same model. MongoDB Atlas Vector Search then finds the most semantically similar courses using cosine similarity.

```javascript
// Transform user query to vector
const queryVector = await getEmbedding(q); // calls HuggingFace API

// MongoDB Atlas Vector Search pipeline
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
```

This allows users to search with natural language like *"learn Python for data analysis"* and find relevant courses even if the exact words don't appear in the course title.

### Aggregation Pipeline #1 — Most Popular Courses

This pipeline counts enrollments per course, joins with the courses collection to get metadata, and computes a completion rate.

```javascript
db.collection("enrollments").aggregate([
  // Stage 1: Count enrollments per course
  {
    $group: {
      _id: "$courseId",
      totalEnrollments: { $sum: 1 },
      completions: {
        $sum: { $cond: [{ $ne: ["$completedAt", null] }, 1, 0] },
      },
    },
  },
  // Stage 2: Sort by most enrolled
  { $sort: { totalEnrollments: -1 } },
  // Stage 3: Top 10 only
  { $limit: 10 },
  // Stage 4: Join with courses for title and metadata
  {
    $lookup: {
      from: "courses",
      localField: "_id",
      foreignField: "_id",
      as: "courseData",
    },
  },
  { $unwind: "$courseData" },
  // Stage 5: Shape output including completion rate
  {
    $project: {
      title: "$courseData.title",
      difficulty: "$courseData.difficulty",
      totalEnrollments: 1,
      completionRate: {
        $round: [
          { $multiply: [{ $divide: ["$completions", "$totalEnrollments"] }, 100] },
          1,
        ],
      },
    },
  },
]);
```

**Purpose:** This pipeline powers the analytics dashboard showing which courses are most popular and how many learners complete them. It demonstrates `$group`, `$lookup`, `$unwind`, `$project`, and computed fields in a single query.

### Aggregation Pipeline #2 — User Progress Summary

This pipeline joins enrollments with progress documents, groups by user, and computes average progress and completion counts.

```javascript
db.collection("enrollments").aggregate([
  // Stage 1: Join progress data for each enrollment
  {
    $lookup: {
      from: "progress",
      let: { uid: "$userId", cid: "$courseId" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$userId", "$$uid"] },
                { $eq: ["$courseId", "$$cid"] },
              ],
            },
          },
        },
      ],
      as: "progressData",
    },
  },
  { $unwind: { path: "$progressData", preserveNullAndEmptyArrays: true } },
  // Stage 2: Group by user and compute stats
  {
    $group: {
      _id: "$userId",
      totalCourses: { $sum: 1 },
      avgProgress: { $avg: { $ifNull: ["$progressData.percentage", 0] } },
      completedCourses: {
        $sum: { $cond: [{ $ne: ["$completedAt", null] }, 1, 0] },
      },
    },
  },
  // Stage 3: Join with users for display names
  {
    $lookup: {
      from: "users",
      localField: "_id",
      foreignField: "_id",
      as: "userData",
    },
  },
  { $unwind: "$userData" },
  {
    $project: {
      username: "$userData.username",
      totalCourses: 1,
      avgProgress: { $round: ["$avgProgress", 1] },
      completedCourses: 1,
    },
  },
  { $sort: { avgProgress: -1 } },
]);
```

**Purpose:** This pipeline shows a table of all users ranked by their average progress. It uses a correlated `$lookup` with `$let` and `$expr` to join on two fields simultaneously, which is more advanced than a simple foreign key join.

---

## 4. Neo4j — Graph Relationships and Recommendations

### Why Neo4j?

Recommendation systems are fundamentally graph problems. "Find courses that people similar to me have enrolled in" is naturally expressed as a graph traversal — following edges between nodes — rather than as SQL joins or MongoDB aggregations. Neo4j AuraDB was used as the cloud graph database.

### Graph Model

```
(User)-[:HAS_SKILL]->(Skill)
(User)-[:FOLLOWS]->(User)
(User)-[:ENROLLED_IN]->(Course)
(Course)-[:TEACHES]->(Skill)
```

### Path Traversal Query #1 — Friend Recommendations

Finds users that your followed users also follow (2-hop traversal), ranked by mutual connection count.

```cypher
MATCH (me:User {id: $userId})-[:FOLLOWS]->(mutual:User)-[:FOLLOWS]->(recommended:User)
WHERE recommended.id <> $userId
  AND NOT (me)-[:FOLLOWS]->(recommended)
WITH recommended, count(mutual) AS mutualCount
ORDER BY mutualCount DESC
LIMIT 10
RETURN recommended.id AS id,
       recommended.username AS username,
       mutualCount
```

**What it returns:** Users you might want to follow, ranked by how many mutual connections you share. This is the same algorithm used by LinkedIn's "People you may know" feature.

**Why it's useful:** Without graph traversal, finding mutual connections would require multiple expensive JOIN operations across large tables. In Neo4j, this is a single pattern match that traverses the graph efficiently.

### Path Traversal Query #2 — Course Recommendations

Finds courses that teach skills your followed peers have, but you haven't enrolled in.

```cypher
MATCH (me:User {id: $userId})-[:FOLLOWS]->(peer:User)-[:HAS_SKILL]->(skill:Skill)
MATCH (course:Course)-[:TEACHES]->(skill)
WHERE NOT (me)-[:ENROLLED_IN]->(course)
WITH course, skill, count(peer) AS peerCount
ORDER BY peerCount DESC
LIMIT 10
RETURN course.id, course.title, course.difficulty,
       collect(DISTINCT skill.name) AS relatedSkills,
       peerCount
```

**What it returns:** Courses ranked by how many of your peers have the skill it teaches. The more peers who know the skill, the more relevant the course recommendation.

### Path Traversal Query #3 — Skill Gap Analysis

Finds skills that similar users have but you don't.

```cypher
MATCH (me:User {id: $userId})-[:HAS_SKILL]->(shared:Skill)<-[:HAS_SKILL]-(similar:User)
MATCH (similar)-[:HAS_SKILL]->(missing:Skill)
WHERE NOT (me)-[:HAS_SKILL]->(missing)
  AND missing <> shared
WITH missing, count(similar) AS frequency
ORDER BY frequency DESC
LIMIT 10
RETURN missing.name AS skill, frequency
```

**What it returns:** Skills you are missing compared to users who share at least one skill with you, helping identify gaps in your learning path.

### Path Traversal Query #4 — Shortest Connection Path

Uses Neo4j's built-in `shortestPath` algorithm to find how two users are connected.

```cypher
MATCH path = shortestPath(
  (start:User {id: $startId})-[:FOLLOWS*1..6]->(end:User {id: $endId})
)
RETURN [node IN nodes(path) | node.username] AS chain,
       length(path) AS hops
```

**What it returns:** The chain of users connecting you to another user, and the number of hops. Equivalent to LinkedIn's "2nd connection" or "3rd connection" feature.

---

## 5. Redis — Caching, Sessions, and Leaderboard

### Why Redis?

Redis provides sub-millisecond data access, making it ideal for data that needs to be read frequently and quickly. Four different Redis data structures are used across the application.

### Data Structure #1 — Hashes (Session Storage)

User sessions are stored as Redis Hashes with a 24-hour TTL. Each session field (id, username, email) is stored directly as a Hash field without JSON serialization, making individual field access more efficient and readable.

```javascript
// Store session as Hash — no stringify needed
await redis.hSet(`session:${sessionId}`, {
  id: userData.id,
  username: userData.username,
  email: userData.email,
});
await redis.expire(`session:${sessionId}`, ttlSeconds);

// Retrieve — returns plain object directly, no JSON.parse needed
const data = await redis.hGetAll(`session:${sessionId}`);
return Object.keys(data).length > 0 ? data : null;
```

### Data Structure #2 — Strings with TTL (Caching)

Frequently accessed data like the course list and dashboard analytics are cached in Redis with short TTLs to reduce MongoDB load.

```javascript
// Generic cache wrapper
async function withCache(key, fn, ttlSeconds = 300) {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached); // cache hit

  const fresh = await fn();             // cache miss — query MongoDB
  await redis.set(key, JSON.stringify(fresh), { EX: ttlSeconds });
  return fresh;
}

// Course list cached for 2 minutes
const courses = await withCache(
  "courses:all",
  () => db.collection("courses").find().toArray(),
  120
);
```

### Data Structure #3 — Sorted Sets (Leaderboard)

The leaderboard uses Redis Sorted Sets where each member is a user ID and the score is their total points. This allows O(log N) insertion and O(log N + K) range queries.

```javascript
// Add/update score
await redis.zAdd("leaderboard:global", [{ score: points, value: userId }]);

// Atomically increment score when user progresses
await redis.zIncrBy("leaderboard:global", delta, userId);

// Get top 10 learners — highest score first
const top10 = await redis.zRangeWithScores("leaderboard:global", 0, 9, { REV: true });

// Get a specific user's rank (0-based, so +1 for display)
const rank = await redis.zRevRank("leaderboard:global", userId);
```

### Data Structure #4 — Hashes (userId → username Mapping)

Since the leaderboard Sorted Set stores only user IDs as members, a Redis Hash maps user IDs to usernames for display. This avoids querying MongoDB just to get a display name, and no serialization is needed since both key and value are plain strings.

```javascript
// Store mapping directly — no stringify needed
await redis.hSet("leaderboard:names", userId, username);

// Retrieve all mappings in one call
const names = await redis.hGetAll("leaderboard:names");
// names = { "uuid-123": "alice_dev", "uuid-456": "bob_ml", ... }
```

---

## 6. AI Model — Hugging Face Embeddings

**Model:** `sentence-transformers/all-MiniLM-L6-v2`
**Provider:** Hugging Face Inference API (free tier)
**Output dimensions:** 384
**Similarity metric:** Cosine similarity

The model converts text descriptions into dense vector representations where semantically similar texts produce similar vectors. This allows the search system to find courses by meaning rather than exact keyword matching.

**Endpoint used:**
```
https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction
```

**Implementation in `backend/services/embeddings.js`:**
```javascript
async function getEmbedding(text) {
  const response = await fetch(
    "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.HF_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: text.trim() }),
    }
  );
  const data = await response.json();
  return Array.isArray(data[0]) ? data[0] : data; // 384-dim float array
}
```

---

## 7. Conclusion

SkillSphere demonstrates how three fundamentally different NoSQL databases can be combined effectively in a single application:

- **MongoDB Atlas** handles flexible document storage, complex aggregations, and AI-powered vector search — everything that requires rich querying of structured data at scale.
- **Neo4j AuraDB** handles relationship traversal and graph-based recommendations — problems that would be extremely expensive to solve with relational joins or document lookups.
- **Redis** handles high-speed ephemeral data — sessions stored as Hashes for direct field access, cached results as Strings with TTL, and real-time leaderboard rankings using Sorted Sets with a Hash for name mapping.

Each database is used for what it is best at, reflecting a real-world polyglot persistence architecture used by modern production applications.