# Arquitetura de UX — reorganização funcional

O sistema nasceu replicando a estrutura de telas do sistema de referência (455 telas, menu com 9 grupos de "Cadastros Base",
13 dashboards soltos, uma tela por etapa/tipo). A partir desta reorganização a qualidade **não** é medida por quantidade de
telas: o objetivo é **complexidade interna controlada + experiência externa simples**.

Princípios aplicados:

- **Uma área por módulo** (`/modulo?tab=…&sub=…`): abas e sub-abas montadas conforme as permissões do usuário
  (`components/workspace.tsx`). Só a aba ativa é renderizada; a aba fica na URL (links, favoritos, redirecionamentos).
- **Nada mudou por baixo**: mesmas APIs, serviços, máquinas de estado, ledger, auditoria, idempotência, RLS e permissões.
  Unificar tela ≠ unificar endpoint: cada operação continua chamando a rota específica (ver `docs/ARCHITECTURE.md`).
- **Sem alteração de schema**: nenhuma migration foi criada por causa da UX.
- **Ações contextuais** em vez de itens de menu quando a operação depende de um registro existente.
- **Cadastros técnicos** moram em **Configurações**; cadastros de uso frequente moram no módulo onde são usados.
- **Compatibilidade**: rotas antigas de listagem redirecionam (307, parâmetros preservados) para a aba equivalente —
  tabela única em `apps/web/redirects.mjs`, usada pelo `next.config.ts` e pela auditoria de paridade. Rotas de
  detalhe/criação (`/x/[id]`, `/x/new`) e `/cadastros/<recurso>[/id]` não mudaram.

## Menu anterior → novo

| Antes (grupos do menu) | Depois |
|---|---|
| Painel de Controle · Dashboards (13) · Cadastros Base (9 grupos, ~45 itens) · Administrativo (Suprimentos 8, Estoque 14, Gestão Pessoal 8, Documentos 2) · Operacional (Pecuária ~35, Pluviometria, Vendas 3, OS 3) · Financeiro (9) · Gestão de Frota (6) · Gestão Fiscal (3) · Relatórios · Integrações (2) · Administração (3) — **~150 itens** | Início · Compras (2) · Estoque (6) · Financeiro (6) · Vendas (1) · Pecuária (7) · Frota e Ativos (5) · Pessoas e RH (5) · Ordens de Serviço · Fiscal · Relatórios · Configurações (12) — **47 itens**, cada um abrindo uma área com abas |

Dashboards deixaram de ser uma seção: cada módulo tem sua **Visão Geral** (`features/dashboards/dashboard.tsx`, mesmas
consultas de `/api/dashboards/*`). O Início continua com os indicadores executivos.

## Antes → depois por módulo

### Compras (`/compras`)
| Antes | Depois |
|---|---|
| Meus Processos, Solicitação, Rejeitados/Cancelados, Cotações, Autorização, Compras, Recebimentos (7 telas, mesmo componente) | **Processos de Compra** com sub-abas Todos · Meus · Solicitações · Cotação · Aprovação · Compra · Recebimento · Finalizados · Cancelados (uma lista, filtro por etapa; API ganhou `stage=finished`) |
| Dashboard Suprimentos | aba **Visão Geral** |
| Parâmetros SLA (menu) | Configurações › Compras › SLA (Autorizadores idem) |
| Nova Solicitação (botão na lista) | **+ Novo** da área |
Preservado: máquina de estados, SLA, responsáveis, aprovações, cotações, `version` otimista, histórico, regras de recebimento.

### Estoque (`/estoque`)
| Antes | Depois |
|---|---|
| — | **Visão Geral** (valor em estoque, abaixo do mínimo, vencimentos, últimas movimentações — composta das consultas existentes) |
| Saldo Estoque; Movimentos (ledger); Correção de Estoque | **Saldo** (ação por linha **Ajustar estoque**) · **Movimentações** (Ledger · Ajustes de estoque) |
| Doc. Fiscal/Entrada, Entrada/Insumos, DFe Recebidas, Aprovação de Notas | **Entradas e Recebimentos**: Lançadas · Entradas manuais · DFe/XML · Em conferência |
| Baixa de Estoque, Requisição/Saída, Devolução/Entrada | **Saídas**: Requisições · Saídas diretas · Devoluções; requisição confirmada → **Devolver itens** (devolução pré-preenchida) |
| Trans. Armazém, Trans. Fazendas | **Transferências**: Entre armazéns · Entre fazendas |
| Formulação, Batida | **Fábrica de Ração**: Fórmulas · Produções · Consumo · Custos ("batida" apresentada como produção) |
| Estoques Iniciais (Cadastros Base) | Configurações › Implantação › Saldos iniciais de estoque |
| Perfis de Lançamento (menu Estoque) | Configurações › Produtos e Classificações |
| — | **+ Novo**: Entrada manual · Documento fiscal/XML · Requisição · Saída direta · Transferência (armazéns/fazendas) · Devolução · Ajuste · Produção de ração (cada um na sua rota/regra) |

