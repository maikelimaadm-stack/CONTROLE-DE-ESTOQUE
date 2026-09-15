import { defineConfig, devices } from "@playwright/test";

/**
 * VERSION SKEW SENTIDO 2 — O WEB QUE JÁ ESTÁ NO AR CONTRA A API DESTA PR (PRE-BASE2-05B).
 *
 * O outro arquivo (`playwright.skew.config.ts`) prova o sentido 1: web desta PR contra a API da base. Este
 * prova o sentido que a 05B realmente arrisca, e que nenhuma fase anterior precisou provar.
 *
 * Quem vira canônico agora é o SERVIDOR. Se a API subir primeiro — e ela pode, porque Railway e Vercel não
 * trocam de versão no mesmo instante —, o navegador de todo mundo estará rodando o bundle da BASE DESTA PR
 * contra uma API mais nova. Se aquele cliente dependesse de QUALQUER resquício
 * legado (um cabeçalho, um apelido de resposta, a chave de recurso, o formato administrativo achatado), o
 * sistema quebraria em produção sem uma linha de erro de aplicação — o que falha é o FIO.
 *
 * Por isso aqui o navegador roda o web EXATO do commit base, montado por `scripts/api-anterior.mjs --web` a
 * partir do próprio repositório, contra a API deste HEAD, servindo o mesmo banco. Não é um mock do cliente
 * anterior: é o cliente anterior.
 *
 *   node scripts/api-anterior.mjs --web
 *   pnpm --filter @agro/web exec playwright test -c playwright.skew-web-anterior.config.ts
 */
const API_PORT = Number(process.env.E2E_API_PORT ?? 3333);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3099);
const DB = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, "/agro_erp_e2e") ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_e2e";
/** Montado por `scripts/api-anterior.mjs --web` (git worktree do commit base). Relativo a `apps/web`. */
const WEB_ANTERIOR = "../../.api-anterior/apps/web";

export default defineConfig({
  testDir: "./e2e", testMatch: /skew-web-anterior\.spec\.ts/, timeout: 60_000, expect: { timeout: 10_000 },
  fullyParallel: false, workers: 1, retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure", locale: "pt-BR" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {} } }],
  webServer: [
    {
      // A API é a DESTE HEAD — é ela que está sendo julgada.
      command: "npx tsx src/main.ts", cwd: "../api", port: API_PORT, timeout: 120_000,
      /**
       * NUNCA reaproveitar um servidor já no ar nesta porta. Se a API da BASE estivesse rodando aqui (uma
       * sessão de skew sentido 1 esquecida, por exemplo), o teste passaria — e teria provado o cenário
       * errado, que é a única forma de falha que este arquivo não pode ter.
       */
      reuseExistingServer: false,
      env: { DATABASE_URL: DB, PORT: String(API_PORT), WEB_ORIGIN: `http://127.0.0.1:${WEB_PORT}`, API_LOG_LEVEL: "warn", AUTH_MODE: "local", LOCAL_AUTH_SECRET: "e2e-secret-not-for-prod", NODE_ENV: "test", LOGIN_RATE_LIMIT_MAX: "1000", RATE_LIMIT_MAX: "100000" }
    },
    {
      // O navegador é o web da BASE (PRE-BASE2-05A), servido do worktree.
      command: `npx next start -p ${WEB_PORT}`, cwd: WEB_ANTERIOR, port: WEB_PORT, timeout: 120_000,
      reuseExistingServer: false, env: { NEXT_PUBLIC_API_URL: `http://127.0.0.1:${API_PORT}` }
    }
  ]
});
