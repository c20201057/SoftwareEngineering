const state = {
  token: localStorage.getItem("cg_token") || "",
  user: null,
  sessions: [],
  games: [],
  adminGames: [],
  venues: [],
  notifications: [],
  currentSessionMembers: [],
};

const REVIEW_SCORE_LABELS = {
  5: "5 分 · 表现很好",
  4: "4 分 · 体验较好",
  3: "3 分 · 正常参与",
  2: "2 分 · 体验较差",
  1: "1 分 · 严重影响活动",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

async function api(path, options = {}) {
  const headers = {
    "content-type": "application/json",
    ...(options.headers || {}),
  };
  if (state.token) headers.authorization = `Bearer ${state.token}`;

  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json();
  if (!payload.success) {
    throw new Error(payload.error?.message || "请求失败");
  }
  return payload.data;
}

function toast(message) {
  const box = $("#toast");
  if (!box) return;
  box.textContent = message;
  box.classList.add("show");
  setTimeout(() => box.classList.remove("show"), 2400);
}

function fmtTime(value) {
  if (!value) return "未设置";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function toLocalInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function setDefaultTimes() {
  const start = new Date(Date.now() + 3 * 24 * 3600 * 1000);
  start.setHours(19, 0, 0, 0);
  const end = new Date(start.getTime() + 3 * 3600 * 1000);
  const createForm = $("#createSessionForm");
  if (!createForm) return;
  createForm.start_time.value = toLocalInputValue(start.toISOString());
  createForm.end_time.value = toLocalInputValue(end.toISOString());
}

function isLoggedIn() {
  return Boolean(state.user);
}

function isStudent() {
  return state.user?.role === "student";
}

function isAdmin() {
  return state.user?.role === "admin";
}

function isVenueAdmin() {
  return state.user?.role === "venue_admin";
}

function isVerifiedStudent() {
  return isStudent() && state.user?.auth_status === "verified" && state.user?.status === "active";
}

function unreadNotificationCount() {
  return state.notifications.filter((item) => !item.read_at).length;
}

function updateMineBadge() {
  const badge = $("#mineBadge");
  if (!badge) return;
  const unread = unreadNotificationCount();
  badge.textContent = unread > 99 ? "99+" : String(unread);
  badge.style.display = unread > 0 ? "inline-flex" : "none";
}

function formatVenueOptionLabel(venue) {
  return `${venue.name} · ${venue.location} · 容量 ${venue.capacity}`;
}

function formatSessionLocation(session) {
  if (session.venue?.name) return `${session.venue.name} · ${session.venue.location}`;
  if (session.venue_name) return `${session.venue_name} · ${session.venue_location}`;
  return session.location || "待定";
}

function renderVenueSelect(target, selectedValue = "", placeholder = "请选择场地") {
  const select = typeof target === "string" ? $(target) : target;
  if (!select) return;
  const options = [`<option value="">${placeholder}</option>`]
    .concat(state.venues.map((venue) => (
      `<option value="${venue.id}">${formatVenueOptionLabel(venue)}</option>`
    )));
  select.innerHTML = options.join("");
  select.value = selectedValue || "";
}

function renderVenueSelects() {
  renderVenueSelect("#venueSelect", $("#venueSelect")?.value || "", "请选择场地");
  renderVenueSelect("#editVenueSelect", $("#editVenueSelect")?.value || "", "请选择场地（留空则保持原地点）");
}

function hideEditSessionPanel() {
  const block = $("#editSessionBlock");
  const form = $("#editSessionForm");
  if (form) form.reset();
  renderVenueSelect("#editVenueSelect", "", "请选择场地（留空则保持原地点）");
  if (block) block.style.display = "none";
}

function resetVenueFormState() {
  const form = $("#venueForm");
  if (!form) return;
  form.reset();
  form.venue_id.value = "";
  form.status.value = "active";
  $("#venueSubmitBtn").textContent = "新增场地";
}

function resetGameFormState() {
  const form = $("#gameForm");
  if (!form) return;
  form.reset();
  form.game_id.value = "";
  form.type.value = "桌游";
  form.status.value = "active";
  form.duration_minutes.value = "120";
  $("#gameSubmitBtn").textContent = "新增游戏";
}

async function loadMe() {
  if (!state.token) return;
  try {
    state.user = await api("/api/users/me");
    renderProfile();
    renderNavigation();
  } catch {
    clearLocalSession();
    renderProfile();
    renderNavigation();
  }
}

function clearLocalSession() {
  state.token = "";
  state.user = null;
  state.notifications = [];
  state.currentSessionMembers = [];
  localStorage.removeItem("cg_token");
}

function renderProfile() {
  const panel = $("#profile");
  if (!panel) return;
  if (!state.user) {
    panel.textContent = "未登录";
    return;
  }
  panel.innerHTML = `
    <div class="sidebar-profile">
      <img class="avatar" src="${avatarUrl(state.user.avatar)}" alt="用户头像" />
      <div>
        <strong>${escapeHtml(state.user.nickname)}</strong><br>
        角色：${escapeHtml(roleText(state.user.role))}<br>
        认证：${authStatusText(state.user.auth_status)}<br>
        信用分：${state.user.credit_score}
      </div>
    </div>
  `;
}

function renderNavigation() {
  const createNav = $("#createNav");
  const authNav = $("#authNav");
  const mineNav = $("#mineNav");
  const complaintsNav = $("#complaintsNav");
  const adminNav = $("#adminNav");

  if (createNav) createNav.style.display = isVerifiedStudent() ? "" : "none";
  if (authNav) authNav.style.display = isLoggedIn() ? "" : "none";
  if (mineNav) mineNav.style.display = isLoggedIn() ? "" : "none";
  if (complaintsNav) complaintsNav.style.display = isLoggedIn() ? "" : "none";
  if (adminNav) adminNav.style.display = isAdmin() ? "" : "none";

  updateMineBadge();

  const activeHidden = [...$$(".nav.active")].some((button) => button.style.display === "none");
  if (activeHidden) showView("sessions");
}

function authStatusText(status) {
  if (status === "verified") return "已认证";
  if (status === "pending") return "审核中";
  return "暂未认证";
}

function authStatusTone(status) {
  if (status === "verified") return "good";
  if (status === "pending") return "warn";
  return "bad";
}

function accountStatusText(status) {
  if (status === "active") return "正常";
  if (status === "muted") return "禁言";
  if (status === "limited") return "限制发布";
  if (status === "banned") return "已封禁";
  return status || "未知";
}

function accountStatusTone(status) {
  if (status === "active") return "good";
  if (status === "banned") return "bad";
  if (status === "limited" || status === "muted") return "warn";
  return "";
}

function gameStatusText(status) {
  if (status === "active") return "上架";
  if (status === "inactive") return "已下架";
  return status || "未知";
}

function gameStatusTone(status) {
  if (status === "active") return "good";
  if (status === "inactive") return "bad";
  return "";
}

const RECOMMENDED_TAGS = [
  "推理",
  "策略",
  "新手友好",
  "沉浸演绎",
  "社交破冰",
  "轻松欢乐",
  "高能反转",
  "剧情还原",
  "团队协作",
  "低压力",
  "男性角色偏好",
  "女性角色偏好",
];

const AVATAR_OPTIONS = ["1.png", "2.png", "3.png", "4.png", "5.png", "6.png", "7.png", "8.png", "9.png", "10.png"];

function avatarUrl(avatar) {
  return `/profile_photo/${String(avatar || "default.png").split("/").map(encodeURIComponent).join("/")}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("头像文件读取失败"));
    reader.readAsDataURL(file);
  });
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("头像图片无法解析"));
    image.src = dataUrl;
  });
}

async function compressAvatarFile(file) {
  const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!allowedTypes.has(file.type)) throw new Error("仅支持 PNG、JPG、WEBP 头像");
  if (file.size > 5 * 1024 * 1024) throw new Error("原始图片不能超过 5MB");

  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImageFromDataUrl(dataUrl);
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  const sx = Math.max(0, (image.naturalWidth - side) / 2);
  const sy = Math.max(0, (image.naturalHeight - side) / 2);
  ctx.drawImage(image, sx, sy, side, side, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.86);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function roleText(role) {
  if (role === "admin") return "系统管理员";
  if (role === "venue_admin") return "场地管理员";
  if (role === "student") return "学生";
  return role || "未知";
}

function parseTags(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "")
    .split(/[,，、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueTags(tags) {
  return [...new Set(tags)].slice(0, 8);
}

function renderTagList(tags) {
  if (!tags.length) return "<span class='hint'>暂无偏好</span>";
  return tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
}

function renderGameTagList(tags) {
  const rows = uniqueTags(tags || []);
  if (!rows.length) return "<span class='hint'>暂无标签</span>";
  return rows.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
}

function renderMemberTag(member) {
  const user = member.user || {};
  const nickname = user.nickname || user.name || member.user_id;
  return `
    <button type="button" class="member-tag" onclick="showMemberProfile('${escapeHtml(member.user_id)}')">
      <img src="${avatarUrl(user.avatar)}" alt="${escapeHtml(nickname)} 的头像" />
      <span>${escapeHtml(nickname)}</span>
    </button>
  `;
}

function showMemberProfile(userId) {
  const member = state.currentSessionMembers.find((item) => item.user_id === userId);
  const user = member?.user;
  const dialog = $("#memberProfileDialog");
  const content = $("#memberProfileContent");
  if (!user || !dialog || !content) return;
  content.innerHTML = `
    <div class="member-profile-card">
      <div class="member-profile-head">
        <img class="avatar large" src="${avatarUrl(user.avatar)}" alt="${escapeHtml(user.nickname || user.id)} 的头像" />
        <div>
          <h3>${escapeHtml(user.nickname || user.name || user.id)}</h3>
          <p class="hint">UID：${escapeHtml(user.id)}</p>
        </div>
      </div>
      <div class="profile-summary">
        <div class="profile-field">
          <span>UID</span>
          <strong>${escapeHtml(user.id)}</strong>
        </div>
        <div class="profile-field">
          <span>昵称</span>
          <strong>${escapeHtml(user.nickname || user.name || "未设置")}</strong>
        </div>
        <div class="profile-field">
          <span>信用分</span>
          <strong>${Number(user.credit_score || 0)}</strong>
        </div>
      </div>
      <div>
        <h3>偏好</h3>
        <div class="tag-list">${renderTagList(uniqueTags(user.tags || []))}</div>
      </div>
    </div>
  `;
  dialog.hidden = false;
}

function closeMemberProfileDialog() {
  const dialog = $("#memberProfileDialog");
  if (dialog) dialog.hidden = true;
}

function renderAuthPanel() {
  const panel = $("#authPanel");
  if (!panel) return;

  if (!state.user) {
    panel.innerHTML = "<p class='meta'>登录后查看个人主页。</p>";
    return;
  }

  const tags = uniqueTags(state.user.tags || []);
  const status = state.user.auth_status || "rejected";
  panel.innerHTML = `
    <div class="card profile-card">
      <div class="profile-avatar-panel">
        <img class="avatar large" src="${avatarUrl(state.user.avatar)}" alt="用户头像" />
        <div>
          <h3>头像</h3>
          <p class="hint">当前使用的个人头像</p>
        </div>
      </div>
      <div class="profile-summary">
        <div class="profile-field">
          <span>UID</span>
          <strong>${escapeHtml(state.user.id)}</strong>
        </div>
        <div class="profile-field">
          <span>昵称</span>
          <strong>${escapeHtml(state.user.nickname || state.user.name || "未设置")}</strong>
        </div>
        <div class="profile-field">
          <span>角色</span>
          <strong>${escapeHtml(roleText(state.user.role))}</strong>
        </div>
        <div class="profile-field">
          <span>认证状态</span>
          <button type="button" class="auth-status-button" onclick="showAuthFeatureUnavailable()">
            <strong class="badge ${authStatusTone(status)}">${authStatusText(status)}</strong>
          </button>
        </div>
        <div class="profile-field">
          <span>信用分</span>
          <strong>${Number(state.user.credit_score || 0)}</strong>
        </div>
      </div>
      <div>
        <h3>个人偏好</h3>
        <div class="tag-list">${renderTagList(tags)}</div>
      </div>
      <div class="actions">
        <button type="button" onclick="openProfileDialog()">编辑个人资料</button>
      </div>
    </div>
  `;
}

async function loadAuthView() {
  if (state.token) {
    state.user = await api("/api/users/me");
    renderProfile();
  }
  renderAuthPanel();
}

function showAuthFeatureUnavailable() {
  toast("暂未开通此功能");
}

function openProfileDialog() {
  if (!state.user) return;
  const dialog = $("#profileDialog");
  const form = $("#profileEditForm");
  if (!dialog || !form) return;
  form.nickname.value = state.user.nickname || "";
  form.contact.value = state.user.contact || "";
  form.tags.value = (state.user.tags || []).join(", ");
  form.avatar.value = state.user.avatar || "default.png";
  const preview = $("#profileEditAvatar");
  if (preview) preview.src = avatarUrl(form.avatar.value);
  renderProfileDialogAuthStatus();
  renderRecommendedTags();
  dialog.hidden = false;
}

function closeProfileDialog() {
  const dialog = $("#profileDialog");
  if (dialog) dialog.hidden = true;
}

function renderRecommendedTags() {
  const box = $("#recommendedTags");
  if (!box) return;
  box.innerHTML = RECOMMENDED_TAGS
    .map((tag) => `<button type="button" class="tag-button" onclick="addRecommendedTag('${escapeHtml(tag)}')">${escapeHtml(tag)}</button>`)
    .join("");
}

function openAvatarDialog() {
  renderAvatarOptions();
  const dialog = $("#avatarDialog");
  if (dialog) dialog.hidden = false;
}

function closeAvatarDialog() {
  const dialog = $("#avatarDialog");
  if (dialog) dialog.hidden = true;
}

function renderAvatarOptions() {
  const box = $("#avatarOptions");
  const form = $("#profileEditForm");
  if (!box || !form) return;
  const current = form.avatar.value || state.user?.avatar || "default.png";
  box.innerHTML = AVATAR_OPTIONS
    .map((avatar) => `
      <button type="button" class="avatar-option ${avatar === current ? "active" : ""}" onclick="selectAvatar('${avatar}')">
        <img src="${avatarUrl(avatar)}" alt="头像 ${avatar.replace(".png", "")}" />
      </button>
    `)
    .join("");
}

function selectAvatar(avatar) {
  const form = $("#profileEditForm");
  const preview = $("#profileEditAvatar");
  if (!form) return;
  form.avatar.value = avatar;
  if (preview) preview.src = avatarUrl(avatar);
  closeAvatarDialog();
}

function openAvatarFilePicker() {
  const input = $("#avatarFileInput");
  if (!input) return;
  input.value = "";
  input.click();
}

async function handleAvatarFileSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const image = await compressAvatarFile(file);
  const user = await api("/api/users/me/avatar", {
    method: "POST",
    body: { image },
  });
  state.user = user;
  const form = $("#profileEditForm");
  const preview = $("#profileEditAvatar");
  if (form) form.avatar.value = user.avatar || "default.png";
  if (preview) preview.src = avatarUrl(user.avatar);
  renderProfile();
  renderAuthPanel();
  closeAvatarDialog();
  toast("头像已上传。");
}

function renderProfileDialogAuthStatus() {
  const box = $("#profileDialogAuthStatus");
  if (!box || !state.user) return;
  const status = state.user.auth_status || "unverified";
  const shouldShowAuthButton = status !== "verified" && status !== "pending";
  box.innerHTML = `
    <span class="badge ${authStatusTone(status)}">${authStatusText(status)}</span>
    ${shouldShowAuthButton ? `<button type="button" class="secondary" onclick="showAuthFeatureUnavailable()">立即认证</button>` : ""}
  `;
}

function addRecommendedTag(tag) {
  const form = $("#profileEditForm");
  if (!form) return;
  const tags = uniqueTags(parseTags(form.tags.value).concat(tag));
  form.tags.value = tags.join(", ");
}

async function saveProfileEdit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  payload.tags = uniqueTags(parseTags(payload.tags));
  await api("/api/users/me", {
    method: "PUT",
    body: payload,
  });
  state.user = await api("/api/users/me");
  closeProfileDialog();
  renderProfile();
  renderNavigation();
  renderAuthPanel();
  toast("个人资料已更新。");
}

async function loadGames() {
  state.games = await api("/api/games");
  renderGameSelect();
  renderTagFilter();
}

async function loadBootstrap() {
  await loadGames();
  renderVenueSelects();
  renderNavigation();
  await Promise.all([loadSessions(), loadAuthView(), loadVenues(), loadMine(), loadComplaints()]);
}

function renderGameSelect() {
  const select = $("#gameSelect");
  if (!select) return;
  select.innerHTML = state.games
    .map((game) => `<option value="${game.id}">${game.name}（${game.type}/${game.min_players}-${game.max_players}人）</option>`)
    .join("");
}

function renderTagFilter() {
  const select = $("#tagFilter");
  if (!select) return;
  const current = select.value;
  const tags = [...new Set(state.games.flatMap((game) => game.tags || []).map(String).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
  select.innerHTML = [`<option value="">全部标签</option>`]
    .concat(tags.map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`))
    .join("");
  select.value = tags.includes(current) ? current : "";
}

