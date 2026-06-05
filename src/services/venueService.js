const { badRequest, conflict, forbidden, notFound } = require("../errors");
const { normalizeText, nowIso, overlaps, parseDate, requireFields } = require("../utils");

const ACTIVE_RESERVATION_STATUSES = ["pending", "approved"];

class VenueService {
  constructor(store, userService, notificationService, logService) {
    this.store = store;
    this.userService = userService;
    this.notificationService = notificationService;
    this.logService = logService;
  }

  list(query = {}) {
    const status = query.status === "" ? "" : normalizeText(query.status || "active");
    return this.store
      .all("venues")
      .filter((venue) => !status || venue.status === status)
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }

  detail(id) {
    const venue = this.store.get("venues", id);
    if (!venue) throw notFound("场地不存在");
    return {
      ...venue,
      reservations: this.store
        .all("venue_reservations")
        .filter((item) => item.venue_id === id)
        .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
        .map((item) => this.withReservationRefs(item)),
    };
  }

  createOrUpdate(user, payload, id = null) {
    this.userService.requireRole(user, "venue_admin");
    requireFields(payload, ["name", "location", "capacity"]);

    const capacity = Number(payload.capacity);
    if (!Number.isInteger(capacity) || capacity < 1) throw badRequest("场地容量必须为正整数");

    const record = {
      name: normalizeText(payload.name),
      location: normalizeText(payload.location),
      capacity,
      manager_id: user.id,
      available_time: normalizeText(payload.available_time || "待设置"),
      open_rules: normalizeText(payload.open_rules),
      status: normalizeText(payload.status || "active"),
      description: normalizeText(payload.description),
      updated_at: nowIso(),
    };

    if (id) {
      const current = this.store.get("venues", id);
      if (!current) throw notFound("场地不存在");
      this.requireVenueManager(user, current);
      this.ensureCapacitySupportsReservations(id, capacity);
      const updated = this.store.update("venues", id, record);
      this.syncVenueLabelToSessions(updated);
      this.logService.record(user, "update_venue", "venue", id);
      return updated;
    }

    const created = this.store.insert("venues", { ...record, created_at: nowIso() });
    this.logService.record(user, "create_venue", "venue", created.id);
    return created;
  }

  remove(user, id) {
    this.userService.requireRole(user, "venue_admin");
    const venue = this.store.get("venues", id);
    if (!venue) throw notFound("场地不存在");
    this.requireVenueManager(user, venue);

    const relatedReservations = this.store
      .all("venue_reservations")
      .filter((item) => item.venue_id === id && item.status !== "cancelled");

    const relatedSessionIds = [...new Set(relatedReservations.map((item) => item.session_id))];
    const cancelReason = `场地 ${venue.name} 已删除，组局自动取消`;

    for (const reservation of relatedReservations) {
      this.store.update("venue_reservations", reservation.id, {
        status: "cancelled",
        reviewer_id: user.id,
        review_reason: cancelReason,
        reviewed_at: nowIso(),
      });
    }

    for (const sessionId of relatedSessionIds) {
      const session = this.store.get("game_sessions", sessionId);
      if (!session || ["cancelled", "finished"].includes(session.status)) continue;
      this.store.update("game_sessions", session.id, {
        status: "cancelled",
        venue_status: "cancelled",
        cancel_reason: cancelReason,
        updated_at: nowIso(),
      });

      const impactedUserIds = this.collectImpactedUserIds(session.id);
      this.notificationService.bulk(impactedUserIds, {
        type: "session_cancelled",
        title: "组局因场地删除已取消",
        content: `《${session.title}》因场地“${venue.name}”被删除而取消，请重新安排。`,
        related_type: "game_session",
        related_id: session.id,
      });
    }

    this.store.remove("venues", id);
    this.logService.record(user, "delete_venue", "venue", id);
    return {
      deleted: true,
      venue_id: id,
      cancelled_reservations: relatedReservations.length,
      cancelled_sessions: relatedSessionIds.length,
    };
  }

