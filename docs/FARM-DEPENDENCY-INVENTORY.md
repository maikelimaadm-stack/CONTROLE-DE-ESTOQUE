# Inventário — dependência estrutural de "Fazenda"

> **Documento gerado.** Não edite à mão: `node scripts/farm-inventory.mjs`.

O núcleo do ERP precisa deixar de depender do nicho agro: **Fazenda → Empresa**
(`docs/MULTI-COMPANY-CONTRACT.md`, `docs/DOMAIN-NAMING-STANDARD.md`). Depois da migração física de
PRE-BASE2-03, um total único mentiria: `farm_id` numa migration aplicada é história, `X-Farm-Id` no
cliente HTTP é ponte com prazo, e "fazenda" no comentário de uma rota é o produto ainda falando o
nicho. Por isso cada ocorrência é classificada em um dos três baldes abaixo — e a catraca trava só o terceiro.

Total medido: **1580** ocorrências · 49 tabelas com coluna de empresa.

## Classificação (o número que importa é o balde 3)

| # | Balde | Ocorrências | Catraca | O que é |
| --- | --- | ---: | --- | --- |
| 1 | **LEGADO HISTÓRICO** | 1070 | não | Migrations aplicadas e documentação. O nome legado aqui é registro do que aconteceu; reescrever é falsificar história. |
| 2 | **COMPATIBILIDADE TRANSITÓRIA PERMITIDA** | 346 | não | Arquivos declarados em scripts/lib/empresa-compat-surface.mjs, cada um com motivo. Removidos em PRE-BASE2-05 (remoção da compatibilidade: colunas legadas, views e cabeçalho). |
| 3 | **DÍVIDA DE PRODUTO PROIBIDA** | 164 | **sim — só diminui** | O produto ainda fala o nicho onde não precisa. Alvo: zero. A catraca só deixa diminuir. |

A regra que impede maquiagem: **arquivo não declarado cai no balde 3 por definição.** Esconder dívida
exige declarar o arquivo com motivo em `scripts/lib/empresa-compat-surface.mjs` — e a declaração aparece no diff.

## Por superfície × balde

| Superfície | 1. Histórico | 2. Compatibilidade | 3. Dívida (travada) | Total |
| --- | ---: | ---: | ---: | ---: |
| Schema (migrations) | 268 | 0 | 0 | 268 |
| API — código | 0 | 14 | **48** | 62 |
| API — testes | 0 | 177 | **90** | 267 |
| Núcleo neutro de nicho (plataforma) | 0 | 0 | 0 | 0 |
| Pacotes compartilhados | 0 | 54 | **11** | 65 |
| Web — código | 0 | 19 | **11** | 30 |
| Web — navegação/rotas | 0 | 7 | 0 | 7 |
| Web — testes ponta a ponta | 0 | 28 | 0 | 28 |
| Scripts e gates | 0 | 47 | **4** | 51 |
| Documentação ativa | 289 | 0 | 0 | 289 |
| Documentação histórica (referência externa) | 513 | 0 | 0 | 513 |
| **Total** | **1070** | **346** | **164** | **1580** |

## Balde 2 — a ponte declarada

Cada arquivo abaixo pode falar o idioma antigo por um motivo escrito. Todos saem em **PRE-BASE2-05 (remoção da compatibilidade: colunas legadas, views e cabeçalho)**.

### Runtime — o que o cliente anterior consome

