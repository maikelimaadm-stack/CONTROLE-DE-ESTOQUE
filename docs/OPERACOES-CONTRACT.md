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
| 5 | Compras | Orçamento | `orcamento_compra` | `compras.orcamento` | não | F6b (283) |
| 6 | Compras | Compra | `compra` | `compras.compra` | sim | — |
| 7 | Movimentação interna | Requisição | `requisicao` | `estoque.requisicao_material` (a espécie NOVA; a `estoque.requisicao` antiga continua a de `erp.requisitions`) | não | F5b (282) |
| 8 | Movimentação interna | Consumo | `consumo` | `estoque.consumo` | não | F5b (282) |
| 9 | Movimentação interna | Devolução de consumo | `devolucao_consumo` | `estoque.devolucao_consumo` | não | F5b (282) |
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
- "Tem tela" = a tela que lança o documento cita a TOP. Hoje, só os 9 cujo documento cita a TOP. A F5a (decisão 282)
  criou a família das três da movimentação interna, e a F6a (decisão 283), a do orçamento de compra, e as deixou sem
  tela: o documento já existe na API, e a tela é da F5b e da F6b. Hoje, 19 dos 22 tipos têm família; sem família, só
  Manejo, Batelada e Movimento bancário.
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
configuração da TOP. Na F4 a lista de seções nasceu VAZIA; a F5a (decisão 282) acrescentou `destino` e `fluxo`, e a
F6a (decisão 283), `fluxoCompra` e `divergenciaPedido`, nesta ordem (subseções abaixo). O contrato técnico — o leitor, a leitura dos formatos 1 a 4
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
| `vendas.venda` | Identificação, Geral, Próximas operações, Estoque, Financeiro, Fiscal, Aprovação, Execução | Exigir cliente, centro de resultado, observação, transportadora | Destino, Fluxo, Fluxo de compra, Divergência com o pedido |
| `vendas.orcamento`, `vendas.pedido` | Identificação, Geral, Próximas operações, Estoque, Financeiro, Fiscal | idem venda | Destino, Fluxo, Fluxo de compra, Divergência com o pedido |
| `compras.pedido` | Identificação, Geral, Próximas operações, Estoque, Fluxo de compra, Financeiro, Fiscal, Aprovação | Exigir fornecedor, centro de resultado, observação, transportadora | Destino, Fluxo, Divergência com o pedido |
| `compras.compra` | Identificação, Geral, Estoque, Divergência com o pedido, Financeiro, Fiscal, Aprovação, Execução | idem pedido de compra | Destino, Fluxo, Fluxo de compra |
| `compras.orcamento` (F6a; sem tela até a F6b) | Identificação, Geral, Estoque, Financeiro, Fiscal | Exigir fornecedor, observação | Destino, Fluxo, Fluxo de compra, Divergência com o pedido |
| `estoque.entrada`, `.transferencia`, `.ajuste`, `.devolucao_consumo` | Identificação, Geral, Estoque, Aprovação | Exigir observação | Estoque, Financeiro, Fiscal, Destino, Fluxo, Fluxo de compra, Divergência com o pedido |
| `estoque.saida`, `estoque.requisicao_material` | Identificação, Geral, Estoque, Destino, Aprovação | Exigir observação | Estoque, Financeiro, Fiscal, Fluxo, Fluxo de compra, Divergência com o pedido |
| `estoque.consumo` | Identificação, Geral, Estoque, Destino, Fluxo, Aprovação | Exigir observação | Estoque, Financeiro, Fiscal, Fluxo de compra, Divergência com o pedido |
| as 14 sem documento que cite a TOP (as 8 antigas, Módulos e Financeiro) | Identificação, Geral, Estoque, Financeiro, Fiscal | Exigir parceiro, centro de resultado, observação, transportadora | Destino, Fluxo, Fluxo de compra, Divergência com o pedido |

Some do editor do 5 só a aba cujo valor o servidor já obriga ao padrão: Próximas operações sem destino possível,
Aprovação só "Sem aprovação", Execução sem execução configurada — e Financeiro e Fiscal no documento de estoque
(decisão 274).

**No formato 5, o servidor recusa (422) o que o tipo não aceita** (os formatos 1 a 4 continuam conferidos como antes):

| o quê | código | caminho | mensagem |
|---|---|---|---|
| exigência que o documento do tipo não tem | `TIPO_OPERACAO_CONFIGURACAO_INVALIDA` (`combinacao_nao_suportada`) | `geral.<chave>` | O documento desta operação não tem este campo. |
| seção que o tipo não usa, fora do padrão | idem | `estoque`, `financeiro`, `fiscal` ou o nome da seção (`destino`, `fluxo`, `fluxoCompra`, `divergenciaPedido`) | Esta operação não usa a seção <Seção>. |
| condição de pagamento num tipo sem Financeiro (a lista enviada, ou a preservada quando o PUT traz a configuração sem a lista) | `TIPO_OPERACAO_CONDICOES_INVALIDAS` | `condicoesPermitidas` | Esta operação não usa condições de pagamento. |

