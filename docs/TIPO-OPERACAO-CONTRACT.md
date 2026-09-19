# Contrato do Tipo de Operação (TOP)

> Contrato de produto (BASE2-02, estendido pela TOP-CONFIG-01).
> Registry das FAMÍLIAS CANÔNICAS: `packages/domain/src/tipo-operacao.ts`.
> Camada CONFIGURÁVEL: `erp.tipos_operacao` + `packages/domain/src/tipo-operacao-configurado.ts`.
> Rótulos: `packages/plataforma/src/idiomas/pt-BR.ts` (`top.*`).
> Referências: `packages/domain/dicionario-dados.mjs` (campos `top` / `tops` / `discriminadorTop`).
> Gates: `packages/domain/test/tipo-operacao.test.ts`, `node scripts/data-dictionary.mjs --check` e
> `node scripts/familia-operacional-ssot-audit.mjs` (proíbe segunda lista das famílias).

## 0. Duas camadas, desde a TOP-CONFIG-01

Até a BASE2-02 existia UMA coisa chamada TOP. Desde a TOP-CONFIG-01 existem DUAS, e confundi-las é o erro
que este capítulo existe para impedir.

| | **Família canônica de operação** | **TOP configurada** |
| --- | --- | --- |
| O que é | a espécie operacional que o PRODUTO conhece e sabe executar | o tipo que a ORGANIZAÇÃO cadastra e nomeia |
| Exemplo | `vendas.venda` | `2103 — Venda de Gado a Prazo` |
| Onde mora | `packages/domain/src/tipo-operacao.ts`, em Git | `erp.tipos_operacao`, no banco, por organização |
| Quem muda | uma fatia, com revisão e migration | o administrador, pela tela |
| Quantidade | uma por espécie | zero, uma ou MUITAS por família |
| Executa efeito? | **não** | **não** |

A TOP configurada **aponta** para uma família (`codigo_base`) e **não pode** apontar para nada que o
registry não declare — a validação é contra `CODIGOS_TIPO_OPERACAO`, nunca contra uma cópia da lista.

**CLASSIFICAR ≠ EXECUTAR continua valendo, e vale MAIS.** Agora que o usuário pode criar tipos de operação,
a tentação de pendurar efeito neles é maior: "toda TOP 2103 gera título a prazo". Não. Quem executa continua
sendo o serviço de domínio; a TOP configurada é um rótulo de configuração sobre a família, e a família é uma
classificação. Nenhuma das duas tem handler.

### 0.1 Integridade e escrita da TOP configurada

Quatro invariantes da camada configurada. As três primeiras são do banco; a quarta é da borda da API.

| Invariante | Onde mora | O que acontece se quebrar |
| --- | --- | --- |
| A versão corrente EXISTE | `fk_tipos_operacao_versao_atual`, composta com `organization_id` e `deferrable initially deferred` | `versao_atual` órfã não erra: o `join` interno do servidor devolve ZERO linhas e a TOP some da lista e do detalhe sem exceção nenhuma |
| Conteúdo é imutável | `trg_tipos_operacao_versoes_imutavel` + `grant` sem `update`/`delete` | documento antigo passaria a citar texto novo |
| No máximo UMA padrão ativa por família | `ux_tipos_operacao_padrao` (índice parcial) | duas padrão, e o serviço escolheria pela ordem da consulta |
| Entrada é canônica | `.strict()` nos três schemas de escrita | `z.object` descarta chave desconhecida EM SILÊNCIO: `{"ativoo": false}` virava 200 com o campo ignorado |

**Toda escrita é otimista, inclusive a exclusão.** `PUT` recebe `revisao` no corpo e `DELETE` recebe
`?revisao=` na query (DELETE não tem corpo por convenção). Revisão velha é `409 CONCURRENCY_CONFLICT`;
registro inexistente, de outro tenant ou já excluído é a MESMA `404` — e a ordem é 404 ANTES de 409, senão
a diferença entre os dois códigos vira oráculo de existência.

