# Telas — Dashboards

Detalhamento tela a tela (sistema de referência). Legenda: **R** = obrigatório observado (atributo required/asterisco), tipo = tipo do controle HTML observado; "Opções" mostra amostra (até 8) das opções de listas.

## SCR-002 · Indicadores Financeiros

- **Rota:** `/admin/financial-dashboard`
- **Módulo:** Dashboards > Financeiros
- **Tipo:** Dashboard
- **Finalidade:** Financeiros (dashboard)
- **Modais:** analyticsModal
- **Cards/Seções:** 

**Filtros (GET)**

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `delayed_start_date` | Dt. Ini. Vencto. | text (data) |  |
| `delayed_end_date` | Dt. Fim. Vencto. | text (data) |  |
| `position_start_date` | Dt. Baixa/Inicio | text (data) |  |
| `position_end_date` | Dt. Baixa/Fim | text (data) |  |
| `farms[]` | Fazendas | select (múltiplo) | Fazenda Maira, Fazenda São Paulo |

**Tabela** — linhas na amostra: 6

- Colunas: Centro de Custo | Receita | Despesa | Resultado | Investimento
- Totalizador: Total Consolidado R$ 47.523,00 R$ 200.918,97 R$ -153.395,97 R$ 0,00

**Tabela**

- Colunas: Categoria Financeira | Investimento
- Totalizador: Total Consolidado R$ 0,00

## SCR-003 · Indicadores Pecuária de Corte

- **Rota:** `/admin/livestock-dashboard`
- **Módulo:** Dashboards > Pecuária de Corte
- **Tipo:** Dashboard
- **Finalidade:** Pecuária de Corte (dashboard)
- **Cards/Seções:** 

**Filtros (GET)**

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `harvest_id` | Safra | select | Safra 1, TESTE, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |
| `farms[]` | Fazendas | select (múltiplo) | Fazenda Maira, Fazenda São Paulo |

## SCR-016 · Livro Caixa Digital

- **Rota:** `/admin/cash-book-dashboard`
- **Módulo:** Dashboards > Livro Caixa
- **Tipo:** Dashboard
- **Finalidade:** Livro Caixa (dashboard)
- **Modais:** Movimentações
- **Gráficos:** 2
- **Cards/Seções:** 

**Filtros (GET)**

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `year` | Período | select | Ano de 2026, Ano de 2025, Ano de 2024, Ano de 2023, Ano de 2022, Ano de 2021 |
| `proprietary_id` | Proprietário | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `operation` | Operação | select | Receber & Pagar, Receber, Pagar |

## SCR-017 · Indicadores Suprimentos

- **Rota:** `/admin/supply-dashboard`
- **Módulo:** Dashboards > Suprimentos
- **Tipo:** Dashboard
- **Finalidade:** Suprimentos (dashboard)
- **Botões/Ações (cabeçalho):** Filtrar
- **Cards/Seções:** Indicadores Suprimentos; Suprimentos; Quadro Geral

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `farms[]` | Fazendas | select (múltiplo) | Fazenda Maira, Fazenda São Paulo |
| `harvest_id` | Safra | select | Safra 2023/2024, Safra 2023/2024, Safra 2024/2025, TESTE, Safra 1 |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |

## SCR-018 · Indicadores de Depreciações

- **Rota:** `/admin/depreciation-dashboard`
- **Módulo:** Dashboards > Depreciações
- **Tipo:** Dashboard
- **Finalidade:** Depreciações (dashboard)
- **Modais:** Acesse mais e melhor crédito!
- **Cards/Seções:** Indicadores de Depreciações

**Filtros (GET)**

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `selected_equipments[]` | Máquinas | select (múltiplo) |  |
| `start_date` | Dt. Inicio | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |

- Mensagens/alertas: Não dependa só do Plano Safra, acesse mais e melhor crédito! Na Creditares te conectamos a vários financiadores simultan

## SCR-019 · Dashboard de Ativos

- **Rota:** `/admin/assets-dashboard`
- **Módulo:** Dashboards > Ativos
- **Tipo:** Dashboard
- **Finalidade:** Ativos (dashboard)
- **Modais:** Acesse mais e melhor crédito!
- **Gráficos:** 2
- **Cards/Seções:** Dashboard de Ativos; Valor Atual dos Equipamentos por Família; Ativos Mais Caros

