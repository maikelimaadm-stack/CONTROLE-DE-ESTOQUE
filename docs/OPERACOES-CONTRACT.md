# Contrato do Modelo de Operações

> Contrato de produto da fatia OPERACOES-01 (decisões 278 a 288). É a fonte do modelo inteiro de operações: tipos de
> movimento, seções da TOP por tipo, formato 5, centrais e modos de produto, compras com orçamento, entrada por XML,
> Central Financeira, financeiro pela TOP, LCDPR e o mapa "tela antiga → central nova".
> Camadas relacionadas: `docs/TIPO-OPERACAO-CONTRACT.md` (§18, formato 5), `docs/PORTAIS-OPERACIONAIS-CONTRACT.md`
> (as centrais), `docs/MULTI-COMPANY-CONTRACT.md` (escopo), `docs/AUTHORIZATION.md` (capacidade).
>
> EM CONSTRUÇÃO: cada fase da OPERACOES-01 preenche a sua seção. Seção sem o selo "IMPLEMENTADO" é destino declarado,
> não comportamento do produto.

## 1. Tipos de movimento por grupo

### O catálogo do passo 1 (decisão 281) · IMPLEMENTADO

A TOP nasce pelo TIPO DE MOVIMENTO: o passo 1 do assistente do editor oferece os tipos AGRUPADOS, e só os que têm tela.
A fonte única é `CATALOGO_TIPOS_MOVIMENTO_TOP` (`packages/domain/src/tipo-operacao-catalogo.ts:138-161`). O servidor o
publica em `GET /api/admin/tipos-operacao/capabilities` › `formato5.catalogo`, e a tela o lê com o leitor estrito
(`lerCatalogoTop`). Nenhuma lista de tipo, grupo ou família mora no web.

| # | Grupo | Tipo (rótulo) | chave | família no registry | tem tela | quem liga |
|---|---|---|---|---|---|---|
| 1 | Vendas | Orçamento | `orcamento_venda` | `vendas.orcamento` | sim | — |
| 2 | Vendas | Pedido | `pedido_venda` | `vendas.pedido` | sim | — |
| 3 | Vendas | Venda | `venda` | `vendas.venda` | sim | — |
| 4 | Compras | Pedido | `pedido_compra` | `compras.pedido` | sim | — |
| 5 | Compras | Orçamento | `orcamento_compra` | — (a criar) | não | F6 (283) |
| 6 | Compras | Compra | `compra` | `compras.compra` | sim | — |
| 7 | Movimentação interna | Requisição | `requisicao` | — (a espécie NOVA, não a `estoque.requisicao` antiga) | não | F5 (282) |
| 8 | Movimentação interna | Consumo | `consumo` | — (a criar) | não | F5 (282) |
| 9 | Movimentação interna | Devolução de consumo | `devolucao_consumo` | — (a criar) | não | F5 (282) |
| 10 | Movimentação interna | Entrada | `entrada` | `estoque.entrada` | sim | — |
| 11 | Movimentação interna | Saída/baixa | `saida` | `estoque.saida` | sim | — |
| 12 | Movimentação interna | Transferência | `transferencia` | `estoque.transferencia` | sim | — |
| 13 | Movimentação interna | Ajuste | `ajuste` | `estoque.ajuste` | sim | — |
| 14 | Módulos | Abastecimento | `abastecimento` | `frota_ativos.abastecimento` | não | F10 (287) |
| 15 | Módulos | Manutenção | `manutencao` | `frota_ativos.manutencao` | não | F10 (287) |
| 16 | Módulos | Ordem de serviço | `ordem_servico` | `ordens_servico.ordem_de_servico` | não | F10 (287) |
| 17 | Módulos | Manejo | `manejo` | — (a criar) | não | F10 (287) |
| 18 | Módulos | Batelada | `batelada` | — (a criar) | não | F10 (287) |
| 19 | Módulos | Produção de ração | `producao_racao` | `estoque.producao_de_racao` | não | F10 (287) |
| 20 | Financeiro | Conta a pagar | `conta_pagar` | `financeiro.conta_a_pagar` | não | F9 (286) |
| 21 | Financeiro | Conta a receber | `conta_receber` | `financeiro.conta_a_receber` | não | F9 (286) |
| 22 | Financeiro | Movimento bancário | `movimento_bancario` | — (a criar) | não | F9 (286) |

Regras:
- A família de cada tipo é PERGUNTADA ao registry (pela tabela e pela variante), nunca escrita no catálogo. Registry
  sem a variante = tipo sem família.
- "Tem tela" só vale com família (fail-closed).
- "Tem tela" = a tela que lança o documento cita a TOP. Hoje, só os 9 cujo documento cita a TOP.
- **Ligar um tipo** é trabalho da fase que cria a tela: ela troca a linha do catálogo — `temTela`, e a família quando ela
  nascer no registry — e atualiza os testes que fixam o estado de hoje (`top-formato5-catalogo.test.ts` CT-1/CT-2,
  `top-formato5-top.test.ts` T5-1, `tipos-operacao.spec.ts`, `top-assistente.spec.ts`).
