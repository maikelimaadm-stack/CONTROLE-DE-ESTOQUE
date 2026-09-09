# Telas — Relatórios

Detalhamento tela a tela (sistema de referência). Legenda: **R** = obrigatório observado (atributo required/asterisco), tipo = tipo do controle HTML observado; "Opções" mostra amostra (até 8) das opções de listas.

## SCR-154 · Relatório Inventário Patrimonial

- **Rota:** `/admin/equipment-report`
- **Módulo:** Relatórios > Bens/Ativo > Inventário
- **Tipo:** Relatório
- **Finalidade:** Inventário (relatório)
- **Cards/Seções:** Relatório Inventário Patrimonial

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `family` | Família | select | Todas, Construções e Instalações, Culturas Perenes, Equipamentos Agrícolas, Imóveis Rurais e Urbanos, Implementos Agrícolas, Máquinas Agrícolas, Móveis e Equipamentos … (9) |
| `proprietary` | Proprietário Gestor | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `equipment_type` | Tipo | select | Todos, Próprio, Terceirizado |
| `status` | Status | select | Ativo, Inativo |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-155 · Relatorio de Depreciação Acumulada

- **Rota:** `/admin/accumulated-depreciation-report`
- **Módulo:** Relatórios > Bens/Ativo > Depreciação Acumulada
- **Tipo:** Relatório
- **Finalidade:** Depreciação Acumulada (relatório)
- **Cards/Seções:** Relatorio de Depreciação Acumulada

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `family` | Família | select | Construções e Instalações, Culturas Perenes, Equipamentos Agrícolas, Imóveis Rurais e Urbanos, Implementos Agrícolas, Máquinas Agrícolas, Móveis e Equipamentos, Veículos Automotores |
| `status` | Status | select | Ativo, Inativo |
| `start_date` | Dt. Início Dep. | text (data) |  |
| `end_date` | Dt. Fim Dep. | text (data) |  |

## SCR-156 · Composição Rebanho

- **Rota:** `/admin/herd-composition-report`
- **Módulo:** Relatórios > Pecuária > Composição Rebanho
- **Tipo:** Relatório
- **Finalidade:** Composição Rebanho (relatório)
- **Cards/Seções:** Composição Rebanho; Filtros; Colunas; Ordenação; Exportação

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `batch_id` | Lote | select | Todos, Sem lote |
| `gender` | Sexo | select | Todos, Macho, Fêmea, Ambos |
| `breed_id` | Raça | select | Todos, Aberdeen Angus, Akaushi, Anelorado, Bonsmara, Braford, Brahman, Brangus … (37) |
| `category_id` | Categoria | select | Todos, Fêmeas > 36 meses, Fêmeas 25 a 36 meses, Fêmeas 13 a 24 meses, Fêmeas 0 a 12 meses, Machos 0 a 12 meses, Machos 13 a 24 meses, Machos 25 a 36 meses … (10) |
| `start_date` | Data de Início Entrada | text (data) |  |
| `end_date` | Data de Fim Entrada | text (data) |  |
| `start_weight` | Peso Atual Mínimo (kg) | text |  |
| `end_weight` | Peso Atual Máximo (kg) | text |  |
| `status` | Status | select | Ativo, Pendente, Morto, Perdido, Vendido, Excluído |
| `proprietary_id` | Proprietário | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `columns[]` | Selecione as Colunas Desejadas | select (múltiplo) | Identificação, Mãe, Reprodutor/Pai, Categoria, Raça, Lote, Fazenda, Sexo … (23) |
| `order` | Selecione as Colunas para Ordenação | select | Identificação, Categoria, Raça, Sexo, Data de Nascimento, Peso (kg), Última Pesagem, GMD (kg/dia) … (10) |
| `order_direction` | Ordem | select | Crescente, Decrescente |
| `type_report` | Tipo de Relatório | select | PDF, Excel |

## SCR-157 · Custeio/Área Pecuária

- **Rota:** `/admin/costing-livestock-area-report`
- **Módulo:** Relatórios > Pecuária > Custeio/Área Pecuária
- **Tipo:** Relatório
- **Finalidade:** Custeio/Área Pecuária (relatório)
- **Cards/Seções:** Custeio/Área Pecuária

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `production_cycle` | Ciclo de Produção | select |  |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |
| `areas[]` | Área | select (múltiplo) |  |
| `grazings[]` | Módulos de Pastejo | select (múltiplo) |  |

## SCR-158 · Relatório Pesagem/Animal

- **Rota:** `/admin/weighing-batch-report`
- **Módulo:** Relatórios > Pecuária > Pesagem/Animal
- **Tipo:** Relatório
- **Finalidade:** Pesagem/Animal (relatório)
- **Cards/Seções:** Relatório Pesagem/Animal

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `batch_id` | Lote | select |  |
| `category_id` | Categoria | select | Fêmeas > 36 meses, Fêmeas 25 a 36 meses, Fêmeas 13 a 24 meses, Fêmeas 0 a 12 meses, Machos 0 a 12 meses, Machos 13 a 24 meses, Machos 25 a 36 meses, Machos > 36 meses … (42) |
| `animal_id` | Animal | select | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-159 · Relatório Pesagem/Lote

- **Rota:** `/admin/accumulated-weighing-batch-report`
- **Módulo:** Relatórios > Pecuária > Pesagem/Lote
- **Tipo:** Relatório
- **Finalidade:** Pesagem/Lote (relatório)
- **Cards/Seções:** Relatório Pesagem/Lote

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `batch_id` | Lote | select |  |
| `category_id` | Categoria | select | Fêmeas > 36 meses, Fêmeas 25 a 36 meses, Fêmeas 13 a 24 meses, Fêmeas 0 a 12 meses, Machos 0 a 12 meses, Machos 13 a 24 meses, Machos 25 a 36 meses, Machos > 36 meses … (42) |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `only_active_batch` | Apenas Animal Ativos | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `report_type` | Tipo de Relatório | select | PDF, Excel |

## SCR-160 · Relatório de Pesagem do Confinamento

- **Rota:** `/admin/feedlot-weighing-performance-report`
- **Módulo:** Relatórios > Pecuária > Pesagem Confinamento
- **Tipo:** Relatório
- **Finalidade:** Pesagem Confinamento (relatório)
- **Cards/Seções:** Relatório de Pesagem do Confinamento

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `corral_id` | Curral | select |  |
| `batch_id` | Lote | select |  |
| `report_type` | Tipo de Relatório | select | PDF, Excel |

## SCR-161 · Relatório Nutrição: Consumo / Lote

- **Rota:** `/admin/nutrition-report`
- **Módulo:** Relatórios > Pecuária > Nutrição Consumo/Lote
- **Tipo:** Relatório
- **Finalidade:** Nutrição Consumo/Lote (relatório)
- **Cards/Seções:** Relatório Nutrição: Consumo / Lote

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `category_id` | Categoria | select | Fêmeas > 36 meses, Fêmeas 0 a 12 meses, Fêmeas 13 a 24 meses, Fêmeas 25 a 36 meses, Machos > 36 meses, Machos 0 a 12 meses, Machos 13 a 24 meses, Machos 25 a 36 meses … (9) |
| `batch_id` | Lote | select |  |
| `start_date` | Data Inicial | text (data) |  |
| `end_date` | Data Final | text (data) |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-162 · Relatório Sanitário/lote

- **Rota:** `/admin/sanitaries-batch-report`
- **Módulo:** Relatórios > Pecuária > Sanitário/Lote
- **Tipo:** Relatório
- **Finalidade:** Sanitário/Lote (relatório)
- **Cards/Seções:** Relatório Sanitário/lote

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `category_id` | Categoria | select | Fêmeas > 36 meses, Fêmeas 25 a 36 meses, Fêmeas 13 a 24 meses, Fêmeas 0 a 12 meses, Machos 0 a 12 meses, Machos 13 a 24 meses, Machos 25 a 36 meses, Machos > 36 meses … (9) |
| `feedlot_corral_id` | Curral | select |  |
| `batch_id` | Lote | select |  |
| `animal_id` | Animal | select | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |
| `product_id` | Produto | select |  |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-163 · Relatório Manejo/lote

- **Rota:** `/admin/management-batch-report`
- **Módulo:** Relatórios > Pecuária > Manejo/Lote
- **Tipo:** Relatório
- **Finalidade:** Manejo/Lote (relatório)
- **Cards/Seções:** Relatório Manejo/lote

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `category_id` | Categoria | select | Fêmeas > 36 meses, Fêmeas 25 a 36 meses, Fêmeas 13 a 24 meses, Fêmeas 0 a 12 meses, Machos 0 a 12 meses, Machos 13 a 24 meses, Machos 25 a 36 meses, Machos > 36 meses … (9) |
| `batch_id` | Lote | select |  |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |

## SCR-164 · Relatório Animais/Categoria

- **Rota:** `/admin/category-animal-report`
- **Módulo:** Relatórios > Pecuária > Estq. Animais/Categoria
- **Tipo:** Relatório
- **Finalidade:** Estq. Animais/Categoria (relatório)
- **Cards/Seções:** Relatório Animais/Categoria

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `category_id` | Categoria | select | Todas, Fêmeas > 36 meses, Fêmeas 25 a 36 meses, Fêmeas 13 a 24 meses, Fêmeas 0 a 12 meses, Machos 0 a 12 meses, Machos 13 a 24 meses, Machos 25 a 36 meses … (10) |
| `batch_id` | Lote | select |  |
| `proprietary_id` | Proprietário Gestor | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |
| `harvest_id` | Safra | select | Todas, Safra 2023/2024, Safra 2023/2024, Safra 2024/2025, TESTE, Safra 1 |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-165 · Transferência Lote/Módulo/Área

- **Rota:** `/admin/report-transfer-batch-grazing-area`
- **Módulo:** Relatórios > Pecuária > Transf/Lote/Módulo/Área
- **Tipo:** Relatório
- **Finalidade:** Transf/Lote/Módulo/Área (relatório)
- **Cards/Seções:** Transferência Lote/Módulo/Área

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `batch_id` | Lote | select |  |

## SCR-166 · Estoque de Rebanho

- **Rota:** `/admin/animals-report`
- **Módulo:** Relatórios > Pecuária > Estoque/Rebanho
- **Tipo:** Relatório
- **Finalidade:** Estoque/Rebanho (relatório)
- **Cards/Seções:** Estoque de Rebanho

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `species[]` | Espécies | select (múltiplo) | Bovinos de Corte |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |

## SCR-167 · Relatório Aplicação/Manejo da Pecuária

