const fs = require("node:fs");
const path = require("node:path");
const { badRequest, conflict, forbidden, notFound, unauthorized } = require("../errors");
const { ensureDir, maskStudentNo, normalizeText, nowIso } = require("../utils");
const { DEFAULT_INITIAL_PASSWORD, hashPassword, verifyPassword } = require("../security/password");
const { createSessionToken, hashSessionToken, sessionExpiresAt } = require("../security/sessionToken");

const AVATAR_OPTIONS = new Set([
  "default.png",
  "adm.png",
  "1.png",
  "2.png",
  "3.png",
  "4.png",
  "5.png",
  "6.png",
  "7.png",
  "8.png",
  "9.png",
  "10.png",
]);

const AVATAR_UPLOAD_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/webp", "webp"],
]);

const MAX_AVATAR_BYTES = 512 * 1024;
const UPLOADED_AVATAR_PATTERN = /^uploads\/[A-Za-z0-9_-]+-\d+\.(png|jpg|jpeg|webp)$/;
const NICKNAME_PATTERN = /^[\p{Script=Han}A-Za-z0-9_-]{2,20}$/u;
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d)\S{6,20}$/;

class UserService {
  constructor(store, profilePhotoDir = null) {
    this.store = store;
    this.profilePhotoDir = profilePhotoDir;
    this.ensurePasswordHashes();
  }

  publicUser(user, viewer = null) {
    if (!user) return null;
    const isSelf = viewer && viewer.id === user.id;
    const isAdmin = viewer && viewer.role === "admin";
    const canViewAuth = isSelf || isAdmin;
    // 学号、联系方式和审核材料只对本人或管理员可见，公开视图只返回脱敏信息。
    return {
      id: user.id,
      name: user.name,
      nickname: user.nickname,
      role: user.role,
      auth_status: user.auth_status,
      credit_score: user.credit_score,
      status: user.status,
      avatar: user.avatar || "default.png",
      tags: user.tags || [],
      student_no: canViewAuth ? user.student_no : maskStudentNo(user.student_no),
      contact: canViewAuth ? user.contact : undefined,
      auth_submission: canViewAuth
        ? {
            real_name: user.auth_submission_name || "",
            student_no: user.auth_submission_student_no || "",
            contact: user.auth_submission_contact || "",
            note: user.auth_submission_note || "",
          }
        : undefined,
      status_reason: canViewAuth ? user.status_reason || "" : undefined,
      auth_submitted_at: canViewAuth ? user.auth_submitted_at || null : undefined,
      auth_review_reason: canViewAuth ? user.auth_review_reason || "" : undefined,
      auth_reviewed_at: canViewAuth ? user.auth_reviewed_at || null : undefined,
      created_at: user.created_at,
    };
  }

  list(viewer) {
    this.requireRole(viewer, "admin");
    return this.store.all("users").map((user) => this.publicUser(user, viewer));
  }

  getById(id) {
    return this.store.get("users", id);
  }

  login({ nickname, password }) {
    const normalizedNickname = normalizeText(nickname);
    this.validateNickname(normalizedNickname);
    this.validatePassword(password);
    const user = this.store.all("users").find((row) => row.nickname === normalizedNickname);
    if (!user || !verifyPassword(password, user.password_hash)) throw unauthorized("昵称或密码错误");
    if (user.status === "banned") throw forbidden("账号已被封禁，无法登录");
    return {
      token: this.createSession(user.id),
      user: this.publicUser(user, user),
    };
  }

  register(payload) {
    const nickname = normalizeText(payload.nickname);
    const password = String(payload.password || "");
    this.validateNickname(nickname);
    this.validatePassword(password);
    this.ensureNicknameAvailable(nickname);
    const user = this.store.insert("users", {
      student_no: "",
      name: nickname,
      nickname,
      role: "student",
      avatar: "default.png",
      auth_status: "unverified",
      credit_score: 100,
      status: "active",
      tags: [],
      contact: "",
      auth_submission_name: "",
      auth_submission_student_no: "",
      auth_submission_contact: "",
      auth_submission_note: "",
      auth_submitted_at: null,
      auth_review_reason: "",
      auth_reviewed_at: null,
      password_hash: hashPassword(password),
      created_at: nowIso(),
    });
    return {
      token: this.createSession(user.id),
      user: this.publicUser(user, user),
    };
  }

  logout(token) {
    const session = this.findSessionByToken(token);
    if (!session) throw unauthorized("登录状态已失效");
    this.store.update("auth_sessions", session.id, {
      revoked_at: nowIso(),
    });
    return { logged_out: true };
  }

  userForSession(token) {
    const session = this.findActiveSession(token);
    if (!session) return null;
    return this.getById(session.user_id);
  }

