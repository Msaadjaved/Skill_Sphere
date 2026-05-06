// db/neo4j.js – Direct Neo4j driver (no ORM)
const neo4j = require("neo4j-driver");

let driver;

async function connectNeo4j() {
  if (driver) return driver;

  driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD),
    {
      maxConnectionPoolSize: 50,
      connectionAcquisitionTimeout: 30000,
    }
  );

  await driver.verifyConnectivity();
  console.log("✅ Neo4j AuraDB connected");

  // Bootstrap constraints and indexes
  await bootstrapNeo4j();

  return driver;
}

async function bootstrapNeo4j() {
  const session = driver.session();
  try {
    // Constraints
    const constraints = [
      "CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE",
      "CREATE CONSTRAINT skill_name IF NOT EXISTS FOR (s:Skill) REQUIRE s.name IS UNIQUE",
      "CREATE CONSTRAINT course_id IF NOT EXISTS FOR (c:Course) REQUIRE c.id IS UNIQUE",
    ];
    for (const q of constraints) {
      await session.run(q);
    }
    console.log("✅ Neo4j constraints ensured");
  } catch (err) {
    console.warn("Neo4j bootstrap warning:", err.message);
  } finally {
    await session.close();
  }
}

function getNeo4jSession() {
  if (!driver) throw new Error("Neo4j not connected.");
  return driver.session();
}

async function runNeo4j(cypher, params = {}) {
  const session = getNeo4jSession();
  try {
    const result = await session.run(cypher, params);
    return result.records;
  } finally {
    await session.close();
  }
}

async function closeNeo4j() {
  if (driver) await driver.close();
}

module.exports = { connectNeo4j, getNeo4jSession, runNeo4j, closeNeo4j };
