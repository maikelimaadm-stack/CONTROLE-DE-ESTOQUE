# Contrato dos Portais Operacionais

> Contrato de produto (programa PORTAIS + TOP CONFIGURÁVEL, aberto pela TOP-CONFIG-01).
> Camadas relacionadas: `docs/TIPO-OPERACAO-CONTRACT.md` (§0, duas camadas),
> `docs/MODELO-BASE2-CONTRACT.md` (apresentação do detalhe), `docs/UX-ARCHITECTURE.md` (navegação).
> Este documento fixa a DIREÇÃO do programa. Onde uma seção descreve algo JÁ IMPLEMENTADO, ela diz
> isso explicitamente (hoje: o Portal de Vendas unificado); todo o resto é destino declarado.

## 1. O problema que os portais resolvem

O usuário operacional não pensa em tabelas; pensa em processos. Hoje ele navega por dezenas de telas
desconectadas e precisa saber de antemão qual delas corresponde ao que quer fazer. O modelo alvo é um ponto
de entrada por processo — o **portal** —, e dentro dele um caminho único para lançar:

```
PORTAL
  → NOVO LANÇAMENTO
    → ESCOLHER UMA TOP JÁ CADASTRADA
      → DOCUMENTO
        → O SERVIÇO DE DOMÍNIO EXECUTA
```

A quarta seta é a que não muda de DONO: quem executa é sempre o serviço de domínio. O portal muda por onde
se entra; não muda quem decide. Desde a TOP-CONFIG-04A, na confirmação de `vendas.venda`, o serviço de
vendas segue a POLÍTICA que a versão congelada do documento declara para estoque e financeiro, quando ela a
declara (`docs/TIPO-OPERACAO-CONTRACT.md` §12); sem essa declaração, as regras de sempre.

## 2. Quatro papéis que NÃO se misturam

Esta é a razão de ser deste documento. Cada linha já foi confundida com a de cima em algum ERP.

| Conceito | O que é | O que NUNCA é |
| --- | --- | --- |
| **Portal** | experiência: o agrupamento de processos por onde o usuário entra | não é permissão, não é módulo de autorização, não é entidade |
| **Família canônica** | a espécie operacional que o produto conhece (`vendas.venda`) | não é editável, não é configuração, não tem handler |
| **TOP configurada** | o tipo que a organização cadastra e nomeia (`2103 — Venda de Gado a Prazo`) | não é permissão, não é situação, não é handler, não é SQL |
| **Serviço de domínio** | quem executa o efeito, valida e grava | não é genérico, não é configurável por tela |

Declarado sem rodeio:

- **PORTAL ≠ TOP.** O portal agrupa; a TOP classifica o lançamento.
- **TOP CONFIGURADA ≠ FAMÍLIA CANÔNICA.** Uma é dado da organização; a outra é código do produto.
- **TOP ≠ PERMISSÃO.** Quem pode lançar continua decidido pela capacidade da rota e pelo escopo de empresa.
  Uma TOP nova não concede nada a ninguém.
- **TOP ≠ SITUAÇÃO.** Situação muda com o tempo; a operação é o que o lançamento sempre foi.
- **TOP ≠ HANDLER.** Não existe "função da TOP 2103". O serviço da família é que executa.
- **TOP ≠ SQL.** Nenhuma configuração desta camada vira consulta, expressão ou script executável.

**O portal é experiência. A família canônica é domínio. A TOP configurada é configuração do lançamento.
O serviço de domínio executa.**

## 3. Os portais previstos

Os Portais de Vendas e de Compras existem como lista unificada (ver as seções próprias, mais abaixo); os demais
continuam sendo DESTINO declarado, e esta seção diz as famílias que cada um cobre.
As famílias citadas aqui são as declaradas no registry — este documento as referencia, não as define.

### Portal de Compras
Processos de compra, da solicitação ao recebimento. Famílias hoje declaradas no escopo: `compras.solicitacao`,
`compras.pedido`, `compras.compra` (COMPRAS-01, decisão 267) e `compras.orcamento` (OPERACOES-01 F6a, decisão 283; com
tela desde a F6b: nasce do pedido aprovado para orçamento, nunca do "Novo"). O lançamento de Pedido de compra e de
Compra escolhe uma TOP configurada da família (obrigatória); a solicitação continua sem TOP. O Pedido de compra tem
próximos passos (COMPRAS-02, decisão 268): recebê-lo, inteiro ou
em partes, gera uma Compra ligada a ele — e, desde a decisão 283, o pedido aprovado para orçamento recebe orçamentos de
compra (a segunda aresta, pedido → orçamento). Os campos da Central de Compras seguem o layout do documento ligado à
TOP (COMPRAS-03, decisão 269), o mesmo mecanismo de Vendas.

### Portal de Vendas
Orçamento, pedido e venda — as três variantes de `erp.sales_documents`, que a BASE2-03C já unificou na
apresentação mantendo serviço, permissão e efeito separados. Foi o **piloto** da TOP-CONFIG-02,
porque a fronteira entre as variantes já está fechada e provada.

### Movimentações de Estoque
Entrada, saída, transferência, ajuste, devolução e produção. É o portal com mais famílias distintas, e por
isso o que mais se beneficia de TOPs nomeadas pelo cliente.

### Movimentações Financeiras
Contas a pagar e a receber, baixa, transferência, adiantamento e compensação. **Nem toda família financeira
suporta TOP configurada no mesmo momento**: baixa e compensação são efeitos de um título existente, não
lançamentos com identidade própria, e só entram quando houver família canônica declarada para elas.

Portais próprios do agro (pecuária, confinamento, frota) vêm depois, pelo mesmo desenho.

## 4. O que a TOP configurada faz e não faz dentro do portal

**Faz:** dá nome de negócio ao lançamento, agrupa a lista de "o que posso lançar aqui", e permite que a
organização distinga `2101 — Venda à Vista` de `2102 — Venda a Prazo` sem que o produto precise de duas
famílias.

**Não faz:** não decide o efeito contábil, não decide o efeito de estoque, não decide campo obrigatório, não
decide layout e não decide permissão. A única exceção é a da TOP-CONFIG-04A: a versão congelada de uma
VENDA pode entregar o estoque e/ou o financeiro da confirmação à configuração dela, dentro da matriz de
suporte, com o serviço de vendas executando (`docs/TIPO-OPERACAO-CONTRACT.md` §12). Um motor genérico criado cedo demais vira acoplamento irreversível
(`docs/PRE-BASE2-FOUNDATION.md` §4), e este programa é explicitamente incremental.

Isso vale inteiro para o **grafo de próximas operações** da TOP-CONFIG-03: ele diz para onde um documento
**pode** ir, e nada mais. Não concede capacidade, não amplia escopo de empresa e não substitui nenhuma
das duas — autorização continua sendo CAPACIDADE ∧ ESCOPO, verificada no servidor no momento da ação.

## 5. Ordem do programa

| Fatia | Entrega | Estado |
| --- | --- | --- |
| **TOP-CONFIG-01** | cadastro versionado de Tipos de Operação (tabela, API administrativa, tela, permissões, RLS, auditoria) | mesclada e implantada |
| **TOP-CONFIG-02** | primeiro lançamento real escolhendo uma TOP cadastrada; `tipo_operacao_id` e `tipo_operacao_versao_id` no documento (nomes em português, §1.6 do padrão — os nomes em inglês desta linha eram provisórios). Piloto: Portal de Vendas / `erp.sales_documents` | mesclada e implantada |
| **TOP-CONFIG-03** | configuração operacional versionada, grafo de próximas operações e Portal de Vendas unificado | mesclada |
| **TOP-CONFIG-04A** | ativação controlada dos efeitos da TOP, primeiro consumidor real: estoque e financeiro da confirmação de VENDA (formato 2, matriz de suporte, gate operacional, guarda de banco) | mesclada; fase 1 implantada (gate desligado); fase 2 pendente (pré-condições em `docs/DEPLOYMENT.md`) |
| **VENDAS-A1** | classificação financeira no documento de venda: `categoria_financeira_id` e `centro_custo_id` em par no orçamento, pedido e venda, copiados na conversão e usados nos títulos a receber da confirmação (legado e configurado); guarda de banco contra binário que a ignora (decisão 248) | EM PR |
| **COMPRAS-01** | documento de compra (0036): Pedido de compra e Compra com TOP obrigatória, lista única, Central de Compras, confirmação da Compra com entrada no estoque (custo rateado) e contas a pagar pela matriz (`compras.compra`), cancelamento com estorno, nota duplicada recusada nos dois caminhos (decisão 267) | mesclada e implantada |
| **COMPRAS-02** | próximos passos do Pedido de compra (0037): grafo de compras (só pedido → compra, nunca cruzando com vendas), receber inteiro ou em partes na Central de Compras pela MESMA função que lança a compra, saldo por item, reabertura ao cancelar a compra e encerramento do saldo (decisão 268) | mesclada e implantada |
| **COMPRAS-03** | layout do documento de compra (0038): o mecanismo de layout de Vendas para o Pedido de compra e a Compra, com catálogo por família, cobrado ao lançar e ao receber, sem redesenho da Central de Compras (decisão 269) | EM PR |
| **ESTOQUE-01** | documento de estoque (0040): Portal de Estoque por TOP com Entrada, Saída, Transferência e Ajuste (inventário), quatro famílias de TOP de estoque, movimento pela espécie e SEM execução configurada (decisão 274) | EM PR |
| **TOP-CONFIG-04B+** | Movimentações de Estoque (04C: a execução configurada sobre o documento de estoque da ESTOQUE-01), Financeiro (04D) — reutilizando o formato 2 e a matriz | não iniciada |

