const { badRequest, conflict, forbidden, notFound } = require("../errors");
const { normalizeText, nowIso, overlaps, parseDate, requireFields } = require("../utils");

class SessionService {
  constructor(store, userService, gameService, notificationService, logService, venueService = null) {
    this.store = store;
    this.userService = userService;
    this.gameService = gameService;
    this.notificationService = notificationService;
    this.logService = logService;
    this.venueService = venueService;
  }

  list(query = {}) {
    const status = normalizeText(query.status || "recruiting");
    const type = normalizeText(query.type);
    const keyword = normalizeText(query.keyword).toLowerCase();
    const sessions = this.store.all("game_sessions");
    return sessions
      .filter((session) => !status || session.status === status)
      .filter((session) => {
        const game = this.store.get("game_libs", session.game_id);
        const location = this.resolveSessionLocation(session);
        if (type && game?.type !== type) return false;
        if (!keyword) return true;
        return `${session.title} ${session.description} ${location} ${game?.name || ""}`.toLowerCase().includes(keyword);
      })
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
      .map((session) => this.sessionSummary(session));
  }

  mine(user) {
    this.userService.requireLogin(user);
    const memberSessionIds = this.store
      .all("session_members")
      .filter((member) => member.user_id === user.id)
      .map((member) => member.session_id);
    return this.store
      .all("game_sessions")
      .filter((session) => session.host_id === user.id || memberSessionIds.includes(session.id))
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
      .map((session) => this.sessionSummary(session));
  }

  detail(id, viewer = null) {
    const session = this.store.get("game_sessions", id);
    if (!session) throw notFound("组局不存在");
    const game = this.store.get("game_libs", session.game_id);
    const host = this.store.get("users", session.host_id);
    const members = this.store
      .all("session_members")
      .filter((member) => member.session_id === id)
      .map((member) => ({
        ...member,
        user: this.userService.publicUser(this.store.get("users", member.user_id), viewer),
      }));
    const applications = this.store
      .all("session_applications")
      .filter((item) => item.session_id === id)
      .map((item) => ({
        ...item,
        applicant: this.userService.publicUser(this.store.get("users", item.applicant_id), viewer),
      }));
    const memberIds = new Set(members.map((member) => member.user_id));
    const canViewAllReviews = viewer?.role === "admin";
    const canViewOwnReviews = viewer && memberIds.has(viewer.id);
    const reviews = this.store
      .all("reviews")
      .filter((item) => item.session_id === id)
      .filter((item) => (
        canViewAllReviews
        || (canViewOwnReviews && (item.reviewer_id === viewer.id || item.target_user_id === viewer.id))
      ))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map((item) => ({
        ...item,
        reviewer: this.userService.publicUser(this.store.get("users", item.reviewer_id), viewer),
        target_user: this.userService.publicUser(this.store.get("users", item.target_user_id), viewer),
      }));
    const reservation = this.resolveSessionReservation(id);
    const venue = reservation ? this.store.get("venues", reservation.venue_id) : null;
    return {
      ...session,
      location: this.resolveSessionLocation(session, reservation, venue),
      game,
      host: this.userService.publicUser(host, viewer),
      members,
      applications,
      reviews,
      venue,
      venue_id: reservation?.venue_id || null,
      venue_reservation: reservation ? this.decorateReservation(reservation) : null,
    };
  }

