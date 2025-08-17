// netlify/functions/ping.js
exports.handler = async () => {
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      source: 'netlify-function',
      time: new Date().toISOString()
    }),
  };
};
