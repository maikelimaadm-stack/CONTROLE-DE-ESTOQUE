# Contrato do Tipo de Operação (TOP)

> Contrato de produto (BASE2-02, estendido pela TOP-CONFIG-01, 02, 03 e 04A).
> Registry das FAMÍLIAS CANÔNICAS: `packages/domain/src/tipo-operacao.ts`.
> Camada CONFIGURÁVEL: `erp.tipos_operacao` + `packages/domain/src/tipo-operacao-configurado.ts`.
> Rótulos: `packages/plataforma/src/idiomas/pt-BR.ts` (`top.*`).
> Referências: `packages/domain/dicionario-dados.mjs` (campos `top` / `tops` / `discriminadorTop`).
> Gates: `packages/domain/test/tipo-operacao.test.ts`, `node scripts/data-dictionary.mjs --check` e
> `node scripts/familia-operacional-ssot-audit.mjs` (proíbe segunda lista das famílias).
> Execução configurada (TOP-CONFIG-04A, §12): `packages/domain/src/tipo-operacao-execucao.ts` (matriz de
> suporte e política efetiva da venda), `supabase/migrations/0023_venda_execucao_configurada_guarda.sql`,
> `packages/domain/test/tipo-operacao-execucao.test.ts`, `apps/api/test/integration/sales-top-execucao.test.ts`.

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
| Executa efeito? | **não** | **não por si.** Desde a TOP-CONFIG-04A, a VERSÃO congelada de um documento pode declarar que o estoque e/ou o financeiro da confirmação de `vendas.venda` seguem a configuração dela (§12); quem executa continua sendo o serviço de vendas |

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
- **PUT RECUSA `tipo_operacao_id: null`, com 422.** Não existe caminho de edição que transforme um
  documento COM TOP em documento legado: "sem TOP" é estado de NASCIMENTO (acervo, cliente anterior à
  fatia), não destino alcançável por edição. Apagar a identidade de um lançamento já classificado
  reescreveria história pela porta da edição — o que o snapshot existe para impedir.
  A primeira versão desta fatia PRESERVAVA em silêncio: o cliente pedia a remoção, recebia 200, e nada
  mudava. Descarte silencioso de campo é ampliação de escopo pela porta de trás, e sobre a identidade do
  lançamento é especialmente caro, porque ninguém confere o efeito depois. A distinção entre `null`
  explícito e campo AUSENTE é feita no corpo CRU, antes do `z.object` (que entrega `undefined` para os
  dois). O campo AUSENTE continua sendo compatibilidade legítima e não muda nada, e na CRIAÇÃO `null`
  segue legítimo — é o que sustenta o rolling deploy.
- **Conversão escolhe a TOP do DESTINO.** A da fonte é de outra família e nunca é herdada; um cliente antigo
  que converte sem informá-la produz destino legado, e não um documento com TOP da família errada.
- **A porta de escolha é OPERACIONAL, não administrativa.** Quem pode lançar vê as TOPs ativas da família;
  `tipos_operacao.*` continua sendo a capacidade de CONFIGURAR. São perguntas diferentes.
- **Obrigatoriedade é de UX, não do banco.** As colunas são NULLABLE nesta fase — por acervo e por rolling
  deploy. Torná-las obrigatórias é fatia futura, com backfill consciente e sem cliente legado vivo.
- **Consequência operacional, e ela tem hora marcada:** como a obrigatoriedade é de UX e NENHUMA TOP nasce
  pronta (a 0020 não insere nenhuma e o seed não cria nenhuma), toda organização existente tem zero TOPs no
  instante do deploy — e a tela de lançamento de vendas fica bloqueada até alguém cadastrar uma TOP ativa
  para `vendas.orcamento`, `vendas.pedido` e `vendas.venda`. A API continua aceitando (o documento nasce
  legado), então não há perda de dado; há perda de OPERAÇÃO pela interface. Por isso o cadastro dessas três
  TOPs é pré-requisito NUMERADO de implantação em `docs/DEPLOYMENT.md`, e não uma recomendação.

### 0.3 A TOP é escolhida ANTES do formulário (TOP-CONFIG-02B)

Em Vendas, `/vendas/<variante>/new` NÃO abre mais o formulário direto. A rota é a mesma — favoritos,
Portal e permissões continuam valendo —, mas ela mostra a **etapa de escolha do Tipo de Operação**
enquanto não houver operação definida:

| URL | O que a tela mostra |
| --- | --- |
| `/vendas/<variante>/new` | o LANÇADOR. O formulário não existe na árvore. |
| `…?tipo_operacao_id=<uuid>` confirmado pela lista | o FORMULÁRIO, já contextualizado |
| `…?tipo_operacao_id=<uuid>` que a lista recusa | o LANÇADOR + "não está disponível". ZERO POST. |

**Por quê.** A TOP não é um atributo do lançamento: é a identidade operacional que contextualiza o
documento inteiro e que, a partir da TOP-CONFIG-04A, pode decidir os efeitos de estoque e financeiro da
venda (§12) — fiscal continua só declarado.
Um dado que muda o significado de todos os outros não pode ser preenchido no meio deles.

**`tipo_operacao_id` na URL é PEDIDO, nunca autoridade.** Ele existe para que refresh, Voltar/Avançar e um
link compartilhado continuem funcionando. Quem decide é a lista que o SERVIDOR devolveu para AQUELA
variante: o UUID só vale se estiver em `items`. Pertencer à lista prova de uma vez existência, tenant,
atividade, não-exclusão e FAMÍLIA — e é por isso que não há (nem deve haver) validação de formato de uuid
no cliente fazendo as vezes de autorização.

**Superfície de recusa única.** Inexistente, de outro tenant, inativa, excluída, de outra família e id
malformado caem todos na MESMA frase. Distinguir transformaria a tela num oráculo de quais UUIDs existem
na organização (`.claude/rules/security.md`).

**O padrão não pula a etapa — e só o cadastro define padrão.** (Vale em TODO o produto, lançamento e
conversão: `usePadraoTop` também não deduz padrão da cardinalidade.) Havendo `defaultId`, ele vem
pré-selecionado e marcado, e o lançador continua na tela; auto-avançar gravaria uma identidade
operacional que ninguém viu. Sem `defaultId`, NADA vem marcado — **nem quando a família tem uma TOP
só**. "Única opção disponível" e "operação padrão" são conceitos distintos: o padrão é decisão do
cadastro (`padrao` no banco), e deduzi-lo da cardinalidade da lista criaria uma segunda semântica de
padrão no cliente, que sumiria sozinha no dia em que a família ganhasse a segunda TOP.

**O RASCUNHO é preservado; a AUTORIZAÇÃO DE ESCRITA, não.** São duas perguntas, e confundi-las é o que
transforma uma proteção em buraco:

| Pergunta | Quem responde |
| --- | --- |
| O formulário continua montado? | a TOP atual **ou** a que esta sessão já validou (trava de `kind:pedido`) |
| O `Salvar` pode emitir POST? | **só** o estado ATUAL da descoberta: `pronto` **e** a TOP na lista de agora |