function canApplyToSession(session) {
  if (!isVerifiedStudent()) return false;
  if (state.user.id === session.host_id) return false;
  if (session.status !== "recruiting") return false;
  if (session.seats_left < 1) return false;
  if (Number(state.user.credit_score || 0) < Number(session.min_credit_required || 0)) return false;
  return true;
}

async function loadSessions() {
  const type = encodeURIComponent($("#typeFilter").value);
  const tag = encodeURIComponent($("#tagFilter").value);
  const keyword = encodeURIComponent($("#keywordFilter").value);
  state.sessions = await api(`/api/sessions?type=${type}&tag=${tag}&keyword=${keyword}`);
  $("#sessionList").innerHTML = state.sessions.map(renderSessionCard).join("") || "<p class='meta'>暂无组局</p>";
}

function renderSessionCard(session) {
  const canApply = canApplyToSession(session);
  const locationText = formatSessionLocation(session);
  return `
    <article class="card">
      <h3>${session.title}</h3>
      <div class="meta">
        <span class="badge">${session.game_name}</span>
        <span class="badge">${session.game_type}</span>
        ${(session.game_tags || []).map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join("")}
        <span class="badge ${session.seats_left > 0 ? "good" : "bad"}">剩余 ${session.seats_left} 位</span>
        <span class="badge ${session.join_mode === "manual" ? "warn" : "good"}">${session.join_mode === "manual" ? "发起人审核" : "直接加入"}</span>
      </div>
      <p>${session.description || "暂无说明"}</p>
      ${(session.recommendation_reasons || []).length ? `<p class="hint">推荐理由：${session.recommendation_reasons.map(escapeHtml).join("、")}</p>` : ""}
      <p class="meta">${fmtTime(session.start_time)} · ${locationText} · 发起人：${session.host_nickname}</p>
      <div class="actions">
        <button onclick="showSession('${session.id}')">详情</button>
        ${canApply ? `<button class="secondary" onclick="applySession('${session.id}')">申请/加入</button>` : ""}
      </div>
    </article>
  `;
}

