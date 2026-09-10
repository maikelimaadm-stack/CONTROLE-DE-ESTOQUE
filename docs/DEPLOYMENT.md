# Deploy

## Supabase (banco + auth + storage)
1. Criar projeto; anotar `Project URL`, `anon key`, `service role key`, `JWT secret` (Settings › API) e a connection string (pooler, porta 6543 para a API).
2. Criar papel da aplicação: `create role erp_app login password '<senha-forte>'; grant usage on schema erp to erp_app;` (as migrations concedem privilégios de tabela).
3. Aplicar `supabase/migrations/*.sql` em ordem (`pnpm db:migrate` com `DATABASE_URL` do projeto, ou MCP `apply_migration`). Depois `pnpm db:seed` para dados de referência + organização inicial.
4. Auth: habilitar e-mail/senha; ao criar usuários no Supabase, preencher `erp.users.auth_user_id`. Storage: bucket privado `attachments`.
5. **Status nesta entrega**: o usuário optou por não aplicar no Supabase agora (projeto novo bloqueado por fatura; projetos existentes são de outros apps). Migrations prontas e testadas em Postgres 16 local/CI.

## Railway (API)
- Serviço a partir do repositório, `railway.json` na raiz: build por `apps/api/Dockerfile`, health `/health`, pre-deploy `node dist/migrate.js` (aplica migrations pendentes).
- Variáveis: `DATABASE_URL` (Supabase pooler, usuário `erp_app`), `AUTH_MODE=supabase`, `SUPABASE_JWT_SECRET`, `SUPABASE_URL`, `WEB_ORIGIN=https://<app>.vercel.app`, `PORT=3333`, `API_LOG_LEVEL=info`, `RATE_LIMIT_MAX`.

## Vercel (web)
- Projeto Git na raiz do monorepo com `vercel.json` (o build compila os pacotes antes do `next build`; Root Directory = raiz, output `apps/web/.next`).
- Variáveis: `NEXT_PUBLIC_API_URL=https://<api>.up.railway.app`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- `NEXT_PUBLIC_API_URL` é embutida no build: alterar a URL da API exige novo deploy.

## Checklist de go-live
- [ ] Migrations aplicadas e `erp_app` sem privilégio de bypass RLS
- [ ] `AUTH_MODE=supabase` e segredo JWT configurado
- [ ] CORS (`WEB_ORIGIN`) apontando para o domínio final
- [ ] Backups automáticos do Supabase ativos
- [ ] Usuário owner criado e vinculado (`organization_members.is_owner`)
