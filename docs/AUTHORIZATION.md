# Autorização

## Catálogo
`packages/domain/src/permissions.ts` declara recursos × ações (`<recurso>.<ação>`), 773 chaves, espelhando os 666 checkboxes da referência (`docs/reference/PERMISSIONS.md`) e acrescentando ações de fluxo (`settle`, `cancel_settlement`, `transfer`, `process`, `generate_financial`, `export`, `reconcile`…). `GET /api/admin/permissions` devolve a árvore usada pela tela de perfis.

## Perfis
- `erp.roles` por organização; `role_permissions` (chave). Perfis de sistema (`is_system`) têm permissões fixas.
- Membro (`organization_members`) tem um perfil, `is_owner` (todas as permissões) e fazendas permitidas (`member_farms`; vazio = todas).
- Seed demo: "Administrador" (owner) e "Operador de Estoque" (produtos/estoque/requisições/solicitações, sem financeiro).

## Aplicação
1. `runService(app, req, "titulos.settle", …)` → 403 `PERMISSION_DENIED` antes de qualquer efeito.
2. Escopo de fazenda (`member_farms`; vazio = todas as fazendas da organização): escritas validam `farm_id` (`farmAllowed`); leituras usam `farmScope(ctx, alias, params)` / `scopedById(ctx, alias, id)` (`apps/api/src/lib/context.ts`), que restringem a `membership.farmIds` **e** à fazenda selecionada (`X-Farm-Id`). Registro fora do escopo não é visível: GET por id responde 404 `NOT_FOUND` (não expõe existência) e some das listas; `X-Farm-Id` de fazenda não permitida é recusado na entrada (403). Aplicado em: animais, movimentações, manejos, pesagens (Pecuária), manutenções e abastecimentos (Frota), compras e recursos com `farmScoped`. **RLS isola apenas por organização** — o escopo de fazenda é responsabilidade da API. Pendência conhecida (fora da V2): listagens de Financeiro, Vendas, Estoque (parte) e OS ainda filtram só por `X-Farm-Id`; um membro restrito sem fazenda selecionada vê todas as fazendas da organização nessas listas — migrar para `farmScope` é trabalho de segurança à parte.
3. Regras adicionais: autorizador ativo/valor máximo/cotações mínimas (aprovação), responsável atual (transferência), período congelado, status do documento.
4. RLS como última linha de defesa (ver `docs/SECURITY.md`).
5. UI: `can()` apenas oculta ações; testes e2e confirmam que a rota direta é negada pelo servidor.
