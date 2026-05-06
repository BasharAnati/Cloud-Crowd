const crypto = require("crypto");

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getBearerToken(event) {
  const headers = event.headers || {};
  const authorization = headers.authorization || headers.Authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function verifySessionToken(token) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not configured");
  }

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, signature] = parts;
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest("base64url");

    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (signatureBuffer.length !== expectedBuffer.length) return null;
    if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (!payload.exp || Math.floor(Date.now() / 1000) >= payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function authError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function requireValidSession(event) {
  const token = getBearerToken(event);
  if (!token) throw authError(401, "Missing session token");

  const session = verifySessionToken(token);
  if (!session) throw authError(401, "Invalid or expired session token");

  return session;
}

function requireAdminSession(event) {
  const session = requireValidSession(event);
  if (session.role !== "admin") throw authError(403, "Admin role required");
  return session;
}

module.exports = {
  getBearerToken,
  verifySessionToken,
  requireValidSession,
  requireAdminSession,
};
