// netlify/functions/lark-webhook.js
// Node.js 18+ على Netlify
const crypto = require("crypto");

/**
 * بيئة التشغيل:
 * - LARK_VERIFICATION_TOKEN   (الـ Verification Token من Lark)
 * - LARK_ENCRYPT_KEY          (اختياري: Encrypt Key لو فعّلت التشفير/الـ signature)
 * - LARK_SIGNING_SECRET       (اختياري: بعض البيئات تستخدم signing secret بدلاً من encrypt key للتحقق)
 *
 * ملاحظات:
 * - لو ما فعّلت Encryption Strategy، Lark سيرسل JSON عادي (بلا "encrypt").
 * - لو فعّلت Encryption Strategy، سيُرسل {"encrypt":"..."} ونفكّه هنا.
 */

const {
  LARK_VERIFICATION_TOKEN,
  LARK_ENCRYPT_KEY,
  LARK_SIGNING_SECRET
} = process.env;

// ----- Helpers -----

// تحقّق التوقيع (إذا متوفر secret). Lark يرسل هيدرز:
// X-Lark-Request-Timestamp, X-Lark-Request-Nonce, X-Lark-Signature
function verifySignature(headers, rawBody) {
  const timestamp = headers["x-lark-request-timestamp"] || headers["X-Lark-Request-Timestamp"];
  const nonce = headers["x-lark-request-nonce"] || headers["X-Lark-Request-Nonce"];
  const signature = headers["x-lark-signature"] || headers["X-Lark-Signature"];

  const secret = LARK_SIGNING_SECRET || LARK_ENCRYPT_KEY;
  if (!secret || !timestamp || !nonce || !signature) {
    // ما عندنا معطيات كافية للتحقّق — نرجّع true حتى ما نوقف التطوير
    return { ok: true, reason: "signature skipped (missing secret or headers)" };
  }
  try {
    // حسب توثيق Lark: signature = base64( HmacSHA256( timestamp + nonce + body, secret ) )
    const baseString = `${timestamp}${nonce}${rawBody}`;
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(baseString);
    const calcSign = hmac.digest("base64");

    const ok = calcSign === signature;
    return { ok, reason: ok ? "signature ok" : "signature mismatch" };
  } catch (e) {
    return { ok: false, reason: `signature error: ${e.message}` };
  }
}

// فكّ التشفير إذا الرسالة كانت بشكل { encrypt: "..." }
// هذه طريقة عامة لـ AES-256-CBC بمفتاح مشتق من الـ ENCRYPT_KEY.
// (لو ما فعّلت Encryption Strategy، ببساطة لن يكون هناك "encrypt")
function tryDecryptIfNeeded(jsonMaybe) {
  if (!jsonMaybe || typeof jsonMaybe !== "object" || !jsonMaybe.encrypt) {
    return { decrypted: jsonMaybe, used: false, reason: "no encrypt field" };
  }
  if (!LARK_ENCRYPT_KEY) {
    return { decrypted: null, used: false, reason: "no LARK_ENCRYPT_KEY set" };
  }
  try {
    // مفتاح/IV شائع الاستخدام مع Lark (AES-256-CBC):
    const aesKey = crypto.createHash("sha256").update(LARK_ENCRYPT_KEY, "utf8").digest();
    const iv = aesKey.subarray(0, 16); // أول 16 بايت IV

    const decipher = crypto.createDecipheriv("aes-256-cbc", aesKey, iv);
    let decoded = decipher.update(jsonMaybe.encrypt, "base64", "utf8");
    decoded += decipher.final("utf8");
    const obj = JSON.parse(decoded);
    return { decrypted: obj, used: true, reason: "decrypted ok" };
  } catch (e) {
    return { decrypted: null, used: true, reason: `decrypt error: ${e.message}` };
  }
}

// ----- Netlify handler -----
exports.handler = async (event) => {
  // نسمح فقط بالـ POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  const rawBody = event.body || "";
  // تحقّق التوقيع (اختياري)
  const sig = verifySignature(event.headers || {}, rawBody);
  if (!sig.ok) {
    console.warn("⚠️ Signature check failed:", sig.reason);
    // ممكن ترجّع 403 لو بدك توقف الطلبات غير الصحيحة:
    // return { statusCode: 403, body: "Invalid signature" };
  } else {
    console.log("🔐 Signature:", sig.reason);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody || "{}");
  } catch (e) {
    console.error("❌ Invalid JSON:", e);
    return { statusCode: 400, body: "invalid json" };
  }

  // 1) url_verification (أول مرة Lark يتحقق من endpoint)
  if (payload.type === "url_verification" && payload.challenge) {
    console.log("✅ URL verification received.");
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge: payload.challenge })
    };
  }

  // 2) في حال كان مشفّر
  const dec = tryDecryptIfNeeded(payload);
  if (dec.used) {
    if (!dec.decrypted) {
      console.warn("⚠️ Could not decrypt payload:", dec.reason);
      return { statusCode: 400, body: "decrypt error" };
    } else {
      payload = dec.decrypted;
      console.log("🔓 Decrypted payload.");
    }
  }

  // 3) لوج شامل للحدث
  console.log("📩 Lark Webhook Event:", JSON.stringify(payload, null, 2));

  // تنسيقات شائعة من Lark:
  // - payload.header?.event_type
  // - payload.event?.<data>
  // استخدمها حسب حاجتك لبناء منطقك لاحقًا:
  const eventType =
    payload?.header?.event_type ||
    payload?.schema?.eventType || // بعض الإصدارات
    payload?.type ||
    "unknown";

  console.log("ℹ️ Event type:", eventType);

  // TODO: هنا ممكن تضيف منطقك (حفظ/تحديث تكتس، إلخ)

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, received: true })
  };
};
