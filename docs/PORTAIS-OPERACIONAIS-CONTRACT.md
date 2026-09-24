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

Só o Portal de Vendas existe como lista unificada (ver a seção própria, mais abaixo); os demais continuam
sendo DESTINO declarado, e esta seção diz as famílias que cada um cobre.
As famílias citadas aqui são as declaradas no registry — este documento as referencia, não as define.

### Portal de Compras
Processos de compra, da solicitação ao recebimento. Famílias hoje declaradas no escopo: `compras.solicitacao`.
O lançamento futuro escolherá uma TOP configurada dessa família.

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
| **TOP-CONFIG-04B+** | Compras documental (04B), Movimentações de Estoque (04C), Financeiro (04D) — reutilizando o formato 2 e a matriz | não iniciada |

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
`docs/TIPO-OPERACAO-CONTRACT.md` §11.7.

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

## Portal de Compras — contrato FUTURO, explicitamente NÃO implementado

Esta seção declara um DESTINO. Nada dela existe no código, e a fatia que a realizar terá contrato
próprio.

**O destino.** O Portal de Compras terá uma **lista de documentos comerciais de compra**, no mesmo desenho
do Portal de Vendas: uma lista principal com o tipo do documento como coluna e filtro, `+ Novo`
escolhendo a Tipo de Operação, e as transições oferecidas como `Próximos passos` do detalhe.

**As identidades documentais previstas** — Pedido de Compra, Compra/Nota e Devolução de Compra — são
documentos comerciais **reais**, com identidade própria, e não situações de um mesmo registro. Faturar,
receber e devolver serão **transições** entre eles, decididas pelo grafo configurado, e não etapas
embutidas no código.

**O que é verdade HOJE, sem embelezamento:**

- o registry declara **uma única** família de compras: `compras.solicitacao`, com origem em
  `erp.purchase_requests`;
- `erp.purchase_requests` existe desde a 0003, e há uma UI de processos e de solicitações sobre ela;
- **nada disso foi migrado.** Nenhuma família nova foi inventada, nenhuma tabela nova foi criada, nenhuma
  coluna de compras foi tocada por esta fatia;
- portanto **nenhum documento comercial de compra existe** no produto, e o Portal de Compras não tem lista
  unificada nem próximos passos.

**Solicitação, cotação e autorização são WORKFLOW PREPARATÓRIO, não a identidade do documento comercial.**
São o processo que ANTECEDE a compra: pedir, comparar e liberar. Tratá-las como se fossem o documento
faria a lista principal de Compras ser uma lista de pedidos internos, e o Pedido de Compra — que é
compromisso com o fornecedor — não teria onde existir. A fatia operacional de Compras terá de **criar o
modelo real** do documento comercial (família canônica, tabela, serviço, permissões, RLS e auditoria)
**antes** de trocar a UI principal. Trocar a tela primeiro ofereceria botões sem serviço atrás.