Uma vez que a TOP passou pela validação e o formulário montou, uma revalidação não o desmonta — o
documento em digitação não pode desaparecer porque uma consulta em segundo plano mudou de resposta. Mas
a escrita fecha no mesmo instante em que a descoberta deixa de confirmar a operação. Isso vale para os
três modos: servidor **não confirmado** (500/404/contrato futuro), **erro explicado**, e **TOP que saiu
da lista** num servidor compatível — este último com mensagem própria, porque não é falha de servidor
nem configuração ausente. Em nenhum deles a tela troca sozinha para outra TOP.

Por que a escrita não pode continuar aberta: num rolling deploy o formulário abre contra a API nova e a
revalidação seguinte pode cair na ANTIGA, que é justamente a que ignora `tipo_operacao_id` em silêncio.
Contar com o 422 ali seria confiar no servidor NOVO para julgar um POST que talvez chegue no ANTIGO.

A trava só é escrita a partir de uma validação real — nunca do texto da URL —, então o deep link
adulterado continua caindo no lançador. Trocar de operação ou sair do pedido zera a trava; o F5 também,
e a montagem refaz a descoberta. Quando a capability volta, o `Salvar` reabre sem remontar o formulário
e sem perder o que foi digitado.

**E a corrida continua sendo do servidor.** Se a TOP for desativada DEPOIS da última validação do
cliente, ele ainda a considera válida, o POST sai e recebe 422 `TIPO_OPERACAO_INDISPONIVEL`. As duas
camadas existem porque nenhuma substitui a outra: o cliente não grava quando JÁ SABE que não pode, e o
servidor recusa o que o cliente não tinha como saber.

**O histórico do navegador não é o seletor de etapa.** `Continuar` usa `replace`: lançador e formulário
são duas caras da mesma etapa de criação, não dois lugares. Voltar SAI da criação, e é assim de
propósito — `useDirtyTab` protege fechar aba, trocar de empresa e sair da página, mas NÃO intercepta
`popstate`; com `push`, o Voltar desmontaria um formulário preenchido sem perguntar nada. A porta de
retorno da etapa é o botão "Alterar operação", que confirma antes de descartar. Back-como-etapa depende
de uma guarda transversal de dirty state que o produto ainda não tem.

**A CONVERSÃO continua por campo.** Orçamento → Pedido → Venda escolhe a TOP do destino num diálogo, e
ali `CampoTipoOperacao` permanece: a escolha é parte de uma ação pontual, não uma etapa de criação.

### O rótulo de cada camada — e a ambiguidade que a TOP-CONFIG-02 abriu

As duas camadas coexistem na mesma tela, então precisam de nomes distintos. A regra, a partir daqui:

| Camada | Rótulo na tela | De onde sai |
|---|---|---|
| FAMÍLIA canônica (código do produto) | **Família operacional** | `packages/domain` — derivada do discriminador do registro |
| TOP configurada (dado da organização) | **Tipo de Operação** (`termos.tipo_operacao`) | `erp.tipos_operacao` + versão do snapshot |

**Dívida declarada, e ela é de vocabulário, não de contrato.** Hoje só o detalhe de venda segue esta
tabela. As outras três telas que exibem a família — solicitação de compra
(`apps/web/src/app/(app)/suprimentos/view/[id]/page.tsx`), títulos financeiros
(`apps/web/src/features/financial/titles.tsx`) e documentos de estoque
(`apps/web/src/features/docs/stock-detail.tsx`) — ainda a rotulam "Tipo de operação", porque nenhuma
delas grava TOP configurada e portanto não há o que confundir DENTRO de cada uma. A ambiguidade existe
entre telas irmãs, e some sozinha quando cada portal ganhar a sua fatia de TOP: a que gravar snapshot
renomeia a família junto. Renomear as três agora seria mudar tela que esta fatia não toca, e sem o
segundo campo a renomeação não teria nem motivo visível ao usuário.

**CLASSIFICAR ≠ EXECUTAR permanece.** Escolher a TOP não mudou efeito de estoque, financeiro, fiscal,
status ou permissão: confirmar uma venda faz exatamente o que fazia. A TOP é a identidade configurada do
lançamento; efeitos configuráveis vieram depois, com contrato de cutover próprio (TOP-CONFIG-04A, §12), e
nada nesta fatia os antecipou.

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

**CLASSIFICAR ≠ EXECUTAR.** Esta é a regra central. Ela tem UMA exceção, explícita e estreita, desde a
TOP-CONFIG-04A (§12): a versão congelada de uma venda pode entregar o estoque e/ou o financeiro da
confirmação à configuração dela — e mesmo aí a TOP diz a POLÍTICA; quem executa é `confirmSale`
(`apps/api/src/routes/sales.ts`), com as mesmas primitivas de sempre (`postStock` em
`apps/api/src/services/stock-core.ts`, `createTitles` em `apps/api/src/services/financial-core.ts`). Fora
dessa exceção, a tabela abaixo vale sem ressalva.

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
| Decidir política de próximas operações pela CARDINALIDADE (`destinos.length`, `items.length`) | zero arestas tem duas origens opostas — nunca declarada e declarada vazia — e a contagem responde as duas com o mesmo número (§11.7) |
| Cobrar a capacidade de um destino FIXO antes de saber qual destino o grafo escolheu | soma uma exigência irrelevante à do destino real e recusa quem pode; a permissão acompanha o destino efetivo (§11.7) |
| Marcar `destinos_configurados = true` por automação, backfill ou job | é inventar uma decisão que ninguém tomou, e a decisão inventada recusa conversões (§11.7) |
| Ler as seções de uma versão do FORMATO 1 como decisão de execução | o formato 1 foi gravado quando nada executava; é legado para sempre (§12.1) |
| Deduzir execução da família, do tipo de documento ou de `atualizacao != nenhuma` | só o bloco `execucao` do formato 2 decide, efeito a efeito (§12.1) |
| Confirmar pelo legado quando a versão declara execução configurada e ela não pode ser executada | é o fallback silencioso que o gate e a guarda da 0023 existem para impedir: a resposta é recusa (§12.4) |
| Ler `tipos_operacao.versao_atual` na confirmação | a autoridade é a versão CONGELADA do documento (§12.2) |
| Ativar uma combinação que o runtime não executa, e ignorar parte dela | a matriz recusa na ativação, com caminho e motivo (§12.3) |
| Matriz de suporte no cliente, ou `if (codigo === ...)` decidindo execução | a matriz tem um dono no domínio e o servidor a publica (§12.3, §12.6) |

## 11. Configuração operacional versionada (TOP-CONFIG-03)

> Contrato tipado: `packages/domain/src/tipo-operacao-configuracao.ts`.
> Grafo de próximas operações: `packages/domain/src/tipo-operacao-destinos.ts`.
> Schema: `supabase/migrations/0022_tipo_operacao_configuracao_versionada.sql`.
> Borda de escrita e leitura: `apps/api/src/routes/tipos-operacao.ts`.
> Consumo operacional (próximos passos e conversão): `apps/api/src/routes/sales.ts`.

### 11.1 O que a TOP passou a DECLARAR — cinco seções, e nada mais

A versão da TOP guarda, além de nome e descrição, uma **configuração operacional** com exatamente cinco
seções, na ordem em que a tela as mostra (`SECOES_CONFIGURACAO_TOP`):

