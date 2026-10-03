# Segurança

- **Autenticação**: `AUTH_MODE=supabase` valida o JWT do Supabase Auth (`SUPABASE_JWT_SECRET`, HS256) e resolve `erp.users` por `auth_user_id`; `AUTH_MODE=local` (dev/test/CI) usa bcrypt + JWT assinado com `LOCAL_AUTH_SECRET`. Login local tem rate limit (10/min/IP) e registra `login` na auditoria.
- **Multi-tenant**: todo request carrega `X-Org-Id` (validado contra `organization_members` ativo) e opcionalmente `X-Empresa-Id` (`X-Farm-Id` aceito durante o rollout; os dois com valores divergentes → 422). A transação executa `SET LOCAL app.org_id/app.user_id`; a API conecta como `erp_app` **sem** bypass de RLS.
- **Isolamento por EMPRESA no banco** (PRE-BASE2-03): a política das tabelas de escopo é `tenant_e_empresa` — organização **e** empresa no escopo do membro, com escrita restrita por `erp.empresa_escrita_permitida`. A política de tenant foi SUBSTITUÍDA, não acompanhada: políticas `PERMISSIVE` se combinam com **OR**, e uma segunda política ao lado manteria o vazamento. O módulo ativo chega ao banco pela GUC `app.modulo_empresa`, publicada pelo `runService` a partir da PERMISSÃO da rota — nunca do cabeçalho, da query, do corpo ou do pathname. Matriz em `docs/COMPANY-RLS-MATRIX.md` (nenhuma tabela "não auditada"), com a política de CADA comando; prova lendo pelo papel da aplicação em `apps/api/test/integration/rls-empresa.test.ts`. Transferência entre empresas tem TRÊS contratos, não um — ler pelas duas pontas não é escrever pelas duas (§8.3 do contrato multiempresa); e toda ação de transferência confere ROW COUNT, porque a RLS não recusa um UPDATE fora de escopo: ela o transforma em zero linhas, que sem conferência vira sucesso com efeito nenhum.
- **Funções `SECURITY DEFINER`**: são **37** vivas depois da 0047 (OPERACOES-01 F7), em três grupos:
  - **3 da própria RLS** (0001/0007), que as políticas chamam: `erp.has_permission`, `erp.is_member` e
    `erp.effective_user_id`.
  - **8 PORTAS** (sete que a API chama e uma só por dentro de outra), estreitas por construção — `erp.movimentos_conta_organizacao` (agregado de conta
    bancária, 0015), `erp.extrato_conta_organizacao` (o extrato da conta na Central Financeira, 0042, recortado por
    dentro pelo escopo de empresa do módulo financeiro — decisão do Maike de 03/10),
    `erp.processar_transferencia_pecuaria_destino` (aceite da transferência de rebanho pelo destino, 0015),
    `erp.situacao_atraso_cliente` (só AGREGADOS do atraso do cliente, 0033/0039), `erp.reserva_estoque` (o saldo
    reservado, 0035/0043) e, só por dentro dela (EXECUTE só do dono), `erp.reserva_estoque_nucleo`; e duas que só
    devolvem BOOLEANO, `erp.empresa_da_organizacao_atual` e `erp.lote_da_empresa_atual` (0015: a emissão de uma
    transferência precisa validar a empresa e o lote de DESTINO, que estão fora do escopo de quem emite — responder
    isso pela política de leitura transformaria "não vejo" em "não existe" e recusaria emissão legítima). O contrato
    das sete que a API chama é o mesmo: `search_path` fixo, organização e usuário lidos da GUC do SERVIDOR (nunca de parâmetro do
    cliente), capacidades reconferidas dentro da função, predicado de tenant explícito, sem SQL dinâmico, `execute`
    revogado de `public` e concedido só a `erp_app`. Cada uma sabe exatamente QUAL registro, QUAIS entidades e QUAL
    ação — não devolvem linha arbitrária nem aceitam tabela ou organização por parâmetro (a organização da
    `reserva_estoque_nucleo` vem da `reserva_estoque`, que a leu da GUC). É o que separa uma porta autorizada de um
    bypass: uma porta específica demais para servir a outra coisa.
  - **26 funções de GATILHO**, que não se chamam fora do gatilho e não devolvem linha: `erp.audit_row` grava a
    auditoria; as outras atravessam a RLS de quem grava SÓ para conferir uma invariante que mora em outra empresa ou
    noutro documento (o pedido de origem, a nota da mesma chave, o cadastro da organização) e recusam. São `erp.audit_row` (0001); `validar_item_transferencia_pecuaria`
    e `validar_lotes_transferencia_pecuaria` (0015); `products_controle_lote`, `produto_detalhes_conferir` e
    `stock_movements_exige_lote` (0029); `products_controle_estoque_reserva` e `stock_movement_reserva_guarda` (0035);
    `documentos_compra_itens_documento_aberto` (0036); `documentos_estoque_conferir` e
    `documentos_estoque_itens_documento_aberto` (0040); `aprovacoes_estoque_conferir`, `aprovacoes_venda_conferir`,
    `documentos_compra_aprovacao_guarda`, `documentos_estoque_aprovacao_guarda` e `venda_aprovacao_guarda` (0041); a
    transição do documento de estoque `documentos_estoque_transicao` (que a 0043 tornou SECURITY DEFINER) e a guarda dos
    itens `documentos_estoque_item_origem_guarda` (0043); as da F6a, `aprovacoes_compra_conferir_v2`,
    `documentos_compra_conferir_v3`, `documentos_compra_finalizacao_guarda`, `documentos_compra_item_orcamento_guarda`,
    `documentos_compra_item_origem_guarda_v2` e `documentos_compra_transicao_v3` (0044, que apagou as versões
    anteriores); e as da nota repetida, `documentos_compra_nota_guarda` e `invoices_chave_nota_guarda` (0047, com a trava
    da chave). Todas no schema `erp`, com `search_path` fixo — inclusive `erp.audit_row` (0001), fixada em
    `erp, pg_temp` pela 0048 (OPERACOES-01 F12, decisão 288) sem reescrever o corpo.
  - **Como contar** (para o revisor refazer): no banco migrado até a última migration,
    `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'erp' and p.prosecdef order by 1;`
    (37 linhas, conferido em 03/10 num banco de teste local com a 0047); pelo repositório,
    `grep -il "security definer" supabase/migrations/*.sql` lista os arquivos (a maioria dos acertos é comentário ou
    pré-condição), e em cada um conta o `create [or replace] function … security definer` FORA de comentário; o
    `create or replace` posterior vale como o último estado (a 0043 tornou definer a transição do estoque), e o
    `drop function` tira da conta (a 0037 e a 0044 apagaram cinco versões anteriores de compras).
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
  qualquer conta daquele provedor. **O formato é VERIFICADO no startup**: cada item tem de ser
  `-<conta>.vercel.app`, e um valor genérico ou malformado (`.vercel.app`, `vercel.app`, `*.vercel.app`,
  esquema colado, porta, caminho, credencial embutida, conta com ponto, caractere fora do ASCII
  imprimível) **derruba o processo** em `loadConfig` e em `buildApp` — nunca é corrigido em silêncio,
  porque remover o `https://` de um valor errado produz um valor plausível e quem digitou não descobre.
  O erro de startup **não imprime o valor recusado**, só a posição dele na lista: a variável fica ao lado
  das que guardam DSN e token, e colar a errada no campo errado é o engano mais comum ali. Variável
  ausente = nenhum preview aceito. Dono do contrato: `apps/api/src/lib/cors-origem.ts`.
  **Limite declarado da âncora**: o que se verifica é o FIM do host (`-<conta>.vercel.app` com um rótulo
  na frente); o rótulo em si é livre, então a âncora garante "ninguém entra só por ter conta no provedor"
  e **não** garante "ninguém além de nós consegue um nome que case" — `*.vercel.app` é namespace global
  do provedor e a política de reivindicação dele não foi confirmada por este repositório. Fechar o resto
  exigiria a forma completa do hostname gerado, com risco de recusar preview legítimo.
  Rate limit global (`RATE_LIMIT_MAX`/min).
- **Entrada**: validação zod em todo corpo/query; SQL sempre parametrizado (`SqlBuilder`); identificadores de tabela/coluna vêm do registro declarativo, nunca do cliente.
- **Auditoria**: trigger de linha + eventos de aplicação (`audit()`), consultável em `/admin/auditoria`.
- **Idempotência/concorrência**: ver `docs/ARCHITECTURE.md`.
- **Uploads**: bucket privado por organização no Supabase Storage (pendente de projeto Supabase; a UI lista anexos e mostra o aviso).
- **Erros**: mensagens sem stack trace; códigos de domínio estáveis (`packages/shared/src/errors.ts`).
