// netlify/functions/login.js
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const USERS = [
    { username: "Mai", password: "M@123456" },
    { username: "Tuleen", password: "T123" },
    { username: "Anati", password: "A@1995" },
    { username: "Aser", password: "X9@Qm!7L#2Zp$A8m" },
    { username: "Nariman", password: "N123" }
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

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, message: "Login successful" })
    };
  } catch (e) {
    return { statusCode: 400, body: "Bad Request" };
  }
};
