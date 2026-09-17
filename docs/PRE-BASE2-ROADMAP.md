# Roteiro até o Modelo Base 2

> Ordem e fronteiras das próximas missões. Cada linha é **uma PR**. A separação de responsabilidades é o que
> torna cada passo reversível: missão que mistura contrato, migração e interface não tem como voltar atrás.

## Sequência

| # | Missão | Entrega | Depende de |
| --- | --- | --- | --- |
| 1 | **PRE-BASE2-01** — Fundação | Contratos (empresa, ID Global, i18n), dicionário de dados, inventário de "fazenda", auditores e gates. ✅ concluída | — |
| 2 | **PRE-BASE2-02** — Empresa e permissões | Modelo de permissão por empresa (granularidade por módulo), camada de compatibilidade sobre o mecanismo de fazenda atual, `member_empresas` gravando a autorização já no formato explícito do contrato (`todas` × `selecionadas`), aposentando a ponte de compatibilidade. | 01 |
| 3 | **PRE-BASE2-03** — Migração fazenda → empresa | Tabela, colunas, cabeçalho, rotas e RLS migrados para o idioma canônico, com compatibilidade bidirecional (view `security_invoker`, coluna espelho por gatilho, adaptador de borda) e isolamento por empresa dentro do banco. ✅ concluída | 02 |
| 4 | **PRE-BASE2-04** — ID Global | Alocação automática nas 29 portas de escrita + porta genérica, backfill operacional determinístico e retomável, resolução na busca global (`55`, `#55`, `ID 55`) e exibição do número no registro. 🟡 **implementação pronta — ativação em produção pendente** | 01 (03 recomendada) |
| 5 | **PRE-BASE2-05** — Contexto multiempresa | Seletor "todas / uma / conjunto", filtros e painéis consolidados, seleção obrigatória no lançamento, seletor de idioma. ✅ **CONCLUÍDA EM PRODUÇÃO**: cutover 05C-2 executado em 16/09/2026 (merge `935f9dc`; `0018` no ledger uma única vez; `entity='farm'` = 0 e `entity='empresa'` = 1, `last_value` preservado), e encerramento documental feito — runbook, `DEPLOYMENT.md` e roteiro de aposentadoria registram a execução | 02, 03 |
| 6 | **BASE2-01** — Moldura de lançamento | Shell oficial do Modelo Base 2 (cabeçalho, dados principais × itens, totais, histórico, **anexos**, ações). Contrato em `MODELO-BASE2-CONTRACT.md`; implementação em `apps/web/src/features/base2/`; piloto no detalhe de documento de estoque. 🟡 **implementação em PR — não implantada.** ANEXOS: entregues com suporte inicial real — `Base2Shell` integra o `AttachmentsDialog` oficial e `input_entries` foi habilitada em `ATTACHMENT_PARENTS`, com a matriz de autorização provada em integração. As outras seis entidades entram uma a uma, conforme o backend as aceite | 05 |
| 7 | **BASE2-02** — TOP | Registry e contrato inicial de Tipo de Operação; nenhuma regra de negócio fundida. ⛔ **CONGELADA**: só começa com a BASE2-01 mesclada e em produção. | 06 |
| 8 | **BASE2-03+** — Migração dos módulos | Compras, Estoque, Financeiro, Vendas e demais migrados progressivamente para o Base 2. | 07 |
| 9 | **DATA-GOV** — Governança de dados | Nomenclatura final, dicionário com cobertura certificada, rótulos de enum por i18n. | 03, 08 |

## Fronteiras que não podem ser cruzadas

| Missão | Não faz |
| --- | --- |
| PRE-BASE2-02 | Não renomeia colunas (isso é 03). |
| PRE-BASE2-03 | Não muda interface além do necessário para acompanhar a renomeação. Não remove coluna legada, view legada nem cabeçalho legado (isso é 05). Não renomeia VALOR de domínio nem chave de permissão (DATA-GOV). |
| PRE-BASE2-04 | Não acopla ID Global à URL: a rota deriva do registro. |
| PRE-BASE2-05 | Não implementa a moldura do Base 2. |
| BASE2-01 | Não cria motor genérico de regras (tela unificada ≠ regra unificada). |
| BASE2-02 | Não implementa todas as TOPs de uma vez. |
| DATA-GOV | Não faz renomeação sem camada de compatibilidade. |

## Critérios de conclusão

**PRE-BASE2-03** ✅ terminou com: o inventário classificado em três baldes (legado histórico · compatibilidade
declarada · dívida de produto) e a catraca travando o terceiro; `X-Farm-Id` e `X-Empresa-Id` coexistindo com
teste dos dois sentidos de version skew; RLS empresarial nas 49 tabelas de escopo, com matriz em
`docs/COMPANY-RLS-MATRIX.md` sem nenhuma tabela "não auditada"; e a compatibilidade com prazo e endereço
(`scripts/lib/empresa-compat-surface.mjs`), removida em PRE-BASE2-05.

**PRE-BASE2-04** 🟡 **implementação pronta; ativação em produção PENDENTE.** O que está provado é o código:
banco novo, banco de upgrade com acervo legado real, reexecução sem renumerar e medição de desempenho — tudo
em ambiente de teste. Isso NÃO é o acervo de produção, e a missão só se considera concluída depois do
checkpoint operacional (nesta ordem): **merge** → **migration 0016 aplicada** → **API nova implantada** →
**backfill oficial executado até `faltando = 0`** → **`pnpm id-global:verify` verde** → **smoke de busca
(`#N`, `ID N`) e do distintivo no registro**. Enquanto isso não acontecer, nenhum documento deve afirmar que
o ID Global está ativo em produção. Runbook em `docs/DEPLOYMENT.md`.

A implementação entregou: todo registro elegível recebendo ID Global na MESMA transação de negócio,
nas 29 portas de escrita direta mais a porta genérica do Resource Registry (gate estrutural
`scripts/id-global-audit.mjs` + matriz de runtime que cria um registro de cada tipo pela rota real, ANTES de
qualquer backfill); backfill operacional em lotes (`pnpm id-global:backfill`), determinístico, retomável e
comprovadamente reexecutável sem renumerar (mapa idêntico, medido); zero duplicidade e zero elegível sem
número (`pnpm id-global:verify`); e `#N` resolvendo por organização, empresa ATUAL do registro e permissão
DAQUELE registro, com toda negativa na mesma superfície 404. Fica registrada uma divergência de contrato: a
variante `locate` de `animal_handlings` está declarada e não tem porta de criação
(ver docs/GLOBAL-ID-CONTRACT.md §13), e um defeito pré-existente do seed (equipments com códigos fixos sem
avançar `erp.code_sequences`) permanece no backlog, fora do escopo desta missão.

**DATA-GOV** só termina quando: o dicionário cobrir 100% das tabelas de negócio; nenhum identificador herdado
permanecer sem decisão registrada; e os rótulos de enum vierem do catálogo de idioma.

## Escala que o desenho precisa suportar

Dezenas a centenas de empresas por organização · usuários com subconjunto de empresas · painéis consolidados ·
milhões de ID Globais · criação concorrente · múltiplos idiomas · novos módulos · outros nichos · API móvel
ou offline usando exatamente as mesmas regras de escopo.

Por isso: escopo resolvido em SQL (nunca lista de identificadores em memória), sequência atômica no banco
(nunca `MAX(id)+1`), permissão verificada no servidor (nunca só no cliente), texto em catálogo (nunca
literal em componente novo).
