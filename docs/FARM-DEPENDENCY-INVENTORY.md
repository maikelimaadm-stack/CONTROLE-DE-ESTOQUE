# Inventário — dependência estrutural de "Fazenda"

> **Documento gerado.** Não edite à mão: `node scripts/farm-inventory.mjs`.

O núcleo do ERP precisa deixar de depender do nicho agro: **Fazenda → Empresa**
(`docs/MULTI-COMPANY-CONTRACT.md`, `docs/DOMAIN-NAMING-STANDARD.md`). Depois da migração física de
PRE-BASE2-03, um total único mentiria: `farm_id` numa migration aplicada é história, `X-Farm-Id` no
cliente HTTP é ponte com prazo, e "fazenda" no comentário de uma rota é o produto ainda falando o
nicho. Por isso cada ocorrência é classificada em um dos três baldes abaixo — e a catraca trava só o terceiro.

Total medido: **1416** ocorrências · 49 tabelas com coluna de empresa.

## Classificação (o número que importa é o balde 3)

| # | Balde | Ocorrências | Catraca | O que é |
| --- | --- | ---: | --- | --- |
| 1 | **LEGADO HISTÓRICO** | 1097 | não | Migrations aplicadas e documentação. O nome legado aqui é registro do que aconteceu; reescrever é falsificar história. |
| 2 | **COMPATIBILIDADE TRANSITÓRIA PERMITIDA** | 205 | não | Arquivos declarados em scripts/lib/empresa-compat-surface.mjs, cada um com motivo. Removidos em PRE-BASE2-05C (purga física: colunas legadas, view erp.farms, gatilhos de espelho e a chave da sequência). |
| 3 | **DÍVIDA DE PRODUTO PROIBIDA** | 114 | **sim — só diminui** | O produto ainda fala o nicho onde não precisa. Alvo: zero. A catraca só deixa diminuir. |

A regra que impede maquiagem: **arquivo não declarado cai no balde 3 por definição.** Esconder dívida
exige declarar o arquivo com motivo em `scripts/lib/empresa-compat-surface.mjs` — e a declaração aparece no diff.

## Por superfície × balde

| Superfície | 1. Histórico | 2. Compatibilidade | 3. Dívida (travada) | Total |
| --- | ---: | ---: | ---: | ---: |
| Schema (migrations) | 274 | 0 | 0 | 274 |
| API — código | 0 | 9 | **48** | 57 |
| API — testes | 0 | 22 | **51** | 73 |
| Núcleo neutro de nicho (plataforma) | 0 | 4 | 0 | 4 |
| Pacotes compartilhados | 0 | 82 | **11** | 93 |
| Web — código | 0 | 0 | 0 | 0 |
| Web — navegação/rotas | 0 | 7 | 0 | 7 |
| Web — testes ponta a ponta | 0 | 26 | 0 | 26 |
| Scripts e gates | 0 | 55 | **4** | 59 |
| Documentação ativa | 310 | 0 | 0 | 310 |
| Documentação histórica (referência externa) | 513 | 0 | 0 | 513 |
| **Total** | **1097** | **205** | **114** | **1416** |

## Balde 2 — a ponte declarada

Cada arquivo abaixo pode falar o idioma antigo por um motivo escrito. Todos saem em **PRE-BASE2-05C (purga física: colunas legadas, view erp.farms, gatilhos de espelho e a chave da sequência)**.

### Runtime — o que o cliente anterior consome

| Arquivo | Ocorrências | Por que pode |
| --- | ---: | --- |
| `apps/api/src/lib/contrato-legado.ts` | 9 | CONTRATO NEGATIVO (não é tradutor): nomeia o cabeçalho, os campos e o formato administrativo anteriores para RECUSÁ-LOS com erro de validação. Existe porque `z.object` descarta chave desconhecida — um `farm_id` ignorado em silêncio mudaria a empresa da operação. Sai depois da 05C, e só com tráfego real observado. |
| `apps/web/nav.registry.mjs` | 7 | Redirecionamentos das rotas legadas de cadastro — navegação de favoritos do usuário, não protocolo de API. Ficam até a 05C. |

### Prova — testes que quebram antes do cliente

