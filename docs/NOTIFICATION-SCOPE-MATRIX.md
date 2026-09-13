# Matriz de escopo das notificações

<!-- GERADO por scripts/notification-matrix.mjs — não edite à mão. Gate: `node scripts/notification-matrix.mjs --check`. -->

A caixa de notificações é uma **porta dinâmica**: a autorização de cada linha não vem da caixa, vem da
FONTE funcional daquela linha. Um aviso só chega a quem tem a CAPACIDADE da fonte **e** o ESCOPO dela —
interseção, nunca união. O link dar 404 depois não corrige nada: o título já teria informado.

As duas fontes desta matriz decidem de verdade: o registry `packages/domain/src/notificacoes.ts`
(o que o runtime cria) e `erp.tipos_notificacao` (o que o banco aceita gravar, por chave estrangeira).

## Os três escopos

| Escopo | Significado | Quem enxerga |
| --- | --- | --- |
| `organizacao` | não depende de empresa nenhuma | qualquer membro da organização COM a capacidade |
| `empresa` | pertence a UMA empresa concreta | quem tem a capacidade E acesso àquela empresa NAQUELE módulo |
| `modulo_todas` | agregado real da organização dentro de um módulo | só proprietário ou quem tem modo `todas` naquele módulo (nunca `selecionadas`) |

`selecionadas` cobrindo todas as empresas de hoje **não** é `todas`: a empresa criada amanhã entraria no
agregado sem entrar na autorização de quem o recebe.

## Tipo por tipo

| Tipo | Rótulo | Escopo | Módulo | Capacidade | De onde sai a empresa |
| --- | --- | --- | --- | --- | --- |
| `purchase_pending` | Solicitação de compra pendente | `empresa` | `compras` | `purchase_requests.view` | erp.purchase_requests — a empresa é a da própria solicitação (farm_id). |
| `processing_pending` | Processamento de animais pendente | `empresa` | `pecuaria` | `processings.view` | erp.processings — a empresa é a do processamento (farm_id). |
| `batch_transfer` | Transferência de lote a processar | `empresa` | `pecuaria` | `batches.view` | erp.animal_movements (transferência entre empresas) — a empresa é o DESTINO, que é quem precisa processar. |
| `document_expiring` | Documento vencendo | `empresa` — sem empresa vira `organizacao` | `documentos` | `documents.view` | erp.documents — empresa do documento; documento sem empresa vira notificação de organização. |
| `birthday` | Aniversário de colaborador | `organizacao` | — | `employees.view` | erp.employee_profiles + erp.people — cadastro da organização, sem dimensão de empresa. |
| `stock_min` | Estoque mínimo atingido | `modulo_todas` | `estoque` | `stocks.view` | erp.products.min_stock (organização) × soma de erp.stock_balances (todos os armazéns). |
| `title_due` | Títulos a pagar vencendo | `empresa` | `financeiro` | `payables.view` | erp.financial_titles com direction='payable' vencendo em até 3 dias, contados por empresa. |

## O que o banco aceita gravar

Combinação fora desta tabela é recusada por `notifications_tipo_fk`. É o que impede um aviso de compra
nascer como aviso de organização e alcançar quem não enxerga a empresa de origem — por rota, por
migration futura ou por `psql`.

| Tipo | Escopo | Módulo | Capacidade | Por quê |
| --- | --- | --- | --- | --- |
| `purchase_pending` | `empresa` | `compras` | `purchase_requests.view` | empresa da própria solicitação |
| `processing_pending` | `empresa` | `pecuaria` | `processings.view` | empresa do processamento |
| `batch_transfer` | `empresa` | `pecuaria` | `batches.view` | empresa de DESTINO, que é quem processa |
| `document_expiring` | `empresa` | `documentos` | `documents.view` | empresa do documento |
| `birthday` | `organizacao` | — | `employees.view` | cadastro de pessoas, sem dimensão de empresa |
| `stock_min` | `modulo_todas` | `estoque` | `stocks.view` | mínimo é da organização e o saldo soma todos os armazéns |
| `title_due` | `empresa` | `financeiro` | `payables.view` | contagem de contas a PAGAR da empresa do título |
| `document_expiring` | `organizacao` | — | `documents.view` | documento sem empresa pertence à organização |
| `purchase_pending` | `modulo_todas` | `compras` | `purchase_requests.view` | legado sem empresa recuperável |
| `processing_pending` | `modulo_todas` | `pecuaria` | `processings.view` | legado sem empresa recuperável |
| `batch_transfer` | `modulo_todas` | `pecuaria` | `batches.view` | legado sem empresa recuperável |
| `document_expiring` | `modulo_todas` | `documentos` | `documents.view` | legado sem empresa recuperável |
| `title_due` | `modulo_todas` | `financeiro` | `payables.view` | legado: agregado da organização, sem empresa recuperável |