**Salvar sem alterar NÃO é escrita.** Um `PUT` cujo conteúdo e estado coincidem com os atuais não grava, não
incrementa `revisao`, não move `atualizado_em` e não registra auditoria: devolve o estado corrente. A razão
não é economizar `update` — é que `revisao` é a moeda do controle de concorrência, e gastá-la à toa
invalidaria toda outra aba aberta na mesma TOP.

**Mudança de estado tem AUTOR, dos dois lados.** Trocar o padrão altera DUAS linhas: a que assume
(`set_default`) e a que abdica (`unset_default`, com `novoPadraoId` no metadado). Quem perdeu o posto nunca
sai da INTENÇÃO da rota, e sim do efeito medido: nas trocas, do `returning` do `update` que liberou o posto;
na exclusão, da leitura sob `for update`, que dentro da transação é o valor que o `update` sobrescreveu.
Sem padrão anterior não se inventa evento. Desativar e excluir a padrão também emitem `unset_default`,
porque nos dois casos o posto vaga e um `deactivate`/`delete` sozinho não diz isso.

### 0.2 O documento grava SNAPSHOT: identidade + versão (TOP-CONFIG-02)

A partir da TOP-CONFIG-02, um lançamento que usa TOP guarda **dois** ponteiros, nunca um:

| Coluna | O que é |
| --- | --- |
| `tipo_operacao_id` | a TOP configurada que o usuário escolheu |
| `tipo_operacao_versao_id` | a VERSÃO exata dela no instante do lançamento |

**Por que dois.** Guardar só o primeiro faria o documento herdar o nome ATUAL da TOP: renomear
"Venda de Gado a Prazo" para "Venda de Bovinos a Prazo" reescreveria, em silêncio, o que um documento de
2024 diz que é. O segundo trava a versão — o documento cita a linha imutável que existia no dia, e a edição
administrativa de amanhã cria a versão N+1 sem tocar no passado.

**Regras que valem em toda superfície que passar a gravar TOP** (Vendas é o piloto; Compras, Estoque e
Financeiro seguirão o mesmo contrato):

- **O cliente manda só o `tipo_operacao_id`.** Quem escolhe a versão é o SERVIDOR, na escrita. Deixar o
  cliente enviar a versão seria deixá-lo escolher qual passado citar, e um cliente desatualizado congelaria
  uma versão que já não é a corrente.
- **A TOP tem de ser da FAMÍLIA da variante.** A família sai do registry (`resolverTipoOperacao`), nunca de
  uma lista copiada na rota. Família errada é recusa — e o banco não pega esse caso: a FK prova tenant e
  parentesco, não família.
- **Paridade no banco.** `CHECK ((tipo_operacao_id is null) = (tipo_operacao_versao_id is null))`: meia
  identidade é pior que nenhuma, porque a leitura cairia de volta no nome atual.
- **A leitura sai da VERSÃO CONGELADA.** Reaproveitar a consulta administrativa (que junta pela
  `versao_atual` do pai) faz o documento antigo exibir o nome de hoje. É o erro mais fácil de cometer aqui.
- **`null` é resposta legítima** — acervo, ou documento criado por cliente anterior à fatia. A tela diz
  "não configurada", nunca a família canônica disfarçada de TOP, e a listagem usa LEFT JOIN.
- **Desativar ou excluir a TOP não toca o passado.** Exclusão é lógica; o documento continua legível e
  continua casando o filtro por id. Só NOVO lançamento deixa de poder usá-la.
- **Editar outro campo não re-carimba o snapshot.** PUT sem o campo, e PUT com o MESMO id, preservam a
  versão gravada. Só a troca EXPLÍCITA de TOP captura a versão corrente da nova — e gera evento próprio.
- **Conversão escolhe a TOP do DESTINO.** A da fonte é de outra família e nunca é herdada; um cliente antigo
  que converte sem informá-la produz destino legado, e não um documento com TOP da família errada.
