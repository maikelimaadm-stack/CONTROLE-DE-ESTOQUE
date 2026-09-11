# Personalização de telas — MODELO BASE1

Réplica do **MODELO BASE1** do sistema PROJETOMG (o modelo de tela usado no cadastro de Empresas do makgestao.com), reimplementada sobre a arquitetura declarativa deste sistema e aplicada a **todos os cadastros** (`ResourceList`/`ResourceForm`) e **lançamentos** (`DocList`). Código em `apps/web/src/features/base1`.

## Anatomia da tela (listagem)
1. **Barra superior**: ícone de filtros (abre o painel lateral "Filtros"), botão verde **Novo** (e **Excluir** quando há um registro selecionado); à direita: pesquisa (ícone → pílula de 300 px com a lista "Buscar todos / Buscar favoritos / configurar"; Enter aplica; X limpa), ocultar/exibir faixa de filtros, alternância **Registro / Tabela / Cards** e **Mais opções** (ações do registro selecionado — Visualizar/Editar/Cancelar —, Duplicar, Imprimir, Exportar Excel/CSV, Histórico, Configurações, Exportar PDF, Relatório personalizado, Salvar tela como padrão da organização, Restaurar padrão da tela).
2. **Faixa de chips de filtro**: um chip por coluna/campo filtrável. O chip abre um popover com "Limpar Filtro de 'X'", **operador** (cadastros), pesquisa e a **lista de valores distintos** com contagem e "(Selecionar Tudo)" (vários valores → operador `in`), ou campo de valor/intervalo. Botões de rolagem, "Limpar todos os filtros" e, à direita, **Configurar colunas da tabela** (tabela) ou **Configurar layout dos cards** / **Configurar campos dos cards** (cards).
3. **Grade**: coluna de seleção, cabeçalho com menu por coluna (**Abrir filtro avançado**, **Auto ajustar coluna**, **Congelar/Descongelar coluna**, **Ocultar coluna**), ordenação por clique, redimensionamento por arraste, colunas congeladas fixas à esquerda, zebrado, tooltip do valor; duplo clique/clique na célula abre o **Registro**.
4. **Cards**: avatar com iniciais, "CÓDIGO • título", linhas `rótulo: valor`; 1 a 4 cards por linha; campos escolhidos pelo usuário.
5. **Rodapé**: `Selecionados · Listados · Filtrados · Totais`, quantidade por carregamento (20/50/100/200) e **Carregar mais registros** (rolagem incremental).
6. **Painel lateral "Filtros"**: um campo por filtro, Limpar / Aplicar.
7. **Modo Registro** (cadastros): barra **Novo / Editar / Excluir / Duplicar** (ou **Salvar / Cancelar**), cabeçalho "CÓDIGO • nome" com navegação `|< < n/N > >|`, painéis em abas (ou empilhados), cards brancos com campos de rótulo flutuante; ícone "Layout do formulário" leva à **Configuração de layout**.
8. **Configuração de layout** (`/cadastros/:recurso/configuracao-layout`): Voltar / Editar; campos disponíveis à esquerda (busca); painéis e cards em abas (+ / lixeira / card inteiro ou meio); linhas "Linha n (k/máx)" com os campos (verde; vermelho = obrigatório); arrastar-e-soltar ou clicar no campo e na linha; propriedades do campo (rótulo, valor padrão, travado, obrigatório, mover para card, retirar).

## Princípios
- **Uma definição, todas as telas**: os 63 cadastros nascem de `packages/domain/src/resources` e os documentos transacionais usam `DocList`. O motor de listagem (`apps/web/src/features/base1`) e o de formulário (`apps/web/src/features/resources`) são únicos: uma alteração neles propaga para todas as telas.
- **Documento JSON por (organização, usuário, módulo, tela)** em `erp.user_screen_preferences`, com `revision` (bloqueio otimista: 409 em conflito entre abas) e limite de 256 KB.
- **Precedência**: personalização do usuário > padrão da organização (`user_id null`, definido por quem tem `screen_layouts.edit` ou é owner) > padrão do código.
- **Mesma validação no cliente e no servidor**: `packages/shared/src/preferences.ts` (`normalizeListPreferences`, `normalizeFormLayout`, catálogo de operadores). A API valida contra a definição do recurso (colunas/campos conhecidos), descartando o que não existe.
- **Cache local + sincronização**: o frontend lê `localStorage` imediatamente e sincroniza com a API com debounce (400 ms), adotando a versão do servidor quando ela é mais nova.

## Listagens (`screen = list`)
| Seção | Conteúdo |
|---|---|
| `columns` | `visible[]`, `order[]`, `widths{px}`, `frozen` |
| `sort` | `{ key, dir }` padrão da listagem |
| `pageSize` | 10…200 |
| `view` | `mode: table\|cards`, `cardFields[]`, `cardsPerRow: 1\|2\|3\|4`, `density` |
| `filters` | `visible[]` (campos de filtro exibidos), `operators{campo: operador}` (padrão por campo), `saved[]` (filtros nomeados com valores), `defaultSaved` |

UI: "Configuração de colunas" (colunas disponíveis × em uso, numeradas, busca, setas, ↺), menus de coluna, popovers dos cards e itens "Salvar tela como padrão da organização" / "Restaurar padrão da tela" em **Mais opções**.

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

## Layout de formulário (`screen = form`)
Documento **painéis → cards → linhas → campos** (`FormLayout` em `@agro/shared`): `panels[]`, `cards[{panelId, colSpan 6|12, rows[{fieldIds[]}]}]`, `hiddenFieldIds`, `lockedFieldIds`, `requiredFieldIds`, `fieldSizes`, `fieldLabels`, `fieldDefaultValues`. Regras: máx. 7 campos por linha em card de largura 12 e 4 em largura 6; campo obrigatório na definição nunca pode ser ocultado; campos sem posição são anexados ao card "Outros campos". Implementado em todos os cadastros declarativos (`ResourceForm`): a página **Configuração de layout** (`apps/web/src/features/resources/form-layout.tsx`, rota `/cadastros/:recurso/configuracao-layout`) replica a tela do MG: campos disponíveis, painéis e cards em abas, linhas com arrastar-e-soltar (ou clique no campo e na linha) e propriedades por campo: rótulo exibido, valor padrão para novos registros, somente leitura, obrigatório, mover para outro card, retirar do formulário. Campos obrigatórios na definição não podem ser ocultados nem deixar de ser obrigatórios. "Salvar como padrão da organização" e "Restaurar padrão" como nas listagens.

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

## Configuração de layout (réplica do EmpLayoutConfiguratorDialog)

Grade 268 / 40 / 1fr: à esquerda os **campos disponíveis** (chips verdes; vermelho = obrigatório; duas linhas: rótulo e seção; ação "Adicionar ao painel"); no meio a coluna de transferência (Remover todos / Adicionar todos); à direita a faixa de **painéis** e a faixa de **cards** (Novo/Excluir e inteiro ↔ meio), e as **linhas** como cartões brancos ("Linha n (x/máx)"), com os chips dos campos (ações Remover do painel e Configurações), zona tracejada "Arraste um campo para adicionar nova linha" e, com um campo selecionado, o rodapé "Tipo de largura". **Editar** abre um rascunho; **Salvar** grava a preferência do usuário; **Cancelar** descarta; **Restaurar padrão** volta ao padrão da organização ou do sistema. A configuração do campo (rótulo, valor padrão, travado, obrigatório, retirar do formulário) abre ancorada ao chip.