| Seção | O que declara |
| --- | --- |
| `geral` | quem dispara a confirmação, se o documento pode ser alterado depois de confirmado, se documento sem itens é aceitável, e as exigências de parceiro, centro de resultado e observação |
| `estoque` | o sentido da atualização (`nenhuma`/`entrada`/`saida`/`transferencia`), o momento pretendido, se exige armazém e o que fazer com saldo negativo |
| `financeiro` | o sentido (`nenhuma`/`receber`/`pagar`), se o título é firme ou provisionado, o momento, e as exigências de forma de pagamento, vencimento e centro de resultado |
| `fiscal` | se a operação é relevante para o fiscal, e as exigências de documento fiscal, natureza de operação e regra tributária, mais a intenção de cálculo tributário |
| `aprovacao` | se há aprovação (`nenhuma`/`sempre`/`por_valor`), o limite monetário e o momento em que ela trava |

A configuração é **estrita, serializável e declarativa**. Ela é composta apenas de booleanos, enums
fechados em português e um valor monetário em string decimal. **Não existe — e não é omissão, é
decisão — campo que aceite função, SQL, JavaScript, expressão, fórmula, callback, DSL ou permissão
embutida.** Um campo que aceita expressão transforma cadastro em programação: passaria a exigir sandbox,
versionamento de linguagem, depurador e auditoria de execução, e o "administrador" viraria alguém capaz
de derrubar o ERP com uma vírgula. Enum fechado e booleano são a fronteira que mantém isto configurável
por gente de negócio. Permissão também não entra: autorização é CAPACIDADE ∧ ESCOPO, e uma capacidade
declarada aqui viraria um segundo caminho — que acabaria valendo por OR, pela ponta mais frouxa.

Entrada não canônica é **recusada**, nunca traduzida nem descartada. Chave desconhecida em qualquer
seção produz `campo_desconhecido` com o `caminho` do problema; valor fora do enum produz
`valor_invalido`; tipo errado produz `tipo_invalido`. `exigeArmazen` com erro de digitação não é
ignorado em silêncio: sem isso, o administrador leria "salvo" sobre uma configuração que não foi salva.
O `caminho` de cada recusa nomeia a FORMA do payload, nunca dado de outra organização.

Dois enums têm **um único valor** (`momento` do efeito e `momento` da aprovação), e isso diz exatamente
o que o produto contempla hoje. Oferecer valores que nada consumiria faria o administrador escolher
acreditando ter mudado alguma coisa.

Duas normalizações moram no domínio, não na tela (`normalizarConfiguracaoTop`): seção desligada volta ao
neutro, e `valorMinimo` é zerado quando a política não é `por_valor`. Na tela isso seria apresentação —
some com um `curl`. No domínio, é o que torna a comparação semântica confiável e impede que duas
configurações idênticas no significado tenham bytes diferentes.

### 11.2 `versaoSchema` viaja com o payload

Toda configuração carrega `versaoSchema`, e a coluna `configuracao_schema_version` guarda o mesmo número
ao lado — um check da 0022 recusa que as duas afirmações discordem.

A leitura **confere o schema ANTES de qualquer campo**. Payload de outra versão é RECUSADO
(`schema_nao_suportado` na escrita; `TIPO_OPERACAO_CONFIGURACAO_SCHEMA_NAO_SUPORTADO` na API), nunca
reinterpretado. Ler um payload com o dicionário errado é como decodificar bytes na codificação errada:
não dá erro, dá significado trocado.

**Desde a TOP-CONFIG-04A existem DOIS formatos legíveis** (`VERSOES_SCHEMA_CONFIGURACAO_TOP = [1, 2]`). O
formato 2 são as mesmas cinco seções mais o bloco `execucao` (§12.1), e ele o EXIGE — um "2" sem
`execucao` é recusado, não lido como formato 1. Qualquer outro número continua recusado com uma recusa
só. `VERSAO_SCHEMA_CONFIGURACAO_TOP` continua valendo 1: é o formato do neutro e do `DEFAULT` da 0022, e é
o número que o cliente anterior compara nas capacidades.

Os dois lados dessa regra têm comportamentos diferentes, de propósito:

- **LEITURA do histórico nunca cai.** Uma versão ilegível vira estado declarado
  (`configuracao: { suportada: false, versaoSchema }`), e a tela pode dizer "registrada num formato que
  esta versão não interpreta" em vez de inventar valores. Quem investiga um documento de dois anos atrás
  não pode receber tela branca porque UMA das versões não é legível.
- **ESCRITA fecha.** Editar uma TOP cuja configuração vigente é ilegível é recusado: gravar por cima
  transformaria uma configuração que não se sabe ler numa que se acabou de inventar.

### 11.3 O neutro tem UM dono

`configuracaoNeutraTop()` é o único lugar do código que sabe qual é o neutro: tudo desligado, nada
exigido, nenhum efeito declarado. É função e não constante exportada — uma constante compartilhada é um
objeto único que qualquer consumidor pode mutar sem querer.

A migration precisa de um literal SQL equivalente, porque SQL não importa TypeScript. Essa cópia
inevitável é um **espelho verificado**: `packages/domain/test/tipo-operacao-configuracao.test.ts` lê o
arquivo da 0022, extrai o `DEFAULT` da coluna, passa pelo parser do domínio e compara com a função — e
confere também que a versão de schema declarada no SQL é a mesma. Divergir reprova o gate em vez de
envelhecer em silêncio.

O acervo recebeu o neutro, e essa é a única leitura honesta: o efeito dos documentos antigos veio do
CÓDIGO da época, não de configuração — que não existia. Deduzir "esta TOP de venda certamente baixava
estoque" atribuiria a documentos antigos uma intenção que ninguém declarou.

### 11.4 Versionamento: o que gera versão e o que não gera

| O que muda | Gera versão N+1? |
| --- | --- |
| nome, descrição | sim — é CONTEÚDO |
| configuração operacional | sim — é a REGRA que explica o efeito |
| lista de próximas operações | sim — é política, pela mesma razão |
| declarar a política pela PRIMEIRA vez, ainda que vazia | sim — sair de "ninguém decidiu" para "decidido" é conteúdo (§11.7) |
| `ativo` / `padrao` | **não** — é ESTADO; não muda o que a TOP É |
| nada (reenviar o formulário igual) | **não** — no-op não escreve nada |

Nome, descrição e configuração viajam na MESMA versão: uma edição que mexe nos três gera UMA N+1, não
três. Versão por aba faria o histórico contar uma sequência de eventos que nunca existiu.

**No-op real não gera nada.** A comparação é semântica: a configuração é normalizada e serializada em
ordem canônica de chaves antes de comparar, e a lista de destinos é comparada como sequência
normalizada. Sem isso, salvar sem mexer em nada criaria versão só porque o cliente montou o objeto em
outra ordem. Um `PUT` cujo conteúdo e estado coincidem com os atuais devolve o estado corrente sem
gravar, sem incrementar `revisao` e sem auditar — porque `revisao` é a moeda do controle de
concorrência, e gastá-la à toa manda 409 para toda outra aba aberta por uma mudança que não existiu.