- **A porta de escolha é OPERACIONAL, não administrativa.** Quem pode lançar vê as TOPs ativas da família;
  `tipos_operacao.*` continua sendo a capacidade de CONFIGURAR. São perguntas diferentes.
- **Obrigatoriedade é de UX, não do banco.** As colunas são NULLABLE nesta fase — por acervo e por rolling
  deploy. Torná-las obrigatórias é fatia futura, com backfill consciente e sem cliente legado vivo.

**CLASSIFICAR ≠ EXECUTAR permanece.** Escolher a TOP não mudou efeito de estoque, financeiro, fiscal,
status ou permissão: confirmar uma venda faz exatamente o que fazia. A TOP é a identidade configurada do
lançamento; efeitos configuráveis são a TOP-CONFIG-03, e nada nesta fatia os antecipa.

## 1. O que a TOP é

**Tipo de Operação é a classificação funcional de um lançamento.** Ela responde a uma pergunta só:

> *que operação é este registro?*

Uma entrada de insumos é `estoque.entrada_manual`. Um título financeiro com `direction = "payable"` é
`financeiro.conta_a_pagar`. Uma transferência com `kind = "farm"` é `estoque.transferencia_entre_empresas`.

A TOP é **declarativa e estática**: uma lista em código, versionada em Git, lida por quem precisa
apresentar ou auditar a classificação. Ela existe porque essa resposta já era dada — em prosa, dentro do
dicionário de dados, sem chave e sem ninguém que a lesse — e prosa não tem unicidade, não resolve e não
reprova quando diverge.

## 2. O que a TOP não é

**CLASSIFICAR ≠ EXECUTAR.** Esta é a regra central, e ela não tem exceção nesta fase.

| A TOP **não** decide | Quem decide, hoje e nesta fatia |
| --- | --- |
| Efeito de estoque | o serviço da rota (`apps/api/src/routes/stock.ts`, `postStock`) |
| Geração financeira | o serviço do módulo financeiro |
| Tratamento fiscal e contábil | os serviços dos módulos correspondentes |
| Endpoint / rota de API | `apps/api/src/routes/*` |
| Rota de tela | `apps/web/nav.registry.mjs` e o catálogo de ID Global |
| Permissão / capacidade | `packages/domain/src/permissions.ts` + `runService` |
| Escopo de empresa | `packages/domain/src/escopo-permissao.ts` + RLS |
| Validação de campo e obrigatoriedade | o schema zod da rota |
| Transação, idempotência, `version` | `runService` |
| Cancelamento e confirmação | a máquina de estados do módulo |
| Situação do registro | a coluna `status` e os rótulos de enum |
| Layout da tela | o Modelo Base 2 e o módulo dono |

Declarado sem rodeio, para não precisar de interpretação:

- ~~**TOP NÃO é tabela de banco** nesta fatia. Não existe `erp.tipos_operacao`, não existe `top_id`, e
  nenhum documento persiste a sua TOP.~~
  **HISTÓRICO DA BASE2-02 / SUPERADO POR TOP-CONFIG-01.** `erp.tipos_operacao` existe desde a migration
  0020 — mas para a CAMADA CONFIGURÁVEL (§0), não para as famílias canônicas, que continuam só em Git.
  A parte que **permanece vigente**: nenhum documento persiste TOP ainda (`top_id` não existe em documento
  nenhum); isso é a TOP-CONFIG-02, e até lá o §9 abaixo continua descrevendo o futuro, não o presente.
- ~~**TOP NÃO é configuração editável.** Não há CRUD, não há tela administrativa, não há editor.~~
  **HISTÓRICO DA BASE2-02 / SUPERADO POR TOP-CONFIG-01.** Existe CRUD e existe tela
  (Configurações › Operações › Tipos de Operação) — da TOP CONFIGURADA. A parte que **permanece vigente, e
  é a que importava**: a FAMÍLIA CANÔNICA continua não sendo editável. Não há CRUD de família, não há tela
  que a crie, e o gate `familia-operacional-ssot-audit` impede até que alguém redigite a lista.
