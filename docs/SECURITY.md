# Segurança

- **Autenticação**: `AUTH_MODE=supabase` valida o JWT do Supabase Auth (`SUPABASE_JWT_SECRET`, HS256) e resolve `erp.users` por `auth_user_id`; `AUTH_MODE=local` (dev/test/CI) usa bcrypt + JWT assinado com `LOCAL_AUTH_SECRET`. Login local tem rate limit (10/min/IP) e registra `login` na auditoria.
- **Multi-tenant**: todo request carrega `X-Org-Id` (validado contra `organization_members` ativo) e opcionalmente `X-Farm-Id` (validado contra as fazendas do membro). A transação executa `SET LOCAL app.org_id/app.user_id`; a API conecta como `erp_app` **sem** bypass de RLS — mesmo um bug de `WHERE` não vaza dados entre organizações (teste de isolamento em `apps/api/test/integration`).
- **Autorização**: permissão por rota (`runService`) + verificações de fazenda (`farmAllowed`) + regras de negócio (autorizador, valor máximo, cotações mínimas). Ver `docs/AUTHORIZATION.md`.
- **Segredos**: nunca commitados (`.env.example` só com placeholders; CI faz varredura). `SUPABASE_SERVICE_ROLE_KEY` só no backend; o frontend usa apenas `NEXT_PUBLIC_*`.
- **Transporte**: helmet, CORS restrito a `WEB_ORIGIN`, rate limit global (`RATE_LIMIT_MAX`/min).
- **Entrada**: validação zod em todo corpo/query; SQL sempre parametrizado (`SqlBuilder`); identificadores de tabela/coluna vêm do registro declarativo, nunca do cliente.
- **Auditoria**: trigger de linha + eventos de aplicação (`audit()`), consultável em `/admin/auditoria`.
- **Idempotência/concorrência**: ver `docs/ARCHITECTURE.md`.
- **Uploads**: bucket privado por organização no Supabase Storage (pendente de projeto Supabase; a UI lista anexos e mostra o aviso).
- **Erros**: mensagens sem stack trace; códigos de domínio estáveis (`packages/shared/src/errors.ts`).