  create(user, payload) {
    this.userService.requireVerified(user);
    requireFields(payload, ["game_id", "title", "start_time", "end_time", "venue_id", "max_members"]);
    if (user.status === "limited") throw forbidden("当前账号被限制发布组局");

    const game = this.gameService.getActive(payload.game_id);
    const start = parseDate(payload.start_time, "活动开始时间");
    const end = parseDate(payload.end_time, "活动结束时间");
    if (start >= end) throw badRequest("活动结束时间必须晚于开始时间");
    if (start < new Date()) throw badRequest("不能发布已经开始或过期的组局");

    const maxMembers = Number(payload.max_members);
    if (!Number.isInteger(maxMembers) || maxMembers < game.min_players || maxMembers > game.max_players) {
      throw badRequest(`人数上限应在 ${game.min_players}-${game.max_players} 之间`);
    }

    const joinMode = normalizeText(payload.join_mode || "manual");
    if (!["manual", "direct"].includes(joinMode)) throw badRequest("加入方式必须为 manual 或 direct");

    const venue = this.requireVenueSelection(payload.venue_id, {
      start: start.toISOString(),
      end: end.toISOString(),
      maxMembers,
    });

    const session = this.store.insert("game_sessions", {
      host_id: user.id,
      game_id: game.id,
      title: normalizeText(payload.title),
      description: normalizeText(payload.description),
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      location: this.venueService.describeVenue(venue),
      max_members: maxMembers,
      current_members: 1,
      min_credit_required: Number(payload.min_credit_required || 80),
      join_mode: joinMode,
      status: "recruiting",
      venue_status: "approved",
      created_at: nowIso(),
      updated_at: nowIso(),
    });

    this.store.insert("session_members", {
      session_id: session.id,
      user_id: user.id,
      member_role: "host",
      join_time: nowIso(),
      checkin_status: "pending",
    });

    this.venueService.upsertApprovedReservation(session, venue, user.id);
    this.logService.record(user, "create_session", "game_session", session.id);
    return this.detail(session.id, user);
  }

  update(user, id, payload) {
    const session = this.store.get("game_sessions", id);
    if (!session) throw notFound("组局不存在");
    this.requireHost(user, session);
    if (!["recruiting", "full"].includes(session.status)) throw conflict("只有招募中或满员的组局可以编辑");

    const currentReservation = this.resolveSessionReservation(session.id);
    const currentVenueId = currentReservation?.venue_id || "";
    const nextVenueId = payload.venue_id === undefined
      ? currentVenueId
      : normalizeText(payload.venue_id);

    const patch = { updated_at: nowIso() };
    let hasTimeChanged = false;
    let hasVenueChanged = false;

    if (payload.title !== undefined) patch.title = normalizeText(payload.title);
    if (payload.description !== undefined) patch.description = normalizeText(payload.description);
    if (payload.location !== undefined && !currentReservation && payload.venue_id === undefined) {
      patch.location = normalizeText(payload.location);
    }

    const start = parseDate(payload.start_time || session.start_time, "活动开始时间");
    const end = parseDate(payload.end_time || session.end_time, "活动结束时间");
    if (start >= end) throw badRequest("活动结束时间必须晚于开始时间");
    if (payload.start_time !== undefined || payload.end_time !== undefined) {
      patch.start_time = start.toISOString();
      patch.end_time = end.toISOString();
      hasTimeChanged = patch.start_time !== session.start_time || patch.end_time !== session.end_time;
    }

    let maxMembers = Number(session.max_members);
    if (payload.max_members !== undefined) {
      maxMembers = Number(payload.max_members);
      if (!Number.isInteger(maxMembers) || maxMembers < session.current_members) {
        throw badRequest("人数上限不能小于当前成员数");
      }
      patch.max_members = maxMembers;
      patch.status = session.current_members >= maxMembers ? "full" : "recruiting";
    }

    let venue = null;
    if (nextVenueId) {
      venue = this.requireVenueSelection(nextVenueId, {
        start: patch.start_time || session.start_time,
        end: patch.end_time || session.end_time,
        maxMembers,
        ignoreReservationId: currentReservation?.id || null,
      });
      patch.location = this.venueService.describeVenue(venue);
      patch.venue_status = "approved";
      hasVenueChanged = nextVenueId !== currentVenueId;
    }

    const updated = this.store.update("game_sessions", id, patch);
    if (venue) {
      this.venueService.upsertApprovedReservation(updated, venue, user.id, currentReservation?.id || null);
    }

    if (hasTimeChanged) {
      this.notifyMembers(session.id, {
        type: "session_changed",
        title: "组局时间发生变更",
        content: `${updated.title} 的活动时间已更新，请及时确认。`,
        related_type: "game_session",
        related_id: session.id,
      });
    }

    if (hasVenueChanged) {
      this.notifyMembers(session.id, {
        type: "session_changed",
        title: "组局地点发生变更",
        content: `${updated.title} 的活动地点已更新为 ${updated.location}。`,
        related_type: "game_session",
        related_id: session.id,
      });
    }

    this.logService.record(user, "update_session", "game_session", id);
    return this.detail(updated.id, user);
  }