- **TOP NÃO é permission key.** Nenhum código de TOP termina em `.view`/`.create`/`.edit`/`.delete`, e o
  teste de contrato reprova quem tentar.
- **TOP NÃO é endpoint de lançamento** nem **service**. Não existe `/api/top` nem `/api/base2`, e nenhuma
  tela de lançamento consulta a TOP por rede — os detalhes do Modelo Base 2 resolvem a família pelo registry
  em memória (`tipoOperacaoDoRegistro`). O que existe desde a TOP-CONFIG-01 é
  `/api/admin/tipos-operacao`, que é **administração de configuração**: serve a tela de cadastro e mais
  nada. Um consumidor de lançamento que passe a depender dela é regressão, e o E2E do Base 2 prova que não
  passou.
- **TOP NÃO é situação (status).** Situação muda com o tempo; a operação é o que o registro sempre foi.
- **TOP NÃO é ID Global.** O ID Global localiza um registro dentro da organização; a TOP diz que espécie
  de operação ele é. Um é endereço humano, o outro é classe.
- **TOP NÃO é módulo.** O módulo é o dono; a TOP é uma das operações dele.
- **TOP NÃO é movimento de ledger.** `erp.stock_movements` é a **consequência** de uma operação, não uma
  operação — e por isso nunca recebe TOP.
- **TOP NÃO é posting engine, workflow engine, layout engine nem motor de campos.**

Regra de negócio continua onde está. Nada foi movido para o registry, e mover seria a falha que este
contrato existe para impedir.

## 3. Chave canônica

Forma: `<modulo>.<operacao>` — minúsculas, `_` como separador interno, sem acento, sem espaço, sem hífen.

```
estoque.entrada_manual
financeiro.conta_a_pagar
estoque.transferencia_entre_empresas
```

- A chave é **estável** e é a identidade da TOP em código, teste e dicionário.
- O `<modulo>` é uma chave de `MODULOS_ESCOPO_EMPRESA` — o mesmo vocabulário do escopo de empresa, não um
  segundo conjunto de nomes de módulo.
- **Rótulo humano nunca é chave.** "Conta a pagar" muda com revisão de texto e com idioma; a chave não.
- A chave **não aparece na tela**. O usuário vê o rótulo; a chave é da máquina.

## 4. Entidade e variante

A origem de uma TOP é o registro que ela classifica:

| Caso | Declaração | Exemplo |
| --- | --- | --- |
| A tabela inteira é uma operação | `tabela` | `erp.input_entries` → `estoque.entrada_manual` |
| A tabela tem variantes | `tabela` + `discriminador` + `valor` | `erp.financial_titles` + `direction` + `payable` |

**Variante não se colapsa.** Conta a pagar e conta a receber têm efeito financeiro oposto; orçamento,
pedido e venda são etapas distintas; transferência entre armazéns e entre empresas diferem exatamente na
fronteira que o contrato multiempresa protege. Antes desta fatia, as duas primeiras viviam numa string só
("Conta a pagar / Conta a receber") — a forma mais silenciosa de perder uma distinção real.

O **valor do discriminador é o dado como o banco o persiste**, nunca traduzido: `payable`, `budget`,
`farm`. O `farm` da transferência é nome herdado do nicho anterior e sai por governança de dados, não por
renomeação de chave nossa — trocá-lo aqui mentiria sobre o que está gravado.

**Variante de operação ≠ variante de rota.** O título financeiro tem duas rotas e duas operações; a
transferência tem **uma** rota e **duas** operações. Os dois eixos coincidem às vezes, e tratá-los como um
só apagaria justamente o caso em que não coincidem. Por isso o dicionário declara `discriminador` (rota) e
`discriminadorTop` (operação) separadamente.

## 5. Relação com o Modelo Base 2

O Modelo Base 2 **apresenta** a TOP; ele não a resolve e não a conhece.