A TOP-CONFIG-04A é a fatia que autoriza efeito configurável — e SÓ estoque e financeiro, SÓ na confirmação
de `vendas.venda`, SÓ pelas combinações da matriz. Efeito fiscal e contábil, workflow genérico, aprovação
executada, confirmação automática, campos obrigatórios dinâmicos, layout dinâmico, expressões, SQL
configurável e webhook **não pertencem a este programa** até que haja uma fatia que os autorize com contrato
próprio. Cada um deles é um motor, e motor nasce depois do
terceiro caso real, não antes do primeiro.

## 6. O que já está preparado, e o que deliberadamente não está

Preparado pela TOP-CONFIG-01:

- identidade estável da TOP (`erp.tipos_operacao.id`) para o documento referenciar;
- versão imutável de conteúdo (`erp.tipos_operacao_versoes.id`) para o documento citar o NOME que valia no
  dia do lançamento — sem isso, renomear uma TOP reescreveria a aparência do histórico;
- TOP padrão por família, para que o portal possa pré-selecionar sem adivinhar;
- ativo/inativo, para tirar uma TOP de circulação sem apagar o que já a citou.

**Não preparado, de propósito:** as colunas `operation_type_id` e `operation_type_version_id` NÃO existem em
documento nenhum. Criá-las antes de existir o primeiro consumidor seria schema morto — e schema morto
envelhece sem ninguém notar, exatamente como a segunda lista que este programa evita.

## A etapa de operação, antes do lançamento

O `+ Novo` do Portal de Vendas pergunta **a operação**, não o documento. O diálogo lista as TOPs que o
usuário pode lançar, agrupadas por família, e a escolha decide sozinha em que documento o lançamento
nasce.

    Portal de Vendas
      └─ + Novo ─ escolher o Tipo de Operação     ← identidade operacional configurada
           └─ a família da TOP decide o documento ← orçamento │ pedido │ venda
                └─ formulário já contextualizado  ← dados do lançamento

**Por que a variante não é a primeira pergunta.** Perguntar "orçamento, pedido ou venda?" obriga o
operador a traduzir a operação que ele quer fazer para o nome da **tabela** em que ela cai. Quem sabe
fazer essa tradução é o produto: a família da TOP escolhida já diz em que documento a operação nasce.
Nenhum mapa de família mora na tela — a variante vem do registry e o rótulo do grupo, do catálogo de
idioma, de modo que uma família nova aparece sem que o lançador seja tocado.

**As três camadas continuam distintas** e nenhuma substitui a outra: a **família** restringe quais TOPs
aparecem; a **TOP** é escolhida antes; o **formulário** nasce sabendo qual é. Unificar a apresentação
numa etapa só não funde serviço, permissão, endpoint nem efeito contábil — cada variante segue com os
seus, e cada grupo do lançador só existe para quem tem a capacidade de criar aquela variante
(`budgets.create`, `orders.create`, `sales.create`). Sem nenhuma, o botão não aparece: oferecer "Novo" a
quem não pode criar nada é oferecer uma porta fechada.

**A apresentação vigente (VISUAL-UX-01 R3, `docs/DECISIONS.md` 228).** A barra do portal traz a pílula
**Tipo** (o filtro de tipo de documento, agora também CONTEXTO do lançamento) e o `Novo` **dividido**: o
corpo abre a janela de operações; a seta abre um menu rápido com as operações do tipo escolhido (todas até
oito; acima disso, só as padrão declaradas pelo servidor) e "Escolher operação…". Com um tipo escolhido,
menu e janela oferecem só as operações dele; com "Todos os tipos", as de todos, agrupadas por família. Na
janela o clique **escolhe**; lançam o botão `Lançar`, o Enter e o duplo clique. Nada disso muda as camadas
acima: a TOP escolhida continua sendo um pedido que a rota de lançamento reconfere contra o servidor.

**Escolher no lançador não autoriza nada.** A escolha vira `?tipo_operacao_id=<uuid>` na rota de
lançamento, e lá o id é reconferido contra a lista que o **servidor** devolve para aquela variante.
Pedido de URL é pedido, nunca autoridade — inclusive quando quem montou a URL foi a própria tela.

O contrato de URL, a superfície de recusa e o comportamento do padrão estão em
`docs/TIPO-OPERACAO-CONTRACT.md` §0.3, que é o dono do assunto.

### A navegação deixou de ensinar "variante primeiro"

As ações **Novo orçamento**, **Novo pedido** e **Nova venda** saíram de `apps/web/nav.registry.mjs`, e
com elas saíram das duas superfícies que o registry alimenta: o grupo **Ações** do menu e a **busca
global**. As duas pediam ao operador exatamente a tradução que o produto sabe fazer por ele, e uma delas
(a busca) ensinava a cadeia para quem nem tinha aberto o módulo.

Pela mesma razão, a descrição do módulo Vendas deixou de ser `Orçamento → pedido → venda`. Aquilo era
**política de negócio escrita na navegação**: a partir da TOP-CONFIG-03 quem diz o que um documento gera
é a política da versão da TOP que ele cita, e ela pode levar um orçamento direto para venda. Um texto de
módulo que afirma a cadeia ensina, no menu e na busca, exatamente o que o produto deixou de garantir.

Duas coisas que **não** aconteceram, e é importante que não tenham acontecido:

- **as rotas continuam vivas.** `/vendas/budgets/new`, `/vendas/orders/new` e `/vendas/sales/new` seguem
  válidas para link antigo e favorito, e continuam exigindo TOP válida antes do formulário. Rota é
  compatibilidade; ação de navegação é ensino — e só o ensino saiu;
- **nenhuma ação única as substituiu.** O lançador é um diálogo do portal e não tem rota própria; uma
  entrada apontando para `/vendas` prometeria abrir o lançador e apenas abriria a lista. Inventar uma
  rota só para satisfazer a navegação é escopo de outra fatia.

## A arquitetura do produto: portal → documento → TOP → próximos passos

A TOP-CONFIG-03 fecha o desenho que os capítulos anteriores anunciavam. A cadeia é sempre a mesma, em
qualquer domínio:

```
PORTAL POR DOMÍNIO          (onde se entra: Vendas, Compras, Estoque, Financeiro)
  └─ DOCUMENTO              (a identidade comercial: orçamento, pedido, venda)
       └─ TOP               (a identidade operacional configurada pela organização)
            └─ PRÓXIMOS PASSOS   (o que este documento pode virar, segundo a versão que ele cita)
```

Cada seta tem um dono diferente e nenhum substitui o outro. O portal é **experiência**; o documento é
**domínio**; a TOP é **configuração do lançamento**; os próximos passos são **política versionada** — e
quem executa o efeito continua sendo o serviço da família, como o §2 deste documento já declarava.

O último elo é a novidade: a transição deixou de ser constante do produto. O leque de um documento sai do
grafo da VERSÃO da TOP que ele cita, e a disponibilidade de cada destino é avaliada no presente. O
contrato do grafo — por que é tabela, por que a aresta pendura na versão, o marcador que separa ausência
de vazio e a regra de compatibilidade de família — é do `docs/TIPO-OPERACAO-CONTRACT.md` §11, que é o
dono do assunto. Aqui fica só a consequência de produto: **o usuário não escolhe uma tela de destino;
escolhe uma próxima operação que a organização configurou.**

### Próximos passos são AUTORIDADE quando a política está configurada

Quando a versão que o documento cita **declarou** a política, os próximos passos não são uma sugestão da
tela: são a regra, e o **servidor** a aplica. Isso tem três consequências de produto, e as três estão no
código:

- **o que não está no leque não acontece.** A conversão para uma operação fora da lista é recusada, e a
  recusa é a mesma para "não está no grafo", "foi desativada", "foi excluída" e "não existe" — o diálogo
  de conversão não pode virar um oráculo de quais TOPs existem na organização;
- **leque vazio declarado é uma resposta, não um silêncio.** "Esta operação não gera próxima operação" é
  uma decisão administrativa, e a conversão é recusada — inclusive por chamada direta à API, não só na
  tela. Tela e servidor leem o **mesmo** discriminador (`politicaConfigurada`), e era justamente a
  divergência entre os dois que a correção desfez;
- **autoridade sobre o CAMINHO não é autoridade sobre a PERMISSÃO.** O grafo restringe por onde se pode
  ir; quem decide se o usuário pode percorrer aquele caminho continua sendo a capacidade dele, cobrada na
  conversão para o **destino efetivo**. Habilitar uma aresta não concede permissão a ninguém, e desabilitar
  uma aresta não é mecanismo de segurança: é configuração de processo.

Enquanto a política **nunca** foi declarada para aquela operação (o acervo), vale a ponte de
compatibilidade — e só nesse estado. O contrato dela, com a condição de saída medível, é do
`docs/TIPO-OPERACAO-CONTRACT.md` §11.7. **A ponte é só de Vendas**: em Compras não há acervo para proteger (a
tabela nasceu com TOP obrigatória), e o Pedido de compra cuja versão não declarou próximas operações simplesmente
não tem próximo passo (decisão 268).

## Portal de Vendas unificado (implementado)

Orçamento, pedido e venda deixaram de ser três portas e passaram a ser três valores de uma coluna.

