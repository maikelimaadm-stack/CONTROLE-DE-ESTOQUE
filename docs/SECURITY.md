# Segurança

- **Autenticação**: `AUTH_MODE=supabase` valida o JWT do Supabase Auth (`SUPABASE_JWT_SECRET`, HS256) e resolve `erp.users` por `auth_user_id`; `AUTH_MODE=local` (dev/test/CI) usa bcrypt + JWT assinado com `LOCAL_AUTH_SECRET`. Login local tem rate limit (10/min/IP) e registra `login` na auditoria.
- **Multi-tenant**: todo request carrega `X-Org-Id` (validado contra `organization_members` ativo) e opcionalmente `X-Empresa-Id` (`X-Farm-Id` aceito durante o rollout; os dois com valores divergentes → 422). A transação executa `SET LOCAL app.org_id/app.user_id`; a API conecta como `erp_app` **sem** bypass de RLS.
- **Isolamento por EMPRESA no banco** (PRE-BASE2-03): a política das tabelas de escopo é `tenant_e_empresa` — organização **e** empresa no escopo do membro, com escrita restrita por `erp.empresa_escrita_permitida`. A política de tenant foi SUBSTITUÍDA, não acompanhada: políticas `PERMISSIVE` se combinam com **OR**, e uma segunda política ao lado manteria o vazamento. O módulo ativo chega ao banco pela GUC `app.modulo_empresa`, publicada pelo `runService` a partir da PERMISSÃO da rota — nunca do cabeçalho, da query, do corpo ou do pathname. Matriz em `docs/COMPANY-RLS-MATRIX.md` (nenhuma tabela "não auditada"), com a política de CADA comando; prova lendo pelo papel da aplicação em `apps/api/test/integration/rls-empresa.test.ts`. Transferência entre empresas tem TRÊS contratos, não um — ler pelas duas pontas não é escrever pelas duas (§8.3 do contrato multiempresa); e toda ação de transferência confere ROW COUNT, porque a RLS não recusa um UPDATE fora de escopo: ela o transforma em zero linhas, que sem conferência vira sucesso com efeito nenhum.
- **Portas `SECURITY DEFINER`**: existem DUAS, e as duas são estreitas por construção —
  `erp.movimentos_conta_organizacao` (agregado de conta bancária) e `erp.processar_transferencia_pecuaria_destino`
  (aceite da transferência de rebanho pelo destino). O contrato das duas é o mesmo: `search_path` fixo,
  organização e usuário lidos da GUC do SERVIDOR (nunca de parâmetro do cliente), capacidades reconferidas
  dentro da função, predicado de tenant explícito, sem SQL dinâmico, `execute` revogado de `public` e
  concedido só a `erp_app`. Cada uma sabe exatamente QUAL registro, QUAIS entidades e QUAL ação — não
  devolvem linha arbitrária nem aceitam tabela/organização por parâmetro. É o que separa uma porta
  autorizada de um bypass: uma porta específica demais para servir a outra coisa.
- **Views**: toda view do schema `erp` é `security_invoker = true`. Sem isso a view roda com os direitos do DONO (papel de migração, com `bypassrls`) e devolve linhas de todas as organizações — foi o caso de `erp.v_bank_account_balances`, corrigido na 0015.
- **Autorização**: permissão por rota (`runService`) + verificações de empresa (`empresaPermitida`, `exigirEmpresaDeLancamento`) + regras de negócio (autorizador, valor máximo, cotações mínimas). Ver `docs/AUTHORIZATION.md`.
- **Segredos**: nunca commitados (`.env.example` só com placeholders; CI faz varredura). `SUPABASE_SERVICE_ROLE_KEY` só no backend; o frontend usa apenas `NEXT_PUBLIC_*`.
- **Transporte**: helmet, CORS restrito a `WEB_ORIGIN`, rate limit global (`RATE_LIMIT_MAX`/min).
- **Entrada**: validação zod em todo corpo/query; SQL sempre parametrizado (`SqlBuilder`); identificadores de tabela/coluna vêm do registro declarativo, nunca do cliente.
- **Auditoria**: trigger de linha + eventos de aplicação (`audit()`), consultável em `/admin/auditoria`.
- **Idempotência/concorrência**: ver `docs/ARCHITECTURE.md`.
- **Uploads**: bucket privado por organização no Supabase Storage (pendente de projeto Supabase; a UI lista anexos e mostra o aviso).
- **Erros**: mensagens sem stack trace; códigos de domínio estáveis (`packages/shared/src/errors.ts`).