  current(user) {
    this.requireLogin(user);
    return this.publicUser(user, user);
  }

  updateProfile(user, payload) {
    this.requireLogin(user);
    const nickname = normalizeText(payload.nickname ?? user.nickname);
    this.validateNickname(nickname);
    this.ensureNicknameAvailable(nickname, user.id);
    const tags = Array.isArray(payload.tags)
      ? payload.tags.map(normalizeText).filter(Boolean).slice(0, 8)
      : user.tags || [];
    const contact = normalizeText(payload.contact ?? user.contact);
    const avatar = normalizeText(payload.avatar ?? user.avatar ?? "default.png");
    if (!this.isAllowedAvatar(avatar)) throw badRequest("头像选项不存在");
    const updated = this.store.update("users", user.id, {
      nickname,
      tags,
      contact,
      avatar,
      updated_at: nowIso(),
    });
    return this.publicUser(updated, updated);
  }

  changePassword(user, payload) {
    this.requireLogin(user);
    const oldPassword = String(payload.old_password || "");
    const newPassword = String(payload.new_password || "");
    this.validatePassword(oldPassword);
    this.validatePassword(newPassword);
    const current = this.store.get("users", user.id);
    if (!current || !verifyPassword(oldPassword, current.password_hash)) {
      throw unauthorized("旧密码不正确");
    }
    if (oldPassword === newPassword) throw badRequest("新密码不能与旧密码相同");
    this.store.update("users", user.id, {
      password_hash: hashPassword(newPassword),
      updated_at: nowIso(),
    });
    return { changed: true };
  }

  uploadAvatar(user, payload) {
    this.requireLogin(user);
    if (!this.profilePhotoDir) throw badRequest("头像存储目录未配置");
    const { mime, buffer } = this.parseAvatarImage(payload.image || payload.data_url);
    const ext = AVATAR_UPLOAD_TYPES.get(mime);
    const uploadDir = path.join(this.profilePhotoDir, "uploads");
    ensureDir(uploadDir);
    const fileName = `${user.id}-${Date.now()}.${ext}`;
    const relativePath = `uploads/${fileName}`;
    fs.writeFileSync(path.join(uploadDir, fileName), buffer);
    const updated = this.store.update("users", user.id, {
      avatar: relativePath,
      updated_at: nowIso(),
    });
    return this.publicUser(updated, updated);
  }

