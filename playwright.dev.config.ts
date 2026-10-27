import config from "./playwright.config";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  ...config,
  webServer: {
    command: "node --import tsx tests/serve.ts --dev",
    url: "http://127.0.0.1:4319",
    reuseExistingServer: false,
  },
});