async function showSession(id) {
  const detail = await api(`/api/sessions/${id}`);
  state.currentSessionMembers = detail.members || [];
  const locationText = formatSessionLocation(detail);
  const isMember = detail.members.some((member) => member.user_id === state.user?.id);
  const hasPendingApplication = detail.applications.some((item) => item.applicant_id === state.user?.id && item.status === "pending");
  const canApply = isVerifiedStudent()
    && state.user?.id !== detail.host_id
    && !isMember
    && !hasPendingApplication
    && detail.status === "recruiting"
    && Number(state.user.credit_score || 0) >= Number(detail.min_credit_required || 0)
    && Number(detail.current_members || 0) < Number(detail.max_members || 0);
  const canCreateComplaint = isVerifiedStudent()
    && isMember
    && detail.members.some((member) => member.user_id !== state.user.id);

  const actionButtons = [];
  if (canApply) actionButtons.push(`<button class="secondary" onclick="applySession('${detail.id}')">申请/加入</button>`);
  if (canCreateComplaint) actionButtons.push(`<button class="secondary" onclick="createComplaint('${detail.id}')">提交投诉</button>`);

  const userHint = hasPendingApplication
    ? "<p class='meta'>你已提交报名申请，正在等待发起人审核。</p>"
    : "";

  $("#sessionDetail").innerHTML = `
    <h3>${detail.title}</h3>
    <p>${detail.description || "暂无说明"}</p>
    <div class="meta">
      <span class="badge">${detail.game?.name || ""}</span>
      <span class="badge">${fmtTime(detail.start_time)}</span>
      <span class="badge">地点：${locationText}</span>
      <span class="badge">场地状态：${detail.venue_status}</span>
      <span class="badge">信用要求：${detail.min_credit_required}</span>
    </div>
    <h4>成员</h4>
    <div class="member-tags">${detail.members.map(renderMemberTag).join("")}</div>
    ${userHint}
    ${actionButtons.length ? `<div class="actions">${actionButtons.join("")}</div>` : ""}
  `;
}

async function refreshSessionViews(sessionId = null) {
  await Promise.all([loadSessions(), loadMine(), loadVenues()]);
  if (sessionId && $("#view-sessions")?.classList.contains("active")) {
    await showSession(sessionId).catch(() => {});
  }
}