  parseAvatarImage(value) {
    const text = normalizeText(value);
    const match = text.match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) throw badRequest("头像图片格式不正确");
    const mime = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
    if (!AVATAR_UPLOAD_TYPES.has(mime)) throw badRequest("仅支持 PNG、JPG、WEBP 头像");
    const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
    if (!buffer.length || buffer.length > MAX_AVATAR_BYTES) throw badRequest("头像图片不能超过 512KB");
    // 不能只相信 data URL 里的 MIME，需要校验文件头，避免伪装格式的上传内容。
    if (!this.hasValidImageSignature(buffer, mime)) throw badRequest("头像图片内容与格式不匹配");
    return { mime, buffer };
  }

  hasValidImageSignature(buffer, mime) {
    if (mime === "image/png") {
      return buffer.length > 8
        && buffer[0] === 0x89
        && buffer[1] === 0x50
        && buffer[2] === 0x4e
        && buffer[3] === 0x47;
    }
    if (mime === "image/jpeg") {
      return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    }
    if (mime === "image/webp") {
      return buffer.length > 12
        && buffer.toString("ascii", 0, 4) === "RIFF"
        && buffer.toString("ascii", 8, 12) === "WEBP";
    }
    return false;
  }

  isAllowedAvatar(avatar) {
    if (AVATAR_OPTIONS.has(avatar)) return true;
    if (!UPLOADED_AVATAR_PATTERN.test(avatar)) return false;
    if (!this.profilePhotoDir) return false;
    return fs.existsSync(path.join(this.profilePhotoDir, avatar));
  }

  submitAuth(user, payload) {
    this.requireRole(user, "student");
    if (user.auth_status === "verified") throw conflict("当前账号已完成实名认证，无需重复提交");
    const realName = normalizeText(payload.real_name);
    const studentNo = normalizeText(payload.student_no);
    const contact = normalizeText(payload.contact ?? user.contact);
    const note = normalizeText(payload.note);
    if (!realName || realName.length < 2 || realName.length > 20) {
      throw badRequest("真实姓名长度应为 2-20 个字符");
    }
    if (!studentNo || studentNo.length < 4 || studentNo.length > 32) {
      throw badRequest("学号格式不合法");
    }
    const isPendingUpdate = user.auth_status === "pending" && user.auth_submitted_at;
    const updated = this.store.update("users", user.id, {
      auth_status: "pending",
      auth_submission_name: realName,
      auth_submission_student_no: studentNo,
      auth_submission_contact: contact,
      auth_submission_note: note,
      auth_submitted_at: isPendingUpdate ? user.auth_submitted_at : nowIso(),
      auth_review_reason: isPendingUpdate ? user.auth_review_reason || "" : "",
      auth_reviewed_at: isPendingUpdate ? user.auth_reviewed_at || null : null,
      updated_at: nowIso(),
    });
    return this.publicUser(updated, updated);
  }

  reviewAuth(viewer, userId, payload) {
    this.requireRole(viewer, "admin");
    const target = this.store.get("users", userId);
    if (!target) throw notFound("待审核用户不存在");
    const action = normalizeText(payload.action);
    if (!["approve", "reject"].includes(action)) throw badRequest("认证审核动作必须为 approve 或 reject");
    const auth_status = action === "approve" ? "verified" : "rejected";
    const updated = this.store.update("users", target.id, {
      auth_status,
      auth_review_reason: normalizeText(payload.reason),
      auth_reviewed_at: nowIso(),
      updated_at: nowIso(),
    });
    return this.publicUser(updated, viewer);
  }

  changeAccountStatus(viewer, userId, payload) {
    this.requireRole(viewer, "admin");
    const target = this.store.get("users", userId);
    if (!target) throw notFound("用户不存在");
    const status = normalizeText(payload.status);
    if (!["active", "muted", "limited", "banned"].includes(status)) {
      throw badRequest("账号状态必须为 active、muted、limited 或 banned");
    }
    if (target.id === viewer.id && status === "banned") {
      throw badRequest("不能封禁当前登录账号");
    }
    const updated = this.store.update("users", target.id, {
      status,
      status_reason: normalizeText(payload.reason),
      updated_at: nowIso(),
    });
    return this.publicUser(updated, viewer);
  }

  validateNickname(nickname) {
    if (!NICKNAME_PATTERN.test(nickname)) {
      throw badRequest("昵称需为 2-20 位中文、字母、数字、下划线或短横线");
    }
  }

  validatePassword(password) {
    if (!PASSWORD_PATTERN.test(String(password || ""))) {
      throw badRequest("密码需为 6-20 位，不能包含空格，且至少包含字母和数字");
    }
  }

  ensureNicknameAvailable(nickname, selfId = null) {
    const exists = this.store.all("users").some((user) => user.nickname === nickname && user.id !== selfId);
    if (exists) throw conflict("昵称已被使用");
  }

  ensurePasswordHashes() {
    const users = this.store.all("users");
    const missing = users.filter((user) => !user.password_hash);
    // 兼容旧版演示数据：启动时为没有密码哈希的账号补默认初始密码。
    for (const user of missing) {
      this.store.update("users", user.id, {
        password_hash: hashPassword(DEFAULT_INITIAL_PASSWORD),
        updated_at: user.updated_at || nowIso(),
      });
    }
  }

  createSession(userId) {
    const token = createSessionToken();
    // 原始 token 只返回给客户端，服务端只保存哈希，数据文件泄露时也不能直接复用登录态。
    this.store.insert("auth_sessions", {
      user_id: userId,
      token_hash: hashSessionToken(token),
      created_at: nowIso(),
      expires_at: sessionExpiresAt(),
      revoked_at: null,
    });
    return token;
  }

  findSessionByToken(token) {
    const normalized = normalizeText(token);
    if (!normalized) return null;
    const tokenHash = hashSessionToken(normalized);
    return this.store.all("auth_sessions").find((session) => session.token_hash === tokenHash) || null;
  }

  findActiveSession(token) {
    const session = this.findSessionByToken(token);
    if (!session || session.revoked_at) return null;
    if (!session.expires_at || new Date(session.expires_at).getTime() <= Date.now()) return null;
    return session;
  }

  requireLogin(user) {
    if (!user) throw unauthorized();
    if (user.status === "banned") throw forbidden("账号已被封禁，无法执行该操作");
    return user;
  }

  requireVerified(user) {
    this.requireLogin(user);
    if (user.auth_status !== "verified") throw forbidden("请先完成实名认证");
    if (user.status !== "active") throw forbidden("当前账号状态不允许执行此操作");
    return user;
  }

  requireRole(user, role) {
    this.requireLogin(user);
    if (user.role !== role) throw forbidden(`该操作仅允许 ${role} 角色执行`);
    return user;
  }

  requireAnyRole(user, roles) {
    this.requireLogin(user);
    if (!roles.includes(user.role)) throw forbidden(`该操作仅允许 ${roles.join("/")} 角色执行`);
    return user;
  }
}

module.exports = { UserService };