- **Uma lista principal**: `GET /api/sales/documentos`, com orçamento, pedido e venda juntos, paginação,
  filtros, busca e totais todos server-side. O operador pergunta "onde está o documento do cliente X", não
  "em qual das três telas ele está" — procurar em três lugares era o sintoma de a arquitetura estar
  modelada pela tabela, e não pelo processo.
- **O tipo do documento é COLUNA E FILTRO, não navegação.** O rótulo da variante sai do registry, nunca de
  um mapa literal no servidor ou no cliente.
- **`+ Novo` é orientado por TOP**: escolhe-se a Tipo de Operação configurada, e a família dela decide o
  documento — a etapa descrita no capítulo anterior.
- **`Próximos passos` no detalhe**: `GET /api/sales/{variante}/:id/proximos-passos` devolve `items` — o
  leque lido da versão que o documento cita, filtrado pelo estado de hoje — **e** `politicaConfigurada`,
  que diz se alguém chegou a declarar essa política. Os dois juntos, porque `items: []` sozinho tem duas
  histórias opostas: "nunca foi declarado" (e a conversão ainda segue a ponte) e "foi declarado que não
  gera nada" (e a conversão é recusada). Documento legado, sem TOP, cai na primeira: não há política para
  ler, e inventar a cadeia fixa transformaria ausência de configuração em configuração — por isso `items`
  continua vazio também aí, em vez de exibir a cadeia antiga com a mesma aparência de uma política
  declarada. A capacidade exigida é a de VER o documento — perguntar o que se pode gerar é leitura; a
  capacidade do destino é cobrada na conversão, onde o efeito acontece.

**Unificar a apresentação não fundiu nada.** As três variantes continuam com serviço, endpoint, permissão
e efeito próprios. Continua valendo o que o §2 declara: tela unificada ≠ regra de negócio unificada.

### O recorte por capacidade é a parte perigosa, e é fail-closed

Na tela por etapa, a capacidade fechava a PORTA inteira: sem `orders.view`, a aba não existia. Numa lista
única ela precisa recortar LINHAS, e aí moram dois erros clássicos, os dois fechados:

1. **A variante entra no `WHERE`, antes do `limit`.** Recortar depois de paginar devolve páginas curtas e
   vaza a contagem real do que não se pode ver.
2. **"Nenhuma variante autorizada" nunca vira "todas".** Sem nenhuma capacidade de leitura a resposta é
   **403**, não uma lista sem filtro. Lista vazia nunca é lista completa.

O filtro `kind` enviado pelo cliente é **pedido, nunca autorização**: ele só intersecta o conjunto já
autorizado, e variante desconhecida ou não autorizada esvazia em vez de alargar. A porta é dinâmica (a
capacidade exigida depende do que o usuário pode ver), então o recorte de empresa é reaplicado no SQL com
o módulo EXPLÍCITO da permissão de vendas: com módulo indefinido a RLS vale pela união das empresas
visíveis, que é mais larga. RLS ∧ SQL = o escopo exato, e nenhum dos dois sozinho decide.

### Apresentação vigente da Central de Vendas (VISUAL-UX-02, decisão 270)

A Central de Vendas — a criação (`/vendas/<variante>/new`) e a consulta do documento salvo
(`/vendas/<variante>/<id>`) — segue o desenho aprovado "Central de vendas — lançamento (interativo)":

- **barra por modo** — na consulta, Novo documento, Duplicar documento e as pílulas da espécie; na criação,
  Descartar alterações, Salvar e, na venda, Confirmar venda — e o **leque de Ações rápidas**, onde moram as ações
  que o desenho não põe na barra (Imprimir, Histórico, Documentos abertos, Alterar operação, Cancelar);
- **posição do rótulo** (antes ou dentro do campo), estado só da tela;
- **Salvar com pendências**: o clique com pendência não grava e lista o que falta, levando ao campo;
- **itens com seleção pelo círculo**, e duplicar e remover item pela barra dos itens;
- **painel inferior** com Totais, Financeiro, Frete e transporte, Fiscal e Observações, e Documentos derivados
  na consulta de pedido e de orçamento.

Nada de layout persiste: posição do rótulo, ampliar, colunas e divisores voltam ao padrão quando a tela remonta.

Esta seção descreve APRESENTAÇÃO e não é dona de regra. A regra de negócio, as rotas e as permissões são as dos
contratos donos: a TOP escolhida antes do formulário e as rotas da Central estão no `docs/TIPO-OPERACAO-CONTRACT.md`
(§0.3 e §13.4), os próximos passos no §11 dele, os campos que aparecem no layout do documento ligado à TOP
(decisões 259 a 262), e o que cada ação da tela faz — com o que ficou fora e por quê — na decisão 270 de
`docs/DECISIONS.md`. A tela esconder um botão não autoriza nem nega nada: quem decide é a rota que a ação chama.

## Portal de Compras — documento comercial de compra (COMPRAS-01), recebimento do pedido (COMPRAS-02), layout (COMPRAS-03) e o que falta

Decisão 267. O Portal de Compras segue o desenho do Portal de Vendas: lista única de documentos com o tipo como
coluna e filtro, `+ Novo` escolhendo a Tipo de Operação, a Central de Compras e a consulta com as ações.

**Solicitação, cotação e autorização continuam WORKFLOW PREPARATÓRIO, não a identidade do documento comercial.**
São o processo que ANTECEDE a compra: pedir, comparar e liberar (`compras.solicitacao`, `erp.purchase_requests`,
aba "Processos"). Não mudaram, e não viram documento de compra.

**O que EXISTE (COMPRAS-01):**

- o modelo real do documento comercial, criado ANTES da tela: tabela `erp.documentos_compra` (+ itens, 0036) com
  duas variantes pela coluna `especie` — **Pedido de compra** (`compras.pedido`, recurso `pedidos_compra`) e
  **Compra** (`compras.compra`, recurso `compras`) —, permissões CRUD no grupo "Operacional > Compras", escopo de
  empresa do módulo `compras` (RLS da 0015 no cabeçalho), auditoria, ID Global por variante e código por espécie;
- API em `/api/compras/pedidos` e `/api/compras/compras` (lançar, consultar, cancelar; `operation-types` e
  `regras-da-operacao`) e a lista única `GET /api/compras/documentos` — recorte por capacidade no WHERE antes do
  LIMIT, nenhuma capacidade → 403, filtro de espécie só intersecta o que o usuário pode ver;
- na tela, `/compras` com a aba **Documentos** (primeira e padrão; "Processos" e "Visão geral" continuam),
  `+ Novo` → TOP → Central de Compras (`/compras/<espécie>/new`) e a consulta `/compras/<espécie>/<id>`, só leitura,
  com Confirmar (Compra, com a prévia) e Cancelar;
- a **Compra confirmada** dá entrada no estoque com o custo rateado (frete, outras despesas e desconto no custo) e
  gera as contas a pagar nas parcelas da condição; cancelar a confirmada estorna o estoque e cancela os títulos;
- a mesma nota (fornecedor, número e série) não entra pela Compra e pelo Documento fiscal de Estoque ao mesmo tempo.

**O que EXISTE (COMPRAS-02, decisão 268) — o pedido vira compra:**

- **o grafo de compras**: a TOP de Pedido de compra declara, na aba "Próximas operações" (a mesma de Vendas), as TOPs
  de Compra para onde o pedido pode ir, com ou sem "Em partes". Com o pedido → orçamento (decisão 283), são as únicas
  arestas executáveis em compras — a compra e o orçamento não convertem e o pedido não nasce de conversão —, e nenhuma
  aresta cruza Vendas e Compras, em nenhum sentido. Sem ponte legada: pedido sem política declarada não tem próximo
  passo;
- **os próximos passos do pedido** (`GET /api/compras/pedidos/:id/proximos-passos`, o contrato do de Vendas): o leque
  da versão congelada do pedido, com a disponibilidade de cada destino avaliada agora;
- **receber = lançar uma Compra com origem**: escolher a TOP de Compra abre a Central de Compras em modo receber pedido
  (fornecedor, empresa e produto do pedido, travados; preço e descontos do pedido, editáveis, porque valem os da nota;
  quantidade igual ao saldo e travada sem "Em partes", editável até o saldo com ele); salvar chama
  `POST /api/compras/pedidos/:id/convert`, que aplica TODAS as regras de lançar compra pela MESMA função e liga cada
  item da compra ao item do pedido. A Compra gerada é uma Compra comum: confirma, estorna e cancela como na COMPRAS-01;
- **o saldo por item** (quantidade − recebido em compras não canceladas; só de quantidade): o pedido mostra Recebido,
  Saldo e as compras geradas; quando o saldo de todos os itens zera, o pedido vira **Convertido**; cancelar a compra
  devolve o saldo e reabre o pedido; **Encerrar saldo** (com motivo, só com compra ligada e saldo) fecha o pedido como
  Convertido, e aí o cancelamento de uma compra não o reabre. Cancelar o pedido (COMPRAS-03, item 0 a): aberto
  com compra viva → "Este pedido tem compras: cancele-as ou encerre o saldo."; convertido sem saldo encerrado e com
  compra viva → "Este pedido tem compras: cancele-as primeiro."; convertido com saldo encerrado (com ou sem compra
  viva) → "Este pedido já foi convertido em compra e não é cancelado.";
- na consulta da compra, "Origem: Pedido de compra <código>", com link.

**O que EXISTE (COMPRAS-03, decisão 269) — o layout do documento de compra:**

