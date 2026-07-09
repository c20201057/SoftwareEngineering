const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createFutureWindow,
  createTestServer,
  loginAs,
  markSessionStarted,
  request,
  sessionPayload,
} = require("../test-utils/helpers");

test("session APIs cover validation, membership, lifecycle, reviews, and pagination", async (t) => {
  const ctx = await createTestServer();
  let nextDay = 40;
  const nextSessionPayload = (overrides = {}) => {
    nextDay += 1;
    return sessionPayload({ daysFromNow: nextDay, ...overrides });
  };

  async function createSession(token, overrides = {}) {
    const result = await request(ctx.baseUrl, "POST", "/api/sessions", nextSessionPayload(overrides), token);
    assert.equal(result.status, 201);
    return result.payload.data;
  }

  try {
    const hostToken = await loginAs(ctx, "11001");
    const secondToken = await loginAs(ctx, "11002");
    const pendingToken = await loginAs(ctx, "11003");
    const lowCreditToken = await loginAs(ctx, "11004");
    const adminToken = await loginAs(ctx, "10001");

    await t.test("anonymous users cannot create sessions", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/sessions", nextSessionPayload());
      assert.equal(result.status, 401);
    });

    await t.test("pending-auth users cannot create sessions", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/sessions", nextSessionPayload(), pendingToken);
      assert.equal(result.status, 403);
    });

    await t.test("create session requires game id", async () => {
      const payload = nextSessionPayload();
      delete payload.game_id;
      const result = await request(ctx.baseUrl, "POST", "/api/sessions", payload, hostToken);
      assert.equal(result.status, 400);
    });

    await t.test("create session rejects missing venue", async () => {
      const payload = nextSessionPayload();
      delete payload.venue_id;
      const result = await request(ctx.baseUrl, "POST", "/api/sessions", payload, hostToken);
      assert.equal(result.status, 400);
    });

    await t.test("create session rejects unknown game", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/sessions", nextSessionPayload({ game_id: "missing-game" }), hostToken);
      assert.equal(result.status, 404);
    });

    await t.test("create session rejects inactive game", async () => {
      const inactive = await request(ctx.baseUrl, "PATCH", "/api/games/g3", { status: "inactive" }, adminToken);
      assert.equal(inactive.status, 200);
      const result = await request(ctx.baseUrl, "POST", "/api/sessions", nextSessionPayload({ game_id: "g3", max_members: 6 }), hostToken);
      assert.equal(result.status, 404);
      const active = await request(ctx.baseUrl, "PATCH", "/api/games/g3", { status: "active" }, adminToken);
      assert.equal(active.status, 200);
    });

    await t.test("create session rejects end time before start time", async () => {
      const time = createFutureWindow(nextDay += 1, 18, 2);
      const result = await request(ctx.baseUrl, "POST", "/api/sessions", nextSessionPayload({
        start_time: time.end,
        end_time: time.start,
      }), hostToken);
      assert.equal(result.status, 400);
    });

    await t.test("create session rejects past start time", async () => {
      const start = new Date(Date.now() - 3600 * 1000).toISOString();
      const end = new Date(Date.now() + 3600 * 1000).toISOString();
      const result = await request(ctx.baseUrl, "POST", "/api/sessions", nextSessionPayload({ start_time: start, end_time: end }), hostToken);
      assert.equal(result.status, 400);
    });

    await t.test("create session rejects max below game minimum", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/sessions", nextSessionPayload({ max_members: 4 }), hostToken);
      assert.equal(result.status, 400);
    });

    await t.test("create session rejects max above game maximum", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/sessions", nextSessionPayload({ max_members: 11 }), hostToken);
      assert.equal(result.status, 400);
    });

    await t.test("create session rejects invalid join mode", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/sessions", nextSessionPayload({ join_mode: "invite" }), hostToken);
      assert.equal(result.status, 400);
    });

    await t.test("create session rejects unknown venue", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/sessions", nextSessionPayload({ venue_id: "missing-venue" }), hostToken);
      assert.equal(result.status, 404);
    });

    await t.test("create session rejects venue capacity overflow", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/sessions", nextSessionPayload({ venue_id: "v2", max_members: 10 }), hostToken);
      assert.equal(result.status, 409);
    });

    let reservedSession;
    await t.test("valid create locks the selected venue", async () => {
      reservedSession = await createSession(hostToken, { venue_id: "v1", max_members: 6 });
      assert.equal(reservedSession.venue_status, "approved");
      assert.equal(reservedSession.venue_reservation.status, "approved");
    });

    await t.test("overlapping selected venue is rejected", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/sessions", sessionPayload({
        start_time: reservedSession.start_time,
        end_time: reservedSession.end_time,
        venue_id: "v1",
      }), secondToken);
      assert.equal(result.status, 409);
    });

    await t.test("non-host cannot update a session", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/sessions/${reservedSession.id}`, { title: "Nope" }, secondToken);
      assert.equal(result.status, 403);
    });

    await t.test("host cannot shrink max members below current count", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/sessions/${reservedSession.id}`, { max_members: 0 }, hostToken);
      assert.equal(result.status, 400);
    });

    await t.test("host can update session title and time", async () => {
      const time = createFutureWindow(nextDay += 1, 20, 2);
      const result = await request(ctx.baseUrl, "PATCH", `/api/sessions/${reservedSession.id}`, {
        title: "Updated automated title",
        start_time: time.start,
        end_time: time.end,
      }, hostToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.title, "Updated automated title");
    });

    await t.test("session mine requires login", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/sessions/mine");
      assert.equal(result.status, 401);
    });

    await t.test("session mine includes hosted sessions", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/sessions/mine", undefined, hostToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.some((item) => item.id === reservedSession.id), true);
    });

    await t.test("direct join adds a member immediately", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/sessions/s2/applications", {}, hostToken);
      assert.equal(result.status, 201);
      assert.equal(result.payload.data.members.some((member) => member.user_id === "11001"), true);
    });

    await t.test("direct join rejects duplicate membership", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/sessions/s2/applications", {}, hostToken);
      assert.equal(result.status, 409);
    });

    await t.test("member can leave before start", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/sessions/s2/leave", { reason: "schedule changed" }, hostToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.left, true);
    });

    await t.test("host cannot leave own session", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/sessions/s1/leave", {}, hostToken);
      assert.equal(result.status, 403);
    });

    let manualApplication;
    await t.test("manual apply creates a pending application", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/sessions/s1/applications", { message: "join please" }, secondToken);
      assert.equal(result.status, 201);
      assert.equal(result.payload.data.status, "pending");
      manualApplication = result.payload.data;
    });

    await t.test("manual apply rejects duplicate pending application", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/sessions/s1/applications", { message: "again" }, secondToken);
      assert.equal(result.status, 409);
    });

    await t.test("non-host cannot review an application", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/applications/${manualApplication.id}`, { action: "approve" }, secondToken);
      assert.equal(result.status, 403);
    });

    await t.test("host review rejects invalid application action", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/applications/${manualApplication.id}`, { action: "maybe" }, hostToken);
      assert.equal(result.status, 400);
    });

    await t.test("host can reject a manual application", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/applications/${manualApplication.id}`, { action: "reject", reason: "full enough" }, hostToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.status, "rejected");
    });

    await t.test("reviewed application cannot be reviewed again", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/applications/${manualApplication.id}`, { action: "approve" }, hostToken);
      assert.equal(result.status, 409);
    });

    let approvedApplication;
    await t.test("applicant can apply again after rejection", async () => {
      const apply = await request(ctx.baseUrl, "POST", "/api/sessions/s1/applications", { message: "second try" }, secondToken);
      assert.equal(apply.status, 201);
      approvedApplication = apply.payload.data;
    });

    await t.test("host can approve a later application", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/applications/${approvedApplication.id}`, { action: "approve" }, hostToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.status, "approved");
    });

    await t.test("approved applicant appears in session members", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/sessions/s1", undefined, hostToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.members.some((member) => member.user_id === "11002"), true);
    });

    await t.test("low credit user cannot apply above threshold", async () => {
      ctx.app.store.update("users", "11004", { auth_status: "verified", credit_score: 50 });
      const result = await request(ctx.baseUrl, "POST", "/api/sessions/s1/applications", { message: "low credit" }, lowCreditToken);
      assert.equal(result.status, 403);
    });

    await t.test("time conflicts prevent joining another active session", async () => {
      const s2 = ctx.app.store.get("game_sessions", "s2");
      const overlapping = await createSession(hostToken, {
        start_time: s2.start_time,
        end_time: s2.end_time,
        venue_id: "v1",
        join_mode: "manual",
      });
      const result = await request(ctx.baseUrl, "POST", `/api/sessions/${overlapping.id}/applications`, {}, secondToken);
      assert.equal(result.status, 409);
    });

    await t.test("host cannot apply to own session", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/sessions/s1/applications", {}, hostToken);
      assert.equal(result.status, 409);
    });

    let startedSession;
    await t.test("started recruiting session disappears from hall", async () => {
      startedSession = await createSession(hostToken, { join_mode: "direct", venue_id: "v2", max_members: 6 });
      const joined = await request(ctx.baseUrl, "POST", `/api/sessions/${startedSession.id}/applications`, {}, secondToken);
      assert.equal(joined.status, 201);
      markSessionStarted(ctx.app, startedSession.id);
      const hall = await request(ctx.baseUrl, "GET", "/api/sessions");
      assert.equal(hall.status, 200);
      assert.equal(hall.payload.data.some((item) => item.id === startedSession.id), false);
    });

    await t.test("started session cannot be edited", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/sessions/${startedSession.id}`, { title: "Too late" }, hostToken);
      assert.equal(result.status, 409);
    });

    await t.test("started session cannot accept more applications", async () => {
      const result = await request(ctx.baseUrl, "POST", `/api/sessions/${startedSession.id}/applications`, {}, lowCreditToken);
      assert.equal(result.status, 409);
    });

    await t.test("started session cannot be left", async () => {
      const result = await request(ctx.baseUrl, "POST", `/api/sessions/${startedSession.id}/leave`, {}, secondToken);
      assert.equal(result.status, 409);
    });

    await t.test("started session cannot be cancelled", async () => {
      const result = await request(ctx.baseUrl, "POST", `/api/sessions/${startedSession.id}/cancel`, { reason: "late" }, hostToken);
      assert.equal(result.status, 409);
    });

    await t.test("non-host cannot mark a session finished", async () => {
      const result = await request(ctx.baseUrl, "POST", `/api/sessions/${startedSession.id}/finish`, {}, secondToken);
      assert.equal(result.status, 403);
    });

    await t.test("host can mark started session finished", async () => {
      const result = await request(ctx.baseUrl, "POST", `/api/sessions/${startedSession.id}/finish`, {}, hostToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.status, "finished");
    });

    await t.test("finished session cannot be finished again", async () => {
      const result = await request(ctx.baseUrl, "POST", `/api/sessions/${startedSession.id}/finish`, {}, hostToken);
      assert.equal(result.status, 409);
    });

    await t.test("review rejects self review", async () => {
      const result = await request(ctx.baseUrl, "POST", `/api/sessions/${startedSession.id}/reviews`, {
        target_user_id: "11001",
        score: 5,
      }, hostToken);
      assert.equal(result.status, 400);
    });

    await t.test("review rejects non-member target", async () => {
      const result = await request(ctx.baseUrl, "POST", `/api/sessions/${startedSession.id}/reviews`, {
        target_user_id: "11004",
        score: 5,
      }, hostToken);
      assert.equal(result.status, 400);
    });

    await t.test("review rejects invalid scores", async () => {
      const result = await request(ctx.baseUrl, "POST", `/api/sessions/${startedSession.id}/reviews`, {
        target_user_id: "11002",
        score: 6,
      }, hostToken);
      assert.equal(result.status, 400);
    });

    await t.test("member can review another finished-session member", async () => {
      const result = await request(ctx.baseUrl, "POST", `/api/sessions/${startedSession.id}/reviews`, {
        target_user_id: "11002",
        score: 4,
        content: "good teammate",
      }, hostToken);
      assert.equal(result.status, 201);
      assert.equal(result.payload.data.score, 4);
    });

    await t.test("duplicate review for same target is rejected", async () => {
      const result = await request(ctx.baseUrl, "POST", `/api/sessions/${startedSession.id}/reviews`, {
        target_user_id: "11002",
        score: 5,
      }, hostToken);
      assert.equal(result.status, 409);
    });

    await t.test("public detail hides finished-session reviews", async () => {
      const result = await request(ctx.baseUrl, "GET", `/api/sessions/${startedSession.id}`);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.reviews.length, 0);
    });

    await t.test("member detail shows reviews related to self", async () => {
      const result = await request(ctx.baseUrl, "GET", `/api/sessions/${startedSession.id}`, undefined, secondToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.reviews.length, 1);
      assert.equal(result.payload.data.reviews[0].target_user_id, "11002");
    });

    await t.test("admin detail shows all reviews", async () => {
      const result = await request(ctx.baseUrl, "GET", `/api/sessions/${startedSession.id}`, undefined, adminToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.reviews.length, 1);
    });

    let failedSession;
    await t.test("fail before start is rejected", async () => {
      failedSession = await createSession(hostToken, { join_mode: "direct", venue_id: "v2", max_members: 6 });
      const result = await request(ctx.baseUrl, "POST", `/api/sessions/${failedSession.id}/fail`, {}, hostToken);
      assert.equal(result.status, 409);
    });

    await t.test("host can mark started session failed", async () => {
      markSessionStarted(ctx.app, failedSession.id);
      const result = await request(ctx.baseUrl, "POST", `/api/sessions/${failedSession.id}/fail`, { reason: "not enough members" }, hostToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.status, "failed");
      assert.equal(result.payload.data.venue_status, "cancelled");
    });

    await t.test("failed session does not allow reviews", async () => {
      const result = await request(ctx.baseUrl, "POST", `/api/sessions/${failedSession.id}/reviews`, {
        target_user_id: "11002",
        score: 5,
      }, hostToken);
      assert.equal(result.status, 409);
    });

    await t.test("default hall list returns array for compatibility", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/sessions");
      assert.equal(result.status, 200);
      assert.equal(Array.isArray(result.payload.data), true);
    });

    await t.test("paginated hall returns metadata", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/sessions?page=1&pageSize=2");
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.page, 1);
      assert.equal(result.payload.data.page_size, 2);
      assert.ok(Array.isArray(result.payload.data.items));
    });

    await t.test("pagination clamps invalid values", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/sessions?page=-9&pageSize=999");
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.page, 1);
      assert.equal(result.payload.data.page_size, 50);
    });

    await t.test("status empty can list non-recruiting sessions too", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/sessions?status=");
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.some((item) => item.id === startedSession.id && item.status === "finished"), true);
      assert.equal(result.payload.data.some((item) => item.id === failedSession.id && item.status === "failed"), true);
    });
  } finally {
    await ctx.close();
  }
});