async function applySession(id) {
  await api(`/api/sessions/${id}/applications`, {
    method: "POST",
    body: { message: "我想参加这次组局，会准时到场。" },
  });
  toast("申请已提交或已加入。");
  await refreshSessionViews(id);
}

async function reviewApplication(id, action) {
  await api(`/api/applications/${id}`, {
    method: "PATCH",
    body: {
      action,
      reason: action === "approve" ? "信用良好，审核通过" : "当前名额安排不合适",
    },
  });
  toast("申请已处理。");
  await Promise.all([loadSessions(), loadMine()]);
}

async function finishSession(id) {
  await api(`/api/sessions/${id}/finish`, { method: "POST", body: {} });
  toast("组局已标记结束。");
  await refreshSessionViews(id);
}

async function createComplaint(sessionId) {
  const detail = await api(`/api/sessions/${sessionId}`);
  const target = detail.members.find((member) => member.user_id !== state.user.id);
  if (!target) {
    toast("至少需要另一名成员才能投诉。");
    return;
  }
  await api("/api/complaints", {
    method: "POST",
    body: {
      session_id: sessionId,
      target_user_id: target.user_id,
      reason: "活动信息与描述不符",
      evidence: "课堂演示数据",
    },
  });
  toast("投诉已提交。");
  await loadComplaints();
}

