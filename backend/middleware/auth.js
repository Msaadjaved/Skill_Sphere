// middleware/auth.js
const { sessions } = require("../db/redis");

async function requireAuth(req, res, next) {
  const sessionId = req.headers["x-session-id"] || req.cookies?.sessionId;
  if (!sessionId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const user = await sessions.get(sessionId);
  if (!user) {
    return res.status(401).json({ error: "Session expired or invalid" });
  }

  req.user = user;
  req.sessionId = sessionId;
  next();
}

module.exports = { requireAuth };
