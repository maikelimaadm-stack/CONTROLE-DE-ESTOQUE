# Contrato do MODELO BASE 2 — moldura do lançamento

Fonte única da **apresentação** de um lançamento (documento transacional) do ERP.
Implementação: `apps/web/src/features/base2/`. Piloto: `apps/web/src/features/docs/stock-detail.tsx`.

Este documento é dono de UM assunto: como um lançamento se APRESENTA. Ele não repete o que já tem dono —
primitives em `docs/UI-STANDARD.md`, abas e URL em `docs/UX-ARCHITECTURE.md`, escopo de empresa em
`docs/MULTI-COMPANY-CONTRACT.md`, número do registro em `docs/GLOBAL-ID-CONTRACT.md`.

## A regra que sustenta todas as outras

**TELA UNIFICADA ≠ REGRA DE NEGÓCIO UNIFICADA.**

A moldura unifica composição, hierarquia visual e interação. Ela **não** unifica serviço, endpoint,
permissão, validação, transação, efeito contábil, situação, item, total ou comando. Cada módulo continua
dono disso.

O custo de confundir as duas coisas é concreto e conhecido: no momento em que a moldura ganhasse um
`if (modulo === "estoque")`, ela viraria um motor de regras disfarçado de componente de tela — e toda
mudança de regra de um módulo passaria a exigir mexer num arquivo compartilhado por todos. É exatamente
o acoplamento que a BASE2-02 (TOP) existe para tratar **com contrato próprio**, e que esta fatia não
antecipa.

Critério prático, aplicável em revisão: se para responder "o que este componente desenha?" for preciso
saber **de qual módulo** o registro veio, a regra vazou.

## Composição

```
Base2Shell                    identidade · situação · empresa · ações · histórico · anexos
├ Base2Fields                 dados principais (lista de definição, grade de 12)
├ Base2Section "Itens"        ├ Base2Items   (colunas declarativas, em leitura)
├ Base2Section  …             ├ Base2Items   (rateio, títulos, ledger… — o módulo decide quais)
└ conteúdo livre do módulo
```

Quatro componentes, superfície pequena de propósito. Composição por slots — nunca `switch` por módulo,
nunca componente monolítico com trinta props opcionais.

`Base2Shell` compõe o `DetailShell` oficial (`components/ui/detail-shell.tsx`); não o substitui e não o
duplica. Telas de **registro de cadastro** continuam no `DetailShell` direto: a moldura Base 2 é para
lançamento, que é a coisa com itens.

## Identidade do lançamento

| Elemento | Onde aparece | Autoridade |
|---|---|---|
| **Tipo** ("Baixa de estoque") | título | prop do módulo |
| **Código** (numeração da entidade) | título, ao lado do tipo | `code` do registro |
| **Situação** | selo ao lado do título | `StatusBadge` + `enumLabel` |
| **Empresa** | subtítulo | campo do registro, já recortado por RLS |
| **ID Global** | trilha do AppShell — **não** na moldura | `IdGlobalDaRotaAtual` |

**O ID Global não é desenhado pela moldura, e isso é deliberado.** Ele já é exibido uma vez pelo
AppShell, ao lado da trilha (`components/layout/shell.tsx:30` → `IdGlobalDaRotaAtual`), em TODA rota
canônica do catálogo (`packages/domain/src/id-global.ts`) — o que inclui as sete rotas de documento de
estoque. Repetir o número na moldura daria duas identidades na mesma tela e, pior, duas superfícies para
manter iguais: na primeira mudança de grafia, uma das duas ficaria para trás. O número continua sendo
**localizador humano**: não endereça (a URL é o UUID) e não autoriza.

O título composto (`tipo + código`) é também o rótulo da aba de trabalho, publicado por `useTabTitle`
dentro do `DetailShell`. A moldura não chama `useTabTitle` de novo — duas publicações do mesmo título
seriam duas fontes para o mesmo rótulo.

## Cabeçalho, trilha e ações

- Trilha (`breadcrumbs`) e botão **Voltar** vêm do `PageHeader`/`DetailShell`; a moldura só repassa.
- **Ações são do módulo.** A moldura não cria nenhuma ação de negócio — não sabe cancelar, confirmar,
  imprimir nem devolver. Recebe `acoes` como nó pronto.
- As duas únicas ações que a própria moldura liga são **Histórico** e **Anexos**, porque são genéricas por
  natureza (auditoria e arquivos de qualquer entidade) e porque duplicá-las em cada tela produziria N
  diálogos divergentes. Nenhuma das duas é ação de negócio.
- `can()` **não** decide acesso: esconde botão. Quem nega é a rota (`CLAUDE.md` › Arquitetura). Por isso
  a moldura nem recebe permissão de negócio: quem escolhe exibir uma ação é o módulo, que tem o contexto.

## Dados principais

`Base2Fields` — lista de definição (`<dl>`/`<dt>`/`<dd>`) sobre grade de 12 colunas.

- `valor` chega **já formatado** pelo chamador (`brl`, `num`, `dateBR`, `pct`, `enumLabel` de
  `lib/utils.ts` e `lib/copy.ts`). A moldura não formata moeda nem data: formatar aqui criaria uma
  segunda política de formatação ao lado da existente, e as duas divergiriam na primeira exceção.