A comparação das próximas operações **não é só a lista**. Uma versão legada com zero arestas que
recebe `destinos: []` tem, antes e depois, exatamente as mesmas arestas — nenhuma —, e comparar só a
lista descartaria a edição como no-op, respondendo "salvo" sobre uma política que continuaria NÃO
DECLARADA. A transição de `destinos_configurados` de `false` para `true` entra na comparação por isso,
e é o §11.7 que explica o estado inteiro.

**`revisao` protege lost update.** O `PUT` exige a revisão conhecida pelo cliente e a linha é lida sob
`for update`: o lock resolve simultaneidade, a revisão resolve a aba aberta há dez minutos. Revisão
velha é `409 CONCURRENCY_CONFLICT`.

A auditoria da edição registra **quais seções mudaram** (`secoesAlteradasTop`), não o payload inteiro:
despejar a configuração completa faria do log uma segunda cópia que envelhece em silêncio e diverge da
versão, que é a verdade. No histórico, `secoesAlteradas` é DERIVADA da comparação com a versão anterior,
nunca gravada em coluna; quando uma das duas versões é ilegível, o valor é `null` — que diz "não dá para
saber", diferente de `[]`, que afirmaria "nada mudou".

### 11.5 O grafo de próximas operações

Uma versão da TOP declara para quais TOPs um documento dela pode ser convertido. As arestas moram em
`erp.tipos_operacao_versao_destinos`.

**Por que tabela, e não uma lista dentro do JSON.** O payload de configuração é um documento: o banco
confere que é objeto e nada mais. Uma lista de UUIDs ali dentro seria ponteiro sem integridade —
apontaria para TOP inexistente, de OUTRA ORGANIZAÇÃO ou já apagada, e nada no banco reclamaria. Como
tabela, cada aresta ganha duas chaves estrangeiras **compostas com o tenant**, e o estado impossível
deixa de ser representável. As FKs não cascateiam: apagar configuração não pode apagar em silêncio a
política que explica conversões já feitas. A aresta é tão imutável quanto a versão que a ancora — gatilho
`trg_tipos_operacao_versao_destinos_imutavel` mais revogação explícita de `update`/`delete`, e RLS
habilitada, forçada e com política ÚNICA.

**A aresta pendura na VERSÃO da origem; o destino é identidade ESTÁVEL.** Essa assimetria é o desenho
inteiro, e separa duas perguntas que não podem ter a mesma resposta:

| Pergunta | Fonte | Natureza |
| --- | --- | --- |
| *que política valia?* | a versão que o documento cita | congelada — é história |
| *o destino serve agora?* | a TOP de destino, no estado de hoje (`ativo and excluido_em is null`) | avaliada na ação — é presente |

Um orçamento emitido sob a versão 3 continua oferecendo os destinos que a versão 3 declarava, mesmo
depois de a TOP ganhar a versão 4. Ler a política do cadastro atual faria a edição de hoje mudar
retroativamente o que um documento de ontem podia virar; congelar a VERSÃO do destino faria o documento
novo nascer sob uma regra que o administrador já corrigiu. Por isso a aresta nunca deixa de existir, mas
uma TOP desativada some do leque sem alterar a versão da origem: a conversão que já aconteceu continua
explicável. Na administração, a distinção aparece como `disponivel` ao lado de cada destino — a aresta é
história, a disponibilidade é hoje.

Quando a versão N+1 nasce, as arestas são **copiadas** para ela mesmo sem mudança — e o marcador
`destinos_configurados` viaja junto (§11.7): a versão nova precisa declarar a política inteira dela,
senão o histórico deixaria de ser autossuficiente.

**A compatibilidade de família é DERIVADA do registry**, não uma lista. `validarDestinoOperacao` aplica
duas regras, e as duas se resolvem perguntando ao registry qual variante de `erp.sales_documents` cada
família é:

1. **as duas pontas precisam ser executáveis** — configurar destino de uma família que o produto não sabe
   criar seria configurar um botão sem serviço atrás; a configuração passaria, e a falha apareceria no
   primeiro clique do operador;
2. **destino não pode ser da MESMA família da origem** — "deste pedido gere outro pedido" não é
   conversão, é cópia de documento: outra funcionalidade, com outras perguntas, que esta fatia não
   implementa.

O que **não** existe, deliberadamente: nenhuma ordem obrigatória entre famílias. Orçamento pode apontar
direto para venda, pulando o pedido, porque isso é decisão da organização — e era exatamente o que a
cadeia fixa no código impedia.

O banco recusa, por check, o **laço sobre a própria TOP** (`destino_tipo_operacao_id <>
origem_tipo_operacao_id`): é o único caso de ciclo sempre absurdo. Ciclos mais longos entre TOPs
diferentes não são barrados, porque podem ser legítimos.

**A superfície de recusa é única.** Destino inexistente, de outro tenant, inativo, excluído ou de família
incompatível respondem a MESMA recusa `TIPO_OPERACAO_INDISPONIVEL`, com a mesma mensagem. Distinguir
transformaria o editor num oráculo: quem tentasse UUIDs saberia quais existem na organização vizinha e de
que família cada um é. A forma da LISTA (chave desconhecida, id malformado, ordem inválida, duplicata,
teto excedido) tem código próprio, `TIPO_OPERACAO_DESTINO_INVALIDO`, porque descreve o que o cliente
enviou e não revela nada sobre o acervo. O teto é `LIMITE_DESTINOS_POR_VERSAO` (20), sanidade e não regra
de negócio.

Quem monta a lista de destinos possíveis é o **servidor**
(`GET /api/admin/tipos-operacao/destinos-possiveis?codigoBase=…`), com a MESMA função que a escrita usa.
Filtrar no cliente exigiria uma cópia da regra — a segunda lista que o contrato proíbe — e ela divergiria
na primeira família nova, oferecendo um destino que a escrita vai recusar. Família de origem desconhecida
devolve lista VAZIA, nunca "todas".

### 11.6 Capability e version skew

`GET /api/admin/tipos-operacao/capabilities` (capacidade exigida: `tipos_operacao.view` — perguntar o que
a API sabe fazer não é configurar) devolve:

- `contractVersion`;
- `configuracao`: `{ versaoSchema, secoes }`;
- `destinos`: `{ suportado, limite }` — bloco próprio, e não uma seção da configuração, porque o grafo
  não mora no payload: mora em tabela;
- `execucao` (TOP-CONFIG-04A): `{ suportado, versaoSchema: 2, runtimeHabilitado, matriz }` — bloco
  OPCIONAL, pelo mesmo precedente de `destinos`. `contractVersion` e `configuracao.versaoSchema` NÃO
  mudaram: o cliente anterior compara os dois e, se mudassem, travaria a edição de toda TOP durante a
  implantação. Ausente = servidor sem execução configurada (o cliente novo grava no formato 1);
  presente e malformado = contrato desconhecido, e o corpo inteiro é recusado pelo cliente.

Existe um endpoint em vez de um `try/catch` porque **deduzir capacidade pela falha é adivinhação**: 422
também é o que se recebe por payload inválido, e 404 é o que se recebe de rota protegida. Os dois
sentidos do skew são:

- **web NOVA × API ANTIGA** (durante o rolling deploy): a rota de capacidade não existe, e o cliente não
  deve escrever `configuracao` nem `destinos` — a API antiga valida com `.strict()` e responderia 422,
  fazendo o editor inteiro parecer quebrado;
- **web ANTIGA × API NOVA**: os campos são OPCIONAIS nas duas escritas. Ausente na criação significa
  "quem chamou não declarou nada" e grava o NEUTRO; ausente na edição significa **preservar** — ler a
  ausência como "zerar" apagaria configuração e destruiria transições que ninguém pediu para destruir. O
  `DEFAULT` da coluna, que permanece depois da migration, é o que faz o INSERT do binário antigo
  continuar funcionando.

`contractVersion` distingue as três situações que o cliente precisa separar: rota AUSENTE, rota presente
com contrato CONHECIDO e rota presente com contrato FUTURO. Sem ela, as duas últimas seriam
indistinguíveis — e um 200 de formato desconhecido é o modo de falha mais perigoso, porque parece
sucesso.

### 11.7 Ausência ≠ vazio: o marcador `destinos_configurados` e a ponte da conversão

#### O defeito que esta seção corrige

A redação anterior desta seção descrevia a ponte por **cardinalidade**: "a versão *tem* destinos" contra
"a versão *não tem* destino nenhum". Era a descrição fiel do código, e o código estava errado —
`apps/api/src/routes/sales.ts` decidia com `passos.length > 0`.

Zero arestas tem **duas** origens, e elas pedem comportamentos **opostos**:

| O que aconteceu de verdade | O que a conversão precisa fazer |
| --- | --- |
| ninguém **nunca** declarou política para esta versão (acervo, compatibilidade) | seguir a cadeia anterior, ou toda conversão de toda organização quebra no deploy |
| alguém declarou, **e declarou que não há próxima operação** | **recusar** a conversão — recusar foi exatamente o que o administrador configurou |

Contar arestas responde as duas com o mesmo zero. O efeito prático não era teórico: o administrador que
declarasse "esta operação não tem próximo passo" via a **web obedecer** — a tela não oferecia conversão —
e uma **chamada direta à API de conversão** cair na cadeia antiga e converter assim mesmo. A regra
administrativa existia na tela e não existia no servidor, que é onde ela precisa existir.

#### O marcador vive na VERSÃO

```
erp.tipos_operacao_versoes.destinos_configurados  boolean not null default false
```

| Valor | Significado | Efeito na conversão |
| --- | --- | --- |
| `false` | a política de próximas operações **nunca** foi declarada por cliente compatível com o grafo. É o estado **legado / de compatibilidade** | a ponte da cadeia antiga vale — **e só aqui** |
| `true` | a política foi declarada explicitamente | **zero arestas ⇒ zero próximos passos** (conversão recusada, sem cair na ponte); **uma ou mais arestas ⇒ exatamente esses destinos** |

**Por que na VERSÃO, e não no pai.** Pela mesma razão que põe a configuração e as arestas lá: isto é
política **histórica**. Um documento emitido sob a versão 3 continua explicado pelo que a versão 3
declarava — inclusive por "a versão 3 não declarava nada". Se o marcador morasse em
`erp.tipos_operacao`, declarar a política hoje reescreveria retroativamente a explicação de toda
conversão já feita, e a auditoria de um documento de ontem passaria a afirmar uma decisão que, naquele
dia, ninguém tinha tomado.

**Ele herda a imutabilidade da versão, e por isso a 0022 não cria gatilho nenhum para ele.**
`trg_tipos_operacao_versoes_imutavel` (0020) já recusa `update` e `delete` sobre a tabela **inteira**; um
segundo gatilho seria uma segunda verdade sobre a mesma regra. Declarar política é, como mudar nome ou
configuração, **criar a versão N+1** — nunca corrigir a linha que está lá.

**O `DEFAULT false` preenche o acervo e permanece depois da migration.** O backfill não podia ser
`UPDATE` (o gatilho de imutabilidade o recusaria, e desligá-lo por conveniência de migration seria abrir
justamente a porta que ele existe para trancar); `ADD COLUMN … DEFAULT` é DDL e preenche sem `UPDATE`. O
default **fica** porque o binário ANTIGO insere versão sem citar a coluna: sem ele, o `INSERT` falharia
por `NOT NULL` e a criação de TOP quebraria no meio do rolling deploy. E `false` é a leitura honesta dos
dois lados — versão nascida antes de existir onde declarar política não escolheu o vazio, apenas não
tinha escolha a fazer. A própria 0022 confere, no bloco de verificação, que **nenhuma** linha do acervo
nasceu `true`: uma linha `true` ali seria uma política que ninguém escreveu, e o efeito dela é recusar
conversão.

#### Declarar é a PRESENÇA DA CHAVE, nunca o tamanho da lista

Nas duas escritas administrativas (`POST` e `PUT /api/admin/tipos-operacao`), o discriminador é:

```
presente := (d.destinos !== undefined)
```

JSON não transporta `undefined`, então isso é literalmente "a chave veio no corpo". Daí decorrem, todas
implementadas em `apps/api/src/routes/tipos-operacao.ts`:

- **`"destinos": null` conta como PRESENTE** e equivale à lista vazia — o domínio já normaliza `null` para
  `[]`. `[]` também é presença. Nos dois casos a versão nova nasce com `destinos_configurados = true`;
- **ausente = preservar**, e preservar são **duas** coisas: as arestas **e** o marcador. É o que a web
  ANTIGA manda durante o rolling deploy, e ler a ausência como "zerar" destruiria política que ninguém
  pediu para destruir — e, pior, converteria em silêncio um registro legado em "declarado sem nenhuma
  próxima operação", parando a conversão daquela operação na edição de um campo que nada tem a ver com o
  assunto;
- **declarar nunca volta a ser "não declarado"**: só `true` se sobrepõe (`declarouAgora ? true :
  antes.destinos_configurados`). Silêncio do cliente não desfaz decisão de ninguém;
- **o caso crítico do no-op**: versão corrente com zero arestas e `destinos_configurados = false`,
  recebendo um `PUT` com `destinos: []`. As arestas são idênticas antes e depois, então comparar só a
  lista diria "nada mudou" e a edição seria descartada como no-op — com a tela respondendo "salvo" sobre
  uma política que continua NÃO DECLARADA. Por isso `mudouDestinos` inclui explicitamente a transição do
  marcador: a política mudou no ponto que mais importa, de "ninguém nunca decidiu" para "decidido: não
  gera próxima operação". É conteúdo, e conteúdo cria a versão N+1;
- **a versão N+1 é autossuficiente**: quando ela nasce por mudança de nome ou de configuração com
  `destinos` ausente, o marcador é **copiado** junto com as arestas. Herdar por referência faria a versão
  nova depender da anterior para ser lida, e o histórico deixaria de ser autossuficiente — que é a única
  coisa que ele promete ser.

`?? []` resolveria a normalização e **apagaria a pergunta**. Por isso a presença é lida antes, e a
normalização de `null` continua sendo trabalho do domínio.

#### Onde o estado aparece no contrato da API