async function createSession(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const submitButton = formElement.querySelector("button[type='submit']");
  if (submitButton) submitButton.disabled = true;
  try {
    const form = new FormData(formElement);
    const payload = Object.fromEntries(form.entries());
    payload.max_members = Number(payload.max_members);
    payload.min_credit_required = Number(payload.min_credit_required);
    const created = await api("/api/sessions", { method: "POST", body: payload });
    formElement.reset();
    setDefaultTimes();
    renderVenueSelect("#venueSelect", "", "请选择场地");
    showView("sessions");
    try {
      await refreshSessionViews(created?.id);
      toast("组局已发布。");
    } catch {
      toast("组局已发布，但列表刷新失败，请手动刷新。");
    }
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

function renderNotifications(notifications) {
  const list = $("#notificationList");
  if (!list) return;
  list.innerHTML = notifications.map((notification) => `
    <div class="card notification-card ${notification.read_at ? "" : "unread"}">
      <div class="notification-head">
        <strong>${notification.title}</strong>
        <span class="badge ${notification.read_at ? "good" : "bad"}">${notification.read_at ? "已读" : "未读"}</span>
      </div>
      <p>${notification.content}</p>
      <p class="meta">
        <span>${fmtTime(notification.created_at)}</span>
        ${notification.read_at ? `<span>已读于 ${fmtTime(notification.read_at)}</span>` : ""}
      </p>
      ${notification.read_at ? "" : `<div class="actions"><button class="secondary" onclick="markNotificationRead('${notification.id}')">标为已读</button></div>`}
    </div>
  `).join("") || "<p class='meta'>暂无通知</p>";
}

function reviewScoreText(score) {
  return REVIEW_SCORE_LABELS[Number(score)] || `${score} 分`;
}

function renderReviewHistory(reviews = []) {
  if (!reviews.length) return "<p class='hint'>暂无互评记录。</p>";
  return `
    <div class="review-history">
      ${reviews.map((review) => `
        <div class="review-item">
          <strong>${escapeHtml(review.reviewer?.nickname || review.reviewer_id)}</strong>
          <span>评价</span>
          <strong>${escapeHtml(review.target_user?.nickname || review.target_user_id)}</strong>
          <span class="badge ${Number(review.score) >= 4 ? "good" : Number(review.score) <= 2 ? "bad" : "warn"}">${reviewScoreText(review.score)}</span>
          ${review.content ? `<p>${escapeHtml(review.content)}</p>` : ""}
          <p class="meta">${fmtTime(review.created_at)}</p>
        </div>
      `).join("")}
    </div>
  `;
}

function renderSessionReviewPanel(session, detail) {
  if (session.status !== "finished") return "";
  if (!isVerifiedStudent()) return "";
  if (!detail) return "<div class='subsection'><h4>活动互评</h4><p class='hint'>互评信息加载中。</p></div>";

  const members = detail.members || [];
  const reviews = detail.reviews || [];
  const isMember = members.some((member) => member.user_id === state.user?.id);
  if (!isMember) return "";

  const reviewedTargetIds = new Set(
    reviews
      .filter((review) => review.reviewer_id === state.user?.id)
      .map((review) => review.target_user_id),
  );
  const availableTargets = members.filter((member) => (
    member.user_id !== state.user?.id && !reviewedTargetIds.has(member.user_id)
  ));

  const targetOptions = availableTargets.map((member) => {
    const nickname = member.user?.nickname || member.user?.name || member.user_id;
    const role = member.member_role === "host" ? "发起人" : "成员";
    const credit = member.user?.credit_score ?? "-";
    return `<option value="${member.user_id}">${escapeHtml(nickname)} · ${role} · 信用 ${credit}</option>`;
  }).join("");

  const form = availableTargets.length ? `
    <form class="review-form" onsubmit="submitSessionReview(event, '${session.id}')">
      <label>
        <span>评价对象</span>
        <select name="target_user_id" required>${targetOptions}</select>
      </label>
      <label>
        <span>评分</span>
        <select name="score" required>
          ${[5, 4, 3, 2, 1].map((score) => `<option value="${score}">${REVIEW_SCORE_LABELS[score]}</option>`).join("")}
        </select>
      </label>
      <label class="wide">
        <span>评价内容</span>
        <textarea name="content" maxlength="200" placeholder="可填写对准时、沟通、活动体验等方面的评价"></textarea>
      </label>
      <button type="submit">提交评价</button>
    </form>
  ` : "<p class='hint'>本组局已完成可提交的互评。</p>";

  return `
    <div class="subsection review-panel">
      <h4>活动互评</h4>
      ${form}
      ${renderReviewHistory(reviews)}
    </div>
  `;
}

function renderMineSessions(sessions, detailMap = {}) {
  const list = $("#mineList");
  if (!list) return;
  list.innerHTML = sessions.map((session) => {
    const isHostSession = session.host_id === state.user?.id;
    const canEdit = isHostSession && ["recruiting", "full"].includes(session.status);
    const canCancel = isHostSession && !["cancelled", "finished"].includes(session.status);
    const canFinishMine = isHostSession && ["recruiting", "full"].includes(session.status);
    const canLeaveMine = !isHostSession && isVerifiedStudent() && ["recruiting", "full"].includes(session.status);
    const pendingApplications = isHostSession
      ? (detailMap[session.id]?.applications || []).filter((item) => item.status === "pending")
      : [];
    const reviewPanel = renderSessionReviewPanel(session, detailMap[session.id]);

    const actionButtons = [
      `<button class="secondary" onclick="openSessionFromMine('${session.id}')">查看详情</button>`,
    ];
    if (canEdit) actionButtons.push(`<button onclick="openEditSession('${session.id}')">编辑</button>`);
    if (canFinishMine) actionButtons.push(`<button onclick="finishSession('${session.id}')">标记结束</button>`);
    if (canCancel) actionButtons.push(`<button class="danger" onclick="cancelHostedSession('${session.id}')">取消组局</button>`);
    if (canLeaveMine) actionButtons.push(`<button class="danger" onclick="leaveSession('${session.id}')">退出组局</button>`);

    const reviewSection = isHostSession ? `
      <div class="subsection">
        <h4>待审核申请${session.join_mode === "manual" ? `（${pendingApplications.length}）` : ""}</h4>
        ${session.join_mode !== "manual"
          ? "<p class='hint'>当前组局为直接加入模式，无需发起人审核。</p>"
          : pendingApplications.length
            ? pendingApplications.map((application) => `
              <div class="card">
                <strong>${application.applicant?.nickname || application.applicant_id}</strong>
                <p>${application.message || "无备注"}</p>
                <div class="actions">
                  <button onclick="reviewApplication('${application.id}', 'approve')">通过</button>
                  <button class="danger" onclick="reviewApplication('${application.id}', 'reject')">拒绝</button>
                </div>
              </div>
            `).join("")
            : "<p class='hint'>暂无待审核申请。</p>"}
      </div>
    ` : "";

    return `
      <div class="card">
        <div class="mine-session-header">
          <div>
            <strong>${session.title}</strong>
            <p class="meta">
              <span class="badge">${session.game_name}</span>
              <span class="badge ${session.status === "recruiting" ? "good" : session.status === "full" ? "warn" : "bad"}">${session.status}</span>
              <span class="badge">${isHostSession ? "我是发起人" : "我是成员"}</span>
            </p>
          </div>
        </div>
        <p>${session.description || "暂无说明"}</p>
        <p class="meta">
          <span>${fmtTime(session.start_time)}</span>
          <span>${formatSessionLocation(session)}</span>
          <span>人数 ${session.current_members}/${session.max_members}</span>
          <span>场地状态：${session.venue_status}</span>
        </p>
        <div class="actions">${actionButtons.join("")}</div>
        ${reviewSection}
        ${reviewPanel}
      </div>
    `;
  }).join("") || "<p class='meta'>暂无记录</p>";
}

function openSessionFromMine(id) {
  showView("sessions");
  showSession(id).catch((error) => toast(error.message));
}

async function openEditSession(id) {
  const detail = await api(`/api/sessions/${id}`);
  const block = $("#editSessionBlock");
  const form = $("#editSessionForm");
  if (!block || !form) return;

  form.session_id.value = detail.id;
  form.title.value = detail.title || "";
  form.start_time.value = toLocalInputValue(detail.start_time);
  form.end_time.value = toLocalInputValue(detail.end_time);
  form.max_members.value = detail.max_members || "";
  form.description.value = detail.description || "";
  renderVenueSelect("#editVenueSelect", detail.venue_id || "", detail.venue_id ? "请选择场地" : `保持当前地点：${detail.location || "未设置"}`);

  block.style.display = "block";
  block.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveSessionEdit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  const sessionId = payload.session_id;
  delete payload.session_id;
  payload.max_members = Number(payload.max_members);
  if (!payload.venue_id) delete payload.venue_id;
  await api(`/api/sessions/${sessionId}`, {
    method: "PATCH",
    body: payload,
  });
  hideEditSessionPanel();
  toast("组局信息已更新。");
  await refreshSessionViews(sessionId);
}

async function leaveSession(id) {
  const reason = window.prompt("请输入退出原因（可选）", "临时有事");
  if (reason === null) return;
  await api(`/api/sessions/${id}/leave`, {
    method: "POST",
    body: { reason },
  });
  hideEditSessionPanel();
  toast("已退出该组局。");
  await refreshSessionViews(id);
}

async function cancelHostedSession(id) {
  const reason = window.prompt("请输入取消组局原因", "发起人时间调整");
  if (reason === null) return;
  await api(`/api/sessions/${id}/cancel`, {
    method: "POST",
    body: { reason },
  });
  hideEditSessionPanel();
  toast("组局已取消。");
  await refreshSessionViews(id);
}

async function submitSessionReview(event, sessionId) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  payload.score = Number(payload.score);
  payload.content = String(payload.content || "").trim();
  await api(`/api/sessions/${sessionId}/reviews`, {
    method: "POST",
    body: payload,
  });
  toast("评价已提交，信用记录已更新。");
  await refreshSessionViews(sessionId);
}

async function loadMine() {
  if (!state.token) {
    state.notifications = [];
    hideEditSessionPanel();
    renderNavigation();
    $("#mineList").innerHTML = "<p class='meta'>登录后查看</p>";
    $("#notificationList").innerHTML = "<p class='meta'>登录后查看</p>";
    return;
  }

  try {
    const [mine, notifications] = await Promise.all([api("/api/sessions/mine"), api("/api/notifications")]);
    const detailSessions = mine.filter((session) => (
      session.host_id === state.user?.id || session.status === "finished"
    ));
    const details = await Promise.all(
      detailSessions
        .filter((session, index, rows) => rows.findIndex((item) => item.id === session.id) === index)
        .map((session) => api(`/api/sessions/${session.id}`)),
    );
    const detailMap = Object.fromEntries(details.map((detail) => [detail.id, detail]));
    state.notifications = notifications;
    renderNavigation();
    renderMineSessions(mine, detailMap);
    renderNotifications(notifications);
  } catch {
    state.notifications = [];
    hideEditSessionPanel();
    renderNavigation();
    $("#mineList").innerHTML = "<p class='meta'>登录后查看</p>";
    $("#notificationList").innerHTML = "<p class='meta'>登录后查看</p>";
  }
}

async function markNotificationRead(id) {
  const updated = await api(`/api/notifications/${id}`, {
    method: "PATCH",
    body: {},
  });
  if (!updated) {
    toast("通知不存在或无法操作。");
    return;
  }
  state.notifications = state.notifications.map((item) => (item.id === id ? updated : item));
  renderNavigation();
  renderNotifications(state.notifications);
  toast("通知已标为已读。");
}

function renderVenueManager() {
  const block = $("#venueManageBlock");
  if (!block) return;
  block.style.display = isVenueAdmin() ? "block" : "none";
  if (!isVenueAdmin()) resetVenueFormState();
}

function renderVenueCard(venue) {
  const canManage = isVenueAdmin() && venue.manager_id === state.user?.id;
  return `
    <div class="card">
      <strong>${venue.name}</strong>
      <p>${venue.location} · 容量 ${venue.capacity}</p>
      <p class="meta">
        <span class="badge ${venue.status === "active" ? "good" : venue.status === "maintenance" ? "warn" : "bad"}">${venue.status}</span>
        <span>${venue.available_time || "未设置开放时间"}</span>
      </p>
      <p>${venue.description || "暂无说明"}</p>
      <p class="hint">${venue.open_rules || "暂无开放规则"}</p>
      ${canManage ? `
        <div class="actions">
          <button onclick="startVenueEdit('${venue.id}')">编辑</button>
          <button class="danger" onclick="deleteVenueAction('${venue.id}')">删除</button>
        </div>
      ` : ""}
    </div>
  `;
}

function renderReservationCard(reservation) {
  const canReview = isVenueAdmin() && reservation.status === "pending";
  return `
    <div class="card">
      <strong>${reservation.venue?.name || reservation.venue_id}</strong>
      <p>${reservation.session?.title || reservation.session_id}</p>
      <p class="meta">
        <span>${fmtTime(reservation.start_time)} - ${fmtTime(reservation.end_time)}</span>
        <span class="badge ${reservation.status === "approved" ? "good" : reservation.status === "pending" ? "warn" : reservation.status === "cancelled" ? "bad" : ""}">${reservation.status}</span>
      </p>
      ${canReview ? `
        <div class="actions">
          <button onclick="reviewReservation('${reservation.id}', 'approve')">通过</button>
          <button class="danger" onclick="reviewReservation('${reservation.id}', 'reject')">驳回</button>
        </div>
      ` : ""}
    </div>
  `;
}

async function loadVenues() {
  const venuePath = isVenueAdmin() ? "/api/venues?status=" : "/api/venues";
  state.venues = await api(venuePath);
  renderVenueManager();
  renderVenueSelects();
  $("#venueList").innerHTML = state.venues.map(renderVenueCard).join("") || "<p class='meta'>暂无可用场地</p>";

  if (!state.token) {
    $("#reservationList").innerHTML = "<p class='meta'>登录后查看场地预约</p>";
    return;
  }

  try {
    const rows = await api("/api/venue-reservations");
    $("#reservationList").innerHTML = rows.map(renderReservationCard).join("") || "<p class='meta'>暂无预约</p>";
  } catch {
    $("#reservationList").innerHTML = "<p class='meta'>当前账号无可查看的预约记录</p>";
  }
}

async function saveVenue(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  const venueId = payload.venue_id;
  delete payload.venue_id;
  payload.capacity = Number(payload.capacity);

  if (venueId) {
    await api(`/api/venues/${venueId}`, {
      method: "PATCH",
      body: payload,
    });
    toast("场地信息已更新。");
  } else {
    await api("/api/venues", {
      method: "POST",
      body: payload,
    });
    toast("场地已新增。");
  }

  resetVenueFormState();
  await Promise.all([loadVenues(), loadSessions(), loadMine()]);
}

function startVenueEdit(id) {
  const venue = state.venues.find((item) => item.id === id);
  const form = $("#venueForm");
  if (!venue || !form) return;
  form.venue_id.value = venue.id;
  form.name.value = venue.name || "";
  form.location.value = venue.location || "";
  form.capacity.value = venue.capacity || "";
  form.status.value = venue.status || "active";
  form.available_time.value = venue.available_time || "";
  form.open_rules.value = venue.open_rules || "";
  form.description.value = venue.description || "";
  $("#venueSubmitBtn").textContent = "保存场地修改";
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteVenueAction(id) {
  const venue = state.venues.find((item) => item.id === id);
  if (!venue) return;
  const confirmed = window.confirm(`确定删除场地“${venue.name}”吗？相关预约和组局会被自动取消。`);
  if (!confirmed) return;
  await api(`/api/venues/${id}`, {
    method: "DELETE",
  });
  toast("场地已删除，相关组局已同步取消。");
  resetVenueFormState();
  await Promise.all([loadVenues(), loadSessions(), loadMine()]);
}

async function reviewReservation(id, action) {
  await api(`/api/venue-reservations/${id}`, {
    method: "PATCH",
    body: {
      action,
      reason: action === "approve" ? "场地可用" : "该时段无法提供场地",
    },
  });
  toast("场地预约已处理。");
  await loadVenues();
}

async function loadComplaints() {
  if (!state.token) {
    $("#creditPanel").innerHTML = "<p class='meta'>登录后查看信用记录</p>";
    $("#complaintList").innerHTML = "<p class='meta'>登录后查看投诉</p>";
    return;
  }

  try {
    const credit = await api("/api/users/me/credit");
    $("#creditPanel").innerHTML = `<div class="card"><strong>当前信用分：${credit.user.credit_score}</strong></div>`
      + (credit.records.map((record) => `<div class="card">${record.change_value > 0 ? "+" : ""}${record.change_value} · ${record.reason}<p class="meta">${fmtTime(record.created_at)}</p></div>`).join("") || "<p class='meta'>暂无信用流水</p>");
  } catch {
    $("#creditPanel").innerHTML = "<p class='meta'>登录后查看信用记录</p>";
  }

  try {
    const complaints = await api("/api/complaints");
    $("#complaintList").innerHTML = complaints.map((complaint) => {
      const canHandle = isAdmin() && ["pending", "accepted", "need_more"].includes(complaint.status);
      return `
        <div class="card">
          <strong>${complaint.session?.title || complaint.session_id}</strong>
          <p>${complaint.reason}</p>
          <p class="meta">状态：${complaint.status} · 被投诉：${complaint.target_user?.nickname || complaint.target_user_id}</p>
          ${canHandle ? `
            <div class="actions">
              <button onclick="handleComplaint('${complaint.id}', 'accept')">成立并扣分</button>
              <button class="secondary" onclick="handleComplaint('${complaint.id}', 'reject')">驳回</button>
            </div>
          ` : ""}
        </div>
      `;
    }).join("") || "<p class='meta'>暂无投诉</p>";
  } catch {
    $("#complaintList").innerHTML = "<p class='meta'>登录后查看投诉</p>";
  }
}

async function handleComplaint(id, action) {
  await api(`/api/complaints/${id}`, {
    method: "PATCH",
    body: {
      action,
      result: action === "accept" ? "投诉成立，记录信用扣分" : "证据不足，驳回处理",
      credit_change: -10,
    },
  });
  toast("投诉已处理。");
  await loadComplaints();
}

function renderStats(stats) {
  const games = (stats.popular_games || []).map((g) => `<span>${g.name}(${g.count}次)</span>`).join(" ");
  return `
    <div class="stats-grid">
      <div class="stat-item"><span class="stat-num">${stats.users}</span>总用户</div>
      <div class="stat-item"><span class="stat-num">${stats.verified_users}</span>已认证</div>
      <div class="stat-item"><span class="stat-num">${stats.sessions}</span>组局总数</div>
      <div class="stat-item"><span class="stat-num">${stats.recruiting_sessions}</span>招募中</div>
      <div class="stat-item"><span class="stat-num">${stats.finished_sessions}</span>已完结</div>
      <div class="stat-item"><span class="stat-num">${stats.applications}</span>报名申请</div>
      <div class="stat-item"><span class="stat-num">${stats.complaints}</span>投诉总数</div>
      <div class="stat-item"><span class="stat-num">${stats.pending_complaints}</span>待处理</div>
      <div class="stat-item"><span class="stat-num">${stats.credit_changes}</span>信用变更</div>
      <div class="stat-item"><span class="stat-num">${stats.venue_reservations}</span>场地预约</div>
      <div class="stat-item"><span class="stat-num">${stats.pending_venue_reservations}</span>待审核预约</div>
    </div>
    <p class="meta">热门游戏：${games || "暂无数据"}</p>
  `;
}

function renderAuthReviewList(users) {
  const panel = $("#authReviewList");
  if (!panel) return;
  const rows = users
    .filter((user) => user.role === "student" && user.auth_status === "pending")
    .sort((a, b) => new Date(b.auth_submitted_at || 0) - new Date(a.auth_submitted_at || 0));
  panel.innerHTML = rows.map((user) => `
    <div class="card">
      <strong>${user.nickname}</strong>
      <p>账号学号：${user.student_no || "未填写"}</p>
      <p>提交姓名：${user.auth_submission?.real_name || "未填写"}</p>
      <p>提交学号：${user.auth_submission?.student_no || "未填写"}</p>
      <p>联系方式：${user.auth_submission?.contact || "未填写"}</p>
      <p>补充说明：${user.auth_submission?.note || "无"}</p>
      <p class="meta">提交时间：${user.auth_submitted_at ? fmtTime(user.auth_submitted_at) : "暂无"}</p>
      <div class="actions">
        <button onclick="reviewUserAuth('${user.id}', 'approve')">通过</button>
        <button class="danger" onclick="reviewUserAuth('${user.id}', 'reject')">驳回</button>
      </div>
    </div>
  `).join("") || "<p class='meta'>暂无待审核实名认证申请</p>";
}

function renderAccountStatusList(users) {
  const panel = $("#accountStatusList");
  if (!panel) return;
  const rows = users
    .filter((user) => user.id !== state.user?.id)
    .sort((a, b) => a.role.localeCompare(b.role) || a.student_no.localeCompare(b.student_no, "zh-CN"));

  panel.innerHTML = rows.map((user) => {
    const isBanned = user.status === "banned";
    return `
      <div class="card account-status-card">
        <div>
          <strong>${escapeHtml(user.nickname || user.name)}</strong>
          <p class="meta">
            <span>${escapeHtml(user.student_no || user.id)}</span>
            <span>${roleText(user.role)}</span>
            <span class="badge ${accountStatusTone(user.status)}">${accountStatusText(user.status)}</span>
            <span class="badge ${authStatusTone(user.auth_status)}">${authStatusText(user.auth_status)}</span>
          </p>
          ${user.status_reason ? `<p class="hint">处理原因：${escapeHtml(user.status_reason)}</p>` : ""}
        </div>
        <div class="actions">
          ${isBanned
            ? `<button onclick="changeUserBanStatus('${user.id}', 'active')">解除封禁</button>`
            : `<button class="danger" onclick="changeUserBanStatus('${user.id}', 'banned')">封禁账号</button>`}
        </div>
      </div>
    `;
  }).join("") || "<p class='meta'>暂无可管理账号</p>";
}

function renderAdminGameList(games) {
  const panel = $("#gameManageList");
  if (!panel) return;
  const rows = [...games].sort((a, b) => (
    (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1)
    || a.name.localeCompare(b.name, "zh-CN")
  ));

  panel.innerHTML = rows.map((game) => `
    <div class="card admin-game-card">
      <div>
        <strong>${escapeHtml(game.name)}</strong>
        <p class="meta">
          <span class="badge ${gameStatusTone(game.status)}">${gameStatusText(game.status)}</span>
          <span>${escapeHtml(game.type)}</span>
          <span>${Number(game.min_players || 0)}-${Number(game.max_players || 0)}人</span>
          <span>${Number(game.duration_minutes || 0)}分钟</span>
          <span>${escapeHtml(game.difficulty || "未标注")}</span>
        </p>
        <p>${escapeHtml(game.description || "暂无说明")}</p>
        <div class="tag-list">${renderGameTagList(game.tags)}</div>
      </div>
      <div class="actions">
        <button onclick="startGameEdit('${game.id}')">编辑</button>
        ${game.status === "active"
          ? `<button class="danger" onclick="changeGameStatus('${game.id}', 'inactive')">下架</button>`
          : `<button onclick="changeGameStatus('${game.id}', 'active')">上架</button>`}
      </div>
    </div>
  `).join("") || "<p class='meta'>暂无游戏库条目</p>";
}

async function saveGame(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const gameId = values.game_id;
  delete values.game_id;
  const payload = {
    ...values,
    min_players: Number(values.min_players),
    max_players: Number(values.max_players),
    duration_minutes: Number(values.duration_minutes || 120),
    tags: uniqueTags(parseTags(values.tags)),
  };

  if (gameId) {
    await api(`/api/games/${gameId}`, {
      method: "PATCH",
      body: payload,
    });
    toast("游戏条目已更新。");
  } else {
    await api("/api/games", {
      method: "POST",
      body: payload,
    });
    toast("游戏条目已新增。");
  }

  resetGameFormState();
  await Promise.all([loadGames(), loadAdmin()]);
}

function startGameEdit(id) {
  const game = state.adminGames.find((item) => item.id === id);
  const form = $("#gameForm");
  if (!game || !form) return;
  form.game_id.value = game.id;
  form.name.value = game.name || "";
  form.type.value = game.type || "桌游";
  form.min_players.value = game.min_players || "";
  form.max_players.value = game.max_players || "";
  form.duration_minutes.value = game.duration_minutes || 120;
  form.difficulty.value = game.difficulty || "";
  form.status.value = game.status || "active";
  form.tags.value = (game.tags || []).join(", ");
  form.description.value = game.description || "";
  $("#gameSubmitBtn").textContent = "保存游戏修改";
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function changeGameStatus(id, status) {
  const game = state.adminGames.find((item) => item.id === id);
  if (!game) return;
  if (status === "inactive") {
    const confirmed = window.confirm(`确定下架“${game.name}”吗？下架后它不会再出现在发布组局的游戏选择中。`);
    if (!confirmed) return;
  }
  await api(`/api/games/${id}`, {
    method: "PATCH",
    body: { status },
  });
  if ($("#gameForm")?.game_id.value === id) resetGameFormState();
  toast(status === "active" ? "游戏已上架。" : "游戏已下架。");
  await Promise.all([loadGames(), loadAdmin()]);
}

async function reviewUserAuth(userId, action) {
  const reason = action === "approve"
    ? "信息校验通过"
    : window.prompt("请输入驳回原因", "学号或姓名信息不完整") || "";
  if (action === "reject" && !reason.trim()) return;
  await api(`/api/users/${userId}/auth`, {
    method: "PATCH",
    body: { action, reason },
  });
  toast(action === "approve" ? "实名认证已通过。" : "实名认证已驳回。");
  await loadAdmin();
}

async function changeUserBanStatus(userId, status) {
  const isBan = status === "banned";
  const reason = window.prompt(
    isBan ? "请输入封禁原因" : "请输入解除封禁原因",
    isBan ? "违反平台规则" : "管理员复核通过",
  );
  if (reason === null || !reason.trim()) return;
  await api(`/api/users/${userId}/status`, {
    method: "PATCH",
    body: { status, reason },
  });
  toast(isBan ? "账号已封禁。" : "账号已解除封禁。");
  await loadAdmin();
}

async function loadAdmin() {
  try {
    const [stats, logs, users, games] = await Promise.all([api("/api/admin/stats"), api("/api/admin/logs"), api("/api/users"), api("/api/games?includeInactive=true")]);
    state.adminGames = games;
    $("#statsPanel").innerHTML = renderStats(stats);
    renderAuthReviewList(users);
    renderAdminGameList(games);
    renderAccountStatusList(users);
    $("#logList").innerHTML = logs.map((log) => `<div class="card"><strong>${log.action}</strong><p>${log.object_type}:${log.object_id} · ${log.result}</p><p class="meta">${fmtTime(log.created_at)}</p></div>`).join("") || "<p class='meta'>暂无日志</p>";
  } catch (error) {
    $("#statsPanel").innerHTML = `<p class="meta">加载失败：${error.message}</p>`;
    $("#authReviewList").innerHTML = "";
    $("#gameManageList").innerHTML = "";
    $("#accountStatusList").innerHTML = "";
    $("#logList").innerHTML = "";
  }
}

function showView(name) {
  $$(".nav").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${name}`));
  if (name === "auth") loadAuthView().catch((error) => toast(error.message));
  if (name === "mine") loadMine().catch((error) => toast(error.message));
  if (name === "venues") loadVenues().catch((error) => toast(error.message));
  if (name === "complaints") loadComplaints().catch((error) => toast(error.message));
  if (name === "admin") loadAdmin().catch((error) => toast(error.message));
}

function renderAuthGate() {
  const authGate = $("#authGate");
  const appShell = $("#appShell");
  if (authGate) authGate.hidden = Boolean(state.user);
  if (appShell) appShell.hidden = !state.user;
  const name = $("#topbarUserName");
  const role = $("#topbarUserRole");
  if (name) name.textContent = state.user?.nickname || "未登录";
  if (role) role.textContent = state.user ? roleText(state.user.role) : "访客";
}

function switchAuthPanel(mode) {
  const isRegister = mode === "register";
  $("#loginForm").hidden = isRegister;
  $("#registerForm").hidden = !isRegister;
  $("#showLoginPanel").classList.toggle("active", !isRegister);
  $("#showRegisterPanel").classList.toggle("active", isRegister);
}

async function login(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const data = await api("/api/auth/login", {
    method: "POST",
    body: Object.fromEntries(form.entries()),
  });
  state.token = data.token;
  state.user = data.user;
  state.notifications = [];
  localStorage.setItem("cg_token", state.token);
  renderAuthGate();
  renderProfile();
  renderNavigation();
  await loadBootstrap();
  toast(`已登录：${state.user.nickname}`);
}

async function register(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  if (payload.password !== payload.confirm_password) throw new Error("两次输入的密码不一致");
  delete payload.confirm_password;
  const data = await api("/api/auth/register", {
    method: "POST",
    body: payload,
  });
  state.token = data.token;
  state.user = data.user;
  state.notifications = [];
  localStorage.setItem("cg_token", state.token);
  renderAuthGate();
  renderProfile();
  renderNavigation();
  await loadBootstrap();
  toast("注册成功，已进入未认证学生账号。");
}

async function logout() {
  const hadToken = Boolean(state.token);
  try {
    if (hadToken) {
      await api("/api/auth/logout", {
        method: "POST",
        body: {},
      });
    }
  } finally {
    clearLocalSession();
  }
  renderAuthGate();
  renderProfile();
  renderNavigation();
  showView("sessions");
}

window.showSession = showSession;
window.applySession = applySession;
window.reviewApplication = reviewApplication;
window.finishSession = finishSession;
window.createComplaint = createComplaint;
window.openSessionFromMine = openSessionFromMine;
window.openEditSession = openEditSession;
window.leaveSession = leaveSession;
window.cancelHostedSession = cancelHostedSession;
window.submitSessionReview = submitSessionReview;
window.markNotificationRead = markNotificationRead;
window.startVenueEdit = startVenueEdit;
window.deleteVenueAction = deleteVenueAction;
window.reviewReservation = reviewReservation;
window.handleComplaint = handleComplaint;
window.reviewUserAuth = reviewUserAuth;
window.startGameEdit = startGameEdit;
window.changeGameStatus = changeGameStatus;
window.changeUserBanStatus = changeUserBanStatus;
window.showAuthFeatureUnavailable = showAuthFeatureUnavailable;
window.openProfileDialog = openProfileDialog;
window.addRecommendedTag = addRecommendedTag;
window.selectAvatar = selectAvatar;
window.showMemberProfile = showMemberProfile;

$("#loginForm").addEventListener("submit", (event) => login(event).catch((error) => toast(error.message)));
$("#registerForm").addEventListener("submit", (event) => register(event).catch((error) => toast(error.message)));
$("#showLoginPanel").addEventListener("click", () => switchAuthPanel("login"));
$("#showRegisterPanel").addEventListener("click", () => switchAuthPanel("register"));
$("#logoutBtn").addEventListener("click", () => logout().catch((error) => toast(error.message)));
$("#refreshSessions").addEventListener("click", () => loadSessions().catch((error) => toast(error.message)));
$("#typeFilter").addEventListener("change", () => loadSessions().catch((error) => toast(error.message)));
$("#tagFilter").addEventListener("change", () => loadSessions().catch((error) => toast(error.message)));
$("#keywordFilter").addEventListener("input", () => loadSessions().catch((error) => toast(error.message)));
$("#createSessionForm").addEventListener("submit", (event) => createSession(event).catch((error) => toast(error.message)));
$("#profileEditForm").addEventListener("submit", (event) => saveProfileEdit(event).catch((error) => toast(error.message)));
$("#editSessionForm").addEventListener("submit", (event) => saveSessionEdit(event).catch((error) => toast(error.message)));
$("#venueForm").addEventListener("submit", (event) => saveVenue(event).catch((error) => toast(error.message)));
$("#gameForm").addEventListener("submit", (event) => saveGame(event).catch((error) => toast(error.message)));
$("#closeEditSession").addEventListener("click", hideEditSessionPanel);
$("#closeProfileDialog").addEventListener("click", closeProfileDialog);
$("#profileDialog").addEventListener("click", (event) => {
  if (event.target.id === "profileDialog") closeProfileDialog();
});
$("#changeAvatarBtn").addEventListener("click", openAvatarDialog);
$("#closeAvatarDialog").addEventListener("click", closeAvatarDialog);
$("#cancelAvatarDialog").addEventListener("click", closeAvatarDialog);
$("#uploadAvatarBtn").addEventListener("click", openAvatarFilePicker);
$("#avatarFileInput").addEventListener("change", (event) => handleAvatarFileSelected(event).catch((error) => toast(error.message)));
$("#avatarDialog").addEventListener("click", (event) => {
  if (event.target.id === "avatarDialog") closeAvatarDialog();
});
$("#closeMemberProfileDialog").addEventListener("click", closeMemberProfileDialog);
$("#memberProfileDialog").addEventListener("click", (event) => {
  if (event.target.id === "memberProfileDialog") closeMemberProfileDialog();
});
$("#resetVenueForm").addEventListener("click", resetVenueFormState);
$("#resetGameForm").addEventListener("click", resetGameFormState);
$("#refreshAuth").addEventListener("click", () => loadAuthView().catch((error) => toast(error.message)));
$("#refreshMine").addEventListener("click", () => loadMine().catch((error) => toast(error.message)));
$("#refreshVenues").addEventListener("click", () => loadVenues().catch((error) => toast(error.message)));
$("#refreshComplaints").addEventListener("click", () => loadComplaints().catch((error) => toast(error.message)));
$("#refreshAdmin").addEventListener("click", () => loadAdmin().catch((error) => toast(error.message)));
$$(".nav").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));

setDefaultTimes();
renderAuthGate();
loadMe()
  .then(() => {
    renderAuthGate();
    if (!state.user) return null;
    renderNavigation();
    return loadBootstrap();
  })
  .catch((error) => toast(error.message));
