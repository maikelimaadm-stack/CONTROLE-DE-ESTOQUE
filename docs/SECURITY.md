# Segurança

- **Autenticação**: `AUTH_MODE=supabase` valida o JWT do Supabase Auth (`SUPABASE_JWT_SECRET`, HS256) e resolve `erp.users` por `auth_user_id`; `AUTH_MODE=local` (dev/test/CI) usa bcrypt + JWT assinado com `LOCAL_AUTH_SECRET`. Login local tem rate limit (10/min/IP) e registra `login` na auditoria.
- **Multi-tenant**: todo request carrega `X-Org-Id` (validado contra `organization_members` ativo) e opcionalmente `X-Empresa-Id` (`X-Farm-Id` aceito durante o rollout; os dois com valores divergentes → 422). A transação executa `SET LOCAL app.org_id/app.user_id`; a API conecta como `erp_app` **sem** bypass de RLS.
- **Isolamento por EMPRESA no banco** (PRE-BASE2-03): a política das tabelas de escopo é `tenant_e_empresa` — organização **e** empresa no escopo do membro, com escrita restrita por `erp.empresa_escrita_permitida`. A política de tenant foi SUBSTITUÍDA, não acompanhada: políticas `PERMISSIVE` se combinam com **OR**, e uma segunda política ao lado manteria o vazamento. O módulo ativo chega ao banco pela GUC `app.modulo_empresa`, publicada pelo `runService` a partir da PERMISSÃO da rota — nunca do cabeçalho, da query, do corpo ou do pathname. Matriz em `docs/COMPANY-RLS-MATRIX.md` (nenhuma tabela "não auditada"), com a política de CADA comando; prova lendo pelo papel da aplicação em `apps/api/test/integration/rls-empresa.test.ts`. Transferência entre empresas tem TRÊS contratos, não um — ler pelas duas pontas não é escrever pelas duas (§8.3 do contrato multiempresa); e toda ação de transferência confere ROW COUNT, porque a RLS não recusa um UPDATE fora de escopo: ela o transforma em zero linhas, que sem conferência vira sucesso com efeito nenhum.
- **Portas `SECURITY DEFINER`**: existem QUATRO, e as quatro são estreitas por construção —
  `erp.movimentos_conta_organizacao` (agregado de conta bancária), `erp.processar_transferencia_pecuaria_destino`
  (aceite da transferência de rebanho pelo destino) e duas que só devolvem BOOLEANO,
  `erp.empresa_da_organizacao_atual` e `erp.lote_da_empresa_atual` (a emissão de uma transferência precisa
  validar a empresa e o lote de DESTINO, que estão fora do escopo de quem emite — responder isso pela
  política de leitura transformaria "não vejo" em "não existe" e recusaria emissão legítima). O contrato de
  todas é o mesmo: `search_path` fixo,
  organização e usuário lidos da GUC do SERVIDOR (nunca de parâmetro do cliente), capacidades reconferidas
  dentro da função, predicado de tenant explícito, sem SQL dinâmico, `execute` revogado de `public` e
  concedido só a `erp_app`. Cada uma sabe exatamente QUAL registro, QUAIS entidades e QUAL ação — não
  devolvem linha arbitrária nem aceitam tabela/organização por parâmetro. É o que separa uma porta
  autorizada de um bypass: uma porta específica demais para servir a outra coisa.
- **Integridade da emissão de `farm_transfer`** (PRE-BASE2-03): `animal_movement_items.animal_id` e
  `animal_movements.batch_id` são chaves estrangeiras GLOBAIS — provam que o UUID existe, não que ele é
  desta organização. A emissão valida EM LOTE, antes de o documento existir, que cada animal é da
  organização, da empresa de ORIGEM, `status='active'`, não excluído, não repetido e (quando há lote
  informado) do próprio lote; e que os lotes de origem e destino pertencem às respectivas empresas. A recusa
  é GENÉRICA: UUID inexistente, de outro tenant, da empresa errada ou em estado inelegível têm a MESMA
  superfície pública — distingui-los seria um oráculo de existência do acervo alheio. Os gatilhos
  `trg_validar_item_transferencia_pecuaria` e `trg_validar_lotes_transferencia_pecuaria` repetem o invariante
  no BANCO, só para `movement_type='farm_transfer'`; o aceite reconfere `status`/`deleted_at`, porque entre
  emitir e aceitar o animal pode ter sido vendido, morto ou excluído.