- **Vazio vira travessão de verdade.** O antecessor (`KV`, `features/docs/shared.tsx:150`) escrevia
  `{v ?? "—"}`, mas as telas já chegavam com `String(d["campo"] ?? "")`: `null` virava `""` antes, o `??`
  não pegava, e o campo saía **em branco**. Campo em branco e campo com valor apagado são
  indistinguíveis para quem lê. `Base2Fields` trata `""`, espaço em branco, `null` e `undefined` como
  vazio — e `0` e `false` como VALOR, porque são.
- `span` por campo: frase (observação, justificativa) ocupa mais largura que palavra (código, data).
- `ocultarSeVazio` some com o campo opcional em vez de gastar uma célula com travessão.

## Itens

`Base2Items` — tabela de itens em **leitura**. É a metade de leitura do `ItemsTable` que
`docs/UI-STANDARD.md` § "ItemsTable (contrato desejado)" descrevia sem implementação. A metade de
**edição** continua em cada editor do módulo; unificar edição é fatia futura, não esta.

- Colunas declarativas: `key`, `label`, `align`, `render`. **Não existe `total` de coluna** — ver § Totais.
- Reusa `table-dense` e `num` de `app/globals.css` — a identidade visual das tabelas densas já existe e
  não se reinventa aqui.
- Vazio = `EmptyState compact`, nunca uma tabela de cabeçalho só.
- `legenda` alimenta um `<caption class="sr-only">` e é obrigatória quando a tela tem mais de uma
  tabela: quem usa leitor de tela precisa saber de qual documento é a tabela antes de entrar nas linhas.
  O piloto tem quatro tabelas, e as quatro são nomeadas.

## Totais

**O total do DOCUMENTO é um campo do cabeçalho. A tabela de itens não tem rodapé de totais.**

Esta regra substitui a primeira versão deste contrato, que mandava o rodapé exibir "o total que o servidor
calculou" sob a coluna de totais dos itens. Parecia seguro — número do servidor, alinhado por construção — e
está errado. Medido no próprio repositório:

| | total do documento | total da linha |
|---|---|---|
| Nota fiscal (`apps/api/src/routes/stock.ts:194` e `:201`) | produtos − desconto + IPI **+ frete + outras despesas** | qtd × unitário − desconto + IPI |
| Batida (`stock.ts:465`) | **não existe** (só `production_cost`) | qtd × custo unitário |
| Entrada de insumos (`stock.ts:133` e `:139`) | Σ das linhas | qtd × unitário |

Numa nota com R$ 10.000,00 em itens e R$ 500,00 de frete, a coluna somaria 10.000 e, logo abaixo dela, em
negrito, apareceria 10.500. Quem confere o documento conclui que um item está errado — ou aceita 10.500 como
o total dos produtos. Na batida o rodapé saía "—", que numa coluna de dinheiro se lê como zero.

E o cliente também **não pode somar a coluna**: `CLAUDE.md` proíbe ponto flutuante para dinheiro e o
`apps/web` não tem `decimal.js`. Não sobra forma correta de produzir um subtotal na tabela — então não se
produz nenhum. O número do documento fica num campo rotulado "Total", onde o rótulo diz de que total se
trata, e a coluna de itens mostra só o que é dela.

O que permanece da regra original, e continua valendo: **a moldura não calcula valor contábil.** Um cliente
que soma vira uma segunda autoridade, e ela diverge do backend na primeira regra de arredondamento,
desconto, frete rateado ou conversão de unidade — e quando divergir, quem olha a tela considera o número
dela o certo.

**Quantidade nunca seria totalizada de qualquer forma:** um documento mistura quilo, litro e unidade, e a
soma seria um número sem significado.

## Histórico

Mecanismo oficial e único: `HistoryDialog` (`features/base1/history-dialog.tsx`), sobre
`GET /api/admin/audit?entity=&entity_id=`. A moldura liga o botão e o diálogo; não reimplementa nada.

- Identificação = par (**nome da tabela**, **UUID**). A tabela é o que o backend grava em
  `erp.audit_logs.entity` (ex.: `apps/api/src/routes/stock.ts:271`).
- O nome da tabela é passado como `entidade`, **separado de `perm`**. Nos sete documentos de estoque os
  dois textos coincidem, mas são conceitos diferentes (um é permissão, outro é entidade de auditoria), e
  um default silencioso esconderia a divergência no dia em que ela aparecesse — com o sintoma mais caro
  possível: um histórico **vazio**, que parece "sem eventos" em vez de "consultei a entidade errada".
- Sem permissão `audit_logs.view`, o botão não aparece (apresentação) **e** a consulta não é emitida
  (o diálogo já trata isso). Quem nega de fato é a rota.

## Anexos

**Ligados, e por ENTIDADE — nunca por tipo de tela.**

