# Roteiro até o Modelo Base 2

> Ordem e fronteiras das próximas missões. Cada linha é **uma PR**. A separação de responsabilidades é o que
> torna cada passo reversível: missão que mistura contrato, migração e interface não tem como voltar atrás.

## Sequência

| # | Missão | Entrega | Depende de |
| --- | --- | --- | --- |
| 1 | **PRE-BASE2-01** — Fundação | Contratos (empresa, ID Global, i18n), dicionário de dados, inventário de "fazenda", auditores e gates. ✅ concluída | — |
| 2 | **PRE-BASE2-02** — Empresa e permissões | Modelo de permissão por empresa (granularidade por módulo), camada de compatibilidade sobre o mecanismo de fazenda atual, `member_empresas` gravando a autorização já no formato explícito do contrato (`todas` × `selecionadas`), aposentando a ponte de compatibilidade. | 01 |
| 3 | **PRE-BASE2-03** — Migração fazenda → empresa | Colunas, cabeçalhos, rotas e RLS migrados com compatibilidade nos dois sentidos; catraca do inventário cai de verdade. | 02 |
| 4 | **PRE-BASE2-04** — ID Global | Alocação nas rotas de escrita, backfill determinístico, resolução na busca global (`#55`), exibição no registro. | 01 (03 recomendada) |
| 5 | **PRE-BASE2-05** — Contexto multiempresa | Seletor "todas / uma / conjunto", filtros e painéis consolidados, seleção obrigatória no lançamento, seletor de idioma. | 02, 03 |
| 6 | **BASE2-01** — Moldura de lançamento | Shell oficial do Modelo Base 2 (cabeçalho, dados principais × itens, totais, histórico, anexos, ações). | 05 |
| 7 | **BASE2-02** — TOP | Registry e contrato inicial de Tipo de Operação; nenhuma regra de negócio fundida. | 06 |
| 8 | **BASE2-03+** — Migração dos módulos | Compras, Estoque, Financeiro, Vendas e demais migrados progressivamente para o Base 2. | 07 |
| 9 | **DATA-GOV** — Governança de dados | Nomenclatura final, dicionário com cobertura certificada, rótulos de enum por i18n. | 03, 08 |

## Fronteiras que não podem ser cruzadas

| Missão | Não faz |
| --- | --- |
| PRE-BASE2-02 | Não renomeia colunas (isso é 03). |
| PRE-BASE2-03 | Não muda interface além do necessário para acompanhar a renomeação. |
| PRE-BASE2-04 | Não acopla ID Global à URL: a rota deriva do registro. |
| PRE-BASE2-05 | Não implementa a moldura do Base 2. |
| BASE2-01 | Não cria motor genérico de regras (tela unificada ≠ regra unificada). |
| BASE2-02 | Não implementa todas as TOPs de uma vez. |
| DATA-GOV | Não faz renomeação sem camada de compatibilidade. |

## Critérios de conclusão

**PRE-BASE2-03** só termina quando: a catraca do inventário registrar queda real nas superfícies de produto;
`X-Farm-Id` e `X-Empresa-Id` coexistirem com teste dos dois; e a matriz cross-empresa continuar verde.

**PRE-BASE2-04** só termina quando: todo registro elegível tiver ID Global; não houver duplicidade; o backfill
for comprovadamente reexecutável sem renumerar; e `#N` resolver respeitando organização, empresa e permissão.

**DATA-GOV** só termina quando: o dicionário cobrir 100% das tabelas de negócio; nenhum identificador herdado
permanecer sem decisão registrada; e os rótulos de enum vierem do catálogo de idioma.

## Escala que o desenho precisa suportar

Dezenas a centenas de empresas por organização · usuários com subconjunto de empresas · painéis consolidados ·
milhões de ID Globais · criação concorrente · múltiplos idiomas · novos módulos · outros nichos · API móvel
ou offline usando exatamente as mesmas regras de escopo.

Por isso: escopo resolvido em SQL (nunca lista de identificadores em memória), sequência atômica no banco
(nunca `MAX(id)+1`), permissão verificada no servidor (nunca só no cliente), texto em catálogo (nunca
literal em componente novo).
