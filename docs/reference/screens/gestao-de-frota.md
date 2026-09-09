# Telas — Gestão de Frota

Detalhamento tela a tela (sistema de referência). Legenda: **R** = obrigatório observado (atributo required/asterisco), tipo = tipo do controle HTML observado; "Opções" mostra amostra (até 8) das opções de listas.

## SCR-143 · Manutenções

- **Rota:** `/admin/maintenances`
- **Módulo:** Gestão de Frota > Manutenções
- **Tipo:** Listagem
- **Finalidade:** Manutenções (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/maintenances/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `equipment` | Máq/Equipamento/Veículo | select | A 73F VALTRA/CABINADO, ADUBADEIRA DE ARRASTE KAMAQ, ADUBADEIRA HIDRÁULICA, BALANÇA, BALANÇA, BALANÇA BONIVA ELETRONICA RETANGULAR FIXA KM-3-N COIMMA, BALANÇA DIGITAL SUSPENSA 3000 KG BIV, BATEDEIRA DE PIMENTA … (136) |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Data | Requisitante | Dt. Criação | Ação

## SCR-144 · Abastecimentos

- **Rota:** `/admin/supplies`
- **Módulo:** Gestão de Frota > Abastecimentos
- **Tipo:** Listagem
- **Finalidade:** Abastecimentos (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/supplies/create`
- **Modais:** Importar

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `equipment` | Máq/Equipamento/Veículo | select | A 73F VALTRA/CABINADO, ADUBADEIRA DE ARRASTE KAMAQ, ADUBADEIRA HIDRÁULICA, BALANÇA, BALANÇA, BALANÇA BONIVA ELETRONICA RETANGULAR FIXA KM-3-N COIMMA, BALANÇA DIGITAL SUSPENSA 3000 KG BIV, BATEDEIRA DE PIMENTA … (136) |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Data | Requisitante | Dt. Criação | Ação

**Formulário POST `/admin/supplies/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-145 · Manutenções Preventivas

- **Rota:** `/admin/maintenance-preventives`
- **Módulo:** Gestão de Frota > Manutenções Preventivas
- **Tipo:** Listagem
- **Finalidade:** Manutenções Preventivas (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/maintenance-preventives/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `equipment` | Máq/Equipamento/Veículo | select | A 73F VALTRA/CABINADO, ADUBADEIRA DE ARRASTE KAMAQ, ADUBADEIRA HIDRÁULICA, BALANÇA, BALANÇA, BALANÇA BONIVA ELETRONICA RETANGULAR FIXA KM-3-N COIMMA, BALANÇA DIGITAL SUSPENSA 3000 KG BIV, BATEDEIRA DE PIMENTA … (132) |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Data | Requisitante | Dt. Criação | Ação

## SCR-146 · Revisões Agendadas

- **Rota:** `/admin/scheduled-reviews`
- **Módulo:** Gestão de Frota > Revisões Agendadas
- **Tipo:** Listagem
- **Finalidade:** Revisões Agendadas (listagem)

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Máq./Equipamento | Km/ Horimetro | Restante | Data Revisão

## SCR-147 · Transferência de Máquinas

- **Rota:** `/admin/equipment-transfer`
- **Módulo:** Gestão de Frota > Transferência Máquinas
- **Tipo:** Listagem
- **Finalidade:** Transferência Máquinas (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/equipment-transfer/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Status | Código | Responsável | Data | Fazenda Origem | Fazenda Destino | Ação

## SCR-441 · Manutenções

- **Rota:** `/admin/maintenances/create`
- **Módulo:** Gestão de Frota > Manutenções
- **Tipo:** Cadastro (novo)
- **Finalidade:** Manutenções (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/maintenances`

**Formulário POST `/admin/maintenances`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `date` | Data | text | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `harvest_id` | Safra | select |  |  | Safra 1, TESTE, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |  |
| `machines[0][equipment_id]` |  | select |  |  | A 73F VALTRA/CABINADO, ADUBADEIRA DE ARRASTE KAMAQ, ADUBADEIRA HIDRÁULICA, BALANÇA, BALANÇA, BALANÇA BONIVA ELETRONICA RETANGULAR FIXA KM-3-N COIMMA, BALANÇA DIGITAL SUSPENSA 3000 KG BIV, BATEDEIRA DE PIMENTA … (136) |  |
| `machines[0][hour_meter]` |  | text |  |  |  |  |
| `machines[0][mileage]` |  | text |  |  |  |  |
| `machines[__INDEX__][equipment_id]` |  | select |  |  | A 73F VALTRA/CABINADO, ADUBADEIRA DE ARRASTE KAMAQ, ADUBADEIRA HIDRÁULICA, BALANÇA, BALANÇA, BALANÇA BONIVA ELETRONICA RETANGULAR FIXA KM-3-N COIMMA, BALANÇA DIGITAL SUSPENSA 3000 KG BIV, BATEDEIRA DE PIMENTA … (136) |  |
| `machines[__INDEX__][hour_meter]` |  | text |  |  |  |  |
| `machines[__INDEX__][mileage]` |  | text |  |  |  |  |
| `machines[__INDEX__][warehouses][]` | Armazém | select |  |  | Sem Estoque |  |
| `machines[__INDEX__][products][]` | Produto | select |  |  |  |  |
| `machines[__INDEX__][measurements][]` | Un. Medida | select |  |  |  |  |
| `machines[__INDEX__][qtd_stock][]` | Estoque | text |  |  |  |  |
| `machines[__INDEX__][quantities][]` | Qtd | text (moeda) |  |  |  |  |
| `machines[__INDEX__][amounts][]` | Vl. Unitário | text (moeda) |  |  |  |  |
| `machines[__INDEX__][totals][]` | Vl. Total | text (moeda) |  |  |  |  |
| `machines[__INDEX__][notes][]` | Observação | text |  |  |  |  |
| `machines[__INDEX__][maintenance_type][]` | Tipo | select |  |  | Funcionário, Fornecedor |  |
| `machines[__INDEX__][maintenance_executor_id][]` | Executador | select |  |  |  |  |
| `machines[__INDEX__][maintenance_employee_quantity][]` | Qtd (H) | text (moeda) |  |  |  |  |
| `machines[__INDEX__][maintenance_employee_total][]` | Total Serviço (R$) | text (moeda) |  |  |  |  |
| `machines[__INDEX__][maintenance_note][]` | Descrição do Serviço | text |  |  |  |  |

## SCR-442 · Abastecimentos

- **Rota:** `/admin/supplies/create`
- **Módulo:** Gestão de Frota > Abastecimentos
- **Tipo:** Cadastro (novo)
- **Finalidade:** Abastecimentos (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/supplies`

**Formulário POST `/admin/supplies`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `date` | Data | text | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `harvest_id` | Safra | select |  |  | Safra 1, TESTE, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |  |
| `supply_equipment_id[]` | Maq/Veículo | select | R |  | A 73F VALTRA/CABINADO, ADUBADEIRA DE ARRASTE KAMAQ, ADUBADEIRA HIDRÁULICA, BALANÇA, BALANÇA, BALANÇA BONIVA ELETRONICA RETANGULAR FIXA KM-3-N COIMMA, BALANÇA DIGITAL SUSPENSA 3000 KG BIV, BATEDEIRA DE PIMENTA … (136) |  |
| `last_hour_meter` | Último Horímetro (h) | text |  |  |  |  |
| `supply_hour_meter[]` | Horímetro Atual (h) | text |  |  |  |  |
| `last_mileage` | Último Km | text |  |  |  |  |
| `supply_mileage[]` | Km Atual | text |  |  |  |  |
| `supply_warehouse_id[]` | Armazém | select | R |  | Sem Estoque |  |
| `supply_product[]` | Produto | select | R |  |  |  |
| `supply_um[]` | Un. Medida | select | R |  |  |  |
| `qtd_stock[]` | Estoque | text |  |  |  |  |
| `supply_quantity[]` | Qtd | text (moeda) | R |  |  |  |
| `supply_amount[]` | Vl. Unitário | text (moeda) | R |  |  |  |
| `supply_total[]` | Vl. Total | text (moeda) | R |  |  |  |
| `supply_responsible[]` | Responsável | select |  |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `supply_note[]` | Observação | text |  |  |  |  |

## SCR-443 · Manutenções Preventivas

- **Rota:** `/admin/maintenance-preventives/create`
- **Módulo:** Gestão de Frota > Manutenções Preventivas
- **Tipo:** Cadastro (novo)
- **Finalidade:** Manutenções Preventivas (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/maintenance-preventives`

**Formulário POST `/admin/maintenance-preventives`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `date` | Data | text | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `maintenance_preventives_equipment_id[]` | Máq./Veículo | select |  |  | A 73F VALTRA/CABINADO, ADUBADEIRA DE ARRASTE KAMAQ, ADUBADEIRA HIDRÁULICA, BALANÇA, BALANÇA, BALANÇA BONIVA ELETRONICA RETANGULAR FIXA KM-3-N COIMMA, BALANÇA DIGITAL SUSPENSA 3000 KG BIV, BATEDEIRA DE PIMENTA … (132) |  |
| `maintenance_preventives_hour_meter_km[]` | Horímetro/Km | text |  |  |  |  |
| `maintenance_preventives_date[]` | Data Revisão | text (data) |  |  |  |  |
| `maintenance_preventives_message[]` | Serviço | text |  |  |  |  |
| `maintenance_preventives_note[]` | Observação | text |  |  |  |  |

## SCR-444 · Transferência de Máquinas

- **Rota:** `/admin/equipment-transfer/create`
- **Módulo:** Gestão de Frota > Transferência Máquinas
- **Tipo:** Cadastro (novo)
- **Finalidade:** Transferência Máquinas (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/equipment-transfer`

**Formulário POST `/admin/equipment-transfer`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `user_name` | Usuário | text | R |  |  |  |
| `date` | Dt. Criação | text | R |  |  |  |
| `farm_id` | Fazenda | text | R |  |  |  |
| `farm_out_id` | Fazenda Destino | select | R |  | Fazenda Maira |  |
| `equipment_id[]` | Máquina | select | R |  |  |  |
| `attachments[0][name]` | Descrição | text |  |  |  |  |
| `attachments[0][file]` |  | file |  |  |  |  |