| Superfície | Campo | Observação |
| --- | --- | --- |
| `GET /api/admin/tipos-operacao/:id` (detalhe) | `destinosConfigurados: boolean` | lido da coluna da versão corrente, **nunca** deduzido de `destinos.length` |
| `GET /api/admin/tipos-operacao/:id/versoes` (histórico) | `destinosConfigurados: boolean` por versão | é a pergunta que o histórico existe para responder e que a contagem de arestas não responde |
| `GET /api/sales/{variante}/:id/proximos-passos` | `politicaConfigurada: boolean` | o discriminador operacional, ao lado de `items` |
| auditoria (`create` e `update` de TOP) | `destinosConfigurados` ao lado de `destinos: <n>` | `destinos: 0` sozinho não responde o que aconteceu; com o booleano, a trilha separa "declarei que não gera nada" de "não falei do assunto" |

A **listagem** administrativa não publica o campo: ela responde "que TOPs existem", não "qual é a política
de cada uma".

Em `/proximos-passos`, **política não configurada continua devolvendo `items: []`**. Devolver ali o
destino da cadeia antiga daria à tela o que mostrar e seria inventar uma política que ninguém declarou,
exibida com a mesma aparência das que foram declaradas de verdade.

Do lado do cliente, `politicaConfigurada` é **opcional na leitura**, e ausência vira `null` — "este
servidor não respondeu essa pergunta" —, nunca `false`, que seria afirmar por ele. Com `null`, a web
espelha a regra do servidor que está do outro lado (o da fatia anterior, que usa o grafo quando ele
existe e a ponte quando está vazio); é reproduzir o que se sabe daquele servidor, não inferir política
por cardinalidade. A decisão fica em **uma** função (`usaCadeiaDeCompatibilidade`), e não numa escada de
`if` espalhada pela tela — foi assim que a versão anterior acabou lendo "lista vazia" como "nenhuma
conversão" para todo documento, inclusive os que o servidor ainda converte pela ponte.

#### Os dois caminhos da conversão

`POST /api/sales/{budgets,orders}/:id/convert` decide pelo **estado**, e a ponte deixou de ser heurística
de cardinalidade para ser um **estado removível**:

| Estado da versão que o documento cita | Quem decide o destino |
| --- | --- |
| `destinos_configurados = true` | **o grafo é autoridade, inclusive vazio.** Zero itens ⇒ recusa; TOP alvo obrigatória; alvo fora do leque ⇒ recusa |
| `destinos_configurados = false` | **ponte legada**: segue a cadeia anterior (`nextSalesKind`), e **só aqui** |

A **TOP do destino** também se comporta de modo diferente nos dois ramos: no do grafo ela é
**obrigatória**, porque é ela que diz qual das arestas foi escolhida; na ponte continua **opcional** —
informada, é resolvida para a família do destino da cadeia anterior; omitida, o documento derivado nasce
sem TOP, exatamente como nascia antes desta fatia.

**Vazio explícito é política válida, e a resposta é recusa.** Cair na ponte nesse caso seria desfazer, no
servidor, o que o administrador configurou. As três recusas do ramo configurado usam
`TIPO_OPERACAO_INDISPONIVEL` e falam apenas sobre a operação do documento que o usuário já está vendo:
"não gera nenhuma próxima operação", "escolha qual próxima operação deve ser gerada" e "esta próxima
operação não está disponível para este documento" — esta última é a **mesma** recusa para "não está no
grafo", "foi desativada", "foi excluída" e "não existe", para que o diálogo de conversão não vire um
oráculo de quais TOPs existem na organização.

Dois casos de borda, os dois implementados:

- **documento sem TOP** (`tipo_operacao_versao_id` nulo — acervo, ou criado por cliente anterior à
  TOP-CONFIG-02): não há versão para ler, logo não há política declarada. `configurada: false`, e a ponte
  vale. Inventar a cadeia fixa como se fosse política seria o contrário do que a fatia veio fazer;
- **a versão citada não foi lida**: a conversão **recusa** (`TIPO_OPERACAO_INDISPONIVEL`), e não escolhe
  uma das duas leituras no escuro. Assumir "nunca declarou" liberaria a cadeia antiga sobre um documento
  cuja política ninguém conseguiu ler — exatamente a conversão que esta correção existe para impedir. A FK
  composta da 0021 e a RLS do mesmo tenant tornam esse caminho inalcançável enquanto o documento for
  visível; se for alcançado, é corrupção.

**Por que a ponte existe.** Toda versão anterior a esta fatia nasceu com `destinos_configurados = false`:
não havia onde declarar política. Exigir a aresta de imediato quebraria TODA conversão de TODA
organização no instante do deploy, inclusive a do cliente que nunca vai abrir a tela nova. A ponte não é
"inferir a cadeia por conta própria": é preservar, para quem **nunca declarou nada**, exatamente o
contrato que ele já tem. Quem declara — mesmo que declare o vazio — sai da ponte na mesma hora, para
aquela operação. A tela nova não usa a ponte quando a política está declarada.

#### A capacidade cobrada é a do destino EFETIVO

Até esta correção, a **primeira linha** do handler cobrava
`requirePermission(ctx, permOf(nextSalesKind(kind)).create)` — a capacidade da **cadeia antiga**, antes de
ler o documento e o grafo. Ela **não substituía** a cobrança do destino real: o ramo do grafo já cobrava
`permOf(destino).create` lá dentro, depois de resolver qual era o destino. As duas **somavam**.

O estrago, portanto, tem **uma direção só**. Quando a política da versão manda o orçamento direto para
**venda**, o requisito efetivo ficava:

| | Requisito efetivo em orçamento → venda direta |
| --- | --- |
| **antes** (a primeira linha existia) | `budgets.edit` ∧ `orders.create` ∧ `sales.create` |
| **depois** (esta correção) | `budgets.edit` ∧ `sales.create` |

`orders.create` era uma capacidade **a mais**, irrelevante para o que seria criado, somada ao requisito
correto. Ela **recusava quem podia** — o vendedor com `sales.create` e sem `orders.create` levava 403 para
uma venda que tinha todo o direito de criar. E **só podia recusar a mais**: somar exigência estreita o
conjunto autorizado, nunca o alarga. **Nunca houve escalação** — não existia, em nenhum ramo do binário
anterior, caminho em que um documento derivado nascesse sem a capacidade do destino real. Dizer o
contrário inventaria um segundo defeito que o código não tinha. Qual é o destino só se sabe depois de ler
o documento e o grafo da versão que ele cita.

O contrato continua sendo `origem.edit` ∧ `destino.create`, combinados com AND. O que mudou é **onde** a
segunda metade é cobrada:

- `runService` cobra a capacidade da **fonte** (é a variante da rota, e é o registro que vai ser mutado);
- a capacidade do **destino real** é cobrada **dentro**, nos dois ramos — no do grafo, depois de resolver
  qual variante o leque escolheu; na ponte, para o destino da cadeia anterior — e **antes de qualquer
  efeito**. Ler e travar a fonte não é efeito: a fonte só vira `converted` bem depois, e um `throw` ali
  desfaz a transação inteira (403, fonte segue `open`, zero derivado, zero auditoria).