`Base2Shell` recebe `anexos?: { entidade, id }` e abre o `AttachmentsDialog` oficial
(`features/base1/attachments-dialog.tsx`). A moldura não implementa envio, prévia, download nem exclusão,
e não decide o que é anexável: quem decide é a **whitelist do servidor**, `ATTACHMENT_PARENTS`
(`apps/api/src/lib/attachment-parent.ts`). A prop é o reflexo dela, não uma segunda autoridade.

A ordem importa e é o contrário da intuição: **primeiro o backend aceita a entidade, depois a tela a
oferece.** Uma tela que declare `anexos` para um pai que o servidor recusa ganha um botão que abre e falha
com 422 — "controle que aparece e não funciona é pior que controle ausente"
(`.claude/rules/frontend-web.md`).

Suporte inicial: **`input_entries`** (entrada de insumos), aberta na BASE2-01 junto com o consumidor que a
usa. As outras seis rotas do piloto continuam sem o botão porque o servidor ainda as recusa. Cada uma entra
quando alguém precisar dela, uma de cada vez: a whitelist é superfície de autorização, e abrir as sete de
uma vez daria acesso a um acervo de arquivos de seis entidades que ninguém pediu.

A regra de autorização não é especial — é a mesma das demais entidades de empresa: tenant + empresa do
próprio registro + exclusão lógica, com `input_entries.view` como capacidade do pai. Fora do escopo é
**404** (não revela existência), sem a capacidade é **403**, entidade não suportada é **422**. A matriz
inteira é provada em `apps/api/test/integration/attachments-input-entries.test.ts`.

O botão só aparece com `can("attachments.view")`, que é apresentação: quem nega é a rota.

## Multiempresa

- A moldura **exibe** a empresa do registro; nunca a seleciona e nunca a troca.
- A empresa efetiva da sessão é `session.empresaId` (`lib/api.ts`), enviada como `X-Empresa-Id`. Trocar
  de empresa tem **porta única**: o evento `agro:empresa-request`, tratado em
  `components/layout/shell.tsx`. Nenhuma tela de lançamento chama `setEmpresa` seguido de navegação — a
  ordem "empresa primeiro, navegação depois" existe para a tela de destino não disparar com o cabeçalho
  antigo.
- Registro de outra empresa, de outro tenant, inexistente ou excluído responde a **mesma 404**. A moldura
  não sabe distinguir os casos, e não deve: quem não vê, não vê a diferença.
- Documento com duas empresas (transferência) **não** tem "a" empresa: exibe origem e destino como campos
  próprios e deixa o subtítulo vazio. A moldura não escolhe uma das duas.

## Estados

`loading` · `error` · `empty` são os oficiais de `components/ui/states.tsx` (`LoadingState`,
`ErrorState` com `onRetry`, `EmptyState`), já entregues por `LoadingOr` (`features/docs/shared.tsx`).
A moldura não cria variante própria. Erro mostra só a primeira linha da mensagem — nunca rastreamento de
pilha (`safeErrorMessage`).

## Alterações não salvas

Tela de lançamento **com edição** marca a aba por `useDirtyTab(dirty)` (`lib/workspace-tabs.tsx:144`) —
o mecanismo oficial e único. Fechar aba, trocar de empresa e sair pedem confirmação; `beforeunload` só
dispara com alteração real.

Não existe segundo sistema de abas nem segundo estado de alteração. A **URL continua a autoridade**:
navegar, recarregar, voltar e abrir por link produzem a mesma tela, e focar a aba devolve a URL guardada.

O piloto desta fatia é **somente leitura**, então não marca nada — marcar uma aba limpa como suja pediria
confirmação para descartar coisa nenhuma, e o usuário aprenderia a ignorar o aviso.

## Responsividade e acessibilidade

- Grade de 12 colunas empilha em uma coluna abaixo de `md`; a tabela de itens rola horizontalmente dentro
  do próprio bloco, sem criar rolagem horizontal na página.
- Ações do cabeçalho quebram linha abaixo de 1024 px (comportamento do `PageHeader`).
- Cada seção é `<section aria-labelledby>` com título real (`<h3>`), não um `<div>` em negrito: a lista de
  cabeçalhos é como se navega uma tela longa com leitor de tela.
- Tabela com `<caption class="sr-only">`, `<th scope="col">` no cabeçalho e `<th scope="row">` na célula
  de rótulo do rodapé.
- Dados principais em `<dl>`/`<dt>`/`<dd>`: rótulo e valor ficam associados por semântica, não só por
  posição.
- Situação nunca é só cor: `StatusBadge` emite rótulo textual, `data-status` e `data-tone`.

## Fronteiras — o que a moldura nunca faz

Endpoint universal · serviço universal · tabela universal de documentos · registry ou motor de Tipo de
Operação (TOP) · mapa de regra financeira · `if (modulo === …)` · decisão de autorização · soma contábil ·
seleção de empresa · decisão sobre o que é anexável · segunda implementação de histórico, anexos, overlay,
situação ou estado genérico · CSS novo onde já existe classe com dono.

## Estado

Implementada e integrada em um piloto real na BASE2-01. Migração ampla dos demais módulos pertence à
BASE2-03+; o Tipo de Operação pertence à BASE2-02 e **não** é antecipado aqui.
