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
documento inteiro e que, a partir da TOP-CONFIG-03, vai decidir efeitos de estoque, financeiro e fiscal.
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

Quando a versão N+1 nasce, as arestas são **copiadas** para ela mesmo sem mudança: a versão nova precisa
declarar a política inteira dela, senão o histórico deixaria de ser autossuficiente.

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
  não mora no payload: mora em tabela.

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

### 11.7 A ponte de compatibilidade da conversão — transitória, e declarada

No handler de conversão (`POST /api/sales/{budgets,orders}/:id/convert`) convivem hoje dois caminhos:

| Estado da origem | Quem decide o destino |
| --- | --- |
| a versão que o documento cita **tem** destinos configurados | **o grafo é autoridade**: a TOP alvo é obrigatória e precisa estar no leque; fora dele é `TIPO_OPERACAO_INDISPONIVEL` |
| a versão que o documento cita **não tem** destino nenhum | segue a **cadeia anterior** (`nextSalesKind`), idêntica ao que já era |

**Por que a ponte existe.** O grafo nasceu vazio nesta fatia: toda TOP que existe hoje tem zero destinos.
Exigir a aresta de imediato quebraria TODA conversão de TODA organização no instante do deploy — inclusive
a do cliente que nunca vai abrir a tela nova. A ponte não é "inferir a cadeia por conta própria": é
preservar, para o acervo ainda não configurado, exatamente o contrato que ele já tem.

**Ela é transitória, e a condição de saída está escrita:** a ponte cai quando as organizações tiverem
configurado o grafo das TOPs em uso e a ausência de destinos puder significar "não converte" em vez de
"ainda não configurou". A tela nova já não depende dela — lá, versão sem transição mostra `Próximos
passos` vazio e não oferece conversão.

Duas propriedades que a ponte **não** afrouxa: a capacidade do destino continua sendo cobrada (e, no
caminho do grafo, é cobrada depois de saber qual é o destino e ainda antes de qualquer mutação — a
conversão exige `origem.edit` ∧ `destino.create`); e o hash de idempotência **manteve a mesma forma**,
com `targetKind` da cadeia anterior como componente, para que binário antigo e novo calculem a mesma
chave para o mesmo pedido durante o rolling deploy. O destino real já entra no hash por
`tipo_operacao_id`.

### 11.8 O que esta fatia AINDA NÃO EXECUTA

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