  requestReservation(user, payload) {
    this.userService.requireVerified(user);
    requireFields(payload, ["session_id", "venue_id", "start_time", "end_time"]);

    const session = this.store.get("game_sessions", payload.session_id);
    if (!session) throw notFound("关联组局不存在");
    if (session.host_id !== user.id) throw forbidden("只有组局发起人可以申请场地");
    if (["cancelled", "finished"].includes(session.status)) throw conflict("该组局当前状态不可申请场地");

    const activeReservation = this.getSessionReservation(session.id);
    if (activeReservation?.status === "approved") throw conflict("该组局已绑定场地，无需重复申请");

    const venue = this.validateVenueSelection(payload.venue_id, {
      start_time: payload.start_time,
      end_time: payload.end_time,
      max_members: session.max_members,
      ignore_reservation_id: activeReservation?.id || null,
    });

    if (activeReservation && ACTIVE_RESERVATION_STATUSES.includes(activeReservation.status)) {
      throw conflict("该组局已经存在待审核或已通过的场地申请");
    }

    const reservation = this.store.insert("venue_reservations", {
      venue_id: venue.id,
      session_id: session.id,
      applicant_id: user.id,
      reviewer_id: null,
      start_time: new Date(payload.start_time).toISOString(),
      end_time: new Date(payload.end_time).toISOString(),
      status: "pending",
      review_reason: normalizeText(payload.reason),
      created_at: nowIso(),
      reviewed_at: null,
    });

    this.store.update("game_sessions", session.id, {
      venue_status: "pending",
      location: this.describeVenue(venue),
      updated_at: nowIso(),
    });

    this.notificationService.create(venue.manager_id, {
      type: "venue_request",
      title: "新的场地预约申请",
      content: `${user.nickname} 为《${session.title}》申请了 ${venue.name}。`,
      related_type: "venue_reservation",
      related_id: reservation.id,
    });
    return this.withReservationRefs(reservation);
  }

  listReservations(user, query = {}) {
    this.userService.requireAnyRole(user, ["venue_admin", "admin", "student"]);
    let rows = this.store.all("venue_reservations");
    if (user.role === "venue_admin") {
      const venueIds = this.store
        .all("venues")
        .filter((venue) => venue.manager_id === user.id)
        .map((venue) => venue.id);
      rows = rows.filter((item) => venueIds.includes(item.venue_id));
    } else if (user.role === "student") {
      rows = rows.filter((item) => item.applicant_id === user.id);
    }

    const status = normalizeText(query.status);
    if (status) rows = rows.filter((item) => item.status === status);

    return rows
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map((item) => this.withReservationRefs(item));
  }

  reviewReservation(user, reservationId, payload) {
    this.userService.requireRole(user, "venue_admin");
    const reservation = this.store.get("venue_reservations", reservationId);
    if (!reservation) throw notFound("预约申请不存在");
    if (reservation.status !== "pending") throw conflict("该预约申请已经处理过");

    const venue = this.store.get("venues", reservation.venue_id);
    this.requireVenueManager(user, venue);

    const action = normalizeText(payload.action);
    if (!["approve", "reject"].includes(action)) throw badRequest("场地审核动作必须为 approve 或 reject");
    if (action === "approve") {
      this.ensureNoVenueConflict(venue.id, reservation.start_time, reservation.end_time, reservation.id);
    }

    const updated = this.store.update("venue_reservations", reservation.id, {
      status: action === "approve" ? "approved" : "rejected",
      reviewer_id: user.id,
      review_reason: normalizeText(payload.reason),
      reviewed_at: nowIso(),
    });

    const session = this.store.get("game_sessions", reservation.session_id);
    if (session) {
      this.store.update("game_sessions", session.id, {
        venue_status: action === "approve" ? "approved" : "rejected",
        location: action === "approve" ? this.describeVenue(venue) : session.location,
        updated_at: nowIso(),
      });
      const members = this.store.all("session_members").filter((member) => member.session_id === session.id);
      this.notificationService.bulk(
        members.map((member) => member.user_id),
        {
          type: "venue_review",
          title: action === "approve" ? "场地申请已通过" : "场地申请被驳回",
          content: `《${session.title}》的场地申请${action === "approve" ? "已通过" : "未通过"}，${normalizeText(payload.reason) || "无补充说明"}。`,
          related_type: "venue_reservation",
          related_id: reservation.id,
        },
      );
    }

    this.logService.record(user, "review_venue_reservation", "venue_reservation", reservation.id, action);
    return this.withReservationRefs(updated);
  }

  validateVenueSelection(venueId, { start_time, end_time, max_members, ignore_reservation_id = null } = {}) {
    const venue = this.getBookableVenue(venueId);

    const start = parseDate(start_time, "预约开始时间");
    const end = parseDate(end_time, "预约结束时间");
    if (start >= end) throw badRequest("预约结束时间必须晚于开始时间");
    if (start < new Date()) throw badRequest("不能预约已过去的时间段");

    const maxMembers = Number(max_members || 0);
    if (maxMembers > venue.capacity) throw conflict("组局人数上限超过场地容量");

    this.ensureNoVenueConflict(venue.id, start.toISOString(), end.toISOString(), ignore_reservation_id);
    return venue;
  }

