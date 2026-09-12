# Padrão de interface — MODELO BASE1

Contrato de interface do ERP. Cada fase da padronização visual acrescenta uma seção; o que está aqui vale para toda
tela nova ou alterada e é verificado por guardrails (`pnpm --filter @agro/web lint` roda `nav-audit` e `copy-audit`;
`pnpm --filter @agro/domain test` verifica os rótulos de enums).

## Idioma e terminologia

### Regras gerais
- **PT-BR obrigatório** em tudo que o usuário lê: rótulos, títulos, colunas, botões, mensagens, avisos, placeholders,
  opções de seletores, rótulos de permissões e nomes de relatórios.
- **Valor interno ≠ rótulo exibido.** Chaves de API, colunas do banco, enums, parâmetros de rota, chaves de permissão,
  `data-testid` e códigos fiscais (NCM, CFOP, CST, NF-e, DFe…) nunca são traduzidos nem renomeados; o que muda é só o
  texto apresentado. Nenhum valor técnico (`written_off`, `awaiting_purchase`, `pregnant`…) chega cru à tela.
- **Rótulos de enums** vêm de uma fonte única: `ENUM_LABELS` / `enumLabel(domínio, valor)` em
  `packages/domain/src/labels.ts` (reexportado em `apps/web/src/lib/copy.ts`). Cada domínio mantém o seu contexto
  (`open` de título = "A vencer"; `open` de documento = "Aberto"). `enumLabel` nunca devolve o valor cru: vazio →
  "Não informado"; valor sem rótulo → "Desconhecido". Padrões como `LABELS[v] ?? v` são proibidos.
