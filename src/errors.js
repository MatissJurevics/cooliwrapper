export class HttpError extends Error {
  constructor(statusCode, message, details = undefined) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class CoolifyApiError extends HttpError {
  constructor(statusCode, method, path, payload, request = {}) {
    const responseSummary = summarizeCoolifyPayload(payload);
    const suffix = responseSummary ? ` (${statusCode}: ${responseSummary})` : ` (${statusCode})`;

    super(statusCode, `Coolify API request failed: ${method} ${path}${suffix}`, {
      statusCode,
      method,
      path,
      request: sanitizeCoolifyRequest(request),
      response: payload
    });
    this.method = method;
    this.path = path;
    this.payload = payload;
  }
}

function summarizeCoolifyPayload(payload) {
  if (!payload) return "";
  if (typeof payload === "string") return truncate(payload);

  if (typeof payload === "object") {
    const candidates = [
      payload.message,
      payload.error,
      payload.errors,
      payload.detail,
      payload.details
    ].filter(Boolean);

    if (candidates.length > 0) {
      return truncate(formatPayloadValue(candidates[0]));
    }
  }

  return truncate(formatPayloadValue(payload));
}

function formatPayloadValue(value) {
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sanitizeCoolifyRequest(request) {
  const sanitized = {};

  if (request.query && Object.keys(request.query).length > 0) {
    sanitized.query = request.query;
  }

  if (request.body !== undefined) {
    sanitized.body = sanitizeBodyValue(request.body);
  }

  return sanitized;
}

function sanitizeBodyValue(value, key = "") {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeBodyValue(entry, key));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitizeBodyValue(entryValue, entryKey)])
    );
  }

  if (typeof value === "string") {
    if (shouldRedactBodyField(key)) {
      return `[redacted ${value.length} chars]`;
    }

    return truncate(value, 500);
  }

  return value;
}

function shouldRedactBodyField(key) {
  return /token|secret|password|dockerfile|private_key/i.test(key);
}

function truncate(value, maxLength = 240) {
  const text = String(value).replace(/\s+/g, " ").trim();

  if (text.length <= maxLength) return text;

  return `${text.slice(0, maxLength)}...`;
}
