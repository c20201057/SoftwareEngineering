const state = {
  token: localStorage.getItem("cg_token") || "",
  user: null,
  sessions: [],
  games: [],
  venues: [],
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

async function api(path, options = {}) {
  const headers = {
    "content-type": "application/json",
    ...(options.headers || {}),
  };
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  const res = await fetch(path, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await res.json();
  if (!payload.success) {
    throw new Error(payload.error?.message || "请求失败");
  }
  return payload.data;
}

function toast(message) {
  const box = $("#toast");
  box.textContent = message;
  box.classList.add("show");
  setTimeout(() => box.classList.remove("show"), 2400);
}

function fmtTime(value) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function setDefaultTimes() {
  const start = new Date(Date.now() + 3 * 24 * 3600 * 1000);
  start.setHours(19, 0, 0, 0);
  const end = new Date(start.getTime() + 3 * 3600 * 1000);
  $("[name=start_time]").value = start.toISOString().slice(0, 16);
  $("[name=end_time]").value = end.toISOString().slice(0, 16);
}

async function login() {
  const studentNo = $("#account").value;
  const data = await api("/api/auth/login", {
    method: "POST",
    body: { student_no: studentNo },
  });
  state.token = data.token;
  state.user = data.user;
  localStorage.setItem("cg_token", state.token);
  renderProfile();
  await loadBootstrap();
  toast(`已登录：${state.user.nickname}`);
}

async function loadMe() {
  if (!state.token) return;
  try {
    state.user = await api("/api/users/me");
    renderProfile();
  } catch {
    state.token = "";
    localStorage.removeItem("cg_token");
  }
}

function renderProfile() {
  if (!state.user) {
    $("#profile").textContent = "未登录";
    return;
  }
  $("#profile").innerHTML = `
    <strong>${state.user.nickname}</strong><br>
    角色：${state.user.role}<br>
    认证：${state.user.auth_status}<br>
    信用分：${state.user.credit_score}
  `;
}

async function loadBootstrap() {
  state.games = await api("/api/games");
  renderGameSelect();
  await Promise.all([loadSessions(), loadVenues(), loadMine(), loadComplaints()]);
}

function renderGameSelect() {
  $("#gameSelect").innerHTML = state.games
    .map((game) => `<option value="${game.id}">${game.name}（${game.type}/${game.min_players}-${game.max_players}人）</option>`)
    .join("");
}

async function loadSessions() {
  const type = encodeURIComponent($("#typeFilter").value);
  const keyword = encodeURIComponent($("#keywordFilter").value);
  state.sessions = await api(`/api/sessions?type=${type}&keyword=${keyword}`);
  $("#sessionList").innerHTML = state.sessions.map(renderSessionCard).join("");
}

function renderSessionCard(session) {
  return `
    <article class="card">
      <h3>${session.title}</h3>
      <div class="meta">
        <span class="badge">${session.game_name}</span>
        <span class="badge">${session.game_type}</span>
        <span class="badge ${session.seats_left > 0 ? "good" : "bad"}">余 ${session.seats_left} 位</span>
        <span class="badge ${session.join_mode === "manual" ? "warn" : "good"}">${session.join_mode === "manual" ? "审核制" : "直接加入"}</span>
      </div>
      <p>${session.description || "暂无说明"}</p>
      <p class="meta">${fmtTime(session.start_time)} · ${session.location} · 发起人 ${session.host_nickname}</p>
      <div class="actions">
        <button onclick="showSession('${session.id}')">详情</button>
        <button class="secondary" onclick="applySession('${session.id}')">申请/加入</button>
      </div>
    </article>
  `;
}

async function showSession(id) {
  const detail = await api(`/api/sessions/${id}`);
  const pending = detail.applications.filter((item) => item.status === "pending");
  $("#sessionDetail").innerHTML = `
    <h3>${detail.title}</h3>
    <p>${detail.description || "暂无说明"}</p>
    <div class="meta">
      <span class="badge">${detail.game?.name || ""}</span>
      <span class="badge">${fmtTime(detail.start_time)}</span>
      <span class="badge">地点：${detail.location}</span>
      <span class="badge">场地：${detail.venue_status}</span>
      <span class="badge">信用要求：${detail.min_credit_required}</span>
    </div>
    <h4>成员</h4>
    <div class="stack">${detail.members.map((m) => `<div class="card">${m.user?.nickname || m.user_id} · ${m.member_role} · ${m.checkin_status}</div>`).join("")}</div>
    <h4>待审核申请</h4>
    <div class="stack">${pending.map((a) => `
      <div class="card">
        ${a.applicant?.nickname || a.applicant_id}：${a.message || "无备注"}
        <div class="actions">
          <button onclick="reviewApplication('${a.id}', 'approve')">通过</button>
          <button class="danger" onclick="reviewApplication('${a.id}', 'reject')">拒绝</button>
        </div>
      </div>`).join("") || "<p class='meta'>暂无待审核申请</p>"}
    </div>
    <div class="actions">
      <button onclick="finishSession('${detail.id}')">标记结束</button>
      <button class="secondary" onclick="requestVenue('${detail.id}')">申请默认场地</button>
      <button class="secondary" onclick="createComplaint('${detail.id}')">提交示例投诉</button>
    </div>
  `;
}

async function applySession(id) {
  await api(`/api/sessions/${id}/applications`, {
    method: "POST",
    body: { message: "我想参加这次组局，会准时到场。" },
  });
  toast("申请已提交或已加入");
  await loadSessions();
  await showSession(id);
}

async function reviewApplication(id, action) {
  await api(`/api/applications/${id}`, {
    method: "PATCH",
    body: { action, reason: action === "approve" ? "信用良好，通过" : "人数安排不合适" },
  });
  toast("申请已处理");
  await loadSessions();
}

async function finishSession(id) {
  await api(`/api/sessions/${id}/finish`, { method: "POST", body: {} });
  toast("组局已标记结束");
  await showSession(id);
}

async function requestVenue(sessionId) {
  const venue = state.venues[0];
  if (!venue) return toast("暂无可用场地");
  const detail = await api(`/api/sessions/${sessionId}`);
  await api("/api/venue-reservations", {
    method: "POST",
    body: {
      session_id: sessionId,
      venue_id: venue.id,
      start_time: detail.start_time,
      end_time: detail.end_time,
      reason: "课程原型演示申请",
    },
  });
  toast("场地申请已提交");
}

async function createComplaint(sessionId) {
  const detail = await api(`/api/sessions/${sessionId}`);
  const target = detail.members.find((m) => m.user_id !== state.user.id);
  if (!target) return toast("需要至少另一名成员才能投诉");
  await api("/api/complaints", {
    method: "POST",
    body: {
      session_id: sessionId,
      target_user_id: target.user_id,
      reason: "示例投诉：活动信息与描述不符",
      evidence: "课堂演示数据",
    },
  });
  toast("投诉已提交");
}

async function createSession(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  payload.max_members = Number(payload.max_members);
  payload.min_credit_required = Number(payload.min_credit_required);
  await api("/api/sessions", { method: "POST", body: payload });
  toast("组局已发布");
  await loadSessions();
  showView("sessions");
}

async function loadMine() {
  if (!state.token) return;
  try {
    const [mine, notifications] = await Promise.all([api("/api/sessions/mine"), api("/api/notifications")]);
    $("#mineList").innerHTML = mine.map((s) => `<div class="card"><strong>${s.title}</strong><p class="meta">${fmtTime(s.start_time)} · ${s.status}</p></div>`).join("") || "<p class='meta'>暂无记录</p>";
    $("#notificationList").innerHTML = notifications.map((n) => `<div class="card"><strong>${n.title}</strong><p>${n.content}</p><p class="meta">${fmtTime(n.created_at)}</p></div>`).join("") || "<p class='meta'>暂无通知</p>";
  } catch {
    $("#mineList").innerHTML = "<p class='meta'>登录后查看</p>";
  }
}

async function loadVenues() {
  state.venues = await api("/api/venues");
  $("#venueList").innerHTML = state.venues.map((v) => `<div class="card"><strong>${v.name}</strong><p>${v.location} · 容量 ${v.capacity}</p><p class="meta">${v.available_time}</p></div>`).join("");
  if (!state.token) {
    $("#reservationList").innerHTML = "<p class='meta'>登录后查看场地预约</p>";
    return;
  }
  try {
    const rows = await api("/api/venue-reservations");
    $("#reservationList").innerHTML = rows.map((r) => `
      <div class="card">
        <strong>${r.venue?.name || r.venue_id}</strong>
        <p>${r.session?.title || r.session_id}</p>
        <p class="meta">${fmtTime(r.start_time)} · ${r.status}</p>
        <div class="actions">
          <button onclick="reviewReservation('${r.id}', 'approve')">通过</button>
          <button class="danger" onclick="reviewReservation('${r.id}', 'reject')">驳回</button>
        </div>
      </div>
    `).join("") || "<p class='meta'>暂无预约</p>";
  } catch {
    $("#reservationList").innerHTML = "<p class='meta'>场地管理员或发起人登录后查看</p>";
  }
}

async function reviewReservation(id, action) {
  await api(`/api/venue-reservations/${id}`, {
    method: "PATCH",
    body: { action, reason: action === "approve" ? "场地可用" : "时段不合适" },
  });
  toast("场地预约已处理");
  await loadVenues();
}

async function loadComplaints() {
  if (!state.token) return;
  try {
    const credit = await api("/api/users/me/credit");
    $("#creditPanel").innerHTML = `<div class="card"><strong>当前信用分：${credit.user.credit_score}</strong></div>` +
      (credit.records.map((r) => `<div class="card">${r.change_value > 0 ? "+" : ""}${r.change_value} · ${r.reason}<p class="meta">${fmtTime(r.created_at)}</p></div>`).join("") || "<p class='meta'>暂无信用流水</p>");
  } catch {
    $("#creditPanel").innerHTML = "<p class='meta'>登录后查看信用记录</p>";
  }
  try {
    const complaints = await api("/api/complaints");
    $("#complaintList").innerHTML = complaints.map((c) => `
      <div class="card">
        <strong>${c.session?.title || c.session_id}</strong>
        <p>${c.reason}</p>
        <p class="meta">状态：${c.status} · 被投诉：${c.target_user?.nickname || c.target_user_id}</p>
        <div class="actions">
          <button onclick="handleComplaint('${c.id}', 'accept')">成立并扣分</button>
          <button class="secondary" onclick="handleComplaint('${c.id}', 'reject')">驳回</button>
        </div>
      </div>
    `).join("") || "<p class='meta'>暂无投诉</p>";
  } catch {
    $("#complaintList").innerHTML = "<p class='meta'>登录后查看投诉</p>";
  }
}

async function handleComplaint(id, action) {
  await api(`/api/complaints/${id}`, {
    method: "PATCH",
    body: { action, result: action === "accept" ? "投诉成立，记录信用扣分" : "证据不足，驳回", credit_change: -10 },
  });
  toast("投诉已处理");
  await loadComplaints();
}

async function loadAdmin() {
  try {
    const [stats, logs] = await Promise.all([api("/api/admin/stats"), api("/api/admin/logs")]);
    $("#statsPanel").textContent = JSON.stringify(stats, null, 2);
    $("#logList").innerHTML = logs.map((log) => `<div class="card"><strong>${log.action}</strong><p>${log.object_type}:${log.object_id} · ${log.result}</p><p class="meta">${fmtTime(log.created_at)}</p></div>`).join("") || "<p class='meta'>暂无日志</p>";
  } catch (error) {
    $("#statsPanel").textContent = error.message;
    $("#logList").innerHTML = "";
  }
}

function showView(name) {
  $$(".nav").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${name}`));
  if (name === "mine") loadMine();
  if (name === "venues") loadVenues();
  if (name === "complaints") loadComplaints();
  if (name === "admin") loadAdmin();
}

window.showSession = showSession;
window.applySession = applySession;
window.reviewApplication = reviewApplication;
window.finishSession = finishSession;
window.requestVenue = requestVenue;
window.createComplaint = createComplaint;
window.reviewReservation = reviewReservation;
window.handleComplaint = handleComplaint;

$("#loginBtn").addEventListener("click", () => login().catch((error) => toast(error.message)));
$("#refreshSessions").addEventListener("click", () => loadSessions().catch((error) => toast(error.message)));
$("#typeFilter").addEventListener("change", () => loadSessions().catch((error) => toast(error.message)));
$("#keywordFilter").addEventListener("input", () => loadSessions().catch((error) => toast(error.message)));
$("#createSessionForm").addEventListener("submit", (event) => createSession(event).catch((error) => toast(error.message)));
$("#refreshMine").addEventListener("click", () => loadMine().catch((error) => toast(error.message)));
$("#refreshVenues").addEventListener("click", () => loadVenues().catch((error) => toast(error.message)));
$("#refreshComplaints").addEventListener("click", () => loadComplaints().catch((error) => toast(error.message)));
$("#refreshAdmin").addEventListener("click", () => loadAdmin().catch((error) => toast(error.message)));
$$(".nav").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));

setDefaultTimes();
loadMe()
  .then(loadBootstrap)
  .catch(() => loadBootstrap())
  .catch((error) => toast(error.message));