O editor do 5 nunca chega a essas recusas: antes de gravar ele volta ao padrão o que o tipo não aceita e lista no
diálogo "Estas regras passam a valer" ("Exigir parceiro: Sim → Não", "Financeiro: volta ao padrão", "Condições de
pagamento: voltam ao padrão").

### Destino e Fluxo — as seções da F5a (decisão 282) · IMPLEMENTADO

Duas seções de extensão do formato 5, declaradas pelo ponto de extensão (`docs/TIPO-OPERACAO-CONTRACT.md` §18.3):
`packages/domain/src/tipo-operacao-secao-destino.ts` e `tipo-operacao-secao-fluxo.ts`, as duas primeiras de
`DEFINICOES_SECOES_V5` (a ordem das abas, depois de Estoque; as da F6a vêm depois delas). **As regras que travam nascem
DESLIGADAS:** no neutro, nada é exigido nem aceito de novo, e quem liga é o Maike, TOP por TOP.

**Destino** (`destino`, aba "Destino"): para onde vai o que sai do estoque.

| chave | rótulo | coluna no documento | alvo | valores | neutro |
|---|---|---|---|---|---|
| `centroCusto` | Centro de resultado | `centro_custo_id` | `erp.cost_centers` (organização; analítico) | `nao_usada` "Não usada" · `opcional` "Opcional" · `obrigatoria` "Obrigatória" | `nao_usada` |
| `equipamento` | Máquina/equipamento | `equipamento_id` | `erp.equipments` (empresa do documento) | idem | `nao_usada` |
| `ordemServico` | Ordem de serviço | `ordem_servico_id` | `erp.service_orders` (empresa; aberta ou em andamento) | idem | `nao_usada` |
| `loteAnimais` | Lote de animais | `lote_animais_id` | `erp.batches` (empresa) | idem | `nao_usada` |
| `area` | Área/talhão | `area_id` | `erp.areas` (empresa) | idem | `nao_usada` |
| `safra` | Safra | `safra_id` | `erp.harvests` (organização) | idem | `nao_usada` |

A lista das dimensões tem UM dono: `CAMPOS_DESTINO_ESTOQUE` (`packages/domain/src/estoque-documento.ts:191`). A seção
Destino, a API e o web leem dali. Usam a seção a requisição, o consumo e a saída (`usadaPor`, perguntado ao registry).
A devolução de consumo leva o destino COPIADO do consumo e não usa a seção.

**Fluxo** (`fluxo`, aba "Fluxo"): só o consumo.

| chave | rótulo | valores | neutro |
|---|---|---|---|
| `exigeRequisicao` | Exigir requisição | `nao` "Não" · `algum_item` "Em algum item" · `todos` "Em todos os itens" | `nao` |
| `permiteParcial` | Atender requisição em parte | `true` "Sim" · `false` "Não" | `true` |

**Na TOP (API da TOP, só no 5).** A seção ausente vale o neutro. A presente é lida estrita:
- valor fora da lista → `valor_invalido` em `destino.<chave>` ou `fluxo.<chave>`;
- chave desconhecida → `campo_desconhecido`;
- tipo errado, ou dimensão que falta numa seção presente → `tipo_invalido`.
Nos formatos 1 a 4, a chave é recusada (`campo_desconhecido` em `destino`/`fluxo`). Fora do neutro numa família que
não a usa → 422 `combinacao_nao_suportada` no caminho da seção: "Esta operação não usa a seção Destino." ou "Esta
operação não usa a seção Fluxo.". O editor do 5 volta a seção ao padrão antes de gravar, e o histórico mostra o bloco
de cada uma (as `linhas`, ex.: "Centro de resultado: Obrigatória", "Exigir requisição: Em todos os itens").

**No lançamento do documento de estoque** (a seção da versão CONGELADA; formatos 1 a 4 → o neutro; versão ilegível →
o neutro, e quem recusa é a confirmação). Cada recusa é 422 `VALIDATION_ERROR`, no campo:

| regra | caminho | mensagem |
|---|---|---|
| dimensão informada que a TOP não usa (o herdado reenviado não conta como informado) | a coluna (`centro_custo_id`…) | Esta operação não usa <dimensão em minúsculas>. (ex.: "Esta operação não usa máquina/equipamento.") |
| dimensão obrigatória sem valor final (informado ou herdado da requisição) | a coluna | Esta operação exige <dimensão em minúsculas>. (ex.: "Esta operação exige centro de resultado.") |
| `exigeRequisicao` "algum_item" ou "todos", consumo sem requisição | `origem_documento_id` | Esta operação exige requisição: informe a requisição de origem. |
| "algum_item", com a requisição e nenhum item ligado | `itens` | Esta operação exige ao menos um item da requisição. |
| "todos", item não ligado | `itens.<i>.origem_item_id` | Esta operação exige que todo item venha da requisição. |
| `permiteParcial` falso, consumo que não leva o saldo inteiro de todos os itens pendentes | `itens` | Esta operação não atende requisição em parte: leve o saldo inteiro de todos os itens pendentes da requisição. |

As duas funções que dão essas recusas moram no domínio (`recusasDoDestinoPelaTop`, `recusasDoFluxoDoConsumo`); a API só
as aplica.

### Fluxo de compra (`fluxoCompra`, decisão 283) · IMPLEMENTADO

| | |
|---|---|
| chave de raiz | `fluxoCompra` |
| rótulo da aba | Fluxo de compra (depois de Estoque) |
| campos | `exigeFinalizar` — booleano; na tela, "Exigir pedido finalizado para receber" (Não / Sim) |
| neutro (o de hoje) | `{ "exigeFinalizar": false }` |
| famílias que a usam | só `compras.pedido` (perguntado ao registry pela espécie); nas outras, fica no padrão |
| quem executa | a API, no receber, lendo a versão congelada DO PEDIDO; o banco aceita receber de aberto e de finalizado |
| recusas próprias | leitura estrita: `tipo_invalido` e `campo_desconhecido` em `fluxoCompra.<campo>`; fora do pedido e fora do padrão → "Esta operação não usa a seção Fluxo de compra." |

Ajuda (texto exato): "Exigir pedido finalizado para receber: com Sim, o pedido só é recebido depois de finalizado (e, se
esta TOP exige aprovação, aprovado). Com Não, o pedido aberto ou finalizado é recebido, como hoje — e o aberto é
recebido sem passar pela aprovação desta TOP, que só vale ao finalizar."

### Divergência com o pedido (`divergenciaPedido`, decisão 283) · IMPLEMENTADO

| | |
|---|---|
| chave de raiz | `divergenciaPedido` |
| rótulo da aba | Divergência com o pedido (depois de Estoque) |
| campos | `modo`: `nenhuma` · `avisa` · `bloqueia` ("Nenhuma", "Avisar", "Bloquear"); `toleranciaPrecoPercentual` e `toleranciaQuantidadePercentual`: TEXTO decimal de "0" a "100", até 2 casas, ponto como separador — nunca número |
| neutro (o de hoje) | `{ "modo": "nenhuma", "toleranciaPrecoPercentual": "0", "toleranciaQuantidadePercentual": "0" }` |
| normalização | com "Nenhuma", as tolerâncias voltam a "0" (não decidem nada); o decimal digitado não é reformatado |
| famílias que a usam | só `compras.compra`; nas outras, fica no padrão |
| quem executa | a API, na prévia e na confirmação da COMPRA gerada de um pedido (§4) |
| recusas próprias | leitura estrita: modo fora da lista, tolerância fora da forma ou acima de 100 → `valor_invalido`; número em vez de texto → `tipo_invalido`; chave a mais → `campo_desconhecido`, em `divergenciaPedido.<campo>`; fora da compra e fora do padrão → "Esta operação não usa a seção Divergência com o pedido." |

Na tela, o aviso de cliente "Informe um percentual de 0 a 100, com até duas casas decimais." (só apresentação), e o
422 do servidor no campo ("Valor inválido: confira o que foi informado neste campo."). Ao trocar o modo, a tela aplica a
normalização do domínio: com "Nenhuma", as tolerâncias voltam a "0", e um valor recusado nunca fica preso num campo
desabilitado. Histórico: "Divergência com o pedido: Bloquear", "Tolerância de preço: 5.5%", "Tolerância de quantidade:
10%".

**Leitura pela execução das duas seções de compras** (`packages/domain/src/compras-finalizacao-orcamento.ts:64-77`), a
ordem das regras gerais: sem versão congelada → neutro; formato desconhecido → ilegível (409
`TIPO_OPERACAO_EXECUCAO_INDISPONIVEL`); formatos 1 a 4 → neutro SEM LER a configuração, mesmo malformada (nunca recusa
nova — regra 4 da decisão 277); 5 malformado → ilegível; 5 → a seção lida e normalizada.

### As seções das fases seguintes · DESTINO DECLARADO (não implementado)

Cada fase acrescenta a SUA seção pelo ponto de extensão (`docs/TIPO-OPERACAO-CONTRACT.md` §18.3) e escreve aqui uma
subseção com o selo IMPLEMENTADO: nome da chave, rótulo, campos, neutro, famílias que a usam e as recusas próprias. Os
nomes são fixados pelo coordenador. A sugestão do plano da F4, não normativa:

| fase | seção sugerida | o que decide | neutro (o padrão de hoje) |
|---|---|---|---|
| F5 (282) | `destino` e `fluxo` | IMPLEMENTADAS — subseção "Destino e Fluxo" acima | — |
| F5 (282) | `entrada` | não implementada na F5a: "sem nota" e "saldo inicial" são TOPs de entrada comuns (movimento `entry`); o saldo inicial com `opening_balance` e a recusa de duplicidade é pergunta ao Maike antes da F11 (decisão 282) | como hoje |
| F6 (283) | `fluxoCompra` e `divergenciaPedido` | IMPLEMENTADAS — subseções acima | — |
| F9 (286) | `financeiroPadrao` | natureza, centro, tipo de título, forma e conta padrão — em TABELA da versão, nunca UUID no JSON | sem padrão |

## 3. Centrais e modos de produto

A preencher pelas F5 e F10 (decisões 282 e 287).

### F2 — as Centrais de Vendas e de Compras usam as regras gerais da TOP (decisão 279) · IMPLEMENTADO

> Sem migration, sem permissão nova, sem capacidade nova. Duas rotas novas de leitura em prefixo próprio e uma chave
> nova, aditiva, em `/regras-da-operacao`. Os corpos de entrada e as respostas do POST, do PUT/PATCH e do `/convert`
> não mudam. A Central de Estoque só troca o dono do aviso do Salvar (a F5 a leva ao resto).

**`regrasGerais` nas regras da operação.** `GET /api/sales/<seg>/regras-da-operacao` (`<seg>` ∈ budgets, orders,
sales) e `GET /api/compras/<seg>/regras-da-operacao` (pedidos, compras): a resposta de antes, chave por chave, mais
`regrasGerais: { confirmacaoAutomatica: boolean, aceitaSemItens: boolean }` como ÚLTIMA chave.
- Valor: da versão ATUAL da TOP (a que o POST vai congelar), pela MESMA função da gravação (`regrasGeraisDaVersaoTop`):
  `confirmacaoAutomatica` ⇔ o 201 do POST traz `confirmacaoAutomatica`; `aceitaSemItens` ⇔ `items: []`/`itens: []`
  dá 201 (senão, a 422 de hoje). Formato 1 a 3, ilegível ou sem versão → `{ false, false }`; o formato 5 vale como o 4.