**Regra de ouro, e ela vale para todo o §11: o grafo NUNCA autoriza — ele só RESTRINGE o caminho.** A
capacidade do usuário continua decidindo se ele pode executar aquele caminho. **Habilitar uma aresta não
concede permissão a ninguém**, e desabilitar uma aresta não é mecanismo de segurança: é configuração de
processo. Nenhuma permissão nova foi criada — as duas já existem no catálogo.

Cobrar a permissão dentro do bloco idempotente **não deixa chave órfã**: a transação do `runService`
desfaz tudo em qualquer `throw`, e o `INSERT` da chave vai junto. A mesma chave pode ser reenviada depois
e será a primeira execução de verdade. E o **hash de idempotência manteve a forma**, com `targetKind` da
cadeia anterior como componente, para que binário antigo e novo calculem a mesma chave para o mesmo
pedido durante o rolling deploy (decisão 214); o destino real já entra no hash por `tipo_operacao_id`.

#### Condição de saída da ponte

A ponte é **transitória** e a saída é um **estado medível**, não uma data: ela pode ser removida quando
não houver mais versões operacionais com `destinos_configurados = false` que precisem da cadeia antiga.

Duas contagens respondem isso, executadas por organização (a RLS recorta o tenant):

```sql
-- (1) TOPs vivas cuja versão CORRENTE nunca declarou política.
--     Enquanto for > 0, um documento novo ainda pode nascer citando uma versão que depende da ponte.
select count(*) as tops_sem_politica
  from erp.tipos_operacao t
  join erp.tipos_operacao_versoes v
    on v.tipo_operacao_id = t.id
   and v.organization_id  = t.organization_id
   and v.versao           = t.versao_atual
 where t.excluido_em is null
   and not v.destinos_configurados;

-- (2) Documentos AINDA CONVERSÍVEIS que citam uma versão não declarada — ou que não citam versão
--     nenhuma (acervo anterior ao snapshot da TOP), caso que a conversão também trata como legado.
select count(*) as documentos_na_ponte
  from erp.sales_documents d
  left join erp.tipos_operacao_versoes v
    on v.id = d.tipo_operacao_versao_id
   and v.organization_id = d.organization_id
 where d.deleted_at is null
   and d.kind   in ('budget', 'order')
   and d.status not in ('converted', 'cancelled')
   and coalesce(v.destinos_configurados, false) = false;
```

A remoção da ponte só é segura com **as duas em zero** em todas as organizações: (1) sozinha deixaria de
fora os documentos abertos que citam versões antigas; (2) sozinha deixaria a próxima conversão de um
documento novo sem caminho.

**Nada disso é automatizável, e isto é decisão declarada.** Um job que marcasse `destinos_configurados =
true` sem decisão humana estaria **inventando intenção que ninguém declarou** — e a intenção inventada
tem efeito: ou vira "não gera próxima operação" (e para conversões que funcionavam), ou vira uma lista de
destinos que nenhum administrador escolheu. O marcador só passa a `true` pela escrita administrativa, que
é onde alguém responde a pergunta. O que o produto oferece para acelerar isso é o editor dizer, com todas
as letras, que a operação ainda não declarou política — e um botão explícito para declarar que não há
próxima operação.

### 11.8 O que esta fatia AINDA NÃO EXECUTAVA

> **HISTÓRICO da TOP-CONFIG-03, SUPERADO EM PARTE PELA TOP-CONFIG-04A (§12).** Os dois primeiros itens
> abaixo deixaram de valer para o estoque e o financeiro de `vendas.venda` quando a versão congelada
> declara execução configurada — e só nesse caso. Todo o resto continua valendo como está: fiscal,
> aprovação, confirmação automática, alteração após confirmar e as exigências da seção `geral` seguem
> declarados e não executados, e nenhuma outra família executa configuração.

**CONFIGURAR ≠ EXECUTAR.** Nada nesta fatia mudou o que acontece quando um documento é confirmado.
Declarado sem rodeio, e verificável no código:

- **nenhum serviço lê a configuração para produzir efeito.** `estoque.atualizacao = "saida"` não baixa
  nada; `financeiro.atualizacao = "receber"` não gera título; `fiscal.habilitado = true` não muda nada
  no fiscal. Os únicos leitores do contrato são a rota administrativa da TOP e a tela que a edita;
- **as exigências de preenchimento não são cobradas.** `exigeArmazem`, `exigeParceiro`,
  `exigeFormaPagamento` e as demais são declarações sem consumidor: nenhuma validação de lançamento as
  consulta;
- **não há workflow de aprovação.** `politica`, `valorMinimo` e `momento` são guardados e versionados; não
  existe fila, alçada, aprovador nem trava;
- **não há motor tributário.** `calculoTributario: "preparado"` declara intenção; não existe cálculo;
- **`momento` tem um valor só** porque o produto contempla apenas o efeito na confirmação;
- **a configuração não guarda referência concreta** a armazém, centro de resultado ou natureza de
  operação — só EXIGÊNCIAS. Um UUID dentro de um JSON imutável não é validado por chave estrangeira,
  pode ser de outro tenant e pode ser excluído depois, deixando uma versão que nunca poderá ser
  corrigida porque versão não se edita. Isso fica como dívida declarada, com arquitetura própria.

Ligar os efeitos é fatia posterior, **com contrato de cutover próprio** — o cutover entre "o código
decide" e "a configuração decide" é a parte difícil, e não se resolve de passagem.

## 12. Execução configurada da venda (TOP-CONFIG-04A)

> Contrato: `packages/domain/src/tipo-operacao-configuracao.ts` (formato 2) e
> `packages/domain/src/tipo-operacao-execucao.ts` (matriz de suporte e política efetiva da venda).
> Executor: `confirmSale` em `apps/api/src/routes/sales.ts`. Ativação: `apps/api/src/routes/tipos-operacao.ts`.
> Guarda de banco: `supabase/migrations/0023_venda_execucao_configurada_guarda.sql`.
> Implantação em duas fases: `docs/DEPLOYMENT.md`.

A TOP-CONFIG-04A é a primeira fatia autorizada a mudar a fronteira do §11.8. Ela faz a configuração da
TOP decidir o **estoque** e o **financeiro** da **confirmação de venda** (`vendas.venda`) — e nada além
disso. O desenho nasce para ser reutilizado pelas próximas famílias sem motor paralelo: a próxima que ganhar
execução ganha UMA entrada na matriz e UM resolvedor tipado para o SEU serviço.

### 12.1 O marcador de cutover: o bloco `execucao` do formato 2

```
execucao: { estoque: "legado" | "configurada", financeiro: "legado" | "configurada" }
```

- **Um modo por efeito**, e não um booleano "ativo": o booleano não diria QUAL efeito foi entregue à
  configuração, e impediria o cutover separado. Estoque configurado com financeiro legado (e o inverso) é
  combinação válida.
- **A existência de configuração não autoriza execução.** As versões do formato 1 foram gravadas quando os
  campos eram só declaração; `estoque.atualizacao = "nenhuma"` numa versão v1 quer dizer "ninguém decidiu",
  não "esta venda não movimenta". Por isso: **formato 1 = legado, para sempre, seja qual for o conteúdo.**
- **Uma função interpreta** (`execucaoDeclaradaTop`). Nenhum consumidor compara `versaoSchema`, deduz
  execução da família ou de `atualizacao != nenhuma`. Formato 1 → `{legado, legado}`; formato 2 → o bloco.
