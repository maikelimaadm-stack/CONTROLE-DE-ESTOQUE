import { defineConfig, devices } from "@playwright/test";

/**
 * VERSION SKEW B — WEB NOVO CONTRA A API ANTERIOR, DE VERDADE (PRE-BASE2-03).
 *
 * O `playwright.config.ts` prova o produto: web novo + API nova. Esta configuração prova a JANELA DE
 * ROLLOUT, que é outra coisa. O web (Vercel) e a API (Railway) não trocam de versão no mesmo instante;
 * entre um deploy e o outro existem minutos — às vezes horas — em que o navegador roda o HEAD desta PR e o
 * servidor ainda é o commit base dela. É a combinação em que a migração fazenda → empresa pode derrubar o
 * sistema inteiro sem uma linha de erro na aplicação, porque o que falha é o FIO:
 *
 *   · o CORS da API anterior não declara `X-Empresa-Id` — o PREFLIGHT falha e a tela não carrega;
 *   · `/auth/context` devolve `farms`; um cliente que só lê `empresas` fica sem nenhuma empresa;
 *   · `/api/resources/empresas` não existe naquele binário — 404;
 *   · um corpo com `empresa_id` bate num schema `.strict()` — 422;
 *   · `empresa_id__eq` na query é descartado em silêncio: o filtro não erra, ele MENTE.
 *
 * Um mock permissivo responde "ok" às cinco e não prova nenhuma. Por isso aqui o servidor é a API EXATA do
 * commit base, montada por `scripts/api-anterior.mjs` a partir do próprio repositório, servindo o MESMO
 * banco já migrado pelo HEAD novo (0014, 0015 e as correções desta rodada) — a combinação real de produção.
 *
 *   node scripts/api-anterior.mjs
 *   pnpm --filter @agro/web exec playwright test -c playwright.skew.config.ts
 */
const API_PORT = Number(process.env.E2E_API_PORT ?? 3333);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3098);
const DB = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, "/agro_erp_e2e") ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_e2e";
/** Montada por `scripts/api-anterior.mjs` (git worktree do commit base). Relativo a `apps/web`. */
const API_ANTERIOR = "../../.api-anterior/apps/api";

export default defineConfig({
  testDir: "./e2e", testMatch: /skew-api-producao\.spec\.ts/, timeout: 60_000, expect: { timeout: 10_000 },
  fullyParallel: false, workers: 1, retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure", locale: "pt-BR" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {} } }],
  webServer: [
    {
      command: `npx tsx src/main.ts`, cwd: API_ANTERIOR, port: API_PORT, timeout: 120_000,
      /**
       * NUNCA reaproveitar um servidor já no ar nesta porta. Se a API NOVA estivesse rodando aqui (uma
       * sessão de `pnpm e2e` esquecida, por exemplo), o teste passaria — e teria provado o cenário errado,
       * que é a única forma de falha que este arquivo não pode ter.
       */
      reuseExistingServer: false,
      env: { DATABASE_URL: DB, PORT: String(API_PORT), WEB_ORIGIN: `http://127.0.0.1:${WEB_PORT}`, API_LOG_LEVEL: "warn", AUTH_MODE: "local", LOCAL_AUTH_SECRET: "e2e-secret-not-for-prod", NODE_ENV: "test", LOGIN_RATE_LIMIT_MAX: "1000", RATE_LIMIT_MAX: "100000" }
    },
    { command: `npx next start -p ${WEB_PORT}`, port: WEB_PORT, reuseExistingServer: !process.env.CI, timeout: 120_000, env: { NEXT_PUBLIC_API_URL: `http://127.0.0.1:${API_PORT}` } }
  ]
});