- Variante: só a venda e só a compra executam regra geral. Orçamento, pedido de venda e pedido de compra respondem
  sempre `{ false, false }`, qualquer que seja a versão (a mesma condição do POST).
- `GET /api/sales/<seg>/:id/edicao` leva o mesmo bloco dentro de `regras`, pela versão CONGELADA do documento (a que a
  PATCH executa); documento sem TOP → neutro.
- Permissão, porta, query e a 404 "Tipo de operação" de antes. Nenhuma consulta a mais.
- A presença do campo é a declaração (o molde de `reservaEstoque` e `exigeArmazem`, na mesma rota): ausente, ou fora da
  forma, a Central é a de antes.

**A situação da aprovação de UM documento.**

| Rota | Capacidade | Documento | 404 (a MESMA do GET por id, corpo idêntico) |
|---|---|---|---|
| `GET /api/aprovacoes/vendas/:id` | `sales.view` | a venda (`kind = 'sale'`) | id fora da forma, inexistente, de outra organização, fora do escopo de empresa do módulo vendas, excluída, orçamento ou pedido |
| `GET /api/aprovacoes/compras/:id` | `compras.view` | a compra (`especie = 'compra'`) | id fora da forma, inexistente, de outra organização, fora do escopo do módulo compras, pedido de compra |