**Filtros (GET)**

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `families[]` | Máquinas | select (múltiplo) | Implementos Agrícolas, Máquinas Agrícolas, Equipamentos Agrícolas, Veículos Automotores, Construções e Instalações, Culturas Perenes, Móveis e Equipamentos, Imóveis Rurais e Urbanos |
| `date` | Data | text (data) |  |
| `farm_id` | Fazenda | select | Todas, Fazenda Maira, Fazenda São Paulo |
| `status` | Status | select | Todos, Ativo, Inativo |
| `proprietary_id` | Proprietário Gestor | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |

- Mensagens/alertas: Não dependa só do Plano Safra, acesse mais e melhor crédito! Na Creditares te conectamos a vários financiadores simultan

## SCR-020 · Análise de Usuários

- **Rota:** `/admin/user-analysis-dashboard`
- **Módulo:** Dashboards > Análise de Usuários
- **Tipo:** Dashboard
- **Finalidade:** Análise de Usuários (dashboard)
- **Gráficos:** 1
- **Cards/Seções:** 

**Filtros (GET)**

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |

**Tabela** — linhas na amostra: 3

- Colunas: Usuário | Fazenda | Status | Duração

## SCR-021 · Pluviômetro

- **Rota:** `/admin/rainfall-dashboard`
- **Módulo:** Dashboards > Pluviometria
- **Tipo:** Dashboard
- **Finalidade:** Pluviometria (dashboard)
- **Gráficos:** 2
- **Cards/Seções:** 

**Filtros (GET)**

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Data início | text |  |
| `end_date` | Data final | text |  |
| `farm_id` | Fazenda | select | Fazenda Maira, Fazenda São Paulo |
| `areas[]` | Áreas | select (múltiplo) | 01, 02, 03, 04, 05, 06, 07, 08 … (10) |

## SCR-022 · Lotação de Currais

- **Rota:** `/admin/feedlot-dashboard`
- **Módulo:** Dashboards > Lotação de Currais
- **Tipo:** Dashboard
- **Finalidade:** Lotação de Currais (dashboard)
- **Gráficos:** 2
- **Cards/Seções:** 

**Filtros (GET)**

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `yard_id` | Pátio | select | Pátio 01, PATIO 01, Confinamento, Pátio, Confinamento, Geral, Confinamento Novo Mundo, carlos … (15) |
| `sectors[]` | Setor | select (múltiplo) | Setor 01, Setor 02 |

## SCR-023 · Custos do Confinamento

- **Rota:** `/admin/feedlot-cost-dashboard`
- **Módulo:** Dashboards > Custos do Confinamento
- **Tipo:** Dashboard
- **Finalidade:** Custos do Confinamento (dashboard)
- **Gráficos:** 2
- **Cards/Seções:** 

**Filtros (GET)**

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Data início | text |  |
| `end_date` | Data final | text |  |
| `yard_id` | Pátio | select |  |
| `sector_ids[]` | Setor | select (múltiplo) |  |

## SCR-024 · Desempenho de Lotes

- **Rota:** `/admin/feedlot-performance-dashboard`
- **Módulo:** Dashboards > Desempenho de Lotes
- **Tipo:** Dashboard
- **Finalidade:** Desempenho de Lotes (dashboard)
- **Cards/Seções:** 

**Filtros (GET)**

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `yard_id` | Pátio | select |  |
| `sector_id` | Setor | select |  |
| `corral_id` | Curral | select |  |

**Tabela** — linhas na amostra: 1

- Colunas: Curral | Animais | Ocupação | Dias Confinamento | Peso Médio (kg) | GMD (kg/dia) | Meta GMD | Consumo MS (kg/dia) | Meta Consumo (kg/dia) | Mortalidade | Status

## SCR-025 · Dashboard Estoque de Nutrição

- **Rota:** `/admin/nutrition-stock-dashboard`
- **Módulo:** Dashboards > Estoque Nutrição
- **Tipo:** Dashboard
- **Finalidade:** Estoque Nutrição (dashboard)
- **Gráficos:** 1
- **Cards/Seções:** 

**Filtros (GET)**

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `days` | Período de consumo | select | Últimos 7 dias, Últimos 15 dias, Últimos 30 dias, Últimos 60 dias, Últimos 90 dias |

## SCR-026 · Dashboard Consumo vs Fornecido

- **Rota:** `/admin/feed-consumption-dashboard`
- **Módulo:** Dashboards > Consumo de Ração
- **Tipo:** Dashboard
- **Finalidade:** Consumo de Ração (dashboard)
- **Cards/Seções:** 

**Filtros (GET)**

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `period_start` | Data Início | text (data) |  |
| `period_end` | Data Fim | text (data) |  |
| `batch_id` | Lote | select | Todos os lotes |

