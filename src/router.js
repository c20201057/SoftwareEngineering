const fs = require("node:fs");
const path = require("node:path");
const { AppError, badRequest, notFound, unauthorized } = require("./errors");
const { parseUrl, readJsonBody, safeJoin, sendJson } = require("./utils");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8",
  ".pdf": "application/pdf",
};

function createHandler(app) {
  return async function handler(req, res) {
    try {
      const url = parseUrl(req);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(app, req, res, url);
        return;
      }
      serveStatic(app.publicDir, req, res, url);
    } catch (error) {
      handleError(res, error);
    }
  };
}

async function handleApi(app, req, res, url) {
  const body = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await parseBody(req) : {};
  const user = resolveUser(app, req);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const route = `/${pathParts.slice(1).join("/")}`;
  const services = app.services;
  const query = Object.fromEntries(url.searchParams.entries());

  if (req.method === "GET" && route === "/health") {
    ok(res, {
      name: "CampusGather",
      status: "ok",
      version: "1.0.0",
      time: new Date().toISOString(),
    });
    return;
  }

  if (req.method === "POST" && route === "/auth/login") {
    ok(res, services.userService.login(body));
    return;
  }

  if (req.method === "GET" && route === "/users/me") {
    ok(res, services.userService.current(user));
    return;
  }

  if (req.method === "POST" && route === "/users/me/auth") {
    ok(res, services.userService.submitAuth(user, body));
    return;
  }

  if (req.method === "PUT" && route === "/users/me") {
    ok(res, services.userService.updateProfile(user, body));
    return;
  }

  if (req.method === "GET" && route === "/users/me/credit") {
    ok(res, services.sessionService.creditForUser(user));
    return;
  }

  if (req.method === "GET" && route === "/users") {
    ok(res, services.userService.list(user));
    return;
  }

  if (req.method === "PATCH" && pathParts[1] === "users" && pathParts[3] === "auth") {
    const updated = services.userService.reviewAuth(user, pathParts[2], body);
    services.notificationService.create(pathParts[2], {
      type: "auth_result",
      title: "实名认证审核结果",
      content: `你的实名认证状态已更新为 ${updated.auth_status}。`,
      related_type: "user",
      related_id: pathParts[2],
    });
    services.logService.record(user, "review_auth", "user", pathParts[2], body.action);
    ok(res, updated);
    return;
  }

  if (req.method === "PATCH" && pathParts[1] === "users" && pathParts[3] === "status") {
    const updated = services.userService.changeAccountStatus(user, pathParts[2], body);
    services.logService.record(user, "change_account_status", "user", pathParts[2], body.status);
    ok(res, updated);
    return;
  }

  if (req.method === "GET" && route === "/games") {
    ok(res, services.gameService.list(query));
    return;
  }

  if (req.method === "POST" && route === "/games") {
    ok(res, services.gameService.create(user, body), 201);
    return;
  }

  if (req.method === "PATCH" && pathParts[1] === "games" && pathParts[2]) {
    ok(res, services.gameService.update(user, pathParts[2], body));
    return;
  }

  if (req.method === "GET" && route === "/sessions") {
    ok(res, services.sessionService.list(query));
    return;
  }

  if (req.method === "POST" && route === "/sessions") {
    ok(res, services.sessionService.create(user, body), 201);
    return;
  }

  if (req.method === "GET" && route === "/sessions/mine") {
    ok(res, services.sessionService.mine(user));
    return;
  }

  if (req.method === "GET" && pathParts[1] === "sessions" && pathParts[2] && pathParts.length === 3) {
    ok(res, services.sessionService.detail(pathParts[2], user));
    return;
  }

  if (req.method === "PATCH" && pathParts[1] === "sessions" && pathParts[2] && pathParts.length === 3) {
    ok(res, services.sessionService.update(user, pathParts[2], body));
    return;
  }

  if (req.method === "POST" && pathParts[1] === "sessions" && pathParts[3] === "applications") {
    ok(res, services.sessionService.apply(user, pathParts[2], body), 201);
    return;
  }

  if (req.method === "PATCH" && pathParts[1] === "applications" && pathParts[2]) {
    ok(res, services.sessionService.reviewApplication(user, pathParts[2], body));
    return;
  }

  if (req.method === "POST" && pathParts[1] === "sessions" && pathParts[3] === "leave") {
    ok(res, services.sessionService.leave(user, pathParts[2], body));
    return;
  }

  if (req.method === "POST" && pathParts[1] === "sessions" && pathParts[3] === "cancel") {
    ok(res, services.sessionService.cancel(user, pathParts[2], body));
    return;
  }

  if (req.method === "POST" && pathParts[1] === "sessions" && pathParts[3] === "finish") {
    ok(res, services.sessionService.finish(user, pathParts[2]));
    return;
  }

  if (req.method === "POST" && pathParts[1] === "sessions" && pathParts[3] === "reviews") {
    ok(res, services.sessionService.createReview(user, pathParts[2], body), 201);
    return;
  }

  if (req.method === "GET" && route === "/venues") {
    ok(res, services.venueService.list(query));
    return;
  }

  if (req.method === "POST" && route === "/venues") {
    ok(res, services.venueService.createOrUpdate(user, body), 201);
    return;
  }

  if (req.method === "GET" && pathParts[1] === "venues" && pathParts[2]) {
    ok(res, services.venueService.detail(pathParts[2]));
    return;
  }

  if (req.method === "PATCH" && pathParts[1] === "venues" && pathParts[2]) {
    ok(res, services.venueService.createOrUpdate(user, body, pathParts[2]));
    return;
  }

  if (req.method === "GET" && route === "/venue-reservations") {
    ok(res, services.venueService.listReservations(user, query));
    return;
  }

  if (req.method === "POST" && route === "/venue-reservations") {
    ok(res, services.venueService.requestReservation(user, body), 201);
    return;
  }

  if (req.method === "PATCH" && pathParts[1] === "venue-reservations" && pathParts[2]) {
    ok(res, services.venueService.reviewReservation(user, pathParts[2], body));
    return;
  }

  if (req.method === "GET" && route === "/complaints") {
    ok(res, services.complaintService.list(user, query));
    return;
  }

  if (req.method === "POST" && route === "/complaints") {
    ok(res, services.complaintService.create(user, body), 201);
    return;
  }

  if (req.method === "PATCH" && pathParts[1] === "complaints" && pathParts[2]) {
    ok(res, services.complaintService.handle(user, pathParts[2], body));
    return;
  }

  if (req.method === "GET" && route === "/notifications") {
    services.userService.requireLogin(user);
    ok(res, services.notificationService.listForUser(user, { unreadOnly: query.unread === "true" }));
    return;
  }

  if (req.method === "PATCH" && pathParts[1] === "notifications" && pathParts[2]) {
    services.userService.requireLogin(user);
    ok(res, services.notificationService.markRead(user, pathParts[2]));
    return;
  }

  if (req.method === "GET" && route === "/admin/logs") {
    services.userService.requireRole(user, "admin");
    ok(res, services.logService.list());
    return;
  }

  if (req.method === "GET" && route === "/admin/stats") {
    services.userService.requireRole(user, "admin");
    ok(res, services.statsService.dashboard());
    return;
  }

  throw notFound("接口不存在");
}

async function parseBody(req) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    throw badRequest("请求体必须是合法 JSON");
  }
}

function resolveUser(app, req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.headers["x-user-id"];
  if (!token) return null;
  return app.services.userService.getById(token) || null;
}

function ok(res, data, status = 200) {
  sendJson(res, status, { success: true, data });
}

function serveStatic(publicDir, req, res, url) {
  let requested = decodeURIComponent(url.pathname);
  if (requested === "/") requested = "/index.html";
  const file = safeJoin(publicDir, requested.slice(1));
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    throw notFound("页面不存在");
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    "content-type": MIME[ext] || "application/octet-stream",
  });
  fs.createReadStream(file).pipe(res);
}

function handleError(res, error) {
  if (error instanceof AppError) {
    sendJson(res, error.status, {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
    return;
  }
  console.error(error);
  sendJson(res, 500, {
    success: false,
    error: {
      code: "SERVER_ERROR",
      message: "系统繁忙，请稍后重试",
    },
  });
}

module.exports = { createHandler, handleApi, handleError, resolveUser };