- **o mesmo mecanismo de Vendas, com catálogo por família**: o Pedido de compra e a Compra têm layout do documento
  (Configurações › Operações › Layouts de documento, movimentos "Pedido de compra" e "Compra", depois dos de venda) —
  quais campos aparecem, em que ordem, com que rótulo, obrigatórios, não editáveis e valor padrão (literal, variável ou
  de cadastro, inclusive o Fornecedor) —, ligado à TOP, com o padrão do movimento e o layout do sistema (a Central de
  Compras de hoje) como reservas. Cadastro e conta são os de Vendas; o catálogo é o do corpo da compra, e a família
  nunca cruza (TOP de compra não liga a layout de venda);
- **a Central de Compras aplica o layout sem redesenho**: os componentes de hoje, com "Dados adicionais" e abas em
  sequência depois dos campos principais; a TOP fica travada (trocar é voltar ao lançador); o campo que a regra exige
  (exigências da TOP, natureza e centro quando gera título, forma de pagamento, vencimento e armazém quando a TOP os
  exige, lote e validade de produto com lote) aparece mesmo que o layout o esconda;
- **cobrado ao salvar, inclusive ao receber**: o obrigatório do layout vazio é recusado ao lançar o pedido, ao lançar
  a compra e ao receber o pedido (a compra de destino usa o layout da TOP dela, e no receber o valor do pedido vence o
  padrão); confirmar e cancelar não cobram layout;
- **sem padrão de cadastro na Natureza de despesa** nesta fatia (o filtro de despesa ou "ambas" não cabe na
  conferência do padrão).

**O que EXISTE (OPERACOES-01 F6a, decisão 283) — pedido finalizado, aprovação do pedido e orçamento de compra, só na
API e no editor da TOP (as telas da Central de Compras são da F6b):**

- o pedido de compra ganha a situação **Finalizado** (Finalizar = a confirmação do pedido), com a aprovação da TOP ao
  finalizar; a fila Aprovações › Compras lista o pedido para quem aprova pedido (`pedidos_compra.approve`);
- "Aprovado para orçamento" no pedido, e o **orçamento de compra** — espécie `orcamento` do documento de compra, um por
  fornecedor, ligado ao pedido por vínculo próprio (não consome o saldo), com preço, prazo, validade e condição, sem
  estoque nem financeiro; "Escolher vencedor" leva fornecedor, preços e condição ao pedido;
- na TOP (formato 5): "Exigir pedido finalizado para receber" no pedido e "Divergência com o pedido" na compra, as duas
  desligadas por padrão.

As telas vieram na F6b (bloco seguinte). Contrato em `docs/OPERACOES-CONTRACT.md` §4.

**O que EXISTE (OPERACOES-01 F6b, decisão 283) — as telas, na Central de Compras, só com a capacidade
`finalizacaoEOrcamento` declarada pela API (sem ela, a Central de hoje):**

- no pedido: "Finalizar" (com a prévia do servidor), "Aprovar para orçamento", "Novo orçamento" (pelo leque de TOPs de
  orçamento do pedido), o bloco da Aprovação (Aprovar/Reprovar a quem tem `pedidos_compra.approve` e `compras.approve`) e
  a aba "Orçamentos" (a comparação por total e por preço de item, "Escolher" o vencedor e "Cancelar"; sem cascata: os
  abertos de um pedido que não está mais aberto são avisados e cancelados um a um);
- o orçamento de compra: nasce SÓ do pedido aprovado para orçamento (o "Novo" do Portal e o da barra não o oferecem),
  com os itens do pedido travados e o preço digitado; a consulta edita no lugar e cancela;
- na compra: a divergência com o pedido na prévia da confirmação;
- no Portal: o Tipo "Orçamento de compra" (com `orcamentos_compra.view`; quem só tem essa capacidade abre a lista já
  nele), que segue a capacidade lida — contra a API anterior ele some, porque a lista dela viria vazia; o menu Compras ›
  Documentos e o detalhe do documento de compra aceitam `orcamentos_compra.view`.

O pedido finalizado recebe, encerra o saldo e se cancela pela tela. Com "Exigir pedido finalizado para receber" = Sim,
o "Receber…" do pedido aberto fica desabilitado até ele ser finalizado. Contrato em `docs/OPERACOES-CONTRACT.md` §4 (F6b).

**O que FALTA (e não deve ser simulado):**

- o desenho visual da Central de Compras alinhado ao da Central de Vendas, com as zonas "de verdade" (faixa F2);
- Natureza de despesa com padrão de cadastro;
- fora do roteiro atual: editar documento salvo, Devolução de Compra, solicitação → pedido, item na compra que não
  está no pedido (lança-se outra compra), reabrir saldo encerrado, rateio por item ou produto, impostos, NF-e, alçada,
  reserva e confirmação automática.

## Portal de Estoque — o documento de estoque (ESTOQUE-01)

Decisão 274. O Portal de Estoque segue o desenho dos Portais de Vendas e de Compras: uma lista única de documentos,
o `+ Novo` que pergunta a OPERAÇÃO (a TOP), a Central de Estoque para lançar e consultar, e a consulta com Confirmar e
Cancelar. As quatro espécies entram juntas. O documento nasce ABERTO e só mexe no saldo quando é CONFIRMADO.

**Documento único, em tabela própria.** `erp.documentos_estoque` (cabeçalho) e `erp.documentos_estoque_itens` (itens),
0040, com quatro variantes pela coluna `especie`. Não é TOP pendurada nas tabelas antigas de estoque: aquelas
continuam com os fluxos, as regras e as telas delas, e uma fatia própria decide quando trocá-las (a OPERACOES-01 F11,
decisão 288: "O que fica nas telas antigas", abaixo). Tela unificada não é
regra unificada — o documento de estoque não funde serviço, permissão nem efeito com as telas antigas.

| Espécie | Segmento (URL e API) | Família da TOP | Recurso de permissão | Movimento na confirmação |
| --- | --- | --- | --- | --- |
| Entrada | `entradas` | `estoque.entrada` | `entradas_estoque` | `entry`, pelo custo informado no item ou, vazio, o custo médio do produto (OPERACOES-01 F5a), com lote e validade; `opening_balance` ("Estoque inicial") quando a TOP lança o saldo inicial (seção Implantação, OPERACOES-01 F11, decisão 288), com a recusa de duplicidade |
| Saída | `saidas` | `estoque.saida` | `saidas_estoque` | `writeoff`, pelo custo médio; lote informado ou escolhido pela validade (vencido só sai informado, decisão 254) |
| Transferência | `transferencias` | `estoque.transferencia` | `transferencias_estoque` | `transfer_out` na origem e `transfer_in` no destino, parte por parte, com o MESMO custo, lote e validade |
| Ajuste (inventário) | `ajustes` | `estoque.ajuste` | `ajustes_estoque` | pela diferença contado − saldo: `correction_in` (> 0, pelo custo informado ou o médio atual), `correction_out` (< 0), nenhum (zero) |
| Requisição (de material) | `requisicoes` | `estoque.requisicao_material` | `requisicoes_estoque` | nenhum: a confirmada é a PENDENTE e reserva o pedido no local de estoque (OPERACOES-01 F5a) |
| Consumo | `consumos` | `estoque.consumo` | `consumos_estoque` | `requisition` (baixa), pelo custo médio; pode atender uma requisição (OPERACOES-01 F5a) |
| Devolução de consumo | `devolucoes-consumo` | `estoque.devolucao_consumo` | `devolucoes_consumo_estoque` | `devolution` (volta), pelo custo do item do consumo de origem (OPERACOES-01 F5a) |

**Rotas.** API: `GET /api/estoque/documentos` (a lista única: espécie, situação, período, armazém de origem ou destino,
TOP, empresa e busca por código, com paginação, ordem e busca no servidor e número fixo de consultas);
`GET /api/estoque/<segmento>/operation-types`; `POST /api/estoque/<segmento>` (lança aberto, com Idempotency-Key; o
cliente manda só `tipo_operacao_id` e o servidor congela a versão e confere a família); `GET /api/estoque/<segmento>/:id`;
`GET .../previa-confirmacao`; `POST .../confirmar`; `POST .../cancelar`; desde a OPERACOES-01 F5b, as LEITURAS da
Central: `GET /api/estoque/<segmento>/regras-da-operacao`, `/layout-efetivo` e, na saída, na requisição e no consumo,
`/destino/opcoes`. Tela: a aba **Movimentações** do `/estoque`,
logo depois de "Visão geral" (desde a OPERACOES-01 F11, decisão 288, o "+ Novo" antigo saiu e as abas antigas ficam
como histórico, sem Novo), e a Central de Estoque em
`/estoque/movimentacoes/<segmento>/new?tipo_operacao_id=…` (criação) e `/estoque/movimentacoes/<segmento>/<id>`
(consulta), declaradas no `apps/web/nav.registry.mjs`.

**Permissões.** Grupo "Operacional > Estoque", ações view, create e edit por espécie; confirmar e cancelar exigem
`.edit`, como na compra. Escopo de empresa do módulo `estoque` (RLS da 0015 no cabeçalho; o item herda pela junção). A
lista recorta por capacidade de LEITURA de cada espécie no SQL, e nenhuma capacidade → 403 (lista vazia nunca é
"todas"). Documento de outra organização, fora do escopo, de outra espécie, inexistente ou com id malformado → a MESMA
404. Armazém e produto vindos do cliente são pedido: o servidor confere que existem, estão ativos e — os armazéns — são
da empresa do documento.

**Situação.** `aberto` → `confirmado`, `aberto` → `cancelado`, `confirmado` → `cancelado`; nada volta, e cancelado é
final (gatilho no banco). Fora do aberto o cabeçalho fica congelado; organização, empresa, espécie, código, TOP e
versão nunca mudam. Item só nasce ou muda com o documento aberto.

