import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  testIgnore: "catalogue.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:4319",
    viewport: { width: 1512, height: 982 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node --import tsx tests/serve.ts",
    url: "http://127.0.0.1:4319",
    reuseExistingServer: false,
  },
});