  apply(user, sessionId, payload = {}) {
    this.userService.requireVerified(user);
    const session = this.store.get("game_sessions", sessionId);
    if (!session) throw notFound("组局不存在");
    this.ensureCanJoin(user, session);

    if (session.join_mode === "direct") {
      this.addMember(session, user, "player");
      this.notificationService.create(user.id, {
        type: "application_approved",
        title: "报名成功",
        content: `你已加入《${session.title}》。`,
        related_type: "game_session",
        related_id: session.id,
      });
      this.notificationService.create(session.host_id, {
        type: "member_joined",
        title: "有新成员加入",
        content: `${user.nickname} 已加入《${session.title}》。`,
        related_type: "game_session",
        related_id: session.id,
      });
      return this.detail(session.id, user);
    }

    const existing = this.store
      .all("session_applications")
      .find((item) => item.session_id === session.id && item.applicant_id === user.id && item.status === "pending");
    if (existing) throw conflict("你已经提交过待审核申请");

    const application = this.store.insert("session_applications", {
      session_id: session.id,
      applicant_id: user.id,
      message: normalizeText(payload.message),
      status: "pending",
      apply_time: nowIso(),
      review_time: null,
      review_reason: "",
    });

    this.notificationService.create(session.host_id, {
      type: "application_pending",
      title: "有新的报名申请",
      content: `${user.nickname} 申请加入《${session.title}》。`,
      related_type: "session_application",
      related_id: application.id,
    });
    return application;
  }

  reviewApplication(user, applicationId, payload) {
    const application = this.store.get("session_applications", applicationId);
    if (!application) throw notFound("报名申请不存在");
    const session = this.store.get("game_sessions", application.session_id);
    if (!session) throw notFound("关联组局不存在");
    this.requireHost(user, session);
    if (application.status !== "pending") throw conflict("该申请已经处理过");

    const action = normalizeText(payload.action);
    if (!["approve", "reject"].includes(action)) throw badRequest("审核动作必须为 approve 或 reject");

    const applicant = this.store.get("users", application.applicant_id);
    if (action === "approve") {
      this.ensureCanJoin(applicant, session);
      this.addMember(session, applicant, "player");
    }

    const updated = this.store.update("session_applications", application.id, {
      status: action === "approve" ? "approved" : "rejected",
      review_time: nowIso(),
      review_reason: normalizeText(payload.reason),
    });

    this.notificationService.create(application.applicant_id, {
      type: action === "approve" ? "application_approved" : "application_rejected",
      title: action === "approve" ? "报名申请已通过" : "报名申请被拒绝",
      content: `你对《${session.title}》的报名申请${action === "approve" ? "已通过" : "未通过"}。`,
      related_type: "session_application",
      related_id: application.id,
    });
    this.logService.record(user, "review_application", "session_application", application.id, action);
    return updated;
  }

  leave(user, sessionId, payload = {}) {
    this.userService.requireVerified(user);
    const session = this.store.get("game_sessions", sessionId);
    if (!session) throw notFound("组局不存在");
    if (session.host_id === user.id) throw forbidden("发起人不能直接退出自己创建的组局，请取消组局");

    const member = this.store
      .all("session_members")
      .find((item) => item.session_id === session.id && item.user_id === user.id);
    if (!member) throw notFound("你不是该组局成员");

    this.store.remove("session_members", member.id);
    const newCount = Math.max(0, session.current_members - 1);
    this.store.update("game_sessions", session.id, {
      current_members: newCount,
      status: session.status === "full" ? "recruiting" : session.status,
      updated_at: nowIso(),
    });

    const hoursBefore = (new Date(session.start_time) - new Date()) / 1000 / 3600;
    if (hoursBefore < 12) {
      this.addCreditRecord(user.id, session.id, -5, normalizeText(payload.reason) || "活动开始前 12 小时内退出");
    }

    this.notificationService.create(session.host_id, {
      type: "member_left",
      title: "成员退出组局",
      content: `${user.nickname} 已退出《${session.title}》。`,
      related_type: "game_session",
      related_id: session.id,
    });
    return { left: true };
  }