**Confirmação por espécie.** A prévia (`previa-confirmacao`) mostra, por item, o saldo de agora, o de depois, a falta
de saldo e, no ajuste, a diferença — números como texto; com falta, o Confirmar fica bloqueado. A confirmação relê
tudo sob trava e é a autoridade: saldo insuficiente na saída ou na transferência → 422 no item e nada gravado; período
fechado pela data do documento → 422 em `data_documento`; produto ou armazém inativo, ou produto que deixou de
controlar estoque desde o lançamento → 422 no campo. Saída e transferência passam pela guarda da reserva (0035): ferir
a reserva de um pedido → 409 `INSUFFICIENT_STOCK`. Os movimentos levam `source_type` `documentos_estoque` e a data do
documento.

**Ajuste com trava.** O ajuste informa a CONTAGEM. Para cada item, em ordem fixa de armazém, produto e lote, o
servidor trava o balde (armazém × produto × lote) antes de ler o saldo — inclusive o balde que ainda não existe —,
calcula a diferença sob a trava e grava no item `saldo_na_confirmacao` e `diferenca`. Dois ajustes simultâneos no mesmo
balde terminam na contagem do último, nunca na soma das diferenças. O ajuste para baixo (`correction_out`) NÃO passa
pela guarda da reserva, por desenho da 0035: o inventário registra o que está fisicamente no armazém.

**Cancelamento.** Aberto → cancelado, sem efeito no saldo. Confirmado → estorno (`reversal`) de TODOS os movimentos do
documento, depois de conferir que o que ele deu de entrada (`entry`, `transfer_in`, `correction_in`) ainda está no
balde; já consumido → 422 no item, dizendo produto, armazém e lote, e nada gravado. Cancelar de novo → 409
`ALREADY_CANCELLED`. Sem motivo, grava-se "Cancelado sem motivo informado".

**O que fica nas telas antigas** (decisão 288; o mapa completo em `docs/OPERACOES-CONTRACT.md` §8). O "+ Novo" antigo
do Estoque saiu; lançar é pela aba Movimentações. As listas antigas de requisição, saída direta, devolução, entrada
manual e ajuste ficam como histórico "(tela antiga)", sem o Novo e fora do mega-menu e da busca; as rotas de detalhe e
de criação, as rotas `/stock/*` e os aliases continuam. Ficam no menu, como AÇÃO e SÓ para o que a Central não cobre: a
"Requisição com classificação capex/opex" e a "Entrada sem nota com pagamento ou natureza e centro por item". Ficam
inteiros: a transferência entre empresas (ação, chip e Novo da lista), a fila de DF-e e a produção de ração. O Documento
fiscal de Estoque (a nota de entrada antiga) fica, desde o merge da F7 (decisão 284), SÓ para o que a compra não cobre,
pela ação "Nota de entrada antiga (qualidade de grão, proprietário, cultura ou apropriação)"; a nota de entrada é a
COMPRA, pela importação do XML na Central de Compras, e o "Lançar" da DF-e com o XML guardado abre essa importação. O "Ajustar estoque" do Saldo abre a Central de ajuste desde a F5b,
com `ajustes_estoque.create`, uma TOP de ajuste e a capacidade — senão, o diálogo de sempre. O saldo inicial: a
Implantação aponta para a Central ("Lançar saldo inicial") quando há TOP de entrada marcada; senão, o "Adicionar novo" de
hoje.

**O que FALTA (e não deve ser simulado):** editar documento aberto (cancela-se e lança-se outro), transferência entre
empresas no documento, anexos no documento de estoque, a execução configurada das famílias novas (TOP-CONFIG-04C), a
e o que só as telas antigas têm (capex/opex, centro por item, pagamento e natureza por item na entrada — exigem
migration; decisão 288; e o que só a nota de entrada antiga tem — a lista da decisão 284). O destino — o centro de resultado e as outras cinco dimensões — está
no documento desde a OPERACOES-01 F5a, pela API.

### A movimentação interna no documento (OPERACOES-01 F5a, decisão 282)

O documento de estoque passa a ter SETE espécies: a requisição de material, o consumo e a devolução de consumo, ao lado
das quatro de cima. Elas trazem:
- o DESTINO no cabeçalho (centro de resultado, máquina/equipamento, ordem de serviço, lote de animais, área/talhão e
  safra), que vai para o razão;
- a ORIGEM (consumo → requisição, devolução → consumo);
- o atendimento calculado da requisição e o encerramento do saldo;
- a reserva da requisição no disponível.

A saída ganha motivo e justificativa. Na F5a, tudo isso entrou no banco e na API (aditiva; capacidade
`movimentacaoInterna: 1`); a tela é da F5b (abaixo). Contrato em `docs/OPERACOES-CONTRACT.md` §3 (F5a), e as seções
Destino e Fluxo da TOP no §2.

### A Central de Estoque no motor (OPERACOES-01 F5b, decisão 282)

A Central de Estoque passa ao MOTOR DA CENTRAL, com o desenho das Centrais de Vendas e de Compras: barra, leque,
pílulas, painel com abas, documentos abertos, Novo documento por TOP, Duplicar, Histórico e Imprimir, e os itens em Grade,
Formulário e Ambos, com Configurar colunas e layout por TOP. Ela lança as SETE espécies quando a API declara
`movimentacaoInterna` (as quatro de antes, com o corpo de antes, quando não declara):
- a requisição, o consumo e a devolução de consumo ganham tela. O consumo nasce da requisição ("Atender requisição": os
  itens dela, até o saldo, e o destino herdado, travado) ou direto, quando a TOP não exige requisição. A requisição
  atendida em parte encerra o saldo com motivo. A devolução de consumo nasce do consumo ("Devolver itens");
- o destino segue a seção Destino da TOP (não usada / opcional / obrigatória; o padrão, desde a decisão 288, é opcional), com as opções de
  `GET /api/estoque/<segmento>/destino/opcoes` — a mesma régua do POST;
- a saída pede Motivo e Justificativa;
- a entrada aceita o custo vazio (vale o custo médio), e o ajuste aceita o custo;
- o "Ajustar estoque" do Saldo abre a Central de ajuste preenchida pela linha;
- a lista "Movimentações" tem as sete espécies, com a coluna e o filtro "Atendimento", e a fila Aprovações › Estoque tem
  as ações das sete.

O documento de estoque não tem valor: a linha nova nasce em branco, o rodapé não tem subtotal, e a consulta não mostra
desconto nem total. O prefixo dos testids do motor é `central-estoque`; os `estoque-*` de antes continuam no elemento
equivalente. Contrato em `docs/OPERACOES-CONTRACT.md` §3 (F5b).

### Famílias de TOP de estoque

As famílias de TOP do documento de estoque (as quatro novas e, desde a OPERACOES-01 F5a, as três da movimentação
interna; as oito antigas; o movimento pela espécie, as exigências gerais, o editor e a TOP no documento) estão em
`docs/TIPO-OPERACAO-CONTRACT.md` §16 (decisões 274 e 282).

### Situação no programa

ESTOQUE-01 está EM PR e tem a própria linha na tabela do programa (§5, "Ordem do programa"): o documento de estoque
sem execução configurada é esta fatia; a execução configurada do estoque (04C) continua não iniciada.

## Motor da Central (VISUAL-UX-04)

> Decisão 276. Só apresentação (faixa F2): nenhuma rota, API, permissão ou regra nova.

**A regra.** Toda Central de documento (Vendas, Compras e, desde a OPERACOES-01 F5b, Estoque; e as que vierem) usa o
MOTOR DA CENTRAL. Comportamento novo de tela — um botão da barra, uma pílula, um diálogo, uma guarda do Salvar — entra no motor,
nunca numa Central só. Duas Centrais copiadas divergem em silêncio: a que não recebeu a cópia simplesmente fica sem.

**O que mora no motor** (`apps/web/src/features/central/`, um componente por arquivo, nome neutro):