| Arquivo | Ocorrências | Por que pode |
| --- | ---: | --- |
| `apps/api/src/lib/compat-empresa.ts` | 12 | O adaptador. É a ponte inteira: tradução de entrada, apelidos de saída, cabeçalho e nomes legados de tabela. |
| `apps/api/src/server.ts` | 1 | Declara `X-Farm-Id` em allowedHeaders do CORS — sem isso o navegador do cliente antigo nem envia o cabeçalho. |
| `apps/api/src/lib/escopo-admin.ts` | 1 | Borda de administração: traduz o contrato legado `farm_ids` (lista vazia = todas) para o modelo canônico. Documentado em docs/MULTI-COMPANY-CONTRACT.md §6. |
| `apps/web/src/lib/compat-empresa.ts` | 13 | O adaptador do CLIENTE. Traduz caminho, query, corpo e resposta entre o idioma interno (empresa) e o idioma do FIO (legado) — necessário porque o CORS da API anterior não aceita `X-Empresa-Id` e o preflight morre no navegador. |
| `apps/web/src/lib/api.ts` | 5 | Cliente HTTP: promove a sessão gravada com `farmId` e envia `X-Farm-Id` como cabeçalho de contexto durante a janela de rollout. |
| `apps/web/src/lib/auth.tsx` | 1 | Lê `empresas ?? farms` de /auth/context enquanto a API anterior puder estar no ar. |
| `apps/web/nav.registry.mjs` | 7 | Redirecionamentos das rotas legadas de cadastro. |
| `packages/domain/src/resources/index.ts` | 1 | Chave de recurso legada `farms` resolvendo para o mesmo ResourceDef de `empresas`. |

### Prova — testes que quebram antes do cliente

| Arquivo | Ocorrências | Por que pode |
| --- | ---: | --- |
| `apps/api/test/integration/compat-empresa.test.ts` | 23 | Prova a tradução de borda: payload legado entra, resposta sai com os dois nomes, valores divergentes falham em 422. |
| `apps/api/test/unit/empresa-bridge.test.ts` | 3 | Prova o adaptador isoladamente (tabela de apelidos, formas id/texto/lista, valores opacos). |
| `apps/api/test/integration/api.test.ts` | 67 | Suíte geral escrita no idioma anterior (`farm_id`, `x-farm-id`): é a prova de version-skew de que o cliente antigo continua servido sem alteração. |
| `apps/api/test/integration/farm-scope.test.ts` | 58 | Escopo por empresa exercitado pelo contrato anterior (cabeçalho e coluna legados). |
| `apps/api/test/unit/farm-scope-guard.test.ts` | 20 | Guarda de escopo verificada pelos nomes anteriores. |
| `apps/api/test/integration/setup.ts` | 6 | Semeadura das suítes que ainda inserem pelo nome legado. |
| `packages/db/test/empresa-compat.test.ts` | 33 | Prova o espelho no banco: gatilhos, divergência recusada, view `erp.farms` com security_invoker. |
| `packages/db/test/backfill-empresas.test.ts` | 4 | Prova o backfill de `farm_id` → `empresa_id` linha a linha. |
| `packages/db/test/backfill-owner-restrito.test.ts` | 5 | Prova a conversão do escopo herdado de `erp.member_farms`. |
| `packages/db/test/responsavel-tenant.test.ts` | 2 | Consulta pela view legada para provar que ela enxerga o mesmo tenant. |
| `packages/db/test/notificacao-legado.test.ts` | 1 | Prova que a notificação legada continua resolvendo pela view. |
| `packages/db/test/schema.test.ts` | 3 | Afere a coexistência das duas colunas no schema real. |
| `apps/web/e2e/empresa-compat.spec.ts` | 8 | Prova no navegador que sessão antiga e cabeçalho antigo continuam funcionando. |
| `apps/web/e2e/acesso-empresa.spec.ts` | 3 | Lê `empresas ?? farms` como o cliente durante o rollout. |
| `apps/web/e2e/skew-api-anterior.spec.ts` | 17 | Version skew B no navegador: web desta PR contra a API EXATA do commit base. Fala o idioma antigo porque é ele que mede — CORS, recurso, corpo, query e resposta. |

### Confinamento — gates e dicionário

