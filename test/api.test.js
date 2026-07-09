const assert = require("node:assert/strict");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createApp } = require("../src/app");
const { createHandler } = require("../src/router");

const LOGIN_NAMES = {
  2314007: "Jiapu",
  2313983: "YanTong",
  2313828: "Yuchen",
  2312194: "Lechen",
  2311987: "系统管理员",
  venue001: "社团空间管理员",
};
const DEFAULT_PASSWORD = "abc123456";

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

async function request(baseUrl, method, targetPath, body, token) {
  const response = await fetch(`${baseUrl}${targetPath}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

async function login(baseUrl, account, password = DEFAULT_PASSWORD) {
  const nickname = LOGIN_NAMES[account] || account;
  const { payload } = await request(baseUrl, "POST", "/api/auth/login", { nickname, password });
  assert.equal(payload.success, true);
  return payload.data.token;
}

function createFutureWindow(daysFromNow = 5, startHour = 19, durationHours = 3) {
  const start = new Date(Date.now() + daysFromNow * 24 * 3600 * 1000);
  start.setHours(startHour, 0, 0, 0);
  const end = new Date(start.getTime() + durationHours * 3600 * 1000);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

const ONE_PIXEL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axS5kAAAAAASUVORK5CYII=";

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

test("nickname password auth and student registration work", async () => {
  const ctx = await createTestServer();
  try {
    const wrongPassword = await request(ctx.baseUrl, "POST", "/api/auth/login", { nickname: "Jiapu", password: "wrong123" });
    assert.equal(wrongPassword.status, 401);

    const loginResult = await request(ctx.baseUrl, "POST", "/api/auth/login", { nickname: "Jiapu", password: DEFAULT_PASSWORD });
    assert.equal(loginResult.status, 200);
    assert.equal(loginResult.payload.data.user.nickname, "Jiapu");
    assert.equal(loginResult.payload.data.user.password_hash, undefined);

    const registered = await request(
      ctx.baseUrl,
      "POST",
      "/api/auth/register",
      { nickname: "NewPlayer01", password: "abc123456" },
    );
    assert.equal(registered.status, 201);
    assert.equal(registered.payload.data.user.role, "student");
    assert.equal(registered.payload.data.user.auth_status, "unverified");
    assert.equal(registered.payload.data.user.student_no, "");

    const stored = ctx.app.store.get("users", registered.payload.data.user.id);
    assert.ok(stored.password_hash.startsWith("scrypt$"));
    assert.equal(stored.password, undefined);
    assert.notEqual(stored.password_hash, "abc123456");

    const duplicate = await request(ctx.baseUrl, "POST", "/api/auth/register", { nickname: "NewPlayer01", password: "abc123456" });
    assert.equal(duplicate.status, 409);

    const weak = await request(ctx.baseUrl, "POST", "/api/auth/register", { nickname: "WeakPlayer", password: "123456" });
    assert.equal(weak.status, 400);
  } finally {
    await ctx.close();
  }
});

test("student can upload and keep a local avatar", async () => {
  const ctx = await createTestServer();
  try {
    const studentToken = await login(ctx.baseUrl, "2314007");

    const uploaded = await request(ctx.baseUrl, "POST", "/api/users/me/avatar", { image: ONE_PIXEL_PNG }, studentToken);
    assert.equal(uploaded.status, 200);
    assert.match(uploaded.payload.data.avatar, /^uploads\/11001-\d+\.png$/);

    const avatarPath = uploaded.payload.data.avatar;
    const imageResponse = await fetch(`${ctx.baseUrl}/profile_photo/${avatarPath}`);
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get("content-type"), "image/png");

    const saved = await request(
      ctx.baseUrl,
      "PUT",
      "/api/users/me",
      {
        nickname: "李佳璇",
        contact: "lijx@example.edu",
        tags: ["推理"],
        avatar: avatarPath,
      },
      studentToken,
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.payload.data.avatar, avatarPath);
  } finally {
    await ctx.close();
  }
});

test("session list supports tag filtering and recommendation ordering", async () => {
  const ctx = await createTestServer();
  try {
    const hostToken = await login(ctx.baseUrl, "2314007");
    const time = createFutureWindow(6, 20, 2);

    const create = await request(
      ctx.baseUrl,
      "POST",
      "/api/sessions",
      {
        game_id: "g1",
        title: "推荐排序测试阿瓦隆局",
        description: "用于验证热门和近期组局优先展示",
        start_time: time.start,
        end_time: time.end,
        venue_id: "v1",
        max_members: 7,
        min_credit_required: 80,
        join_mode: "direct",
      },
      hostToken,
    );
    assert.equal(create.status, 201);
    const createdId = create.payload.data.id;

    const tagged = await request(ctx.baseUrl, "GET", "/api/sessions?tag=%E6%8E%A8%E7%90%86");
    assert.equal(tagged.status, 200);
    assert.ok(tagged.payload.data.length >= 1);
    assert.equal(tagged.payload.data.every((session) => session.game_tags.includes("推理")), true);
    assert.equal(tagged.payload.data[0].id, createdId);
    assert.ok(tagged.payload.data[0].recommendation_score > 0);
    assert.ok(tagged.payload.data[0].recommendation_reasons.length > 0);
  } finally {
    await ctx.close();
  }
});

test("verified student can publish with selected venue and host can approve applications", async () => {
  const ctx = await createTestServer();
  try {
    const hostToken = await login(ctx.baseUrl, "2314007");
    const applicantToken = await login(ctx.baseUrl, "2313983");
    const time = createFutureWindow(5, 19, 3);

    const create = await request(
      ctx.baseUrl,
      "POST",
      "/api/sessions",
      {
        game_id: "g1",
        title: "测试阿瓦隆局",
        description: "接口测试创建",
        start_time: time.start,
        end_time: time.end,
        venue_id: "v1",
        max_members: 6,
        min_credit_required: 80,
        join_mode: "manual",
      },
      hostToken,
    );
    assert.equal(create.status, 201);
    assert.equal(create.payload.data.venue_status, "approved");
    assert.equal(create.payload.data.venue_reservation.status, "approved");
    const sessionId = create.payload.data.id;

    const apply = await request(ctx.baseUrl, "POST", `/api/sessions/${sessionId}/applications`, { message: "准时参加" }, applicantToken);
    assert.equal(apply.status, 201);
    assert.equal(apply.payload.data.status, "pending");

    const review = await request(ctx.baseUrl, "PATCH", `/api/applications/${apply.payload.data.id}`, { action: "approve" }, hostToken);
    assert.equal(review.status, 200);
    assert.equal(review.payload.data.status, "approved");

    const detail = await request(ctx.baseUrl, "GET", `/api/sessions/${sessionId}`, undefined, hostToken);
    assert.equal(detail.payload.data.current_members, 2);
    assert.equal(detail.payload.data.members.some((member) => member.user_id === "11002"), true);
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
    assert.equal(revise.payload.data.auth_submitted_at, firstSubmittedAt);

    const review = await request(
      ctx.baseUrl,
      "PATCH",
      "/api/users/11003/auth",
      { action: "approve", reason: "信息校验通过" },
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

test("admin can ban and unban user accounts", async () => {
  const ctx = await createTestServer();
  try {
    const adminToken = await login(ctx.baseUrl, "2311987");
    const studentToken = await login(ctx.baseUrl, "2313983");

    const selfBan = await request(
      ctx.baseUrl,
      "PATCH",
      "/api/users/10001/status",
      { status: "banned", reason: "误操作" },
      adminToken,
    );
    assert.equal(selfBan.status, 400);

    const banned = await request(
      ctx.baseUrl,
      "PATCH",
      "/api/users/11002/status",
      { status: "banned", reason: "测试封禁" },
      adminToken,
    );
    assert.equal(banned.status, 200);
    assert.equal(banned.payload.data.status, "banned");
    assert.equal(banned.payload.data.status_reason, "测试封禁");

    const loginAfterBan = await request(ctx.baseUrl, "POST", "/api/auth/login", { nickname: "YanTong", password: DEFAULT_PASSWORD });
    assert.equal(loginAfterBan.status, 403);

    const oldTokenMe = await request(ctx.baseUrl, "GET", "/api/users/me", undefined, studentToken);
    assert.equal(oldTokenMe.status, 403);

    const restored = await request(
      ctx.baseUrl,
      "PATCH",
      "/api/users/11002/status",
      { status: "active", reason: "复核通过" },
      adminToken,
    );
    assert.equal(restored.status, 200);
    assert.equal(restored.payload.data.status, "active");

    const loginAfterRestore = await request(ctx.baseUrl, "POST", "/api/auth/login", { nickname: "YanTong", password: DEFAULT_PASSWORD });
    assert.equal(loginAfterRestore.status, 200);
    assert.equal(loginAfterRestore.payload.data.user.status, "active");
  } finally {
    await ctx.close();
  }
});

test("admin can manage game library and inactive games are admin only", async () => {
  const ctx = await createTestServer();
  try {
    const adminToken = await login(ctx.baseUrl, "2311987");
    const studentToken = await login(ctx.baseUrl, "2314007");

    const anonymousInactive = await request(ctx.baseUrl, "GET", "/api/games?includeInactive=true");
    assert.equal(anonymousInactive.status, 401);

    const studentInactive = await request(ctx.baseUrl, "GET", "/api/games?includeInactive=true", undefined, studentToken);
    assert.equal(studentInactive.status, 403);

    const created = await request(
      ctx.baseUrl,
      "POST",
      "/api/games",
      {
        name: "谍影猎人",
        type: "桌游",
        min_players: 4,
        max_players: 8,
        duration_minutes: 60,
        difficulty: "新手",
        description: "适合轻量推理的聚会游戏",
        tags: ["推理", "新手"],
      },
      adminToken,
    );
    assert.equal(created.status, 201);
    const gameId = created.payload.data.id;

    const inactive = await request(ctx.baseUrl, "PATCH", `/api/games/${gameId}`, { status: "inactive" }, adminToken);
    assert.equal(inactive.status, 200);
    assert.equal(inactive.payload.data.status, "inactive");

    const publicGames = await request(ctx.baseUrl, "GET", "/api/games");
    assert.equal(publicGames.status, 200);
    assert.equal(publicGames.payload.data.some((game) => game.id === gameId), false);

    const adminGames = await request(ctx.baseUrl, "GET", "/api/games?includeInactive=true", undefined, adminToken);
    assert.equal(adminGames.status, 200);
    assert.equal(adminGames.payload.data.some((game) => game.id === gameId && game.status === "inactive"), true);

    const active = await request(ctx.baseUrl, "PATCH", `/api/games/${gameId}`, { status: "active" }, adminToken);
    assert.equal(active.status, 200);
    assert.equal(active.payload.data.status, "active");
  } finally {
    await ctx.close();
  }
});

test("venue admin can approve manual reservation and overlapping reservation is prevented", async () => {
  const ctx = await createTestServer();
  try {
    const hostToken = await login(ctx.baseUrl, "2314007");
    const secondHostToken = await login(ctx.baseUrl, "2313983");
    const venueToken = await login(ctx.baseUrl, "venue001");
    const time = createFutureWindow(7, 18, 3);

    const reservation = await request(
      ctx.baseUrl,
      "POST",
      "/api/venue-reservations",
      {
        session_id: "s1",
        venue_id: "v1",
        start_time: time.start,
        end_time: time.end,
        reason: "测试预约",
      },
      hostToken,
    );
    assert.equal(reservation.status, 201);
    assert.equal(reservation.payload.data.status, "pending");

    const approved = await request(
      ctx.baseUrl,
      "PATCH",
      `/api/venue-reservations/${reservation.payload.data.id}`,
      { action: "approve", reason: "场地可用" },
      venueToken,
    );
    assert.equal(approved.status, 200);
    assert.equal(approved.payload.data.status, "approved");

    const conflictRequest = await request(
      ctx.baseUrl,
      "POST",
      "/api/venue-reservations",
      {
        session_id: "s2",
        venue_id: "v1",
        start_time: new Date(new Date(time.start).getTime() + 60 * 60 * 1000).toISOString(),
        end_time: new Date(new Date(time.start).getTime() + 2 * 60 * 60 * 1000).toISOString(),
        reason: "冲突预约",
      },
      secondHostToken,
    );
    assert.equal(conflictRequest.status, 409);
    assert.equal(conflictRequest.payload.error.code, "CONFLICT");
  } finally {
    await ctx.close();
  }
});

test("publishing with selected venue blocks overlapping sessions", async () => {
  const ctx = await createTestServer();
  try {
    const firstHostToken = await login(ctx.baseUrl, "2314007");
    const secondHostToken = await login(ctx.baseUrl, "2313983");
    const firstTime = createFutureWindow(6, 19, 3);

    const first = await request(
      ctx.baseUrl,
      "POST",
      "/api/sessions",
      {
        game_id: "g1",
        title: "先占场地的局",
        start_time: firstTime.start,
        end_time: firstTime.end,
        venue_id: "v1",
        max_members: 6,
        join_mode: "manual",
      },
      firstHostToken,
    );
    assert.equal(first.status, 201);

    const second = await request(
      ctx.baseUrl,
      "POST",
      "/api/sessions",
      {
        game_id: "g2",
        title: "冲突场地局",
        start_time: new Date(new Date(firstTime.start).getTime() + 30 * 60 * 1000).toISOString(),
        end_time: new Date(new Date(firstTime.end).getTime() - 30 * 60 * 1000).toISOString(),
        venue_id: "v1",
        max_members: 4,
        join_mode: "direct",
      },
      secondHostToken,
    );
    assert.equal(second.status, 409);
    assert.equal(second.payload.error.code, "CONFLICT");
  } finally {
    await ctx.close();
  }
});

test("venue admin can create update and delete venue with cancellation cascade notifications", async () => {
  const ctx = await createTestServer();
  try {
    const venueToken = await login(ctx.baseUrl, "venue001");
    const hostToken = await login(ctx.baseUrl, "2314007");
    const applicantToken = await login(ctx.baseUrl, "2313983");
    const time = createFutureWindow(8, 14, 3);

    const createdVenue = await request(
      ctx.baseUrl,
      "POST",
      "/api/venues",
      {
        name: "测试活动室",
        location: "综合楼 401",
        capacity: 10,
        available_time: "周一至周日 09:00-22:00",
        open_rules: "需保持安静",
        description: "用于自动化测试",
      },
      venueToken,
    );
    assert.equal(createdVenue.status, 201);
    const venueId = createdVenue.payload.data.id;

    const updatedVenue = await request(
      ctx.baseUrl,
      "PATCH",
      `/api/venues/${venueId}`,
      {
        name: "测试活动室-更新",
        location: "综合楼 402",
        capacity: 10,
        status: "active",
        available_time: "周一至周日 10:00-21:00",
        open_rules: "需提前登记",
        description: "更新后的说明",
      },
      venueToken,
    );
    assert.equal(updatedVenue.status, 200);
    assert.equal(updatedVenue.payload.data.name, "测试活动室-更新");

    const createdSession = await request(
      ctx.baseUrl,
      "POST",
      "/api/sessions",
      {
        game_id: "g1",
        title: "等待被取消的组局",
        start_time: time.start,
        end_time: time.end,
        venue_id: venueId,
        max_members: 6,
        join_mode: "manual",
      },
      hostToken,
    );
    assert.equal(createdSession.status, 201);
    const sessionId = createdSession.payload.data.id;

    const apply = await request(
      ctx.baseUrl,
      "POST",
      `/api/sessions/${sessionId}/applications`,
      { message: "我先申请一下" },
      applicantToken,
    );
    assert.equal(apply.status, 201);

    const removed = await request(ctx.baseUrl, "DELETE", `/api/venues/${venueId}`, undefined, venueToken);
    assert.equal(removed.status, 200);
    assert.equal(removed.payload.data.deleted, true);

    const detail = await request(ctx.baseUrl, "GET", `/api/sessions/${sessionId}`, undefined, hostToken);
    assert.equal(detail.status, 200);
    assert.equal(detail.payload.data.status, "cancelled");
    assert.equal(detail.payload.data.venue_status, "cancelled");

    const hostReservations = await request(ctx.baseUrl, "GET", "/api/venue-reservations", undefined, hostToken);
    const cancelledReservation = hostReservations.payload.data.find((item) => item.session_id === sessionId);
    assert.ok(cancelledReservation);
    assert.equal(cancelledReservation.status, "cancelled");

    const hostNotifications = await request(ctx.baseUrl, "GET", "/api/notifications", undefined, hostToken);
    const applicantNotifications = await request(ctx.baseUrl, "GET", "/api/notifications", undefined, applicantToken);
    assert.equal(hostNotifications.payload.data.some((item) => item.title.includes("场地删除")), true);
    assert.equal(applicantNotifications.payload.data.some((item) => item.title.includes("场地删除")), true);
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
    const time = createFutureWindow(9, 18, 2);

    const create = await request(
      ctx.baseUrl,
      "POST",
      "/api/sessions",
      {
        game_id: "g1",
        title: "投诉测试局",
        start_time: time.start,
        end_time: time.end,
        venue_id: "v2",
        max_members: 6,
        join_mode: "direct",
      },
      hostToken,
    );
    assert.equal(create.status, 201);
    const sessionId = create.payload.data.id;

    const join = await request(ctx.baseUrl, "POST", `/api/sessions/${sessionId}/applications`, {}, studentToken);
    assert.equal(join.status, 201);

    const complaint = await request(
      ctx.baseUrl,
      "POST",
      "/api/complaints",
      {
        session_id: sessionId,
        target_user_id: "11001",
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

test("finished session members can review each other and credit changes", async () => {
  const ctx = await createTestServer();
  try {
    const hostToken = await login(ctx.baseUrl, "2314007");
    const studentToken = await login(ctx.baseUrl, "2313983");
    const adminToken = await login(ctx.baseUrl, "2311987");
    const time = createFutureWindow(10, 18, 2);

    const create = await request(
      ctx.baseUrl,
      "POST",
      "/api/sessions",
      {
        game_id: "g1",
        title: "互评测试局",
        start_time: time.start,
        end_time: time.end,
        venue_id: "v2",
        max_members: 6,
        join_mode: "direct",
      },
      hostToken,
    );
    assert.equal(create.status, 201);
    const sessionId = create.payload.data.id;

    const join = await request(ctx.baseUrl, "POST", `/api/sessions/${sessionId}/applications`, {}, studentToken);
    assert.equal(join.status, 201);

    const finish = await request(ctx.baseUrl, "POST", `/api/sessions/${sessionId}/finish`, {}, hostToken);
    assert.equal(finish.status, 200);
    assert.equal(finish.payload.data.status, "finished");

    const review = await request(
      ctx.baseUrl,
      "POST",
      `/api/sessions/${sessionId}/reviews`,
      { target_user_id: "11001", score: 5, content: "组织清楚，体验很好" },
      studentToken,
    );
    assert.equal(review.status, 201);
    assert.equal(review.payload.data.score, 5);

    const duplicate = await request(
      ctx.baseUrl,
      "POST",
      `/api/sessions/${sessionId}/reviews`,
      { target_user_id: "11001", score: 4, content: "重复评价" },
      studentToken,
    );
    assert.equal(duplicate.status, 409);

    const detail = await request(ctx.baseUrl, "GET", `/api/sessions/${sessionId}`, undefined, studentToken);
    assert.equal(detail.status, 200);
    assert.equal(detail.payload.data.reviews.length, 1);
    assert.equal(detail.payload.data.reviews[0].reviewer_id, "11002");
    assert.equal(detail.payload.data.reviews[0].target_user_id, "11001");

    const hostCredit = await request(ctx.baseUrl, "GET", "/api/users/me/credit", undefined, hostToken);
    assert.equal(hostCredit.payload.data.user.credit_score, 101);
    assert.equal(hostCredit.payload.data.records[0].change_value, 1);

    const lowReview = await request(
      ctx.baseUrl,
      "POST",
      `/api/sessions/${sessionId}/reviews`,
      { target_user_id: "11002", score: 2, content: "到场沟通不充分" },
      hostToken,
    );
    assert.equal(lowReview.status, 201);

    const studentCredit = await request(ctx.baseUrl, "GET", "/api/users/me/credit", undefined, studentToken);
    assert.equal(studentCredit.payload.data.user.credit_score, 94);
    assert.equal(studentCredit.payload.data.records[0].change_value, -2);

    const publicDetail = await request(ctx.baseUrl, "GET", `/api/sessions/${sessionId}`);
    assert.equal(publicDetail.status, 200);
    assert.equal(publicDetail.payload.data.reviews.length, 0);

    const studentDetail = await request(ctx.baseUrl, "GET", `/api/sessions/${sessionId}`, undefined, studentToken);
    assert.equal(studentDetail.status, 200);
    assert.equal(studentDetail.payload.data.reviews.length, 2);

    const adminDetail = await request(ctx.baseUrl, "GET", `/api/sessions/${sessionId}`, undefined, adminToken);
    assert.equal(adminDetail.status, 200);
    assert.equal(adminDetail.payload.data.reviews.length, 2);
  } finally {
    await ctx.close();
  }
});