- **Rota:** `/admin/application-management-report`
- **Módulo:** Relatórios > Pecuária > Aplicação/Manejo
- **Tipo:** Relatório
- **Finalidade:** Aplicação/Manejo (relatório)
- **Cards/Seções:** Relatório Aplicação/Manejo da Pecuária

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `production_cycle` | Ciclo de Produção | select |  |
| `area_ids[]` | Área | select (múltiplo) | 01, 02, 03, 04, 05, 06, 07, 08 … (10) |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |

## SCR-168 · Relatório de Movimentação de Rebanho

- **Rota:** `/admin/animal-movements-report`
- **Módulo:** Relatórios > Pecuária > Movimentação/Rebanho
- **Tipo:** Relatório
- **Finalidade:** Movimentação/Rebanho (relatório)
- **Cards/Seções:** Relatório de Movimentação de Rebanho

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `harvest_id` | Safra | select | TESTE, Safra 1, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |
| `month` | Mês | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-169 · Relatório Desmama

- **Rota:** `/admin/weaning-report`
- **Módulo:** Relatórios > Pecuária > Desmamas
- **Tipo:** Relatório
- **Finalidade:** Desmamas (relatório)
- **Cards/Seções:** Relatório Desmama

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Data Inicial | text (data) |  |
| `end_date` | Data Final | text (data) |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-170 · Relatório Nascimentos

- **Rota:** `/admin/birth-report`
- **Módulo:** Relatórios > Pecuária > Nascimentos
- **Tipo:** Relatório
- **Finalidade:** Nascimentos (relatório)
- **Cards/Seções:** Relatório Nascimentos

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `category_id` | Categoria | select | Fêmeas > 36 meses, Fêmeas 25 a 36 meses, Fêmeas 13 a 24 meses, Fêmeas 0 a 12 meses, Machos 0 a 12 meses, Machos 13 a 24 meses, Machos 25 a 36 meses, Machos > 36 meses … (9) |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-171 · Relatório Mortes

- **Rota:** `/admin/death-animals-report`
- **Módulo:** Relatórios > Pecuária > Mortes
- **Tipo:** Relatório
- **Finalidade:** Mortes (relatório)
- **Cards/Seções:** Relatório Mortes

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-172 · Relatório Ficha Animal

- **Rota:** `/admin/animal-record-report`
- **Módulo:** Relatórios > Pecuária > Ficha Animal
- **Tipo:** Relatório
- **Finalidade:** Ficha Animal (relatório)
- **Cards/Seções:** Relatório Ficha Animal

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `category_id` | Categoria | select | Todas, Fêmeas > 36 meses, Fêmeas 25 a 36 meses, Fêmeas 13 a 24 meses, Fêmeas 0 a 12 meses, Machos 0 a 12 meses, Machos 13 a 24 meses, Machos 25 a 36 meses … (10) |
| `batch_id` | Lote | select |  |
| `animal_id` | Animal | select | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |

## SCR-173 · Relatório Vacas Prenhas

- **Rota:** `/admin/pregnant-cows-report`
- **Módulo:** Relatórios > Pecuária > Vacas Prenhas
- **Tipo:** Relatório
- **Finalidade:** Vacas Prenhas (relatório)
- **Cards/Seções:** Relatório Vacas Prenhas

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `insemination_type` | Tipo de Inseminação | select | Natural, IATF, FIV |
| `batch_id` | Lote | select | Todos |
| `animal_id` | Animal | select | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |
| `diagnosis_pregnancy_id` | Status | select | Todos, Prenhe, Vazia, Aborto |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-174 · Relatório Vendas de Animais

- **Rota:** `/admin/animals-sales/report`
- **Módulo:** Relatórios > Pecuária > Vendas/Animais
- **Tipo:** Relatório
- **Finalidade:** Vendas/Animais (relatório)
- **Cards/Seções:** Relatório Vendas de Animais

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `sale_id` | Venda | select |  |
| `batch_id` | Lote | select |  |
| `client_id` | Cliente | select | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |
| `start_date` | Dt. Início Venda | text |  |
| `end_date` | Dt. Fim Venda | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-175 · Relatório Compras de Animais

- **Rota:** `/admin/animals-purchases/report`
- **Módulo:** Relatórios > Pecuária > Compras/Animais
- **Tipo:** Relatório
- **Finalidade:** Compras/Animais (relatório)
- **Cards/Seções:** Relatório Compras de Animais

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `purchase_id` | Compra | select |  |
| `provider_id` | Fornecedor | select | (lista dinâmica de cadastro — 10 registros; valores omitidos por privacidade) … (10) |
| `start_date` | Dt. Início Compra | text |  |
| `end_date` | Dt. Fim Compra | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-176 · Relatório Evolução de Rebanho

- **Rota:** `/admin/evolution-animals-report`
- **Módulo:** Relatórios > Pecuária > Evolução/Rebanho
- **Tipo:** Relatório
- **Finalidade:** Evolução/Rebanho (relatório)
- **Cards/Seções:** Relatório Evolução de Rebanho

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-177 · Relatório Identificação/SISBOV

- **Rota:** `/admin/identification-animals-sisbovs-report`
- **Módulo:** Relatórios > Pecuária > Identificação/SISBOV
- **Tipo:** Relatório
- **Finalidade:** Identificação/SISBOV (relatório)
- **Cards/Seções:** Relatório Identificação/SISBOV

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Data de Entrada Início | text |  |
| `end_date` | Data de Entrada Fim | text |  |
| `sale_id` | Venda | select |  |
| `client_id` | Cliente | select | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |

## SCR-178 · Relatório Mortes/SISBOV

- **Rota:** `/admin/death-animals-sisbovs-report`
- **Módulo:** Relatórios > Pecuária > Mortes/SISBOV
- **Tipo:** Relatório
- **Finalidade:** Mortes/SISBOV (relatório)
- **Cards/Seções:** Relatório Mortes/SISBOV

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |

## SCR-179 · Relatório Nascimentos/SISBOV

- **Rota:** `/admin/birth-animals-sisbovs-report`
- **Módulo:** Relatórios > Pecuária > Nascimentos/SISBOV
- **Tipo:** Relatório
- **Finalidade:** Nascimentos/SISBOV (relatório)
- **Cards/Seções:** Relatório Nascimentos/SISBOV

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |

## SCR-180 · Relatório Custo/Lote

- **Rota:** `/admin/costing-batch-report`
- **Módulo:** Relatórios > Pecuária > Custeio/Lote
- **Tipo:** Relatório
- **Finalidade:** Custeio/Lote (relatório)
- **Cards/Seções:** Relatório Custo/Lote

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `batches[]` | Lotes | select (múltiplo) |  |
| `start_date` | Data Inicial | text |  |
| `end_date` | Data Final | text |  |
| `view_mode` | Tipo de Visualização | select | Sintético, Analítico |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-181 · Relatório Custo/Módulo

- **Rota:** `/admin/costing-grazing-report`
- **Módulo:** Relatórios > Pecuária > Custeio/Módulo
- **Tipo:** Relatório
- **Finalidade:** Custeio/Módulo (relatório)
- **Cards/Seções:** Relatório Custo/Módulo

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `grazings[]` | Módulo Pastejo | select (múltiplo) |  |
| `start_date` | Data Inicial | text |  |
| `end_date` | Data Final | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-182 · Relatório Custo/Animal

- **Rota:** `/admin/costing-animal-report`
- **Módulo:** Relatórios > Pecuária > Custeio/Animal
- **Tipo:** Relatório
- **Finalidade:** Custeio/Animal (relatório)
- **Cards/Seções:** Relatório Custo/Animal

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `animal` | Animal | select | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |
| `start_date` | Data Inicial | text |  |
| `end_date` | Data Final | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-183 · Relatório Custo Total de Reprodução

- **Rota:** `/admin/total-cost-of-reproduction-report`
- **Módulo:** Relatórios > Pecuária > Custo Total/Reprodução
- **Tipo:** Relatório
- **Finalidade:** Custo Total/Reprodução (relatório)
- **Cards/Seções:** Relatório Custo Total de Reprodução

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Data Inicial | text |  |
| `end_date` | Data Final | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-184 · Relatório de Performance Animal Individual

- **Rota:** `/admin/batch-profitability-report`
- **Módulo:** Relatórios > Pecuária > Performance Animal
- **Tipo:** Relatório
- **Finalidade:** Performance Animal (relatório)
- **Cards/Seções:** Relatório de Performance Animal Individual

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `sale_id` | Venda | select |  |
| `batch_id` | Lote | select |  |
| `start_date` | Dt. Início Venda | text |  |
| `end_date` | Dt. Fim Venda | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-185 · Relatório Histórico Reprodutivo das Matrizes

- **Rota:** `/admin/reproductive-history-report`
- **Módulo:** Relatórios > Pecuária > Histórico Reprodutivo
- **Tipo:** Relatório
- **Finalidade:** Histórico Reprodutivo (relatório)
- **Cards/Seções:** Relatório Histórico Reprodutivo das Matrizes

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Data de Início | text |  |
| `end_date` | Data de Fim | text |  |
| `batch_id` | Lote | select | Todos os Lotes |
| `reproductive_status` | Situação da Matriz | select | (lista dinâmica de cadastro — 4 registros; valores omitidos por privacidade) |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-186 · Registro Genealógico

- **Rota:** `/admin/animal-family-tree-report`
- **Módulo:** Relatórios > Pecuária > Registro Genealógico
- **Tipo:** Relatório
- **Finalidade:** Registro Genealógico (relatório)
- **Cards/Seções:** Registro Genealógico

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `animal_id` | Animal | select | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |

## SCR-187 · Relatório de Eficiência de Reprodução de Touros

- **Rota:** `/admin/bull-reproductive-efficiency-report`
- **Módulo:** Relatórios > Pecuária > Eficiencia Reprodutiva Touro
- **Tipo:** Relatório
- **Finalidade:** Eficiencia Reprodutiva Touro (relatório)
- **Cards/Seções:** Relatório de Eficiência de Reprodução de Touros

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `breeding_season_id` | Estação de Monta | select |  |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-188 · Relatório de Análise de Movimentação Lote

- **Rota:** `/admin/animal-movement-analysis-report`
- **Módulo:** Relatórios > Pecuária > Análise Mov. Lote
- **Tipo:** Relatório
- **Finalidade:** Análise Mov. Lote (relatório)
- **Cards/Seções:** Relatório de Análise de Movimentação Lote

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `batch_id` | Lote | select |  |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-189 · Relatório de Produtividade De Receptora

- **Rota:** `/admin/receiver-cow-productivity-report`
- **Módulo:** Relatórios > Pecuária > Prod. Receptora
- **Tipo:** Relatório
- **Finalidade:** Prod. Receptora (relatório)
- **Cards/Seções:** Relatório de Produtividade De Receptora

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `animal_id` | Animal | select | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |
| `start_date` | Dt. Início Acasalamento | text |  |
| `end_date` | Dt. Fim Acasalamento | text |  |
| `report_type` | Tipo de Relatório | select | PDF, Excel |