| Arquivo | Ocorrências | Por que pode |
| --- | ---: | --- |
| `scripts/farm-compat-allowlist.mjs` | 22 | O gate que confina a ponte: precisa citar cada símbolo legado para procurá-lo. |
| `scripts/lib/empresa-compat-surface.mjs` | 12 | Esta lista. |
| `scripts/company-schema-sync.mjs` | 4 | Confere par a par coluna canônica × coluna legada no schema. |
| `scripts/member-farms-audit.mjs` | 6 | Impede que `erp.member_farms` volte a ser autoridade de runtime. |
| `scripts/data-dictionary.mjs` | 1 | Gera o dicionário, que documenta a coluna legada enquanto ela existir. |
| `packages/domain/dicionario-dados.mjs` | 4 | Dicionário de dados: `erp.farms` e `farm_id` existem no banco e precisam estar documentados. |
| `packages/domain/empresa-rls.mjs` | 1 | Classificação de RLS: nomeia o arquivo morto de `erp.member_farms`. |
| `scripts/purchase-responsible-audit.mjs` | 2 | Mensagem de diagnóstico do gate cita a assinatura anterior. |

## Balde 3 — dívida de produto (alvo: zero)

Onde o produto ainda fala o nicho sem precisar. Ordem de ataque: quem concentra mais.

| Arquivo | Superfície | Ocorrências |
| --- | --- | ---: |
| `apps/api/test/integration/plataforma.test.ts` | API — testes | 14 |
| `apps/api/test/integration/notificacao-geracao.test.ts` | API — testes | 13 |
| `apps/api/test/integration/escopo-modulo.test.ts` | API — testes | 12 |
| `apps/api/test/integration/attachments-scope.test.ts` | API — testes | 11 |
| `apps/api/test/unit/report-scope.test.ts` | API — testes | 10 |
| `apps/api/test/integration/relatorio-escopo.test.ts` | API — testes | 9 |
| `apps/api/src/routes/resources.ts` | API — código | 8 |
| `apps/api/src/routes/stock.ts` | API — código | 7 |
| `apps/api/src/routes/livestock.ts` | API — código | 5 |
| `packages/db/src/seed.ts` | Pacotes compartilhados | 5 |
| `apps/api/src/lib/empresa.ts` | API — código | 4 |
| `apps/api/src/routes/admin.ts` | API — código | 4 |
| `apps/api/src/routes/reports.ts` | API — código | 4 |
| `apps/api/test/integration/existencia-funcional.test.ts` | API — testes | 4 |
| `apps/api/test/integration/notificacao-escopo.test.ts` | API — testes | 4 |
| `apps/web/src/features/livestock/herd-actions.tsx` | Web — código | 4 |
| `apps/api/src/lib/attachment-parent.ts` | API — código | 3 |
| `apps/api/src/plugins/auth.ts` | API — código | 3 |
| `apps/api/src/routes/fleet-hr.ts` | API — código | 3 |
| `apps/api/test/integration/escopo-admin.test.ts` | API — testes | 3 |
| `apps/api/test/integration/rebanho-autorizacao.test.ts` | API — testes | 3 |
| `apps/api/test/integration/rls-matriz.test.ts` | API — testes | 3 |
| `scripts/parity-map.mjs` | Scripts e gates | 3 |
| `apps/api/src/lib/context.ts` | API — código | 2 |
| `packages/domain/src/escopo-permissao.ts` | Pacotes compartilhados | 2 |
| _… mais 20 arquivo(s)_ | | 21 |

## Por símbolo (o que precisa migrar)

| Símbolo atual | Natureza | Total | dos quais dívida | Destino canônico |
| --- | --- | ---: | ---: | --- |
| `farm_id` | dado | 533 | 66 | `empresa_id` |
| `farms` | dado | 120 | 7 | `erp.empresas` |
| `member_farms` | dado | 71 | 5 | `member_empresas` |
| `ctx_farmId` | contrato | 9 | 0 | `empresaSelecionada` |
| `farmIds` | contrato | 0 | 0 | `empresasPermitidas` |
| `x_farm_id` | contrato | 81 | 17 | `X-Empresa-Id` |
| `farmScope` | contrato | 5 | 1 | `escopoEmpresa` |
| `allowedFarms` | contrato | 6 | 0 | `escopoEmpresa (@erp/plataforma)` |
| `farms` | contrato | 94 | 11 | `/empresas` |
| `fazenda` | texto | 661 | 57 | `Empresa (i18n: termos.empresa)` |

