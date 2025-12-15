// netlify/functions/login.js

exports.handler = async (event) => {
  // الحسابات المسموحة (تقدر تغيرهم زي ما بدك)
  const USERS = [
    { username: "Mai", password: "M@123456" },
    { username: "Tuleen", password: "T123" },
    { username: "Anati", password: "A@1995" },
    { username: "Aser", password: "X9@Qm!7L#2Zp$A8m" },
    { username: "Nariman", password: "N123" }
  ];

  try {
    const body = JSON.parse(event.body);
    const { username, password } = body;

    // تحقق من المستخدم
    const found = USERS.find(
      (u) => u.username === username && u.password === password
    );

    if (found) {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, message: "Login successful" })
      };
    } else {
      return {
        statusCode: 401,
        body: JSON.stringify({ success: false, message: "Invalid credentials" })
      };
    }
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: "Server error" })
    };
  }
};
