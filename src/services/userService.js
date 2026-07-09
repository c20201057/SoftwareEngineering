const { badRequest, conflict, forbidden, notFound, unauthorized } = require("../errors");
const { maskStudentNo, normalizeText, nowIso } = require("../utils");

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

class UserService {
  constructor(store) {
    this.store = store;
  }

  publicUser(user, viewer = null) {
    if (!user) return null;
    const isSelf = viewer && viewer.id === user.id;
    const isAdmin = viewer && viewer.role === "admin";
    const canViewAuth = isSelf || isAdmin;
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

  login({ student_no, user_id }) {
    let user = null;
    if (user_id) {
      user = this.store.get("users", user_id);
    } else if (student_no) {
      user = this.store.all("users").find((row) => row.student_no === student_no);
    }
    if (!user) throw unauthorized("账号不存在，请检查演示学号或用户编号");
    if (user.status === "banned") throw forbidden("账号已被封禁，无法登录");
    return {
      token: user.id,
      user: this.publicUser(user, user),
    };
  }

  current(user) {
    this.requireLogin(user);
    return this.publicUser(user, user);
  }

  updateProfile(user, payload) {
    this.requireLogin(user);
    const nickname = normalizeText(payload.nickname ?? user.nickname);
    if (!nickname || nickname.length > 30) throw badRequest("昵称不能为空且不能超过 30 个字符");
    const tags = Array.isArray(payload.tags)
      ? payload.tags.map(normalizeText).filter(Boolean).slice(0, 8)
      : user.tags || [];
    const contact = normalizeText(payload.contact ?? user.contact);
    const avatar = normalizeText(payload.avatar ?? user.avatar ?? "default.png");
    if (!AVATAR_OPTIONS.has(avatar)) throw badRequest("头像选项不存在");
    const updated = this.store.update("users", user.id, {
      nickname,
      tags,
      contact,
      avatar,
      updated_at: nowIso(),
    });
    return this.publicUser(updated, updated);
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
