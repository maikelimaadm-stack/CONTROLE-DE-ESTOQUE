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
`compras.pedido` e `compras.compra` (COMPRAS-01, decisão 267). O lançamento de Pedido de compra e de Compra escolhe
uma TOP configurada da família (obrigatória); a solicitação continua sem TOP. O Pedido de compra tem próximos passos
(COMPRAS-02, decisão 268): recebê-lo, inteiro ou em partes, gera uma Compra ligada a ele — a única aresta executável
do grafo de compras. Os campos da Central de Compras seguem o layout do documento ligado à TOP (COMPRAS-03, decisão
269), o mesmo mecanismo de Vendas.

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
  de Compra para onde o pedido pode ir, com ou sem "Em partes". É a ÚNICA aresta executável em compras — a compra não
  converte e o pedido não nasce de conversão —, e nenhuma aresta cruza Vendas e Compras, em nenhum sentido. Sem ponte
  legada: pedido sem política declarada não tem próximo passo;
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
continuam com os fluxos, as regras e as telas delas, e uma fatia própria decide quando trocá-las. Tela unificada não é
regra unificada — o documento de estoque não funde serviço, permissão nem efeito com as telas antigas.

| Espécie | Segmento (URL e API) | Família da TOP | Recurso de permissão | Movimento na confirmação |
| --- | --- | --- | --- | --- |
| Entrada | `entradas` | `estoque.entrada` | `entradas_estoque` | `entry`, pelo custo INFORMADO no item, com lote e validade |
| Saída | `saidas` | `estoque.saida` | `saidas_estoque` | `writeoff`, pelo custo médio; lote informado ou escolhido pela validade (vencido só sai informado, decisão 254) |
| Transferência | `transferencias` | `estoque.transferencia` | `transferencias_estoque` | `transfer_out` na origem e `transfer_in` no destino, parte por parte, com o MESMO custo, lote e validade |
| Ajuste (inventário) | `ajustes` | `estoque.ajuste` | `ajustes_estoque` | pela diferença contado − saldo: `correction_in` (> 0, pelo custo médio atual), `correction_out` (< 0), nenhum (zero) |

**Rotas.** API: `GET /api/estoque/documentos` (a lista única: espécie, situação, período, armazém de origem ou destino,
TOP, empresa e busca por código, com paginação, ordem e busca no servidor e número fixo de consultas);
`GET /api/estoque/<segmento>/operation-types`; `POST /api/estoque/<segmento>` (lança aberto, com Idempotency-Key; o
cliente manda só `tipo_operacao_id` e o servidor congela a versão e confere a família); `GET /api/estoque/<segmento>/:id`;
`GET .../previa-confirmacao`; `POST .../confirmar`; `POST .../cancelar`. Tela: a aba **Movimentações** do `/estoque`,
logo depois de "Visão geral" (as abas e o "+ Novo" antigos continuam), e a Central de Estoque em
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

**O que fica nas telas antigas** (`/estoque/entradas`, baixas, requisições, transferências, devoluções, batidas, o
ajuste a partir do Saldo e as rotas `/stock/*`): tudo continua como está, inclusive a transferência entre empresas,
o Documento fiscal de Estoque e a produção de ração. O documento de estoque não as substitui nesta fatia.

**O que FALTA (e não deve ser simulado):** editar documento aberto (cancela-se e lança-se outro), layout do documento
por TOP, transferência entre empresas no documento, centro de resultado no documento, anexos no documento de estoque,
a execução configurada das famílias novas (TOP-CONFIG-04C) e a troca das telas antigas.

### Famílias de TOP de estoque

As famílias de TOP do documento de estoque (as quatro novas, as oito antigas, o movimento pela espécie, as exigências
gerais, o editor e a TOP no documento) estão em `docs/TIPO-OPERACAO-CONTRACT.md` §16 (decisão 274).

### Situação no programa

ESTOQUE-01 está EM PR e tem a própria linha na tabela do programa (§5, "Ordem do programa"): o documento de estoque
sem execução configurada é esta fatia; a execução configurada do estoque (04C) continua não iniciada.