- Ordem das recusas: 403 sem a capacidade (antes de qualquer leitura) → 422 `VALIDATION_ERROR` em QUALQUER parâmetro
  de consulta ("Parâmetro não reconhecido na situação da aprovação"; repetido: "Parâmetro repetido: informe um valor
  só"; `details` com o parâmetro) → 404.
- Resposta 200, exatamente duas chaves:
  `{ situacao: "nao_aberto" | "nao_exigida" | "pendente" | "aprovado" | "reprovado", ultimaDecisao: { decisao: "aprovado" | "reprovado", observacao: string | null, decididoPor: { id, nome }, decididoEm: <ISO> } | null }`.
  - `nao_aberto`: o documento não está aberto (venda fora de `open`/`approved` — o `approved` da 0005 é aberto; compra
    fora de "aberto"). A TOP não é lida.
  - Aberto: a MESMA conta da confirmação e das decisões (versão CONGELADA da TOP, valor ATUAL, decisão vigente da versão
    da venda; na compra, a última) → `nao_exigida`, `pendente`, `aprovado` ou `reprovado`.
  - `ultimaDecisao`: a última decisão do documento, de QUALQUER versão, também no `nao_aberto`; `observacao` é o
    motivo na reprovação. `null` sem decisão.
- Só leitura (nada gravado, sem idempotência, sem auditoria), número fixo de consultas, nenhuma por item.
- A fila (`GET /api/aprovacoes/<área>`) e as decisões (`POST …/:id/aprovar|reprovar`) não mudam e continuam em
  `.approve`.

**Na tela** (o motor da Central, regra da 276):
- **O Salvar.** "Salvar e confirmar" (rótulo e dica; testids `central-vendas-salvar` e `compras-salvar`, os de antes)
  quando o servidor declarou `confirmacaoAutomatica` E quem salva pode confirmar o documento (`sales.edit` /
  `compras.edit`, pelo `can()`, que só muda a apresentação). No resto, "Salvar". Vale na criação da venda e da compra
  e no receber do pedido (a TOP da compra gerada). A pílula "Confirmar venda"/"Confirmar compra" da criação continua.
- **O aviso do Salvar** sai da RESPOSTA (`confirmacaoAutomatica`), um por Salvar, nas Centrais de Vendas, de Compras
  (lançar e receber) e de Estoque.
- **Sem itens.** Com `aceitaSemItens`, a pendência "Adicione ao menos um item." (venda) / "Inclua ao menos um item."
  (compra) deixa de valer e o POST sai com a lista vazia. Nunca no receber do pedido. Produto vazio numa linha que
  existe continua pendência.
- **A aprovação na consulta.** Na venda e na compra ABERTAS, o bloco "Aprovação" pergunta a situação e só aparece em
  `pendente`, `aprovado` ou `reprovado`; em `nao_exigida`, `nao_aberto`, carregando, com erro (o 404 de rota da API
  anterior inclusive) ou com resposta fora da forma, nada. Aprovar e Reprovar só para quem tem `<recurso>.approve`, só
  em `pendente` e `reprovado`, pelas rotas e pelo diálogo da fila. A venda manda a `version` do documento que a tela
  mostra. Depois de decidir, a consulta inteira é lida de novo (a aprovação pode ter confirmado o documento).
- **O Confirmar** só abre em documento aberto e para quem pode confirmar — na pílula da consulta e na chegada da
  criação, nas duas Centrais. "Aguardando aprovação" é aberto: o diálogo abre e a prévia explica a recusa.

**Textos (exatos).**

| Onde | Testid | Texto |
|---|---|---|
| Salvar | `central-vendas-salvar` / `compras-salvar` | "Salvar" · "Salvar e confirmar" |
| Aviso do Salvar | — | "Salvo com sucesso" (sem a chave) · "Salvo e confirmado." · "Salvo. Este documento precisa de aprovação antes de ser confirmado." · "Salvo, mas não confirmado: você não tem permissão para confirmar este documento." · "Salvo, mas não confirmado: <mensagem do servidor>." (um ponto final só) |
| Bloco | `central-vendas-aprovacao` / `central-compras-aprovacao` (`data-situacao`) | "Aprovação" |
| Selo | `<prefixo>-aprovacao-situacao` | "Aguardando aprovação" · "Aprovado" · "Reprovado" (o vocabulário de situação) |
| Última decisão | `<prefixo>-aprovacao-decisao` | "Última decisão: Aprovado por <nome> em <data e hora>." [+ " Observação: <texto>"] · "Última decisão: Reprovado por <nome> em <data e hora>. Motivo: <motivo>" |
| Botões | `<prefixo>-aprovar` / `<prefixo>-reprovar` | "Aprovar" · "Reprovar" |
| Diálogo (o da fila) | `aprovacao-dialogo`, `aprovacao-observacao`, `aprovacao-motivo`, `aprovacao-confirmar` | "Aprovar o documento <código>?" · "Reprovar o documento <código>?" |
| Aviso da decisão | — | "Aprovado." · "Aprovado e confirmado." · "Aprovado. A confirmação automática não aconteceu: <mensagem>." · "O documento mudou depois que foi aberto. Ele foi carregado de novo; confira antes de aprovar." · "As aprovações ainda não estão disponíveis neste servidor." |

**Compatibilidade** (base `622f194`):

| Combinação | Comportamento |
|---|---|
| web novo × API anterior | sem `regrasGerais`: "Salvar" e a pendência de item, como antes; o aviso lê o `confirmacaoAutomatica` que a base já devolve; a situação responde o 404 de rota e o bloco não aparece |
| web anterior × API nova | a chave a mais é ignorada; corpos e respostas de antes; a rota nova não é chamada; o web anterior diz "Salvo com sucesso" e pede item, como já diz hoje |

**Fora (F2):** a ajuda da Geral do editor (F4, decisão 281); "Salvar e confirmar", sem itens e a aprovação na Central de
Estoque (F5; a matriz do estoque só aceita "Proibido"); a aprovação do pedido de compra (F6); a tela de edição da venda
salva; o aviso da conversão pedido → venda ("Operação concluída") e do faturar em partes; alterar documento depois de
confirmado e notificação para quem aprova (fora da PR).

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
As mensagens das funções do banco (0003, 0029, 0036, 0040) dizem "local de estoque" desde a 0043 (OPERACOES-01 F5a,
decisão 282).

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
(feitos na F3b, abaixo); "carregar mais" e `total` no seletor; CPF/CNPJ ou razão na opção; índice de prefixo ou
trigram (precisa de migration); a pesquisa do seletor de Funcionários.

### F3b — o local antes do produto e a pesquisa de produto com o saldo do local (decisão 280) · IMPLEMENTADO

> Parte F3b da decisão 280. Sem migration, sem permissão nova, sem variável. Uma rota nova de LEITURA declara a
> capacidade; a pesquisa de produto ganha parâmetros e chaves aditivos. Nenhum corpo de POST/PUT/PATCH muda. O contrato
> da rota de pesquisa mora em `docs/PERSONALIZACAO.md` ("Pesquisa de produtos"); o do motor, em
> `docs/PORTAIS-OPERACIONAIS-CONTRACT.md` (motor da Central).

**A ordem: o Local de estoque antes do produto.**
- Catálogo de itens de VENDA (`packages/domain/src/layout-documento.ts`, `CATALOGO_VENDAS`): `warehouse_id, codigo,
  product_id, estoque, quantity, unit_price, discount, discount_percent, total`. Só a posição do local mudou (rótulo,
  `sistema` e `referencia` iguais). Ele gera o layout do sistema (`LAYOUT_DO_SISTEMA`, o `layout-efetivo` da TOP de venda
  sem layout ligado) e o "Restaurar padrão" do configurador.
- Catálogo de COMPRAS: sem mudança (já `armazem_id, produto_id, …`), sem coluna Estoque.
- Motor sem layout (`features/central/itens.tsx`): grade `armazem, codigo, produto, estoque, …` (`:68`) e formulário
  do item `armazem, produto, estoque, …` (`:76`).
- Coluna FORÇADA sobre o layout: `armazemForcado` (`itens.tsx:195-198`) e a reserva de estoque da venda
  (`comColunasDaReserva`, `vendas/[kind]/new/page.tsx:133-139`) a põem logo ANTES do primeiro entre Código e Produto
  presentes (sem nenhum dos dois, no início).
- Consulta: `colunas.leitura` da venda (`central-vendas-adaptador.ts:64`: Local, Código, Produto, Estoque, …) e da
  compra (`compras/central/adaptador.ts:73`: Local, Código, Produto, …); o formulário de leitura do item com o Local
  antes do Produto (`itens-salvos.tsx:85-88`).
- Central de Compras, também: a prévia do "Confirmar compra" (Local de estoque → Produto, `dialogos-compra.tsx:49-51`)
  e a relação "Entradas no estoque do documento …" da consulta (Data → Local de estoque → Produto,
  `consulta-corpo.tsx:121-125`).
- Layout SALVO manda na ordem (decisão 276): nenhum layout gravado é reordenado (decisão 240).

**O "Local de estoque" do cabeçalho** (`features/central/local-padrao.tsx`: `useLocalDoCabecalho` e
`CampoDoLocalPadrao`):
- Onde: na CRIAÇÃO. Na venda, logo depois do Tipo de Operação (`new/page.tsx:940`). Na compra, logo depois da Empresa,
  na zona onde ela estiver: Dados principais, Dados adicionais ou a aba do painel (`criacao-dados.tsx:164-169`). Quando
  a Empresa mora em Dados adicionais, o campo conta em "Dados adicionais · N campos". No receber pedido não aparece
  (`estado.ts:530`).
- Quando: só com a coluna do local na grade — sem layout, com o layout que a desenha, ou forçada pela regra/reserva
  (`localNaGrade`). Com o local escondido pelo layout, a linha nasce sem local, como antes.
- O que oferece: os locais da empresa do documento (`RefSelect` de `warehouses` com `empresa_id`); desabilitado sem
  empresa; sem `data-campo` (não é campo do layout), sem "*", fora das pendências.
- Valor: começa no padrão de cadastro do layout para a empresa do documento (o "armazém padrão" da VENDAS-A3-1b). A
  escolha vale para a empresa em que foi feita: trocar a empresa volta ao padrão da empresa nova
  (`local-padrao.tsx:23-29`).
- Efeito: só a linha NOVA nasce com ele (`armazemPadrao` do motor); a linha troca o seu na célula; trocar o cabeçalho
  não mexe nas linhas que já existem.
- Estado da TELA:
  - nunca vai no corpo do POST/PUT (W4, CC-7, F3B-V1, F3B-C1, K-1a, K-1b);
  - não conta como alteração (F3B-V1, F3B-C1);
  - fica fora da cópia do Duplicar POR CONSTRUÇÃO (fora de `h`), sem teste próprio;
  - o Descartar o devolve ao padrão: o vazio sem padrão; o padrão do layout depois de uma escolha (F3B-V1, F3B-C1).
- Testids: `central-vendas-local-padrao`, `central-compras-local-padrao`. Rótulo "Local de estoque"; dica "Local de
  estoque das linhas novas. Cada item pode trocar o seu."

**`GET /api/produtos/pesquisa` — o que a F3b acrescenta** (a rota inteira: `docs/PERSONALIZACAO.md`):

| parâmetro | forma | ausente | recusa (422 `VALIDATION_ERROR`) |
|---|---|---|---|
| `pagina` | só dígitos canônicos, 1–1000 (`LIMITE_DE_PAGINAS`) | 1 | 0, 1001, "01", "1.5", "1e1", " 2", vazia, repetida |
| `com_saldo` | `true` \| `false` (grafia exata) | `false` | outra grafia, repetido; `true` sem `armazem_id` (`details: [{path:"com_saldo", message:"com_saldo exige armazem_id"}]`, de forma, antes de qualquer permissão) |
| `controla_estoque` | `true` \| `false` (grafia exata) | `false` | outra grafia, repetido |

- Resposta: `{ itens, estoqueDoArmazem, pagina, temMais, filtradoPorSaldo }`, NESTA ordem e sempre com as cinco
  chaves. `pagina` = a respondida. `temMais` = há produto depois desta página (a consulta pede `limite + 1`); sem total.
  `filtradoPorSaldo` = o filtro foi APLICADO. `estoqueDoArmazem` = `true` também com o filtro aplicado e a página vazia;
  sem `com_saldo`, como antes.
- `com_saldo=true` (as saídas): só o produto que controla estoque com saldo > 0 no local (a SOMA dos lotes) e o que não
  controla. O filtro está no WHERE, antes do LIMIT; `limit`/`offset` vão por parâmetro (`produtos-pesquisa.ts:112-123`).
- `controla_estoque=true`: só produto que controla estoque (a Central de Estoque, F5b).
- **Sem oráculo.** O filtro só vale para quem vê o saldo DAQUELE local: `stocks.view` ∧ local da organização, não
  excluído, de empresa viva e no escopo de empresa do módulo de ESTOQUE. É uma regra só, `armazemVisivelSql`
  (`produtos-pesquisa.ts:79-84`), para o filtro (Q0) e para o saldo. Para qualquer outro, `com_saldo` é IGNORADO e a
  resposta é byte a byte a do pedido sem ele, igual entre todos os "nãos" (PS-4): sem a permissão, local fora do escopo
  de estoque (mesmo visível noutro módulo), de outra organização, excluído ou inexistente. Não é 403 nem 422.
- Custo: sem `com_saldo`, as consultas de antes (produtos e, com estoque, saldos). Com `com_saldo=true`,
  `stocks.view` e `armazem_id`, mais UMA do local (Q0), visível ou não. São no máximo três consultas fixas,
  independentes do número de produtos e as mesmas para o local visível e o invisível (PS-7). Nunca N+1.

**`GET /api/produtos/pesquisa/capacidades`** (rota NOVA, mesmo arquivo e mesmo plugin; nada muda em `server.ts`):
- `{ "capacidades": { "pesquisaDeProdutos": 1 } }` para qualquer membro autenticado, sem consulta a dado; sem sessão,
  401.
- Versão 1 significa: a rota aceita `pagina`, `com_saldo` e `controla_estoque` e responde `pagina`, `temMais` e
  `filtradoPorSaldo`. Versão nova = valor novo.
- Na API anterior a rota não existe (404 de rota). A chave NÃO está em `/auth/context`.

**A pesquisa de produto na Central** (motor; `pesquisa.tsx`, `pesquisa-de-produtos.ts`):
- Fonte:
  - a capacidade é lida uma vez por carregamento da página (`useFonteDaPesquisaDeProdutos`), com forma e versão
    EXATAS. Qualquer outra coisa — 404 (não repetido), erro, rede ou forma diferente — é a pesquisa de hoje;
  - enquanto ela não chega, `data-fonte="carregando"` e nenhum pedido de opções.
- Fonte nova (`data-fonte="pesquisa"`):
  - pedido: `busca` aparada e cortada em 100; `armazem_id` = o local da LINHA, nunca o do cabeçalho; `limite=50`;
    `pagina`; `com_saldo=true` só na saída E com o local; `controla_estoque=true` só com `soControlaEstoque`;
  - chave de cache própria, nunca a `["options", …]` do `RefSelect`;
  - "Mostrar mais" (testid `<prefixo>-pesquisa-mais`; "Carregando…" enquanto busca) enquanto `temMais`, até a página
    1000; as páginas se acumulam na ordem do servidor.
- Fonte de hoje (`data-fonte="opcoes"`): `/api/resources/products/options`, mesma URL e mesma chave de cache de antes.
  A pesquisa de LOCAL usa sempre esta.
- Colunas: "Código | Descrição" e, quando uma página disse `estoqueDoArmazem` ou `filtradoPorSaldo`, "Estoque" (o
  saldo com 4 casas, "—" se nulo). Uma vez à vista, a coluna fica enquanto o painel está aberto. `data-coluna`
  (`codigo`, `descricao`, `estoque`) nas células e no cabeçalho, nas duas fontes.
- Sentido (`pesquisaDeProduto` do motor):
  - `PESQUISA_DE_PRODUTO_DA_SAIDA` (Central de Vendas: orçamento, pedido e venda) — "Só com saldo neste local" (testid
    `<prefixo>-pesquisa-so-com-saldo`) aparece com o local na linha e o saldo à vista, vem marcado e volta marcado a cada
    abertura;
  - `PESQUISA_DE_PRODUTO_DA_ENTRADA` (Central de Compras, lançar) — tudo, com o saldo;
  - ausente = entrada (o receber pedido não pesquisa produto).
- Vazio com o filtro: "Nenhum produto com saldo neste local."; sem o filtro, "Nenhuma opção encontrada"; erro, "Não foi
  possível carregar a lista.".
- Teclado: Esc fecha de qualquer ponto do painel; ↑ ↓ Enter só com o foco na busca ou na lista (↑ ↓ por todas as
  páginas carregadas). O placeholder continua "Pesquisar pela descrição".
- A escolha leva `{ id, label, code }`, sem o saldo.

**Compatibilidade** (base `622f194`, provas K-1a/b e K-2a/b):
- Web desta fase × API da base: capacidade 404 ⇔ `pagina` 422. A pesquisa de hoje, zero pedido à rota nova, a grade na
  ordem do layout da base, o local do cabeçalho na linha nova e o POST de hoje (201).
- Web da base × API desta fase: o web da base desenha o layout do sistema novo (Local primeiro), pesquisa em
  `/options`, grava (201). A rota, com os parâmetros de hoje, mantém as chaves e o significado.

**Fora (F3b):**
- Central de Estoque: F5b; herda a pesquisa com `soControlaEstoque: true`, e o local do cabeçalho de lá É o
  `armazem_id` gravado.
- Telas que continuam Produto → Local:
  - o lançamento de manejo da pecuária: tela de módulo, da F10;
  - as listagens de correções e de saldos iniciais: telas antigas, cujo destino a F11 decide;
  - o detalhe do documento de estoque e a relação de movimentos da Central de Estoque (F5b).
- Na pesquisa: o saldo disponível (com reserva), o total, a ordem por saldo e o debounce.
- No item e no documento: o filtro de empresa na célula do local do item; a coluna Estoque na compra; gravar o local do
  cabeçalho; reordenar layouts salvos.

### F5a — a movimentação interna no documento de estoque (decisão 282) · IMPLEMENTADO no banco e na API (a tela é da F5b)

> Parte F5a da decisão 282. Migration 0043. Sem variável. Uma rota nova; as das três espécies saem do laço de hoje.
> Capacidade aditiva `movimentacaoInterna: 1`. A Central de Estoque NÃO muda até a F5b: o web desta fase lança só as
> quatro espécies de hoje, e o menu (`apps/web/nav.registry.mjs`) não muda — as entradas das espécies novas vêm com a
> F5b. A PR #90 não vai à produção sem a F5b. Implantação em `docs/DEPLOYMENT.md` § OPERACOES-01 › F5a.

**As sete espécies do documento de estoque** (`erp.documentos_estoque`; domínio: `TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE`).

| Espécie | Segmento | Família da TOP | Recurso | Origem | Destino | Na confirmação |
|---|---|---|---|---|---|---|
| Entrada | `entradas` | `estoque.entrada` | `entradas_estoque` | — | — | `entry`, pelo custo informado ou, vazio, o custo médio do produto (gravado no item) |
| Saída | `saidas` | `estoque.saida` | `saidas_estoque` | — | pela TOP | `writeoff`, pelo custo médio |
| Transferência | `transferencias` | `estoque.transferencia` | `transferencias_estoque` | — | — | `transfer_out` e `transfer_in` |
| Ajuste | `ajustes` | `estoque.ajuste` | `ajustes_estoque` | — | — | `correction_in`/`correction_out`, pelo custo informado ou como hoje |
| Requisição (de material) | `requisicoes` | `estoque.requisicao_material` | `requisicoes_estoque` | — | pela TOP | NENHUM movimento: passa a pendente e RESERVA o pedido no local de estoque |
| Consumo | `consumos` | `estoque.consumo` | `consumos_estoque` | uma requisição (opcional; a TOP pode exigir) | pela TOP; herda o da requisição | `requisition` (−1), pelo custo médio |
| Devolução de consumo | `devolucoes-consumo` | `estoque.devolucao_consumo` | `devolucoes_consumo_estoque` | um consumo (obrigatório) | copiado do consumo | `devolution` (+1), pelo custo do item do consumo |

Permissões: view, create, edit e approve por recurso, sem delete, em "Operacional > Estoque", no escopo do módulo
`estoque`. Confirmar, cancelar e encerrar o saldo exigem `.edit`.

**Rotas** (prefixo `/api`; 404 uniforme para id malformado, inexistente, outro tenant, fora de escopo e outra espécie;
Idempotency-Key nos POST de lançar, confirmar, cancelar e encerrar, conferida DEPOIS da 404):

| Método e caminho | Permissão | Desta fase |
|---|---|---|
| GET `/estoque/{requisicoes,consumos,devolucoes-consumo}/operation-types` | `<recurso>.create` | as três (laço) |
| GET e POST `/estoque/<segmento>`; GET `/estoque/<segmento>/:id` | `.view` / `.create` | as três |
| GET `…/:id/previa-confirmacao`; POST `…/:id/confirmar`; POST `…/:id/cancelar` | `.view` / `.edit` / `.edit` | as três |
| POST `/estoque/requisicoes/:id/encerrar-saldo` | `requisicoes_estoque.edit` | **nova** |
| GET `/aprovacoes/estoque`; POST `/aprovacoes/estoque/<segmento>/:id/{aprovar,reprovar}` | `<recurso>.approve` | as três entram pelo laço |
| GET `/estoque/documentos` (lista única) | a `.view` de cada uma das sete | campos e filtros novos |
| GET `/stock/balances` | `stocks.view` | a linha ganha `empresa_id` |

**Corpo do POST `/estoque/<segmento>`** (`.strict()` nos dois níveis; os campos novos são OPCIONAIS, e o corpo de antes
continua valendo):
- no cabeçalho: `origem_documento_id`; o destino (`centro_custo_id`, `equipamento_id`, `ordem_servico_id`,
  `lote_animais_id`, `area_id`, `safra_id`); `motivo_saida` (os 13 de `MOTIVOS_SAIDA_ESTOQUE`); `justificativa` (até
  2000);
- no item: `origem_item_id`.

As recusas saem juntas num 422 `VALIDATION_ERROR` (`details[{path, message}]`; a mensagem é a do primeiro):
- custo: opcional na entrada e no ajuste. Na requisição, "A requisição não tem custo: não informe o custo". Nas outras,
  "O custo d<a espécie> é calculado na confirmação: não informe o custo";
- requisição: "A requisição reserva pelo produto no local de estoque: não informe lote nem validade";
- origem:
  - fora do consumo e da devolução → "A origem é só do consumo e da devolução de consumo";
  - na devolução, sem origem → "Informe o consumo de origem", e cada item sem a dele → "Informe o item do consumo que
    volta";
  - no consumo, item com origem sem o cabeçalho → "Informe a requisição de origem";
- destino:
  - fora da requisição, do consumo e da saída → "O destino é só da requisição, do consumo e da saída";
  - na devolução → "O destino da devolução de consumo é o do consumo de origem: não informe";
- motivo e justificativa:
  - fora da saída → "O motivo é só da saída" / "A justificativa é só da saída";
  - motivo sem justificativa → "Informe a justificativa da saída";
  - justificativa sem motivo → "Informe o motivo da saída".
  O par é OPCIONAL de forma TRANSITÓRIA, enquanto o web anterior puder estar no ar (decisão 282, pendência registrada);
  a tela nova manda os dois sempre.

Ordem das conferências: forma → TOP → a configuração da versão congelada, lida uma vez (exigências gerais e as seções
`destino`/`fluxo`) → locais de estoque → itens → ORIGEM → DESTINO → FLUXO → exigências gerais. Só depois vêm o número
(nenhuma recusa queima código), o cabeçalho com o destino FINAL, o ID Global e os itens com a origem.

**Origem.** A origem é lida com o MESMO recorte do GET e `for share`; os itens dela são travados `for update` em ordem
de id e, depois da trava, relidos com o que já foi ligado.
- Recusa uma origem que não é a espécie esperada, é de outra empresa ou de outro local de estoque, ou não está na
  situação que atende — tudo com a MESMA recusa, em `origem_documento_id`:
  - "Requisição de origem inválida: escolha uma requisição pendente da mesma empresa e do mesmo local de estoque";
  - "Consumo de origem inválido: escolha um consumo confirmado da mesma empresa e do mesmo local de estoque".
- Por item: "O item não é da requisição de origem" (ou "… do consumo de origem"); "O produto difere do item da
  requisição" (ou "… do item do consumo"); "Passa do saldo pendente do item da requisição: há <n>" (ou "Passa do que o
  consumo baixou e ainda não voltou: há <n>").
- O gatilho dos itens (0043) é a rede: duas partes simultâneas fazem fila e somam.

**Destino.** As referências informadas são conferidas numa consulta só, com a MESMA recusa para o inexistente, o de
outra empresa e o de outra organização:

| dimensão | mensagem |
|---|---|
| centro de resultado | "Centro de resultado inválido: escolha um centro de resultado analítico e ativo da organização" |
| máquina/equipamento | "Máquina/equipamento inválido: escolha uma máquina/equipamento ativo da empresa do documento" |
| ordem de serviço | "Ordem de serviço inválida: escolha uma ordem de serviço aberta ou em andamento da empresa do documento" |
| lote de animais | "Lote de animais inválido: escolha um lote de animais ativo da empresa do documento" |
| área/talhão | "Área/talhão inválida: escolha uma área/talhão ativa da empresa do documento" |
| safra | "Safra inválida: escolha uma safra ativa da organização" |

- O consumo HERDA cada dimensão que a requisição tem. Informar outra dá "O destino do consumo é o da requisição de
  origem". Reenviar a MESMA é o mesmo que omiti-la: não passa de novo pela conferência nem pela seção da TOP do consumo.
- Depois vem a seção Destino da TOP (§2).
- Todo movimento do documento leva o destino do cabeçalho, e o estorno o copia.

**Resposta do POST:** `{ id, codigo, especie, situacao: "aberto" }`, com `confirmacaoAutomatica` só na TOP Automática —
inalterada.

**Leitura** (`GET /estoque/<segmento>/:id`; as mesmas TRÊS consultas):
- o cabeçalho ganha as colunas novas e os nomes do destino: `centro_custo_nome`, `equipamento_nome`,
  `ordem_servico_codigo`, `lote_animais_nome`, `area_nome`, `safra_nome`;
- ganha também `saldo_encerrado_por_nome` e:
  - `origem` — `{id, codigo, especie, situacao}` ou `null`;
  - `vinculados` — `[{id, codigo, especie, situacao, data_documento}]`, os documentos que apontam este como origem;
  - `atendimento` — `pendente | parcial | atendido | encerrado` na requisição confirmada, e `null` nas outras;
- a `origem` e os `vinculados` só trazem as espécies que quem lê pode VER (a `.view` de cada uma). O documento sem a
  capacidade some como se não existisse, e `origem_documento_id` continua (é deste documento);
- os itens ganham:
  - `origem_item_id`;
  - `quantidade_atendida` — na requisição: os consumos não cancelados;
  - `saldo_pendente` — na requisição confirmada; `"0.0000"` com o saldo encerrado;
  - `quantidade_devolvida` — no consumo: as devoluções não canceladas.
  Os números vêm como texto.

**Lista** (`GET /estoque/documentos`): cada linha ganha `atendimento` e `origem_documento_id`. Os filtros novos, sem
consulta nova:
- `atendimento`, em CSV de `pendente,parcial,atendido,encerrado`, aplicado no WHERE antes do LIMIT; valor fora → 422 no
  parâmetro;
- `origem_documento_id`; uuid malformado → zero linhas.

**Prévia** (`contractVersion` continua 1):
- requisição: `saldo_atual` é o DISPONÍVEL do par (o físico de todos os lotes menos o reservado pelos OUTROS),
  descontado do que os itens anteriores do mesmo produto já pediram; `movimento: null`; a chave aditiva
  `baseDoSaldo: "disponivel"`, só nela;
- consumo: como a saída (o físico; `movimento: "writeoff"`, a lista que o web anterior lê; o razão grava `requisition`);
- devolução: como a entrada (`movimento: "entry"`);
- as quatro de hoje: o corpo de hoje, chave por chave.

**Confirmar** (a MESMA função; resposta `{ id, situacao: "confirmado", movimentos }`):
- requisição: sem período e sem movimento (`movimentos: 0`); trava os produtos (`SQL_TRAVA_PRODUTOS`, em ordem de id);
  confere o disponível depois da trava; falta → 422 por item, "Disponível insuficiente de <produto> no local de estoque:
  há <n>, a requisição pede <q>.", sem reserva parcial;
- consumo: como a saída. A guarda da reserva tira da conta a parte do próprio consumo;
- devolução de consumo: `devolution`, pelo custo do item do consumo;
- entrada sem custo: o custo médio do produto, gravado no item;
- ajuste com custo: pelo custo informado.
A aprovação ("Sempre") vale para as três como para as quatro (409 `APROVACAO_PENDENTE`).

**Cancelar:**
- a requisição confirmada com consumo vivo → 409 "Esta requisição tem consumos: cancele-os ou encerre o saldo.";
- o consumo confirmado com devolução viva → 409 "Este consumo tem devoluções: cancele-as primeiro.";
- a requisição confirmada sem dependente cancela SEM estorno, e a reserva some.

**Encerrar o saldo** (`POST /estoque/requisicoes/:id/encerrar-saldo`):
- corpo `{ "motivo": "<1 a 500>" }`, `.strict()`;
- com o cabeçalho travado, cada uma 409, nesta ordem:
  - "Esta requisição não está pendente.";
  - "O saldo desta requisição já foi encerrado.";
  - "Esta requisição ainda não foi atendida: cancele-a em vez de encerrar o saldo." — julgado pelos itens lidos depois da
    trava;
  - "Esta requisição não tem saldo a encerrar.";
- o UPDATE confere o ROW COUNT;
- auditoria `encerrar_saldo` `{motivo}`;
- resposta `{ id, situacao: "confirmado", atendimento: "encerrado" }`;
- o consumo ABERTO que a atende continua reservando a parte dele.

**Reserva no disponível** (o núcleo da 0035 com a parte C): o reservado do par é A + B (pedidos de venda) + C1 (o saldo
pendente das requisições confirmadas sem saldo encerrado) + C2 (os itens ligados dos consumos abertos). O Saldo, a
prévia da venda e a guarda das saídas veem a requisição. A mensagem da guarda é a de hoje: `INSUFFICIENT_STOCK:
disponível … < solicitado … (… reservado para pedidos)`.

**Capacidade:** as sete `operation-types` declaram `capacidades: { documentoEstoque: 1, movimentacaoInterna: 1 }`.
`movimentacaoInterna: 1` (`CAPACIDADE_MOVIMENTACAO_INTERNA`) declara:
- as três espécies, o destino, o motivo e a justificativa, a entrada sem custo, o custo no ajuste e a origem;
- o encerramento do saldo, `atendimento`, `vinculados` e `baseDoSaldo`;
- o `empresa_id` do Saldo.
O leitor é `entendeMovimentacaoInterna`: só `=== 1`; qualquer outra forma é "não declarada". A web desta fase não lê a
chave; a F5b lê.

**O razão e quem grava nele:**
- a OS finalizada grava o centro de resultado, a safra e a própria OS;
- o manejo grava o lote de animais;
- o estorno copia o destino e a cultura do original;
- "Saídas x Centro de Resultado" não soma a saída estornada.

**Fora (F5a) e para a F5b:**
- a Central de Estoque no motor, com as sete espécies (`TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE`), lendo
  `movimentacaoInterna`;
- `temTela: true` no catálogo e o menu (`apps/web/nav.registry.mjs`, que esta parte não muda);
- o link do ID Global das três;
- a devolução pré-preenchida pela saída;
- o ajuste a partir do Saldo no documento novo;
- o seletor de OS do destino (não existe `/api/resources/service_orders/options`);
- o layout por TOP do estoque (o CHECK já aceita as sete famílias; falta o catálogo de layout no domínio);
- motivo e justificativa sempre enviados.

As decisões pendentes do Maike — o par motivo/justificativa obrigatório no servidor depois que o web anterior sair de
produção (I-1) e as perguntas antes da F11 (saldo inicial, entrada sem NF, requisição antiga, o neutro do Destino, a
devolução antiga, `reason_note` e os relatórios que só leem as tabelas antigas; I-2 e I-3) — estão na decisão 282.

## 4. Compras: pedido, orçamento e finalização com aprovação

### F6a — o pedido finalizado, a aprovação do pedido e o orçamento de compra (decisão 283) · IMPLEMENTADO NA API

> Parte F6a da decisão 283. Migration 0044 (depois da 0043, da qual depende: a pré-condição 2.9 exige o CHECK de
> layouts com as sete famílias de estoque). Sem variável. Implantação em `docs/DEPLOYMENT.md` § OPERACOES-01 › F6a. A
> F6b (as telas da Central de Compras) acrescenta a subseção dela.

A F6a fez banco (0044), domínio, API e as abas do editor da TOP. As telas da Central de Compras são da F6b; até lá, nada
disto aparece na Central de Compras, e a capacidade `finalizacaoEOrcamento: 1` (em `GET /api/compras/{pedidos,compras,orcamentos}/operation-types`)
diz ao web que o servidor tem tudo o que segue. O menu (`apps/web/nav.registry.mjs`) não muda: a entrada do orçamento
de compra vem com a F6b. Com "Exigir pedido finalizado para receber" = Sim, o web deste HEAD não recebe o pedido (409, e
não há botão Finalizar até a F6b): as regras se ligam só com as telas da F6b no ar.

**Máquina de estados** (`erp.documentos_compra.situacao`, transição v3 da 0044):

| espécie | situações | passagens |
|---|---|---|
| pedido | aberto · finalizado · convertido · cancelado | aberto → finalizado (Finalizar); aberto ou finalizado → convertido (saldo zerado ou encerrado); convertido → a situação de antes de converter (compra cancelada, sem saldo encerrado); aberto ou finalizado → cancelado (sem compra viva). Finalizado nunca volta a aberto. |
| orçamento | aberto · escolhido · nao_escolhido · cancelado | aberto → escolhido (vencedor) / nao_escolhido (os outros) / cancelado. Escolhido e não escolhido são finais. Nunca confirmado nem convertido. |
| compra | aberto · confirmado · cancelado | como hoje |

"Parcial" e "atendido" do pedido continuam calculados pelo saldo.

**Rotas** (prefixo `/api`; corpo `.strict()`, chave desconhecida → 422; id malformado, inexistente, de outro tenant,
fora do escopo e de outra espécie → a MESMA 404; 403 só para falta de capacidade; toda escrita com Idempotency-Key —
autor no hash, visibilidade antes da chave —, ROW COUNT e auditoria):

| método e caminho | capacidade (AND) | corpo | resposta |
|---|---|---|---|
| GET `/compras/pedidos/:id/previa-finalizacao` | `pedidos_compra.view` | — | `{contractVersion: 1, podeFinalizar, recusas: [{code, message, details}], aprovacao: {situacao: "nao_exigida" \| "pendente" \| "aprovado" \| "reprovado"} \| null}` |
| POST `/compras/pedidos/:id/finalizar` | `pedidos_compra.edit` | `{}` | `{id, situacao: "finalizado", finalizado_em, finalizado_por}` |
| POST `/compras/pedidos/:id/aprovar-para-orcamento` | `compras.edit` ∧ `pedidos_compra.view` | `{}` | `{id, aprovado_orcamento_em, aprovado_orcamento_por}` |
| POST `/compras/pedidos/:id/orcamentos` | `orcamentos_compra.create` ∧ `pedidos_compra.view` | `{tipo_operacao_id, fornecedor_id, data_documento, condicao_pagamento_id?, prazo_entrega_dias? (0..3650), validade_orcamento?, observacao? (≤ 2000), itens?: [{item_pedido_id, valor_unitario}]}` | 201 `{id, codigo, especie: "orcamento", situacao: "aberto", pedido_orcado_id, fornecedor_id, valor_itens, valor_total}` |
| POST `/compras/pedidos/:id/orcamentos/:orcamentoId/escolher` | `pedidos_compra.edit` ∧ `orcamentos_compra.edit` | `{}` | `{pedido: {id, situacao: "aberto", fornecedor_id, condicao_pagamento_id, valor_itens, valor_total}, vencedor: {id, situacao: "escolhido"}, naoEscolhidos: [ids]}` |
| GET `/compras/orcamentos` | `orcamentos_compra.view` | query da lista de compras + `pedido_orcado_id` | a página da lista de compras |
| GET `/compras/orcamentos/operation-types` | `orcamentos_compra.create` | — | o contrato das outras espécies, família `compras.orcamento`, `finalizacaoEOrcamento` no fim |
| GET `/compras/orcamentos/regras-da-operacao?tipo_operacao_id=` | `orcamentos_compra.create` | — | `{contractVersion: 1, formato, exigencias, condicoesPermitidas, geraTitulos: false, exigeFormaPagamento: false, exigeVencimento: false, exigeArmazem: false}` |
| GET `/compras/orcamentos/layout-efetivo?tipo_operacao_id=` | `orcamentos_compra.create` | — | o layout efetivo da TOP de orçamento |
| GET `/compras/orcamentos/:id` | `orcamentos_compra.view` | — | a leitura do documento de compra |
| PUT `/compras/orcamentos/:id` | `orcamentos_compra.edit` | `{condicao_pagamento_id, prazo_entrega_dias, validade_orcamento, observacao, itens: [{id, valor_unitario}]}` (todas as chaves; anuláveis onde diz) | a leitura depois de gravar |
| POST `/compras/orcamentos/:id/cancel` | `orcamentos_compra.delete` | `{motivo?}` (1..500) | `{id, situacao: "cancelado"}` |

Não existe `POST /compras/orcamentos`: o orçamento nasce do pedido. TOP ausente, malformada, de outra família, inativa,
excluída ou de outra organização nas portas de leitura do lançamento → a MESMA 404.

**Mudanças aditivas nas rotas de hoje:** a leitura do pedido e da compra ganha as colunas novas, `finalizado_por_nome`,
`aprovado_orcamento_por_nome` e `pedido_orcado_codigo`; no pedido, `orcamentos` (id, código, situação, fornecedor_id,
fornecedor_nome, condicao_pagamento_id, prazo_entrega_dias, validade_orcamento, valor_total; inclusive cancelados, na
ordem em que nasceram) SÓ para quem tem `orcamentos_compra.view` — sem ela a chave não existe e a consulta nem roda (a
leitura do pedido não é uma segunda porta para o orçamento: CAPACIDADE ∧ ESCOPO). `GET /compras/documentos`
traz orçamento só com `especie=orcamento` E `orcamentos_compra.view`. `GET /compras/pedidos/:id/proximos-passos` ganha
`exigeFinalizar` no fim (ilegível → `true`); os itens continuam só os de compra. Receber, encerrar o saldo e cancelar
aceitam o pedido finalizado. A prévia da compra ganha `divergencia` no fim, só quando se aplica. A fila
`GET /api/aprovacoes/compras` lista o pedido para quem tem `compras.approve` ∧ `pedidos_compra.approve`, com
`especie: "pedido"`; aprovar o pedido não o finaliza.

**Permissões:** `pedidos_compra.approve` ("Aprovar") e o recurso `orcamentos_compra` ("Orçamentos de Compra", CRUD,
"Operacional > Compras", módulo `compras`). ID Global do orçamento: `/compras/orcamentos/:id`, `orcamentos_compra.view`.
Anexo do orçamento: `orcamentos_compra.view`.

**Regras:**
- **Finalizar** só o pedido aberto ("Só pedido aberto é finalizado."). Com aprovação na versão congelada (formato 4 ou
  5; "Sempre", ou "A partir de um valor" com o total ATUAL): sem decisão, ou aprovada que não cobre (valor aprovado <
  total atual, ou outra versão da TOP) → 409 `APROVACAO_PENDENTE` "Este pedido precisa de aprovação antes de ser
  finalizado."; reprovada → 409 `APROVACAO_REPROVADA`. A guarda da 0044 faz a mesma conta no banco.
- **A aprovação do pedido vale ao FINALIZAR.** Com "Exigir pedido finalizado para receber" = Não (o neutro), o pedido
  ABERTO é recebido sem passar por ela; quem quer o pedido controlado liga as duas regras. O pedido aberto que exige
  aprovação fica na fila enquanto estiver aberto. Exigir o par na gravação (aprovação diferente de "Sem aprovação" ⇒
  "Exigir pedido finalizado para receber" = Sim) é decisão PENDENTE do Maike (decisão 283).
- **Receber** com `fluxoCompra.exigeFinalizar` e o pedido aberto → 409 "Este pedido precisa ser finalizado antes de ser
  recebido.".
- **Aprovado para orçamento** uma vez, com o pedido aberto ("Só pedido aberto é aprovado para orçamento." / "Este pedido
  já está aprovado para orçamento.").
- **Orçamento:** só de pedido aberto ("Só pedido aberto recebe orçamento.") e aprovado para orçamento ("Este pedido não
  está aprovado para orçamento."); a TOP é um destino de orçamento do leque da versão do pedido ("A TOP deste pedido não
  tem orçamento nas próximas operações.", 422 `TIPO_OPERACAO_INDISPONIVEL`); um vivo por fornecedor ("Este pedido já tem
  orçamento deste fornecedor."); depois do vencedor, nenhum ("Este pedido já tem orçamento vencedor."); item repetido ou
  de outro pedido → 422 "Item que não é deste pedido."; validade antes da data → 422 "A validade do orçamento não pode
  ser anterior à data do documento."; no PUT, os itens são exatamente as linhas do orçamento, uma vez cada → senão 422
  "Informe o preço de cada item do orçamento, uma vez cada."; editar ou cancelar só aberto ("Este orçamento não está
  aberto.") e com o pedido aberto ("O pedido deste orçamento não está aberto."). Exigências da Geral do orçamento: só
  fornecedor e observação; condições permitidas e layout da TOP do orçamento, como na compra. Puxa todos os itens do
  pedido (produto, Local de estoque, quantidade, posição), preço digitado ou "0"; sem frete, outras despesas e desconto;
  não mexe em estoque nem em financeiro; NÃO consome o saldo do pedido.
- **Escolher o vencedor** só com o pedido aberto ("O vencedor só é escolhido com o pedido aberto.") e sem compra gerada,
  inclusive cancelada ("Este pedido já gerou compra: o orçamento vencedor não pode mais ser escolhido."); o vencedor
  cobre cada item do pedido com uma linha ("O orçamento não cobre os itens do pedido."); a condição do vencedor tem de
  estar entre as permitidas da TOP DO PEDIDO (422 `CONDICAO_PAGAMENTO_NAO_PERMITIDA`). Leva fornecedor, preço de cada
  item (desconto do item zerado) e condição — sem condição no vencedor, a do pedido fica; frete, outras despesas e
  desconto do pedido ficam; totais e plano refeitos; o prazo não vai. Um vencedor por pedido, sem reescolha. O valor do
  pedido muda: a aprovação anterior deixa de cobrir.
- **Sem cascata:** finalizar, receber e cancelar o pedido não mexem nos orçamentos abertos; depois disso o vencedor é
  recusado, e eles ficam abertos até serem cancelados (a F6b trata).

**A divergência com o pedido** (seção `divergenciaPedido` da TOP da COMPRA, §2), só na compra gerada de um pedido, no
planejamento da confirmação, logo depois da aprovação e antes de qualquer efeito:
- **preço, por linha da compra:** líquido unitário = valor total ÷ quantidade (6 casas, meio para cima), dos dois lados;
  `diferencaPercentual` = (compra − pedido) ÷ pedido × 100, com sinal, 2 casas; para mais e para menos; base zero no
  pedido → diverge se a compra não é zero, sem percentual, sempre acima;
- **quantidade, por item do pedido trazido NESTA compra:** a soma das linhas ligadas a ele (o lote divide linhas) contra
  o saldo ANTES desta compra (a quantidade do item menos o ligado nas OUTRAS compras não canceladas); saldo zero não
  entra; o item do pedido que esta compra não traz NÃO entra — com "Bloquear", a entrega parcial acima da tolerância
  bloqueia, e omitir o item não bloqueia (o saldo dele fica no pedido);
- **acima da tolerância** = |diferença %| > tolerância, comparada exata antes de arredondar (o igual não passa);
- **"Avisar":** a prévia ganha `divergencia: {modo, toleranciaPrecoPercentual, toleranciaQuantidadePercentual, itens:
  [{campo: "preco" | "quantidade", itemPedidoId, itemIds, produto, valorPedido, valorCompra, diferencaPercentual,
  acimaDaTolerancia}], bloqueia}` (só o que diverge; por item do pedido na ordem das linhas, o preço antes da
  quantidade); a compra confirma; a auditoria `confirm` guarda `divergencia: {modo, itens}` quando há item;
- **"Bloquear" com item acima:** a prévia recusa e a confirmação manual dá 409 `DIVERGENCIA_COM_O_PEDIDO` "A compra
  diverge do pedido além da tolerância desta operação.", `details.itens` = os itens acima, sem efeito; a automática deixa
  a compra salva e aberta, `confirmacaoAutomatica` "recusada" com o MESMO corpo;
- compra sem origem, TOP sem a seção ou "Nenhuma": a chave `divergencia` não existe na prévia (o corpo de hoje).

**Fica para a F6b:** as telas (Finalizar e a prévia, Aprovado para orçamento, os orçamentos, Escolher vencedor, a
divergência na prévia), o E2E do fluxo, o K-1 de compras, o menu e a chave de idempotência da Central de Compras.

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