### Financeiro (`/financeiro`)
| Antes | Depois |
|---|---|
| Contas a Pagar, Contas a Receber | **Contas**: A Pagar · A Receber; **+ Novo**: Nova despesa / Nova receita / Novo movimento bancário |
| Mov. Caixa/Bancário, Fluxo Bancário, Contas Bancárias (Cadastros Base) | **Tesouraria**: Extrato · Fluxo de Caixa · Contas Bancárias |
| Importação OFX, Meses Conciliados | **Conciliação Bancária**: Importar OFX · Pendências · Histórico |
| Prev. Orçamentária | **Planejamento** |
| Gestão Contratos | aba **Contratos** |
| Dashboard Financeiro | **Visão Geral** |
| Congelamentos, Categorias, Tipos de Título, Formas de Pagamento, Plano de Contas, Saldo Inicial | Configurações › Financeiro / Implantação |

### Vendas (`/vendas`)
Orçamentos · Pedidos · Vendas viraram abas da mesma área; conversões (Orçamento → Pedido → Venda) continuam no detalhe do documento.

### Pecuária (`/pecuaria`)
| Antes | Depois |
|---|---|
| Gestão Animais, Localiza Animal, Processamentos, Lotes Animais | **Rebanho**: Animais · Buscar animal (localização) · Pendentes de processamento · Lotes |
| Vendas, Compras, Nascimentos, Mortes, Perdas (5 telas) | **Movimentações** (5 sub-abas) + **+ Novo › Nova movimentação: tipo** |
| Pesagem, Nutrição, Sanitário, Desmama, Apartação, Pastagem; Evolução/Rebanho | **Manejos** (6 sub-abas + Evolução de categoria, reposicionada como manejo) |
| Animais/Lote, Agrupar/Lotes, Lote/Módulo/Área, Lote/Fazenda | **Movimentar Rebanho**: Animais entre lotes · Lote → módulo/área/curral · Entre fazendas · Agrupar lotes |
| Gerenciamento Avançado, Estação de Monta, Touros/Sêmen, Protocolos, Acasalamento | **Reprodução** (`/pecuaria/reproducao`): Visão Geral · Estações · Reprodutores · Protocolos · Acasalamentos e Diagnósticos |
| Dashboard Pecuária | **Visão Geral** |
| Planejamento, Espécies/Categorias/Raças, Parâmetros/Peso, Forragem, Módulo Pastejo, Áreas, Cochos, Operações, Atividades | Configurações › Pecuária |

### Confinamento (`/confinamento`)
Pátios → Setores → Currais como **Estrutura** (sub-abas numeradas na hierarquia) · **Dietas** (Dietas · Fases) · **Produção** (bateladas) ·
**Trato** · **Leitura de Cocho** · **Mapa** · **Visão Geral** (lotação, estoque de nutrição) · **Desempenho** (ganho por lote, custos,
consumo). Os 5 dashboards do confinamento foram absorvidos.

### Frota e Ativos (`/frota`)
| Antes | Depois |
|---|---|
| Inventário, Famílias de Bens (Cadastros Base); Transferência Máquinas (menu) | **Máquinas e Equipamentos**: Inventário (ação por linha **Transferir para outra fazenda**) · Famílias · Transferências |
| Abastecimentos | **Abastecimentos** |
| Manutenções, Manutenções Preventivas, Revisões Agendadas, Alertas de Frota | **Manutenções**: Corretivas · Preventivas · Agenda · Alertas |
| Depreciação Mensal, Prev. Depreciação, Dashboard Depreciações | **Depreciação**: Mensal · Previsão · Indicadores |
| Dashboard Ativos | **Visão Geral** |

### Pessoas e RH (`/pessoas`)
Cadastro único de pessoas preservado. **Pessoas** (Todas · Clientes · Fornecedores · Proprietários — papéis como filtros) ·
**Funcionários** · **Ocorrências** (Faltas · Bonificações/eventos · Eventos fixos) · **Adiantamentos** · **Apuração Mensal**.
Tipos de evento, funções e equipes: Configurações › RH.

### Ordens de Serviço (`/os`)
Todas · Minhas · Em andamento · Atrasadas (monitoramento) · Finalizadas. Avaliação continua no detalhe (OS finalizada → Avaliar).

