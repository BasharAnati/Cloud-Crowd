// netlify/functions/login.js
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const USERS = [
    { username: "Mai", password: "000000**" },
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

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, message: "Login successful" })
    };
  } catch (e) {
    return { statusCode: 400, body: "Bad Request" };
  }
};