- A resolução acontece no **módulo dono da tela** (`apps/web/src/features/docs/stock-detail.tsx`), que
  chama `tipoOperacaoDoRegistro(tabela, registro)` e entrega ao shell **texto já pronto**.
- `Base2Shell` não recebe código de TOP, não recebe enum de TOP e não tem `if (top === …)`. Ele recebe um
  campo como qualquer outro. É o mesmo molde da empresa do registro, que também chega resolvida.
- **Tela unificada ≠ regra de negócio unificada.** A moldura mostra sete documentos com a mesma estrutura;
  isso não funde as sete regras, e a TOP não é a porta por onde elas seriam fundidas.
- Registro cuja TOP não resolve **não exibe o campo**. A tela cala em vez de afirmar a operação errada.

## 6. Relação com i18n

O registry guarda a **chave** de tradução (`chaveI18n`), derivada do código: `top.<codigo>`. O texto pt-BR
mora **só** no catálogo oficial.

Guardar um `rotulo` literal no registry criaria dois textos para o mesmo conceito, e o segundo envelheceria
em silêncio. Por isso a definição de TOP **não tem campo de rótulo** — e o gate do registry reprova uma TOP
cuja chave não exista no catálogo.

Consequências, todas exigidas por `docs/I18N-CONTRACT.md`:

- a chave canônica **não muda** com o idioma;
- tradução **nunca** é persistida;
- a tela resolve pelo tradutor oficial (`useTradutor()`), sem `switch` de rótulo e sem mapa literal.

## 7. Relação com o dicionário de dados

O dicionário **referencia**; ele não define. O campo `top` (ou `tops`, quando há variantes) passou a ser a
chave canônica, e o formato do dicionário subiu para a **versão 2** por isso — quem lia esperando uma frase
em português passa a receber `estoque.entrada_manual`.

Onde cada regra é cobrada:

| Regra | Onde reprova |
| --- | --- |
| Forma da chave (nada de texto livre) | validador do dicionário (`pnpm lint`) |
| `top` × `tops` mutuamente exclusivos; `tops` exige `discriminadorTop` e ≥ 2 variantes | validador do dicionário |
| Só entidade recebe TOP (linha e infraestrutura nunca) | validador do dicionário |
| A mesma TOP não classifica duas entidades | validador do dicionário |
| `discriminadorTop` é coluna existente da tabela | validador do dicionário (contra o schema real) |
| A chave **existe** no registry | teste de contrato (`packages/domain/test/tipo-operacao.test.ts`) |
| A TOP referenciada aponta de volta para a **mesma** tabela | teste de contrato |
| Integridade do registry (código, módulo, rótulo, origem, unicidade) | `validarRegistroTipoOperacao()` |

A separação tem motivo: o dicionário é `.mjs` sem build e roda no `lint`; o registry é TypeScript e é lido
pelo teste sem depender de `dist`. As duas metades rodam no mesmo job de CI.

O documento gerado (`docs/DATA-DICTIONARY.md`) mostra **chave + rótulo resolvido**, e nunca é editado à mão.

## 8. Autoridade das regras atuais

Nenhuma regra mudou de dono nesta fatia. Endpoint, serviço, permissão, validação, transação e efeito
continuam exatamente onde estavam, e a suíte inteira do repositório continua verde sem alteração de
contrato de API.

Se um dia uma regra precisar consultar a TOP, a consulta é **do serviço para o registry**, e o serviço
continua sendo quem decide. O registry nunca chama o serviço.

## 9. Evolução futura

O que **pode** vir, em fatia própria, com contrato e migration próprios:

- contratos **declarativos** de campos visíveis/obrigatórios por operação;
- contratos declarativos de efeito (estoque, financeiro, fiscal) — declarativos, lidos por motores que já
  existem, não um motor novo que passe a decidir;
- persistência da TOP em documentos novos, se houver necessidade real de consultá-la no banco;
- cobertura das entidades ainda não classificadas.

