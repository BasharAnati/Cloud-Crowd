// netlify/functions/login.js
const crypto = require("crypto");

const TOKEN_TTL_SECONDS = 8 * 60 * 60;

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function getRole(username) {
  if (username === "Anati") return "admin";
  if (username === "Mai") return "manager";
  return "agent";
}

function createSessionToken(payload) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not configured");
  }

  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const USERS = [
    { username: "Mai", password: "M#123" },
    { username: "Tuleen", password: "000000**" },
    { username: "Anati", password: "A@1995" },
    { username: "Aser", password: "000000**" },
    { username: "Tala", password: "000000**" }
  ];

  try {
    const { username, password } = JSON.parse(event.body || "{}");
    const found = USERS.find(u => u.username === username && u.password === password);

    if (!found) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, message: "Invalid credentials" })
      };
    }

    const role = getRole(found.username);
    const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const sessionToken = createSessionToken({
      username: found.username,
      role,
      exp
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        message: "Login successful",
        username: found.username,
        role,
        sessionToken
      })
    };
  } catch (e) {
    console.error("login function error:", e);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, message: "Login service unavailable" })
    };
  }
};