## SCR-190 · Relatório de Animais por Lote com Visualização Detalhada ou Geral

- **Rota:** `/admin/animals-per-batch-report`
- **Módulo:** Relatórios > Pecuária > Animais por Lote
- **Tipo:** Relatório
- **Finalidade:** Animais por Lote (relatório)
- **Cards/Seções:** Relatório de Animais por Lote com Visualização Detalhada ou Geral

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `batches[]` | Lotes | select (múltiplo) |  |
| `view_type` | Visualização | select | Individual, Geral(Quantidade) |
| `report_type` | Tipo de Relatório | select | PDF, Excel |

## SCR-191 · Relatório Histórico de Animais/Lote

- **Rota:** `/admin/animal-batch-history-report`
- **Módulo:** Relatórios > Pecuária > Histórico de Animais/Lote
- **Tipo:** Relatório
- **Finalidade:** Histórico de Animais/Lote (relatório)
- **Cards/Seções:** Relatório Histórico de Animais/Lote

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `batch` | Lote | select |  |
| `status` | Status | select | Ativo, Pendente, Morto, Perdido, Vendido, Excluído |
| `system_id` | Com ID do Sistema | select | Não, Sim |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-192 · Relatório Controle de Lotes Ativos no Confinamento

- **Rota:** `/admin/feedlot-batch-control-report`
- **Módulo:** Relatórios > Pecuária > Lotes Confinamento
- **Tipo:** Relatório
- **Finalidade:** Lotes Confinamento (relatório)
- **Cards/Seções:** Relatório Controle de Lotes Ativos no Confinamento

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `corral_id` | Curral | select | Todos |
| `specie_id` | Espécie | select | Bovinos de Corte |
| `categories[]` | Categoria | select (múltiplo) |  |
| `breed_id` | Raça | select | Aberdeen Angus, Akaushi, Anelorado, Bonsmara, Braford, Brahman, Brangus, Caracu … (36) |
| `status` | Situação | select |  |
| `report_type` | Tipo de Relatório | select | PDF, Excel |

## SCR-193 · Relatório de Cosnumo/Planejado

- **Rota:** `/admin/feedlot-planned-consumption-report`
- **Módulo:** Relatórios > Pecuária > Consumo/Planejado
- **Tipo:** Relatório
- **Finalidade:** Consumo/Planejado (relatório)
- **Cards/Seções:** Relatório de Cosnumo/Planejado

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `corral_id` | Curral | select | Todos |
| `batch_id` | Lote | select | Todos |
| `diet_objective` | Tipo de Dieta | select | Todos, Adaptação, Crescimento, Terminação |
| `report_type` | Tipo de Relatório | select | PDF, Excel |

## SCR-194 · Relatório Operacional Diário com Resumo das Atividades do Confinamento

- **Rota:** `/admin/feedlot-summary-activity-report`
- **Módulo:** Relatórios > Pecuária > Atividades/Confinamento
- **Tipo:** Relatório
- **Finalidade:** Atividades/Confinamento (relatório)
- **Cards/Seções:** Relatório Operacional Diário com Resumo das Atividades do Confinamento

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `corral_id` | Curral | select | Todos |
| `report_type` | Tipo de Relatório | select | PDF, Excel |

## SCR-195 · Relatório de Pluviometria

- **Rota:** `/admin/rainfall-report`
- **Módulo:** Relatórios > Pluviometria
- **Tipo:** Relatório
- **Finalidade:** Pluviometria (relatório)
- **Cards/Seções:** Relatório de Pluviometria

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Data Início | text (data) |  |
| `end_date` | Data Fim | text (data) |  |
| `areas[]` | Áreas | select (múltiplo) | 01, 02, 03, 04, 05, 06, 07, 08 … (10) |
| `report_type` | Tipo de Relatório | select | PDF, Excel |

## SCR-196 · Agenda de Recebimentos

- **Rota:** `/admin/receipt-schedule-report`
- **Módulo:** Relatórios > Financeiro > Agenda/Recebimentos
- **Tipo:** Relatório
- **Finalidade:** Agenda/Recebimentos (relatório)
- **Cards/Seções:** Agenda de Recebimentos

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `clients[]` | Cliente | select (múltiplo) | (lista dinâmica de cadastro — 8 registros; valores omitidos por privacidade) |
| `farm` | Fazenda | select | Fazenda Maira, Fazenda São Paulo |
| `start_date` | Dt. Venc. Inicio | text |  |
| `end_date` | Dt. Venc. Fim | text |  |
| `proprietary_id` | Proprietário Gestor | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `center_id` | Centro de Custo | select | Todos, Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce … (9) |
| `type` | Tipo de Relatório | select | PDF, Excel |
| `categories[]` | Categorias | select (múltiplo) | 1.01.001.0001 - Venda de Grãos, 1.01.001.0002 - Venda de Frutas, 1.01.001.0003 - Venda de Hortifrutigranjeiro, 1.01.001.0004 - Venda de Forragens, 1.01.001.0005 - Venda de Madeira, 1.01.002.0001 - Venda de Moagem de Produtos Agrícolas, 1.01.002.0002 - Venda de Farinha/Farelo, 1.01.002.0003 - Venda de Sementes … (77) |

## SCR-197 · Contas a Pagar

- **Rota:** `/admin/expenses-report`
- **Módulo:** Relatórios > Financeiro > C. à Pagar
- **Tipo:** Relatório
- **Finalidade:** C. à Pagar (relatório)
- **Cards/Seções:** Contas a Pagar; Filtros; Colunas; Ordenação; Exportação

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `providers[]` | Fornecedor Marcar Todos Desmarcar Todos | select (múltiplo) | (lista dinâmica de cadastro — 42 registros; valores omitidos por privacidade) … (42) |
| `categories[]` | Categorias Financeiras Marcar Todos Desmarcar Todos | select (múltiplo) | 13º Salário, Aditivos Concentrados, Adubos Foliares, Adubos Formulados, Adubos Orgânicos, Ágio Arroba Bezerro, Ágio Arroba Boi Magro, Ágio Arroba Novilha … (209) |
| `center_id` | Centro de Custo | select | Todos, Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce … (9) |
| `proprietary_id` | Proprietário | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `farm_id` | Fazenda | select | Todas, Fazenda Maira, Fazenda São Paulo |
| `classification` | Classificação | select | Todas, Não Classificado, CAPEX, OPEX |
| `periodicity` | Periodicidade | select | Geral, Diário |
| `start_date` | Dt. Venc. Início | text (data) |  |
| `end_date` | Dt. Venc. Fim | text (data) |  |
| `start_emission_date` | Dt. Emissão Início | text (data) |  |
| `end_emission_date` | Dt. Emissão Fim | text (data) |  |
| `columns[]` | Selecione as Colunas Desejadas | select (múltiplo) | Número do Título, Número da Nota Fiscal, Fornecedor, CPF/CNPJ do Fornecedor, Proprietário, Histórico, Data de Emissão, Data de Vencimento … (19) |
| `order` | Selecione as Colunas para Ordenação | select | Data de Emissão, Data de Vencimento, Fornecedor, Proprietário, Valor Título |
| `order_direction` | Ordem | select | Crescente, Decrescente |
| `type_report` | Tipo de Relatório | select | PDF, Excel |

## SCR-198 · Contas Pagas

- **Rota:** `/admin/paid-expenses-report`
- **Módulo:** Relatórios > Financeiro > C. Pagas
- **Tipo:** Relatório
- **Finalidade:** C. Pagas (relatório)
- **Cards/Seções:** Contas Pagas; Filtros; Colunas; Ordenação; Exportação

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `providers[]` | Fornecedores Marcar Todos Desmarcar Todos | select (múltiplo) | (lista dinâmica de cadastro — 41 registros; valores omitidos por privacidade) … (41) |
| `categories[]` | Categorias Marcar Todos Desmarcar Todos | select (múltiplo) | Energia Elétrica, Telefone/Internet, Aluguéis, Água/Esgoto, Brindes/Cortesias, Viagens/Diárias, Treinamento Mão de Obra, Softwares … (209) |
| `proprietary_id` | Proprietário | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |
| `account_id` | Conta Bancária | select | 000 - Caixa Fazenda - 01, 000 - Caixa Fazenda - 02, 000 - Caixa Fazenda - 03, 000 - INVESTIMENTO 1, 56, BB Principal |
| `center_id` | Centro de Custo | select | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |
| `start_date` | Dt. Baixa/Inicio | text (data) |  |
| `end_date` | Dt. Baixa/Fim | text (data) |  |
| `start_emission_date` | Dt. Emissão Inicio | text (data) |  |
| `end_emission_date` | Dt. Emissão Fim | text (data) |  |
| `farm_id` | Fazenda | select | Fazenda Maira, Fazenda São Paulo |
| `harvest_id` | Safra | select | Safra 1, TESTE, Safra 2024/2025 |
| `classification` | Classificação | select | Todas, Não Classificado, CAPEX, OPEX |
| `columns[]` | Selecione as Colunas Desejadas | select (múltiplo) | Título, NFe, Fornecedor, CPF/CNPJ, Fazenda, Proprietário Gestor, Histórico, Produtos … (21) |
| `order` | Selecione as Colunas para Ordenação | select | Baixa, N° NFe, Emissão, Vencimento, Valor |
| `order_direction` | Ordem | select | Crescente, Decrescente |
| `type_report` | Tipo de Relatório | select | PDF, Excel |

## SCR-199 · Contas a Receber

- **Rota:** `/admin/incomes-report`
- **Módulo:** Relatórios > Financeiro > C. à Receber
- **Tipo:** Relatório
- **Finalidade:** C. à Receber (relatório)
- **Cards/Seções:** Contas a Receber; Filtros; Colunas; Ordenação; Exportação

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `clients[]` | Clientes Marcar Todos Desmarcar Todos | select (múltiplo) | (lista dinâmica de cadastro — 7 registros; valores omitidos por privacidade) |
| `categories[]` | Categorias Financeiras Marcar Todos Desmarcar Todos | select (múltiplo) | Adiantamento de Crédito de Produto, Aplicações Compulsórias, Aporte de Capital Próprio, Aporte de Capital Terceiros, Arrendamento Agrícola/Pecuária, Bolsa Mercado Futuro, Cédula Produtor Rural, Crédito Tributário … (37) |
| `center_id` | Centro de Custo | select | Todos, Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce … (9) |
| `proprietary_id` | Proprietário | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `farm_id` | Fazenda | select | Todas, Fazenda Maira, Fazenda São Paulo |
| `periodicity` | Periodicidade | select | Geral, Diário |
| `start_date` | Dt. Venc. Início | text (data) |  |
| `end_date` | Dt. Venc. Fim | text (data) |  |
| `start_emission_date` | Dt. Emissão Início | text (data) |  |
| `end_emission_date` | Dt. Emissão Fim | text (data) |  |
| `columns[]` | Selecione as Colunas Desejadas | select (múltiplo) | Número do Título, Número da Nota Fiscal, Cliente, CPF/CNPJ do Cliente, Proprietário, Histórico, Data de Emissão, Data de Vencimento … (17) |
| `order` | Selecione as Colunas para Ordenação | select | Data de Emissão, Data de Vencimento, Cliente, Proprietário, Valor Título |
| `order_direction` | Ordem | select | Crescente, Decrescente |
| `type_report` | Tipo de Relatório | select | PDF, Excel |

