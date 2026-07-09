const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  maskStudentNo,
  normalizeText,
  overlaps,
  parseDate,
  requireFields,
  safeJoin,
} = require("../src/utils");
const { JsonStore, COLLECTIONS } = require("../src/database/jsonStore");
const { hashPassword, verifyPassword } = require("../src/security/password");
const {
  SESSION_TTL_HOURS,
  createSessionToken,
  hashSessionToken,
  sessionExpiresAt,
} = require("../src/security/sessionToken");

function withStore(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "campus-gather-store-"));
  try {
    return fn(new JsonStore(dir, { resetOnStart: true }), dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("utility helpers handle common edge cases", async (t) => {
  await t.test("normalizeText trims strings", () => {
    assert.equal(normalizeText("  hello  "), "hello");
  });

  await t.test("normalizeText turns nullish values into empty text", () => {
    assert.equal(normalizeText(null), "");
    assert.equal(normalizeText(undefined), "");
  });

  await t.test("maskStudentNo hides empty values", () => {
    assert.equal(maskStudentNo(""), "");
  });

  await t.test("maskStudentNo fully masks short ids", () => {
    assert.equal(maskStudentNo("1234"), "****");
  });

  await t.test("maskStudentNo keeps only prefix and suffix for long ids", () => {
    assert.equal(maskStudentNo("2314007"), "23****07");
  });

  await t.test("overlaps detects partially overlapping time windows", () => {
    assert.equal(overlaps("2026-01-01T10:00:00Z", "2026-01-01T12:00:00Z", "2026-01-01T11:00:00Z", "2026-01-01T13:00:00Z"), true);
  });

  await t.test("overlaps treats touching boundaries as non-overlap", () => {
    assert.equal(overlaps("2026-01-01T10:00:00Z", "2026-01-01T12:00:00Z", "2026-01-01T12:00:00Z", "2026-01-01T13:00:00Z"), false);
  });

  await t.test("overlaps detects contained ranges", () => {
    assert.equal(overlaps("2026-01-01T10:00:00Z", "2026-01-01T14:00:00Z", "2026-01-01T11:00:00Z", "2026-01-01T12:00:00Z"), true);
  });

  await t.test("parseDate accepts ISO time", () => {
    assert.equal(parseDate("2026-01-01T10:00:00Z", "start").toISOString(), "2026-01-01T10:00:00.000Z");
  });

  await t.test("parseDate rejects invalid time", () => {
    assert.throws(() => parseDate("not-a-date", "start"), { status: 400, code: "VALIDATION_ERROR" });
  });

  await t.test("requireFields accepts present fields", () => {
    assert.doesNotThrow(() => requireFields({ a: 0, b: false, c: "ok" }, ["a", "b", "c"]));
  });

  await t.test("requireFields reports missing fields", () => {
    assert.throws(() => requireFields({ a: "", b: null }, ["a", "b", "c"]), (error) => {
      assert.equal(error.status, 400);
      assert.deepEqual(error.details.missing, ["a", "b", "c"]);
      return true;
    });
  });

  await t.test("safeJoin resolves default index file", () => {
    const root = path.join(os.tmpdir(), "campus-gather-public");
    assert.equal(safeJoin(root, ""), path.resolve(root, "index.html"));
  });

  await t.test("safeJoin keeps files inside root", () => {
    const root = path.join(os.tmpdir(), "campus-gather-public");
    assert.equal(safeJoin(root, "assets/app.js"), path.resolve(root, "assets/app.js"));
  });

  await t.test("safeJoin blocks parent traversal", () => {
    const root = path.join(os.tmpdir(), "campus-gather-public");
    assert.equal(safeJoin(root, "../secret.txt"), null);
  });
});

test("password and session-token security helpers are stable", async (t) => {
  await t.test("hashPassword stores scrypt metadata", () => {
    assert.match(hashPassword("abc123456"), /^scrypt\$16384\$8\$1\$/);
  });

  await t.test("verifyPassword accepts the original password", () => {
    const stored = hashPassword("abc123456");
    assert.equal(verifyPassword("abc123456", stored), true);
  });

  await t.test("verifyPassword rejects a different password", () => {
    const stored = hashPassword("abc123456");
    assert.equal(verifyPassword("abc123457", stored), false);
  });

  await t.test("hashPassword uses a fresh salt", () => {
    assert.notEqual(hashPassword("abc123456"), hashPassword("abc123456"));
  });

  await t.test("verifyPassword rejects empty hashes", () => {
    assert.equal(verifyPassword("abc123456", ""), false);
  });

  await t.test("verifyPassword rejects malformed hashes", () => {
    assert.equal(verifyPassword("abc123456", "plain-text"), false);
  });

  await t.test("createSessionToken returns URL-safe random text", () => {
    assert.match(createSessionToken(), /^[A-Za-z0-9_-]{40,}$/);
  });

  await t.test("createSessionToken is not deterministic", () => {
    assert.notEqual(createSessionToken(), createSessionToken());
  });

  await t.test("hashSessionToken is deterministic", () => {
    assert.equal(hashSessionToken("token-a"), hashSessionToken("token-a"));
  });

  await t.test("hashSessionToken hides raw token value", () => {
    assert.notEqual(hashSessionToken("token-a"), "token-a");
  });

  await t.test("sessionExpiresAt uses the configured ttl", () => {
    const base = Date.UTC(2026, 0, 1, 0, 0, 0);
    assert.equal(sessionExpiresAt(base), new Date(base + SESSION_TTL_HOURS * 3600 * 1000).toISOString());
  });
});

test("JsonStore persists seeded collections and mutations", async (t) => {
  await t.test("initializes every collection file", () => withStore((store) => {
    for (const collection of COLLECTIONS) {
      assert.ok(Array.isArray(store.all(collection)), collection);
    }
  }));

  await t.test("seeds default users and games", () => withStore((store) => {
    assert.ok(store.all("users").length >= 12);
    assert.ok(store.all("game_libs").length >= 8);
  }));

  await t.test("seeds evaluation accounts and sessions with diverse states", () => withStore((store) => {
    const users = store.all("users");
    const games = store.all("game_libs");
    const sessions = store.all("game_sessions");
    assert.equal(users.some((user) => user.nickname === "ChenMo" && user.auth_status === "verified"), true);
    assert.equal(users.some((user) => user.nickname === "BannedDemo" && user.status === "banned"), true);
    assert.equal(users.some((user) => user.nickname === "LimitedDemo" && user.status === "limited"), true);
    assert.equal(games.some((game) => game.type === "合作桌游" && game.status === "active"), true);
    assert.equal(games.some((game) => game.id === "g8" && game.status === "inactive"), true);
    assert.equal(sessions.some((session) => session.status === "full"), true);
    assert.equal(sessions.some((session) => session.status === "finished"), true);
    assert.equal(sessions.some((session) => session.status === "failed"), true);
    assert.equal(sessions.some((session) => session.status === "cancelled"), true);
    assert.equal(sessions.some((session) => session.join_mode === "manual"), true);
    assert.equal(sessions.some((session) => session.join_mode === "direct"), true);
  }));

  await t.test("insert assigns the next game id", () => withStore((store) => {
    const game = store.insert("game_libs", { name: "Test Game" });
    assert.equal(game.id, "g9");
  }));

  await t.test("insert respects an explicit id", () => withStore((store) => {
    const game = store.insert("game_libs", { id: "custom-game", name: "Custom Game" });
    assert.equal(game.id, "custom-game");
  }));

  await t.test("insert returns a clone instead of the stored object", () => withStore((store) => {
    const game = store.insert("game_libs", { name: "Clone Game" });
    game.name = "Mutated outside";
    assert.notEqual(store.get("game_libs", game.id).name, "Mutated outside");
  }));

  await t.test("update patches an existing row", () => withStore((store) => {
    const updated = store.update("game_libs", "g1", { status: "inactive" });
    assert.equal(updated.status, "inactive");
    assert.equal(store.get("game_libs", "g1").status, "inactive");
  }));

  await t.test("update returns null for missing rows", () => withStore((store) => {
    assert.equal(store.update("game_libs", "missing", { status: "inactive" }), null);
  }));

  await t.test("remove deletes an existing row", () => withStore((store) => {
    assert.equal(store.remove("game_libs", "g1"), true);
    assert.equal(store.get("game_libs", "g1"), null);
  }));

  await t.test("remove reports missing rows", () => withStore((store) => {
    assert.equal(store.remove("game_libs", "missing"), false);
  }));

  await t.test("find filters cloned rows", () => withStore((store) => {
    const games = store.find("game_libs", (game) => game.status === "active");
    assert.ok(games.length >= 3);
    games[0].status = "changed";
    assert.notEqual(store.get("game_libs", games[0].id).status, "changed");
  }));

  await t.test("next student account id stays in the student range", () => withStore((store) => {
    assert.equal(store.nextId("users", store.all("users"), { role: "student" }), "11011");
  }));

  await t.test("next admin account id stays in the admin range", () => withStore((store) => {
    assert.equal(store.nextId("users", store.all("users"), { role: "admin" }), "10003");
  }));

  await t.test("unknown collections are rejected", () => withStore((store) => {
    assert.throws(() => store.all("unknown_collection"), /Unknown collection/);
  }));
});