- **ID Global (`55`)** (PRE-BASE2-04): atalho curto e adivinhável é onde a autorização costuma vazar, então a resolução NÃO confia no índice. Ela carrega o REGISTRO FONTE VIVO e decide por ele: organização, empresa **ATUAL** do registro (um animal transferido de empresa muda de dono, e o índice continua com a pista antiga), permissão **daquele registro** (um título a pagar e um a receber moram na mesma tabela e têm permissões diferentes) e existência (excluído não navega; cancelado navega). Toda negativa é o MESMO 404 — número inexistente, número de outro tenant, empresa fora do escopo, falta de capacidade e registro excluído são indistinguíveis de fora, porque a diferença entre as respostas já contaria o acervo alheio. O caminho inverso (`/registros-globais/entidade/:tipo/:id`, que a tela usa para exibir o `#N`) aplica exatamente a mesma autorização: duas portas com dois critérios acabam sempre na mais frouxa. `#N` nunca vira URL: não existe `/registro/55`, a URL final é a rota canônica com o UUID. A empresa **SELECIONADA** na tela não entra nessa decisão: ela é contexto de trabalho, e usá-la produzia um 403 no meio de uma superfície 404 — um oráculo dizendo "este número existe, só o seu contexto não bate" — além de esconder do usuário registros que ele legitimamente pode ver noutro módulo. O que decide continua sendo o escopo REAL do registro. No caminho inverso, o `:id` é validado como UUID antes de qualquer consulta: id malformado responde a mesma 404 de id válido inexistente, sem 500 e sem mensagem do PostgreSQL vazando.
- **Views**: toda view do schema `erp` é `security_invoker = true`. Sem isso a view roda com os direitos do DONO (papel de migração, com `bypassrls`) e devolve linhas de todas as organizações — foi o caso de `erp.v_bank_account_balances`, corrigido na 0015.
- **Autorização**: permissão por rota (`runService`) + verificações de empresa (`empresaPermitida`, `exigirEmpresaDeLancamento`) + regras de negócio (autorizador, valor máximo, cotações mínimas). Ver `docs/AUTHORIZATION.md`.
- **Segredos**: nunca commitados (`.env.example` só com placeholders; CI faz varredura). `SUPABASE_SERVICE_ROLE_KEY` só no backend; o frontend usa apenas `NEXT_PUBLIC_*`.
- **Transporte**: helmet, CORS restrito a `WEB_ORIGIN` (origens exatas) e, opcionalmente, aos previews do
  próprio projeto por `WEB_ORIGIN_PREVIEW_SUFFIX` — sufixo ANCORADO na conta, nunca curinga de provedor.
  A API responde com `credentials`, então um `*.vercel.app` genérico entregaria a API autenticada a
  qualquer conta daquele provedor. Variável ausente = nenhum preview aceito (`lib/cors-origem.ts`).
  Rate limit global (`RATE_LIMIT_MAX`/min).
- **Entrada**: validação zod em todo corpo/query; SQL sempre parametrizado (`SqlBuilder`); identificadores de tabela/coluna vêm do registro declarativo, nunca do cliente.
- **Auditoria**: trigger de linha + eventos de aplicação (`audit()`), consultável em `/admin/auditoria`.
- **Idempotência/concorrência**: ver `docs/ARCHITECTURE.md`.
- **Uploads**: bucket privado por organização no Supabase Storage (pendente de projeto Supabase; a UI lista anexos e mostra o aviso).
- **Erros**: mensagens sem stack trace; códigos de domínio estáveis (`packages/shared/src/errors.ts`).