  upsertApprovedReservation(session, venue, applicantId, reservationId = null) {
    const reservation = reservationId
      ? this.store.get("venue_reservations", reservationId)
      : this.getSessionReservation(session.id);

    const patch = {
      venue_id: venue.id,
      session_id: session.id,
      applicant_id: applicantId,
      start_time: session.start_time,
      end_time: session.end_time,
      status: "approved",
      review_reason: "发布组局时自动锁定场地",
      reviewer_id: null,
      reviewed_at: nowIso(),
    };

    if (reservation) {
      return this.store.update("venue_reservations", reservation.id, patch);
    }

    return this.store.insert("venue_reservations", {
      ...patch,
      created_at: nowIso(),
    });
  }

  cancelReservationForSession(sessionId, reason, reviewerId = null) {
    const reservation = this.getSessionReservation(sessionId);
    if (!reservation || reservation.status === "cancelled") return reservation;
    return this.store.update("venue_reservations", reservation.id, {
      status: "cancelled",
      reviewer_id: reviewerId,
      review_reason: normalizeText(reason),
      reviewed_at: nowIso(),
    });
  }

  getSessionReservation(sessionId) {
    const rows = this.store
      .all("venue_reservations")
      .filter((item) => item.session_id === sessionId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return rows.find((item) => ACTIVE_RESERVATION_STATUSES.includes(item.status)) || rows[0] || null;
  }

  getBookableVenue(venueId) {
    const venue = this.store.get("venues", normalizeText(venueId));
    if (!venue) throw notFound("场地不存在");
    if (venue.status !== "active") throw conflict("该场地当前不可预约");
    return venue;
  }

  describeVenue(venue) {
    return `${venue.name} · ${venue.location}`;
  }

  ensureNoVenueConflict(venueId, start, end, ignoreId = null) {
    const conflictRow = this.store
      .all("venue_reservations")
      .find((item) => item.id !== ignoreId
        && item.venue_id === venueId
        && item.status === "approved"
        && overlaps(start, end, item.start_time, item.end_time));
    if (conflictRow) {
      throw conflict("该场地在所选时段内已被预约", { reservation_id: conflictRow.id });
    }
  }

  ensureCapacitySupportsReservations(venueId, capacity) {
    const oversized = this.store
      .all("venue_reservations")
      .filter((item) => item.venue_id === venueId && ACTIVE_RESERVATION_STATUSES.includes(item.status))
      .map((item) => ({
        reservation: item,
        session: this.store.get("game_sessions", item.session_id),
      }))
      .find(({ session }) => session && !["cancelled", "finished"].includes(session.status) && Number(session.max_members) > capacity);

    if (oversized) {
      throw conflict(`新的场地容量不足以容纳已预约组局《${oversized.session.title}》的人数上限`);
    }
  }

  syncVenueLabelToSessions(venue) {
    const sessionIds = this.store
      .all("venue_reservations")
      .filter((item) => item.venue_id === venue.id && ACTIVE_RESERVATION_STATUSES.includes(item.status))
      .map((item) => item.session_id);

    for (const sessionId of [...new Set(sessionIds)]) {
      const session = this.store.get("game_sessions", sessionId);
      if (!session || ["cancelled", "finished"].includes(session.status)) continue;
      this.store.update("game_sessions", session.id, {
        location: this.describeVenue(venue),
        updated_at: nowIso(),
      });
    }
  }

  collectImpactedUserIds(sessionId) {
    const memberIds = this.store
      .all("session_members")
      .filter((member) => member.session_id === sessionId)
      .map((member) => member.user_id);
    const applicantIds = this.store
      .all("session_applications")
      .filter((item) => item.session_id === sessionId && ["pending", "approved"].includes(item.status))
      .map((item) => item.applicant_id);
    return [...new Set([...memberIds, ...applicantIds])];
  }

  requireVenueManager(user, venue) {
    if (!venue) throw notFound("场地不存在");
    if (venue.manager_id !== user.id) throw forbidden("只能维护或审核自己负责的场地");
  }

  withReservationRefs(item) {
    return {
      ...item,
      venue: this.store.get("venues", item.venue_id),
      session: this.store.get("game_sessions", item.session_id),
      applicant: this.store.get("users", item.applicant_id),
      reviewer: item.reviewer_id ? this.store.get("users", item.reviewer_id) : null,
    };
  }
}

module.exports = { VenueService };
