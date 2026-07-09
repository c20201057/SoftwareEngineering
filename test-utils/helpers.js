const assert = require("node:assert/strict");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../src/app");
const { createHandler } = require("../src/router");

const DEFAULT_PASSWORD = "abc123456";

async function createTestServer() {
  const dataDir = path.join(os.tmpdir(), `campus-gather-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const app = createApp({ dataDir, resetOnStart: true });
  const server = http.createServer(createHandler(app));
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  return {
    app,
    baseUrl: `http://127.0.0.1:${port}`,
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

async function loginAs(ctx, userId, password = DEFAULT_PASSWORD) {
  const user = ctx.app.store.get("users", userId);
  assert.ok(user, `Seed user ${userId} should exist`);
  const result = await request(ctx.baseUrl, "POST", "/api/auth/login", {
    nickname: user.nickname,
    password,
  });
  assert.equal(result.status, 200);
  assert.equal(result.payload.success, true);
  return result.payload.data.token;
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

function markSessionStarted(app, sessionId) {
  const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  app.store.update("game_sessions", sessionId, { start_time: start, end_time: end });
  const reservation = app.store.all("venue_reservations").find((item) => item.session_id === sessionId);
  if (reservation) {
    app.store.update("venue_reservations", reservation.id, { start_time: start, end_time: end });
  }
}

function sessionPayload(overrides = {}) {
  const time = createFutureWindow(overrides.daysFromNow || 20, overrides.startHour || 18, overrides.durationHours || 2);
  return {
    game_id: "g1",
    title: `Automated session ${Date.now()} ${Math.random().toString(16).slice(2)}`,
    description: "Created by automated API tests",
    start_time: time.start,
    end_time: time.end,
    venue_id: "v1",
    max_members: 6,
    min_credit_required: 80,
    join_mode: "manual",
    ...overrides,
  };
}

function onePixelPng() {
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axS5kAAAAAASUVORK5CYII=";
}

module.exports = {
  DEFAULT_PASSWORD,
  createFutureWindow,
  createTestServer,
  loginAs,
  markSessionStarted,
  onePixelPng,
  request,
  sessionPayload,
};
