import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    env: {
      SESSION_SECRET: "secret-de-test-0123456789-0123456789-0123456789",
      DATABASE_URL: "file:../data/test.db",
      DOMAIN: "organizer.mon-club.fr",
    },
  },
});