### Fiscal (`/fiscal`)
Situação (status honesto de cada capacidade) · Documentos de entrada · Partida dobrada · Livro Caixa. Emissão NF-e/MDF-e/SPED
continua **não iniciada** e não aparece como funcionalidade operacional. Regras fiscais, naturezas, informações complementares,
tipos de documento e documentos: Configurações › Fiscal e Documentos.

### Relatórios (`/relatorios`)
Uma área: Favoritos (estrela da barra superior) · Todos · um módulo por aba · Personalizados. Filtros, exportação, impressão e
relatórios personalizados preservados (`/relatorios/[key]`, `/relatorios/personalizados/novo`).

### Configurações (`/configuracoes`, layout lateral)
Empresa e Fazendas (fazendas, centros de custo, safras, pluviometria + indicadores, parâmetros) · Produtos e Classificações ·
Compras · Financeiro · Pecuária · Frota · RH · Fiscal e Documentos · Implantação (saldos iniciais) · Usuários e Permissões
(usuários, perfis, atividade) · Integrações (configurações, exportações CSV/XLSX) · Auditoria.
"Meu Perfil" e "Notificações" ficaram só na barra superior.

## Transformações (resumo)

| Tipo | Exemplos |
|---|---|
| Telas → abas | etapas de compras, tipos de movimentação/manejo pecuário, orçamentos/pedidos/vendas, a pagar/a receber, corretivas/preventivas/agenda/alertas |
| Telas → filtros | Minhas OS, Meus Processos, Clientes/Fornecedores/Proprietários (papéis de pessoa), OFX pendências |
| Telas → ações contextuais | Devolução (requisição → Devolver itens), Correção (Saldo → Ajustar estoque), Localizar animal (Rebanho → Buscar), Avaliar OS (detalhe), Transferir máquina (inventário → Transferir) |
| Telas → Configurações | todos os cadastros técnicos, SLA, parâmetros, usuários/perfis, integrações, exportações, auditoria, saldos iniciais |
| Dashboards → Visão Geral | 13 dashboards distribuídos por Compras, Estoque, Financeiro, Pecuária, Confinamento, Frota, Fiscal, Configurações |

## Rotas antigas e compatibilidade

`apps/web/redirects.mjs` é a fonte única (98 telas de listagem/dashboard). Exemplos:

| Rota antiga | Nova |
|---|---|
| `/estoque/transferencias?kind=farm` | `/estoque?tab=transferencias&sub=farm` |
| `/financeiro/contas-a-pagar?status=overdue` | `/financeiro?tab=contas&sub=pagar&status=overdue` |
| `/suprimentos/:etapa` | `/compras?tab=processos&sub=:etapa` |
| `/pecuaria/movimentacoes/:tipo` | `/pecuaria?tab=movimentacoes&sub=:tipo` |
| `/os?mine=1` | `/os?tab=minhas` |
| `/admin/usuarios` | `/configuracoes?tab=usuarios&sub=usuarios` |
| `/dashboards/*` | aba Visão Geral do módulo correspondente |

Favoritos e notificações guardam rotas: as antigas continuam abrindo (redirect) e as novas incluem a aba
(`/estoque?tab=saldo`). A barra superior marca como ativo o item do menu pela dupla caminho + aba.

## Permissões

Unificar tela não unificou permissões: cada aba, sub-aba, opção do **+ Novo** e ação contextual declara a(s) chave(s) que exige
(`perm` em `WsTab`/`NewChooser`); um item do menu aparece se o usuário tiver **qualquer** permissão das abas da área. A autorização
real continua no servidor (`runService` → 403). Exemplo: o perfil "Operador de Estoque" vê Estoque › Saídas › Requisições, mas não
vê Fábrica de Ração nem o módulo Financeiro (coberto por `apps/web/e2e/navegacao.spec.ts`).

## Preparação para mobile/offline

As áreas são só composição de navegação no web; toda regra permanece na API e em `packages/domain`/`packages/shared`. Um app
futuro consome os mesmos endpoints (`/api/stock/*`, `/api/supply/requests?stage=`, …) e o mesmo catálogo de permissões.

## Código

- `apps/web/src/lib/nav.ts` — árvore do menu (47 entradas) e utilitários (`navKey`, `permOk`).
- `apps/web/src/components/workspace.tsx` — `Workspace`, `SubTabs`, `NewChooser`.
- `apps/web/src/features/<módulo>/*` — componentes de listagem/painéis (antes eram `page.tsx`); as páginas de área em
  `apps/web/src/app/(app)/<módulo>/page.tsx` apenas compõem abas.
- Removidos: 61 `page.tsx` de listagem/dashboard substituídos por redirecionamentos (nenhum componente ficou órfão — ver
  `git log` desta reorganização e `scripts/parity.mjs`, que falha se uma tela da referência perder mapeamento).