| Arquivo | O que é |
|---|---|
| `moldura.tsx` | a moldura: barra, Dados principais (cabeçalho com Ampliar, identidade, aviso e esqueleto), divisores, Itens, painel com abas recolhíveis, Ampliar/Restaurar layout |
| `campo.tsx` | o campo nas duas densidades (rótulo à frente ou compacto), campo em leitura, chave Sim/Não, coluna de campos, Dados adicionais, data |
| `barra.tsx` | ícones, conjuntos, botão e pílula da barra, Posição do rótulo, "Salvo" / "Confirmando…", a pílula "N pendências" |
| `acoes-rapidas.tsx` | o leque de Ações rápidas (a espécie entrega os itens) |
| `documentos-abertos.tsx` | a lista dos documentos abertos, sobre as abas do workspace e o `closeTab` |
| `novo-documento.tsx` | o menu "Nova operação · <espécie>" com as TOPs que o servidor listou |
| `itens.tsx`, `itens-salvos.tsx`, `configurar-colunas.tsx` | a grade da criação (seleção pelo círculo, Grade \| Formulário, rodapé; lote/validade, armazém por item e o modo "da origem" opcionais), os itens salvos e Configurar colunas; e, desde a F5b, as opções do documento sem valor (`linhaNovaEmBranco`, `subtotal`, `casasDaQuantidade`; na consulta, `rotulos`, `colunasExtras` e `formularioPelasColunas`) |
| `painel.tsx` | painel repartido, coluna, largo, o plano de parcelas (editável e em leitura), títulos e derivados |
| `dialogos.tsx` | Confirmar (com a prévia que a espécie põe dentro), Cancelar (motivo opcional, 1–500) e Descartar |
| `pesquisa.tsx` | a pesquisa (lookup) da Central, sobre duas fontes: `/api/resources/<recurso>/options` (o local, sempre; o produto sem a capacidade) e, para o PRODUTO com a capacidade `pesquisaDeProdutos`, `/api/produtos/pesquisa` (o saldo do local da linha, "Só com saldo neste local" nas saídas, "Mostrar mais") |
| `pesquisa-de-produtos.ts` | a pesquisa de produto nova (OPERACOES-01 F3b, decisão 280): a capacidade (`useFonteDaPesquisaDeProdutos`, forma e versão exatas, uma vez por carregamento), o leitor estrito da página, a query e a página no servidor (`usePesquisaDeProdutos`, chave de cache própria) |
| `local-padrao.tsx` | o "Local de estoque" do cabeçalho (OPERACOES-01 F3b): `useLocalDoCabecalho` (o padrão do layout, a escolha por empresa, o descarte) e `CampoDoLocalPadrao` (os locais da empresa do documento); estado da tela, nunca no corpo |
| `duplicar-memoria.ts`, `salvo.ts` | a entrega EM MEMÓRIA da cópia do Duplicar e do "Salvo" (nada na URL, nada no navegador); em `salvo.ts`, a regra ÚNICA do diálogo de Confirmar (OPERACOES-01 F2): `confirmarPodeAbrir` (só em documento aberto e para quem pode confirmar) e `abreConfirmarNaChegada` (a chegada da criação) |
| `salvar.ts` | o Salvar da Central (OPERACOES-01 F2, decisão 279): `avisoDoSalvar`/`avisarSalvo` (o aviso lido de `confirmacaoAutomatica` na resposta, UM por Salvar), `mensagemDoServidorNoMolde` (a pontuação da mensagem do servidor; as Aprovações a reexportam) e `useCriarDocumento` (o POST de criar pela porta que a Central passa, com a `Idempotency-Key` por tentativa) |
| `regras-gerais.ts` | as regras gerais da TOP na tela (OPERACOES-01 F2): `lerRegrasGerais` (o bloco `regrasGerais` de `/regras-da-operacao`; ausente ou fora da forma → o neutro inteiro), `rotuloDoSalvar(regras, podeConfirmar)` e `exigeAoMenosUmItem` |
| `contrato.ts` | só tipos e constantes triviais: o contrato do adaptador e das peças |

O motor não conhece espécie: dentro de `features/central/` não há rota de ESPÉCIE (`/api/sales/*`, `/api/compras/*`),
cliente nem fornecedor. Ele chama só portas genéricas: `/api/resources/<recurso>/options` na pesquisa (`pesquisa.tsx`)
e, para o PRODUTO com a capacidade `pesquisaDeProdutos` (`GET /api/produtos/pesquisa/capacidades`),
`/api/produtos/pesquisa` (o saldo do local da linha, "Só com saldo neste local" nas saídas, página no servidor —
OPERACOES-01 F3b, decisão 280); `/api/resources/<recurso>/<id>` no rótulo e na unidade (`itens.tsx`); e o saldo pela
`StockCell` de `features/docs/shared` (`/api/stock/balances/<armazém>/<produto>`). A pesquisa de produto mostra Código,
Descrição e, para quem vê o saldo do local, Estoque. O POST de criar
(`useCriarDocumento`, `salvar.ts`) vai à porta que a Central passa; o motor não a conhece. (Corrigido pela decisão 278: a 276 dizia "não há rota de API".)

**O contrato do adaptador** (`AdaptadorDaCentral`, em `features/central/contrato.ts`). Cada Central entrega:

- `prefixoTestid` — o prefixo de todos os testids do motor (a venda mantém `central-vendas`; a compra usa
  `central-compras`, e os `compras-*` de hoje continuam no elemento equivalente);
- `segmento` e `rotas` — lista, nova, registro e a porta de leitura do registro na API;
- `textos` — título da criação e da leitura pendente, rótulo do Confirmar, espécie em minúsculas, legenda dos títulos;
- `documentosAbertos` — qual aba do workspace é documento da espécie (e a porta de leitura dela) e o campo da
  contraparte;
- `novoDocumento` — as TOPs da espécie (hook), o rótulo do menu, a rota com `tipo_operacao_id` (a página RECONFERE: URL
  não autoriza) e a rota do lançador;
- `colunasDosItens` — colunas do sistema, mapa catálogo → coluna do motor e as colunas da leitura;
- `acoes` — o que a espécie põe na barra e no leque (o motor só dispõe);
- `entidadeDoHistorico` (ou null), `linkDoTitulo`, `linkDoDerivado`;
- `chaveDoSalvo` e `chaveDaCopia` — chaves do Map em memória, nunca do armazenamento do navegador.

O corpo do cancelamento é da espécie (`reason` na venda, `motivo` na compra, com o motivo vazio pelo `motivoVazio` do
diálogo): o campo `cancelamento` do contrato saiu na OPERACOES-01 (decisão 291), porque nenhuma leitura o usava.

O que é regra continua na espécie: a venda (`features/sales/`) mantém o lançamento, os derivados, o cliente em atraso,
a reserva e o faturar em partes; a compra (`features/compras/central/`) mantém o estado do documento, o receber pedido,
os Próximos passos, o Encerrar saldo e o que a cópia leva. O servidor continua sendo quem recusa.

### A apresentação vigente da Central de Compras (VISUAL-UX-04, decisão 276)

A Central de Compras (`/compras/<espécie>/new` e `/compras/<espécie>/<id>`, Pedido de compra e Compra) é montada sobre
o motor pelo adaptador `apps/web/src/features/compras/central/adaptador.ts` e tem a apresentação da Central de Vendas:
barra por modo (consulta: Novo documento, Duplicar, a pílula "Confirmar compra" ou, no pedido, "Receber…" e "Encerrar
saldo", e "Salvo"; criação: Descartar, Salvar, Confirmar compra e "N pendências"), o leque (Imprimir, Histórico,
documentos abertos, Cancelar; sem Anexos), Dados principais com a TOP travada e Dados adicionais (Movimento, Versão da
TOP, Origem), a grade do motor com Lote e Validade na compra e "Saldo do pedido" no receber, e o painel com Totais,
Financeiro, Frete e transporte, Fiscal, Estoque (compra), Compras geradas (pedido) e Observações (a aba Fiscal só quando
o layout tira nota, série e data de entrada dos Dados; a consulta desenha as zonas do layout do SISTEMA, que os põe nos
Dados, e por isso ela não aparece hoje — decisão 278). O layout do documento ligado à TOP (COMPRAS-03, decisão 269)
continua decidindo os campos e as zonas da criação (a consulta usa o do sistema — decisão 278). Ficam como eram: as portas
(`POST /api/compras/<seg>`, `/convert`, `/confirm`, `/cancel`, `/encerrar-saldo`), as chaves dos corpos, o modo
receber, os Próximos passos e a lista do portal `/compras`. Ganham do modelo: Duplicar (em memória, sem nota, série,
datas, lote, validade nem origem), Descartar, a guarda de pendência no clique (zero POST), Confirmar na criação, o
"Salvo", o aviso de aba alterada e o Cancelar com `{motivo}` opcional e `Idempotency-Key`.

### Correções da Central de Compras (VISUAL-UX-04b, decisão 278)

> Decisão 278. Só apresentação (faixa F2): nenhuma rota, API, permissão ou regra nova. A Central de Vendas não muda.

O motor ganhou três opções, todas opcionais e com o padrão que mantém a Central de Vendas como era:

| Opção | Onde | Padrão (a venda) | A compra |
|---|---|---|---|
| `custoMedioNoUnitario` | `ItensDaCentral` (`itens.tsx`) | `true`: o unitário vazio ou "0" recebe o custo médio do armazém | `false`, no lançar e no receber: o unitário é o preço do fornecedor ("0" é bonificação); o saldo continua lido, só a escrita sai |
| `armazemForcado` | `ItensDaCentral` (`itens.tsx`) | `false`: a coluna Armazém segue o layout | `regras.exigeArmazem === true`: só a regra da operação passa por cima do layout; a coluna forçada entra logo antes do Código/Produto (OPERACOES-01 F3b) |
| `casasDaQuantidade` | `ItensSalvos` (`itens-salvos.tsx`) | `2` | `4`: quantidade, Recebido e Saldo, na grade e no formulário de leitura (a coluna é `numeric(18,4)`) |

`armazemPorItem` continua significando "a coluna Armazém é PERMITIDA por linha": permitir não é forçar. O custo médio
do armazém é o que a compra FORMA ao confirmar; a Central de Compras (lançar e receber) não o escreve no unitário.

Na Central de Compras:

- a Origem "Recebido de pedido" lê `origem_item_id`, a coluna da 0037 que a leitura devolve; `item_origem_id` é só a
  chave do corpo do `/convert`;
- "Confirmar compra" na criação: o diálogo abre depois de a compra salva carregar, uma vez, e só se ela ainda pode ser
  confirmada (situação "aberto" e `compras.edit`); compra que chega confirmada não abre o diálogo nem pede a prévia —
  é o caso da TOP de compra no formato 4 com Confirmação Automática (decisão 277): a consulta abre em Confirmado;
- Duplicar: a TOP do original que não abre o formulário dá o lançador e descarta a cópia em memória, e o formulário que
  monta encerra a entrega sempre — como na venda.

