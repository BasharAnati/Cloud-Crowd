const { createStaticServer, port } = require('./static-server');

module.exports = async function globalSetup() {
  const server = createStaticServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return async () => new Promise((resolve) => server.close(resolve));
};