  cancel(user, sessionId, payload = {}) {
    const session = this.store.get("game_sessions", sessionId);
    if (!session) throw notFound("组局不存在");
    this.requireHost(user, session);
    if (["cancelled", "finished"].includes(session.status)) throw conflict("该组局状态不允许取消");

    const reason = normalizeText(payload.reason);
    const updated = this.store.update("game_sessions", session.id, {
      status: "cancelled",
      cancel_reason: reason,
      updated_at: nowIso(),
    });

    if (this.venueService) {
      this.venueService.cancelReservationForSession(session.id, reason || "组局已取消", user.id);
    }

    this.notifyMembers(session.id, {
      type: "session_cancelled",
      title: "组局已取消",
      content: `《${session.title}》已取消，原因：${reason || "未填写"}`,
      related_type: "game_session",
      related_id: session.id,
    });
    this.logService.record(user, "cancel_session", "game_session", session.id);
    return updated;
  }

  finish(user, sessionId) {
    const session = this.store.get("game_sessions", sessionId);
    if (!session) throw notFound("组局不存在");
    this.requireHost(user, session);
    const updated = this.store.update("game_sessions", session.id, {
      status: "finished",
      updated_at: nowIso(),
    });
    this.notifyMembers(session.id, {
      type: "session_finished",
      title: "组局已结束，可进行互评",
      content: `《${session.title}》已结束，请在个人中心完成互评。`,
      related_type: "game_session",
      related_id: session.id,
    });
    return updated;
  }

  createReview(user, sessionId, payload) {
    this.userService.requireVerified(user);
    const session = this.store.get("game_sessions", sessionId);
    if (!session) throw notFound("组局不存在");
    if (session.status !== "finished") throw conflict("只有已结束的组局可以评价");

    const members = this.store.all("session_members").filter((item) => item.session_id === session.id);
    if (!members.some((member) => member.user_id === user.id)) throw forbidden("只有实际成员可以评价");

    const targetId = normalizeText(payload.target_user_id);
    if (!members.some((member) => member.user_id === targetId)) throw badRequest("被评价人必须是本次组局成员");
    if (targetId === user.id) throw badRequest("不能评价自己");

    const duplicate = this.store
      .all("reviews")
      .find((item) => item.session_id === session.id && item.reviewer_id === user.id && item.target_user_id === targetId);
    if (duplicate) throw conflict("不能重复评价同一成员");

    const score = Number(payload.score);
    if (!Number.isInteger(score) || score < 1 || score > 5) throw badRequest("评分必须为 1-5 的整数");

    const review = this.store.insert("reviews", {
      session_id: session.id,
      reviewer_id: user.id,
      target_user_id: targetId,
      score,
      content: normalizeText(payload.content),
      created_at: nowIso(),
    });
    if (score >= 4) this.addCreditRecord(targetId, session.id, 1, "活动互评表现良好");
    if (score <= 2) this.addCreditRecord(targetId, session.id, -2, "活动互评较低");
    return review;
  }

  addCreditRecord(userId, sessionId, changeValue, reason, complaintId = null) {
    const user = this.store.get("users", userId);
    if (!user) throw notFound("信用记录关联用户不存在");
    const record = this.store.insert("credit_records", {
      user_id: userId,
      session_id: sessionId,
      complaint_id: complaintId,
      change_value: changeValue,
      reason,
      created_at: nowIso(),
    });
    const nextScore = Math.max(0, Math.min(120, Number(user.credit_score || 0) + Number(changeValue)));
    this.store.update("users", userId, { credit_score: nextScore, updated_at: nowIso() });
    return record;
  }

  creditForUser(user) {
    this.userService.requireLogin(user);
    return {
      user: this.userService.publicUser(this.store.get("users", user.id), user),
      records: this.store
        .all("credit_records")
        .filter((record) => record.user_id === user.id)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    };
  }

