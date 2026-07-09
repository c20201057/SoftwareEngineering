const { badRequest, notFound } = require("../errors");
const { normalizeText, nowIso, requireFields } = require("../utils");

const GAME_STATUSES = ["active", "inactive"];

function normalizeTags(tags) {
  return Array.isArray(tags) ? tags.map(normalizeText).filter(Boolean) : [];
}

class GameService {
  constructor(store, userService, logService) {
    this.store = store;
    this.userService = userService;
    this.logService = logService;
  }

  list(query = {}, viewer = null) {
    const type = normalizeText(query.type);
    const keyword = normalizeText(query.keyword).toLowerCase();
    const includeInactive = query.includeInactive === "true";
    if (includeInactive) this.userService.requireRole(viewer, "admin");
    return this.store
      .all("game_libs")
      .filter((game) => includeInactive || game.status === "active")
      .filter((game) => !type || game.type === type)
      .filter((game) => {
        if (!keyword) return true;
        return `${game.name} ${game.type} ${(game.tags || []).join(" ")} ${game.description}`.toLowerCase().includes(keyword);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
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
    // 只有未填写时使用默认时长；显式传 0 等非法值要交给校验逻辑拒绝。
    const duration = payload.duration_minutes === undefined || payload.duration_minutes === null || payload.duration_minutes === ""
      ? 120
      : Number(payload.duration_minutes);
    const status = normalizeText(payload.status || "active");
    this.validateGameFields({ min_players: min, max_players: max, duration_minutes: duration, status });

    const game = this.store.insert("game_libs", {
      name: normalizeText(payload.name),
      type: normalizeText(payload.type),
      min_players: min,
      max_players: max,
      duration_minutes: duration,
      difficulty: normalizeText(payload.difficulty || "未标注"),
      description: normalizeText(payload.description),
      tags: normalizeTags(payload.tags),
      status,
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
    if (payload.tags !== undefined) patch.tags = normalizeTags(payload.tags);

    this.validateGameFields({ ...game, ...patch });
    const updated = this.store.update("game_libs", id, patch);
    this.logService.record(user, "update_game", "game_lib", id);
    return updated;
  }

  validateGameFields(game) {
    if (!Number.isInteger(game.min_players) || !Number.isInteger(game.max_players) || game.min_players < 1 || game.max_players < game.min_players) {
      throw badRequest("游戏人数范围不合法");
    }
    if (!Number.isInteger(game.duration_minutes) || game.duration_minutes < 1) {
      throw badRequest("游戏时长必须为正整数");
    }
    if (!GAME_STATUSES.includes(game.status)) {
      throw badRequest("游戏状态必须为 active 或 inactive");
    }
  }
}

module.exports = { GameService };
