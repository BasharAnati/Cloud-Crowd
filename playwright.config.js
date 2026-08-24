const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test/browser',
  fullyParallel: true,
  forbidOnly: true,
  timeout: 30_000,
  expect: { timeout: 7_500 },
  reporter: [['line']],
  globalSetup: require.resolve('./test/browser/global-setup.js'),
  outputDir: require('node:path').join(require('node:os').tmpdir(), 'cloud-crowd-playwright-results'),
  use: {
    baseURL: 'http://127.0.0.1:4173',
    actionTimeout: 7_500,
    navigationTimeout: 15_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', testIgnore: /cross-engine-mutation-contracts\.spec\.js/, use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', testMatch: /critical-paths\.spec\.js/, use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testMatch: /(?:critical-paths|cross-engine-mutation-contracts)\.spec\.js/, use: { ...devices['Desktop Safari'] } }
  ]
});
