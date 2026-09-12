# Autorização

## Catálogo
`packages/domain/src/permissions.ts` declara recursos × ações (`<recurso>.<ação>`), 773 chaves, espelhando os 666 checkboxes da referência (`docs/reference/PERMISSIONS.md`) e acrescentando ações de fluxo (`settle`, `cancel_settlement`, `transfer`, `process`, `generate_financial`, `export`, `reconcile`…). `GET /api/admin/permissions` devolve a árvore usada pela tela de perfis.

## Perfis
- `erp.roles` por organização; `role_permissions` (chave). Perfis de sistema (`is_system`) têm permissões fixas.
- Membro (`organization_members`) tem um perfil, `is_owner` (todas as permissões) e fazendas permitidas (`member_farms`; vazio = todas).
- Seed demo: "Administrador" (owner) e "Operador de Estoque" (produtos/estoque/requisições/solicitações, sem financeiro).

## Aplicação
1. `runService(app, req, "titulos.settle", …)` → 403 `PERMISSION_DENIED` antes de qualquer efeito.
2. Escopo de fazenda (`member_farms`; vazio = todas as fazendas da organização). **Regra: nenhuma consulta de recurso farm-scoped pode usar somente `ctx.farmId` como autorização** — `ctx.farmId` (`X-Farm-Id`) é seleção de trabalho; `membership.farmIds` é a autorização. Helpers oficiais em `apps/api/src/lib/context.ts`:
   - LISTAGEM/AGREGADO: `farmScope(ctx, alias, params, { nullable?, ignoreSelected? })` (cláusulas `farm_id=` da fazenda selecionada + `farm_id = any(membership)`), ou `allowedFarms(ctx, pedido?)` para o padrão `($n::uuid[] is null or col = any($n))` (dashboards, contadores, lookups) — pedido fora do escopo vira lista vazia, nunca "todas";
   - DETALHE: `scopedById(ctx, alias, id)` — fora do escopo o registro não é visível → 404 `NOT_FOUND` (não expõe existência); `X-Farm-Id` de fazenda não permitida é recusado na entrada (403);
   - CREATE/UPDATE/ações: `farmAllowed(ctx, farm_id)` no payload (422 "Sem acesso à fazenda") e `assertFarmVisible(ctx, row.farm_id)` (404) no registro carregado para cancelar/alterar; carregadores compartilhados (`getTitle`, `getDoc`, `loadRequest`, `loadForWrite`, `getOne`) já aplicam o escopo;
   - CHILD RESOURCE (sem farm_id): autorização derivada do pai (ex.: acasalamentos pela fazenda da matriz, cotações pela solicitação, depreciações pelo bem, alertas pelo equipamento) — nunca criar farm_id redundante só para autorizar;
   - RELATÓRIOS/EXPORTS: `farmClause()` em `reports.ts` inclui membership; exports de recursos usam `listResource`.
   Cobertura: Financeiro (títulos, movimentos bancários [farm_id nulo = organização], planejamento, relatórios, dashboards), Vendas (documentos, ABC), Estoque (saldos por armazém, ledger, todos os documentos, transferências por origem/destino, DFe), OS (lista, detalhe, monitoramento), Frota/RH (bens, manutenções, abastecimentos, depreciação, alertas, adiantamentos, apuração), Compras (solicitações e derivados), Pecuária/Confinamento (animais, movimentações, manejos, pesagens, lotes de rebanho, processamentos, dietas, tratos, mapa, reprodução), recursos genéricos `farmScoped` (lista, id, options, distinct). Organization-scoped por desenho: contas bancárias/fluxo de caixa/OFX (por conta), formulações, membros, notificações genéricas. Guardrail: `apps/api/test/unit/farm-scope-guard.test.ts` falha para handler que toque tabela com `farm_id` sem passar por um desses mecanismos (exceções listadas com motivo). RLS isola apenas por organização — o escopo de fazenda é responsabilidade da API. Pendência conhecida: anexos (`/attachments`, recurso filho genérico por `entity/entity_id`) exigem a permissão `attachments.*` e o tenant, mas não derivam a fazenda do registro pai.
3. Regras adicionais: autorizador ativo/valor máximo/cotações mínimas (aprovação), responsável atual (transferência), período congelado, status do documento.
4. RLS como última linha de defesa (ver `docs/SECURITY.md`).
5. UI: `can()` apenas oculta ações; testes e2e confirmam que a rota direta é negada pelo servidor.