## SCR-200 · Contas Recebidas

- **Rota:** `/admin/paid-incomes-report`
- **Módulo:** Relatórios > Financeiro > C. Recebidas
- **Tipo:** Relatório
- **Finalidade:** C. Recebidas (relatório)
- **Cards/Seções:** Contas Recebidas; Filtros; Colunas; Ordenação; Exportação

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `clients[]` | Clientes Marcar Todos Desmarcar Todos | select (múltiplo) | (lista dinâmica de cadastro — 7 registros; valores omitidos por privacidade) |
| `categories[]` | Categorias Marcar Todos Desmarcar Todos | select (múltiplo) | Venda de Grãos, Venda de Frutas, Venda de Hortifrutigranjeiro, Venda de Forragens, Venda de Madeira, Venda de Moagem de Produtos Agrícolas, Venda de Farinha/Farelo, Venda de Sementes … (77) |
| `proprietary_id` | Proprietário | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |
| `account_id` | Conta Bancária | select | 000 - Caixa Fazenda - 01, 000 - Caixa Fazenda - 02, 000 - Caixa Fazenda - 03, 000 - INVESTIMENTO 1, 56, BB Principal |
| `center_id` | Centro de Custo | select | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |
| `start_date` | Dt. Baixa/Inicio | text (data) |  |
| `end_date` | Dt. Baixa/Fim | text (data) |  |
| `start_emission_date` | Dt. Emissão Inicio | text (data) |  |
| `end_emission_date` | Dt. Emissão Fim | text (data) |  |
| `farm_id` | Fazenda | select | Fazenda Maira, Fazenda São Paulo |
| `columns[]` | Selecione as Colunas Desejadas | select (múltiplo) | Título, NFe, Cliente, CPF/CNPJ, Fazenda, Proprietário Gestor, Histórico, Emissão … (18) |
| `order` | Selecione as Colunas para Ordenação | select | Baixa, N° NFe, Emissão, Vencimento, Vl. Baixado |
| `order_direction` | Ordem | select | Crescente, Decrescente |
| `type_report` | Tipo de Relatório | select | PDF, Excel |

## SCR-201 · Relatório de Juros Recebidos

- **Rota:** `/admin/received-interest-report`
- **Módulo:** Relatórios > Financeiro > Juros Recebidos
- **Tipo:** Relatório
- **Finalidade:** Juros Recebidos (relatório)
- **Cards/Seções:** Relatório de Juros Recebidos

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `clients[]` | Cliente | select (múltiplo) | (lista dinâmica de cadastro — 7 registros; valores omitidos por privacidade) |
| `proprietary` | Proprietário | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `start_date` | Dt. Venc. Inicio | text (data) |  |
| `end_date` | Dt. Venc. Fim | text (data) |  |
| `farm_id` | Fazenda | select | Todas, Fazenda Maira, Fazenda São Paulo |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-202 · Relatório de Juros Pagos

- **Rota:** `/admin/paid-interest-report`
- **Módulo:** Relatórios > Financeiro > Juros Pagos
- **Tipo:** Relatório
- **Finalidade:** Juros Pagos (relatório)
- **Cards/Seções:** Relatório de Juros Pagos

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `providers[]` | Fornecedor | select (múltiplo) | (lista dinâmica de cadastro — 41 registros; valores omitidos por privacidade) … (41) |
| `proprietary` | Proprietário | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `start_date` | Dt. Venc. Inicio | text (data) |  |
| `end_date` | Dt. Venc. Fim | text (data) |  |
| `farm_id` | Fazenda | select | Todas, Fazenda Maira, Fazenda São Paulo |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-203 · Extrato Financeiro

- **Rota:** `/admin/bank-statement-report`
- **Módulo:** Relatórios > Financeiro > Extrato Fin.
- **Tipo:** Relatório
- **Finalidade:** Extrato Fin. (relatório)
- **Cards/Seções:** Extrato Financeiro

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `account` | Conta Bancária | select | CXF - 000 - Caixa Fazenda - 01, CXF1 - 000 - Caixa Fazenda - 02, CXF - 000 - Caixa Fazenda - 03, CXF - 000 - INVESTIMENTO 1, 0013 - 56, BB - BB Principal |
| `proprietary` | Proprietários | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `center_id` | Centro de Custo | select | Todos, Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce … (9) |
| `categories[]` | Categorias | select (múltiplo) | 1.01.001.0001 - Venda de Grãos, 1.01.001.0002 - Venda de Frutas, 1.01.001.0003 - Venda de Hortifrutigranjeiro, 1.01.001.0004 - Venda de Forragens, 1.01.001.0005 - Venda de Madeira, 1.01.002.0001 - Venda de Moagem de Produtos Agrícolas, 1.01.002.0002 - Venda de Farinha/Farelo, 1.01.002.0003 - Venda de Sementes … (286) |
| `farm_id` | Fazenda | select | Todas, Fazenda Maira, Fazenda São Paulo |
| `condition` | Tipo | select | Sem Categoria, Com Categoria |
| `startDate` | Dt. Início | text |  |
| `endDate` | Dt. Fim | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-204 · Razão Contábil

- **Rota:** `/admin/ledger-report`
- **Módulo:** Relatórios > Financeiro > Livro Razão
- **Tipo:** Relatório
- **Finalidade:** Livro Razão (relatório)
- **Cards/Seções:** Razão Contábil

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `account` | Conta Bancária | select | CXF - 000 - Caixa Fazenda - 01, CXF1 - 000 - Caixa Fazenda - 02, CXF - 000 - Caixa Fazenda - 03, CXF - 000 - INVESTIMENTO 1, 0013 - 56, BB - BB Principal |
| `proprietary` | Proprietários | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `center_id` | Centro de Custo | select | Todos, Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce … (9) |
| `plan_account_id` | Plano de Contas | select | Todos, 1.1.1.01 - Caixa, 1.1.1.02 - Bancos, 1.1.1.03 - Cheques Recebidos, 1.1.2.01 - Contas a Receber, 1.1.2.01 - Estoque de Gado de Leite, 1.1.2.02 - Estoque de Gado Comercial Corte, 1.1.2.03 - Estoque de Gado P … (127) |
| `startDate` | Dt. Início | text |  |
| `endDate` | Dt. Fim | text |  |
| `condition` | Tipo | select | Sem Categoria, Com Categoria |
| `type` | Tipo de Relatório | select | PDF, Excel |
| `categories[]` | Categorias | select (múltiplo) | 1.01.001.0001 - Venda de Grãos, 1.01.001.0002 - Venda de Frutas, 1.01.001.0003 - Venda de Hortifrutigranjeiro, 1.01.001.0004 - Venda de Forragens, 1.01.001.0005 - Venda de Madeira, 1.01.002.0001 - Venda de Moagem de Produtos Agrícolas, 1.01.002.0002 - Venda de Farinha/Farelo, 1.01.002.0003 - Venda de Sementes … (286) |

## SCR-205 · Razão Categoria

- **Rota:** `/admin/ledger-category-report`
- **Módulo:** Relatórios > Financeiro > Razão Categoria
- **Tipo:** Relatório
- **Finalidade:** Razão Categoria (relatório)
- **Cards/Seções:** Razão Categoria

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `farm` | Fazenda | select | Fazenda Maira, Fazenda São Paulo |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `proprietary_id` | Proprietário Gestor | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `center_id` | Centro de Custo | select | Todos, Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce … (9) |
| `client_id` | Cliente | select | (lista dinâmica de cadastro — 8 registros; valores omitidos por privacidade) |
| `provider_id` | Fornecedor | select | (lista dinâmica de cadastro — 41 registros; valores omitidos por privacidade) … (41) |
| `type` | Tipo de Relatório | select | PDF, Excel |
| `categories[]` | Categorias | select (múltiplo) | 1.01.001.0001 - Venda de Grãos, 1.01.001.0002 - Venda de Frutas, 1.01.001.0003 - Venda de Hortifrutigranjeiro, 1.01.001.0004 - Venda de Forragens, 1.01.001.0005 - Venda de Madeira, 1.01.002.0001 - Venda de Moagem de Produtos Agrícolas, 1.01.002.0002 - Venda de Farinha/Farelo, 1.01.002.0003 - Venda de Sementes … (286) |

## SCR-206 · Recebimento Previsto X Realizado

- **Rota:** `/admin/rec-prev-real-report`
- **Módulo:** Relatórios > Financeiro > Rec. Prev. X Real
- **Tipo:** Relatório
- **Finalidade:** Rec. Prev. X Real (relatório)
- **Cards/Seções:** Recebimento Previsto X Realizado

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `clients[]` | Cliente | select (múltiplo) | (lista dinâmica de cadastro — 8 registros; valores omitidos por privacidade) |
| `proprietary` | Proprietário | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `center_id` | Centro de Custo | select | Todos, Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce … (9) |
| `categories[]` | Categorias | select (múltiplo) | 1.01.001.0001 - Venda de Grãos, 1.01.001.0002 - Venda de Frutas, 1.01.001.0003 - Venda de Hortifrutigranjeiro, 1.01.001.0004 - Venda de Forragens, 1.01.001.0005 - Venda de Madeira, 1.01.002.0001 - Venda de Moagem de Produtos Agrícolas, 1.01.002.0002 - Venda de Farinha/Farelo, 1.01.002.0003 - Venda de Sementes … (77) |
| `start_date` | Dt. Venc. Inicio | text |  |
| `end_date` | Dt. Venc. Fim | text |  |
| `farm_id` | Fazenda | select | Todas, Fazenda Maira, Fazenda São Paulo |
| `condition` | Tipo | select | Sem Categoria, Com Categoria |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-207 · Pagamento Previsto X Realizado

