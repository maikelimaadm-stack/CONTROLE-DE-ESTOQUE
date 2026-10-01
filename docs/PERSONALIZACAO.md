# Personalização de telas — MODELO BASE1

Réplica do **MODELO BASE1** observado no sistema de referência externo (registro histórico em `docs/reference/` —
material de auditoria, **não** fonte de verdade deste produto), reimplementada sobre a arquitetura declarativa deste sistema e aplicada a **todos os cadastros** (`ResourceList`/`ResourceForm`) e **lançamentos** (`DocList`). Código em `apps/web/src/features/base1`.

> Blocos de interface (cabeçalho de página, botões, campos, cartões, badges de situação, estados vazio/carregando/erro,
> diálogos, confirmação, painel lateral e DetailShell): ver `docs/UI-STANDARD.md` › **Primitives visuais**.

## Anatomia da tela (listagem)
1. **Barra superior**: ícone de filtros (abre o painel lateral "Filtros"), botão verde **Novo** (e **Excluir** quando há um registro selecionado); à direita: pesquisa (ícone → pílula de 300 px com a lista "Buscar todos / Buscar favoritos / configurar"; Enter aplica; X limpa), ocultar/exibir faixa de filtros, alternância **Registro / Tabela / Cards** e **Mais opções** (ações do registro selecionado — Visualizar/Editar/Cancelar —, Duplicar, Imprimir, Exportar Excel/CSV, Histórico, Configurações, Exportar PDF, Relatório personalizado, Salvar tela como padrão da organização, Restaurar padrão da tela).
2. **Faixa de chips de filtro**: um chip por coluna/campo filtrável. O chip abre um popover com "Limpar Filtro de 'X'", **operador** (cadastros), pesquisa e a **lista de valores distintos** com contagem e "(Selecionar Tudo)" (vários valores → operador `in`), ou campo de valor/intervalo. Botões de rolagem, "Limpar todos os filtros" e, à direita, **Configurar colunas da tabela** (tabela) ou **Configurar layout dos cards** / **Configurar campos dos cards** (cards).
3. **Grade**: coluna de seleção, cabeçalho com menu por coluna (**Abrir filtro avançado**, **Auto ajustar coluna**, **Congelar/Descongelar coluna**, **Ocultar coluna**), ordenação por clique, redimensionamento por arraste, colunas congeladas fixas à esquerda, zebrado, tooltip do valor; duplo clique/clique na célula abre o **Registro**.
4. **Cards**: avatar com iniciais, "CÓDIGO • título", linhas `rótulo: valor`; 1 a 4 cards por linha; campos escolhidos pelo usuário.
5. **Rodapé**: `Selecionados · Listados · Filtrados · Totais`, quantidade por carregamento (20/50/100/200) e **Carregar mais registros** (rolagem incremental).
6. **Painel lateral "Filtros"**: um campo por filtro, Limpar / Aplicar.
7. **Modo Registro** (cadastros): barra **Novo / Editar / Excluir / Duplicar** (ou **Salvar / Cancelar**), cabeçalho "CÓDIGO • nome" com navegação `|< < n/N > >|`, painéis em abas (ou empilhados), cards brancos com campos de rótulo flutuante; ícone "Layout do formulário" leva à **Configuração de layout**.
8. **Configuração de layout** (`/cadastros/:recurso/configuracao-layout`): abre na consulta (Voltar, Editar layout, Padrão da organização, Pré-visualizar, Restaurar padrão), só para ver; a edição traz a coluna Disponíveis / Em uso (busca), o trilho (Usar todos / Tirar todos), os painéis e os cards em faixas (+ verde, lixeira, card inteiro ou meio, renomear com dois cliques), as linhas "LINHA n" com o x/y, os campos com ⚙ e × no hover, o "+ Campo" e o "Adicionar linha"; arrastar por ponteiro (vão, troca na linha cheia, soltar na coluna), o inspetor de propriedades (rótulo, Obrigatório, Visível, Somente leitura, Valor padrão), Desfazer / Refazer e Salvar / Descartar. Detalhe na seção [Configuração de layout](#configuração-de-layout).

## Princípios
- **Uma definição, todas as telas**: os 63 cadastros nascem de `packages/domain/src/resources` e os documentos transacionais usam `DocList`. O motor de listagem (`apps/web/src/features/base1`) e o de formulário (`apps/web/src/features/resources`) são únicos: uma alteração neles propaga para todas as telas.
- **Documento JSON por (organização, usuário, módulo, tela)** em `erp.user_screen_preferences`, com `revision` (bloqueio otimista: 409 em conflito entre abas) e limite de 256 KB.
- **Precedência**: personalização do usuário > padrão da organização (`user_id null`, definido por quem tem `screen_layouts.edit` ou é owner) > padrão do código.
- **Mesma validação no cliente e no servidor**: `packages/shared/src/preferences.ts` (`normalizeListPreferences`, `normalizeFormLayout`, catálogo de operadores). A API valida contra a definição do recurso (colunas/campos conhecidos), descartando o que não existe.
- **Cache local + sincronização**: o frontend lê `localStorage` imediatamente e sincroniza com a API com debounce (400 ms), adotando a versão do servidor quando ela é mais nova.
- **Idioma e terminologia**: rótulos, enums e formatação seguem o contrato em `docs/UI-STANDARD.md` (Situação/Painel, Buscar × Pesquisar, Excluir × Remover, Fechar × Cancelar, `enumLabel`, `brl/num/pct/dateBR`); o `copy-audit` roda no lint.

## Listagens (`screen = list`)
| Seção | Conteúdo |
|---|---|
| `columns` | `visible[]`, `order[]`, `widths{px}`, `frozen` |
| `sort` | `{ key, dir }` padrão da listagem |
| `pageSize` | 10…200 |
| `view` | `mode: table\|cards`, `cardFields[]`, `cardsPerRow: 1\|2\|3\|4`, `density` |
| `filters` | `visible[]` (campos de filtro exibidos), `operators{campo: operador}` (padrão por campo), `saved[]` (filtros nomeados com valores), `defaultSaved` |

UI: "Configuração de colunas" (colunas disponíveis × em uso, numeradas, busca, setas, ↺), menus de coluna, popovers dos cards e itens "Salvar tela como padrão da organização" / "Restaurar padrão da tela" em **Mais opções**.

## Rotina primeiro, avançado depois (Compactação V2)
A barra principal do Modelo Base1 mostra só o cotidiano: **Novo**, **busca**, **Registro / Tabela / Cards** e as ações da seleção (Editar, Duplicar, Excluir, Anexos). Configuração de colunas fica na faixa de filtros; configurar layout, congelar/ocultar colunas (menu da coluna), exportações, relatório personalizado, padrão da organização e restaurar padrão ficam em **Mais opções**. Nenhuma capacidade foi removida.

## Seleção, modo Registro, histórico e anexos (regras do MG)
- **Seleção**: clique na linha/card seleciona só aquele registro; clicar no já selecionado desmarca; Ctrl (⌘) alterna sem desmarcar os demais; Shift seleciona o intervalo; o controle de seleção da linha alterna individualmente e o do cabeçalho marca/desmarca todos. Duplo clique abre o registro.
- **Registro**: o botão "Registro" abre o único selecionado (com 2+ selecionados avisa "Selecione apenas um registro"; sem seleção abre o primeiro). Anterior/Próximo/Primeiro/Último ficam no cabeçalho do registro e bloqueados durante a edição; em **Novo** não existem. Em edição/novo a barra mostra só **Salvar/Cancelar** e some a pesquisa, a alternância de modo e o menu (só Anexos permanece). Ao voltar para Tabela/Cards o registro aberto continua selecionado e é rolado para a área visível.
- **Histórico** (menu Mais opções): habilitado só com exatamente um registro selecionado ou no modo Registro (nunca em Novo).
- **Anexos** (botão ao lado da pesquisa, `attachments.view/create/delete`): mesma regra do histórico; diálogo com "Nome do anexo" + arquivos (PDF, imagens, texto/CSV/XML, Excel, Word; 20 MB), lista Nome/Arquivo/Tamanho/Enviado em, **prévia** embutida (imagem, PDF, texto), download e exclusão (auditadas como `attachment_added`/`attachment_removed`). Conteúdo em `erp.attachment_blobs`, servido por `GET /api/attachments/:id/content` (`?download=1` força download). Lançamentos (`DocList`) recebem `entity` para habilitar histórico/anexos.
- **Congelar colunas** (`columns.frozen` = quantidade à esquerda, como no MG): "Congelar coluna" na coluna N congela todas até N; o menu da última congelada (âncora, com sombra) mostra "Descongelar colunas"; ocultar/reordenar colunas ajusta a contagem; os deslocamentos são medidos por `ResizeObserver` (redimensionar não desalinha).

## Filtros avançados (cadastros declarativos)
Query string `campo__operador=valor` (intervalos: `valor|valor2`). Operadores por família:
- texto: contém, não contém, igual, começa com, termina com, vazio, não vazio
- número/dinheiro: =, ≠, >, ≥, <, ≤, entre, vazio, não vazio
- data: em, antes, depois, entre, hoje, ontem, esta semana, este mês, mês passado, este ano, vazio, não vazio
- seleção/referência: igual, diferente, está na lista, vazio, não vazio; booleano: igual
- **lista** (`campo__in`): valores separados por U+001F (`encodeList`/`decodeList` em `@agro/shared`), usada pela seleção múltipla do chip; valores distintos vêm de `GET /api/resources/:key/distinct?field=&search=&limit=` (só campos da definição; contagem e rótulo de referência; mesmo isolamento da listagem)

No servidor (`advancedClause` em `apps/api/src/routes/resources.ts`) o nome da coluna vem **sempre** da definição declarativa e os valores são parametrizados; valor inválido → 422; operador desconhecido é ignorado. Documentos transacionais (`DocList`) usam chips no modo simples (`campo=valor`; `start_date`/`end_date` viram o chip "Período").

## API
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/preferences/bootstrap` | todas as preferências do usuário e da organização |
| GET | `/api/preferences/:module/:screen` | `{ user, org, canEditOrg }` |
| PUT | `/api/preferences/:module/:screen?scope=user\|org` | `{ preferences, expectedRevision? }` → 409 com `details.current` em conflito |
| PATCH | `/api/preferences/:module/:screen?scope=` | `{ section, patch }` (merge de uma seção) |
| DELETE | `/api/preferences/:module/:screen?scope=` | remove (volta ao nível anterior de precedência) |

`module` = chave do recurso (`products`) ou id derivado do endpoint (`stock.entries`); `screen` = `list` | `form` | outros (documento livre, validado só por tamanho).

### Pesquisa de produtos — `GET /api/produtos/pesquisa` (ANEXOS-PESQUISA-01, decisão 271)

Consulta de LEITURA para o seletor de produto dos lançamentos. Implementação: `apps/api/src/routes/produtos-pesquisa.ts`.

- **Query estrita**: `busca` (texto aparado, 0–100), `armazem_id` (uuid, opcional), `limite` (1–50, padrão 20).
  Chave desconhecida, `limite` fora da faixa ou `armazem_id` malformado → 422.
- **Permissão e campos**: os MESMOS de `GET /api/resources/products/options` (módulo de `products.view`); campo que
  o usuário não vê sai `null`.
- **Resposta**: `{ itens: [{ id, codigo, descricao, referencia, unidade, estoque }], estoqueDoArmazem: boolean }`.
  `referencia` = `reference` ou `null`; `unidade` = o mesmo rótulo de `measurement_id_label` de
  `GET /api/resources/products/:id`; `estoque` = string com 4 casas ou `null`.
- **Busca**: cada palavra bate em código (começa com) OU descrição (contém) OU referência (contém); palavras com E;
  sem diferenciar maiúsculas; `%` e `_` são texto. Busca vazia → os primeiros por descrição. Só produto ativo, não
  excluído, da organização. Ordem: código igual ao texto primeiro, depois descrição.
- **Estoque**: só com `stocks.view` E `armazem_id` E armazém da organização no escopo de empresa do módulo de
  estoque. É o saldo FÍSICO (soma de todos os lotes do produto no armazém), **sem descontar reserva**. Qualquer
  "não" (sem `stocks.view`, sem `armazem_id`, armazém de empresa fora do escopo, de outra organização ou
  inexistente) responde IDÊNTICO: `estoque` nulo em todos e `estoqueDoArmazem=false`.
- **Custo**: UMA consulta de produtos e, com estoque, UMA de saldos (`any($ids)`) — nunca N+1.
- **API anterior**: a rota não existe → 404 de rota; a tela que vier a usá-la cai no `/api/resources/products/options`.

## Layout de formulário (`screen = form`)
Documento **painéis → cards → linhas → campos** (`FormLayout` em `@agro/shared`): `panels[]`, `cards[{panelId, colSpan 6|12, rows[{fieldIds[]}]}]`, `hiddenFieldIds`, `lockedFieldIds`, `requiredFieldIds`, `fieldSizes`, `fieldLabels`, `fieldDefaultValues`. Regras: máx. 7 campos por linha em card de largura 12 e 4 em largura 6; campo obrigatório na definição nunca pode ser ocultado; campos sem posição são anexados ao card "Outros campos". Implementado em todos os cadastros declarativos (`ResourceForm`): a página **Configuração de layout** (rota `/cadastros/:recurso/configuracao-layout`; código em `apps/web/src/features/resources/form-layout.tsx` e `apps/web/src/features/resources/configuracao-layout/`) edita esse mesmo documento, sem chave nova — ver a seção [Configuração de layout](#configuração-de-layout). Campos obrigatórios na definição ("campos do sistema") não saem do formulário, não podem ser ocultados nem deixar de ser obrigatórios; campos só leitura na definição ficam com "Somente leitura" travado. O padrão da organização (usar / remover) e o Restaurar padrão ficam na barra da página.

## Relatórios personalizados
Tela **Relatórios › Relatórios personalizados** e botão **Relatório** em toda listagem de cadastro (leva os filtros aplicados). O construtor (`/relatorios/personalizados/novo`) permite: escolher a entidade (recursos declarativos com permissão de visualização), colunas (ordem e seleção), filtros com operadores (mesma barra das listagens), pesquisa livre, ordenação, agrupamento por campo (subtotais por grupo), totais (Σ em campos numéricos), prévia, exportação CSV/XLSX, impressão e salvar como **privado** ou **compartilhado** com a organização (`saved_reports.share`). Persistência em `erp.saved_reports` (definição JSON validada contra o recurso; até 5.000 linhas por execução).

API: `GET /api/saved-reports/resources`, `GET/POST /api/saved-reports`, `GET/PUT/DELETE /api/saved-reports/:id`, `POST /api/saved-reports/run` (`{ resource_key, definition, format?: csv|xlsx }`). Permissões: `saved_reports.view|create|edit|delete|share` (autor sempre pode editar/excluir os seus); executar exige a permissão de visualização do recurso.

## Testes
- `packages/shared/test/preferences.test.ts` (normalizadores, operadores, datas relativas, layout).
- `apps/api/test/integration/preferences.test.ts` (persistência, 409, PATCH, permissão do padrão da organização, validação de layout, filtros avançados) e `saved-reports.test.ts` (execução com agrupamento/totais, CSV/XLSX, salvar/compartilhar/excluir, validação e permissão).
- `apps/api/test/integration/distinct.test.ts` (valores distintos, operador de lista, campo não filtrável → 422).
- `apps/web/e2e/personalizacao.spec.ts` (listagem: chip com valores distintos, ocultar coluna pelo menu, configuração de colunas, cards por linha, persistência, restaurar; modo Registro: navegação e edição; configuração de layout: retirar campo, rótulo, restaurar; relatório: prévia agrupada, salvar, listar).

## Componente único

Todas as telas usam a **mesma grade** (`Base1Grid`, classe `mg-grid`): cadastros e lançamentos via `Base1List`; telas de consulta (saldo, movimentos, auditoria, usuários, relatórios etc.) via `DataTable`, que é apenas uma casca paginada sobre `Base1Grid` com o mesmo rodapé (Selecionados/Listados/Filtrados/Totais + pílula de quantidade). A seleção usa o checkbox circular `MgCheck` (verde quando marcado, traço no cabeçalho quando parcial); clique seleciona, duplo clique abre. Campos, botões e cartões genéricos (`Input`, `NativeSelect`, `Button`, `Card`, `FilterBar`) usam as classes `mg-input`, `tb-btn`, `mg-card` e `mg-rail`. Alterar o modelo em `apps/web/src/features/base1/*` e `globals.css` altera todas as telas.

## Controles do formulário (réplica do PROJETOMG)

- **Campo** (`.mg-field`): vazio em edição = cinza sem borda com o rótulo (12 px) centralizado; preenchido ou em foco = rótulo 9 px no topo, valor na base, fundo branco com borda `#E7EAEE`; foco = só o anel interno (uma única moldura); travado = `#e9edf2` com texto cinza; visualização = `#f6f8fa` sem interação (só o botão Editar libera os campos).
- **Seletor de opções** (`MgSelect` / `RefSelect`, cmd-select do MG): a caixa mostra o valor com a seta à direita; o painel flutuante tem pesquisa e opções de 12 px com destaque por teclado; a opção atual fica verde. Referências carregam a lista só ao abrir e usam o rótulo já vindo da listagem (sem consultas ao abrir o registro).
- **Calendário** (`MgDatePicker`, mg-dp do MG): todo `Input type="date"` vira o painel 320×320 com dias circulares, hoje contornado em verde, título abre meses → anos. Digitação `dd/mm/aaaa` e setas ↑/↓ (±7 dias) também funcionam.
- **Obrigatórios**: ao salvar com pendências, o campo fica com moldura vermelha suave e o aviso de canto "Atenção — Existem campos obrigatórios que precisam ser preenchidos" lista os campos; a pílula `n/N Obrigatórios` no cabeçalho mostra os pendentes na dica. Erros do servidor chegam em português por campo (nunca mais "expected string, received null").
- **Avisos** (`lib/toast`): mesma API do sonner, visual `erp-toast-panel` (selo colorido, título fixo por tipo, descrição) no canto superior direito.
- **Painéis**: abas horizontais (`seg-tab`) ou lista lateral (`mg-panel-list`, 268 px) — botão à esquerda das abas alterna e a escolha fica guardada por cadastro. Formulários com 16+ campos e 3+ seções já nascem com abas.
- **Transições**: a linha da listagem entra como placeholder do registro (sem tela de carregamento ao navegar), a troca de aba/visão faz um fade de 220 ms e a página entra com fade suave.

## Configuração de layout

Tela de `/cadastros/:recurso/configuracao-layout`, igual ao desenho aprovado "Configuração de layout" (decisão 275 de `docs/DECISIONS.md`). Serve a todos os cadastros declarativos e edita o documento de **Layout de formulário** acima — o `FormLayout` de sempre, sem chave nova; o servidor o normaliza de novo ao gravar.

**Consulta e edição.** A tela abre na consulta, só para ver: barra com Voltar, Editar layout, Padrão da organização, Pré-visualizar e Restaurar padrão (desabilitado); os campos aparecem com as marcas — olho cortado (oculto no formulário), cadeado (somente leitura) e raio (tem valor padrão). **Editar layout** (habilitado quando as preferências carregam) abre um rascunho igual ao salvo; a barra passa a Salvar (verde só com alteração), Descartar alterações, Desfazer e Refazer (pilha de 50), Padrão da organização (desabilitado durante a edição), Pré-visualizar e Restaurar padrão. **Salvar** grava a personalização do usuário e volta à consulta ("Layout salvo"); **Descartar** volta ao salvo sem gravar nada. Com alteração, a aba do workspace mostra o ponto, e fechar a aba, trocar a empresa ou sair pedem confirmação. "Alterado" compara a forma canônica do rascunho com a do salvo: mover e voltar não conta como alteração.

**Coluna da esquerda** (só na edição): abas **Disponíveis** (campos fora do formulário) e **Em uso** (campos no formulário), com contador e busca pelo nome do campo na definição. Em Disponíveis, arraste o campo para uma linha ou use o "+" (vai para a última linha do card aberto, se couber, senão para uma linha nova); em Em uso, o × tira o campo do formulário. Entre a coluna e as linhas, o **trilho**: Usar todos (todos os disponíveis no card aberto) e Tirar todos (todos do card aberto, menos os campos do sistema).

**Painéis, cards e linhas.** Painéis em abas e cards em pílulas, com o número de campos; na edição, + verde (Adicionar painel / Adicionar card), lixeira (Excluir) e, nos cards, a largura inteiro ↔ meio. Painel novo é "Painel N" com um card "Dados"; card novo é "Card N", inteiro; os dois nascem em renomear (dois cliques renomeiam: Enter grava, Esc cancela). Excluir painel, card ou linha devolve os campos para Disponíveis. Cada linha mostra "LINHA N", o x/y (campos na linha / limite do card: 7 no card inteiro, 4 no meio) e, na edição, a lixeira e o "+ Campo" (que marca a linha como destino do próximo "+"); "Adicionar linha" põe uma linha vazia no fim do card. Quando a faixa não cabe, setas ‹ › andam uma aba por vez. No configurador cada campo ocupa 1/limite da linha; o formulário divide a linha entre os campos presentes.

**Arrastar.** Campo, item de Disponíveis, cabeçalho de linha, aba de painel e pílula de card arrastam com o ponteiro (começa depois de 4 px; Esc cancela; soltar fora de um alvo não muda nada). Numa linha com vaga, o vão abre com o nome do campo; numa linha cheia, o campo sob o ponteiro troca de lugar com o arrastado (vindo da coluna, o de lá volta para Disponíveis); soltar na coluna tira o campo do formulário.

**Inspetor** (⚙ do campo, ou Enter / Espaço no campo): painel "Propriedades do campo" à direita com o rótulo, o tipo e as propriedades que o documento guarda — rótulo no formulário (`fieldLabels`; "Voltar ao nome do sistema"), Obrigatório (`requiredFieldIds`), Visível (`hiddenFieldIds`: o campo continua na linha, oculto no formulário), Somente leitura (`lockedFieldIds`) e Valor padrão Nenhum / Fixo (`fieldDefaultValues`; caixa vazia não grava). Ligar Obrigatório liga Visível e desliga Somente leitura, num passo só. Pré-visualizar esconde os campos com Visível desligado.

**Regras que valem sobre a tela.** Campo do sistema (obrigatório na definição) não sai do formulário, não fica oculto e continua obrigatório: o × dele fica desabilitado, e linha, card ou painel que o contém não se exclui. Campo só leitura na definição tem Somente leitura travado e não fica obrigatório. Todo campo fora das linhas vai para `hiddenFieldIds` (sem isso o normalizador o devolveria no card "Outros campos"). Ao abrir o rascunho e ao salvar, as linhas de cada card são renumeradas r1..rN e o `order` de painéis e cards, 1..n.

**Restaurar padrão e padrão da organização.** Restaurar padrão (na edição, com personalização do usuário) pede confirmação e apaga a personalização do usuário: a tela volta ao padrão da organização ou, sem ele, ao do sistema. **Padrão da organização** (quem tem `screen_layouts.edit`) abre o menu "Usar este layout como padrão da organização" / "Remover o padrão da organização"; durante a edição fica desabilitado — salve antes. A distribuição do layout a perfis e usuários (o "Publicar" do desenho) depende de contrato novo e fica para uma fatia F1.

Testes: `apps/web/e2e/configuracao-layout-desenho.spec.ts` (CL-1…CL-13, no cadastro `equipments`) e o caso "configuração de layout" de `apps/web/e2e/personalizacao.spec.ts`.
