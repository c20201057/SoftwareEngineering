const crypto = require("node:crypto");

const DEFAULT_INITIAL_PASSWORD = "abc123456";
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${hash.toString("base64url")}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== "string") return false;
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nText, rText, pText, salt, expectedText] = parts;
  const n = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p) || !salt || !expectedText) return false;
  const expected = Buffer.from(expectedText, "base64url");
  const actual = crypto.scryptSync(password, salt, expected.length, {
    N: n,
    r,
    p,
    maxmem: 64 * 1024 * 1024,
  });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

module.exports = {
  DEFAULT_INITIAL_PASSWORD,
  hashPassword,
  verifyPassword,
};
