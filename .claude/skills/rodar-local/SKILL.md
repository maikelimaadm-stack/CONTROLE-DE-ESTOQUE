---
name: rodar-local
description: Subir o ERP na máquina (Postgres local, migrations e seed demo pelo caminho permitido, API e web) e entrar com o usuário demo. Use antes de conferir uma mudança visual no navegador, ou quando o login local falhar com "E-mail ou senha inválidos", erro de rede ou tela sem as credenciais demo.
when_to_use: Pedidos como "abra o projeto", "rode local", "o login não entra", "não aparece a senha demo", ou antes de capturar evidência visual de uma fatia F2. Não use para produção nem para preview — prova de produção é PENDING, nunca localhost.
effort: medium
---

# Rodar o ERP localmente

Local serve para VER a tela e rodar os gates. Não prova nada sobre produção (`.claude/rules/workflow.md`
§ Gate externo pendente).

## 1. Banco descartável no loopback

O jeito que casa com os defaults do repositório e do CI é Postgres 16 na porta 5433, sem senha:

```
docker run -d --name agro-pg -p 5433:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16
docker exec agro-pg createdb -U postgres agro_erp_e2e
```

Sem Docker, um Postgres 16 instalado serve, desde que o banco seja local (host `127.0.0.1` ou
`localhost`). Nunca aponte nada desta skill para um banco remoto.

## 2. Dependências e pacotes

```
pnpm install
pnpm --filter @agro/shared build && pnpm --filter @erp/plataforma build && pnpm --filter @agro/domain build && pnpm --filter @agro/db build
```

`@erp/plataforma` entra na ordem: o README antigo não o cita, e sem ele o build do domínio quebra.

## 3. Migrations e seed demo — pelo caminho permitido

`db:migrate`, `db:seed` e `db:reset` são recusados pelo hook (`.claude/rules/database-migrations.md`).
O caminho liberado é o do E2E, que o guarda só deixa passar com alvo provado local:

```
pnpm db:seed:e2e
```

Sem variável, ele usa `postgresql://postgres@127.0.0.1:5433/agro_erp_e2e`, o banco do passo 1. O
seed aplica as migrations, os dados de referência e a organização demo (`admin@demo.local`).

## 4. API e web, cada uma num terminal (tmux)

```
DATABASE_URL=postgresql://postgres@127.0.0.1:5433/agro_erp_e2e pnpm dev:api
NEXT_PUBLIC_API_URL=http://localhost:3333 NEXT_PUBLIC_DEMO_MODE=true pnpm dev:web
```

Confira: `curl -s localhost:3333/health` devolve `"db":"ok"`. Abra **http://localhost:3000**.

## 5. Quando o login não entra

| Sintoma | Causa | Conserto |
|---|---|---|
| Tela de login sem "Ambiente de demonstração: …" | `NEXT_PUBLIC_DEMO_MODE` diferente de `true` (`1`, `yes` não valem) | reinicie o web com `NEXT_PUBLIC_DEMO_MODE=true` — variável `NEXT_PUBLIC_*` é lida na subida |
| Erro de rede / "Failed to fetch" ao entrar | página aberta em `127.0.0.1:3000`: o CORS da API só aceita `WEB_ORIGIN` (padrão `http://localhost:3000`) | abra por `localhost:3000`, ou suba a API com `WEB_ORIGIN` incluindo a origem usada |
| "E-mail ou senha inválidos" com a senha certa | seed não rodou nesse banco, ou a API está em outro `DATABASE_URL` | rode o passo 3 no MESMO banco do `DATABASE_URL` da API |
| "E-mail ou senha inválidos" digitando à mão | teclado trocou `@`, maiúscula do `D` ou incluiu espaço | a senha é `Demo@12345`; confira com `curl` abaixo |
| Recusa depois de várias tentativas | limite de 10 logins por minuto (`LOGIN_RATE_LIMIT_MAX`) | espere um minuto |
| 404 "Rota não encontrada" chamando a API | rota sem o prefixo `/api` | as rotas são `/api/...` (ex.: `/api/auth/login`) |

Prova de que a API aceita a credencial, sem imprimir o token:

```
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3333/api/auth/login -H 'content-type: application/json' -d '{"email":"admin@demo.local","password":"Demo@12345"}'
```

`200` = a API aceita; o defeito está na web (origem, variável) ou na digitação.

## Nunca

- Criar `.env` com valor real, ou ler o `.env` de alguém (`CLAUDE.md` § Segredos). As variáveis acima
  vão inline no comando, só com valores locais.
- Usar `localhost` como prova de produção, nem o seed demo como "dado real".
