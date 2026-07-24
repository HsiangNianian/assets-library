import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://localhost:3100" },
  webServer: {
    command: "pnpm db:migrate && pnpm exec next dev -p 3100",
    url: "http://localhost:3100",
    env: {
      DATABASE_PATH: "/tmp/assets-library-e2e/assets.db",
      MEDIA_ROOT: "/tmp/assets-library-e2e/media",
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
