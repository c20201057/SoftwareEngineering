class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function badRequest(message, details) {
  return new AppError(400, "VALIDATION_ERROR", message, details);
}

function unauthorized(message = "请先登录后再操作") {
  return new AppError(401, "UNAUTHORIZED", message);
}

function forbidden(message = "当前账号无权执行该操作") {
  return new AppError(403, "FORBIDDEN", message);
}

function notFound(message = "目标资源不存在") {
  return new AppError(404, "NOT_FOUND", message);
}

function conflict(message, details) {
  return new AppError(409, "CONFLICT", message, details);
}

module.exports = {
  AppError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
};
