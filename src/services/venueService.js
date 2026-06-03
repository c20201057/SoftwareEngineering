const { badRequest, conflict, forbidden, notFound } = require("../errors");
const { normalizeText, nowIso, overlaps, parseDate, requireFields } = require("../utils");

class VenueService {
  constructor(store, userService, notificationService, logService) {
    this.store = store;
    this.userService = userService;
    this.notificationService = notificationService;
    this.logService = logService;
  }

  list(query = {}) {
    const status = normalizeText(query.status || "active");
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
        .sort((a, b) => new Date(a.start_time) - new Date(b.start_time)),
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
      const updated = this.store.update("venues", id, record);
      this.logService.record(user, "update_venue", "venue", id);
      return updated;
    }
    const created = this.store.insert("venues", { ...record, created_at: nowIso() });
    this.logService.record(user, "create_venue", "venue", created.id);
    return created;
  }

  requestReservation(user, payload) {
    this.userService.requireVerified(user);
    requireFields(payload, ["session_id", "venue_id", "start_time", "end_time"]);
    const session = this.store.get("game_sessions", payload.session_id);
    if (!session) throw notFound("关联组局不存在");
    if (session.host_id !== user.id) throw forbidden("只有组局发起人可以申请场地");
    const venue = this.store.get("venues", payload.venue_id);
    if (!venue) throw notFound("场地不存在");
    if (venue.status !== "active") throw conflict("该场地当前不可预约");
    if (session.max_members > venue.capacity) throw conflict("申请人数超过场地容量");
    const start = parseDate(payload.start_time, "预约开始时间");
    const end = parseDate(payload.end_time, "预约结束时间");
    if (start >= end) throw badRequest("预约结束时间必须晚于开始时间");
    if (start < new Date()) throw badRequest("不能申请已经过去的场地时段");
    this.ensureNoVenueConflict(venue.id, start.toISOString(), end.toISOString());
    const existing = this.store
      .all("venue_reservations")
      .find((item) => item.session_id === session.id && ["pending", "approved"].includes(item.status));
    if (existing) throw conflict("该组局已经存在待审核或已通过的场地申请");
    const reservation = this.store.insert("venue_reservations", {
      venue_id: venue.id,
      session_id: session.id,
      applicant_id: user.id,
      reviewer_id: null,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      status: "pending",
      review_reason: normalizeText(payload.reason),
      created_at: nowIso(),
      reviewed_at: null,
    });
    this.store.update("game_sessions", session.id, { venue_status: "pending", updated_at: nowIso() });
    this.notificationService.create(venue.manager_id, {
      type: "venue_request",
      title: "新的场地预约申请",
      content: `${user.nickname} 为「${session.title}」申请 ${venue.name}。`,
      related_type: "venue_reservation",
      related_id: reservation.id,
    });
    return reservation;
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
        location: action === "approve" ? venue.location : session.location,
        updated_at: nowIso(),
      });
      const members = this.store.all("session_members").filter((member) => member.session_id === session.id);
      this.notificationService.bulk(
        members.map((member) => member.user_id),
        {
          type: "venue_review",
          title: action === "approve" ? "场地申请已通过" : "场地申请被驳回",
          content: `「${session.title}」的场地申请${action === "approve" ? "已通过" : "未通过"}：${normalizeText(payload.reason) || "无补充说明"}`,
          related_type: "venue_reservation",
          related_id: reservation.id,
        },
      );
    }
    this.logService.record(user, "review_venue_reservation", "venue_reservation", reservation.id, action);
    return this.withReservationRefs(updated);
  }

  ensureNoVenueConflict(venueId, start, end, ignoreId = null) {
    const conflictRow = this.store
      .all("venue_reservations")
      .find((item) => item.id !== ignoreId && item.venue_id === venueId && item.status === "approved" && overlaps(start, end, item.start_time, item.end_time));
    if (conflictRow) {
      throw conflict("该场地在申请时段内已有通过预约", { reservation_id: conflictRow.id });
    }
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
