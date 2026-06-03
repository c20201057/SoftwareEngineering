const { badRequest, forbidden, notFound, unauthorized } = require("../errors");
const { maskStudentNo, normalizeText, nowIso } = require("../utils");

class UserService {
  constructor(store) {
    this.store = store;
  }

  publicUser(user, viewer = null) {
    if (!user) return null;
    const isSelf = viewer && viewer.id === user.id;
    const isAdmin = viewer && viewer.role === "admin";
    return {
      id: user.id,
      name: user.name,
      nickname: user.nickname,
      role: user.role,
      auth_status: user.auth_status,
      credit_score: user.credit_score,
      status: user.status,
      tags: user.tags || [],
      student_no: isSelf || isAdmin ? user.student_no : maskStudentNo(user.student_no),
      contact: isSelf || isAdmin ? user.contact : undefined,
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
    if (!user) throw unauthorized();
    return this.publicUser(user, user);
  }

  updateProfile(user, payload) {
    if (!user) throw unauthorized();
    const nickname = normalizeText(payload.nickname ?? user.nickname);
    if (!nickname || nickname.length > 30) throw badRequest("昵称不能为空且不能超过 30 个字符");
    const tags = Array.isArray(payload.tags)
      ? payload.tags.map(normalizeText).filter(Boolean).slice(0, 8)
      : user.tags || [];
    const contact = normalizeText(payload.contact ?? user.contact);
    const updated = this.store.update("users", user.id, {
      nickname,
      tags,
      contact,
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
    const updated = this.store.update("users", target.id, {
      status,
      status_reason: normalizeText(payload.reason),
      updated_at: nowIso(),
    });
    return this.publicUser(updated, viewer);
  }

  requireLogin(user) {
    if (!user) throw unauthorized();
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
