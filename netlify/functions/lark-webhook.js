// netlify/functions/lark-webhook.js
const crypto = require("crypto");

function verifyLarkSignature({ timestamp, nonce, body, encryptKey, signature }) {
  if (!encryptKey) return true;
  const baseString = `${timestamp}\n${nonce}\n${body}`;
  const hmac = crypto.createHmac("sha256", encryptKey).update(baseString).digest("base64");
  return hmac === signature;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const rawBody = event.body || "";
    const headers = event.headers || {};

    const okSig = verifyLarkSignature({
      timestamp: headers["x-lark-request-timestamp"],
      nonce: headers["x-lark-request-nonce"],
      signature: headers["x-lark-signature"],
      encryptKey: process.env.LARK_ENCRYPT_KEY || "",
      body: rawBody
    });
    if (!okSig) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "invalid signature" })
      };
    }

    const payload = JSON.parse(rawBody);

    if (payload?.type === "url_verification" && payload?.challenge) {
      const expectedToken = process.env.LARK_VERIFICATION_TOKEN || "";
      if (expectedToken && payload?.token !== expectedToken) {
        return {
          statusCode: 401,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "bad token" })
        };
      }
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge: payload.challenge })
      };
    }

    const eventObj = payload?.event || payload;
    console.log("Lark event:", JSON.stringify(eventObj).slice(0, 1000));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true })
    };
  } catch (err) {
    console.error("Webhook error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "server_error" }) };
  }
};
