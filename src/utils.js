const fs = require("node:fs");
const path = require("node:path");

function nowIso() {
  return new Date().toISOString();
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        // 原型项目没有单独接入 body-parser，这里直接限制 JSON 请求体大小。
        reject(new Error("请求体过大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  const text = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
}

function parseUrl(req) {
  const base = `http://${req.headers.host || "localhost"}`;
  return new URL(req.url, base);
}

function normalizeText(value) {
  return String(value || "").trim();
}

function requireFields(payload, fields) {
  const missing = fields.filter((field) => payload[field] === undefined || payload[field] === null || payload[field] === "");
  if (missing.length) {
    const { badRequest } = require("./errors");
    throw badRequest(`缺少必填字段：${missing.join(", ")}`, { missing });
  }
}

function parseDate(value, fieldName) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    const { badRequest } = require("./errors");
    throw badRequest(`${fieldName} 不是合法时间`);
  }
  return date;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);
}

function maskStudentNo(studentNo) {
  if (!studentNo) return "";
  const text = String(studentNo);
  if (text.length <= 4) return "****";
  return `${text.slice(0, 2)}****${text.slice(-2)}`;
}

function safeJoin(root, requested) {
  const resolved = path.resolve(root, requested || "index.html");
  const rootResolved = path.resolve(root);
  // path.resolve 后再做前缀检查，用来阻断 ../ 形式的静态资源路径穿越。
  if (!resolved.startsWith(rootResolved)) {
    return null;
  }
  return resolved;
}

module.exports = {
  nowIso,
  deepClone,
  ensureDir,
  readJsonBody,
  sendJson,
  parseUrl,
  normalizeText,
  requireFields,
  parseDate,
  overlaps,
  maskStudentNo,
  safeJoin,
};