- Grupo sem tipo com tela some do passo 1 (hoje: Módulos e Financeiro).
- As 8 famílias do registry que ficam FORA dos tipos (`estoque.entrada_manual`, `estoque.documento_fiscal`,
  `estoque.requisicao`, `estoque.baixa`, `estoque.devolucao`, `estoque.transferencia_entre_armazens`,
  `estoque.transferencia_entre_empresas`, `compras.solicitacao`) são das telas antigas: têm perfil e continuam
  editáveis, mas a tela não cria TOP delas. Nem das famílias de Módulos e Financeiro, enquanto não tiverem tela.
- A API continua aceitando a criação de TOP de qualquer família do registry (`POST` inalterado; `/familias` devolve o
  registry inteiro). O assistente só não as oferece.

## 2. Seções da TOP por tipo e o formato 5

### O formato 5 e o perfil de cada tipo (decisão 281) · IMPLEMENTADO

**O formato 5** é o formato 4 + as SEÇÕES DE EXTENSÃO das fases F5 a F10, cada uma uma chave de raiz nova da
configuração da TOP. Na F4 a lista de seções nasce VAZIA. O contrato técnico — o leitor, a leitura dos formatos 1 a 4
como 5, o ponto de extensão, as recusas, a capacidade e o skew — está em `docs/TIPO-OPERACAO-CONTRACT.md` §18.
- Toda TOP gravada nos formatos 1 a 4 é LIDA como 5, com os padrões de hoje. Nada é gravado até alguém salvar.
- Salvar com mudança grava o 5, e o formato não volta atrás.
- **As regras que travam nascem desligadas:** o neutro de toda seção nova é o comportamento de hoje, e quem liga uma
  regra é o Maike, TOP por TOP (decisão 281, item (4) da 240).

**O perfil de cada família** (`perfilDoTipoTop`, `PERFIS_TIPO_TOP`; `packages/domain/src/tipo-operacao-catalogo.ts:199-240`)
diz o que o editor do 5 mostra e o que o servidor aceita no 5. Ele é DERIVADO, nunca escrito:
- **abas:**
  - Identificação, Geral e Estoque sempre;
  - Próximas operações se há destino possível;
  - as seções de extensão que a família usa, depois de Estoque;
  - Financeiro e Fiscal fora do documento de estoque;
  - Aprovação se a matriz aceita mais que "Sem aprovação";
  - Execução se há execução configurada;
- **exigências da Geral:** as do documento do tipo, com o rótulo dele; família sem documento → as quatro, com o rótulo
  genérico;
- **seções que ficam no padrão:** no documento de estoque, Estoque, Financeiro e Fiscal; e toda seção de extensão que a
  família não usa.

| famílias | abas no editor do 5 | exigências da Geral | seções no padrão |
|---|---|---|---|
| `vendas.venda` | Identificação, Geral, Próximas operações, Estoque, Financeiro, Fiscal, Aprovação, Execução | Exigir cliente, centro de resultado, observação, transportadora | — |
| `vendas.orcamento`, `vendas.pedido` | Identificação, Geral, Próximas operações, Estoque, Financeiro, Fiscal | idem venda | — |
| `compras.pedido` | Identificação, Geral, Próximas operações, Estoque, Financeiro, Fiscal | Exigir fornecedor, centro de resultado, observação, transportadora | — |
| `compras.compra` | Identificação, Geral, Estoque, Financeiro, Fiscal, Aprovação, Execução | idem pedido de compra | — |
| `estoque.entrada`, `.saida`, `.transferencia`, `.ajuste` | Identificação, Geral, Estoque, Aprovação | Exigir observação | Estoque, Financeiro, Fiscal |
| as 14 sem documento que cite a TOP (as 8 antigas, Módulos e Financeiro) | Identificação, Geral, Estoque, Financeiro, Fiscal | Exigir parceiro, centro de resultado, observação, transportadora | — |

Some do editor do 5 só a aba cujo valor o servidor já obriga ao padrão: Próximas operações sem destino possível,
Aprovação só "Sem aprovação", Execução sem execução configurada — e Financeiro e Fiscal no documento de estoque
(decisão 274).

**No formato 5, o servidor recusa (422) o que o tipo não aceita** (os formatos 1 a 4 continuam conferidos como antes):

| o quê | código | caminho | mensagem |
|---|---|---|---|
| exigência que o documento do tipo não tem | `TIPO_OPERACAO_CONFIGURACAO_INVALIDA` (`combinacao_nao_suportada`) | `geral.<chave>` | O documento desta operação não tem este campo. |
| seção que o tipo não usa, fora do padrão | idem | `estoque`, `financeiro`, `fiscal` ou o nome da seção | Esta operação não usa a seção <Seção>. |
| condição de pagamento num tipo sem Financeiro (a lista enviada, ou a preservada quando o PUT traz a configuração sem a lista) | `TIPO_OPERACAO_CONDICOES_INVALIDAS` | `condicoesPermitidas` | Esta operação não usa condições de pagamento. |