- **Rota:** `/admin/pag-prev-real-report`
- **Módulo:** Relatórios > Financeiro > Pag. Prev. X Real
- **Tipo:** Relatório
- **Finalidade:** Pag. Prev. X Real (relatório)
- **Cards/Seções:** Pagamento Previsto X Realizado

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `providers[]` | Fornecedor | select (múltiplo) | (lista dinâmica de cadastro — 41 registros; valores omitidos por privacidade) … (41) |
| `proprietary` | Proprietários | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `center_id` | Centro de Custo | select | Todos, Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce … (9) |
| `categories[]` | Categorias | select (múltiplo) | 2.01.001.0001 - Energia Elétrica, 2.01.001.0002 - Telefone/Internet, 2.01.001.0003 - Aluguéis, 2.01.001.0004 - Água/Esgoto, 2.01.001.0005 - Brindes/Cortesias, 2.01.001.0006 - Viagens/Diárias, 2.01.001.0007 - Treinamento Mão de Obra, 2.01.001.0008 - Softwares … (209) |
| `start_date` | Dt. Venc. Inicio | text |  |
| `end_date` | Dt. Venc. Fim | text |  |
| `farm_id` | Fazenda | select | Todas, Fazenda Maira, Fazenda São Paulo |
| `condition` | Tipo | select | Sem Categoria, Com Categoria |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-208 · Previsto x Realizado Anual

- **Rota:** `/admin/budget-planning-predicted-report`
- **Módulo:** Relatórios > Financeiro > Prev. x Reali. Anual
- **Tipo:** Relatório
- **Finalidade:** Prev. x Reali. Anual (relatório)
- **Cards/Seções:** Previsto x Realizado Anual

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `farm_id` | Fazenda | select | Todas, Fazenda Maira, Fazenda São Paulo |
| `year` | Ano | number |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-209 · Acesse mais e melhor crédito!

- **Rota:** `/admin/cash-flow-by-category-report`
- **Módulo:** Relatórios > Financeiro > Fluxo de Caixa Mensal
- **Tipo:** Relatório
- **Finalidade:** Fluxo de Caixa Mensal (relatório)
- **Cards/Seções:** 

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `group` | Regime | select | Caixa, Competência |
| `accounts[]` | Conta Bancária | select (múltiplo) | CXF - 000 - Caixa Fazenda - 01, CXF1 - 000 - Caixa Fazenda - 02, CXF - 000 - Caixa Fazenda - 03, CXF - 000 - INVESTIMENTO 1, 0013 - 56, BB - BB Principal |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |
| `last_balance` | Utilizar Saldo Anterior | select | Sim, Não |
| `proprietary` | Proprietários | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `center_id` | Centro de Custo | select | Todos, Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce … (9) |
| `farm_id` | Fazenda | select | Fazenda Maira, Fazenda São Paulo |
| `classification` | Classificação | select | Todas, Não Classificado, CAPEX, OPEX |
| `report_type` | Tipo de Relatório | select | Analítico, Sintético |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-210 · Acesse mais e melhor crédito!

- **Rota:** `/admin/cash-flow-forecast-report`
- **Módulo:** Relatórios > Financeiro > Fluxo de Caixa Mensal Previsto
- **Tipo:** Relatório
- **Finalidade:** Fluxo de Caixa Mensal Previsto (relatório)
- **Cards/Seções:** 

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |
| `proprietary` | Proprietários | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `center_id` | Centro de Custo | select | Todos, Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce … (9) |
| `farm_id` | Fazenda | select | Fazenda Maira, Fazenda São Paulo |
| `classification` | Classificação | select | Todas, Não Classificado, CAPEX, OPEX |
| `report_type` | Tipo de Relatório | select | Analítico, Sintético |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-211 · Movimentação Bancária/Financeira

- **Rota:** `/admin/financial-movement-report`
- **Módulo:** Relatórios > Financeiro > Movimento Bancário
- **Tipo:** Relatório
- **Finalidade:** Movimento Bancário (relatório)
- **Cards/Seções:** Movimentação Bancária/Financeira

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `accounts[]` | Contas Bancárias | select (múltiplo) | CXF - 000 - Caixa Fazenda - 01, CXF1 - 000 - Caixa Fazenda - 02, CXF - 000 - Caixa Fazenda - 03, CXF - 000 - INVESTIMENTO 1, 0013 - 56, BB - BB Principal |
| `proprietary` | Proprietários | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `types[]` | Tipos de Movimento | select (múltiplo) | Entrada, Saída, Trans. Interna, Financiamento/Empréstimo, Devolução de Cheque, Saldo Inicial |
| `center_id` | Centro de Custo | select | Todos, Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce … (9) |
| `categories[]` | Categorias | select (múltiplo) | 1.01.001.0001 - Venda de Grãos, 1.01.001.0002 - Venda de Frutas, 1.01.001.0003 - Venda de Hortifrutigranjeiro, 1.01.001.0004 - Venda de Forragens, 1.01.001.0005 - Venda de Madeira, 1.01.002.0001 - Venda de Moagem de Produtos Agrícolas, 1.01.002.0002 - Venda de Farinha/Farelo, 1.01.002.0003 - Venda de Sementes … (286) |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `farm_id` | Fazenda | select | Todas, Fazenda Maira, Fazenda São Paulo |
| `condition` | Tipo | select | Sem Categoria, Com Categoria |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-212 · Fiscal/Não Fiscal

- **Rota:** `/admin/fiscal-difference-report`
- **Módulo:** Relatórios > Financeiro > Fiscal/Não Fiscal
- **Tipo:** Relatório
- **Finalidade:** Fiscal/Não Fiscal (relatório)
- **Cards/Seções:** Fiscal/Não Fiscal

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `accounts[]` | Contas Bancárias | select (múltiplo) | CXF - 000 - Caixa Fazenda - 01, CXF1 - 000 - Caixa Fazenda - 02, CXF - 000 - Caixa Fazenda - 03, CXF - 000 - INVESTIMENTO 1, 0013 - 56, BB - BB Principal |
| `proprietary` | Proprietários | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `center_id` | Centro de Custo | select | Todos, Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce … (9) |
| `categories[]` | Categorias | select (múltiplo) | 1.01.001.0001 - Venda de Grãos, 1.01.001.0002 - Venda de Frutas, 1.01.001.0003 - Venda de Hortifrutigranjeiro, 1.01.001.0004 - Venda de Forragens, 1.01.001.0005 - Venda de Madeira, 1.01.002.0001 - Venda de Moagem de Produtos Agrícolas, 1.01.002.0002 - Venda de Farinha/Farelo, 1.01.002.0003 - Venda de Sementes … (286) |
| `is_fiscal` | Fiscal/Não Fiscal | select | Ambos, Não, Sim |
| `condition` | Tipo | select | Sem Categoria, Com Categoria |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-213 · Custo de Produção por Período

- **Rota:** `/admin/income-statement`
- **Módulo:** Relatórios > Financeiro > Custo de Produção
- **Tipo:** Relatório
- **Finalidade:** Custo de Produção (relatório)
- **Modais:** analyticsModal
- **Cards/Seções:** Custo de Produção por Período

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `group` | Regime | select | Caixa, Competência |
| `type` | Tipo | select | Sintético, Analítico |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `calculation_module` | Módulo de Cálculo | select | Financeiro, Apontamento (Consumo Estoque) |
| `farm_id` | Fazenda | select | Todas, Fazenda Maira, Fazenda São Paulo |
| `proprietary` | Proprietário | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `has_stock` | Mostra Estoque? | select | Não, Sim |
| `report_type` | Tipo de Relatório | select | PDF, Excel |
| `report_format` | Formato do Relatório | select | Resumido, Detalhado |
| `harvest` | Safra | select | Todos, Safra 1, TESTE, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |
| `cost_center[]` | Centro de custo | select (múltiplo) | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |

## SCR-214 · Custo de Produção por Mês

- **Rota:** `/admin/accumulated-income-statement`
- **Módulo:** Relatórios > Financeiro > Custo de Produção Acumulado
- **Tipo:** Relatório
- **Finalidade:** Custo de Produção Acumulado (relatório)
- **Modais:** analyticsModal; Acesse mais e melhor crédito!
- **Cards/Seções:** Custo de Produção por Mês

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `group` | Regime | select | Caixa, Competência |
| `type` | Tipo | select | Sintético, Analítico |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `calculation_module` | Módulo de Cálculo | select | Financeiro, Apontamento (Consumo Estoque) |
| `farm_id` | Fazenda | select | Todas, Fazenda Maira, Fazenda São Paulo |
| `proprietary` | Proprietário | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `has_stock` | Mostra Estoque? | select | Não, Sim |
| `report_type` | Tipo de Relatório | select | PDF, Excel |
| `report_format` | Formato do Relatório | select | Resumido, Detalhado |
| `harvest` | Safra | select | Todas, Safra 1, TESTE, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |
| `cost_center[]` | Centro de custo | select (múltiplo) | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |

- Mensagens/alertas: Não dependa só do Plano Safra, acesse mais e melhor crédito! Na Creditares te conectamos a vários financiadores simultan

## SCR-215 · Acesse mais e melhor crédito!

- **Rota:** `/admin/dre`
- **Módulo:** Relatórios > Financeiro > DRE
- **Tipo:** Relatório
- **Finalidade:** DRE (relatório)
- **Cards/Seções:** 

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `type_report` | Tipo | select | Sintético, Analítico |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |
| `center_id` | Centro de Custo | select | Todos, Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce … (9) |
| `farm_id` | Fazenda | select | Todas, Fazenda Maira, Fazenda São Paulo |

## SCR-216 · Acesse mais e melhor crédito!

- **Rota:** `/admin/dre-annual`
- **Módulo:** Relatórios > Financeiro > DRE Anual
- **Tipo:** Relatório
- **Finalidade:** DRE Anual (relatório)
- **Cards/Seções:** 

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `type_report` | Tipo | select | Sintético, Analítico |
| `start_year` | Ano Início | select | 2026, 2025, 2024, 2023, 2022 |
| `end_year` | Ano Fim | select | 2026, 2025, 2024, 2023, 2022 |
| `type` | Tipo de Relatório | select | PDF, Excel |
| `center_id` | Centro de Custo | select | Todos, Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce … (9) |
| `farm_id` | Fazenda | select | Todas, Fazenda Maira, Fazenda São Paulo |

## SCR-217 · Acesse mais e melhor crédito!

