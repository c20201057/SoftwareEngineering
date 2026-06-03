const fs = require("node:fs");
const path = require("node:path");
const { createSeedData } = require("./seed");
const { deepClone, ensureDir } = require("../utils");

const COLLECTIONS = [
  "users",
  "game_libs",
  "game_sessions",
  "session_applications",
  "session_members",
  "venues",
  "venue_reservations",
  "reviews",
  "credit_records",
  "complaints",
  "notifications",
  "admin_logs",
];

const PREFIX = {
  users: "u",
  game_libs: "g",
  game_sessions: "s",
  session_applications: "a",
  session_members: "m",
  venues: "v",
  venue_reservations: "vr",
  reviews: "r",
  credit_records: "cr",
  complaints: "c",
  notifications: "n",
  admin_logs: "l",
};

class JsonStore {
  constructor(dataDir, options = {}) {
    this.dataDir = dataDir;
    this.resetOnStart = Boolean(options.resetOnStart);
    ensureDir(this.dataDir);
    this.initialize();
  }

  initialize() {
    if (this.resetOnStart) {
      for (const collection of COLLECTIONS) {
        const file = this.fileFor(collection);
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
    }
    const seed = createSeedData();
    for (const collection of COLLECTIONS) {
      const file = this.fileFor(collection);
      if (!fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify(seed[collection], null, 2), "utf-8");
      }
    }
  }

  fileFor(collection) {
    this.assertCollection(collection);
    return path.join(this.dataDir, `${collection}.json`);
  }

  assertCollection(collection) {
    if (!COLLECTIONS.includes(collection)) {
      throw new Error(`Unknown collection: ${collection}`);
    }
  }

  read(collection) {
    const text = fs.readFileSync(this.fileFor(collection), "utf-8");
    return JSON.parse(text);
  }

  write(collection, rows) {
    const file = this.fileFor(collection);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rows, null, 2), "utf-8");
    fs.renameSync(tmp, file);
  }

  all(collection) {
    return deepClone(this.read(collection));
  }

  find(collection, predicate) {
    return this.all(collection).filter(predicate);
  }

  get(collection, id) {
    return this.all(collection).find((row) => row.id === id) || null;
  }

  insert(collection, record) {
    const rows = this.read(collection);
    const next = { ...record, id: record.id || this.nextId(collection, rows) };
    rows.push(next);
    this.write(collection, rows);
    return deepClone(next);
  }

  update(collection, id, patch) {
    const rows = this.read(collection);
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) return null;
    rows[index] = { ...rows[index], ...patch };
    this.write(collection, rows);
    return deepClone(rows[index]);
  }

  remove(collection, id) {
    const rows = this.read(collection);
    const next = rows.filter((row) => row.id !== id);
    this.write(collection, next);
    return rows.length !== next.length;
  }

  nextId(collection, rows = this.read(collection)) {
    const prefix = PREFIX[collection] || "id";
    let max = 0;
    for (const row of rows) {
      const raw = String(row.id || "");
      if (!raw.startsWith(prefix)) continue;
      const value = Number(raw.slice(prefix.length));
      if (Number.isFinite(value)) max = Math.max(max, value);
    }
    return `${prefix}${max + 1}`;
  }
}

module.exports = { JsonStore, COLLECTIONS };