`dado` = exige migration e backfill · `contrato` = quebra clientes se mudar sem compatibilidade · `texto` = rótulo, resolvido por i18n.

## Tabelas com coluna de empresa

As 49 tabelas abaixo carregam a coluna legada espelhada ao lado da canônica `empresa_id`.

| Tabela | Coluna(s) legada(s) |
| --- | --- |
| `erp.animal_handlings` | `farm_id` |
| `erp.animal_movements` | `empresa_destino_id` · `farm_id` · `destination_farm_id` |
| `erp.animal_retroactive_costs` | `farm_id` |
| `erp.animals` | `farm_id` |
| `erp.areas` | `farm_id` |
| `erp.authorizer_empresas` | `farm_id` |
| `erp.bank_account_empresas` | `farm_id` |
| `erp.bank_movements` | `farm_id` |
| `erp.batches` | `farm_id` |
| `erp.breeding_seasons` | `farm_id` |
| `erp.budget_plannings` | `farm_id` |
| `erp.contracts` | `farm_id` |
| `erp.devolutions` | `farm_id` |
| `erp.dfe_documents` | `farm_id` |
| `erp.diet_batches` | `farm_id` |
| `erp.documents` | `farm_id` |
| `erp.earnings` | `farm_id` |
| `erp.empresa_cost_centers` | `farm_id` |
| `erp.equipment_transfers` | `empresa_origem_id` · `empresa_destino_id` · `origin_farm_id` · `destination_farm_id` |
| `erp.equipments` | `farm_id` |
| `erp.feed_batches` | `farm_id` |
| `erp.feed_deliveries` | `farm_id` |
| `erp.feedlot_yards` | `farm_id` |
| `erp.financial_freezes` | `farm_id` |
| `erp.financial_titles` | `farm_id` |
| `erp.fuel_supplies` | `farm_id` |
| `erp.grazing_modules` | `farm_id` |
| `erp.herd_lots` | `farm_id` |
| `erp.input_entries` | `farm_id` |
| `erp.invoices` | `farm_id` |
| `erp.journal_entries` | `farm_id` |
| `erp.livestock_plannings` | `farm_id` |
| `erp.maintenances` | `farm_id` |
| `erp.opening_balances` | `farm_id` |
| `erp.processings` | `farm_id` |
| `erp.proprietary_empresas` | `farm_id` |
| `erp.purchase_requests` | `farm_id` |
| `erp.rainfalls` | `farm_id` |
| `erp.requisitions` | `farm_id` |
| `erp.salary_advances` | `farm_id` |
| `erp.sales_documents` | `farm_id` |
| `erp.service_orders` | `farm_id` |
| `erp.stock_corrections` | `farm_id` |
| `erp.stock_movements` | `farm_id` |
| `erp.stock_writeoffs` | `farm_id` |
| `erp.trough_readings` | `farm_id` |
| `erp.warehouse_transfers` | `empresa_origem_id` · `empresa_destino_id` · `origin_farm_id` · `destination_farm_id` |
| `erp.warehouses` | `farm_id` |
| `erp.weighings` | `farm_id` |

## Como esta catraca funciona

`node scripts/farm-inventory.mjs --check` roda no `lint` e falha quando:

1. a **dívida de produto** cresce em qualquer superfície (balde 3, comparado a `scripts/farm-inventory.baseline.json`);
2. um arquivo **declarado** na ponte não tem mais nome legado — a autorização virou letra morta e precisa sair da lista.

Para crescer a ponte de propósito, declare o arquivo com motivo em `scripts/lib/empresa-compat-surface.mjs` e
regenere o baseline no MESMO commit: a intenção fica visível na revisão.
