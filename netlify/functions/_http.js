const MAX_CREDENTIAL_BODY_BYTES = 16 * 1024;

function requestError(statusCode, message, headers = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.headers = headers;
  return error;
}

function headerValue(event, name) {
  const headers = event?.headers || {};
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || "";
}

function requireJsonPost(event, options = {}) {
  if (event?.httpMethod !== "POST") {
    throw requestError(405, "Method Not Allowed", { Allow: "POST, OPTIONS" });
  }
  const contentType = String(headerValue(event, "content-type")).split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw requestError(415, "Content-Type must be application/json");
  if (typeof event.body !== "string" || event.body.length === 0) throw requestError(400, "Request body is required");
  const maxBytes = options.maxBytes || MAX_CREDENTIAL_BODY_BYTES;
  if (Buffer.byteLength(event.body, "utf8") > maxBytes) throw requestError(413, "Request body is too large");
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    throw requestError(400, "Invalid JSON request");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw requestError(400, "JSON request body must be an object");
  }
  return body;
}

function boundedString(value, field, options = {}) {
  if (typeof value !== "string") throw requestError(400, `${field} must be a string`);
  if (options.required && value.length === 0) throw requestError(400, `${field} is required`);
  if (value.length > options.maxLength) throw requestError(400, `${field} is too long`);
  return value;
}

module.exports = { MAX_CREDENTIAL_BODY_BYTES, requestError, requireJsonPost, boundedString };
