const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createTestServer,
  loginAs,
  request,
  sessionPayload,
} = require("../test-utils/helpers");

test("complaints, notifications, credit records, and stats work together", async (t) => {
  const ctx = await createTestServer();
  try {
    const hostToken = await loginAs(ctx, "11001");
    const memberToken = await loginAs(ctx, "11002");
    const pendingToken = await loginAs(ctx, "11003");
    const outsiderToken = await loginAs(ctx, "11004");
    const adminToken = await loginAs(ctx, "10001");
    ctx.app.store.update("users", "11004", { auth_status: "verified" });

    await t.test("notification list requires login", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/notifications");
      assert.equal(result.status, 401);
    });

    await t.test("fresh user notification list starts empty", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/notifications", undefined, hostToken);
      assert.equal(result.status, 200);
      assert.deepEqual(result.payload.data, []);
    });

    await t.test("marking a missing notification returns null", async () => {
      const result = await request(ctx.baseUrl, "PATCH", "/api/notifications/missing", {}, hostToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data, null);
    });

    let hostNotification;
    await t.test("created notifications appear in unread list", async () => {
      hostNotification = ctx.app.services.notificationService.create("11001", {
        type: "system",
        title: "Test notice",
        content: "A test notification",
      });
      const result = await request(ctx.baseUrl, "GET", "/api/notifications?unread=true", undefined, hostToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.some((item) => item.id === hostNotification.id), true);
    });

    await t.test("users cannot mark another user's notification read", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/notifications/${hostNotification.id}`, {}, memberToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data, null);
    });

    await t.test("notification owner can mark notification read", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/notifications/${hostNotification.id}`, {}, hostToken);
      assert.equal(result.status, 200);
      assert.ok(result.payload.data.read_at);
    });

    await t.test("read notifications are excluded by unread filter", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/notifications?unread=true", undefined, hostToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.some((item) => item.id === hostNotification.id), false);
    });

    let sessionId;
    await t.test("create a direct session for complaint scenarios", async () => {
      const created = await request(ctx.baseUrl, "POST", "/api/sessions", sessionPayload({
        daysFromNow: 90,
        venue_id: "v1",
        join_mode: "direct",
        max_members: 6,
      }), hostToken);
      assert.equal(created.status, 201);
      sessionId = created.payload.data.id;
      const joined = await request(ctx.baseUrl, "POST", `/api/sessions/${sessionId}/applications`, {}, memberToken);
      assert.equal(joined.status, 201);
    });

    await t.test("complaint list requires login", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/complaints");
      assert.equal(result.status, 401);
    });

    await t.test("complaint creation requires login", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/complaints", {
        session_id: sessionId,
        target_user_id: "11001",
        reason: "late",
      });
      assert.equal(result.status, 401);
    });

    await t.test("pending-auth users cannot create complaints", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/complaints", {
        session_id: sessionId,
        target_user_id: "11001",
        reason: "late",
      }, pendingToken);
      assert.equal(result.status, 403);
    });

    await t.test("complaint creation requires reason", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/complaints", {
        session_id: sessionId,
        target_user_id: "11002",
      }, hostToken);
      assert.equal(result.status, 400);
    });

    await t.test("non-members cannot submit complaints for a session", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/complaints", {
        session_id: sessionId,
        target_user_id: "11001",
        reason: "not a member",
      }, outsiderToken);
      assert.equal(result.status, 403);
    });

    await t.test("complaint target must be a session member", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/complaints", {
        session_id: sessionId,
        target_user_id: "11004",
        reason: "not a member target",
      }, hostToken);
      assert.equal(result.status, 400);
    });

    await t.test("users cannot complain about themselves", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/complaints", {
        session_id: sessionId,
        target_user_id: "11001",
        reason: "self",
      }, hostToken);
      assert.equal(result.status, 400);
    });

    let firstComplaint;
    await t.test("member can submit a valid complaint", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/complaints", {
        session_id: sessionId,
        target_user_id: "11001",
        reason: "unclear organization",
        evidence: "chat screenshot",
      }, memberToken);
      assert.equal(result.status, 201);
      assert.equal(result.payload.data.status, "pending");
      firstComplaint = result.payload.data;
    });

    await t.test("complaint notifies active admins", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/notifications?unread=true", undefined, adminToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.some((item) => item.related_id === firstComplaint.id), true);
    });

    await t.test("reporter can see own complaint", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/complaints", undefined, memberToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.some((item) => item.id === firstComplaint.id), true);
    });

    await t.test("target user can see complaint against self", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/complaints", undefined, hostToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.some((item) => item.id === firstComplaint.id), true);
    });

    await t.test("unrelated students cannot see other complaints", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/complaints", undefined, outsiderToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.some((item) => item.id === firstComplaint.id), false);
    });

    await t.test("admin can filter pending complaints", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/complaints?status=pending", undefined, adminToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.some((item) => item.id === firstComplaint.id), true);
    });

    await t.test("non-admin cannot handle complaints", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/complaints/${firstComplaint.id}`, {
        action: "reject",
      }, memberToken);
      assert.equal(result.status, 403);
    });

    await t.test("complaint handling rejects invalid action", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/complaints/${firstComplaint.id}`, {
        action: "delay",
      }, adminToken);
      assert.equal(result.status, 400);
    });

    await t.test("accepted complaint cannot add positive credit", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/complaints/${firstComplaint.id}`, {
        action: "accept",
        credit_change: 5,
        result: "bad credit change",
      }, adminToken);
      assert.equal(result.status, 400);
    });

    await t.test("admin can request more evidence", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/complaints/${firstComplaint.id}`, {
        action: "need_more",
        result: "need more evidence",
      }, adminToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.status, "need_more");
    });

    await t.test("need-more complaint cannot be handled again by current rules", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/complaints/${firstComplaint.id}`, {
        action: "reject",
      }, adminToken);
      assert.equal(result.status, 409);
    });

    let rejectedComplaint;
    await t.test("create a second complaint for rejection flow", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/complaints", {
        session_id: sessionId,
        target_user_id: "11002",
        reason: "communication issue",
      }, hostToken);
      assert.equal(result.status, 201);
      rejectedComplaint = result.payload.data;
    });

    await t.test("admin can reject a complaint", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/complaints/${rejectedComplaint.id}`, {
        action: "reject",
        result: "not enough evidence",
      }, adminToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.status, "rejected");
    });

    await t.test("rejected complaint sends result notifications", async () => {
      const reporter = await request(ctx.baseUrl, "GET", "/api/notifications", undefined, hostToken);
      const target = await request(ctx.baseUrl, "GET", "/api/notifications", undefined, memberToken);
      assert.equal(reporter.payload.data.some((item) => item.related_id === rejectedComplaint.id), true);
      assert.equal(target.payload.data.some((item) => item.related_id === rejectedComplaint.id), true);
    });

    let acceptedComplaint;
    await t.test("create a third complaint for accepted flow", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/complaints", {
        session_id: sessionId,
        target_user_id: "11001",
        reason: "late arrival",
      }, memberToken);
      assert.equal(result.status, 201);
      acceptedComplaint = result.payload.data;
    });

    await t.test("admin can accept a complaint with default credit penalty", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/complaints/${acceptedComplaint.id}`, {
        action: "accept",
        result: "complaint accepted",
      }, adminToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.status, "finished");
    });

    await t.test("accepted complaint deducts target credit", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/users/me/credit", undefined, hostToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.user.credit_score, 90);
      assert.equal(result.payload.data.records.some((record) => record.complaint_id === acceptedComplaint.id && record.change_value === -10), true);
    });

    await t.test("credit endpoint requires login", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/users/me/credit");
      assert.equal(result.status, 401);
    });

    await t.test("accepted complaint sends result notifications", async () => {
      const reporter = await request(ctx.baseUrl, "GET", "/api/notifications", undefined, memberToken);
      const target = await request(ctx.baseUrl, "GET", "/api/notifications", undefined, hostToken);
      assert.equal(reporter.payload.data.some((item) => item.related_id === acceptedComplaint.id), true);
      assert.equal(target.payload.data.some((item) => item.related_id === acceptedComplaint.id), true);
    });

    await t.test("admin logs include complaint handling", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/admin/logs", undefined, adminToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.some((item) => item.action === "handle_complaint"), true);
    });

    await t.test("stats dashboard includes complaint and credit counts", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/admin/stats", undefined, adminToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.complaints, 3);
      assert.equal(result.payload.data.pending_complaints, 0);
      assert.equal(result.payload.data.credit_changes, 1);
    });
  } finally {
    await ctx.close();
  }
});
