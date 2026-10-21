# AGENTS.md — ambiente Base44 (sandbox)

Este arquivo descreve **como este repositório roda na sandbox do Base44**. Ele não substitui
`README.md` (uso local na máquina do dev), `CLAUDE.md` (leis de trabalho) nem `docs/DEPLOYMENT.md`
(produção: Supabase + Railway + Vercel). Só registra o que não se deduz dos manifestos.

## Subir, derrubar, conferir

```bash
docker compose -f docker-compose.base44.yml up -d      # sobe tudo (idempotente)
docker compose -f docker-compose.base44.yml ps -a      # setup/roles devem estar Exited (0)
docker compose -f docker-compose.base44.yml logs -f api web
```

`up -d` espera as condições de dependência: `db` saudável → `setup` (one-shot) → `roles` (one-shot)
→ `api` saudável → `web`. O `setup` roda de novo a cada `up` e é seguro: instala do lockfile,
reconstrói os pacotes do workspace e roda o seed (migrations idempotentes + dados de referência +
organização DEMO).

## O que não é óbvio

- **`pnpm` não existe no host.** Os comandos do repositório (`pnpm lint`, `pnpm test`,
  `pnpm typecheck`) rodam **dentro dos containers**, onde o workspace já está instalado:
  `docker compose -f docker-compose.base44.yml exec -T web pnpm --filter @agro/web typecheck`.
- **Supabase não é necessário para rodar.** As migrations rodam em **Postgres 16 puro** (é o que o
  próprio CI faz, `.github/workflows/ci.yml` job `integration`). O que o Supabase fornecia fora do
  Postgres não é usado no fluxo local: `AUTH_MODE=local` (login por e-mail/senha em `erp.users`) e
  anexos guardados no banco (`erp.attachment_blobs`, `bucket='db'`).
- **A API conecta como `erp_app`, nunca como `postgres`.** A migration 0007 cria esse papel como
  `nologin`; `.base44/db-roles.sql` dá `LOGIN` a ele (serviço one-shot `roles`). Conectar como
  superusuário desliga a RLS — `force row level security` não alcança superusuário nem papel com
  `BYPASSRLS` — e o app deixaria de exercitar o isolamento por tenant que ele inteiro assume.
- **Migrations e seed rodam como `postgres`** (superusuário), é o único ponto com privilégio: elas
  criam schema, papéis, políticas e triggers.
- **Pacotes do workspace precisam de `dist/`.** Os `exports` de `@agro/shared`, `@erp/plataforma`,
  `@agro/domain` e `@agro/db` apontam para `dist/index.js`; por isso o `setup` builda os quatro
  antes de subir API e web. Editar `packages/*/src` exige rebuild (`pnpm --filter <pacote> build`)
  para API e web verem a mudança; `apps/api/src` e `apps/web/src` recarregam sozinhos
  (`tsx watch`, `next dev`).
- **Duas origens, e a página é que manda no CORS.** A web fica em `3000` e a API em `3333`; o
  navegador chama `NEXT_PUBLIC_API_URL` (host **público** da sandbox, não `localhost`).
  `WEB_ORIGIN` da API recebe a origem **pública** da página (`https://3000-${BASE44_PUBLIC_HOST_SUFFIX}`).
  `WEB_ORIGIN_PREVIEW_SUFFIX` **não** serve aqui: ele só aceita sufixo de preview da Vercel por
  contrato de segurança, e valor fora do formato **derruba o startup**.
- **Credenciais demo**: `admin@demo.local` / `Demo@12345` (o seed cria; `NEXT_PUBLIC_DEMO_MODE=true`
  as mostra na tela de login, só no preview). A organização demo nasce sem movimento, então os
  gráficos do Início aparecem zerados — é o estado semeado, não falha.
- **Sem credencial de serviço externo para subir.** A análise por satélite nasce desligada
  (`COPERNICUS_ENABLED=0`); ligá-la exige `COPERNICUS_CLIENT_ID`/`COPERNICUS_CLIENT_SECRET` reais.
- **Playwright não é instalado** (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`) e os testes de integração
  esperam outro banco (`TEST_DATABASE_URL`/`E2E_DATABASE_URL` em `127.0.0.1:5433`), que este compose
  não sobe. Rodar `pnpm test:integration`/`pnpm e2e` na sandbox exige subir esse Postgres à parte —
  e na sandbox isso é exceção, não rotina: o CI é quem roda a suíte inteira.

## Overrides de sandbox (todos atrás de `BASE44_PREVIEW_MODE`)

`BASE44_PREVIEW_MODE=1` é fornecido pelo sandbox e passado **pelo nome** ao serviço `web`; nada
resolvido (`BASE44_PUBLIC_HOST_SUFFIX`) é gravado em arquivo. Sem o valor `"1"` (ausente ou
qualquer outro), o comportamento é o de sempre.

| Override | Onde | Por quê | Com a flag desligada |
|---|---|---|---|
| `allowedDevOrigins: ['3000-<sufixo>']` | `apps/web/next.config.ts`, condicional | O preview chega pelo proxy: o `Host` é `<porta>-<id>.<domínio>` e o `Origin` é o host **público**. Sem isso o Next recusa assets/HMR de origem cruzada e o JavaScript não carrega. | `allowedDevOrigins` fica `undefined` — a lista de origens de dev do Next não é alterada. |
| `NEXT_PUBLIC_API_URL` | `docker-compose.base44.yml` (web) | A URL da API é lida pelo navegador, que só alcança o host público do sandbox. | Variável do compose, não do código: fora do preview não existe. |
| `NEXT_PUBLIC_DEMO_MODE=true` | `docker-compose.base44.yml` (web) | Mostra as credenciais demo na tela de login, para a sandbox ser utilizável de imediato. | `.env.example` documenta `false`; em produção nunca se define. |
| `WEB_ORIGIN` com a origem pública | `docker-compose.base44.yml` (api) | CORS exato da página do preview. | A variável da API mantém o padrão `http://localhost:3000`. |
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` | `docker-compose.base44.yml` (setup) | O preview não roda e2e; baixar navegadores custaria minutos em cada `up`. | — |

Nenhum caminho de autenticação, autorização, RLS ou CSRF foi afrouxado: o login continua local
(`AUTH_MODE=local`) e a API continua falando com o banco como `erp_app` sob RLS.

## Como verificar que está de pé

1. `curl -s http://localhost:3333/health` → `{"status":"ok","db":"ok",...}`.
2. `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login` → `200`.
3. No preview: entrar com `admin@demo.local` / `Demo@12345` e conferir que a tela **Início** mostra
   os cartões de resultado (Receitas, Despesas, Resultado operacional) — isso prova web → API → banco
   com RLS no caminho. Sem console limpo e sem requisição falhando, não está de pé.