- **Rota:** `/admin/receipt-cashflow-report`
- **Módulo:** Relatórios > Financeiro > Fluxo Mensal de Recebimento
- **Tipo:** Relatório
- **Finalidade:** Fluxo Mensal de Recebimento (relatório)
- **Cards/Seções:** 

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `accounts[]` | Conta Bancária | select (múltiplo) | CXF - 000 - Caixa Fazenda - 01, CXF1 - 000 - Caixa Fazenda - 02, CXF - 000 - Caixa Fazenda - 03, CXF - 000 - INVESTIMENTO 1, 0013 - 56, BB - BB Principal |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |
| `proprietary` | Proprietários | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `center_id` | Centro de Custo | select | Todos, Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce … (9) |
| `categories[]` | Categorias | select (múltiplo) | 1.01.001.0001 - Venda de Grãos, 1.01.001.0002 - Venda de Frutas, 1.01.001.0003 - Venda de Hortifrutigranjeiro, 1.01.001.0004 - Venda de Forragens, 1.01.001.0005 - Venda de Madeira, 1.01.002.0001 - Venda de Moagem de Produtos Agrícolas, 1.01.002.0002 - Venda de Farinha/Farelo, 1.01.002.0003 - Venda de Sementes … (77) |
| `farm_id` | Fazenda | select | Fazenda Maira, Fazenda São Paulo |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-218 · Relatório de Estoque/Financeiro

- **Rota:** `/admin/cashflow-product-report`
- **Módulo:** Relatórios > Financeiro > Estoque Financeiro
- **Tipo:** Relatório
- **Finalidade:** Estoque Financeiro (relatório)
- **Cards/Seções:** Relatório de Estoque/Financeiro

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-219 · Acesse mais e melhor crédito!

- **Rota:** `/admin/cost-center-report`
- **Módulo:** Relatórios > Financeiro > Centro de Custo
- **Tipo:** Relatório
- **Finalidade:** Centro de Custo (relatório)
- **Cards/Seções:** 

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `group` | Regime | select | Caixa, Competência |
| `accounts[]` | Conta Bancária | select (múltiplo) | CXF - 000 - Caixa Fazenda - 01, CXF1 - 000 - Caixa Fazenda - 02, CXF - 000 - Caixa Fazenda - 03, CXF - 000 - INVESTIMENTO 1, 0013 - 56, BB - BB Principal |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |
| `proprietary` | Proprietários | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `center_id` | Centro de Custo | select | Todos, Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce … (9) |
| `farm_id` | Fazenda | select | Fazenda Maira, Fazenda São Paulo |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-220 · Relatório de Apuração de Custos por Conta e Centro de Custo

- **Rota:** `/admin/cost-calculation-report`
- **Módulo:** Relatórios > Financeiro > Apuração de Custo
- **Tipo:** Relatório
- **Finalidade:** Apuração de Custo (relatório)
- **Cards/Seções:** Relatório de Apuração de Custos por Conta e Centro de Custo

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `farm` | Fazenda | select | Todas, Fazenda Maira, Fazenda São Paulo |
| `cost_centers[]` | Centro de Custo | select (múltiplo) | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |
| `accounts[]` | Conta Bancária | select (múltiplo) | CXF - 000 - Caixa Fazenda - 01, CXF1 - 000 - Caixa Fazenda - 02, CXF - 000 - Caixa Fazenda - 03, CXF - 000 - INVESTIMENTO 1, 0013 - 56, BB - BB Principal |
| `order_by` | Ordenação | select | + Antigo, + Recente |
| `report_type` | Tipo de Relatório | select | PDF, Excel |

- Mensagens/alertas: O relatório é limitado a 12 meses.

## SCR-221 · Relatório Financiamentos

- **Rota:** `/admin/financings-report`
- **Módulo:** Relatórios > Financeiro > Financiamentos
- **Tipo:** Relatório
- **Finalidade:** Financiamentos (relatório)
- **Cards/Seções:** Relatório Financiamentos

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-222 · Títulos de Adiantamento

- **Rota:** `/admin/advance-titles-report`
- **Módulo:** Relatórios > Financeiro > Adiantamento
- **Tipo:** Relatório
- **Finalidade:** Adiantamento (relatório)
- **Cards/Seções:** Títulos de Adiantamento

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `farm` | Fazenda | select | Fazenda Maira, Fazenda São Paulo |
| `provider_id` | Fornecedor | select | (lista dinâmica de cadastro — 39 registros; valores omitidos por privacidade) … (39) |
| `client_id` | Cliente | select | (lista dinâmica de cadastro — 7 registros; valores omitidos por privacidade) |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |
| `column_filter` | Filtrar por | select | Data de Vencimento, Data de Emissão |
| `number` | Nº Título | text |  |
| `proprietary_id` | Proprietário Gestor | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `center_id` | Centro de Custo | select | Todos, Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce … (9) |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-223 · Relatório de Conciliação de Contas Consolidadas

- **Rota:** `/admin/account-reconciliation-report`
- **Módulo:** Relatórios > Financeiro > Conciliação de Contas
- **Tipo:** Relatório
- **Finalidade:** Conciliação de Contas (relatório)
- **Cards/Seções:** Relatório de Conciliação de Contas Consolidadas

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `account` | Conta Bancária | select | Todas, CXF - 000 - Caixa Fazenda - 01, CXF1 - 000 - Caixa Fazenda - 02, CXF - 000 - Caixa Fazenda - 03, CXF - 000 - INVESTIMENTO 1, 0013 - 56, BB - BB Principal |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `condition` | Condição | select | Sem Categoria, Com Categoria |
| `provider_id` | Fornecedor | select | (lista dinâmica de cadastro — 42 registros; valores omitidos por privacidade) … (42) |
| `client_id` | Cliente | select | (lista dinâmica de cadastro — 9 registros; valores omitidos por privacidade) … (9) |
| `order_by` | Ordenação | select | + Recente, + Antigo |
| `report_type` | Tipo de Relatório | select | PDF, Excel |

## SCR-224 · Acesse mais e melhor crédito!

- **Rota:** `/admin/cost-centers-unified-report`
- **Módulo:** Relatórios > Financeiro > Centro de Custo/Unificado
- **Tipo:** Relatório
- **Finalidade:** Centro de Custo/Unificado (relatório)
- **Cards/Seções:** 

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |
| `center_id` | Centro de Custo | select | Todos, Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce … (9) |
| `farm_id` | Fazenda | select | Fazenda Maira, Fazenda São Paulo |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-225 · Relatório de Contas Tributárias e Não Tributárias

- **Rota:** `/admin/tax-accounts`
- **Módulo:** Relatórios > Financeiro > Contas Tributárias
- **Tipo:** Relatório
- **Finalidade:** Contas Tributárias (relatório)
- **Cards/Seções:** Relatório de Contas Tributárias e Não Tributárias

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `is_taxation` | Tributada | select | Todas, Sim, Não |
| `cost_center` | Centro de Custo | select | Todos, Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce … (9) |
| `provider` | Fornecedor | select | (lista dinâmica de cadastro — 42 registros; valores omitidos por privacidade) … (42) |
| `report_type` | Tipo de Relatório | select | PDF, Excel |

## SCR-226 · Relatório Consolidado de Contas a Pagar e Receber

