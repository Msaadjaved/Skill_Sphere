# ⬡ SkillSphere – Learning & Networking Platform

An AI-powered learning and networking platform where users can learn new skills, track their progress, and connect with other learners. The system uses **MongoDB Atlas**, **Neo4j AuraDB**, and **Redis** together with **Hugging Face** vector embeddings for semantic course search.

---

## 🗄️ Databases Used

| Database | Purpose |
|---|---|
| **MongoDB Atlas** | Main data storage — users, courses, enrollments, progress. Aggregation pipelines for analytics. Vector Search for AI-powered course search. |
| **Neo4j AuraDB** | Graph relationships — users, skills, courses. Path traversal for friend and course recommendations. |
| **Redis** | Session storage (Hashes), caching with TTL (Strings), leaderboard (Sorted Sets), name mapping (Hashes). |

---

## 🚀 How to Run

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop) installed and running
- [Node.js](https://nodejs.org) LTS (for running the seed script locally)
- Git

### Step 1 — Clone the repository
```bash
git clone https://github.com/Msaadjaved/Skill_Sphere.git
cd Skill_Sphere
```

### Step 2 — Configure environment
```bash
cp env.example .env
```

Open `.env` and fill in your credentials:
```
MONGODB_URI=mongodb+srv://user:PASSWORD@cluster0.yfjdcsl.mongodb.net/?appName=Cluster0
MONGODB_DB=skillsphere
NEO4J_URI=neo4j+s://YOUR_INSTANCE.databases.neo4j.io
NEO4J_USER=neo4j
NEO4J_PASSWORD=YOUR_NEO4J_PASSWORD
HF_TOKEN=hf_YOUR_HUGGINGFACE_TOKEN
SESSION_SECRET=skillsphere2024secret
REDIS_HOST=redis
REDIS_PORT=6379
```

### Step 3 — Start the application
```bash
docker compose up --build
```

Wait for all three green lines:
```
✅ MongoDB Atlas connected
✅ Neo4j AuraDB connected
✅ Redis connected
🚀 SkillSphere API running!
   Frontend:     http://localhost:8080
   Backend API:  http://localhost:3000
```

### Step 4 — Seed sample data

> ⚠️ Docker must be running before executing these commands.

Open a second terminal and run:

```bash
# Seed users, courses, Neo4j graph, and Redis leaderboard
docker cp scripts/seed.js skillsphere-backend:/app/seed_full.js
docker exec skillsphere-backend node /app/seed_full.js

# Generate real AI vectors for courses (required for vector search to work)
docker cp scripts/embedvectors.js skillsphere-backend:/app/embedvectors.js
docker exec skillsphere-backend node /app/embedvectors.js
```

### Step 5 — Create MongoDB Vector Search Index

1. Go to [cloud.mongodb.com](https://cloud.mongodb.com)
2. Your cluster → **Atlas Search** → **Create Search Index**
3. Choose **Atlas Vector Search** → **JSON Editor**
4. Select database: `skillsphere`, collection: `courses`
5. Paste this configuration:
```json
{
  "fields": [{
    "type": "vector",
    "path": "descriptionVector",
    "numDimensions": 384,
    "similarity": "cosine"
  }]
}
```
6. Name it exactly `vector_index` → Create → wait ~2 minutes

---

## 💻 How to Use

### Access the application
- **Frontend:** http://localhost:8080
- **API:** http://localhost:3000
- **Health check:** http://localhost:3000/health

### Demo credentials (after seeding)
```
Email: alice@example.com    Password: password123
Email: bob@example.com      Password: password123
Email: carol@example.com    Password: password123
```

### Features
- **Register / Login** — create an account with your skills
- **Browse Courses** — view all available courses
- **AI Search** — type a natural language query (e.g. "learn Python for data analysis") and get semantically relevant results powered by Hugging Face + MongoDB Vector Search
- **Enroll** — enroll in courses and track your progress
- **Dashboard** — view your progress, rank, and personalized recommendations
- **Leaderboard** — see top learners ranked by points (powered by Redis Sorted Sets)
- **Recommendations** — get course, friend, and skill recommendations powered by Neo4j graph traversal
- **Analytics** — view platform statistics powered by MongoDB aggregation pipelines

---

## 🌱 Sample Data

What the seed script creates:
- **MongoDB:** 5 users, 8 courses with HF embeddings, 10 enrollments, progress records
- **Neo4j:** User, Skill, Course nodes with HAS_SKILL, FOLLOWS, ENROLLED_IN, TEACHES relationships
- **Redis:** Leaderboard with initial scores for all 5 users

```bash
# Must run while Docker is running
docker cp scripts/seed.js skillsphere-backend:/app/seed_full.js
docker exec skillsphere-backend node /app/seed_full.js

docker cp scripts/embedvectors.js skillsphere-backend:/app/embedvectors.js
docker exec skillsphere-backend node /app/embedvectors.js
```

---

## 🏗️ Project Structure

```
Skill_Sphere/
├── docker-compose.yml          # Orchestrates Redis + Backend + Frontend
├── env.example                 # Environment template
├── .gitignore
├── README.md
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── server.js               # Express app entry point
│   ├── db/
│   │   ├── mongo.js            # MongoDB direct driver (no Mongoose)
│   │   ├── neo4j.js            # Neo4j direct driver (no OGM)
│   │   └── redis.js            # Redis direct driver + helpers
│   ├── middleware/
│   │   └── auth.js             # Session authentication via Redis
│   ├── routes/
│   │   ├── auth.js             # Register, login, logout
│   │   ├── courses.js          # CRUD + vector search + enroll
│   │   ├── dashboard.js        # Aggregation pipelines + leaderboard
│   │   ├── recommendations.js  # Neo4j path traversal queries
│   │   └── users.js            # Profile + follow/unfollow
│   └── services/
│       └── embeddings.js       # Hugging Face embedding service
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── public/
│       ├── index.html
│       ├── css/style.css
│       └── js/app.js
├── scripts/
│   ├── package.json
│   ├── seed.js                 # Seeds MongoDB + Neo4j + Redis
│   └── embedvectors.js        # Generates HF vectors for all courses
└── docs/
    └── report.md               # Project report
```

---

## 🛑 Stop the Application

```bash
docker compose down
```