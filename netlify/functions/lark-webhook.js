// netlify/functions/lark-webhook.js
const crypto = require("crypto");

// بيئات
const { LARK_VERIFICATION_TOKEN, LARK_ENCRYPT_KEY, LARK_SIGNING_SECRET } = process.env;

// تحقّق توقيع (اختياري)
function verifySignature(headers, rawBody) {
  const ts = headers["x-lark-request-timestamp"] || headers["X-Lark-Request-Timestamp"];
  const nonce = headers["x-lark-request-nonce"] || headers["X-Lark-Request-Nonce"];
  const signature = headers["x-lark-signature"] || headers["X-Lark-Signature"];
  const secret = LARK_SIGNING_SECRET || LARK_ENCRYPT_KEY;
  if (!secret || !ts || !nonce || !signature) return { ok: true, reason: "skipped" };
  try {
    const h = crypto.createHmac("sha256", secret).update(`${ts}${nonce}${rawBody}`).digest("base64");
    return { ok: h === signature, reason: h === signature ? "ok" : "mismatch" };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// decrypt لو فعّلت Encryption Strategy (اختياري)
function tryDecryptIfNeeded(obj) {
  if (!obj || !obj.encrypt) return { used: false, decrypted: obj };
  if (!LARK_ENCRYPT_KEY) return { used: true, decrypted: null, reason: "no key" };
  try {
    const key = crypto.createHash("sha256").update(LARK_ENCRYPT_KEY, "utf8").digest();
    const iv = key.subarray(0, 16);
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let out = decipher.update(obj.encrypt, "base64", "utf8");
    out += decipher.final("utf8");
    return { used: true, decrypted: JSON.parse(out) };
  } catch (e) {
    return { used: true, decrypted: null, reason: e.message };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const raw = event.body || "";
  const sig = verifySignature(event.headers || {}, raw);
  if (!sig.ok) return { statusCode: 403, body: "Invalid signature" };

  let body;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return { statusCode: 400, body: "invalid json" };
  }

  // URL verification
  if (body.type === "url_verification" && body.challenge) {
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challenge: body.challenge }) };
  }

  // decrypt إن لزم
  const dec = tryDecryptIfNeeded(body);
  if (dec.used && !dec.decrypted) return { statusCode: 400, body: "decrypt error" };
  if (dec.used) body = dec.decrypted;

  // نحاول استخراج نوع الحدث وبياناته
  const eventType = body?.header?.event_type || body?.type || "unknown";
  const eventPayload = body?.event ?? body;

  // خزّن الحدث في Netlify Blobs
  const { getStore } = await import("@netlify/blobs");
  const store = getStore({ name: "lark-events", expiration: "30d" }); // 30 يوم احتفاظ
  const key = "events.json";

  const current = (await store.getJSON(key)) || [];
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    receivedAt: new Date().toISOString(),
    eventType,
    payload: eventPayload,
  };
  current.push(entry);
  await store.setJSON(key, current);

  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
};
