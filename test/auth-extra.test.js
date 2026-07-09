const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_PASSWORD,
  createTestServer,
  loginAs,
  onePixelPng,
  request,
  sessionPayload,
} = require("../test-utils/helpers");

test("auth and user APIs validate credentials, privacy, and permissions", async (t) => {
  const ctx = await createTestServer();
  try {
    const adminToken = await loginAs(ctx, "10001");
    const studentToken = await loginAs(ctx, "11001");
    const secondStudentToken = await loginAs(ctx, "11002");

    await t.test("users/me requires a token", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/users/me");
      assert.equal(result.status, 401);
    });

    await t.test("users/me rejects unknown bearer tokens", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/users/me", undefined, "not-a-real-token");
      assert.equal(result.status, 401);
    });

    await t.test("logout requires a valid token", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/auth/logout", {});
      assert.equal(result.status, 401);
    });

    await t.test("student cannot list all users", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/users", undefined, studentToken);
      assert.equal(result.status, 403);
    });

    await t.test("anonymous user cannot list all users", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/users");
      assert.equal(result.status, 401);
    });

    await t.test("admin can list users and see auth fields", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/users", undefined, adminToken);
      assert.equal(result.status, 200);
      const user = result.payload.data.find((item) => item.id === "11001");
      assert.equal(user.student_no, "2314007");
      assert.equal(user.contact, "lijia@example.edu");
    });

    await t.test("student cannot read admin logs", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/admin/logs", undefined, studentToken);
      assert.equal(result.status, 403);
    });

    await t.test("admin can read admin logs", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/admin/logs", undefined, adminToken);
      assert.equal(result.status, 200);
      assert.ok(Array.isArray(result.payload.data));
    });

    await t.test("student cannot read admin dashboard stats", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/admin/stats", undefined, studentToken);
      assert.equal(result.status, 403);
    });

    await t.test("admin can read dashboard stats", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/admin/stats", undefined, adminToken);
      assert.equal(result.status, 200);
      assert.ok(result.payload.data.users >= 6);
    });

    const invalidLoginNicknames = [
      ["empty nickname", ""],
      ["one-character nickname", "A"],
      ["nickname with space", "Bad Name"],
      ["nickname with symbol", "Bad@Name"],
      ["too long nickname", "A".repeat(21)],
    ];
    for (const [name, nickname] of invalidLoginNicknames) {
      await t.test(`login rejects ${name}`, async () => {
        const result = await request(ctx.baseUrl, "POST", "/api/auth/login", { nickname, password: DEFAULT_PASSWORD });
        assert.equal(result.status, 400);
      });
    }

    const invalidLoginPasswords = [
      ["empty password", ""],
      ["short password", "a1b2c"],
      ["letters only", "abcdef"],
      ["numbers only", "123456"],
      ["password with space", "abc 123"],
      ["too long password", `abc123${"x".repeat(15)}`],
    ];
    for (const [name, password] of invalidLoginPasswords) {
      await t.test(`login rejects ${name}`, async () => {
        const result = await request(ctx.baseUrl, "POST", "/api/auth/login", { nickname: "Jiapu", password });
        assert.equal(result.status, 400);
      });
    }

    await t.test("login rejects wrong but well-formed password", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/auth/login", { nickname: "Jiapu", password: "abc123457" });
      assert.equal(result.status, 401);
    });

    await t.test("register trims a valid nickname", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/auth/register", {
        nickname: "  TrimName01  ",
        password: DEFAULT_PASSWORD,
      });
      assert.equal(result.status, 201);
      assert.equal(result.payload.data.user.nickname, "TrimName01");
      assert.equal(result.payload.data.user.auth_status, "unverified");
    });

    await t.test("register creates a token usable for current user", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/auth/register", {
        nickname: "FreshUser01",
        password: DEFAULT_PASSWORD,
      });
      assert.equal(result.status, 201);
      const me = await request(ctx.baseUrl, "GET", "/api/users/me", undefined, result.payload.data.token);
      assert.equal(me.status, 200);
      assert.equal(me.payload.data.nickname, "FreshUser01");
    });

    await t.test("newly registered student cannot publish before verification", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/auth/register", {
        nickname: "Unverified02",
        password: DEFAULT_PASSWORD,
      });
      const created = await request(ctx.baseUrl, "POST", "/api/sessions", sessionPayload({ daysFromNow: 30 }), result.payload.data.token);
      assert.equal(created.status, 403);
    });

    await t.test("register rejects duplicate nickname", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/auth/register", {
        nickname: "Jiapu",
        password: DEFAULT_PASSWORD,
      });
      assert.equal(result.status, 409);
    });

    const invalidRegisterNicknames = [
      ["one-character nickname", "B"],
      ["space in nickname", "Bad User"],
      ["symbol in nickname", "Bad.User"],
      ["too long nickname", "B".repeat(21)],
    ];
    for (const [name, nickname] of invalidRegisterNicknames) {
      await t.test(`register rejects ${name}`, async () => {
        const result = await request(ctx.baseUrl, "POST", "/api/auth/register", { nickname, password: DEFAULT_PASSWORD });
        assert.equal(result.status, 400);
      });
    }

    const invalidRegisterPasswords = [
      ["short password", "a1234"],
      ["letters only", "abcdefg"],
      ["numbers only", "1234567"],
      ["space in password", "abc123 456"],
      ["too long password", `abc123${"y".repeat(15)}`],
    ];
    for (const [name, password] of invalidRegisterPasswords) {
      await t.test(`register rejects ${name}`, async () => {
        const result = await request(ctx.baseUrl, "POST", "/api/auth/register", {
          nickname: `PassCase${Math.random().toString(16).slice(2, 8)}`,
          password,
        });
        assert.equal(result.status, 400);
      });
    }

    await t.test("profile update rejects duplicate nickname", async () => {
      const result = await request(ctx.baseUrl, "PUT", "/api/users/me", { nickname: "YanTong" }, studentToken);
      assert.equal(result.status, 409);
    });

    await t.test("profile update rejects avatar values outside the allow-list", async () => {
      const result = await request(ctx.baseUrl, "PUT", "/api/users/me", { avatar: "uploads/missing.png" }, studentToken);
      assert.equal(result.status, 400);
    });

    await t.test("profile update trims and limits tags", async () => {
      const result = await request(ctx.baseUrl, "PUT", "/api/users/me", {
        nickname: "Jiapu",
        tags: [" a ", "", "b", "c", "d", "e", "f", "g", "h", "i"],
      }, studentToken);
      assert.equal(result.status, 200);
      assert.deepEqual(result.payload.data.tags, ["a", "b", "c", "d", "e", "f", "g", "h"]);
    });

    await t.test("uploaded avatar can be selected again by profile update", async () => {
      const upload = await request(ctx.baseUrl, "POST", "/api/users/me/avatar", { image: onePixelPng() }, studentToken);
      assert.equal(upload.status, 200);
      const result = await request(ctx.baseUrl, "PUT", "/api/users/me", { avatar: upload.payload.data.avatar }, studentToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.avatar, upload.payload.data.avatar);
    });

    await t.test("avatar upload rejects invalid data urls", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/users/me/avatar", { image: "data:text/plain;base64,SGVsbG8=" }, studentToken);
      assert.equal(result.status, 400);
    });

    await t.test("public session detail masks host student number", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/sessions/s1");
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.host.student_no, "23****07");
      assert.equal(result.payload.data.host.contact, undefined);
    });

    await t.test("session host can see own auth contact in detail", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/sessions/s1", undefined, studentToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.host.student_no, "2314007");
      assert.equal(result.payload.data.host.contact, "lijia@example.edu");
    });

    await t.test("non-admin cannot change another account status", async () => {
      const result = await request(ctx.baseUrl, "PATCH", "/api/users/11002/status", { status: "limited" }, studentToken);
      assert.equal(result.status, 403);
    });

    await t.test("admin status change rejects unknown status", async () => {
      const result = await request(ctx.baseUrl, "PATCH", "/api/users/11002/status", { status: "sleeping" }, adminToken);
      assert.equal(result.status, 400);
    });

    await t.test("limited accounts cannot create sessions", async () => {
      const status = await request(ctx.baseUrl, "PATCH", "/api/users/11002/status", { status: "limited" }, adminToken);
      assert.equal(status.status, 200);
      const result = await request(ctx.baseUrl, "POST", "/api/sessions", sessionPayload({ daysFromNow: 31 }), secondStudentToken);
      assert.equal(result.status, 403);
    });

    await t.test("admin can restore a limited account", async () => {
      const result = await request(ctx.baseUrl, "PATCH", "/api/users/11002/status", { status: "active" }, adminToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.status, "active");
    });

    await t.test("banned account cannot keep using old token", async () => {
      const status = await request(ctx.baseUrl, "PATCH", "/api/users/11002/status", { status: "banned" }, adminToken);
      assert.equal(status.status, 200);
      const result = await request(ctx.baseUrl, "GET", "/api/users/me", undefined, secondStudentToken);
      assert.equal(result.status, 403);
    });

    await t.test("banned account cannot log in again", async () => {
      const user = ctx.app.store.get("users", "11002");
      const result = await request(ctx.baseUrl, "POST", "/api/auth/login", {
        nickname: user.nickname,
        password: DEFAULT_PASSWORD,
      });
      assert.equal(result.status, 403);
    });
  } finally {
    await ctx.close();
  }
});