O que **não** vem por conveniência: motor genérico criado cedo demais vira acoplamento irreversível — é a
frase que `docs/PRE-BASE2-FOUNDATION.md` §4 já registrava antes de existir uma linha de TOP.

Hoje a cobertura é **parcial e deliberada**: entram os sete documentos do piloto Base 2 e as entidades que
o dicionário já classificava. Entidade que não se sabe classificar **não entra** — TOP inventada é pior que
ausência, porque a ausência se vê.

### `erp.invoices`: classificação NEUTRA, porque a TOP diz o que o registro É

`erp.invoices` guarda nove tipos de documento
(`check (document_type in ('nfe','cte','nfse','nfce','danfe','darf','dare','gru','other'))`), e nem todos
dão entrada de estoque: um DARF é guia de tributo, um CT-e é frete.

A BASE2-02 classificou a tabela, primeiro, como `estoque.entrada_por_documento_fiscal` — "Entrada por
documento fiscal". Isso descrevia o **efeito** dos tipos que dão entrada, e era falso para os demais.
Enquanto vivia na prosa do dicionário, ninguém lia; a partir desta fatia a **tela afirma** a
classificação, e afirmação falsa na tela é pior que ausência, porque a ausência se vê.

A classificação vigente é **neutra e verdadeira para a tabela inteira**:

| | |
|---|---|
| Código | `estoque.documento_fiscal` |
| Rótulo pt-BR | Documento fiscal |
| Origem | `erp.invoices` (sem discriminador — a tabela inteira é uma operação só) |

O vocabulário não é novo: a entidade já se chama **Documento Fiscal** no dicionário
(`ERP-ESTOQUE-DOCUMENTO-FISCAL`), **Documentos fiscais** na navegação e **Documento fiscal** no título
da tela de detalhe. A TOP passou a dizer o mesmo que o resto do produto já dizia.

**O que NÃO foi feito, e por quê.** Não existem nove TOPs derivadas das siglas: nomear nove operações a
partir de `nfe`, `darf`, `gru` seria inventar classificação onde há apenas um código fiscal, e o §9 deste
contrato proíbe. Também não existe mapa de efeito por `document_type` — isso seria a TOP decidindo o que
o lançamento FAZ, que é a fronteira que este contrato inteiro protege.

Se algum dia essas nove passarem a ser operações distintas de verdade, isso vem de decisão de produto,
com nomes funcionais próprios, e não da leitura do `check` do schema.

Travado pelos casos 27-29 do teste de contrato: `nfe` e `darf` resolvem para a **mesma** TOP; o código
não pode voltar a afirmar entrada; e nenhuma sigla vira TOP.

### Numeração de transferência — defeito CORRIGIDO pelo hotfix da 0019

Esta seção era uma dívida declarada da BASE2-02 e virou registro histórico. O defeito existia, foi
descrito aqui sem nunca ter sido exigido por teste, e foi corrigido em fatia própria.

**O que era.** `POST /api/stock/transfers` numerava com **dois contadores independentes**
(`warehouse_transfer` e `farm_transfer`, via `nextCode`) para **uma** tabela com
`unique (organization_id, code)` (`supabase/migrations/0003_stock_supply.sql`). A primeira transferência
de cada variante numa organização recebia o mesmo código `0001`, e a segunda era recusada com
`409 CONFLICT`. Ficou invisível porque nenhum teste do repositório criava as duas variantes na mesma
organização — o E2E das sete rotas da BASE2-02 foi o primeiro a tentar.

**O que corrigiu.** O hotfix PRÉ-BASE2-03: `supabase/migrations/0019_warehouse_transfer_code_sequence.sql`
reconcilia os dois contadores num só e faz `erp.next_code` canonicalizar `farm_transfer` para
`warehouse_transfer`; `apps/api/src/lib/sequencia-warehouse-transfer.ts` passa a ser a chave única do
runtime. O princípio que o explica — **a sequência acompanha o namespace de unicidade da tabela, nunca a
variante funcional** — está travado por `scripts/sequencia-namespace-audit.mjs` no `pnpm lint`.

