const crypto = require("node:crypto");

const SESSION_TTL_HOURS = 24;

function createSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("base64url");
}

function sessionExpiresAt(now = Date.now()) {
  return new Date(now + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();
}

module.exports = {
  SESSION_TTL_HOURS,
  createSessionToken,
  hashSessionToken,
  sessionExpiresAt,
};
