// netlify/functions/get-events.js
exports.handler = async () => {
  const { getStore } = await import("@netlify/blobs");
  const store = getStore({ name: "lark-events" });

  const data = (await store.getJSON("events.json")) || [];
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify({ count: data.length, events: data })
  };
};