**O que a classificação tem a ver com isso: nada, e é esse o ponto.** A TOP continua com DUAS operações
(`estoque.transferencia_entre_armazens` e `estoque.transferencia_entre_empresas`) para a mesma tabela.
Unificar a NUMERAÇÃO não unificou a OPERAÇÃO: classificar e numerar são eixos diferentes, e o hotfix não
tocou no primeiro.

**E nunca foi comportamento esperado.** Uma versão anterior da BASE2-02 chegou a fazer o E2E EXIGIR a
recusa 409 pelo nome da constraint, para "registrar o bloqueio". Isso estava errado e foi removido: um
teste que exige o defeito transforma bug em contrato, faz a suíte verde significar "o bug está lá, como
combinado", e entrega ao próximo o dia da correção na forma de "teste quebrado". Foi exatamente por não
ter feito isso que a correção chegou como um teste que **passou a poder ser escrito**.
`scripts/regressao-invertida-audit.mjs` roda no `pnpm lint` e impede a reincidência.

**Cobertura da variante `farm` hoje — o PENDING está FECHADO.** Além do teste de contrato do registry
(`kind:"farm"` → `estoque.transferencia_entre_empresas`), que nunca dependeu do caminho de escrita:

| Prova | Onde |
| --- | --- |
| UI: as DUAS variantes na mesma organização, cada tela afirmando a SUA operação | `apps/web/e2e/base2-moldura.spec.ts` (E2E das sete rotas) |
| API: 201 nas duas, códigos distintos, ordem inversa, dois tenants, concorrência, idempotência | `apps/api/test/integration/transferencia-numeracao.test.ts` |
| Banco: reconciliação, alias e matriz de estados da 0019 | `packages/db/test/hotfix-0019-upgrade.test.ts` |
| Version skew: BASE × pós-0019, rolling deploy e rollback de binário | `pnpm gate:0019` |

### Outras dívidas declaradas

- **A prop `entidade` das telas não é cruzada com o registry por nenhum gate.** Um erro de digitação faz o
  campo sumir (fail-closed) em vez de estourar; hoje quem pega é o E2E das sete rotas. Um auditor estático
  comparando os literais de `entidade` com as origens declaradas fecharia isso.
- **O gerador do dicionário depende do `dist` de `@erp/plataforma`** para resolver o rótulo. No CI o build
  precede o lint; local sem build, o gate falha com instrução em vez de omitir a coluna.
- **Dos onze rótulos de campo do piloto de estoque, só o de Tipo de operação é traduzido.** Os outros dez
  são literais anteriores a esta fatia. O campo novo está certo; os vizinhos são dívida de i18n.

## 10. Anti-padrões

| Anti-padrão | Por que é proibido |
| --- | --- |
| `switch (top)` decidindo efeito, imposto ou lançamento contábil | é o posting engine entrando pela porta dos fundos |
| Campo `handler`, `endpoint`, `service`, `efeitos` ou `permissao` na definição | a definição passa a executar; o teste de contrato reprova |
| Usar o rótulo como chave | rótulo muda com revisão de texto e com idioma |
| Fallback para a TOP vizinha, ou para a primeira variante | a tela afirmaria com confiança uma operação que não é a do registro |
| Derivar a TOP da rota, do título, da permissão ou do endpoint | é inferir classificação de apresentação; `.claude/rules/security.md` já proíbe o equivalente para módulo |
| Heurística por `includes`, prefixo ou nome parecido | classificação tem de ser declarada, não adivinhada |
| Segunda lista de TOPs (no web, na API, num `.mjs` paralelo) | a segunda lista não fica desatualizada com barulho: envelhece em silêncio |
| TOP em linha de item, em infraestrutura ou em movimento de ledger | não são lançamentos; movimento é consequência de um |
| Colapsar variantes numa TOP só | apaga uma distinção funcional real |
| TOP autorizando ou escondendo algo | autorização é capacidade × escopo, e não passa por aqui |
