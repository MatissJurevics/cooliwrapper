export class HttpError extends Error {
  constructor(statusCode, message, details = undefined) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class CoolifyApiError extends HttpError {
  constructor(statusCode, method, path, payload) {
    super(statusCode, `Coolify API request failed: ${method} ${path}`, payload);
    this.method = method;
    this.path = path;
  }
}