## Prova

Cada tipo tem um teste que o exercita de ponta a ponta. Tipo sem prova derruba este gate — a matriz não
admite linha “não auditada”.

| Tipo | Teste |
| --- | --- |
| `purchase_pending` | notificacao-escopo: “não vaza notificação da Empresa A”; notificacao-geracao: refresh |
| `processing_pending` | notificacao-geracao: “dois processamentos na mesma empresa … geram DOIS avisos” |
| `batch_transfer` | notificacao-geracao: “duas transferências … geram DOIS avisos” + destino de outra organização |
| `document_expiring` | notificacao-geracao: “documento sem empresa … da organização; com empresa, da empresa” |
| `birthday` | notificacao-geracao: “aniversário é da organização e cada aniversariante tem o seu aviso” |
| `stock_min` | notificacao-geracao: “estoque mínimo continua sendo agregado da organização” |
| `title_due` | notificacao-geracao: “títulos a pagar são contados POR EMPRESA” |

Além da matriz por tipo, `apps/api/test/integration/notificacao-escopo.test.ts` prova a LEITURA:
nada da Empresa A aparece para quem só enxerga a B (lista, contador ou alvo de “marcar como lida”),
o recibo de leitura é por usuário, e marcar uma notificação invisível responde 404, não 403.

## Leitura e janela

A caixa devolve as **50 mais recentes entre as que o usuário pode ver** — a autorização entra no `where`,
antes do `limit`; o contrário devolveria “as 50 mais recentes da organização, menos as proibidas”.
O contador de não lidas usa exatamente a mesma regra de visibilidade (`visibilidadeNotificacaoSql`) e
conta sem o limite da janela, então em caixas com mais de 50 avisos visíveis ele é maior que a lista.
É diferença de JANELA, não de autoridade: nada contado está fora do que o usuário pode ver. O número
sai de UMA função (`contarNaoLidas`), servida tanto por `GET /admin/notifications` (campo `unread`)
quanto por `GET /auth/context` (`unreadNotifications`) — duas redações da mesma regra divergiriam na
primeira edição de só uma delas. O badge lê o campo da CAIXA, que é pollada; ler o contexto, que não
é, deixava o badge congelado enquanto a caixa já mostrava o número novo.

A contagem tem um TETO de custo (500, não a janela de 50): ela avalia `erp.tem_acesso_empresa` linha a
linha e roda a cada 60 s por aba aberta — medido com `EXPLAIN ANALYZE` sobre 200 mil avisos, ~7,6 s
exata contra ~130 ms com teto. Acima dele a resposta marca `unreadTruncado` e o badge mostra "500+".

Plano de execução conferido com `EXPLAIN` sobre 200 mil avisos em 40 organizações: a caixa sai por
`notifications_caixa_idx` (índice, sem passo de ordenação), a contagem por empresa por
`notifications_empresa_idx` (index-only) e a deduplicação do dia por `notifications_dedupe_idx`. Toda a
autorização aparece como filtro **abaixo** do `Limit` — nenhum dos três índices é decorativo, e nenhum
outro se justificou pelo plano.

A leitura é do usuário (`erp.notificacao_leituras`), não do aviso: `erp.notifications.read_at` é legado.
A política de RLS amarra o recibo ao usuário da sessão — nem pelo papel da aplicação se grava leitura
em nome de outro.
