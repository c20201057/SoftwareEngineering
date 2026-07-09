const assert = require("node:assert/strict");
const test = require("node:test");
const { nowIso } = require("../src/utils");
const {
  createFutureWindow,
  createTestServer,
  loginAs,
  request,
  sessionPayload,
} = require("../test-utils/helpers");

test("game library and venue management APIs enforce admin and manager rules", async (t) => {
  const ctx = await createTestServer();
  let nextDay = 70;
  const nextPayload = (overrides = {}) => {
    nextDay += 1;
    return sessionPayload({ daysFromNow: nextDay, ...overrides });
  };

  try {
    const adminToken = await loginAs(ctx, "10001");
    const studentToken = await loginAs(ctx, "11001");
    const secondStudentToken = await loginAs(ctx, "11002");
    const venueToken = await loginAs(ctx, "10002");

    const otherVenueAdmin = ctx.app.store.insert("users", {
      id: "10003",
      student_no: "venue002",
      name: "Other Venue Manager",
      nickname: "OtherVenueManager",
      role: "venue_admin",
      avatar: "adm.png",
      auth_status: "verified",
      credit_score: 100,
      status: "active",
      tags: [],
      contact: "other-venue@example.edu",
      created_at: nowIso(),
    });
    const otherVenueToken = ctx.app.services.userService.createSession(otherVenueAdmin.id);

    await t.test("public game list only includes active games", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/games");
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.every((game) => game.status === "active"), true);
    });

    await t.test("anonymous includeInactive game list requires login", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/games?includeInactive=true");
      assert.equal(result.status, 401);
    });

    await t.test("student includeInactive game list is forbidden", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/games?includeInactive=true", undefined, studentToken);
      assert.equal(result.status, 403);
    });

    await t.test("anonymous users cannot create games", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/games", {
        name: "No Role Game",
        type: "party",
        min_players: 2,
        max_players: 4,
      });
      assert.equal(result.status, 401);
    });

    await t.test("students cannot create games", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/games", {
        name: "Student Game",
        type: "party",
        min_players: 2,
        max_players: 4,
      }, studentToken);
      assert.equal(result.status, 403);
    });

    await t.test("game creation requires core fields", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/games", { name: "Missing Ranges" }, adminToken);
      assert.equal(result.status, 400);
    });

    await t.test("game creation rejects min greater than max", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/games", {
        name: "Bad Range",
        type: "party",
        min_players: 5,
        max_players: 4,
      }, adminToken);
      assert.equal(result.status, 400);
    });

    await t.test("game creation rejects non-positive duration", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/games", {
        name: "Bad Duration",
        type: "party",
        min_players: 2,
        max_players: 4,
        duration_minutes: 0,
      }, adminToken);
      assert.equal(result.status, 400);
    });

    await t.test("game creation rejects invalid status", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/games", {
        name: "Bad Status",
        type: "party",
        min_players: 2,
        max_players: 4,
        status: "archived",
      }, adminToken);
      assert.equal(result.status, 400);
    });

    let managedGameId;
    await t.test("admin can create an active game with normalized tags", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/games", {
        name: "Logic Duel",
        type: "party",
        min_players: 2,
        max_players: 5,
        duration_minutes: 45,
        difficulty: "easy",
        description: "A quick logic game",
        tags: [" quick ", "", "logic"],
      }, adminToken);
      assert.equal(result.status, 201);
      assert.deepEqual(result.payload.data.tags, ["quick", "logic"]);
      managedGameId = result.payload.data.id;
    });

    await t.test("game type filter returns matching custom games", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/games?type=party");
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.some((game) => game.id === managedGameId), true);
      assert.equal(result.payload.data.every((game) => game.type === "party"), true);
    });

    await t.test("game keyword filter searches names and tags", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/games?keyword=logic");
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.some((game) => game.id === managedGameId), true);
    });

    await t.test("students cannot update games", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/games/${managedGameId}`, { status: "inactive" }, studentToken);
      assert.equal(result.status, 403);
    });

    await t.test("game update rejects invalid player range", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/games/${managedGameId}`, { min_players: 6 }, adminToken);
      assert.equal(result.status, 400);
    });

    await t.test("admin can downlist a game without deleting it", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/games/${managedGameId}`, { status: "inactive" }, adminToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.status, "inactive");
    });

    await t.test("downlisted game is hidden from public game list", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/games");
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.some((game) => game.id === managedGameId), false);
    });

    await t.test("admin includeInactive can still see downlisted game", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/games?includeInactive=true", undefined, adminToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.some((game) => game.id === managedGameId && game.status === "inactive"), true);
    });

    await t.test("downlisted game cannot be used for publishing", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/sessions", nextPayload({ game_id: managedGameId, max_members: 4 }), studentToken);
      assert.equal(result.status, 404);
    });

    await t.test("public venue list defaults to active venues", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/venues");
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.every((venue) => venue.status === "active"), true);
    });

    await t.test("anonymous users cannot create venues", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/venues", {
        name: "No Login Room",
        location: "Building A",
        capacity: 8,
      });
      assert.equal(result.status, 401);
    });

    await t.test("students cannot create venues", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/venues", {
        name: "Student Room",
        location: "Building A",
        capacity: 8,
      }, studentToken);
      assert.equal(result.status, 403);
    });

    await t.test("venue creation requires core fields", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/venues", { name: "Missing Capacity" }, venueToken);
      assert.equal(result.status, 400);
    });

    await t.test("venue creation rejects zero capacity", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/venues", {
        name: "Zero Room",
        location: "Building A",
        capacity: 0,
      }, venueToken);
      assert.equal(result.status, 400);
    });

    await t.test("venue creation rejects non-integer capacity", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/venues", {
        name: "Float Room",
        location: "Building A",
        capacity: 3.5,
      }, venueToken);
      assert.equal(result.status, 400);
    });

    let managedVenueId;
    await t.test("venue admin can create a managed venue", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/venues", {
        name: "Automation Room",
        location: "Test Building 301",
        capacity: 9,
        available_time: "09:00-22:00",
        open_rules: "Keep clean",
        description: "For automated tests",
      }, venueToken);
      assert.equal(result.status, 201);
      assert.equal(result.payload.data.manager_id, "10002");
      managedVenueId = result.payload.data.id;
    });

    await t.test("venue manager can update own venue", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/venues/${managedVenueId}`, {
        name: "Automation Room Updated",
        location: "Test Building 302",
        capacity: 9,
        status: "active",
        available_time: "10:00-22:00",
        open_rules: "Book first",
        description: "Updated",
      }, venueToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.location, "Test Building 302");
    });

    await t.test("other venue manager cannot update someone else's venue", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/venues/${managedVenueId}`, {
        name: "Hijacked Room",
        location: "Other Building",
        capacity: 9,
      }, otherVenueToken);
      assert.equal(result.status, 403);
    });

    await t.test("other venue manager cannot delete someone else's venue", async () => {
      const result = await request(ctx.baseUrl, "DELETE", `/api/venues/${managedVenueId}`, undefined, otherVenueToken);
      assert.equal(result.status, 403);
    });

    await t.test("venue detail includes reservation array", async () => {
      const result = await request(ctx.baseUrl, "GET", `/api/venues/${managedVenueId}`);
      assert.equal(result.status, 200);
      assert.ok(Array.isArray(result.payload.data.reservations));
    });

    let venueBoundSession;
    await t.test("selected venue can be bound by a published session", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/sessions", nextPayload({
        venue_id: managedVenueId,
        max_members: 6,
      }), studentToken);
      assert.equal(result.status, 201);
      venueBoundSession = result.payload.data;
      assert.equal(venueBoundSession.venue_id, managedVenueId);
    });

    await t.test("venue capacity cannot be reduced below active reservation needs", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/venues/${managedVenueId}`, {
        name: "Automation Room Small",
        location: "Test Building 302",
        capacity: 5,
        status: "active",
      }, venueToken);
      assert.equal(result.status, 409);
    });

    await t.test("status empty venue list can include non-active venues", async () => {
      const patched = await request(ctx.baseUrl, "PATCH", "/api/venues/v2", {
        name: ctx.app.store.get("venues", "v2").name,
        location: ctx.app.store.get("venues", "v2").location,
        capacity: ctx.app.store.get("venues", "v2").capacity,
        status: "maintenance",
      }, venueToken);
      assert.equal(patched.status, 200);
      const result = await request(ctx.baseUrl, "GET", "/api/venues?status=");
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.some((venue) => venue.id === "v2" && venue.status === "maintenance"), true);
    });

    await t.test("inactive or maintenance venue cannot be selected", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/sessions", nextPayload({ venue_id: "v2", max_members: 6 }), studentToken);
      assert.equal(result.status, 409);
      await request(ctx.baseUrl, "PATCH", "/api/venues/v2", {
        name: ctx.app.store.get("venues", "v2").name,
        location: ctx.app.store.get("venues", "v2").location,
        capacity: ctx.app.store.get("venues", "v2").capacity,
        status: "active",
      }, venueToken);
    });

    await t.test("reservation list requires login", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/venue-reservations");
      assert.equal(result.status, 401);
    });

    await t.test("reservation request requires core fields", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/venue-reservations", { session_id: "s1" }, studentToken);
      assert.equal(result.status, 400);
    });

    await t.test("only session host can request a venue", async () => {
      const time = createFutureWindow(nextDay += 1, 18, 2);
      const result = await request(ctx.baseUrl, "POST", "/api/venue-reservations", {
        session_id: "s1",
        venue_id: "v1",
        start_time: time.start,
        end_time: time.end,
      }, secondStudentToken);
      assert.equal(result.status, 403);
    });

    await t.test("reservation request rejects unknown session", async () => {
      const time = createFutureWindow(nextDay += 1, 18, 2);
      const result = await request(ctx.baseUrl, "POST", "/api/venue-reservations", {
        session_id: "missing-session",
        venue_id: "v1",
        start_time: time.start,
        end_time: time.end,
      }, studentToken);
      assert.equal(result.status, 404);
    });

    await t.test("reservation request rejects past time", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/venue-reservations", {
        session_id: "s1",
        venue_id: "v1",
        start_time: new Date(Date.now() - 3600 * 1000).toISOString(),
        end_time: new Date(Date.now() + 3600 * 1000).toISOString(),
      }, studentToken);
      assert.equal(result.status, 400);
    });

    await t.test("reservation request rejects end before start", async () => {
      const time = createFutureWindow(nextDay += 1, 18, 2);
      const result = await request(ctx.baseUrl, "POST", "/api/venue-reservations", {
        session_id: "s1",
        venue_id: "v1",
        start_time: time.end,
        end_time: time.start,
      }, studentToken);
      assert.equal(result.status, 400);
    });

    await t.test("reservation request rejects venue capacity overflow", async () => {
      const time = createFutureWindow(nextDay += 1, 18, 2);
      ctx.app.store.update("game_sessions", "s1", { max_members: 10 });
      const result = await request(ctx.baseUrl, "POST", "/api/venue-reservations", {
        session_id: "s1",
        venue_id: "v2",
        start_time: time.start,
        end_time: time.end,
      }, studentToken);
      assert.equal(result.status, 409);
      ctx.app.store.update("game_sessions", "s1", { max_members: 6 });
    });

    let manualReservation;
    await t.test("session host can request a pending venue reservation", async () => {
      const time = createFutureWindow(nextDay += 1, 18, 2);
      const result = await request(ctx.baseUrl, "POST", "/api/venue-reservations", {
        session_id: "s1",
        venue_id: "v1",
        start_time: time.start,
        end_time: time.end,
        reason: "Need a room",
      }, studentToken);
      assert.equal(result.status, 201);
      assert.equal(result.payload.data.status, "pending");
      manualReservation = result.payload.data;
    });

    await t.test("reservation review rejects invalid action", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/venue-reservations/${manualReservation.id}`, { action: "maybe" }, venueToken);
      assert.equal(result.status, 400);
    });

    await t.test("other venue manager cannot review a reservation for someone else's venue", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/venue-reservations/${manualReservation.id}`, { action: "approve" }, otherVenueToken);
      assert.equal(result.status, 403);
    });

    await t.test("venue manager can reject a pending reservation", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/venue-reservations/${manualReservation.id}`, {
        action: "reject",
        reason: "Room unavailable",
      }, venueToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.status, "rejected");
    });

    await t.test("reviewed reservation cannot be reviewed again", async () => {
      const result = await request(ctx.baseUrl, "PATCH", `/api/venue-reservations/${manualReservation.id}`, { action: "approve" }, venueToken);
      assert.equal(result.status, 409);
    });

    let conflictSource;
    await t.test("approved reservation source can be created for conflict checks", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/sessions", nextPayload({
        venue_id: "v1",
        max_members: 6,
      }), secondStudentToken);
      assert.equal(result.status, 201);
      conflictSource = result.payload.data;
    });

    await t.test("reservation request rejects overlap with approved reservation", async () => {
      const result = await request(ctx.baseUrl, "POST", "/api/venue-reservations", {
        session_id: "s1",
        venue_id: "v1",
        start_time: conflictSource.start_time,
        end_time: conflictSource.end_time,
      }, studentToken);
      assert.equal(result.status, 409);
    });

    await t.test("student reservation list only includes own applications", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/venue-reservations", undefined, studentToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.every((item) => item.applicant_id === "11001"), true);
    });

    await t.test("venue admin reservation list only includes managed venues", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/venue-reservations", undefined, venueToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.every((item) => {
        const venue = ctx.app.store.get("venues", item.venue_id);
        return venue.manager_id === "10002";
      }), true);
    });

    await t.test("admin reservation list includes all reservations", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/venue-reservations", undefined, adminToken);
      assert.equal(result.status, 200);
      assert.ok(result.payload.data.length >= 3);
    });

    await t.test("admin logs include game and venue management actions", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/admin/logs", undefined, adminToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.some((log) => log.action === "create_game"), true);
      assert.equal(result.payload.data.some((log) => log.action === "create_venue"), true);
    });

    await t.test("stats dashboard reports sessions and reservations", async () => {
      const result = await request(ctx.baseUrl, "GET", "/api/admin/stats", undefined, adminToken);
      assert.equal(result.status, 200);
      assert.ok(result.payload.data.sessions >= 4);
      assert.ok(result.payload.data.venue_reservations >= 3);
      assert.ok(result.payload.data.popular_games.length >= 1);
    });

    await t.test("deleting a managed venue cancels bound sessions", async () => {
      const result = await request(ctx.baseUrl, "DELETE", `/api/venues/${managedVenueId}`, undefined, venueToken);
      assert.equal(result.status, 200);
      assert.equal(result.payload.data.deleted, true);
      const session = ctx.app.store.get("game_sessions", venueBoundSession.id);
      assert.equal(session.status, "cancelled");
    });
  } finally {
    await ctx.close();
  }
});
