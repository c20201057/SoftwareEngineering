const { nowIso } = require("../utils");

class LogService {
  constructor(store) {
    this.store = store;
  }

  record(operator, action, objectType, objectId, result = "success", remark = "") {
    return this.store.insert("admin_logs", {
      operator_id: operator ? operator.id : "system",
      action,
      object_type: objectType,
      object_id: objectId,
      result,
      remark,
      created_at: nowIso(),
    });
  }

  list() {
    return this.store
      .all("admin_logs")
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
}

module.exports = { LogService };