- **Glossário** (`COPY` em `apps/web/src/lib/copy.ts`) centraliza só os termos com alto risco de divergência
  (Situação, Painel, Informações, Aviso, Erro, Sucesso, Pesquisar, Buscar, Excluir, Remover, Fechar, "Nenhum registro
  encontrado."…). Não é obrigatório usar constante para toda palavra do sistema.
- **Capitalização**: caixa de frase ("Valor unitário", "Nova solicitação de compra", "Gerar movimento bancário").
  Title Case só em nomes próprios de módulo, tela, recurso ou entrada de catálogo (menu, permissões, relatórios:
  "Contas a Pagar", "Painel Financeiro", "Manutenções de Equipamentos").
- **Sem abreviações** em rótulos: Data (não "Dt."), Valor ("Vl."), Quantidade ("Qtd./Qtde."), Código ("Cód."),
  Observação ("Obs."), Transferência ("Transf."), Documento ("Doc."), Categoria ("Cat."), Vencimento ("Venc."),
  "com/sem/por" ("c/", "s/", "p/"). Siglas consagradas do domínio permanecem (NF-e, DFe, OFX, XML, GMD, SLA, CNPJ,
  UF, IATF, CAPEX/OPEX, "Nº" como prefixo de número de documento, "cab." como unidade).
- **Feedback**: Sucesso · Erro · Aviso · Informações (nunca Success/Error/Warning/Information). "OK" em caixa alta.

### Decisões canônicas
| Termo | Uso |
|---|---|
| **Situação** | rótulo visível do campo/coluna/filtro de status. Nunca "Status" como rótulo (a chave `status` continua). |
| **Painel** | nunca "Dashboard" (Painel de Controle, Painel Financeiro, "Painel não encontrado"). |
| **Buscar** | localizar uma tela, função, registro ou destino (busca global, "Buscar animal", "Buscar relatório"). |
| **Pesquisar** | pesquisar o conteúdo da listagem/tela atual ("Pesquisar por nome ou e-mail", "Pesquisar nesta aba"). |
| **Excluir** | apagar um registro (a ação fica na auditoria). |
| **Remover** | desfazer um vínculo/relação/associação ("Remover dos favoritos", "Remover do painel"). |
| **Fechar** | fechar diálogo/painel sem significado de negócio (botão secundário do `Confirm`). |
| **Cancelar** | cancelar a edição em curso (formulário, diálogo com campos) ou a operação de negócio — sempre com o objeto quando for negócio: "Cancelar documento", "Cancelar movimentação", "Cancelar baixa". Nunca como sinônimo genérico de fechar. |
| **Equipamento** | termo operacional geral de frota (abastecimento, manutenção, transferência, OS). "Máquina" só quando o contexto for realmente uma máquina. |
| **Bem** | termo patrimonial (inventário de bens, depreciação, painel "Bens e frota"). O módulo continua "Frota e Ativos" no menu (registro de navegação). |
| **A vencer** | sem crase ("Á vencer" é erro). Situações de título: A vencer · Vencida · Baixa parcial · Baixada · Cancelada. |

### Moeda, número, data e percentual (`apps/web/src/lib/utils.ts`)
| Helper | Uso | Exemplo |
|---|---|---|
| `brl(v)` | qualquer valor monetário exibido — nunca `"R$ " + valor` | `R$ 1.234,56` |
| `num(v, casas)` | quantidades e números para exibição (Intl pt-BR) — nunca `.toFixed()` só para exibir | `1.234,5` |
| `pct(v, casas = 1)` | percentual em **pontos percentuais** (a API já entrega 0–100) | `3.1 → 3,1%` |
| `dateBR(iso)` | datas (`dd/MM/yyyy`) — nunca `String(date)` nem fatiar ISO à mão | `12/09/2026` |
| `dateTimeBR(iso)` | data e hora curtas em pt-BR | `12/09/2026, 09:30` |
| `monthBR(iso)` | mês de referência | `09/2026` |

Valores enviados à API não mudam (ISO, decimal string): a formatação é só de apresentação. `.toFixed()` continua
válido em cálculo e serialização.

### Ambiente de demonstração
As credenciais demo (`admin@demo.local / Demo@12345`) só aparecem na tela de login quando o build declara
`NEXT_PUBLIC_DEMO_MODE=true`. Produção não define a variável.

### Guardrails
- `apps/web/scripts/copy-audit.mjs` (no `lint`): inglês residual, "Status"/"Dashboard" como rótulo, "Ok", "Á vencer",
  abreviações proibidas e renderização crua de colunas de enum (`?? String(r["status"])`, `{String(r["origin"])}`,
  coluna de enum sem `render`). Só olha texto JSX, props de rótulo, toasts e rótulos do domínio; exceções conscientes
  ficam na lista `ALLOW` com a razão.
- `packages/domain/test/labels.test.ts`: os valores conhecidos têm rótulo PT-BR; todo valor declarado em `check
  constraint` das migrations (`supabase/migrations`) tem rótulo no domínio correspondente; rótulos do domínio
  (campos, permissões, opções) sem inglês/abreviação.
- `apps/web/scripts/ui-audit.mjs` (no `lint`): overlay manual fora de `components/ui` (`fixed inset-0`, `bg-black/`,
  `role="dialog"`, `aria-modal`), `StatusBadge`/`statusTone`/`*Tone` locais, `<Badge tone={… r["status"] …}>`,
  largura própria em Dialog/Drawer e import direto de `@radix-ui/react-dialog` nas telas. A dívida existente fica em
  `scripts/ui-audit.baseline.json` (arquivo → regra → contagem): ocorrência **nova** falha; ao pagar dívida, rode
  `node scripts/ui-audit.mjs --update`. Regras duras sem baseline: `ui-barrel-self-import` (arquivo de
  `components/ui` diferente de `index.tsx` importando `./index` ou `@/components/ui`) e `ui-import-cycle` (ciclo de
  imports entre arquivos da pasta) — o barrel só reexporta e o grafo interno é acíclico:
  `button/card/badge/spinner → status-badge/overlays/states/page-header → detail-shell → index`.

## Primitives visuais (`apps/web/src/components/ui`)

Fonte única dos blocos de interface. Organização interna: leaf modules `button.tsx`, `card.tsx`, `badge.tsx`,
`spinner.tsx`; compostos `status-badge.tsx`, `states.tsx`, `overlays.tsx`, `page-header.tsx` (+ `CardHeader`),
`detail-shell.tsx`; `index.tsx` é a API pública (`import { … } from "@/components/ui"`) e só reexporta — nenhum
arquivo da pasta importa o barrel. Toda tela compõe estes blocos; nenhuma tela cria variante própria (Button2,
DialogV2, CardNew, badge de situação local…). As classes `mg-*` / `tb-*` / `erp-*` continuam sendo a identidade
visual (verde `--mg-accent`, controles de 28 px, cartões de 12 px); os primitives só as encapsulam.

### Tokens (`apps/web/src/app/globals.css`, `:root`)
| Token | Uso |
|---|---|
| `--mg-radius-control` (8 px) / `--mg-radius-card` (12 px) / `--mg-radius-dialog` (= card) | raio de controles, cartões e overlays |
| `--mg-btn-h` (28 px) / `--mg-toolbar-h` (36 px) / `--mg-field-h` (38 px) | alturas de botão, barra e campo |
| `--mg-divider`, `--mg-card-shadow`, `--mg-dialog-shadow` | borda, sombra de cartão e de overlay |
| `--mg-overlay-bg`, `--mg-z-overlay` (40), `--mg-z-dialog` (50) | fundo escurecido e camadas dos overlays (seletor/calendário ficam acima: 10000+) |
| `--mg-page-gap` (8 px) | espaçamento entre blocos da página |

### Contratos
| Primitive | Contrato | Compatibilidade |
|---|---|---|
| **PageHeader** | `title`, `subtitle`, `breadcrumbs: {label, href?}[]`, `status` (nó), `actions`, `secondaryActions`, `children` (slot inferior), `inCard`, `level` (h1/h2), `testId`. Só props — não conhece `nav.registry` nem o menu (o AppShell futuro o alimenta). Responsivo: ações quebram linha e ocupam a largura abaixo de 1024 px. | `CardHeader(title, subtitle, actions)` = `PageHeader inCard level=2` |
| **Button** | `variant`: `default` (verde, = primary) · `secondary` · `outline` · `ghost` · `danger` · `link`; `size`: `sm` · `md` · `lg` · `icon`; `loading` (spinner + `aria-busy`, desabilita). Botão só com ícone exige `aria-label`. | `buttonVariants` (cva) mantido |
| **Input / Textarea / NativeSelect / Field** | `Field(label, required, hint, error, span 1–12)` injeta `id`/`htmlFor` e o rótulo flutuante `mg-field`; `Input type="date"` vira o calendário MG; seletor de opções = `MgSelect`; referência = `RefSelect`. Sem refatorar formulários. | — |
| **Card / CardHeader / CardBody** | `Card` (`mg-card`, aceita atributos), `CardHeader` (ver PageHeader), `CardBody` (`p-4`). | mantidos |
| **Badge** | genérico: `tone` slate · green · red · amber · blue · violet + atributos HTML. Não decide tonalidade por `status`. | mantido |
| **StatusBadge** | `value` (valor técnico), `domain` (`EnumDomain`, padrão `status`), `label` (sobrescreve o rótulo — ex.: rótulo derivado pela API), `tone` (sobrescreve a família). Rótulo por `enumLabel` (vazio → "Não informado", desconhecido → "Desconhecido"; nunca o valor cru). Tonalidade central `statusTone(value, domain)` em famílias `positive` · `negative` · `warning` · `info` · `neutral` (→ Badge green/red/amber/blue/slate), tabela genérica + sobrescritas por domínio (`title_status`, `purchase_status`, `manifest_status`, `launch_status`, `diagnosis_result`, `reproductive_status`, `decision`, `audit_action`); `awaiting_*` → warning; desconhecido → neutral. Emite `data-status` e `data-tone`. | `StatusBadge({ s })` e `statusTone(s)` de `features/docs/shared` são aliases |
| **EmptyState** | `icon`, `title` (padrão "Nenhum registro encontrado."), `description`, `action`, `compact`. `data-testid="empty-state"`. | `Empty({ text })` = alias compacto |
| **LoadingState** | `label` (padrão "Carregando…"), `variant` `block` · `compact` · `inline`; reusa `Spinner`; `role="status"`. | `Spinner` continua para uso inline |
| **ErrorState** | `title` (padrão "Erro"), `error` ou `message`, `onRetry` (+ `retryLabel` "Tentar novamente"), `variant` `inline` · `block`; `role="alert"`; mostra só a primeira linha da mensagem (nunca stack trace) via `safeErrorMessage`. | `ErrorBox({ error })` = alias inline |
| **Dialog** | Radix: `open`, `onOpenChange`, `title` (obrigatório, `Title` acessível), `description` (visível; sem ela o título vira descrição sr-only), `children` (corpo rolável), `footer`, `size` `sm` (28 rem) · `md` (42 rem) · `lg` (56 rem) · `xl` (72 rem), `preventClose` (bloqueia ESC, clique fora e fechar), `hideClose`, `testId`. Overlay, sombra, raio e espaçamento pelas classes `mg-overlay` / `mg-dialog__*`; foco preso e devolvido, ESC. | — |
| **ConfirmDialog** | `title`, `description` (alias `text`), `confirmLabel` ("Confirmar"), `dismissLabel` ("Fechar"), `danger`, `loading` (impede fechar), `children`, `onConfirm`, `size` (sm). `data-testid="confirm-dialog"`, botão `confirm-dialog-confirm`. | `Confirm` = alias |
| **ActionDialog** (`features/docs/actions.tsx`) | compõe Dialog + Field + rodapé Cancelar/Confirmar; campos declarativos (`text`, `number`, `date`, `textarea`, `select`, `ref`). | — |
| **Drawer** | mesmo `@radix-ui/react-dialog` (sem lib nova): `side` `right` (padrão) · `left`, `title`, `description`, `children`, `footer`, `size` sm 360 · md 480 · lg 640 · xl 860 px, `preventClose`, `hideClose`. `role="dialog"`, título/descrição, ESC, foco preso e devolvido, overlay e botão fechar (`drawer-close`). | — |
| **DetailShell** | Card + PageHeader (`inCard`): `title`, `subtitle`, `backHref` (alias `back`) + `backLabel` ("Voltar"), `breadcrumbs`, `status` (string → `StatusBadge` no `statusDomain`, ou nó pronto), `actions`, `children`. Só composição: não carrega dados, não conhece API nem permissões. `StockDocDetail` usa o DetailShell oficial. | `DetailShell` de `features/docs/shared` reexporta |

### Uso
- Situação de registro: sempre `<StatusBadge domain="…" value={row.status} />`; `Badge` cru só para rótulos não semânticos.
- Carregando / vazio / erro genéricos: `LoadingState`, `EmptyState`, `ErrorState` (com `onRetry` quando há `refetch`);
  skeletons e mensagens funcionais específicas continuam válidos onde já existem. `LoadingOr` (`features/docs/shared`)
  já entrega os três.
- Confirmação curta: `ConfirmDialog`; ação com campos: `ActionDialog`; painel lateral de detalhe/contexto: `Drawer`
  (piloto: Configurações › Auditoria › detalhe do evento); qualquer outro modal: `Dialog` com `size` oficial.
- Telas piloto (referência de uso): DetailShell em `/pecuaria/manejo/:tipo/:id`, `/pecuaria/pesagens/:id`,
  `/frota/abastecimentos/:id`; PageHeader em Contas a Pagar/Receber (Financeiro), Saldo de Estoque (Estoque) e Perfis
  de Acesso (Configurações). E2E estrutural: `apps/web/e2e/ui-primitives.spec.ts`.
- Não faz parte deste padrão (fica como está): menu global, abas internas do Workspace, `nav.registry`, shell e sidebar.

### ItemsTable (contrato desejado — ainda não implementado)
Tabela de itens de documento (`ItemsEditor` hoje): `columns` declarativas (`key`, `label`, `kind` text/number/money/ref,
`width`, `align`), `rows` + `onChange`, linha nova por botão "Adicionar item" (`Button variant="outline" size="sm"`),
remoção por botão-ícone com `aria-label`, rodapé de totais (`num`/`brl`), validação por linha com `Field error`, teclado
(Enter = próxima célula, ESC = descarta edição), `EmptyState compact` quando vazio. Migração dos editores existentes é
slice futura; até lá cada editor mantém sua implementação.

## App Shell & Workspace (`apps/web/src/components/layout`, `apps/web/src/lib/workspace-tabs.tsx`)

Referência de interação: *Painel Multi-Telas* (protótipo HTML entregue em UI-STAB-01). Foi usado como referência
visual/comportamental de header, mega-menu, busca, contexto e barra de abas — **não** é dependência de runtime, não
entra no bundle e sua NAV demonstrativa não foi copiada: a fonte única de navegação continua `apps/web/nav.registry.mjs`.

```
AppShell
├ TopNavigation   marca · ModuleMenu (13 módulos + "Mais") · GlobalSearch (Ctrl K) · FarmSelector · Favoritos · Notificações · UserMenu
├ WorkspaceTabs   abas globais (uma por tela) sincronizadas com a URL real
└ ActiveWorkspace trilha (Módulo › Área › Registro) + tela ativa (só ela é montada)
```

### TopNavigation e MegaMenu
- Módulos = `NAV` (derivado de `MODULES`) filtrados por `permOk(modulePerm)`. Os que não cabem na largura vão para o
  botão **Mais** (medição por `ResizeObserver`; nenhum módulo fica inacessível em 1024–1920).
- Mega-menu = `megaMenuFor(moduleId, can)` (`lib/mega-menu.ts`): grupos = áreas do módulo, itens = sub-áreas (ou a
  própria área), grupo **Ações** = `type:"action"`; tudo por permissão. Abre no hover/clique/Enter/seta ↓, fecha com
  Escape (foco volta ao botão), clique fora ou ao sair do header; painel em portal preso à viewport (nunca cortado).
- Busca global reutiliza `searchNav` (módulos, áreas, sub-áreas, ações, configurações; módulos respeitam
  `modulePerm`). Ctrl K e o botão **+** da barra de abas focam a busca; escolher um resultado = `openTab(href)`.
- Fazenda: `<select>` do contexto (`X-Farm-Id`); a troca não recarrega organização/permissões (sem remontar o shell).
- Favoritos: menu ★ (adicionar/remover a tela atual; abrir favorito = `openTab` da rota canônica).

### WorkspaceTabs — identidade, URL e persistência
| Regra | Implementação |
|---|---|
| Aba = tela real | `tabFor(pathname, search)`: rota de detalhe (`DETAIL_ROUTES`) ou criação (`/new`) → chave = pathname completo (cada registro é uma aba); página de módulo (`MODULES.path`) → chave = path do módulo; demais telas → pathname |
| Abas internas ≠ abas globais | `?tab=`/`?sub=`/filtros ficam **dentro** da aba do módulo; o `href` da aba guarda a última URL e é restaurado ao focar |
| URL é a autoridade | navegar (link, deep link, voltar/avançar, redirect) → `sync` cria/foca a aba; focar aba → `router.push(href)`; copiar/refresh/deep link funcionam |
| Deduplicação | por chave (rota canônica + identidade do registro); `?page`, `?sort`, `?search` não criam abas |
| Título dinâmico | `useTabTitle(título)` — `DetailShell` publica o título ("Abastecimento 00125") sem mudar a chave |
| Aba raiz | **Início** (`/`) não fechável; fechar todas as outras mantém Início |
| Fechar | ativa a vizinha à esquerda (senão à direita) e sincroniza a URL; `Delete` no teclado; clique do meio |
| Muitas abas | rail com rolagem horizontal + menu de abas (lista todas, "Fechar as outras") + contador |
| Persistência | `sessionStorage` `agro.tabs.<org>.<usuário>` com **só metadados** (`key, href, label, kind, module`); restauração revalida permissões (`tabAllowed`) — nunca dados de registros, respostas ou permissões |
| Troca de organização | chave de armazenamento diferente → workspace limpo |
| Troca de fazenda | fecha abas de registro/criação (farm-scoped), invalida todas as consultas React Query; se a aba ativa fechou, navega para o módulo/Início; com alterações não salvas pede confirmação |
| Dirty | `useDirtyTab(dirty)` — indicador na aba; fechar aba, trocar fazenda e sair pedem `ConfirmDialog`; `beforeunload` só com alterações |
| Teclado/ARIA | `role="tablist"` "Abas abertas", `role="tab"`/`aria-selected`, setas/Home/End movem o foco, botão × com `aria-label="Fechar aba …"` |
| Performance | só a tela ativa é montada (roteamento Next); estado preservado = URL + cache React Query (`staleTime` 15 s); sem árvores React paralelas, sem cache por aba |
