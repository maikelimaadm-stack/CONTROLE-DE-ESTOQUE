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

A preencher pela F8 (decisão 285).

## 7. Financeiro pela TOP e LCDPR

A preencher pela F9 (decisão 286).

## 8. Mapa "tela antiga → central nova"

A preencher pela F11 (decisão 288).
