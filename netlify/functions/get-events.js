// netlify/functions/get-events.js
export async function handler() {
  try {
    // مؤقت: بدنا نرجع بيانات test بدل ما ندخل على Netlify Blobs
    const events = [
      { id: 1, message: "Test event from Netlify function" },
      { id: 2, message: "Integration working fine" }
    ];

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, events })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
}
