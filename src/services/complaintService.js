const { badRequest, conflict, forbidden, notFound } = require("../errors");
const { normalizeText, nowIso, requireFields } = require("../utils");

class ComplaintService {
  constructor(store, userService, sessionService, notificationService, logService) {
    this.store = store;
    this.userService = userService;
    this.sessionService = sessionService;
    this.notificationService = notificationService;
    this.logService = logService;
  }

  create(user, payload) {
    this.userService.requireVerified(user);
    requireFields(payload, ["session_id", "target_user_id", "reason"]);
    const session = this.store.get("game_sessions", payload.session_id);
    if (!session) throw notFound("关联组局不存在");
    const members = this.store.all("session_members").filter((member) => member.session_id === session.id);
    if (!members.some((member) => member.user_id === user.id)) throw forbidden("只有组局成员可以提交投诉");
    const targetId = normalizeText(payload.target_user_id);
    if (!members.some((member) => member.user_id === targetId)) throw badRequest("被投诉人必须是本次组局成员");
    if (targetId === user.id) throw badRequest("不能投诉自己");
    const complaint = this.store.insert("complaints", {
      reporter_id: user.id,
      target_user_id: targetId,
      session_id: session.id,
      reason: normalizeText(payload.reason),
      evidence: normalizeText(payload.evidence),
      status: "pending",
      result: "",
      created_at: nowIso(),
      handled_by: null,
      handled_at: null,
    });
    const admins = this.store.all("users").filter((item) => item.role === "admin" && item.status === "active");
    this.notificationService.bulk(
      admins.map((item) => item.id),
      {
        type: "complaint_pending",
        title: "新的投诉待处理",
        content: `${user.nickname} 提交了关于「${session.title}」的投诉。`,
        related_type: "complaint",
        related_id: complaint.id,
      },
    );
    return complaint;
  }

  list(user, query = {}) {
    this.userService.requireLogin(user);
    let rows = this.store.all("complaints");
    if (user.role !== "admin") {
      rows = rows.filter((item) => item.reporter_id === user.id || item.target_user_id === user.id);
    }
    const status = normalizeText(query.status);
    if (status) rows = rows.filter((item) => item.status === status);
    return rows
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map((item) => this.withRefs(item, user));
  }

  handle(user, complaintId, payload) {
    this.userService.requireRole(user, "admin");
    const complaint = this.store.get("complaints", complaintId);
    if (!complaint) throw notFound("投诉记录不存在");
    if (!["pending", "accepted"].includes(complaint.status)) throw conflict("该投诉已经处理完成");
    const action = normalizeText(payload.action);
    if (!["accept", "reject", "need_more"].includes(action)) throw badRequest("投诉处理动作必须为 accept、reject 或 need_more");
    let status = "accepted";
    let change = 0;
    if (action === "accept") {
      status = "finished";
      change = Number(payload.credit_change ?? -10);
      if (!Number.isFinite(change) || change > 0) throw badRequest("投诉成立时信用变更应为非正数");
      this.sessionService.addCreditRecord(complaint.target_user_id, complaint.session_id, change, normalizeText(payload.result) || "投诉成立", complaint.id);
    } else if (action === "reject") {
      status = "rejected";
    } else {
      status = "need_more";
    }
    const updated = this.store.update("complaints", complaint.id, {
      status,
      result: normalizeText(payload.result),
      handled_by: user.id,
      handled_at: nowIso(),
    });
    const session = this.store.get("game_sessions", complaint.session_id);
    this.notificationService.bulk([complaint.reporter_id, complaint.target_user_id], {
      type: "complaint_result",
      title: "投诉处理结果已更新",
      content: `关于「${session?.title || "相关组局"}」的投诉处理状态：${status}。${normalizeText(payload.result)}`,
      related_type: "complaint",
      related_id: complaint.id,
    });
    this.logService.record(user, "handle_complaint", "complaint", complaint.id, status);
    return this.withRefs(updated, user);
  }

  withRefs(item, viewer) {
    return {
      ...item,
      reporter: this.userService.publicUser(this.store.get("users", item.reporter_id), viewer),
      target_user: this.userService.publicUser(this.store.get("users", item.target_user_id), viewer),
      session: this.store.get("game_sessions", item.session_id),
      handler: item.handled_by ? this.userService.publicUser(this.store.get("users", item.handled_by), viewer) : null,
    };
  }
}

module.exports = { ComplaintService };