  sessionSummary(session) {
    const game = this.store.get("game_libs", session.game_id);
    const host = this.store.get("users", session.host_id);
    const reservation = this.resolveSessionReservation(session.id);
    const venue = reservation ? this.store.get("venues", reservation.venue_id) : null;
    return {
      ...session,
      location: this.resolveSessionLocation(session, reservation, venue),
      game_name: game?.name || "",
      game_type: game?.type || "",
      host_nickname: host?.nickname || host?.name || "",
      seats_left: Math.max(0, session.max_members - session.current_members),
      venue_id: reservation?.venue_id || null,
      venue_name: venue?.name || "",
      venue_location: venue?.location || "",
    };
  }

  ensureCanJoin(user, session) {
    if (!user) throw forbidden("用户不存在");
    if (user.id === session.host_id) throw conflict("发起人已经在成员名单中");
    if (session.status !== "recruiting") throw conflict("该组局当前不可报名");
    if (user.credit_score < session.min_credit_required) throw forbidden("信用分不足，无法加入该组局");
    if (session.current_members >= session.max_members) throw conflict("该组局名额已满");

    const members = this.store.all("session_members");
    if (members.some((member) => member.session_id === session.id && member.user_id === user.id)) {
      throw conflict("你已经是该组局成员");
    }

    const joinedSessions = members
      .filter((member) => member.user_id === user.id)
      .map((member) => this.store.get("game_sessions", member.session_id))
      .filter(Boolean)
      .filter((item) => ["recruiting", "full"].includes(item.status));
    for (const joined of joinedSessions) {
      if (overlaps(session.start_time, session.end_time, joined.start_time, joined.end_time)) {
        throw conflict(`活动时间与《${joined.title}》冲突`);
      }
    }
  }

  addMember(session, user, role) {
    const member = this.store.insert("session_members", {
      session_id: session.id,
      user_id: user.id,
      member_role: role,
      join_time: nowIso(),
      checkin_status: "pending",
    });
    const nextCount = session.current_members + 1;
    this.store.update("game_sessions", session.id, {
      current_members: nextCount,
      status: nextCount >= session.max_members ? "full" : "recruiting",
      updated_at: nowIso(),
    });
    return member;
  }

  requireHost(user, session) {
    this.userService.requireLogin(user);
    if (user.id !== session.host_id) throw forbidden("只有组局发起人可以执行该操作");
  }

  notifyMembers(sessionId, payload) {
    const members = this.store.all("session_members").filter((member) => member.session_id === sessionId);
    return this.notificationService.bulk(
      members.map((member) => member.user_id),
      payload,
    );
  }

  requireVenueSelection(venueId, { start, end, maxMembers, ignoreReservationId = null }) {
    if (!this.venueService) throw badRequest("当前未配置场地服务");
    return this.venueService.validateVenueSelection(venueId, {
      start_time: start,
      end_time: end,
      max_members: maxMembers,
      ignore_reservation_id: ignoreReservationId,
    });
  }

  resolveSessionReservation(sessionId) {
    if (this.venueService && typeof this.venueService.getSessionReservation === "function") {
      return this.venueService.getSessionReservation(sessionId);
    }
    return this.store
      .all("venue_reservations")
      .filter((item) => item.session_id === sessionId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
  }

  resolveSessionLocation(session, reservation = null, venue = null) {
    if (!reservation) reservation = this.resolveSessionReservation(session.id);
    if (!venue && reservation) venue = this.store.get("venues", reservation.venue_id);
    if (venue && this.venueService) return this.venueService.describeVenue(venue);
    return session.location;
  }

  decorateReservation(reservation) {
    return {
      ...reservation,
      venue: this.store.get("venues", reservation.venue_id),
      session: this.store.get("game_sessions", reservation.session_id),
      applicant: this.store.get("users", reservation.applicant_id),
      reviewer: reservation.reviewer_id ? this.store.get("users", reservation.reviewer_id) : null,
    };
  }
}

module.exports = { SessionService };
