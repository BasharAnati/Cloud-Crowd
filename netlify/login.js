// netlify/functions/login.js

exports.handler = async (event) => {
  // الحسابات المسموحة (تقدر تغيرهم زي ما بدك)
  const USERS = [
    { username: "user1", password: "pass1" },
    { username: "user2", password: "pass2" },
    { username: "user3", password: "pass3" },
    { username: "user4", password: "pass4" },
    { username: "user5", password: "pass5" }
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