| Arquivo | Ocorrências | Por que pode |
| --- | ---: | --- |
| `apps/api/test/integration/contrato-empresa.test.ts` | 21 | Prova o CONTRATO NEGATIVO com requisições reais: cabeçalho, corpo, query, recurso e entidade de anexo anteriores são recusados — e o canônico funciona. Cita o nome antigo para provar que ele NÃO é aceito. |
| `apps/api/test/unit/attachment-parent-guard.test.ts` | 1 | Prova que o nome ANTERIOR de tabela não resolve mais como entidade anexável. |
| `packages/plataforma/test/sessao-empresa.test.ts` | 4 | Prova que a sessão gravada por um cliente anterior à virada canônica é INVÁLIDA (sem promoção) e que o contrato de valor é exigido. |
| `packages/db/test/empresa-compat.test.ts` | 33 | Prova o espelho no banco: gatilhos, divergência recusada, view `erp.farms` com security_invoker. FÍSICO: sai na 05C. |
| `packages/db/test/backfill-empresas.test.ts` | 4 | Prova o backfill de `farm_id` → `empresa_id` linha a linha. FÍSICO: sai na 05C. |
| `packages/db/test/backfill-owner-restrito.test.ts` | 5 | Prova a conversão do escopo herdado de `erp.member_farms`. FÍSICO: sai na 05C. |
| `packages/db/test/responsavel-tenant.test.ts` | 2 | Consulta pela view legada para provar que ela enxerga o mesmo tenant. FÍSICO: sai na 05C. |
| `packages/db/test/notificacao-legado.test.ts` | 1 | Prova que a notificação legada continua resolvendo pela view. FÍSICO: sai na 05C. |
| `packages/db/test/schema.test.ts` | 3 | Afere a coexistência das duas colunas no schema real. FÍSICO: sai na 05C. |
| `packages/db/test/upgrade-acervo.test.ts` | 25 | Upgrade com acervo: escreve o histórico no idioma ANTERIOR (`farm_id`), como a API antiga gravava, e só então aplica 0014→0016. Falar o idioma novo aqui inventaria um acervo que nunca existiu. FÍSICO: sai na 05C. |
| `packages/db/test/upgrade-rollback.test.ts` | 4 | Mesmo acervo legado, para provar que uma falha depois da janela estrutural da 0014 devolve o ledger protegido. FÍSICO: sai na 05C. |
| `apps/web/e2e/empresa-canonica.spec.ts` | 8 | Cutover canônico medido no navegador: cita o nome antigo para provar que ele NÃO sai no fio e que a sessão anterior não é mais promovida. |
| `apps/web/e2e/skew-api-producao.spec.ts` | 14 | Version skew SENTIDO 1 (web deste HEAD × API da base): cita o nome antigo para provar que ele NÃO sai do cliente canônico. |
| `apps/web/e2e/skew-web-anterior.spec.ts` | 4 | Version skew SENTIDO 2 (web da base × API deste HEAD): cita o nome antigo para provar que a API nova o RECUSA — e que o cliente em produção não depende dele. |

### Confinamento — gates e dicionário

| Arquivo | Ocorrências | Por que pode |
| --- | ---: | --- |
| `scripts/farm-compat-allowlist.mjs` | 22 | O gate que confina o que resta: precisa citar cada símbolo legado para procurá-lo. É ELE o guardrail do servidor canônico — o que não estiver declarado aqui reprova. |
| `apps/web/scripts/empresa-canonica-audit.mjs` | 10 | A catraca do cliente canônico (PRE-BASE2-05A): precisa citar cada símbolo legado para PROIBI-LO no web produtivo. Sem o tradutor de fio, um nome legado que voltasse ao cliente não quebraria em runtime — a API bilíngue aceitaria —, e é esta lista que o pega. |
| `scripts/lib/empresa-compat-surface.mjs` | 10 | Esta lista. |
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
| `apps/api/test/integration/api.test.ts` | API — testes | 16 |
| `apps/api/test/integration/escopo-empresa-matriz.test.ts` | API — testes | 16 |
| `apps/api/test/unit/escopo-empresa-guard.test.ts` | API — testes | 11 |
| `apps/api/src/routes/resources.ts` | API — código | 8 |
| `apps/api/src/routes/stock.ts` | API — código | 7 |
| `apps/api/src/routes/livestock.ts` | API — código | 5 |
| `packages/db/src/seed.ts` | Pacotes compartilhados | 5 |
| `apps/api/src/lib/empresa.ts` | API — código | 4 |
| `apps/api/src/routes/admin.ts` | API — código | 4 |
| `apps/api/src/routes/reports.ts` | API — código | 4 |
| `apps/api/test/integration/attachments-scope.test.ts` | API — testes | 4 |
| `apps/api/src/lib/attachment-parent.ts` | API — código | 3 |
| `apps/api/src/routes/fleet-hr.ts` | API — código | 3 |
| `apps/api/test/integration/rls-matriz.test.ts` | API — testes | 3 |
| `scripts/parity-map.mjs` | Scripts e gates | 3 |
| `apps/api/src/lib/context.ts` | API — código | 2 |
| `apps/api/src/plugins/auth.ts` | API — código | 2 |
| `packages/domain/src/escopo-permissao.ts` | Pacotes compartilhados | 2 |
| `apps/api/src/lib/escopo-admin.ts` | API — código | 1 |
| `apps/api/src/routes/attachments.ts` | API — código | 1 |
| `apps/api/src/routes/sales.ts` | API — código | 1 |
| `apps/api/src/routes/supply.ts` | API — código | 1 |
| `apps/api/src/server.ts` | API — código | 1 |
| `apps/api/src/services/stock-core.ts` | API — código | 1 |
| `apps/api/test/unit/escopo-classificacao.test.ts` | API — testes | 1 |
| _… mais 5 arquivo(s)_ | | 5 |

## Por símbolo (o que precisa migrar)

| Símbolo atual | Natureza | Total | dos quais dívida | Destino canônico |
| --- | --- | ---: | ---: | --- |
| `farm_id` | dado | 434 | 4 | `empresa_id` |
| `farms` | dado | 118 | 0 | `erp.empresas` |
| `member_farms` | dado | 69 | 15 | `member_empresas` |
| `ctx_farmId` | contrato | 9 | 0 | `empresaSelecionada` |
| `farmIds` | contrato | 0 | 0 | `empresasPermitidas` |
| `x_farm_id` | contrato | 44 | 7 | `X-Empresa-Id` |
| `farmScope` | contrato | 3 | 2 | `escopoEmpresa` |
| `allowedFarms` | contrato | 6 | 3 | `escopoEmpresa (@erp/plataforma)` |
| `farms` | contrato | 78 | 6 | `/empresas` |
| `fazenda` | texto | 655 | 77 | `Empresa (i18n: termos.empresa)` |

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