O editor do 5 nunca chega a essas recusas: antes de gravar ele volta ao padrão o que o tipo não aceita e lista no
diálogo "Estas regras passam a valer" ("Exigir parceiro: Sim → Não", "Financeiro: volta ao padrão", "Condições de
pagamento: voltam ao padrão").

### As seções das fases seguintes · DESTINO DECLARADO (não implementado)

Cada fase acrescenta a SUA seção pelo ponto de extensão (`docs/TIPO-OPERACAO-CONTRACT.md` §18.3) e escreve aqui uma
subseção com o selo IMPLEMENTADO: nome da chave, rótulo, campos, neutro, famílias que a usam e as recusas próprias. Os
nomes são fixados pelo coordenador. A sugestão do plano da F4, não normativa:

| fase | seção sugerida | o que decide | neutro (o padrão de hoje) |
|---|---|---|---|
| F5 (282) | `destino` | cada dimensão de destino obrigatória, opcional ou não usada | não usada |
| F5 (282) | `fluxo` | exigir requisição (não, algum item, todos) e permitir parcial | não |
| F5 (282) | `entrada` | entrada sem nota e saldo inicial | como hoje |
| F6 (283) | `finalizacao` | o pedido de compra exige finalizar com aprovação | não |
| F6 (283) | `divergencia` | divergência com o pedido: nenhuma, avisa ou bloqueia, com tolerâncias em % (decimal em string) | nenhuma |
| F9 (286) | `financeiroPadrao` | natureza, centro, tipo de título, forma e conta padrão — em TABELA da versão, nunca UUID no JSON | sem padrão |

## 3. Centrais e modos de produto

A preencher pelas F2, F3, F5 e F10 (decisões 279, 280, 282 e 287).

### F3a — o nome "Local de estoque", a pesquisa do seletor e a importação com o nome antigo (decisão 280) · IMPLEMENTADO

> Parte F3a da decisão 280. Sem migration, rota, permissão ou capacidade nova. A F3b (o local antes do produto e a
> pesquisa de produto com o saldo do local) acrescenta a sua subseção.

**O nome.** Todo texto que o usuário lê diz "Local de estoque" / "Locais de estoque" (sentence case, também nas
permissões): "Entre locais de estoque", "Transferência entre locais de estoque", "Local de estoque padrão", "Local de
estoque de origem" / "de destino", "Local de estoque / tanque", "produto × local de estoque × lote". "Transferência de
estoque entre empresas" é o título da transferência entre empresas. Texto NOVO de qualquer fase segue a mesma regra.
Os identificadores NÃO mudam e não são texto: tabela `erp.warehouses`, colunas `warehouse_id`/`armazem_id`/
`armazem_destino_id`, recurso e permissões `warehouses`/`warehouse_transfers`, rota `/cadastros/armazens`, testids
`*-armazem*`, chaves de enum, código `estoque.transferencia_entre_armazens` e a chave i18n dele, chaves de contrato
(`exigeArmazem`, `armazemPorItem`, `armazemForcado`, `estoqueDoArmazem`, `itensSemArmazem`, `armazemPadrao`), parâmetro
`armazem_id`, códigos de erro e o código de dicionário `ERP-CADASTROS-ARMAZEM`. Mensagem de erro muda só no `message`.
Pendente, declarado: as mensagens das funções do banco (0003, 0029, 0036, 0040) até uma migration de estoque.

**`GET /api/resources/:key/options`** (o seletor de cadastro; o `RefSelect`):
- Permissão: a de antes — sem permissão própria, com o escopo do cadastro apontado (`<recurso>.view` resolvido) e as
  leituras declaradas da tabela. Sem sessão: 401 antes de qualquer conferência da consulta.
- Query, todos opcionais: `search`; `page` (inteiro, só dígitos, 1 a 10.000; padrão 1); `pageSize` (inteiro, só dígitos,
  1 a 200; padrão 200 — a página de antes); `include_inactive` e os filtros `campo=valor`, como antes. `page`/`pageSize`
  nunca viram filtro de coluna.
- Recusa: valor malformado, fora da faixa ou parâmetro repetido (inclusive `search` repetido, em TODO seletor) → 422
  `VALIDATION_ERROR` ("page: Formato inválido", "pageSize: Valor máximo: 200", "search: Informe o parâmetro uma vez
  só."), conferido depois da autenticação; nada é consultado.
- Resposta: o ARRAY de antes, `[{ id, label, code, caminho?, kind? }]` (`caminho`/`kind` só em árvore), no máximo
  `pageSize` itens; sem `total`, sem chave nova.
- Ordem: (rótulo, id); em árvore, (código, rótulo, id). Página estável pelo desempate do id.
- Busca: o ramo do rótulo é o de antes para todo cadastro (rótulo contém `search`; em árvore, também o código começa por
  `search`). O cadastro que declara `ResourceDef.pesquisaDoSeletor` (domínio; hoje só Parceiros:
  `{ texto: ["legal_name"], documento: "document" }`), fora de árvore e com rótulo próprio, acha também:
  - pelas colunas `texto`, por "contém", sem diferenciar maiúsculas, com o `%` e o `_` digitados literais;
  - pela coluna `documento` NORMALIZADA (só [0-9A-Z], maiúsculas — a expressão do índice `ux_people_documento_normalizado`;
    o CNPJ alfanumérico mantém as letras), quando `documentoParaPesquisa(search)` reconhece um documento (3 posições
    normalizadas ou mais, com ao menos um dígito).
  - CAPACIDADE: com `<recurso>.view` (em Parceiros, `people.view`), as colunas `texto` e o documento por PREFIXO; sem ela,
    nenhuma coluna `texto` e o documento só por IGUALDADE com o normalizado completo (o que `?document=` já responde).
  - Campo sigiloso que o usuário não vê nunca entra na busca.
- Tenant e escopo: os de antes (organização, `deleted_at`, `is_active`, escopo de empresa); pessoa de outra organização
  nunca aparece. Uma consulta (a árvore soma a dos caminhos). Sem escrita.
- Compatibilidade: a API anterior IGNORA `page`/`pageSize` e devolve a página 1 sem erro. O primeiro web que pedir
  `page` > 1 ("carregar mais") declara antes uma chave de capacidade e só pagina com ela; sem a chave, contra a API
  anterior, ele repetiria os mesmos itens.

**Importação com o nome de antes** (`GET /api/imports/:key/modelo`, `POST /api/imports/:key`, sem mudança de rota):
`FieldDef.rotulosAnteriores` declara, no domínio, os rótulos que o campo já teve (hoje `products.default_warehouse_id`:
`["Armazém padrão"]`). A leitura do cabeçalho reconhece o rótulo atual e cada anterior, normalizados do mesmo jeito (sem o
`*` final, minúsculas); o anterior que colide com um cabeçalho atual, com o anterior de outra coluna ou com "Erros" é
ignorado. O modelo sai só com o rótulo atual; erros e planilha de erros citam o rótulo atual; o nome antigo e o novo no
mesmo arquivo → "Coluna repetida no arquivo." (422, nada gravado); coluna desconhecida continua recusada.

**Motivo da baixa.** `writeoff_reason` tem rótulo para os 13 valores do CHECK de `erp.stock_writeoffs.reason` (0003),
na ordem dele, com `payment_with_product` = "Pagamento com produto"; a fonte é `labels.ts` (formulário, lista, filtro e
CSV). A lista de baixas mostra o rótulo, nunca o valor cru.

**Fora (F3a):** o local antes do produto, o local padrão no cabeçalho e a pesquisa de produto com o saldo do local
(F3b); "carregar mais" e `total` no seletor; CPF/CNPJ ou razão na opção; índice de prefixo ou trigram (precisa de
migration); a pesquisa do seletor de Funcionários.

## 4. Compras: pedido, orçamento e finalização com aprovação

A preencher pela F6 (decisão 283).

## 5. Entrada de nota por XML

A preencher pela F7 (decisão 284).

## 6. Central Financeira

### A Central Financeira (decisão 285) · IMPLEMENTADO

> Migration `0042_central_financeira.sql`. Sem permissão nova. Capacidade em rota própria. Implantação em
> `docs/DEPLOYMENT.md` § OPERACOES-01 › F8. Previsto e TOP financeira: §7 (F9, decisão 286).

**Capacidade e version skew.** `GET /api/financeiro/capacidades` (qualquer membro autenticado) → `{ "centralFinanceira": 1 }`
(`CAPACIDADE_CENTRAL_FINANCEIRA`, `packages/domain/src/financeiro-capacidade.ts`). O web lê com forma e versão EXATAS
(`entendeCentralFinanceira`): 404 de rota (a API anterior), erro de rede, 5xx ou outra forma = ausência → o Financeiro de
hoje, idêntico, e nenhum outro pedido a `/api/financeiro/*`. Nenhuma chave nova em `/auth/context` nem em outro bloco de
capacidades. As permissões são as de hoje: estornar em lote = `{dir}.cancel_settlement`; alterar vencimento =
`{dir}.edit`; exportar = `{dir}.export`; conciliação = `ofx_imports.*`; DRE = `report.dre.view`; fluxo =
`cash_flow.view`; naturezas padrão = `financial_categories.view`/`.edit`; `{dir}` = `payables` ou `receivables`.

**Menu.** Financeiro: Títulos (A receber · A pagar · Todos), Bancos e caixa (Contas · Extrato · Transferências),
Conciliação, Fluxo e resultado (Fluxo de caixa · Resultado (DRE)), Adiantamentos; depois Visão Geral, Planejamento e
Compromissos. As áreas antigas Contas e Caixa e Bancos saem do menu e da busca e continuam pela URL (`?tab=contas`,
`?tab=caixa`): a página só as monta quando a URL as pede. "+ Novo": os três de hoje + "Nova transferência entre contas"
(`/financeiro?tab=bancos&sub=transferencias&nova=1`). Configurações › Financeiro › "Naturezas padrão da baixa". Os
detalhes de hoje (`/financeiro/contas-a-pagar/:id`, `/contas-a-receber/:id`, `/movimentos/:id`, `/ofx/:id`) continuam e
mudam por dentro só com a Central declarada.

**Situação, cartões e origem** (domínio, `packages/domain/src/financeiro-situacao.ts`, rótulos em
`financeiro-rotulos.ts`):
- situação calculada com o `current_date` do banco: `cancelled` → Cancelado; `paid` → Baixado; `partially_paid` → Baixa
  parcial; `open` com vencimento < hoje → Vencido, senão A vencer; `previsto` → Previsto (F9; nenhum título o tem);
  status desconhecido → `VALIDATION_ERROR`;
- cartões: Vencidos, Vencem hoje, A vencer (`open` e `partially_paid` pelo vencimento; valor = Σ saldo), Pagos/Recebidos
  no período (baixa confirmada no período: o de `periodo_campo=baixa`, senão o mês do banco; valor = Σ `amount` das
  baixas), Previstos (`{ quantidade: 0, valor: "0.00", disponivel: false }` até a F9). Os cartões usam o recorte da lista
  SEM o cartão e a situação;
- origem: avulso (`manual` ou nulo), venda, compra, nota, folha, movimento, pecuária, transferência, crédito (o
  título-crédito do excedente), outros. "Título de documento" = origem não nula e diferente de `manual`;
- adiantamento = `payment_type 'advance'` OU tipo de título `is_advance`.

**Semântica B da baixa.** `amount` é o valor baixado do título e JÁ INCLUI o desconto; o título quita Σ `amount` das
baixas confirmadas (`erp.refresh_title_status`); o caixa (`net_amount`) é `amount − desconto + juros + multa +
acréscimo ± ajuste`. Recusas, nesta ordem (`conferirValoresDaBaixa`, `packages/domain/src/financeiro-baixa.ts:59`):
valor ≤ 0 → "Valor baixado deve ser positivo"; algum componente negativo → "Juros, multa, acréscimo, desconto e tarifa não
podem ser negativos"; desconto > valor → "O desconto não pode ser maior que o valor baixado"; excedente com desconto →
"O excedente só vira crédito sem desconto"; valor > saldo sem excedente → `PAYMENT_EXCEEDS_BALANCE` "Valor baixado excede o
saldo do título". "Dar como desconto" é da tela: `amount` = saldo, desconto = saldo − valor + desconto digitado. Na baixa
cruzada, o contrário abate `amount − desconto`.

**Rotas de hoje que mudam** (`apps/api/src/routes/financial.ts`; corpos de hoje aceitos, chaves de hoje devolvidas):

| Rota | O que muda |
|---|---|
| `GET /financial/{payables,receivables}` | adiantamento pelos dois sinais nos filtros `open`, `advance_pending`, `advance_paid` e no `status_label`; `is_tax=true` no WHERE (`:75`), antes da página; `+ eh_adiantamento` por linha; anexos pela entidade `financial_titles` (`:100`) |
| `GET /financial/{dir}/:id` | `+ eh_adiantamento`, `bloqueado_pela_origem`, `origem_grupo`, `conta_prevista_nome`, `credito_disponivel` (só adiantamento), e em cada baixa `componentes: [{ id, componente, valor, natureza_nome, status }]`, `lote_id`, `tarifa` (uma consulta para todas as baixas) |
| `POST /financial/{dir}` | `+ data_competencia`, `conta_prevista_id` opcionais; referências do tenant conferidas (pessoa, proprietário, tipo, safra, filial, conta prevista viva e ativa; safra e área do rateio) → 422 por campo; rateio por VALOR tem de fechar no líquido (422 `APPORTIONMENT_MISMATCH` "O rateio soma R$ … e o título vale R$ …: ajuste R$ … para fechar."); competência em período congelado → `PERIOD_FROZEN` |
| `PUT /financial/{dir}/:id` | presença lida no corpo BRUTO (ausente mantém; nulo limpa só competência e conta prevista); ordem: cancelado → 409; `version` presente e diferente → 409 `CONCURRENCY_CONFLICT`; título de documento com campo travado diferente → 409 "Título gerado por <origem>: valor, parceiro e rateio só mudam pela origem. Altere pela origem." (`campos` nos detalhes); empresa ou forma de pagamento diferentes → 422; valor de título com baixa → 409; valor novo sem rateio → 422; congelamento da emissão atual, da nova e da nova competência; referências; rateio em R$ fechado; ROW COUNT 1 |
| `POST /financial/{dir}/:id/cancel` | `{ reason? }` gravado (`cancel_reason`, `cancelled_at`, `cancelled_by`); título de documento → 409 |
| `POST /financial/{dir}/cancel-batch` | `{ ids (1..1000, sem repetir), reason? }`; `+ itens: [{ id, resultado: "cancelado"\|"pulado", motivo? }]` com os motivos `nao_encontrado`, `ja_cancelado`, `com_baixa`, `origem`, `periodo_congelado`, `situacao`; `cancelled` e `skipped` continuam |
| `POST /financial/{dir}/:id/settle` | `+ tarifa`, `excedente: "credito"`, `adiantamento_id` opcionais; resposta `+ lote_id`, `componentes: [{ componente, valor, bank_movement_id }]`, `tarifa_movimento_id`, `credito: { titulo_id, valor } \| null`; tarifa ou excedente fora da baixa bancária → 422 "Tarifa e excedente valem só na baixa com conta bancária"; uso do crédito: só `advance_compensation` ("Use a compensação de adiantamento para usar crédito"), só o valor ("A compensação com adiantamento usa só o valor"), adiantamento do mesmo parceiro, empresa e direção (senão 404 "Adiantamento não encontrado"), crédito suficiente (senão 409 "Crédito do adiantamento insuficiente") |
| `POST /financial/{dir}/settle-batch` | `ids` (como hoje, 1..1000, sem repetir) OU `itens: [{ id, valor?, desconto?, juros?, multa?, acrescimo? }]` (1..200; os dois → 422), `+ tarifa?`; título não encontrado, fora do escopo (o `await` do `empresaPermitida`) ou não aberto → pulado; "Único" com 2 ou mais empresas → 422 "Movimento único exige títulos da mesma empresa", na empresa dos títulos e com o rateio da união deles; tarifa do lote: natureza configurada, títulos de uma empresa, algum com rateio; resposta `+ lote_id`, `pulados: [{ id, motivo }]`, `tarifa_movimento_id`. Período congelado continua abortando o lote inteiro |
| `POST /financial/{dir}/:id/settlements/:sid/cancel` | corpo igual; o estorno (`estornarBaixa`, `lib/financeiro-estorno.ts:35`) cancela também componentes, crédito gerado (sem uso), o título do "gera obrigação" e a tarifa do lote quando sai a última baixa; recusa (409) movimento conciliado, crédito gerado já usado e adiantamento com crédito usado |
| `GET /financial/{dir}/:id/receipt` | o texto lista os componentes lançados em separado |
| `POST /financial/bank-movements` | "gera obrigação": empresa = a pedida ou a selecionada; nenhuma → 422 "Informe a empresa: o título gerado pelo movimento precisa de empresa"; a baixa automática passa pela `settle`; transferência com destino validado (`financial-core.ts`: "Conta destino inválida", "Conta de origem e destino iguais") |
| `PUT /financial/bank-movements/:id` | confirmado: só observação e documento; qualquer outro campo diferente, ou rateio → 409 "Movimento bancário confirmado não se altera: estorne e lance outro."; o rateio não é apagado |
| `POST /financial/bank-movements/:id/cancel` | `{ reason? }` gravado nas DUAS pontas; conciliado → 409 "Movimento conciliado: desfaça a conciliação antes"; componente de baixa → 409 "Movimento de baixa: estorne a baixa"; ROW COUNT 1 ou 2 |
| `GET /financial/bank-movements/:id` | `+ direction` em cada baixa vinculada; `+ tipo_transferencia`, `cancel_reason` (colunas novas) |
| `POST /financial/ofx-imports` | conta viva e ativa da organização, senão 422 "Conta bancária inválida"; leitura decimal (`lerOfx`); casamento automático só com UM candidato exato; `+ recusadas` |
| `POST /financial/ofx-imports/:id/transactions/:tid/match` | transação já conciliada ou ignorada → 409; movimento da conta da importação, confirmado e livre (ROW COUNT 1, senão 404); valor diferente → 422 "O valor do movimento difere do valor do extrato" |
| `GET /financial/tax-accounts` | recorte de tributo no SQL, antes da página |
| `parseOfx` (export) | `amount` em TEXTO decimal com sinal |

**Rotas novas — títulos** (`apps/api/src/routes/financeiro-titulos.ts`). Porta dinâmica: as direções em que o usuário tem a
ação (nenhuma → 403); o módulo financeiro publicado; a direção sem capacidade entra no WHERE. Id malformado = a MESMA 404 do
inexistente. Escritas com `Idempotency-Key` e trilha com motivo.
- `GET /financeiro/titulos` — query estrita: `direcao` (receivable|payable|todos), `page`, `pageSize` (1..200, padrão
  50), `sort` (vencimento|emissao|valor = líquido|saldo|numero|codigo|parceiro), `dir`, `cartao`, `situacao` (lista;
  padrão = todas menos cancelado), `periodo_campo` (vencimento|emissao|competencia|baixa), `periodo_de`, `periodo_ate`,
  `pessoa_id`, `natureza_id` e `centro_id` (com descendentes), `safra_id`, `area_id`, `conta_id` (prevista ou de baixa),
  `empresa_id`, `tipo_titulo_id`, `origem` (lista de grupos), `tipo_operacao_id` (TOP do documento de origem), `busca`
  (≤ 100), `valor_de`, `valor_ate` (sobre o líquido), `adiantamento` (0|1), `ids` (≤ 200). Resposta `{ items, total,
  page, pageSize, idGlobal?, direcoes, totais: { payable?|receivable?: { valor, pago, saldo } }, cartoes }`; a linha:
  `{ id, direcao, codigo, numero, empresa_id, empresa_nome, pessoa_id, pessoa_nome, emissao, competencia, vencimento,
  parcela: { numero, total }, valor, desconto, liquido, pago, saldo, status, situacao, situacao_rotulo, origem: { tipo,
  id, grupo }, bloqueado_pela_origem, eh_adiantamento, conta_prevista: { id, descricao } | null, tipo_titulo_nome,
  ultima_baixa, anexos, version, observacao }`. Dinheiro em texto, "0.00" sem linhas. Três consultas por página.
- `GET /financeiro/titulos/exportar` — a mesma query + `formato` (csv|xlsx); `{dir}.export`; até 10.000 (mais → 422
  "Filtre mais: a exportação aceita até 10.000 títulos"); colunas Código, Nº do documento, Direção, Empresa, Parceiro,
  Emissão, Competência, Vencimento, Parcela, Valor (líquido), Pago, Saldo, Situação, Origem, Conta prevista, Observação;
  CSV `;` com BOM e apóstrofo em campo que começa com `=`, `+`, `-`, `@`, tabulação ou retorno; XLSX com toda célula em
  texto.
- `POST /financeiro/titulos/alterar-vencimento` — `{ ids (1..200), vencimento?, conta_prevista_id? (nulo limpa), motivo
  (1..500) }`, ao menos um dos dois (senão 422); `{dir}.edit`; conta prevista viva e ativa (422); vale para título de
  documento. Resposta `{ alterados, itens: [{ id, resultado: "alterado"|"pulado", motivo? }] }` (motivos
  `nao_encontrado`, `situacao`, `periodo_congelado`).
- `POST /financeiro/titulos/estornar-baixas` — `{ ids (1..200), motivo }`; `{dir}.cancel_settlement` (e a da direção
  contrária quando há baixa cruzada). Resposta `{ estornados, itens: [{ id, resultado: "estornado"|"pulado", motivo?,
  baixas }] }` (motivos `nao_encontrado`, `sem_baixa`, `movimento_conciliado`, `credito_usado`, `periodo_congelado`,
  `movimento_compartilhado`). O movimento único só sai com TODOS os títulos dele.
- `GET /financeiro/lotes-baixa/:loteId` — `{dir}.view` da direção do lote; baixa de título invisível = 404 do lote
  inteiro. Resposta `{ lote_id, direcao, data, conta, situacao: "confirmado"|"estornado"|"parcial", total, baixas,
  movimentos }`.
- `POST /financeiro/lotes-baixa/:loteId/estorno` — `{ motivo }`; `{dir}.cancel_settlement`; todo o lote (baixas,
  movimento único, componentes, tarifa); já estornado → 409 `ALREADY_CANCELLED` "Lote já estornado". Resposta `{ lote_id,
  baixas_estornadas, movimentos_estornados }`.
- `GET /financeiro/lotes-baixa/:loteId/recibo` — `{dir}.receipt`; `{ lote_id, recibo }` (texto).

**Rotas novas — bancos, conciliação, fluxo, resultado, adiantamentos, naturezas** (`apps/api/src/routes/financeiro-bancos.ts`).
Query e corpo estritos; dinheiro só como TEXTO decimal (número → 422).
- `GET /financeiro/contas` — `bank_accounts.view` + `bank_movements.view`; `page`, `pageSize` (50), `ativas` (1 padrão |
  0) → `{ itens: [{ id, codigo, descricao, tipo, banco, agencia, conta, ativa, saldo_inicial, data_saldo_inicial,
  saldo_real, saldo_conciliado, conciliado_ate }], total, page, pageSize, totais: { saldo_real, saldo_conciliado } }`.
  Saldo real = saldo inicial + todos os confirmados; saldo conciliado = saldo inicial + só os conciliados.
- `PUT /financeiro/contas/:id/saldo-inicial` — `bank_accounts.edit` + as duas de leitura; `{ valor (pode ser negativo),
  data }` → a linha da conta; outra organização, inexistente ou malformada → 404.
- `GET /financeiro/extrato` — as duas capacidades; `conta_id`, `de`, `ate` (sem `de`: a data do saldo inicial),
  `situacao` (todos|conciliados|pendentes, recorta as linhas, não o saldo), `page`, `pageSize` (100) → `{ conta, de,
  ate, situacao, saldo_anterior: { real, conciliado }, itens: [{ id, codigo, data, descricao, documento, tipo,
  categoria, tipo_transferencia, valor (com sinal), conciliado, conciliado_em, origem, empresa_id, saldo_real,
  saldo_conciliado, id_global? }], total, page, pageSize, saldo_final }`.
- `POST /financeiro/transferencias` — `bank_movements.create`; `{ tipo: transferencia|deposito|saque|aplicacao|resgate,
  conta_origem_id, conta_destino_id, data, valor (> 0), empresa_id, documento?, observacao? }`; contas vivas, ativas, da
  organização e diferentes; depósito = do caixa para não caixa; saque = de não caixa para o caixa; aplicação = para conta
  de aplicação; resgate = de conta de aplicação; → 201 `{ id, par_id }`, sem rateio, rótulo nas duas pontas.
- `GET /financeiro/conciliacao/importacoes` — `conta_id`, `situacao`, página → `{ itens: [{ id, codigo, descricao,
  conta_id, conta, de, ate, situacao, transacoes, conciliadas, ignoradas, pendentes, criado_em }], total, page,
  pageSize, idGlobal? }`.
- `POST /financeiro/conciliacao/importacoes` — `ofx_imports.create`; `{ conta_id, descricao (1..200), conteudo }`; conta
  viva e ativa (422 "Conta bancária inválida"); ACCTID de outra conta → 422 "O arquivo OFX é de outra conta (conta do
  arquivo: …)."; nenhuma transação válida → 422; tudo já importado → 422; FITID já importado na conta não entra →
  201 `{ id, codigo, transacoes, duplicadas, recusadas: [{ fitid, motivo }], conciliadas_automaticamente }` (só o
  Encontrado).
- `GET /financeiro/conciliacao/importacoes/:id` — `{ importacao, transacoes: [{ id, fitid, data, valor, memo, situacao,
  movimentos, sugestao: { tipo: encontrado|sugestao|soma|nenhuma, grupos } }], total, page, pageSize }` (uma consulta de
  candidatos por página; a regra é a do domínio, `sugerirConciliacao`).
- `GET /financeiro/conciliacao/transacoes/:tid/candidatos` — movimentos da conta, do mesmo sinal, confirmados e livres,
  os mais próximos da data primeiro, com ID Global.
- `POST …/:tid/confirmar` `{ movimento_ids (1..10) }` (soma EXATA, senão 422 "A soma dos movimentos (R$ X) difere do
  valor do extrato (R$ Y)"; já conciliada → 409; movimento fora da conta → 404); `POST …/:tid/criar-lancamento`
  `{ empresa_id, rateio, observacao? }` (+ `bank_movements.create`; movimento com origem `ofx`, já conciliado); `POST
  …/:tid/ignorar` `{ motivo? }`; `POST …/:tid/desfazer` `{ motivo }` (pendente → 409 "Nada a desfazer"; conciliação com
  movimento que o usuário não pode alterar → 409). A importação é recalculada (`reconciled` sem pendentes).
- `GET /financeiro/fluxo` — `cash_flow.view` + `bank_movements.view` (+ `bank_accounts.view` no da organização); `de` e
  `ate` juntos (padrão: o mês do banco), `agrupamento` (dia|semana|mes), `contas`, `empresa_id`, `agrupar_por`
  (nenhum|conta|empresa), `previstos` (1 → 422 "Os previstos chegam com a provisão pela TOP") → `{ agrupamento, de, ate,
  modo: organizacao|empresa, saldo_inicial (nulo por empresa), periodos: [{ inicio, fim, realizado: { entradas, saidas,
  transferencias_liquidas, saldos_iniciais }, previsto: { entradas, saidas }, saldo_realizado, saldo_projetado }],
  previsto_em_atraso, previstos_incluidos: false, direcoes_previstas, grupos? }`.
- `GET /financeiro/resultado` — `report.dre.view`; `de`, `ate`, `regime` (competencia padrão | caixa), `empresa_id` →
  `{ grupos: [{ grupo, total, naturezas }], receitaLiquida, resultadoOperacional, investimentos, resultadoFinal, regime,
  de, ate }`. Competência: títulos não cancelados e que não são adiantamento, por `coalesce(data_competencia, emissão)`,
  + movimentos avulsos (manual/OFX, sem "gera obrigação") + componentes + desconto na natureza gravada. Caixa: movimentos
  de entrada e saída − a parte que liquidou adiantamento + o título liquidado sem caixa (crédito e encontro de contas)
  pela data da baixa.
- `GET /financeiro/adiantamentos` (`direcao`, `pessoa_id`, `empresa_id`, `so_com_saldo`) → `{ itens: [{ direcao,
  pessoa_id, pessoa_nome, empresa_id, empresa_nome, adiantado, usado, saldo, quantidade }], total, page, pageSize,
  direcoes }`; `GET /financeiro/adiantamentos/titulos` → os títulos com crédito, com ID Global.
- `GET`/`PUT /financeiro/configuracoes/naturezas-padrao` — as 9 chaves `{ id, codigo, nome } | null`; PUT parcial
  (ausente fica, nulo limpa); natureza viva, ativa, analítica e do tipo esperado (`both` serve a todas), senão 422 no
  campo "Natureza inválida para <rótulo>".

**Banco (0042).** Colunas novas anuláveis, tabela `erp.financeiro_naturezas_padrao`, `erp.refresh_title_status` com
`sum(amount)`, gatilhos `trg_bm_confirmado_imutavel` e `trg_ts_credito_conferir`, a porta
`erp.extrato_conta_organizacao` e o ledger sem DELETE para o `erp_app` (`docs/DATABASE.md`, `docs/MULTI-COMPANY-CONTRACT.md`
§7, `docs/DATA-DICTIONARY.md`).

**Compatibilidade** (base `622f194`):

| Janela | O que acontece | Prova |
|---|---|---|
| web nova × API anterior | capacidade 404 → o Financeiro de hoje, formulário com rateio por %, diálogo de baixa sem Tarifa, nenhum pedido a `/api/financeiro/*` além da capacidade; o menu novo leva às abas novas, que a tela de hoje não tem (cai na aba padrão) | K-1 |
| web anterior × API nova | corpos e chaves de hoje; as recusas novas (defeitos): título de documento, movimento confirmado, "gera obrigação" sem empresa, conta OFX e destino de transferência inválidos, "Único" com 2+ empresas, id repetido no lote; o lote pula o título fora do escopo; a baixa com desconto quita o `amount` | K-2 + `central-financeira-defeitos` |
| API anterior × banco novo | a baixa com desconto quita só o `amount`; PUT de movimento com rateio → 403; PUT de valor de movimento confirmado → 409 | `operacoes-01-0042` (DB-4) |

**Fora (F8):** a 1ª natureza e o 1º centro "por código" de `sales.ts`, `supply.ts` e `livestock.ts` (F9, decisão 286); a
provisão, a situação "previsto" e a TOP financeira (F9); o saldo do painel financeiro pela view recortada e a lista
antiga de importações OFX sem paginação (F11/F12); recorrência e parcelamento de adiantamento; conciliação automática
da Sugestão e da Soma; CNAB, boleto, PIX, Open Finance, cartões e cheques, renegociação com juros compostos, aprovação
por alçada, contabilização e retenções, LCDPR (fora da PR).

## 7. Financeiro pela TOP e LCDPR

A preencher pela F9 (decisão 286).

## 8. Mapa "tela antiga → central nova"

A preencher pela F11 (decisão 288).
