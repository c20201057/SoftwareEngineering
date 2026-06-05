const assert = require("node:assert/strict");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createApp } = require("../src/app");
const { createHandler } = require("../src/router");

async function createTestServer() {
  const dataDir = path.join(os.tmpdir(), `campus-gather-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const app = createApp({ dataDir, resetOnStart: true });
  const server = http.createServer(createHandler(app));
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    app,
    baseUrl,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function request(baseUrl, method, path, body, token) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json();
  return { status: res.status, payload };
}

async function login(baseUrl, studentNo) {
  const { payload } = await request(baseUrl, "POST", "/api/auth/login", { student_no: studentNo });
  assert.equal(payload.success, true);
  return payload.data.token;
}

test("health and public session list work", async () => {
  const ctx = await createTestServer();
  try {
    const health = await request(ctx.baseUrl, "GET", "/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.payload.data.status, "ok");

    const sessions = await request(ctx.baseUrl, "GET", "/api/sessions");
    assert.equal(sessions.status, 200);
    assert.ok(sessions.payload.data.length >= 2);
  } finally {
    await ctx.close();
  }
});

test("verified student can publish and another student can apply then host approves", async () => {
  const ctx = await createTestServer();
  try {
    const hostToken = await login(ctx.baseUrl, "2314007");
    const applicantToken = await login(ctx.baseUrl, "2313983");

    const start = new Date(Date.now() + 5 * 24 * 3600 * 1000);
    const end = new Date(start.getTime() + 3 * 3600 * 1000);
    const create = await request(
      ctx.baseUrl,
      "POST",
      "/api/sessions",
      {
        game_id: "g1",
        title: "测试阿瓦隆局",
        description: "接口测试创建",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        location: "测试教室",
        max_members: 6,
        min_credit_required: 80,
        join_mode: "manual",
      },
      hostToken,
    );
    assert.equal(create.status, 201);
    const sessionId = create.payload.data.id;

    const apply = await request(ctx.baseUrl, "POST", `/api/sessions/${sessionId}/applications`, { message: "准时参加" }, applicantToken);
    assert.equal(apply.status, 201);
    assert.equal(apply.payload.data.status, "pending");

    const review = await request(ctx.baseUrl, "PATCH", `/api/applications/${apply.payload.data.id}`, { action: "approve" }, hostToken);
    assert.equal(review.status, 200);
    assert.equal(review.payload.data.status, "approved");

    const detail = await request(ctx.baseUrl, "GET", `/api/sessions/${sessionId}`, undefined, hostToken);
    assert.equal(detail.payload.data.current_members, 2);
    assert.equal(detail.payload.data.members.some((member) => member.user_id === "u2"), true);
  } finally {
    await ctx.close();
  }
});

test("pending auth user cannot apply", async () => {
  const ctx = await createTestServer();
  try {
    const pendingToken = await login(ctx.baseUrl, "2313828");
    const apply = await request(ctx.baseUrl, "POST", "/api/sessions/s1/applications", { message: "想参加" }, pendingToken);
    assert.equal(apply.status, 403);
    assert.equal(apply.payload.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("student can submit auth request and admin approval unlocks join flow", async () => {
  const ctx = await createTestServer();
  try {
    const studentToken = await login(ctx.baseUrl, "2313828");
    const adminToken = await login(ctx.baseUrl, "2311987");

    const submit = await request(
      ctx.baseUrl,
      "POST",
      "/api/users/me/auth",
      {
        real_name: "苏雨辰",
        student_no: "2313828",
        contact: "suyc@example.edu",
        note: "提交学生证与学院信息",
      },
      studentToken,
    );
    assert.equal(submit.status, 200);
    assert.equal(submit.payload.data.auth_status, "pending");
    assert.equal(submit.payload.data.auth_submission.real_name, "苏雨辰");
    const firstSubmittedAt = submit.payload.data.auth_submitted_at;

    const revise = await request(
      ctx.baseUrl,
      "POST",
      "/api/users/me/auth",
      {
        real_name: "苏雨辰",
        student_no: "2313828",
        contact: "suyc@example.edu",
        note: "补充学院与班级信息",
      },
      studentToken,
    );
    assert.equal(revise.status, 200);
    assert.equal(revise.payload.data.auth_status, "pending");
    assert.equal(revise.payload.data.auth_submission.note, "补充学院与班级信息");
    assert.equal(revise.payload.data.auth_submitted_at, firstSubmittedAt);

    const review = await request(
      ctx.baseUrl,
      "PATCH",
      "/api/users/u3/auth",
      { action: "approve", reason: "信息核验通过" },
      adminToken,
    );
    assert.equal(review.status, 200);
    assert.equal(review.payload.data.auth_status, "verified");

    const apply = await request(ctx.baseUrl, "POST", "/api/sessions/s1/applications", { message: "认证后报名" }, studentToken);
    assert.equal(apply.status, 201);
  } finally {
    await ctx.close();
  }
});

test("venue admin can approve reservation and conflict is prevented", async () => {
  const ctx = await createTestServer();
  try {
    const hostToken = await login(ctx.baseUrl, "2314007");
    const venueToken = await login(ctx.baseUrl, "venue001");

    const reservation = await request(
      ctx.baseUrl,
      "POST",
      "/api/venue-reservations",
      {
        session_id: "s1",
        venue_id: "v1",
        start_time: "2026-06-07T19:00:00.000Z",
        end_time: "2026-06-07T22:00:00.000Z",
        reason: "测试预约",
      },
      hostToken,
    );
    assert.equal(reservation.status, 201);

    const approved = await request(ctx.baseUrl, "PATCH", `/api/venue-reservations/${reservation.payload.data.id}`, { action: "approve", reason: "可用" }, venueToken);
    assert.equal(approved.status, 200);
    assert.equal(approved.payload.data.status, "approved");

    const second = await request(
      ctx.baseUrl,
      "POST",
      "/api/venue-reservations",
      {
        session_id: "s2",
        venue_id: "v1",
        start_time: "2026-06-07T20:00:00.000Z",
        end_time: "2026-06-07T21:00:00.000Z",
        reason: "冲突预约",
      },
      await login(ctx.baseUrl, "2313983"),
    );
    assert.equal(second.status, 409);
    assert.equal(second.payload.error.code, "CONFLICT");
  } finally {
    await ctx.close();
  }
});

test("admin handles complaint and credit score changes", async () => {
  const ctx = await createTestServer();
  try {
    const hostToken = await login(ctx.baseUrl, "2314007");
    const studentToken = await login(ctx.baseUrl, "2313983");
    const adminToken = await login(ctx.baseUrl, "2311987");

    const start = new Date(Date.now() + 6 * 24 * 3600 * 1000);
    const end = new Date(start.getTime() + 2 * 3600 * 1000);
    const create = await request(
      ctx.baseUrl,
      "POST",
      "/api/sessions",
      {
        game_id: "g1",
        title: "投诉测试局",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        location: "测试地点",
        max_members: 6,
        join_mode: "direct",
      },
      hostToken,
    );
    const sessionId = create.payload.data.id;
    await request(ctx.baseUrl, "POST", `/api/sessions/${sessionId}/applications`, {}, studentToken);

    const complaint = await request(
      ctx.baseUrl,
      "POST",
      "/api/complaints",
      {
        session_id: sessionId,
        target_user_id: "u1",
        reason: "活动描述不清晰",
        evidence: "测试证据",
      },
      studentToken,
    );
    assert.equal(complaint.status, 201);

    const handled = await request(
      ctx.baseUrl,
      "PATCH",
      `/api/complaints/${complaint.payload.data.id}`,
      { action: "accept", result: "投诉成立", credit_change: -8 },
      adminToken,
    );
    assert.equal(handled.status, 200);
    assert.equal(handled.payload.data.status, "finished");

    const credit = await request(ctx.baseUrl, "GET", "/api/users/me/credit", undefined, hostToken);
    assert.equal(credit.payload.data.user.credit_score, 92);
    assert.equal(credit.payload.data.records[0].change_value, -8);
  } finally {
    await ctx.close();
  }
});
