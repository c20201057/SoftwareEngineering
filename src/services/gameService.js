const { badRequest, notFound } = require("../errors");
const { normalizeText, nowIso, requireFields } = require("../utils");

class GameService {
  constructor(store, userService, logService) {
    this.store = store;
    this.userService = userService;
    this.logService = logService;
  }

  list(query = {}) {
    const type = normalizeText(query.type);
    const keyword = normalizeText(query.keyword).toLowerCase();
    const includeInactive = query.includeInactive === "true";
    return this.store
      .all("game_libs")
      .filter((game) => includeInactive || game.status === "active")
      .filter((game) => !type || game.type === type)
      .filter((game) => {
        if (!keyword) return true;
        return `${game.name} ${game.type} ${(game.tags || []).join(" ")} ${game.description}`.toLowerCase().includes(keyword);
      });
  }

  getActive(id) {
    const game = this.store.get("game_libs", id);
    if (!game || game.status !== "active") throw notFound("游戏或剧本条目不存在或已下架");
    return game;
  }

  create(user, payload) {
    this.userService.requireRole(user, "admin");
    requireFields(payload, ["name", "type", "min_players", "max_players"]);
    const min = Number(payload.min_players);
    const max = Number(payload.max_players);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) {
      throw badRequest("游戏人数范围不合法");
    }
    const game = this.store.insert("game_libs", {
      name: normalizeText(payload.name),
      type: normalizeText(payload.type),
      min_players: min,
      max_players: max,
      duration_minutes: Number(payload.duration_minutes || 120),
      difficulty: normalizeText(payload.difficulty || "未标注"),
      description: normalizeText(payload.description),
      tags: Array.isArray(payload.tags) ? payload.tags.map(normalizeText).filter(Boolean) : [],
      status: "active",
      created_at: nowIso(),
    });
    this.logService.record(user, "create_game", "game_lib", game.id);
    return game;
  }

  update(user, id, payload) {
    this.userService.requireRole(user, "admin");
    const game = this.store.get("game_libs", id);
    if (!game) throw notFound("游戏或剧本条目不存在");
    const patch = {
      updated_at: nowIso(),
    };
    for (const field of ["name", "type", "difficulty", "description", "status"]) {
      if (payload[field] !== undefined) patch[field] = normalizeText(payload[field]);
    }
    for (const field of ["min_players", "max_players", "duration_minutes"]) {
      if (payload[field] !== undefined) patch[field] = Number(payload[field]);
    }
    if (payload.tags !== undefined) patch.tags = Array.isArray(payload.tags) ? payload.tags.map(normalizeText).filter(Boolean) : [];
    const updated = this.store.update("game_libs", id, patch);
    this.logService.record(user, "update_game", "game_lib", id);
    return updated;
  }
}

module.exports = { GameService };