- **Rota:** `/admin/accounts-payable-receivable-report`
- **Módulo:** Relatórios > Financeiro > Consolidado Pagar/Receber
- **Tipo:** Relatório
- **Finalidade:** Consolidado Pagar/Receber (relatório)
- **Cards/Seções:** Relatório Consolidado de Contas a Pagar e Receber

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_emission_date` | Dt. Emissão Inicio | text (data) |  |
| `end_emission_date` | Dt. Emissão Fim | text (data) |  |
| `start_write_off_date` | Dt. Baixa/Inicio | text (data) |  |
| `end_write_off_date` | Dt. Baixa/Fim | text (data) |  |
| `client` | Cliente | select | (lista dinâmica de cadastro — 8 registros; valores omitidos por privacidade) |
| `provider` | Fornecedor | select | (lista dinâmica de cadastro — 41 registros; valores omitidos por privacidade) … (41) |
| `center` | Centro de Custo | select | Todos, Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce … (9) |
| `account` | Conta Bancária | select | Todas, CXF - 000 - Caixa Fazenda - 01, CXF1 - 000 - Caixa Fazenda - 02, CXF - 000 - Caixa Fazenda - 03, CXF - 000 - INVESTIMENTO 1, 0013 - 56, BB - BB Principal |
| `category` | Categoria | select | Todas, Venda de Grãos, Venda de Frutas, Venda de Hortifrutigranjeiro, Venda de Forragens, Venda de Madeira, Venda de Moagem de Produtos Agrícolas, Venda de Farinha/Farelo … (287) |
| `status[]` | Status | select (múltiplo) | Em aberto (não baixado), Baixado parcialmente, Baixado (quitado), Adiantamento |
| `report_type` | Tipo de Relatório | select | PDF, Excel |

## SCR-227 · Relatório de Saldo Devedor/Fornecedor

- **Rota:** `/admin/provider-balance-report`
- **Módulo:** Relatórios > Financeiro > Saldo Devedor/Fornecedor
- **Tipo:** Relatório
- **Finalidade:** Saldo Devedor/Fornecedor (relatório)
- **Cards/Seções:** Relatório de Saldo Devedor/Fornecedor

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `providers[]` | Fornecedores | select (múltiplo) | (lista dinâmica de cadastro — 41 registros; valores omitidos por privacidade) … (41) |
| `start_emission_date` | Emissão Início | text (data) |  |
| `end_emission_date` | Emissão Fim | text (data) |  |
| `start_due_date` | Vencimento Início | text (data) |  |
| `end_due_date` | Vencimento Fim | text (data) |  |
| `report_type` | Tipo de Relatório | select | PDF, Excel |

## SCR-228 · Relatório Movimentação Estoque

- **Rota:** `/admin/stock-movement-report`
- **Módulo:** Relatórios > Estoque > Mov. Estoque
- **Tipo:** Relatório
- **Finalidade:** Mov. Estoque (relatório)
- **Cards/Seções:** Relatório Movimentação Estoque

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `warehouse` | Armazém | select | BARRACAO |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |
| `products[]` | Produto | select (múltiplo) | Caroco Algodão, DECTOMAX INJETAVEL 500ML, PROMILL, SORGO GRÃO |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-229 · Relatório de Requisição/Saída

- **Rota:** `/admin/requisitions-report`
- **Módulo:** Relatórios > Estoque > Requisição/Saída
- **Tipo:** Relatório
- **Finalidade:** Requisição/Saída (relatório)
- **Cards/Seções:** Relatório de Requisição/Saída

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `warehouse` | Armazém | select | BARRACAO |
| `product` | Produto | select | aaaaa1, aaaaa2, aaaaa3, aaaaa4, ABRACADEIRA 13/19, adubo, ALICATE ACO TEMPERADO UNIVERSAL ISOLADO, ALTERNADOR ESTACIONADO … (113) |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `report_type` | Tipo de Relatório | select | PDF, Excel |

## SCR-230 · Relatório Baixa Estoque

- **Rota:** `/admin/stock-writeoffs-report`
- **Módulo:** Relatórios > Estoque > Baixas Estoque
- **Tipo:** Relatório
- **Finalidade:** Baixas Estoque (relatório)
- **Cards/Seções:** Relatório Baixa Estoque

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `warehouse` | Armazém | select | BARRACAO |
| `product` | Produto | select | aaaaa1, aaaaa2, aaaaa3, aaaaa4, ABRACADEIRA 13/19, adubo, ALICATE ACO TEMPERADO UNIVERSAL ISOLADO, ALTERNADOR ESTACIONADO … (113) |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |

## SCR-231 · Relatório DFe

- **Rota:** `/admin/dfe-report`
- **Módulo:** Relatórios > Estoque > DFe/Lançadas
- **Tipo:** Relatório
- **Finalidade:** DFe/Lançadas (relatório)
- **Cards/Seções:** Relatório DFe

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `issue_id` | Selecione o Emissor | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |
| `start_date` | Dt. Emissão Inicio | text (data) |  |
| `end_date` | Dt. Emissão Fim | text (data) |  |
| `start_launch_date` | Dt. Lançamento Início | text (data) |  |
| `end_launch_date` | Dt. Lançamento Fim | text (data) |  |
| `launched` | Lançada | select | Lançada, Não Lançada |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-232 · Relatório Custo Produção Batida

- **Rota:** `/admin/food-beat-report`
- **Módulo:** Relatórios > Estoque > Custo Produção Batida
- **Tipo:** Relatório
- **Finalidade:** Custo Produção Batida (relatório)
- **Cards/Seções:** Relatório Custo Produção Batida

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |
| `food_id` | Produto | select |  |

## SCR-233 · Relatório de Curva ABC

- **Rota:** `/admin/stocks-abc-report`
- **Módulo:** Relatórios > Estoque > Curva ABC/Estoque
- **Tipo:** Relatório
- **Finalidade:** Curva ABC/Estoque (relatório)
- **Cards/Seções:** Relatório de Curva ABC

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-234 · Relatório Recebimentos

- **Rota:** `/admin/receipts-report`
- **Módulo:** Relatórios > Estoque > Recebimentos
- **Tipo:** Relatório
- **Finalidade:** Recebimentos (relatório)
- **Cards/Seções:** Relatório Recebimentos

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `product` | Produto | select |  |
| `center` | Centro de custo | select | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |
| `category` | Categoria | select |  |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-235 · Relatório Estoque Consolidado

- **Rota:** `/admin/stocks-consolidated-report`
- **Módulo:** Relatórios > Estoque > Estoque Consolidado
- **Tipo:** Relatório
- **Finalidade:** Estoque Consolidado (relatório)
- **Cards/Seções:** Relatório Estoque Consolidado

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `warehouses[]` | Armazém | select (múltiplo) | BARRACAO |
| `group` | Grupo | select | Insumos Agrícola, Insumos Gerais, Insumos Industrialização, Insumos Pecuária, Máquinas/Equipamentos/Veículos, Produção, Produtos Exportação |
| `category` | Categoria | select |  |
| `kind` | Classe | select |  |
| `search` | Pesquisar por nome | text |  |
| `product` | Produto Específico | select |  |
| `date` | Data | text (data) |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-236 · Relatório de Lote/Fornecedor

- **Rota:** `/admin/stocks-lot-provider`
- **Módulo:** Relatórios > Estoque > Lote/Fornecedor
- **Tipo:** Página
- **Finalidade:** Lote/Fornecedor (página)

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `provider_id` | Fornecedor | select | (lista dinâmica de cadastro — 39 registros; valores omitidos por privacidade) … (39) |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-237 · Saída de Produtos x Centro de Custo

- **Rota:** `/admin/products-exit-cost-center-report`
- **Módulo:** Relatórios > Estoque > Saídas x Centro Custo
- **Tipo:** Relatório
- **Finalidade:** Saídas x Centro Custo (relatório)
- **Cards/Seções:** Saída de Produtos x Centro de Custo

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `startDate` | Dt. Início | text |  |
| `endDate` | Dt. Fim | text |  |
| `center` | Centro de Custo | select | Todos, Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce … (9) |
| `product` | Produto | select |  |
| `warehouse` | Armazém | select | Todos, BARRACAO |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-238 · Relatório de Suprimentos

- **Rota:** `/admin/supplies-report`
- **Módulo:** Relatórios > Suprimentos > Suprimentos
- **Tipo:** Relatório
- **Finalidade:** Suprimentos (relatório)
- **Cards/Seções:** Relatório de Suprimentos

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `farm_id` | Fazenda | select | Fazenda Maira, Fazenda São Paulo |
| `user_id` | Solicitante | select | (lista dinâmica de cadastro — 14 registros; valores omitidos por privacidade) … (14) |
| `status` | Status | select | Solicitação, Cotação em Andamento, Aguardando Aprovação, Aguardando Ciência, Pedido Não Aprovado, Aguardando a Compra, Compra Efetuada, Compra Recebida … (11) |
| `priority` | Prioridade | select | Baixa, Média, Alta |
| `authorizer_id` | Autorizador | select | (lista dinâmica de cadastro — 3 registros; valores omitidos por privacidade) |
| `number` | Nº Solicitação | text |  |
| `start_date` | Pedido / Dt. Início | text |  |
| `end_date` | Pedido / Dt. Fim | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-239 · Relatório Savings

- **Rota:** `/admin/savings-report`
- **Módulo:** Relatórios > Suprimentos > Savings
- **Tipo:** Relatório
- **Finalidade:** Savings (relatório)
- **Cards/Seções:** Relatório Savings

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `farms[]` | Fazendas | select (múltiplo) | Fazenda Maira, Fazenda São Paulo |
| `start_date` | Data Início | text (data) |  |
| `end_date` | Data Fim | text (data) |  |
| `user_id` | Comprador Responsável | select | (lista dinâmica de cadastro — 13 registros; valores omitidos por privacidade) … (13) |
| `status` | Status | select | Solicitação, Cotação em Andamento, Aguardando Aprovação, Aguardando Ciência, Pedido Não Aprovado, Aguardando a Compra, Compra Efetuada, Compra Recebida … (11) |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-240 · Relatório ANS

- **Rota:** `/admin/ans-report`
- **Módulo:** Relatórios > Suprimentos > ANS
- **Tipo:** Relatório
- **Finalidade:** ANS (relatório)
- **Cards/Seções:** Relatório ANS

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-241 · Relatório de Orçamentos/Fornecedores

- **Rota:** `/admin/request-quotation-report`
- **Módulo:** Relatórios > Suprimentos > Orçamentos
- **Tipo:** Relatório
- **Finalidade:** Orçamentos (relatório)
- **Cards/Seções:** Relatório de Orçamentos/Fornecedores

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `provider_id` | Fornecedor | select | (lista dinâmica de cadastro — 15 registros; valores omitidos por privacidade) … (15) |
| `farm_id` | Fazenda | select | Fazenda Maira, Fazenda São Paulo |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-242 · Relatório Produtos x Previsão de entrega

- **Rota:** `/admin/request-purchase-forecast-report`
- **Módulo:** Relatórios > Suprimentos > Produtos x Prev. Entrega
- **Tipo:** Relatório
- **Finalidade:** Produtos x Prev. Entrega (relatório)
- **Cards/Seções:** Relatório Produtos x Previsão de entrega

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `farm_id` | Fazenda | select | Fazenda Maira, Fazenda São Paulo |
| `user_id` | Solicitante | select | (lista dinâmica de cadastro — 14 registros; valores omitidos por privacidade) … (14) |
| `status` | Status | select | Solicitação, Cotação em Andamento, Aguardando Aprovação, Aguardando Ciência, Pedido Não Aprovado, Aguardando a Compra, Compra Efetuada, Compra Recebida … (11) |
| `priority` | Prioridade | select | Baixa, Média, Alta |
| `authorizer_id` | Autorizador | select | (lista dinâmica de cadastro — 3 registros; valores omitidos por privacidade) |
| `number` | Nº Solicitação | text |  |
| `product` | Produto | select |  |
| `service` | Serviço | text |  |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-243 · Relatório de Status de SLA

- **Rota:** `/admin/supply-status-report`
- **Módulo:** Relatórios > Suprimentos > Relatório SLA
- **Tipo:** Relatório
- **Finalidade:** Relatório SLA (relatório)
- **Cards/Seções:** Relatório de Status de SLA

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Data Inicial | text (data) |  |
| `end_date` | Data Final | text (data) |  |
| `status` | Status | select | Solicitação, Cotação em Andamento, Aguardando Aprovação, Aguardando Ciência, Pedido Não Aprovado, Aguardando a Compra, Compra Efetuada, Compra Recebida … (11) |

## SCR-244 · Relatório Gerencial de Solicitações

- **Rota:** `/admin/request-purchase-management-report`
- **Módulo:** Relatórios > Suprimentos > Gerencial de Solicitações
- **Tipo:** Relatório
- **Finalidade:** Gerencial de Solicitações (relatório)
- **Cards/Seções:** Relatório Gerencial de Solicitações

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `farm_id` | Fazenda | select | Fazenda Maira, Fazenda São Paulo |
| `type_request` | Tipo da Solicitação | select | Produto, Serviço, Adiantamento, Reembolso, Diária, Empreita, Compra Efetuada, Frete … (11) |
| `status` | Status | select | Solicitação, Cotação em Andamento, Aguardando Aprovação, Aguardando Ciência, Pedido Não Aprovado, Aguardando a Compra, Compra Efetuada, Compra Recebida … (11) |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-245 · Relatório de Vendas/Cliente

- **Rota:** `/admin/sales-report`
- **Módulo:** Relatórios > Vendas > Vendas/Cliente
- **Tipo:** Relatório
- **Finalidade:** Vendas/Cliente (relatório)
- **Cards/Seções:** Relatório de Vendas/Cliente

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `product` | Produto | select | BANANA PRATA 1º CX 15KG, ABOBORA 2° KG |
| `client_id` | Cliente | select | (lista dinâmica de cadastro — 3 registros; valores omitidos por privacidade) |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-246 · Relatório de Vendas/Produto

- **Rota:** `/admin/sales-product-report`
- **Módulo:** Relatórios > Vendas > Vendas/Produto
- **Tipo:** Relatório
- **Finalidade:** Vendas/Produto (relatório)
- **Cards/Seções:** Relatório de Vendas/Produto

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `product` | Produto | select | BANANA PRATA 1º CX 15KG, ABOBORA 2° KG |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-247 · Relatório de Vendas por Cliente/Produto

- **Rota:** `/admin/sales-client-report`
- **Módulo:** Relatórios > Vendas > Cliente/Produto
- **Tipo:** Relatório
- **Finalidade:** Cliente/Produto (relatório)
- **Cards/Seções:** Relatório de Vendas por Cliente/Produto

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `product` | Produto | select | BANANA PRATA 1º CX 15KG, ABOBORA 2° KG |
| `client_id` | Cliente | select | (lista dinâmica de cadastro — 3 registros; valores omitidos por privacidade) |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-248 · Relatório Vendas/Funcionários

- **Rota:** `/admin/sales-employee-report`
- **Módulo:** Relatórios > Vendas > Vendas/Funcionário
- **Tipo:** Relatório
- **Finalidade:** Vendas/Funcionário (relatório)
- **Cards/Seções:** Relatório Vendas/Funcionários

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `user_id` | Responsável | select | (lista dinâmica de cadastro — 3 registros; valores omitidos por privacidade) |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-249 · Relatório de Curva ABC

- **Rota:** `/admin/sales-abc-report`
- **Módulo:** Relatórios > Vendas > Curva ABC
- **Tipo:** Relatório
- **Finalidade:** Curva ABC (relatório)
- **Cards/Seções:** Relatório de Curva ABC

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `condition` | Tipo | select | Por Cliente, Por Produto |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-250 · Cálculo Mensal

- **Rota:** `/admin/monthly-calculation`
- **Módulo:** Relatórios > Gestão Pessoal > Apuração Mensal
- **Tipo:** Relatório
- **Finalidade:** Apuração Mensal (relatório)
- **Cards/Seções:** Cálculo Mensal

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `employees[]` | Colaborador | select (múltiplo) |  |
| `events[]` | Eventos | select (múltiplo) | 1/3 Férias em dobro, 1/3 FERIAS PROPORC. RESCISÃO, 1/3 S/ ABONO, 13 SAL COMPLEMENTAR, 13 SALARIO, 13 SALARIO ADIANTADO, 13 SALARIO INTEGRAL RESCISÃO, 13° salário - 2 parcela … (176) |
| `month_year` | Ano e Mes | text |  |
| `report_type` | Tipo Relatório | select | Sintetico, Analitico, Remessa Folha, Remessa cheque |
| `type` | Tipo | select | Folha Normal, Adiantamento 13º, 13º Salário |

## SCR-251 · Relatório de Aniversariantes

- **Rota:** `/admin/birthdays-report`
- **Módulo:** Relatórios > Gestão Pessoal > Aniversariantes
- **Tipo:** Relatório
- **Finalidade:** Aniversariantes (relatório)
- **Cards/Seções:** Relatório de Aniversariantes

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `month` | Mês | select | Todos, Janeiro, Fevereiro, Março, Abril, Maio, Junho, Julho … (13) |

## SCR-252 · Relatório de Horas Logadas

- **Rota:** `/admin/logged-hours-report`
- **Módulo:** Relatórios > Gestão Pessoal > Horas Logadas
- **Tipo:** Relatório
- **Finalidade:** Horas Logadas (relatório)
- **Cards/Seções:** Relatório de Horas Logadas

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `tenant` | Contratantes | select | Ênio Nunes |
| `farm` | Fazenda | select | Fazenda Maira, Fazenda São Paulo |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |

## SCR-253 · Relatório de Funcionários Ativos

- **Rota:** `/admin/active-employees`
- **Módulo:** Relatórios > Gestão Pessoal > Funcionários Ativos
- **Tipo:** Relatório
- **Finalidade:** Funcionários Ativos (relatório)
- **Cards/Seções:** Relatório de Funcionários Ativos

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `function_id` | Cargo | select | AJUDANDE DE CONZINHA, AJUDANTE GERAL, ANALISTA ADMINISTRATIVO GERAL, ANALISTA ADMINISTRATIVO PLENO, ANALISTA ADMINISTRATIVO SÊNIOR, ANALISTA DE COMPRAS, ANALISTA DE RH PLENO, ANALISTA DEPARTAMENTO DE PESSOAL … (208) |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `report_type` | Tipo de Relatório | select | PDF, Excel |

## SCR-254 · Relatório de Adiantamento Salarial

- **Rota:** `/admin/advances/report`
- **Módulo:** Relatórios > Gestão Pessoal > Adiant. Salarial
- **Tipo:** Relatório
- **Finalidade:** Adiant. Salarial (relatório)
- **Cards/Seções:** Relatório de Adiantamento Salarial

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `employee_id` | Funcionário | select | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `report_type` | Tipo de Relatório | select | PDF, Excel |

## SCR-255 · Relatórios Lançamento Contábil

- **Rota:** `/admin/double-entry-accounting-report`
- **Módulo:** Relatórios > Gestão Fiscal > Partida Dobrada
- **Tipo:** Relatório
- **Finalidade:** Partida Dobrada (relatório)
- **Cards/Seções:** Relatórios Lançamento Contábil

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `report_type` | Tipo de Relatório | select | Diário Contábil, Razão Contábil, Balanço de Verificação, Balanço Patrimonial (Simplificado) |
| `plan_account_id` | Plano de Conta | select | Caixa, Bancos, Cheques Recebidos, Contas a Receber, Estoque de Gado de Leite, Estoque de Gado Comercial Corte, Estoque de Gado P, Estoque de Gado PC … (126) |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `order_by` | Ordenação | select | + Recente, + Antigo |

## SCR-256 · Relatório NF-e

- **Rota:** `/admin/nfe-report`
- **Módulo:** Relatórios > Gestão Fiscal > NFe/Emitidas
- **Tipo:** Relatório
- **Finalidade:** NFe/Emitidas (relatório)
- **Cards/Seções:** Relatório NF-e

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `status` | Status | select | Novo, Aprovado, Cancelado, Rejeitado |
| `client_id[]` | Cliente | select (múltiplo) | (lista dinâmica de cadastro — 7 registros; valores omitidos por privacidade) |
| `farm_id[]` | Fazenda | select (múltiplo) | Fazenda Maira, Fazenda São Paulo |
| `center_id[]` | Centro de Custo | select (múltiplo) | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |
| `emissor_id` | Emissor NF-e | select | AGRO365 SERV. E COM. LTDA |
| `provider_id` | Prestador de serviço | select |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-257 · Relatório de Faturamento

- **Rota:** `/admin/nfe-product-report`
- **Módulo:** Relatórios > Gestão Fiscal > Faturamento
- **Tipo:** Relatório
- **Finalidade:** Faturamento (relatório)
- **Cards/Seções:** Relatório de Faturamento

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `client_id[]` | Cliente | select (múltiplo) | (lista dinâmica de cadastro — 4 registros; valores omitidos por privacidade) |
| `farm_id[]` | Fazenda | select (múltiplo) | Fazenda Maira, Fazenda São Paulo |
| `products[]` | Produtos | select (múltiplo) | BANANA BC PRATA CX 12KG, Bovinos - Fêmeas 13 a 24 meses |
| `emissor_id` | Emissor NF-e | select | AGRO365 SERV. E COM. LTDA |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-258 · Relatório de Conferência do Livro Caixa

- **Rota:** `/admin/cash-book-report`
- **Módulo:** Relatórios > Gestão Fiscal > Livro Caixa
- **Tipo:** Relatório
- **Finalidade:** Livro Caixa (relatório)
- **Cards/Seções:** Relatório de Conferência do Livro Caixa

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `proprietary_id` | Proprietário Gestor | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-259 · Relatório Máquinas

- **Rota:** `/admin/equipment-machines-report`
- **Módulo:** Relatórios > Gestão de Frotas > Máquinas
- **Tipo:** Relatório
- **Finalidade:** Máquinas (relatório)
- **Cards/Seções:** Relatório Máquinas

**Formulário POST `/admin/equipment-machines-report`** — botões: Gerar Relatório

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `equipment_id[]` | Máquinas Marcar todos Desmarcar todos | select (múltiplo) | R |  | A 73F VALTRA/CABINADO, ADUBADEIRA DE ARRASTE KAMAQ, ADUBADEIRA HIDRÁULICA, BALANÇA, BALANÇA, BALANÇA BONIVA ELETRONICA RETANGULAR FIXA KM-3-N COIMMA, BALANÇA DIGITAL SUSPENSA 3000 KG BIV, BATEDEIRA DE PIMENTA … (132) |  |
| `farms[]` | Fazendas Marcar todos Desmarcar todos | select (múltiplo) |  |  | Fazenda Maira, Fazenda São Paulo |  |
| `start_date` | Dt. Início | text (data) | R |  |  |  |
| `end_date` | Dt. Fim | text (data) | R |  |  |  |
| `maintenance_type` | Tipo | select |  |  | Funcionário, Fornecedor |  |
| `maintenance_executor_id` | Executador | select |  |  |  |  |
| `type` | Tipo de Relatório | select |  |  | PDF, Excel |  |

## SCR-260 · Relatório Máquinas - Abastecimentos

- **Rota:** `/admin/equipment-machines-supply-report`
- **Módulo:** Relatórios > Gestão de Frotas > Abastecimentos
- **Tipo:** Relatório
- **Finalidade:** Abastecimentos (relatório)
- **Cards/Seções:** Relatório Máquinas - Abastecimentos

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `equipment_id[]` | Máquinas Marcar todos Desmarcar todos | select (múltiplo) | Trator MF 250, Veículo HJK-1256, TRATOR A950, TRATOR VALMET68, MOTO BROS 125, FORD RANGER XLSCD2D4A, MOTOR ELETRICO 12,5CV 2P 220/440V MONO IP55 F. RURAL WEG, MOTOR ELETRICO 5CV 4P 220/440V MONO IP55 F. RURAL WEG … (132) |
| `farms[]` | Fazendas Marcar todos Desmarcar todos | select (múltiplo) | Fazenda Maira, Fazenda São Paulo |
| `product_id[]` | Produto | select |  |
| `warehouse_id` | Armazém | select |  |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

## SCR-261 · Relatório Máquinas - Manutenções

- **Rota:** `/admin/equipment-machines-maintenance-report`
- **Módulo:** Relatórios > Gestão de Frotas > Manutenções
- **Tipo:** Relatório
- **Finalidade:** Manutenções (relatório)
- **Cards/Seções:** Relatório Máquinas - Manutenções

**Filtros (GET)** — botões: Gerar Relatório

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `equipment_id[]` | Máquinas Marcar todos Desmarcar todos | select (múltiplo) | Trator MF 250, Veículo HJK-1256, TRATOR A950, TRATOR VALMET68, MOTO BROS 125, FORD RANGER XLSCD2D4A, MOTOR ELETRICO 12,5CV 2P 220/440V MONO IP55 F. RURAL WEG, MOTOR ELETRICO 5CV 4P 220/440V MONO IP55 F. RURAL WEG … (132) |
| `farms[]` | Fazendas Marcar todos Desmarcar todos | select (múltiplo) | Fazenda Maira, Fazenda São Paulo |
| `product_id` | Produto | select |  |
| `warehouse_id` | Armazém | select |  |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |
| `type` | Tipo de Relatório | select | PDF, Excel |

