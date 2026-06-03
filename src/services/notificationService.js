const { nowIso } = require("../utils");

class NotificationService {
  constructor(store) {
    this.store = store;
  }

  create(userId, { type = "system", title, content, related_type = "", related_id = "" }) {
    return this.store.insert("notifications", {
      user_id: userId,
      type,
      title,
      content,
      related_type,
      related_id,
      read_at: null,
      created_at: nowIso(),
    });
  }

  bulk(userIds, payload) {
    return [...new Set(userIds)].map((userId) => this.create(userId, payload));
  }

  listForUser(user, { unreadOnly = false } = {}) {
    let rows = this.store
      .all("notifications")
      .filter((row) => row.user_id === user.id)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (unreadOnly) rows = rows.filter((row) => !row.read_at);
    return rows;
  }

  markRead(user, notificationId) {
    const item = this.store.get("notifications", notificationId);
    if (!item || item.user_id !== user.id) return null;
    return this.store.update("notifications", item.id, { read_at: nowIso() });
  }
}

module.exports = { NotificationService };