- **Nada é reescrito.** Não há UPDATE nem backfill de versões para o formato 2 — a versão é imutável, e
  inventar "configurada" no acervo seria atribuir uma decisão que ninguém tomou.
- **TOP nova nasce no formato 2 com `{legado, legado}`**: nenhuma começa executando configuração sem decisão
  explícita. O cliente anterior, que grava no formato 1, continua gravando formato 1 (sem tradução).
- **Salvar sem alterar continua não sendo escrita.** Um v1 e o mesmo conteúdo em v2 `{legado, legado}` são
  semanticamente iguais (`configuracoesTopIguais`), então abrir e salvar uma TOP v1 no editor novo não cria
  versão. Uma mudança real (nome, descrição, configuração ou execução) cria a N+1 — no formato que o
  cliente enviou.
- **O formato não retrocede.** Um corpo no formato 1 sobre versão vigente no formato 2 é recusado
  (`TIPO_OPERACAO_CONFIGURACAO_SCHEMA_NAO_SUPORTADO`): aceitá-lo desligaria a execução em silêncio. Voltar ao
  legado é explícito — formato 2 com o efeito em `legado`.

### 12.2 A autoridade é a versão congelada

A confirmação lê `sales_documents.tipo_operacao_versao_id` → a linha EXATA de `erp.tipos_operacao_versoes`
(uma consulta por confirmação, sem lock: a versão é imutável). Nunca `tipos_operacao.versao_atual`. A TOP
editada depois do lançamento não muda o que o documento executa; desativada ou excluída também não — o
documento confirma pela regra que capturou (o mesmo contrato da conversão). Provado em
`sales-top-execucao.test.ts` (04A-I15, 04A-I15b, 04A-I16).

### 12.3 A matriz de suporte — o que é executável

A matriz NÃO executa, não é handler e não substitui o registry: responde só "esta combinação configurada é
executável nesta versão do produto?". Ela mora em `tipo-operacao-execucao.ts`, com a família derivada do
registry (`familiaOperacionalDeDocumentoVenda("sale")`), e o servidor a publica nas capacidades.

| `vendas.venda` | executável | recusado, e por quê (confirmado contra o código real) |
| --- | --- | --- |
| estoque | `nenhuma` (sem movimento) · `saida` (a mesma `postStock`, mesma origem, mesma data) · `exigeArmazem` sim/não | `entrada`/`transferencia` (a confirmação só dá saída) · `saldoNegativo = permitir` (o gatilho do estoque recusa toda saída sem saldo; não se contorna) |
| financeiro | `nenhuma` (sem título) · `receber` (a mesma `createTitles`, mesma categoria, centro, parcelamento, parceiro, vencimento e origem) · `exigeFormaPagamento` e `exigeVencimento` sim/não | `pagar` (sentido errado) · `modo = provisionar` (título não tem estado de previsão) · `exigeCentroResultado` (a venda não tem campo de centro; nenhum centro padrão é inventado) |

Toda outra família: **"Execução configurada ainda não disponível para esta família."** — inclusive
`vendas.orcamento` e `vendas.pedido`, que continuam no comportamento vigente.

A validação acontece **na ativação, antes de gravar**, só para os efeitos em `configurada` (a seção de um
efeito em `legado` continua declaração), e devolve TODAS as recusas com `caminho` e mensagem em português
(`TIPO_OPERACAO_CONFIGURACAO_INVALIDA`, 422). A confirmação reconfere (defesa em profundidade).

### 12.4 O gate operacional e o fail-closed

`TOP_EFFECTS_RUNTIME_V1_ENABLED` (`0`/ausente = desligado; `1` = ligado; qualquer outro valor derruba o
startup):

| | gate DESLIGADO (padrão) | gate LIGADO |
| --- | --- | --- |
| ativar execução configurada (passar a `configurada`, ou mudar a seção de um efeito configurado) | recusado, `TIPO_OPERACAO_EXECUCAO_INDISPONIVEL` (409), antes de gravar | permitido, se a matriz aceitar |
| voltar ao legado, renomear, mexer no que nenhum efeito configurado executa | permitido | permitido |
| confirmar venda de versão configurada | **recusado** (409), zero efeito, idempotência não consumida — **nunca legado** | executa a política congelada |
| confirmar venda sem TOP, v1 ou v2 `{legado, legado}` | legado | legado |

Desligar o gate depois de ligado **não é voltar ao legado**: vendas de versões configuradas passam a ser
recusadas na confirmação. **Binário anterior à fatia**: ele não conhece o gate nem o formato 2; a guarda da
0023 (gatilho em `erp.sales_documents`) recusa a transição para `confirmed` de uma venda cuja versão
declara execução configurada, a menos que a própria transação tenha gravado a marca
`app.venda_execucao_configurada = <id da venda>` — o que só o binário desta fatia faz. O código levantado
(`TIPO_OPERACAO_INDISPONIVEL`) é um que o binário anterior já conhece: 422 com mensagem, nunca 500.

### 12.5 Runtime da venda, exigências, transação e cancelamento

- `resolverPoliticaEfetivaDaVenda` resolve UMA vez, antes do primeiro efeito, uma decisão tipada por
  efeito: `legado` | `configurada:nenhum` | `configurada:saida` (estoque) e `legado` | `configurada:nenhum`
  | `configurada:receber` (financeiro). O caminho legado é o código de antes, sem mudança de ordem.
- Exigências da versão (armazém em todos os itens; forma de pagamento; vencimento, sem recuo para a data do
  documento) são conferidas TODAS antes de qualquer efeito: `TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA` (422),
  com `details.exigencias[{caminho, mensagem}]`.
- Uma transação só: falha do financeiro desfaz o estoque e vice-versa (04A-I19, 04A-I20).
- Evidência: a auditoria `confirm` registra a versão usada, a origem da decisão e o que foi materializado
  (`movimentos`, `titles`, `execucao`).
- **Cancelamento estorna só o que existe.** Ele não consulta configuração nem gate: `reverseStock` estorna os
  movimentos de origem da venda (zero → nada) e os títulos da mesma origem são cancelados; a auditoria
  `cancel` registra `estornos` e `titulosCancelados`. As quatro combinações estão provadas (04A-C2…C5).

### 12.6 Administração e o que continua só declarado

A aba **Execução** do editor mostra, por efeito, "Comportamento legado" / "Usar configuração da TOP",
avaliados contra a matriz e o gate QUE O SERVIDOR DECLAROU (nunca uma cópia no cliente). Cada bloqueio tem
a sua frase: servidor sem o recurso, família sem consumidor, gate desligado, combinação sem executor e
versão configurada num ambiente que não a executa. A troca de autoridade aparece no histórico e na
auditoria como a seção `execucao` alterada (com o antes e o depois).

**Continua preparado, não executado:** fiscal, aprovação, confirmação automática, alteração após
confirmar e as exigências da seção `geral`. Orçamento, pedido e a conversão não mudaram. Próximas fatias
(Compras, Movimentações de Estoque, Financeiro) reutilizam o formato 2, a matriz e a recusa — não este
resolvedor, que é da venda.
