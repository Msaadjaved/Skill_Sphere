// scripts/embedvectors.js
// Run from inside Docker: docker exec skillsphere-backend node /app/embedvectors.js
// Generates real HF vectors for all courses in MongoDB

const { MongoClient } = require("mongodb");

const COURSES = [
  { title: "React from Zero to Hero", description: "Master React.js from scratch. Learn hooks, state management, component patterns, and build real-world applications with React and TypeScript. Covers testing with Jest and deploying to production." },
  { title: "Machine Learning with Python", description: "Comprehensive introduction to machine learning using Python. Covers supervised and unsupervised learning, neural networks, scikit-learn, TensorFlow basics, and deploying ML models to production." },
  { title: "MongoDB: The Complete Guide", description: "Deep dive into MongoDB document database. Learn schema design, aggregation pipelines, indexing strategies, transactions, Atlas Vector Search, and building production-ready applications." },
  { title: "Docker and Kubernetes Mastery", description: "Learn containerization with Docker and orchestration with Kubernetes. Build, ship, and run applications at scale. Covers Docker Compose, Helm charts, CI/CD pipelines, and AWS EKS deployment." },
  { title: "Graph Databases with Neo4j", description: "Explore the power of graph databases using Neo4j. Learn Cypher query language, model complex relationships, build recommendation engines, and apply graph algorithms to real-world problems." },
  { title: "Node.js Backend Development", description: "Build scalable REST APIs and microservices with Node.js and Express. Covers authentication with JWT, Redis caching, MongoDB integration, testing, and deploying to production servers." },
  { title: "Python for Data Science", description: "Learn Python fundamentals and apply them to data science. Covers pandas, NumPy, data visualization with matplotlib, Jupyter notebooks, and exploratory data analysis on real datasets." },
  { title: "AWS Cloud Practitioner", description: "Get started with Amazon Web Services. Covers core AWS services including EC2, S3, RDS, Lambda, and VPC. Prepares you for the AWS Cloud Practitioner certification exam with hands-on labs." },
];

async function embed(text) {
  const r = await fetch(
    "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.HF_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: text }),
    }
  );
  const d = await r.json();
  return Array.isArray(d[0]) ? d[0] : d;
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI, { tls: true });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "skillsphere");

  console.log("🤖 Generating HF vectors for all courses...\n");

  for (const course of COURSES) {
    const vector = await embed(course.description);
    await db.collection("courses").updateOne(
      { title: course.title },
      { $set: { descriptionVector: vector } }
    );
    console.log(`✅ ${course.title} → ${vector.length} dims`);
  }

  await client.close();
  console.log("\n✨ All vectors updated! Vector search is ready.");
}

main().catch(console.error);