Declarado na decisão 278, sem conserto aqui: a `Idempotency-Key` trocada a cada erro, inclusive na queda de rede (fatia
própria), e a tela das regras gerais da #88 (decisão 277, já na main) — o aviso do resultado da confirmação automática ao
salvar e a compra sem itens (fatia F2 própria). O aviso e a compra sem itens foram feitos na OPERACOES-01 F2 (decisão
279, abaixo); a chave de idempotência continua com a F6.

### O nome do local de estoque no motor (OPERACOES-01 F3a, decisão 280)

A coluna e o campo do item que apontam para `warehouses` dizem "Local de estoque" (antes "Armazém"), na criação, na
consulta, no formulário do item, no rótulo da ação ("Local de estoque: <nome>") e na pesquisa ("Pesquisar local de
estoque"). A coluna da grade tem 122 px (antes 108): é a menor largura par em que o rótulo cabe inteiro também com o
" *" de coluna obrigatória (`features/central/itens.tsx:45`, `itens-salvos.tsx:56`). As chaves (`armazem`,
`armazemPorItem`, `armazemForcado`, `exigeArmazem`) e os testids não mudam; a ordem das colunas mudou na F3b (abaixo).
As "colunas Armazém" das seções anteriores são esta coluna, com o nome de antes.

### O local antes do produto e a pesquisa com o saldo no motor (OPERACOES-01 F3b, decisão 280)

- **Ordem.** Sem layout, a grade é Local de estoque → Código → Produto → Estoque → … e o formulário do item, Local →
  Produto → Estoque → … (`itens.tsx:68`, `:76`); a coluna forçada (`armazemForcado`) entra logo antes do
  Código/Produto. Com layout, manda o layout. A consulta segue `colunas.leitura` de cada espécie (as duas com o Local
  primeiro), e o formulário de leitura traz o Local antes do Produto (`itens-salvos.tsx:85-88`).
- **Local do cabeçalho.** `armazemPadrao` (agora `LocalDeEstoque`) é o local das linhas NOVAS. A espécie o tira de
  `useLocalDoCabecalho` (`local-padrao.tsx`) e desenha `CampoDoLocalPadrao` nos Dados principais. Rótulo vazio não vira
  "conhecido": a célula lê o rótulo do cadastro (`itens.tsx:257`).
- **Pesquisa de produto.** Opção nova `pesquisaDeProduto` (`PESQUISA_DE_PRODUTO_DA_SAIDA` | `…_DA_ENTRADA`; ausente =
  entrada). O painel recebe `produto = { fonte, armazemId (o da LINHA), sentido, soControlaEstoque }` só no campo
  `product_id`; a pesquisa de local continua sem ele, idêntica. Sem a capacidade, o painel é o de antes, com dois
  atributos a mais (`data-fonte`, `data-coluna`). As chamadas e o que cada uma liga estão na tabela
  `COMBINACOES_DO_MOTOR` de `apps/web/e2e/compras-03-central-unitario.spec.ts`: Vendas `…_DA_SAIDA`, Compras · lançar
  `…_DA_ENTRADA`, Compras · receber ausente.
- **Desvio da 276 fechado.** A 276 deixou as duas Centrais em `/api/resources/<recurso>/options` ("a troca, para as
  duas, é outra fatia"); a F3b fez a troca nas duas, com a de antes como padrão sem a capacidade.

### As regras gerais da TOP e a aprovação nas Centrais de Vendas e de Compras (OPERACOES-01 F2, decisão 279)

As duas Centrais leem `regrasGerais` de `/regras-da-operacao` (venda: `features/sales/regras-da-operacao.ts`; compra:
`features/compras/layout-da-central.ts`), sempre pelo leitor do motor (`lerRegrasGerais`), e mostram o que a
gravação vai fazer: "Salvar e confirmar" (`rotuloDoSalvar`) e a pendência de item só quando ela vale
(`exigeAoMenosUmItem`; na compra, nunca dispensada no receber). O aviso do Salvar é o do motor (`avisarSalvo`), na
venda pelo `useCriarDocumento` e na compra pelo `salvarM` do estado (lançar e receber). O Confirmar segue a regra do
motor (`confirmarPodeAbrir`/`abreConfirmarNaChegada`), na pílula e na chegada.

Na consulta da venda (variante `sale`) e da compra, antes dos campos, as duas montam o bloco da aprovação de
`features/aprovacoes/aprovacao-do-documento.tsx` (`AprovacaoDoDocumento`), com o prefixo de testid da Central. O
bloco pergunta `GET /api/aprovacoes/<área>/<id>` só com o documento aberto, decide pelas rotas da fila e usa o
diálogo dela (`features/aprovacoes/decisao-de-aprovacao.tsx`, extraído de `fila-de-aprovacao.tsx`). Portas, textos e
o leitor da resposta moram em `features/aprovacoes/areas-de-aprovacao.ts`. O motor não importa `features/aprovacoes`:
quem monta o bloco é a Central.

O que não mudou: os corpos do POST, do `/convert` e da decisão; os testids; a pílula "Confirmar venda"/"Confirmar
compra" da criação; a conversão pedido → venda. A Central de Estoque só passou a usar o aviso do motor; a F5b a levou ao
motor inteiro (abaixo).

### O documento sem valor no motor (OPERACOES-01 F5b, decisão 282)

A Central de Estoque entrou no motor com acréscimos OPCIONAIS, com o padrão de hoje: sem a prop, nada muda nas outras
Centrais (DOM, classes, payload, testids e textos; F5B-M1 e F5B-M2 em `apps/web/e2e/f5b-motor-centrais.spec.ts`).

| onde | prop | o que faz | padrão |
|---|---|---|---|
| criação (`itens.tsx`) | `linhaNovaEmBranco` | a linha nova nasce com a quantidade e o unitário vazios; a célula não ativa mostra "—" | `false` ("1" e "0") |
| criação | `subtotal` | `false` tira o "Subtotal dos itens" do rodapé; "Itens (N)" fica | `true` |
| criação | `casasDaQuantidade` | as casas da quantidade na célula não ativa | 2 |
| consulta (`itens-salvos.tsx`) | `subtotal: string \| null` | `null` tira a linha do subtotal | o subtotal do servidor |
| consulta | `rotulos` | o rótulo da espécie no lugar do fixo, na grade, no formulário e no "Configurar colunas" | nenhum |
| consulta | `colunasExtras` | as colunas da espécie, depois de todas as outras (no formulário, campo travado), com a chave `extra:<chave>` nas preferências | nenhuma |
| consulta | `formularioPelasColunas` | o formulário de leitura só com os campos das colunas da espécie (`colunas.leitura`), mais a Unidade, na ordem fixa | `false` (a lista fixa) |

O motor continua sem conhecer espécie. A tabela `COMBINACOES_DO_MOTOR` (`apps/web/e2e/compras-03-central-unitario.spec.ts`)
tem a linha da Central de Estoque (`features/estoque/central/criacao-itens.tsx`: `armazemPorItem={false}`,
`custoMedioNoUnitario={false}`, `lote`, `daOrigem`, `pesquisaDeProduto`, `linhaNovaEmBranco`, `subtotal={false}`) e cobra
as duas chaves novas em toda chamada.

### As Centrais dos módulos com produto (OPERACOES-01 F10, decisão 287)

Abastecimento, manutenção, ordem de serviço, manejo (nutrição e sanitário), batelada e produção de ração lançam na
moldura do motor. Elas moram FORA do motor, em `apps/web/src/features/modulos/` (uma pasta por módulo), com três peças
comuns:
- `central-do-modulo.tsx` — a casca: `MolduraDaCentral`, a barra com Salvar e Descartar, as pendências e o painel
  "Resumo"; o Salvar é o `useCriarDocumento` do motor (o aviso "Salvo com sucesso" e a mesma Idempotency-Key por
  tentativa); `errosDoServidor` leva as recusas do servidor (`details[].path` e `details.exigencias[].caminho`) ao campo;
- `itens-do-modulo.tsx` — o ÚNICO arquivo dos módulos que importa `ItensDaCentral`: colunas Local de estoque, Código,
  Produto, Estoque, (a da origem), Quantidade, Valor unitário e Total; a pesquisa de produto da saída ("Só com saldo neste
  local"); está na tabela `COMBINACOES_DO_MOTOR` de `apps/web/e2e/compras-03-central-unitario.spec.ts`;
- `top-do-modulo.tsx` — a capacidade `topNoModulo` (`GET /api/modulos/<segmento>/operation-types`, react-query sem nova
  tentativa) e o campo "Tipo de operação"; `itens-derivados.ts` — os itens da batelada e da ração no modo "da origem".

O motor mudou só por ACRÉSCIMO: `linhaUnica` (`features/central/contrato.ts`, padrão `false`) deixa a grade com a linha
que a página criou, sem Adicionar, Duplicar e Remover (o abastecimento). Sem a prop, DOM, classes e comportamento
idênticos. Ela fica ao lado das props opcionais da F5b (tabela acima); na tabela `COMBINACOES_DO_MOTOR` é a única chave
que a linha pode omitir (omitida = ausente), e a linha dos módulos é a 6ª. A manutenção não usou agrupamento no motor:
cada máquina é um bloco da página com a SUA grade do motor.
A OS ganhou a edição (`/os/<id>/editar`, a mesma Central, pelo PUT de sempre, sem a TOP). A batelada ganhou rota própria
(`/confinamento/bateladas/new`) e saiu do formulário embutido da aba Hoje › Produção (botão `confinamento-nova-batelada`).
Manejo, batelada e ração usam o motor só no que cabe: o manejo tem os ANIMAIS como itens (grade própria) e o produto no
cabeçalho; batelada e ração usam o modo "da origem", com o local no cabeçalho. Contrato em `docs/OPERACOES-CONTRACT.md`
§3 (F10).

### Os dados fiscais e a importação do XML na Central de Compras (OPERACOES-01 F7, decisão 284)

O motor (`features/central/*`) não mudou. Tudo é da Central de Compras e só aparece com a capacidade `importacaoXml`
"sim" (`features/compras/importacao/capacidade.ts`); sem ela, a Central é a de antes, e o corpo do POST é o de hoje.
- Criação da COMPRA (não do pedido): o bloco "Dados fiscais" (`compras-dados-fiscais`, `features/compras/central/dados-fiscais.tsx`)
  no FIM dos Dados adicionais, fora do layout (sem `data-campo`, sem "*", fora das pendências). Ele tem a chave, a UF, o
  tipo de documento, IPI, ICMS-ST, seguro, tipo de título, classificação e o rateio do documento. A classificação do item
  ("Gera estoque", "Imobilizado", natureza e centro com rateio por produto) mora na LINHA da grade, em chaves que o motor
  preserva sem desenhar. Desmarcar "Gera estoque" limpa o Local de estoque da linha. O bloco mora nos Dados do documento e
  nunca no campo único que o painel desenha pelo mesmo componente.
- Consulta: a aba Fiscal passa a existir também pelos dados fiscais; IPI, ST e seguro nos Totais; o rateio no Financeiro;
  os bens no Estoque. Prévia: o rateio das contas a pagar.
- A importação do XML é página própria, fora do motor (`/compras/importacoes/<id>`, `features/compras/importacao/*`), com
  abas; ela termina numa compra ABERTA, que a Central de Compras abre na consulta. Contrato em `docs/OPERACOES-CONTRACT.md` §5.

## Central Financeira (OPERACOES-01 F8, decisão 285)

As "Movimentações Financeiras" do §3 ganham a sua Central: o menu Financeiro com Títulos, Bancos e caixa, Conciliação,
Fluxo e resultado e Adiantamentos. O financeiro NÃO usa o motor da Central de documento (VISUAL-UX-04): cada linha é uma
parcela de título, e a grade é a `DataTable` sobre o `Base1Grid`, com seleção para as ações em lote. Baixa, estorno,
transferência, adiantamento e compensação continuam efeitos de um título ou de uma conta, sem TOP: a TOP financeira é da
F9 (decisão 286; ver abaixo). Contrato em `docs/OPERACOES-CONTRACT.md` §6.

### O financeiro pela TOP na Central Financeira (OPERACOES-01 F9a, decisão 286)

Com `financeiroPelaTop` declarado, o lançamento avulso (só o novo) e o "Novo movimento bancário" começam pelo "Tipo de
operação" da família (`fin-lancamento-top`, `fin-movimento-top`; a lista é do servidor, `GET /api/financeiro/tops`).
Escolher a TOP aplica os padrões dela — tipo de título e conta prevista (no movimento, a conta) e a natureza e o centro
da 1ª linha do rateio —, sem apagar o resto do que foi digitado; a escolha nunca é automática (nem a TOP padrão): sem
escolha, o corpo de hoje. A TOP que não deixa o documento trocar os padrões trava esses campos (aviso
`fin-padroes-travados` "Esta operação não deixa trocar os padrões."; "Padrão da operação: não muda neste lançamento"; no
rateio em R$, a natureza e o centro desabilitados em todas as linhas, com safra, área e valor livres, `fin-rateio-travado`;
no "Novo movimento bancário", que usa o editor de rateio compartilhado, a trava é por reaplicação — a prop no editor
compartilhado é pendência registrada na decisão 286). Família sem TOP ativa: `fin-sem-top` "Nenhum tipo de operação
ativo para este lançamento: ele segue sem operação.". O detalhe do título mostra a origem pelo nome e "Tipo de operação:
<código> — <nome> (versão N)"; o previsto mostra o aviso `fin-aviso-previsto` e não oferece Baixar, Editar, Cancelar nem
Duplicar. Com `capacidades.lcdpr`, a baixa bancária e o movimento de entrada ou saída de uma empresa mostram "Imóvel
rural (LCDPR)" com o padrão da empresa já escolhido (`fin-baixa-imovel`, `fin-movimento-imovel`), e as baixas do
detalhe, a coluna "Imóvel rural"; a baixa em lote da Central ainda não mostra o campo (o servidor aplica o padrão de
cada empresa). Continua sem o motor da Central de documento: a Central de Vendas ainda não pré-preenche os padrões da
TOP (F2/F3b).

## Os padrões financeiros da TOP nas regras da operação de Compras (LANCAMENTO-01, decisão 311)

`GET /api/compras/{pedidos|compras}/regras-da-operacao?tipo_operacao_id=` responde, logo ANTES de `regrasGerais` (que
continua a ÚLTIMA chave, o contrato da OPERACOES-01 F2 que o version skew mede), duas chaves ADITIVAS da versão ATUAL
da TOP: o que o sistema já sabe do financeiro do lançamento,
para a Central não perguntar o que a TOP responde. `contractVersion` continua 1 e não há capacidade nova (o molde de
`exigeArmazem`): a Central anterior lê as chaves de hoje campo a campo e ignora as duas (`lerRegras`,
`features/compras/layout-da-central.ts`).

```
secao:   { provisao: boolean, documentoTroca: boolean, semClassificacao: "padrao_legado" | "exigir" }
padroes: { natureza:       { id, codigo, nome } | null,
           centro:         { id, codigo, nome } | null,
           tipoTitulo:     { id, nome } | null,
           formaPagamento: { id, nome } | null,
           conta:          { id, codigo, descricao } | null } | null
```

- **Um contrato só.** A forma de `secao` e dos cinco campos de `padroes` é a de `GET /api/financeiro/tops` (Central
  Financeira, F9a), chave por chave; o tipo web é declarado uma vez (`features/central/contrato.ts`). Diferença
  declarada: aqui o OBJETO `padroes` pode ser `null` (regra abaixo); na lista financeira ele é sempre o objeto, com os
  campos nulos.
- **Fonte.** `padroesDaTopParaExecucao` (`apps/api/src/lib/financeiro-top.ts`), a mesma que o salvar da compra e do
  pedido executa (`padroesDaTopNoSalvarDaCompra`): nenhuma segunda régua do formato 5 ou do perfil na rota. Só o formato
  5 de família com perfil de padrões executa — a compra e o pedido de compra têm perfil; o orçamento de compra não, e
  `/compras/orcamentos/regras-da-operacao` não muda. Os rótulos vêm da mesma leitura (o histórico da versão, mesmo de
  cadastro inativado depois): a rota diz o que a TOP manda; quem confere o cadastro utilizável continua sendo o
  servidor, no salvar e na confirmação.
- **A regra do null.** `padroes: null` sempre que a versão não tem padrão a executar: formatos 1 a 4, versão ilegível,
  ou o formato 5 sem a linha dos padrões. Fail-closed: nunca o padrão de outra versão nem de outra família. Dentro do
  objeto, campo sem padrão = `null`.
- **A seção vai sempre**, a da função — o neutro `{ provisao: false, documentoTroca: true, semClassificacao:
  "padrao_legado" }` quando a versão não executa, a regra da lista financeira para a TOP sem padrões: o neutro é o que o
  servidor executa. No formato 5 sem padrões, a seção é a da versão (por exemplo `documentoTroca: false`) com
  `padroes: null`.
- **`semClassificacao` em Compras é sempre "padrao_legado"**: o editor da TOP recusa "exigir" nas duas famílias (o
  perfil delas não tem "sem natureza e centro"), e o servidor classifica a compra sempre com "exigir"
  (`padroesDaTopNoSalvarDaCompra`). Aqui "padrao_legado" NÃO dispensa natureza e centro: a obrigatoriedade na tela
  continua vindo de `geraTitulos`, como hoje.
- **`podeTrocar` não vai na resposta**: a tela o deriva, `secao.documentoTroca && trocaPeloDocumento` do perfil da
  família (`perfilDosPadroesFinanceiros`, no domínio; na compra e no pedido de compra `trocaPeloDocumento` é verdadeiro,
  então vale `secao.documentoTroca`). A trava na tela é apresentação: quem recusa a troca é o servidor, no salvar
  (`financeiroPadrao.documentoTroca`), e só quando há o que classificar — a compra que gera título; o pedido com a
  provisão ligada.
- **Autorização e 404: as de hoje.** A seção e os padrões são lidos DEPOIS de `runService(<recurso>.create)` e do
  select da existência. TOP inexistente, de outra organização, de outra família, inativa, excluída, id malformado ou
  ausente: a MESMA 404, com as MESMAS consultas de antes (o id malformado não vai ao banco; os outros, só o select da
  existência).
- **Custo, declarado.** A função relê a versão que a porta já leu (+1 consulta: a versão com o pai) e, só quando a
  versão executa, lê os padrões com os rótulos numa consulta (+1: a tabela da 0045 com os cadastros; sem N+1).
  Consultas do handler, contadas com o espião de `pg.Client`: compra 3 → 4 (formatos 1 a 4) ou 5 (formato 5); pedido 2
  → 3 ou 4. A releitura fica de propósito: a assinatura de `padroesDaTopParaExecucao` não muda e a Central Financeira
  não é tocada.
