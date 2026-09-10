import { defineConfig, devices } from "@playwright/test";
/**
 * E2E: sobe a API (banco de e2e migrado/semeado por `pnpm --filter @agro/db exec tsx src/cli.ts seed`)
 * e o app web já construído (`next build`). O app deve ter sido construído com NEXT_PUBLIC_API_URL apontando para a porta da API (padrão http://localhost:3333). Variáveis: E2E_DATABASE_URL, E2E_API_PORT, E2E_WEB_PORT.
 */
const API_PORT = Number(process.env.E2E_API_PORT ?? 3333); const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3098);
const DB = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, "/agro_erp_e2e") ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_e2e";
export default defineConfig({
  testDir: "./e2e", timeout: 60_000, expect: { timeout: 10_000 }, fullyParallel: false, workers: 1, retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure", locale: "pt-BR" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {} } }],
  webServer: [
    { command: `npx tsx src/main.ts`, cwd: "../api", port: API_PORT, reuseExistingServer: !process.env.CI, timeout: 120_000, env: { DATABASE_URL: DB, PORT: String(API_PORT), WEB_ORIGIN: `http://127.0.0.1:${WEB_PORT}`, API_LOG_LEVEL: "warn", AUTH_MODE: "local", LOCAL_AUTH_SECRET: "e2e-secret-not-for-prod", NODE_ENV: "test", LOGIN_RATE_LIMIT_MAX: "1000" } },
    { command: `npx next start -p ${WEB_PORT}`, port: WEB_PORT, reuseExistingServer: !process.env.CI, timeout: 120_000, env: { NEXT_PUBLIC_API_URL: `http://127.0.0.1:${API_PORT}` } }
  ]
});
