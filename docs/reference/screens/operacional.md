# Telas — Operacional

Detalhamento tela a tela (sistema de referência). Legenda: **R** = obrigatório observado (atributo required/asterisco), tipo = tipo do controle HTML observado; "Opções" mostra amostra (até 8) das opções de listas.

## SCR-096 · Gestão Animais

- **Rota:** `/admin/animals-management`
- **Módulo:** Operacional > Pecuária > Gestão Animais
- **Tipo:** Listagem
- **Finalidade:** Gestão Animais (listagem)
- **Botões/Ações (cabeçalho):** Transferir de Lote (modal #newChangeAnimalBatchModal); Realizar Pesagem (modal #newAnimalWeighingModal); Realizar Sanitário (modal #newAnimalSanitaryModal); Status Reprodutivo (modal #updateAnimalReproductiveStatusModal); Importar → `#` (modal #modalImport); Exportar → `/admin/animals/export`; Adicionar Novo → `/admin/animals-management/create`; Filtrar; Limpar → `/admin/animals-management`; text-light → `#`; Visualizar → `/admin/animals-management/108942`; Editar → `/admin/animals-management/108942/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals-management/108943`; Editar → `/admin/animals-management/108943/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals-management/108944`; Editar → `/admin/animals-management/108944/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals-management/108945`; Editar → `/admin/animals-management/108945/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals-management/108946`; Editar → `/admin/animals-management/108946/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals-management/108947`; Editar → `/admin/animals-management/108947/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals-management/108948`; Editar → `/admin/animals-management/108948/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals-management/108949`; Editar → `/admin/animals-management/108949/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals-management/108950`; Editar → `/admin/animals-management/108950/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals-management/108951`; Editar → `/admin/animals-management/108951/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals-management/108952`; Editar → `/admin/animals-management/108952/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals-management/108953`; Editar → `/admin/animals-management/108953/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals-management/108954`; Editar → `/admin/animals-management/108954/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals-management/108955`; Editar → `/admin/animals-management/108955/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals-management/108956`; Editar → `/admin/animals-management/108956/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals-management/108957`; Editar → `/admin/animals-management/108957/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals-management/108958`; Editar → `/admin/animals-management/108958/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals-management/108959`; Editar → `/admin/animals-management/108959/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals-management/108960`; Editar → `/admin/animals-management/108960/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals-management/108961`; Editar → `/admin/animals-management/108961/edit`; Excluir; 2 → `/admin/animals-management?page=2`; 3 → `/admin/animals-management?page=3`; 4 → `/admin/animals-management?page=4`; 5 → `/admin/animals-management?page=5`; 6 → `/admin/animals-management?page=6`; 7 → `/admin/animals-management?page=7`; 8 → `/admin/animals-management?page=8`; 9 → `/admin/animals-management?page=9`; 10 → `/admin/animals-management?page=10`; 23 → `/admin/animals-management?page=23`; 24 → `/admin/animals-management?page=24`; › → `/admin/animals-management?page=2`
- **Modais:** Importar; Nova Transferência Animal/Lote
- **Paginação:** sim (server-side, seletor de quantidade 10–200)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar Id Animal | text |  |
| `category_id` | Categoria | select | Fêmeas > 36 meses, Fêmeas 25 a 36 meses, Fêmeas 13 a 24 meses, Fêmeas 0 a 12 meses, Machos 0 a 12 meses, Machos 13 a 24 meses, Machos 25 a 36 meses, Machos > 36 meses … (9) |
| `batch` | Lote | select | Sem lote |
| `status` | Status | select | Ativo, Pendente, Morto, Perdido, Vendido, Excluído |
| `origin` | Origem | select | Nascidos, Comprados, Cadastrados |
| `reproductive_status` | Situação Rerodutivo | select | Prenha, Vazia, Parida |
| `pagination_quantity` | Qtd. de Registros | select | 20 Registros, 30 Registros, 50 Registros, 80 Registros, 100 Registros, Todos Registros |
| `animals_management_columns[]` | Selecione as Colunas Desejadas | select (múltiplo) | (lista dinâmica de cadastro — 14 registros; valores omitidos por privacidade) … (14) |

**Tabela** (N. Registros: 465) — linhas na amostra: 20

- Colunas: (seleção) | Tipo | Tipo de Identificação | Identificação | Categoria | Lote | Peso (kg) | Ação
- Ações por linha: Visualizar, Editar, Excluir
- Links por linha: `/admin/animals-management/{id}`, `/admin/animals-management/{id}/edit`

**Formulário POST `/admin/animals/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-097 · Inventariado Animais

- **Rota:** `/admin/inventoried-animals`
- **Módulo:** Operacional > Pecuária > Inventariado
- **Tipo:** Listagem
- **Finalidade:** Inventariado (listagem)
- **Botões/Ações (cabeçalho):** Importar → `#` (modal #modalImport)
- **Modais:** Importar

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Data | Quantidade de Animais | Em Lote | Fora do Lote | Faltantes na Planilha | Ação

**Formulário POST `/admin/inventoried-animals/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-098 · Planejamento Pecuário

- **Rota:** `/admin/planning-livestock`
- **Módulo:** Operacional > Pecuária > Planejamento
- **Tipo:** Listagem
- **Finalidade:** Planejamento (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/planning-livestock/create`

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: # | Código | Safra | Responsável | Vl. Planejado | Vl. Área | Ação

## SCR-099 · Evolução de Rebanho

- **Rota:** `/admin/evolution-animals`
- **Módulo:** Operacional > Pecuária > Transferências > Evolução/Rebanho
- **Tipo:** Listagem
- **Finalidade:** Evolução/Rebanho (listagem)
- **Paginação:** sim (server-side, seletor de quantidade 10–200)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `animal` | Animal | select | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |

**Tabela** (N. Registros: 1624) — linhas na amostra: 10

- Colunas: Animal | Dt. Nascimento | Data | Categoria Anterior | Proxima Categoria

## SCR-100 · Agrupar Lotes

- **Rota:** `/admin/grouper-batches`
- **Módulo:** Operacional > Pecuária > Transferências > Agrupar/Lotes
- **Tipo:** Listagem
- **Finalidade:** Agrupar/Lotes (listagem)
- **Botões/Ações (cabeçalho):** Agrupar; Novo Lote (modal #newBatchModal)
- **Modais:** Agrupar Lotes; Novo Lote

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por descrição | text |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: # | Código | Descrição | Total de Animais

**Formulário POST `/admin/grouper-batches`** (modal newBatchModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `date` | Data | text | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `parameter_weight_id` | Peso | select |  |  |  |  |
| `specie_id` | Espécie | select | R |  | Bovinos de Corte |  |
| `categories[]` | Categoria | select (múltiplo) | R |  |  |  |
| `description` | Descrição | text | R | 200 |  |  |

- Mensagens/alertas: Selecione o lote que irá ser o principal. Os animais dos demais lotes serão transferidos para o lote selecionado.

## SCR-101 · Venda de Animais

- **Rota:** `/admin/movement-sales`
- **Módulo:** Operacional > Pecuária > Movimentações > Vendas
- **Tipo:** Listagem
- **Finalidade:** Vendas (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/movement-sales/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por número | text |  |
| `client_id` | Cliente | select | (lista dinâmica de cadastro — 7 registros; valores omitidos por privacidade) |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `type_sale` | Tipo de Venda | select | Recria, Abate |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: # | Código | Cliente | Data da Venda | Vl. Total | Data de cadastro | Venda | Financeiro | Nº NFe | Ação

## SCR-102 · Compra de Animais

- **Rota:** `/admin/movement-purchases`
- **Módulo:** Operacional > Pecuária > Movimentações > Compras
- **Tipo:** Listagem
- **Finalidade:** Compras (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/movement-purchases/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por número | text |  |
| `provider_id` | Fornecedor | select | (lista dinâmica de cadastro — 39 registros; valores omitidos por privacidade) … (39) |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Fornecedor | Dt.Compra | Vl. Total | Data de cadastro | NFE | Número | GTA | Ação

## SCR-103 · Nascimentos

- **Rota:** `/admin/birth-animals`
- **Módulo:** Operacional > Pecuária > Movimentações > Nascimentos
- **Tipo:** Listagem
- **Finalidade:** Nascimentos (listagem)
- **Botões/Ações (cabeçalho):** Importar → `#` (modal #modalImport); Adicionar Novo → `/admin/birth-animals/create`
- **Modais:** Importar

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `animal_id` | ID Animal/Id Mãe | text |  |
| `breed_id` | Raça | select | Nelore, Aberdeen Angus, Red Angus, Cruzado, Hereford, Braford, Senepol, SRD … (36) |
| `start_date` | Dt. Inicio | text |  |
| `end_date` | Dt. Fim | text |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Mãe (ID Animal) | ID Pai/Sêmen | Bezerro (ID Animal) | Raça | Peso | Data | Ação

**Formulário POST `/admin/birth-animals-import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-104 · Mortes

- **Rota:** `/admin/death-animals`
- **Módulo:** Operacional > Pecuária > Movimentações > Mortes
- **Tipo:** Listagem
- **Finalidade:** Mortes (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/death-animals/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `animal_id` | ID do Animal | text |  |
| `cause` | Causa | select | Abscesso, Acidente, Afogamento / atolamento, Anaplasmose / babesiose / piroplasmose, Ataque por predadores, Botulismo, Brucelose, Castração … (43) |
| `start_date` | Dt. Inicio | text |  |
| `end_date` | Dt. Fim | text |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Animal | Causa | Data | Ação

## SCR-105 · Perdas

- **Rota:** `/admin/loss-animals`
- **Módulo:** Operacional > Pecuária > Movimentações > Perdas
- **Tipo:** Listagem
- **Finalidade:** Perdas (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/loss-animals/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `animal_id` | ID do Animal | text |  |
| `cause` | Causa | select | Furto/Roubo, Sumiço, Fugido, Misturado outro lote |
| `start_date` | Dt. Inicio | text |  |
| `end_date` | Dt. Fim | text |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Categoria | Animal | Causa | Data | Ação

## SCR-106 · Processamentos

- **Rota:** `/admin/processing`
- **Módulo:** Operacional > Pecuária > Manejo > Processamentos
- **Tipo:** Listagem
- **Finalidade:** Processamentos (listagem)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `batch_id` | Lote | select | Todas |
| `area_id` | Área | select | Todas, 01, 02, 03, 04, 05, 06, 07 … (11) |
| `grazing_id` | Módulo | select | Todas |
| `status` | Status | select | Todas, Pendente, Finalizado |

**Tabela** (N. Registros: 1) — linhas na amostra: 1

- Colunas: # | Código | Data | Tipo | Lote | Área/Módulo | Qtd Animais | Ação
- Ações por linha: Processar
- Links por linha: `/admin/processing/{id}/process`

## SCR-107 · Pré-Lotes

- **Rota:** `/admin/purchase-lots`
- **Módulo:** Operacional > Pecuária > Manejo > Pré-Lotes
- **Tipo:** Listagem
- **Finalidade:** Pré-Lotes (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/purchase-lots/create`

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Descrição | Data | Animais | Compras vinculadas | Status | Ação

## SCR-108 · Pesagens

- **Rota:** `/admin/weighings`
- **Módulo:** Operacional > Pecuária > Manejo > Pesagem
- **Tipo:** Listagem
- **Finalidade:** Pesagem (listagem)
- **Botões/Ações (cabeçalho):** Importar → `#` (modal #modalImport); Adicionar Novo → `/admin/weighings/create`
- **Modais:** Importar

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `batch_id` | Lote | select |  |
| `category_id` | Categoria | select | Fêmeas > 36 meses, Fêmeas 25 a 36 meses, Fêmeas 13 a 24 meses, Fêmeas 0 a 12 meses, Machos 0 a 12 meses, Machos 13 a 24 meses, Machos 25 a 36 meses, Machos > 36 meses … (42) |
| `user_id` | Responsável | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |

**Tabela** (N. Registros: 1) — linhas na amostra: 1

- Colunas: Código | Data | Movimentação ABC Corte | Lote/Categoria | Qnt. Animais | Peso Médio (Kg) | Ganho Médio (Kg) | Ganho Total Período (Kg) | GMD (Kg) | Ação
- Ações por linha: Visualizar, Relatório Individual, Exportar Excel, Editar, Excluir
- Links por linha: `/admin/weighings/{id}`, `/admin/weighings/{id}/single-report`, `/admin/weighings/{id}/single-report-excel`, `/admin/weighings/{id}/edit`

**Formulário POST `/admin/weighings/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-109 · Nutrição

- **Rota:** `/admin/nutritions`
- **Módulo:** Operacional > Pecuária > Manejo > Nutrição
- **Tipo:** Listagem
- **Finalidade:** Nutrição (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/nutritions/create`
- **Modais:** Importar

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Data Inicial | text (data) |  |
| `end_date` | Data Final | text (data) |  |
| `product_id` | Produto | select | SAL MINERAL ADENÇADO - 56PB, SAL MINERAL COEQUI PLUS 25KG, Dieta Adaptação |
| `batch_id` | Lote | select |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Data | Responsável | Módulo/Área | Lote | Produto | Qtd. Utilizada | Ação

**Formulário POST `/admin/nutritions/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-110 · Sanitários

- **Rota:** `/admin/sanitaries`
- **Módulo:** Operacional > Pecuária > Manejo > Sanitário
- **Tipo:** Listagem
- **Finalidade:** Sanitário (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/sanitaries/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `batch_id` | Lote | select |  |
| `user_id` | Responsável | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Data | Responsável | Ação

## SCR-111 · Desmama

- **Rota:** `/admin/weanings`
- **Módulo:** Operacional > Pecuária > Manejo > Desmama
- **Tipo:** Listagem
- **Finalidade:** Desmama (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/weanings/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `user_id` | Responsável | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Data | Responsável | Ação

## SCR-112 · Apartações

- **Rota:** `/admin/separations`
- **Módulo:** Operacional > Pecuária > Manejo > Apartação
- **Tipo:** Listagem
- **Finalidade:** Apartação (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/separations/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `batch_id` | Lote | select |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Data | Responsável | Qtd. Lotes | Qtd. Animais | Status Processamento | Ação

## SCR-113 · Localizar Animal

- **Rota:** `/admin/locate-animals`
- **Módulo:** Operacional > Pecuária > Manejo > Localiza Animal
- **Tipo:** Página
- **Finalidade:** Localiza Animal (página)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `animal_id` | Animal | select | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |

## SCR-114 · Pastagem

- **Rota:** `/admin/pastures`
- **Módulo:** Operacional > Pecuária > Manejo > Pastagem
- **Tipo:** Listagem
- **Finalidade:** Pastagem (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/pastures/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `user_id` | Funcionário | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |

**Tabela** (N. Registros: 1) — linhas na amostra: 1

- Colunas: # | Código | Dt. Apontamento | Requisitante | Armazém | Dt. Criação | Ação
- Ações por linha: Visualizar, Finalizar, Excluir
- Links por linha: `/admin/pastures/{id}`, `/admin/pastures/{id}/edit`

## SCR-115 · Gerenciamento Reprodutivo Avançado

- **Rota:** `/admin/advanced-reproductive`
- **Módulo:** Operacional > Pecuária > Manejo > Reprodução > Gerenciamento Avançado
- **Tipo:** Listagem
- **Finalidade:** Gerenciamento Avançado (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo Acasalamento → `/admin/breeding-matings/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar Id Animal | text |  |
| `reproductive_status` | Status Reprodutivo | select | Prenha, Vazia, Parida |
| `breeding_batch_id` | Lote de Reprodução | select |  |
| `breeding_season_id` | Estação de Monta | select |  |
| `protocol_id` | Protocolo | select |  |
| `bull_seed_season_id` | Touro/Semên/Estação | select | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |

**Tabela** (N. Registros:: 0) — linhas na amostra: 1

- Colunas: Animal | Categoria | Tipo Acasalamento | Última Atualização | Status | Ações

## SCR-116 · Estações de Monta

- **Rota:** `/admin/breeding-seasons`
- **Módulo:** Operacional > Pecuária > Manejo > Reprodução > Estação de Monta
- **Tipo:** Listagem
- **Finalidade:** Estação de Monta (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Adicionar Novo → `/admin/breeding-seasons/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `user_id` | Responsável | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |

**Tabela** (N. Registros:: 0) — linhas na amostra: 1

- Colunas: Código | Data Cadastro | Data Inicial | Data Final | Responsável | Descrição | Ação

## SCR-117 · Lotes/Reprodução

- **Rota:** `/admin/breeding-batch`
- **Módulo:** Operacional > Pecuária > Manejo > Reprodução > Lotes/Reprodução
- **Tipo:** Listagem
- **Finalidade:** Lotes/Reprodução (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/breeding-batch/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Data | Responsável | Descrição | Ação

## SCR-118 · Touros/Sêmen/Embrião

- **Rota:** `/admin/bull-seed-season`
- **Módulo:** Operacional > Pecuária > Manejo > Reprodução > Touros/Sêmen/Embrião
- **Tipo:** Listagem
- **Finalidade:** Touros/Sêmen/Embrião (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/bull-seed-season/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |

**Tabela** (N. Registros:: 0) — linhas na amostra: 1

- Colunas: Código | Data | Responsável | Descrição | Ação

## SCR-119 · Protocolos/Estação

- **Rota:** `/admin/protocols-season`
- **Módulo:** Operacional > Pecuária > Manejo > Reprodução > Protocolos/Estação
- **Tipo:** Listagem
- **Finalidade:** Protocolos/Estação (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/protocols-season/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Nome | Data | Responsável | Estação de monta | Ação

## SCR-120 · Acasalamento

- **Rota:** `/admin/breeding-matings`
- **Módulo:** Operacional > Pecuária > Manejo > Reprodução > Acasalamento
- **Tipo:** Listagem
- **Finalidade:** Acasalamento (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/breeding-matings/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `user_id` | Responsável | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |
| `breeding_batch_id` | Lote de Reprodução | select |  |

**Tabela** (N. Registros:: 0) — linhas na amostra: 1

- Colunas: # | Código | Data Cadastro | Responsável | Ressincronização | Tipo / Última Etapa Realizada | Ação

## SCR-121 · Pátio

- **Rota:** `/admin/feedlot-yards`
- **Módulo:** Operacional > Pecuária > Confinamento > Cadastros > Pátios
- **Tipo:** Listagem
- **Finalidade:** Pátios (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/feedlot-yards/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `code` | Código | text |  |
| `name` | Nome | text |  |
| `is_active` | Status | select | Ativo, Inativo |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Nome | Área (m²) | Criado em | Status | Ação

## SCR-122 · Setores

- **Rota:** `/admin/feedlot-sectors`
- **Módulo:** Operacional > Pecuária > Confinamento > Cadastros > Setores
- **Tipo:** Listagem
- **Finalidade:** Setores (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/feedlot-sectors/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `code` | Código | text |  |
| `name` | Nome | text |  |
| `feedlot_yard_id` | Pátio | select | Todos |
| `is_active` | Status | select | Todos, Ativo, Inativo |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Nome | Pátio | Área | Criado em | Status | Ação

## SCR-123 · Curral

- **Rota:** `/admin/feedlot-corrals`
- **Módulo:** Operacional > Pecuária > Confinamento > Cadastros > Currais
- **Tipo:** Listagem
- **Finalidade:** Currais (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/feedlot-corrals/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `name` | Nome | text |  |
| `installation_type` | Tipo de Instalação | select | Coberto, Descoberto |
| `status` | Situação | select | Vazio, Vazio Sanitário, Ocupado, Manutenção, Limpeza, Enfermaria, Interditado |
| `coverage` | Cobertura | select | Aberto, Cobertura Parcial, Cobertura Total, Galpão Metálico, Galpão com Isolamento, Telha Termoacústica, Fibrocimento, Cerâmica … (10) |
| `feedlot_sector_id` | Setor | select |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Identificação | Nome | Instalação | Área | Piso | Sombreamento | Cocho | Bebedouro | Qtd Animais | Situação | Ação

## SCR-124 · Dietas

- **Rota:** `/admin/diets`
- **Módulo:** Operacional > Pecuária > Confinamento > Nutrição > Dieta
- **Tipo:** Listagem
- **Finalidade:** Dieta (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/diets/create`
- **Modais:** Importar

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `name` | Dieta | text |  |
| `objective` | Objetivo da Dieta | select | Todas, Adaptação, Crescimento, Terminação |
| `date` | Data | text |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Data | Produto | Objetivo | Custo Estimado | Custo Por KG | Ação

**Formulário POST `/admin/equipments/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-125 · Fases/Regras de Troca

- **Rota:** `/admin/feeding-phases`
- **Módulo:** Operacional > Pecuária > Confinamento > Nutrição > Fases/Regras Troca
- **Tipo:** Listagem
- **Finalidade:** Fases/Regras Troca (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/feeding-phases/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `name` | Nome da Fase | text |  |
| `diet_id` | Dieta | select | Todos |
| `change_rule` | Regra de Troca | select | Todos, Por Dias, Por Peso |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Nome | Funcionário Responsável | Criado em | Atualizado em | Ação

## SCR-126 · Batelada

- **Rota:** `/admin/diet-beats`
- **Módulo:** Operacional > Pecuária > Confinamento > Nutrição > Batelada
- **Tipo:** Listagem
- **Finalidade:** Batelada (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/diet-beats/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `equipment_id` | Vagão Destino | select |  |
| `date` | Data da Batida | text |  |
| `diet_id` | Dieta | select | Todas |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Data | Dieta | Vagão | Operador | Total Geral(R$)

## SCR-127 · Trato Diário

- **Rota:** `/admin/diet-beat-supplies`
- **Módulo:** Operacional > Pecuária > Confinamento > Nutrição > Trato Diário
- **Tipo:** Listagem
- **Finalidade:** Trato Diário (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/diet-beat-supplies/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `date` | Data | text (data) |  |
| `diet_beat_id` | Batida de Dieta | select | Todas |

**Tabela** — linhas na amostra: 1

- Colunas: Código | Data | Batida | Operador | Currais | Total Fornecido | Ações

## SCR-128 · Leitura de Cocho

- **Rota:** `/admin/trough-readings`
- **Módulo:** Operacional > Pecuária > Confinamento > Nutrição > Leitura de Cocho
- **Tipo:** Listagem
- **Finalidade:** Leitura de Cocho (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/trough-readings/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Data inicial | text (data) |  |
| `end_date` | Data final | text (data) |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Data da Leitura | Responsável | Currais Avaliados | Ação

## SCR-129 · Mapa de Confinamento

- **Rota:** `/admin/feedlot-map`
- **Módulo:** Operacional > Pecuária > Confinamento > Mapa
- **Tipo:** Página
- **Finalidade:** Mapa (página)

## SCR-130 · Pluviometria

- **Rota:** `/admin/rainfalls`
- **Módulo:** Operacional > Pluviometria
- **Tipo:** Listagem
- **Finalidade:** Pluviometria (listagem)
- **Botões/Ações (cabeçalho):** Importar → `#` (modal #modalImport); Adicionar Novo → `/admin/rainfalls/create`
- **Modais:** Importar

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Data Inicial | text (data) |  |
| `end_date` | Data Final | text (data) |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Data | Responsável | Áreas | mm de Chuva | Ação

**Formulário POST `/admin/rainfalls/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-131 · Orçamentos

- **Rota:** `/admin/budgets`
- **Módulo:** Operacional > Vendas > Orçamentos
- **Tipo:** Listagem
- **Finalidade:** Orçamentos (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/budgets/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por número | text |  |
| `product` | Produto | select | Milho Grão, Soja em grãos, BANANA PRATA 1º CX 15KG, BANANA NANICA CX 20KG, BANANA BC PRATA CX 18KG, BANANA BC PRATA CX 20KG, BANANA NANICA CX 22KG, BANANA NANICA CX 16KG … (813) |
| `client_id` | Cliente | select | (lista dinâmica de cadastro — 8 registros; valores omitidos por privacidade) |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |
| `pagination_quantity` | Qtd. de Registros | select | 10 Registros, 30 Registros, 50 Registros, 80 Registros, 100 Registros, 200 Registros |

**Tabela** (N. Registros:: 0) — linhas na amostra: 1

- Colunas: (seleção) | Nº | Data | Cliente | Responsável | Vl. Total | Ação

## SCR-132 · Pedidos

- **Rota:** `/admin/orders`
- **Módulo:** Operacional > Vendas > Pedidos
- **Tipo:** Listagem
- **Finalidade:** Pedidos (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/orders/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por número | text |  |
| `product` | Produto | select | Milho Grão, Soja em grãos, BANANA PRATA 1º CX 15KG, BANANA NANICA CX 20KG, BANANA BC PRATA CX 18KG, BANANA BC PRATA CX 20KG, BANANA NANICA CX 22KG, BANANA NANICA CX 16KG … (813) |
| `client_id` | Cliente | select | (lista dinâmica de cadastro — 8 registros; valores omitidos por privacidade) |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |
| `pagination_quantity` | Qtd. de Registros | select | 10 Registros, 30 Registros, 50 Registros, 80 Registros, 100 Registros, 200 Registros |

**Tabela** (N. Registros:: 0) — linhas na amostra: 1

- Colunas: (seleção) | Nº | Data | Cliente | Responsável | Vl. Total | Ação

## SCR-133 · Vendas

- **Rota:** `/admin/sales`
- **Módulo:** Operacional > Vendas > Vendas
- **Tipo:** Listagem
- **Finalidade:** Vendas (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/sales/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por número | text |  |
| `product` | Produto | select | Milho Grão, Soja em grãos, BANANA PRATA 1º CX 15KG, BANANA NANICA CX 20KG, BANANA BC PRATA CX 18KG, BANANA BC PRATA CX 20KG, BANANA NANICA CX 22KG, BANANA NANICA CX 16KG … (813) |
| `client_id` | Cliente | select | (lista dinâmica de cadastro — 8 registros; valores omitidos por privacidade) |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |
| `pagination_quantity` | Qtd. de Registros | select | 10 Registros, 30 Registros, 50 Registros, 80 Registros, 100 Registros, 200 Registros |

**Tabela** (N. Registros:: 0) — linhas na amostra: 1

- Colunas: (seleção) | Nº | Dt.Remessa | Dt.Venda | Cliente | Responsável | Vl. Total | NFe | Ação

## SCR-134 · Minhas Ordens de Serviço

- **Rota:** `/admin/my-service-orders`
- **Módulo:** Operacional > Ordens de Serviço > Minhas OS
- **Tipo:** Listagem
- **Finalidade:** Minhas OS (listagem)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `code` | Código | text |  |
| `start_date` | Dt. Inicio | text |  |
| `end_date` | Dt. Fim | text |  |
| `pagination_quantity` | Qtd. de Registros | select | 10 Registros, 30 Registros, 50 Registros, 80 Registros, 100 Registros, 200 Registros |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: # | Código | Data de Emissão | Data de Prazo | Solicitante | Responsável | Ação

## SCR-135 · Ordem de Serviço

- **Rota:** `/admin/service-orders`
- **Módulo:** Operacional > Ordens de Serviço > Lista de OS
- **Tipo:** Listagem
- **Finalidade:** Lista de OS (listagem)
- **Botões/Ações (cabeçalho):** Adicionar novo → `/admin/service-orders/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `code` | Código | text |  |
| `start_date` | Dt. Inicio | text |  |
| `end_date` | Dt. Fim | text |  |
| `pagination_quantity` | Qtd. de Registros | select | 10 Registros, 30 Registros, 50 Registros, 80 Registros, 100 Registros, 200 Registros |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: (seleção) | Código | Data de Emissão | Data de Prazo | Solicitante | Responsável | Ação

## SCR-136 · Monitoramento de Ordens de Serviço

- **Rota:** `/admin/monitoring-service-orders`
- **Módulo:** Operacional > Ordens de Serviço > Monitoramento
- **Tipo:** Listagem
- **Finalidade:** Monitoramento (listagem)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `code` | Código | text |  |
| `start_date` | Dt. Inicio | text |  |
| `end_date` | Dt. Fim | text |  |
| `pagination_quantity` | Qtd. de Registros | select | 10 Registros, 30 Registros, 50 Registros, 80 Registros, 100 Registros, 200 Registros |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: # | Código | Data de Emissão | Data de Prazo | Solicitante | Responsável | Ação

## SCR-137 · Avaliação de Ordens de Serviço

- **Rota:** `/admin/rating-service-orders`
- **Módulo:** Operacional > Ordens de Serviço > Avaliações
- **Tipo:** Listagem
- **Finalidade:** Avaliações (listagem)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `code` | Código | text |  |
| `start_date` | Dt. Inicio | text |  |
| `end_date` | Dt. Fim | text |  |
| `pagination_quantity` | Qtd. de Registros | select | 10 Registros, 30 Registros, 50 Registros, 80 Registros, 100 Registros, 200 Registros |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: # | Código | Data de Emissão | Data de Prazo | Solicitante | Responsável | Ação

## SCR-400 · Informações do Animal

- **Rota:** `/admin/animals-management/create`
- **Módulo:** Operacional > Pecuária > Gestão Animais
- **Tipo:** Cadastro (novo)
- **Finalidade:** Gestão Animais (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/animals-management`

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Tipo de Identif. | Identificação

**Formulário POST `/admin/animals-management`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `photo` |  | file |  |  |  |  |
| `specie_id` | Espécie | select | R |  | Bovinos de Corte |  |
| `category_id` | Categoria | select | R |  |  |  |
| `entry_date` | Data de Entrada | text (data) | R |  |  |  |
| `type` | Tipo de Cadastro | select |  |  | Individual, Sem Identificação |  |
| `quantity` | Quantidade | number |  |  |  |  |
| `category_matrice_id` | Estágio Reprodutivo | select |  |  | Lactação, Multípara, Novilha, Nulípara, Primípara, Secundípara, Solteira |  |
| `reproductive_status` | Status Reprodutivo | select |  |  | Prenha, Vazia, Parida |  |
| `breed_id` | Raça | select | R |  | Aberdeen Angus, Akaushi, Anelorado, Bonsmara, Braford, Brahman, Brangus, Caracu … (36) |  |
| `birth_date` | Data de nascimento | text (data) |  |  |  |  |
| `weight` | Peso (Kg) | text (moeda) | R |  |  |  |
| `price_kilo_alive` | Preço do Kg vivo | text (moeda) | R |  |  |  |
| `price_arroba_alive` | Preço da @ vivo | text (moeda) |  |  |  |  |
| `value_unitary` | Valor Unitário | text (moeda) |  |  |  |  |
| `unity_animal_ua` | Unidade animal (UA) | text (moeda) |  |  |  |  |
| `mother` | ID Mãe | text |  |  |  |  |
| `father` | ID Pai | text |  |  |  |  |
| `fur_description` | Descrição Pelagem | text |  | 100 |  |  |
| `birth_forecast` | Previsão de Parto | text (data) |  |  |  |  |
| `proprietary_id` | Proprietário Gestor | select |  |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `provider_id` | Origem do Animal | select |  |  | (lista dinâmica de cadastro — 39 registros; valores omitidos por privacidade) … (39) |  |
| `note` | Observação | textarea |  | 191 |  |  |
| `vl_acquisition` | Vl. Aquisição/Vl.Construção | text (moeda) |  |  |  |  |
| `depreciation_type` | Tipo de Depreciação | select |  |  | C/Vl. Residual, S/Vl. Residual |  |
| `residual` | Residual(%) | text |  |  |  |  |
| `life_bens` | Vida útil(anos) | text (moeda) |  |  |  |  |
| `depreciation` | Depreciação(%) | text |  |  |  |  |
| `vl_residual` | Vl. Residual | text (moeda) |  |  |  |  |
| `vl_depreciate` | Vl. p/Depreciação | text (moeda) |  |  |  |  |
| `vl_depreciated` | Vl. Depreciado | text |  |  |  |  |
| `sd_depreciate` | Sd. Á depreciar | text |  |  |  |  |
| `id_animals[]` |  | select | R |  | (lista dinâmica de cadastro — 8 registros; valores omitidos por privacidade) |  |
| `identification[]` |  | text | R |  |  |  |
| `child[category_id]` | Categoria | select |  |  |  |  |
| `child[date]` | Dt. Nascimento | text (data) |  |  |  |  |
| `child[weight]` | Peso (Kg) | text (moeda) |  |  |  |  |
| `child[id_animal]` | Tipo Identificação | select |  |  | (lista dinâmica de cadastro — 8 registros; valores omitidos por privacidade) |  |
| `child[identification]` | Identificação | text |  |  |  |  |

## SCR-401 · Tipos de Identificação

- **Rota:** `/admin/animals-management/108942`
- **Módulo:** Operacional > Pecuária > Gestão Animais
- **Tipo:** Detalhe
- **Finalidade:** Gestão Animais (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/animals-management`

**Tabela** — linhas na amostra: 1

- Colunas: Tipo de Identif. | Identificação

## SCR-402 · Informações do Animal

- **Rota:** `/admin/animals-management/108942/edit`
- **Módulo:** Operacional > Pecuária > Gestão Animais
- **Tipo:** Cadastro (edição)
- **Finalidade:** Gestão Animais (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/animals-management`

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Tipo de Identif. | Identificação

**Formulário PUT `/admin/animals-management/108942`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `photo` |  | file |  |  |  |  |
| `specie_id` | Espécie | select | R |  | Bovinos de Corte |  |
| `category_id` | Categoria | select | R |  |  |  |
| `entry_date` | Data de Entrada | text (data) | R |  |  |  |
| `type` | Tipo de Cadastro | select |  |  | Individual, Sem Identificação |  |
| `quantity` | Quantidade | number |  |  |  |  |
| `category_matrice_id` | Estágio Reprodutivo | select |  |  | Lactação, Multípara, Novilha, Nulípara, Primípara, Secundípara, Solteira |  |
| `reproductive_status` | Status Reprodutivo | select |  |  | Prenha, Vazia, Parida |  |
| `breed_id` | Raça | select | R |  | Aberdeen Angus, Akaushi, Anelorado, Bonsmara, Braford, Brahman, Brangus, Caracu … (36) |  |
| `birth_date` | Data de nascimento | text (data) |  |  |  |  |
| `weight` | Peso (Kg) | text (moeda) | R |  |  |  |
| `price_kilo_alive` | Preço do Kg vivo | text (moeda) | R |  |  |  |
| `price_arroba_alive` | Preço da @ vivo | text (moeda) |  |  |  |  |
| `value_unitary` | Valor Unitário | text (moeda) |  |  |  |  |
| `unity_animal_ua` | Unidade animal (UA) | text (moeda) |  |  |  |  |
| `mother` | ID Mãe | text |  |  |  |  |
| `father` | ID Pai | text |  |  |  |  |
| `fur_description` | Descrição Pelagem | text |  | 100 |  |  |
| `birth_forecast` | Previsão de Parto | text (data) |  |  |  |  |
| `proprietary_id` | Proprietário Gestor | select |  |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `provider_id` | Origem do Animal | select |  |  | (lista dinâmica de cadastro — 39 registros; valores omitidos por privacidade) … (39) |  |
| `note` | Observação | textarea |  | 191 |  |  |
| `vl_acquisition` | Vl. Aquisição/Vl.Construção | text (moeda) |  |  |  |  |
| `depreciation_type` | Tipo de Depreciação | select |  |  | C/Vl. Residual, S/Vl. Residual |  |
| `residual` | Residual(%) | text |  |  |  |  |
| `life_bens` | Vida útil(anos) | text (moeda) |  |  |  |  |
| `depreciation` | Depreciação(%) | text |  |  |  |  |
| `vl_residual` | Vl. Residual | text (moeda) |  |  |  |  |
| `vl_depreciate` | Vl. p/Depreciação | text (moeda) |  |  |  |  |
| `vl_depreciated` | Vl. Depreciado | text |  |  |  |  |
| `sd_depreciate` | Sd. Á depreciar | text |  |  |  |  |
| `id_animals[]` |  | select | R |  | (lista dinâmica de cadastro — 8 registros; valores omitidos por privacidade) |  |
| `identification[]` |  | text | R |  |  |  |

## SCR-403 · Planejamento Pecuário

- **Rota:** `/admin/planning-livestock/create`
- **Módulo:** Operacional > Pecuária > Planejamento
- **Tipo:** Cadastro (novo)
- **Finalidade:** Planejamento (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/planning-livestock`

**Formulário POST `/admin/planning-livestock`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `harvest_id` | Safra | select | R |  | Safra 2023/2024, Safra 2023/2024, Safra 2024/2025, TESTE, Safra 1 |  |
| `created_at` | Dt. Criação | text | R |  |  |  |
| `grazing_id` | Módulo | select | R |  |  |  |
| `total_area` | Área Total/ha | text |  |  |  |  |
| `used_area` | Área Utilizada | text (moeda) | R |  |  |  |
| `available_area` | Área Disponível | text |  |  |  |  |
| `status` | Status | select | R |  | Pendente, Liberado, Encerrado |  |
| `commercial_dollar` | US$ Comercial | text (moeda) | R |  |  |  |
| `real_kg` | R$/Kg | text (moeda) | R |  |  |  |
| `real_arroba` | R$/@ | text (moeda) | R |  |  |  |
| `vl_total` | Vl. Planejado | text |  |  |  |  |
| `vl_area` | Vl. Planejado/ha | text |  |  |  |  |

## SCR-404 · Venda de Animais

- **Rota:** `/admin/movement-sales/create`
- **Módulo:** Operacional > Pecuária > Movimentações > Vendas
- **Tipo:** Cadastro (novo)
- **Finalidade:** Vendas (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/movement-sales`
- **Modais:** Novo Cliente

**Tabela**

- Colunas: Categoria | Quantidade | Preço Kg | Preço @ | Preço Cabeça | Valor Total

**Tabela**

- Colunas: Parcela | Vencimento | Valor
- Totalizador: Total

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Categoria | Conta Contábil | Centro de Custo | (%) | Valor
- Totalizador: Total 0 0

**Formulário POST `/admin/movement-sales/xml`**

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file |  |  |  |  |

**Formulário POST `/admin/movement-sales`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `dt_sale` | Dt.Venda | text | R |  |  |  |
| `user_name` | Responsável pela venda | text | R |  |  |  |
| `seller_id` | Vendedor | select |  |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `batch_sale` | Venda Lote | select | R |  | Não, Sim |  |
| `batch_id_sale[]` | Lotes | select (múltiplo) |  |  |  |  |
| `client_id` | Cliente | select | R |  | (lista dinâmica de cadastro — 7 registros; valores omitidos por privacidade) |  |
| `type_sale` | Tipo Venda | select | R |  | Recria, Abate |  |
| `pricing_type` | Tipo Precificação | select | R |  | Por Kg/Arroba, Por Cabeça |  |
| `average_weight_kg` | Peso Total Geral | text (moeda) |  |  |  |  |
| `batch_id[]` | Lote (filtro) | select |  |  |  |  |
| `animal_id[]` | Animal | select | R |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `category_animal[]` | Categoria | text | R |  |  |  |
| `previous_weight_kg[]` | Peso Inicial (Kg) | text (moeda) | R |  |  |  |
| `weight_kg[]` | Peso Atual (Kg) | text (moeda) | R |  |  |  |
| `gain[]` | Ganho/Período | text (moeda) | R |  |  |  |
| `gmd[]` | GMD | text (moeda) | R |  |  |  |
| `note_item[]` | Observações | text |  |  |  |  |
| `total_products` | Total de produtos | text (moeda) | R |  |  |  |
| `freight` | Frete | text (moeda) |  |  |  |  |
| `other_values` | Outros Valores | text (moeda) |  |  |  |  |
| `discount` | Desconto | text (moeda) |  |  |  |  |
| `total` | Total | text (moeda) | R |  |  |  |
| `type_payment` | Tipo de pagamento | select | R |  | Dinheiro, Cheque, Cartão de Crédito, Cartão de Débito, Crédito Loja, Vale Alimentação, Vale Refeição, Vale Presente … (15) |  |
| `gtas` | GTA's | text | R |  |  |  |
| `note` | Observações | textarea |  |  |  |  |
| `has_financial` | Gerar financeiro? | select | R |  | Não, Sim |  |
| `has_input` | Possui entrada ? | select |  |  | Sim, Não |  |
| `input_date` | Data entrada | text (data) |  |  |  |  |
| `input_value` | Valor entrada | text (moeda) |  |  |  |  |
| `qtd_installments` | Nª Parcelas | number |  |  |  |  |
| `first_installment` | Venc. 1ª. PC | text (data) |  |  |  |  |
| `int_installments` | Int. Parcelas (dias) | number |  |  |  |  |
| `fiscal_document` | Dedutível | select |  |  | Não, Sim |  |
| `categories[]` |  | select |  |  |  |  |
| `plan_accounts[]` |  | select |  |  |  |  |
| `centers[]` |  | select |  |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `category_percent_values[]` |  | text (moeda) |  |  |  |  |
| `category_values[]` |  | text (moeda) |  |  |  |  |

**Formulário POST `/admin/clients`** (modal newClientModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `nif` | CPF/CNPJ | text | R |  |  |  |
| `nickname` | Razão Social | text | R | 50 |  |  |
| `name` | Nome Fantasia | text | R | 30 |  |  |
| `email` | Email | email | R |  |  |  |
| `city_registration` | Insc. Municipal | text |  | 20 |  |  |
| `phone` | Telefone | text | R |  |  |  |
| `cellphone` | Celular | text |  |  |  |  |
| `contact` | Contato | text |  |  |  |  |
| `contact_phone` | Tel. do contato | text |  |  |  |  |
| `zip_code` | CEP | text |  |  |  |  |
| `address` | Endereço | text | R | 60 |  |  |
| `number` | Número | text | R |  |  |  |
| `district` | Bairro | text | R |  |  |  |
| `city_id` | Cidade | select | R |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `final_costumer` | Consumidor Final | select | R |  | Não, Sim |  |
| `taxpayer` | Contribuinte | select | R |  | Sim, Não |  |
| `id_abroad` | ID estrangeiro | text |  |  |  |  |
| `farm_name` | Nome da Fazenda | text |  | 100 |  |  |
| `state_registrations[]` |  | text |  |  |  |  |

## SCR-405 · Compra de Animais

- **Rota:** `/admin/movement-purchases/create`
- **Módulo:** Operacional > Pecuária > Movimentações > Compras
- **Tipo:** Cadastro (novo)
- **Finalidade:** Compras (cadastro (novo))
- **Abas:** Itens
- **Botões/Ações (cabeçalho):** Voltar → `/admin/movement-purchases`
- **Modais:** Novo Fornecedor

**Tabela**

- Colunas: Parcela | Vencimento | Valor
- Totalizador: Total

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Categoria | Conta Contábil | Centro de Custo | (%) | Valor
- Totalizador: Total 0 0

**Formulário POST `/admin/movement-purchases/xml`**

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file |  |  |  |  |

**Formulário POST `/admin/movement-purchases`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `dt_sale` | Dt.Compra | text (data) | R |  |  |  |
| `user_name` | Responsável | text | R |  |  |  |
| `seller_id` | Vendedor | select |  |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `provider_id` | Fornecedor | select | R |  | (lista dinâmica de cadastro — 39 registros; valores omitidos por privacidade) … (39) |  |
| `purchase_lot_id` | Pré-Lote | select |  |  | Nenhum |  |
| `chave` | Chave NFe | text |  | 44 |  |  |
| `serie` | Série NFe | text |  |  |  |  |
| `number` | Número NFe | text |  |  |  |  |
| `gtas` | GTA's | text |  |  |  |  |
| `category_id[]` | Categoria | select | R |  | Fêmeas > 36 meses, Fêmeas 25 a 36 meses, Fêmeas 13 a 24 meses, Fêmeas 0 a 12 meses, Machos 0 a 12 meses, Machos 13 a 24 meses, Machos 25 a 36 meses, Machos > 36 meses … (9) |  |
| `quantity[]` | Quantidade | number | R |  |  |  |
| `value_unit[]` | Valor Unitário (R$) | text (moeda) | R |  |  |  |
| `amount[]` | V. Total(R$) | text (moeda) | R |  |  |  |
| `note_item[]` | Observações | text |  |  |  |  |
| `total_products` | Total de produtos | text (moeda) | R |  |  |  |
| `freight` | Frete | text (moeda) |  |  |  |  |
| `other_values` | Outros Valores | text (moeda) |  |  |  |  |
| `discount` | Desconto | text (moeda) |  |  |  |  |
| `total` | Total | text (moeda) | R |  |  |  |
| `type_payment` | Tipo de pagamento | select | R |  | Dinheiro, Cheque, Cartão de Crédito, Cartão de Débito, Crédito Loja, Vale Alimentação, Vale Refeição, Vale Presente … (15) |  |
| `note` | Observações | textarea |  |  |  |  |
| `has_financial` | Gerar financeiro? | select | R |  | Não, Sim |  |
| `financial_number` | Nº Título | text |  | 15 |  |  |
| `financial_type_id` | Tipo | select |  |  | Ad. Cliente, Ad.Fornecedor, Ad.Funcionario, Boleto, Cartão de Crédito, Cheque, Contrato, Cupom Fiscal … (23) |  |
| `financial_proprietary_id` | Proprietário Gestor | select |  |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `financial_note` | Histórico | textarea |  | 200 |  |  |
| `has_input` | Possui entrada ? | select |  |  | Sim, Não |  |
| `input_date` | Data entrada | text (data) |  |  |  |  |
| `input_value` | Valor entrada | text (moeda) |  |  |  |  |
| `qtd_installments` | Nª Parcelas | number |  |  |  |  |
| `first_installment` | Venc. 1ª. PC | text (data) |  |  |  |  |
| `int_installments` | Int. Parcelas (dias) | number |  |  |  |  |
| `fiscal_document` | Dedutível | select |  |  | Não, Sim |  |
| `classification` | Classificação | select |  |  | Não Classificado, CAPEX, OPEX |  |
| `categories[]` |  | select |  |  |  |  |
| `plan_accounts[]` |  | select |  |  |  |  |
| `centers[]` |  | select |  |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `category_percent_values[]` |  | text (moeda) |  |  |  |  |
| `category_values[]` |  | text (moeda) |  |  |  |  |

**Formulário POST `/admin/movement-purchases/create`** (modal newProviderModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `nif` | CPF/CNPJ | text | R |  |  |  |
| `nickname` | Nome Completo/Razão Social | text | R | 60 |  |  |
| `name` | Nome Social/Fantasia | text | R | 80 |  |  |
| `state_registration` | Insc. Estadual | text |  | 20 |  |  |
| `city_registration` | Insc. Municipal | text |  | 20 |  |  |
| `type` | Tipo | select | R |  | Fornecedor, Funcionário, Terceirizado, Transportador, Comissionado, Inseminador |  |
| `email` | Email | email |  |  |  |  |
| `phone` | Telefone | text | R |  |  |  |
| `cellphone` | Celular | text |  |  |  |  |
| `zip_code` | CEP | text |  |  |  |  |
| `address` | Endereço | text | R |  |  |  |
| `city_id` | Cidade | select | R |  |  |  |
| `contact` | Contato | text |  |  |  |  |
| `contact_phone` | Tel. do contato | text |  |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |

## SCR-406 · Tipos de Identificação

- **Rota:** `/admin/birth-animals/create`
- **Módulo:** Operacional > Pecuária > Movimentações > Nascimentos
- **Tipo:** Cadastro (novo)
- **Finalidade:** Nascimentos (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/birth-animals`
- **Modais:** Novo Lote; Nova Transferência Lote Módulo/Área

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Tipo de Identif. | Identificação

**Formulário POST `/admin/birth-animals`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `image` |  | file |  |  |  |  |
| `code` | Código | text | R |  |  |  |
| `specie_id` | Espécie | select | R |  | Bovinos de Corte |  |
| `category_id` | Categoria | select | R |  |  |  |
| `date` | Data | text | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `batch_id` | Lote (filtro Mãe) | select |  |  |  |  |
| `animal_id` | ID Animal (Mãe) | select | R |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `father` | ID Pai/Sêmen | text |  |  |  |  |
| `transfer_batch_id` | Lote (transferência) | select |  |  |  |  |
| `breed_id` | Raça | select | R |  |  |  |
| `weight` | Peso (Kg) | text | R |  |  |  |
| `birth_note_id` | Observação | select | R |  | Parto Normal, Parto Cesárea, Parto Gemelar, Parto Gemelar Casal, Natimorto a partir da 20ª sem., Morte ao Nascimento, Nascido Aleijado, Aborto até a 20ª sem. |  |
| `fur_description` | Descrição Pelagem | text |  | 100 |  |  |
| `note` | Detalhes | textarea |  | 1000 |  |  |
| `id_animals[]` |  | select | R |  | (lista dinâmica de cadastro — 8 registros; valores omitidos por privacidade) |  |
| `identification[]` |  | text | R |  |  |  |

**Formulário POST `/admin/birth-animals/create`** (modal newBatchModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `date` | Data | text | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `parameter_weight_id` | Peso | select |  |  |  |  |
| `specie_id` | Espécie | select | R |  | Bovinos de Corte |  |
| `categories[]` | Categoria | select (múltiplo) | R |  |  |  |
| `description` | Descrição | text | R | 200 |  |  |
| `area_id` | Área | select |  |  | 01, 02, 03, 04, 05, 06, 07, 08 … (10) |  |
| `grazing_id` | Módulo | select |  |  |  |  |

**Formulário POST `/admin/birth-animals/create`** (modal newChangeBatchGrazingAreaModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `date` | Data | text | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `batch` | Lote | text |  |  |  |  |
| `qtd` | Quantidade | text |  |  |  |  |
| `area_id` | Área | select |  |  | 01, 02, 03, 04, 05, 06, 07, 08 … (10) |  |
| `grazing_id` | Módulo | select |  |  |  |  |

## SCR-407 · Mortes

- **Rota:** `/admin/death-animals/create`
- **Módulo:** Operacional > Pecuária > Movimentações > Mortes
- **Tipo:** Cadastro (novo)
- **Finalidade:** Mortes (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/death-animals`
- **Modais:** Tirar Foto
- **Gráficos:** 1

**Formulário POST `/admin/death-animals`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `photo` | Imagem | file |  |  |  |  |
| `code` | Código | text | R |  |  |  |
| `date` | Data | text | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `batch_id` | Lote | select | R |  |  |  |
| `animal_id` | ID Animal | select | R |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `cause_id` | Causa | select | R |  | Abscesso, Acidente, Afogamento / atolamento, Anaplasmose / babesiose / piroplasmose, Ataque por predadores, Botulismo, Brucelose, Castração … (43) |  |
| `note` | Observação | text |  |  |  |  |

## SCR-408 · Perdas

- **Rota:** `/admin/loss-animals/create`
- **Módulo:** Operacional > Pecuária > Movimentações > Perdas
- **Tipo:** Cadastro (novo)
- **Finalidade:** Perdas (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/loss-animals`

**Formulário POST `/admin/loss-animals`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `date` | Data | text | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `batch_id` | Lote | select | R |  |  |  |
| `animal_id` | ID Animal | select | R |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `cause_id` | Causa | select | R |  | Furto/Roubo, Sumiço, Fugido, Misturado outro lote |  |
| `note` | Observação | text |  |  |  |  |

## SCR-409 · Pré-Lote

- **Rota:** `/admin/purchase-lots/create`
- **Módulo:** Operacional > Pecuária > Manejo > Pré-Lotes
- **Tipo:** Cadastro (novo)
- **Finalidade:** Pré-Lotes (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/purchase-lots`; Importar planilha (modal #modalImportTags)
- **Modais:** Importar planilha de identificações

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Identificação 1 | Identificação 2 (opcional)

**Formulário POST `/admin/purchase-lots`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `date` | Data | text | R |  |  |  |
| `user_name` | Responsável | text | R |  |  |  |
| `description` | Descrição | text | R |  |  |  |
| `expected_quantity` | Quantidade esperada | number |  |  |  |  |
| `default_id_animal_id` | Tipo de identificação 1 | select | R |  | (lista dinâmica de cadastro — 8 registros; valores omitidos por privacidade) |  |
| `default_id_animal_id_2` | Tipo de identificação 2 (opcional) | select |  |  | (lista dinâmica de cadastro — 9 registros; valores omitidos por privacidade) … (9) |  |
| `tags[]` |  | text | R |  |  |  |
| `tags_2[]` |  | text |  |  |  |  |

## SCR-410 · Pesagem

- **Rota:** `/admin/weighings/create`
- **Módulo:** Operacional > Pecuária > Manejo > Pesagem
- **Tipo:** Cadastro (novo)
- **Finalidade:** Pesagem (cadastro (novo))
- **Abas:** Pesagens | Sanitário
- **Botões/Ações (cabeçalho):** Voltar → `/admin/weighings`

**Formulário POST `/admin/weighings`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `date` | Data | text (data) | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `is_stock` | Movimentação ABC Corte | select |  |  | Não, Sim |  |
| `arroba_value` | Preço do @ | text (moeda) |  |  |  |  |
| `batch_id` | Lote | select |  |  |  |  |
| `category_id` | Categoria | select |  |  | Fêmeas > 36 meses, Fêmeas 25 a 36 meses, Fêmeas 13 a 24 meses, Fêmeas 0 a 12 meses, Machos 0 a 12 meses, Machos 13 a 24 meses, Machos 25 a 36 meses, Machos > 36 meses … (42) |  |
| `sanitary` | Fazer Sanitário | select |  |  | Não, Sim |  |
| `animal_id[]` | Animal | select | R |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `last_weight_date[]` | Última Pesagem | text |  |  |  |  |
| `last_weight[]` | Último Peso (kg) | text |  |  |  |  |
| `weight[]` | Peso Atual (kg) | text | R |  |  |  |
| `gain[]` | Ganho | text |  |  |  |  |
| `daily_gain[]` | Ganho Diário | text |  |  |  |  |
| `has_ultrasound[]` | Ultrassom | select |  |  | Não, Sim |  |
| `aol[]` | AOL | text (moeda) |  |  |  |  |
| `egs[]` | EGS | text (moeda) |  |  |  |  |
| `marm[]` | MARM | text |  |  |  |  |
| `class[]` | Classe | text |  | 1 |  |  |
| `warehouse_id[]` | Armazém | select |  |  | BARRACAO |  |
| `product_id[]` | Produto | select |  |  | CIPERMETRINA POUR-ON CALBOS 1L, ATTACK PLUS GADO LIMPO 500GRS, ACIENDEL PO PLUS LT, VERRUCLIN 30ML, COLOSSO PULVERIZADO 25ML, MATA BICHEIRA ROXO LEPECID 475ML OURO I, BORGAL INJ. 10ML BACTERICIDA, COLOSSO PULVERIZACAO … (280) |  |
| `kinds[]` | Classe | text |  |  |  |  |
| `um[]` | Un. Medida | select |  |  |  |  |
| `qnt_stock[]` | Estoque | text (moeda) |  |  |  |  |
| `quantity[]` | Dose Animal | text (moeda) |  |  |  |  |
| `note_item[]` | Observação | text |  |  |  |  |

## SCR-411 · Pesagem

- **Rota:** `/admin/weighings/2223`
- **Módulo:** Operacional > Pecuária > Manejo > Pesagem
- **Tipo:** Detalhe
- **Finalidade:** Pesagem (detalhe)
- **Abas:** Animais
- **Botões/Ações (cabeçalho):** Voltar → `/admin/weighings`

**Tabela** — linhas na amostra: 1

- Colunas: Animal | Última Pesagem | Último Peso (Kg) | Peso (Kg) | Ganho | Ganho Diário

## SCR-412 · Pesagem

- **Rota:** `/admin/weighings/2223/edit`
- **Módulo:** Operacional > Pecuária > Manejo > Pesagem
- **Tipo:** Cadastro (edição)
- **Finalidade:** Pesagem (cadastro (edição))
- **Abas:** Pesagens | Sanitário
- **Botões/Ações (cabeçalho):** Voltar → `/admin/weighings`

**Formulário PUT `/admin/weighings/2223`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `date` | Data | text (data) | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `is_stock` | Movimentação ABC Corte | select |  |  | Não, Sim |  |
| `arroba_value` | Preço do @ | text (moeda) |  |  |  |  |
| `batch_id` | Lote | select |  |  |  |  |
| `category_id` | Categoria | select |  |  | Fêmeas > 36 meses, Fêmeas 25 a 36 meses, Fêmeas 13 a 24 meses, Fêmeas 0 a 12 meses, Machos 0 a 12 meses, Machos 13 a 24 meses, Machos 25 a 36 meses, Machos > 36 meses … (42) |  |
| `animal_id[]` | Animal | select | R |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `last_weight_date[]` | Última Pesagem | text |  |  |  |  |
| `last_weight[]` | Último Peso (kg) | text |  |  |  |  |
| `weight[]` | Peso Atual (kg) | text | R |  |  |  |
| `gain[]` | Ganho | text |  |  |  |  |
| `daily_gain[]` | Ganho Diário | text |  |  |  |  |
| `has_ultrasound[]` | Ultrassom | select |  |  | Não, Sim |  |
| `aol[]` | AOL | text (moeda) |  |  |  |  |
| `egs[]` | EGS | text (moeda) |  |  |  |  |
| `marm[]` | MARM | text |  |  |  |  |
| `class[]` | Classe | text |  | 1 |  |  |

## SCR-413 · Nutrição

- **Rota:** `/admin/nutritions/create`
- **Módulo:** Operacional > Pecuária > Manejo > Nutrição
- **Tipo:** Cadastro (novo)
- **Finalidade:** Nutrição (cadastro (novo))
- **Abas:** Produtos | MO/Serviços
- **Botões/Ações (cabeçalho):** Voltar → `/admin/nutritions`

**Tabela**

- Colunas: Lote | % | Horas
- Totalizador: Total 0,00 0,00

**Formulário POST `/admin/nutritions`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `date` | Data | text (data) | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `time_control` | Controlar Horas | select | R |  | Não, Sim |  |
| `warehouse_id[]` | Armazém | select | R |  | BARRACAO |  |
| `product_id[]` | Produto | select | R |  |  |  |
| `product_um[]` | Un. Medida | select |  |  |  |  |
| `qnt_stock[]` | Estoque | text (moeda) |  |  |  |  |
| `quantity[]` | Quantidade | text (moeda) | R |  |  |  |
| `amount[]` | Vl. Unitário | text (moeda) | R |  |  |  |
| `total_amount[]` | Vl. Total | text (moeda) |  |  |  |  |
| `grazing_id[]` | Módulo Pastejo | select |  |  |  |  |
| `area_id[]` | Área | select |  |  | 01, 02, 03, 04, 05, 06, 07, 08 … (10) |  |
| `trough_id[]` | Cocho | select | R |  |  |  |
| `note_item[]` | Observação | text |  |  |  |  |
| `cost_center_id[]` | Centro de Custo | select |  |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `func_type[]` | Tipo | select |  |  | Funcionário, Função, Fornecedor |  |
| `func_executor_id[]` | Executador | select |  |  |  |  |
| `func_um[]` | Un. Medida | select |  |  | @, %, °C, °F, 1000 un, 1000UN, BAG, Balde … (59) |  |
| `func_total_quantity[]` | Qtd Total | text (moeda) |  |  |  |  |
| `func_amount[]` | Vl. Hora (R$) | text (moeda) |  |  |  |  |

## SCR-414 · Sanitário

- **Rota:** `/admin/sanitaries/create`
- **Módulo:** Operacional > Pecuária > Manejo > Sanitário
- **Tipo:** Cadastro (novo)
- **Finalidade:** Sanitário (cadastro (novo))
- **Abas:** Produtos | MO/Serviços
- **Botões/Ações (cabeçalho):** Voltar → `/admin/sanitaries`

**Formulário POST `/admin/sanitaries`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `date` | Data | text (data) | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `batch_id` | Lote | select | R |  |  |  |
| `time_control` | Controlar Horas | select | R |  | Não, Sim |  |
| `animals[]` | Selecione os Animais (identificação)Marcar todos Desmarcar todos | select (múltiplo) | R |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `warehouse_id[]` | Armazém | select | R |  | BARRACAO |  |
| `product_id[]` | Produto | select | R |  |  |  |
| `kinds[]` | Classe | text |  |  |  |  |
| `um[]` | Un. Medida | select | R |  |  |  |
| `qnt_stock[]` | Estoque | text (moeda) |  |  |  |  |
| `quantity[]` | Dose Animal | text (moeda) | R |  |  |  |
| `total_quantity[]` | Qtd. Total | text (moeda) | R |  |  |  |
| `amount[]` | Vl. Unitário | text (moeda) | R |  |  |  |
| `total_amount[]` | Vl. Total | text (moeda) |  |  |  |  |
| `note_item[]` | Observação | text |  |  |  |  |
| `cost_center_id[]` | Centro de Custo | select |  |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `func_type[]` | Tipo | select |  |  | Funcionário, Função, Fornecedor |  |
| `func_executor_id[]` | Executador | select |  |  |  |  |
| `func_um[]` | Un. Medida | select |  |  | @, %, °C, °F, 1000 un, 1000UN, BAG, Balde … (59) |  |
| `func_total_quantity[]` | Qtd Total | text (moeda) |  |  |  |  |

## SCR-415 · Desmama

- **Rota:** `/admin/weanings/create`
- **Módulo:** Operacional > Pecuária > Manejo > Desmama
- **Tipo:** Cadastro (novo)
- **Finalidade:** Desmama (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/weanings`

**Formulário POST `/admin/weanings`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `date` | Data | text (data) | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `type` | Tipo | select | R |  | Recria, Venda |  |
| `batch_id` | Lote (Filtro) | select | R |  |  |  |
| `transfer_batch_id` | Lote (Transferência Vaca) | select |  |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `animals[]` | Identificação Vacas Paridas | select (múltiplo) | R |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |

## SCR-416 · Apartação

- **Rota:** `/admin/separations/create`
- **Módulo:** Operacional > Pecuária > Manejo > Apartação
- **Tipo:** Cadastro (novo)
- **Finalidade:** Apartação (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/separations`

**Formulário POST `/admin/separations`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `date` | Data | text (data) | R |  |  |  |
| `user_name` | Responsável | text | R |  |  |  |
| `batches[]` | Lotes | select (múltiplo) | R |  |  |  |

## SCR-417 · Pastagem

- **Rota:** `/admin/pastures/create`
- **Módulo:** Operacional > Pecuária > Manejo > Pastagem
- **Tipo:** Cadastro (novo)
- **Finalidade:** Pastagem (cadastro (novo))
- **Abas:** MO/Serviços | Máq/Implementos | Insumos | Produção | Ocorrências
- **Botões/Ações (cabeçalho):** Voltar → `/admin/pastures`
- **Modais:** Produto

**Formulário POST `/admin/pastures`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `date` | Data | text | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `operation_id` | Operação | select | R |  | Preparo do Solo, Conservação do Solo, Plantio, Tratos Culturais, Tratos Fitossanitários, Colheita, Pós Colheita, Armazenagem … (19) |  |
| `activity_id` | Atividade | select | R |  |  |  |
| `area_id` | Área | select |  |  | 01, 02, 03, 04, 05, 06, 07, 08 … (10) |  |
| `grazing_id` | Módulo | select |  |  |  |  |
| `batch_id` | Lote | select |  |  |  |  |
| `animal_id` | Animal | select |  |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `func_type[]` | Tipo | select |  |  | Funcionário, Função, Fornecedor |  |
| `func_executor_id[]` | Executador | select |  |  |  |  |
| `func_um[]` | Un. Medida | select |  |  | @, %, °C, °F, 1000 un, 1000UN, BAG, Balde … (59) |  |
| `func_quantity[]` | Qtd/ha | text (moeda) |  |  |  |  |
| `func_total_quantity[]` | Qtd Total | text (moeda) |  |  |  |  |
| `equipment_equipment_id[]` | Maq/Equipamento/Veículo | select |  |  | A 73F VALTRA/CABINADO, ADUBADEIRA DE ARRASTE KAMAQ, ADUBADEIRA HIDRÁULICA, BALANÇA, BALANÇA, BALANÇA BONIVA ELETRONICA RETANGULAR FIXA KM-3-N COIMMA, BALANÇA DIGITAL SUSPENSA 3000 KG BIV, BATEDEIRA DE PIMENTA … (118) |  |
| `equipment_um[]` | Un. Medida | select |  |  | @, %, °C, °F, 1000 un, 1000UN, BAG, Balde … (59) |  |
| `equipment_start_hour_meter[]` | Horímetro Inicial | text |  |  |  |  |
| `equipment_note[]` | Observação | text |  |  |  |  |
| `inputs_warehouse_id` | Armazem de insumos | select |  |  | BARRACAO |  |
| `product_stock_id[]` | Produto | select |  |  |  |  |
| `product_um[]` | Un. Medida | select |  |  |  |  |
| `qtd_stock[]` | Estoque | text |  |  |  |  |
| `product_quantity[]` | Qtd/ha | text (moeda) |  |  |  |  |
| `product_quantity_unitary[]` | Qtd Und. | text (moeda) |  |  |  |  |
| `product_total_quantity[]` | Qtd Total | text (moeda) |  |  |  |  |
| `productions_warehouse_id` | Armazem de produção | select |  |  | Não possui armazém de produção |  |
| `production_product_id[]` | Produto | select |  |  |  |  |
| `production_um[]` | Un. Medida | select |  |  |  |  |
| `qtd_stock[]` | Estoque | text (moeda) |  |  |  |  |
| `production_quantity[]` | Qtde | text (moeda) |  |  |  |  |
| `final_quantity[]` | Quantidade Final | text (moeda) |  |  |  |  |
| `production_note[]` | Observação | text |  |  |  |  |
| `occurrences[0][images][]` |  | file |  |  |  |  |
| `occurrences[0][images][]` |  | file |  |  |  |  |
| `occurrences[0][images][]` |  | file |  |  |  |  |
| `occurrences[0][priority]` | Prioridade | select |  |  | Baixa, Média, Alta |  |
| `occurrences[0][diagnosis]` | Diagnóstico | textarea |  |  |  |  |
| `occurrences[0][recommendation]` | Recomendações | textarea |  |  |  |  |

**Formulário POST `/admin/pastures/create`** (modal newProductModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `description` | Descrição | text | R |  |  |  |
| `ncm_id` | Ncm | select |  |  |  |  |
| `measurement_id` | 1ª. Un.Medida | select | R |  | @, %, °C, °F, 1000 un, 1000UN, BAG, Balde … (59) |  |
| `second_measurement_id` | 2ª. Un.Medida | select |  |  | @, %, °C, °F, 1000 un, 1000UN, BAG, Balde … (59) |  |
| `factor_type` | Tipo | select |  |  | Multiplica, Divide |  |
| `factor` | Fator conversão | text (moeda) |  |  |  |  |
| `group_id` | Grupo | select | R |  | Insumos Agrícola, Insumos Gerais, Insumos Industrialização, Insumos Pecuária, Máquinas/Equipamentos/Veículos, Produção, Produtos Exportação |  |
| `category_id` | Cat. Produtos | select | R |  |  |  |
| `kind_id` | Classe | select | R |  |  |  |
| `cultivation_id` | Variedade | select |  |  | Soja - 1823, Soja - Bonus, Soja - Bonus, CANA DE AÇUCAR - ERLAM - CANA DE AÇUCAR, Soja - Extrema, Soja - Monsoy 8606, PLANTAÇÃO DE MORANGO - ERLAM - MORANGO DE MESA, Banana - Nanica … (14) |  |
| `quality` | Qualidade | select |  |  | 1 |  |
| `has_lot` | Cont. Lote | select | R |  | Sim, Não |  |
| `control_stock` | Controla Estoque | select | R |  | Sim, Não |  |
| `min_stock` | Estoque minimo | text (moeda) |  |  |  |  |
| `las_price` | Vl. Referência (R$) | text (moeda) |  |  |  |  |
| `active_principle` | Princípio Ativo | text |  | 50 |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `allow_pointing` | Apontamento | select | R |  | Não, Sim |  |
| `financial_category_id` | Cat. Financeira - Custo | select |  |  | 2.01.001.0001 - Energia Elétrica, 2.01.001.0002 - Telefone/Internet, 2.01.001.0003 - Aluguéis, 2.01.001.0004 - Água/Esgoto, 2.01.001.0005 - Brindes/Cortesias, 2.01.001.0006 - Viagens/Diárias, 2.01.001.0007 - Treinamento Mão de Obra, 2.01.001.0008 - Softwares … (209) | Categoria financeira utilizada para classificação de custos de produção. Obrigatório quando o produto controla estoque. |

## SCR-418 · Pastagem

- **Rota:** `/admin/pastures/288`
- **Módulo:** Operacional > Pecuária > Manejo > Pastagem
- **Tipo:** Detalhe
- **Finalidade:** Pastagem (detalhe)
- **Abas:** MO/Serviços | Máq/Implementos | Insumos | Produção
- **Botões/Ações (cabeçalho):** Voltar → `/admin/pastures`

**Tabela**

- Colunas: Produto | Un. Medida | Qtd/ha | Qtd Un. | Qtd Total | Vl.Unit | Vl.Total | Área/Módulo | Centro de Custo | Operação | Atividade | Tipo

**Tabela**

- Colunas: Área/Módulo | Operação | Atividade | Máq./Equipamento | Un. Medida | Horímetro Inicial | Horímetro Final | Qtd | Vl.Unit | Vl.Total | Centro de Custo | Tipo

**Tabela**

- Colunas: Área/Módulo | Operação | Atividade | Executador | Un. Medida | Qtd/ha | Qtd. Total | Vl.Unit | V. Total(R$) | Centro de Custo | Tipo

**Tabela**

- Colunas: Produto | Un. Medida | Qtde | Área | Centro de Custo | Operação | Atividade | Observações

## SCR-419 · Pastagem

- **Rota:** `/admin/pastures/288/edit`
- **Módulo:** Operacional > Pecuária > Manejo > Pastagem
- **Tipo:** Cadastro (edição)
- **Finalidade:** Pastagem (cadastro (edição))
- **Abas:** Ocorrências
- **Botões/Ações (cabeçalho):** Voltar → `/admin/pastures`

**Formulário PUT `/admin/pastures/288`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `date` | Data | text | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `operation_id` | Operação | select | R |  | Preparo do Solo, Conservação do Solo, Plantio, Tratos Culturais, Tratos Fitossanitários, Colheita, Pós Colheita, Armazenagem … (19) |  |
| `activity_id` | Atividade | select | R |  | Manutenções de Cercas |  |
| `area_id` | Área | select |  |  |  |  |
| `grazing_id` | Módulo | select |  |  |  |  |
| `batch_id` | Lote | select |  |  |  |  |
| `animal_id` | Animal | select |  |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `func_type[]` | Tipo | select |  |  | Funcionário, Função, Fornecedor |  |
| `func_executor_id[]` | Executador | select |  |  |  |  |
| `func_um[]` | Un. Medida | select |  |  | @, %, °C, °F, 1000 un, 1000UN, BAG, Balde … (59) |  |
| `func_quantity[]` | Qtd/ha | text (moeda) |  |  |  |  |
| `func_total_quantity[]` | Qtd Total | text (moeda) |  |  |  |  |
| `equipment_equipment_id[]` | Maq/Equipamento/Veículo | select |  |  | A 73F VALTRA/CABINADO, ADUBADEIRA DE ARRASTE KAMAQ, ADUBADEIRA HIDRÁULICA, BALANÇA, BALANÇA, BALANÇA BONIVA ELETRONICA RETANGULAR FIXA KM-3-N COIMMA, BALANÇA DIGITAL SUSPENSA 3000 KG BIV, BATEDEIRA DE PIMENTA … (118) |  |
| `equipment_um[]` | Un. Medida | select |  |  | @, %, °C, °F, 1000 un, 1000UN, BAG, Balde … (59) |  |
| `equipment_start_hour_meter[]` | Horímetro Inicial | text |  |  |  |  |
| `equipment_note[]` | Observação | text |  |  |  |  |
| `inputs_warehouse_id` | Armazem de insumos | select |  |  | BARRACAO |  |
| `product_stock_id[]` | Produto | select |  |  |  |  |
| `product_um[]` | Un. Medida | select |  |  |  |  |
| `qtd_stock[]` | Estoque | text |  |  |  |  |
| `product_quantity[]` | Qtd/ha | text (moeda) |  |  |  |  |
| `product_quantity_unitary[]` | Qtd Und. | text (moeda) |  |  |  |  |
| `product_total_quantity[]` | Qtd Total | text (moeda) |  |  |  |  |
| `productions_warehouse_id` | Armazem de produção | select |  |  | Não possui armazém de produção |  |
| `production_product_id[]` | Produto | select |  |  |  |  |
| `production_um[]` | Un. Medida | select |  |  |  |  |
| `qtd_stock[]` | Estoque | text (moeda) |  |  |  |  |
| `production_quantity[]` | Qtde | text (moeda) |  |  |  |  |
| `final_quantity[]` | Quantidade Final | text (moeda) |  |  |  |  |
| `production_note[]` | Observação | text |  |  |  |  |
| `occurrences[0][images][]` |  | file |  |  |  |  |
| `occurrences[0][images][]` |  | file |  |  |  |  |
| `occurrences[0][images][]` |  | file |  |  |  |  |
| `occurrences[0][priority]` | Prioridade | select |  |  | Baixa, Média, Alta |  |
| `occurrences[0][diagnosis]` | Diagnóstico | textarea |  |  |  |  |
| `occurrences[0][recommendation]` | Recomendações | textarea |  |  |  |  |

## SCR-420 · Estação de Monta

- **Rota:** `/admin/breeding-seasons/create`
- **Módulo:** Operacional > Pecuária > Manejo > Reprodução > Estação de Monta
- **Tipo:** Cadastro (novo)
- **Finalidade:** Estação de Monta (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/breeding-seasons`
- **Gráficos:** 1

**Formulário POST `/admin/breeding-seasons`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `date` | Data | text | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `description` | Descrição | text | R |  |  |  |
| `start_date` | Data Inicial | text | R |  |  |  |
| `end_date` | Data Final | text | R |  |  |  |
| `days` | Dias/Estação | text |  |  |  |  |
| `weeks` | Semanas | text |  |  |  |  |

## SCR-421 · Lotes

- **Rota:** `/admin/breeding-batch/create`
- **Módulo:** Operacional > Pecuária > Manejo > Reprodução > Lotes/Reprodução
- **Tipo:** Cadastro (novo)
- **Finalidade:** Lotes/Reprodução (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/breeding-batch`

**Formulário POST `/admin/breeding-batch`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `date` | Data | text | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `breeding_season_id` | Estação de monta | select | R |  |  |  |
| `description` | Descrição | text | R |  |  |  |
| `batches[]` |  | select | R |  |  |  |

## SCR-422 · Animais

- **Rota:** `/admin/bull-seed-season/create`
- **Módulo:** Operacional > Pecuária > Manejo > Reprodução > Touros/Sêmen/Embrião
- **Tipo:** Cadastro (novo)
- **Finalidade:** Touros/Sêmen/Embrião (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/bull-seed-season`

**Formulário POST `/admin/bull-seed-season`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `date` | Data | text | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `breeding_season_id` | Estação de monta | select | R |  |  |  |
| `description` | Descrição | text | R |  |  |  |
| `animals[]` | Animal | select |  |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `warehouse_id[]` | Armazém | select |  |  | BARRACAO |  |
| `products[]` | Produto | select |  |  | Sêmen Touro BRF02, CAPITAO DA AGUA FRIA 29NE5146 RGD JCGG 15568 000267, COMBOIO FIV DA S NICE 29NE5076 RGD GRI B7329 02641-3, HULK FVC, Semen ALPINISTA DA S.NICE GRI C1268 MG1182000936 Raca NE GRI C1268, Semen APOLO FIV DE NAVIRAI CSCC 7058 MG1182000914 Raca NE CSCC 7058, Semen B6777 DA S. NICE GRI B6777 MG1182000333 Raca, SEMEN DIESEL … (35) |  |
| `um[]` | Un. Medida | text |  |  |  |  |
| `stock[]` | Estoque | text |  |  |  |  |
| `quantity[]` | Quantidade | text (moeda) |  |  |  |  |

## SCR-423 · Produtos

- **Rota:** `/admin/protocols-season/create`
- **Módulo:** Operacional > Pecuária > Manejo > Reprodução > Protocolos/Estação
- **Tipo:** Cadastro (novo)
- **Finalidade:** Protocolos/Estação (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/protocols-season`

**Formulário POST `/admin/protocols-season`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `date` | Data | text | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `breeding_season_id` | Estação de monta | select | R |  |  |  |
| `name` | Nome | text | R | 200 |  |  |
| `description` | Descrição | text |  | 200 |  |  |
| `identification[]` | Identificação | text |  |  |  |  |
| `protocol_date[]` | Data | text (data) | R |  |  |  |
| `protocol_time[]` | Horário | time | R |  |  |  |
| `warehouse[]` | Armazém | select |  |  | Sem estoque, BARRACAO |  |
| `products[]` | Produto | select | R |  | Benzoato de Estradiol, Implanta Intravagial - Monodose, Prostaglandina, Cipionato de Estradiol, ECG, GNRH, Progesterona Injetável, BAINHA FRANCESA IA … (50) |  |
| `services[]` | Serviço | select | R |  | Inseminação, Ultrassom, Diagnóstico Gestacional, Retirada de Implante |  |
| `measurement_id[]` | Un. Medida | select |  |  |  |  |
| `stock[]` | Estoque | text (moeda) |  |  |  |  |
| `quantity[]` | Quantidade | text (moeda) | R |  |  |  |

## SCR-424 · Monta Natural

- **Rota:** `/admin/breeding-matings/create`
- **Módulo:** Operacional > Pecuária > Manejo > Reprodução > Acasalamento
- **Tipo:** Cadastro (novo)
- **Finalidade:** Acasalamento (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `javascript:history.back()`
- **Modais:** Novo Lote; Nova Transferência Lote Módulo/Área; Mudar Lote (Animais não selecionados)

**Tabela** — linhas na amostra: 1

- Colunas: Produto | Un. Medida | Estoque | Qtd. Utilizada

**Tabela** — linhas na amostra: 1

- Colunas: Produto | Un. Medida | Estoque | Quantidade

**Tabela** — linhas na amostra: 1

- Colunas: Produto | Un. Medida | Estoque | Quantidade

**Formulário POST `/admin/breeding-matings`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `date` | Data | text | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `type` | Tipo de Reprodução | select | R |  | Natural, IATF, FIV |  |
| `launch_type` | Tipo de Lançamento | select | R |  | Normal, Simplificado |  |
| `breeding_season_id` | Estação de Monta | select | R |  |  |  |
| `bull_seed_season_id` | Touro/Sêmen/Embrião | select | R |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `protocol_id` | Protocolo | select |  |  |  |  |
| `breeding_batch_id` | Lote de Reprodução | select | R |  |  |  |
| `cows[]` | Animais Lote de ReproduçãoMarcar todos Desmarcar todos | select (múltiplo) |  |  |  |  |
| `bulls` | Touro | select |  |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `bull_natural_simplified` | Touro | select |  |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `animals_natural_simplified[]` | Animal | select |  |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `animal_id_fiv_iatf[]` | Animal | select |  |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `hour_fiv_iatf[]` | Horário | time |  |  |  |  |
| `ecc_fiv_iatf[]` | Score Corporal | select |  |  | 1, 1,25, 1,50, 1,75, 2, 2,25, 2,50, 2,75 … (17) |  |
| `ink_iatf[]` | Tintas | select |  |  | Sim, Pouca, Não |  |
| `eligible_fiv_iatf[]` | Apta | select |  |  | Não, Sim |  |
| `inseminator_fiv_iatf[]` | Funcionário/Inseminador | select |  |  | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |  |
| `products_fiv_iatf[][]` | Produtos | select (múltiplo) |  |  |  |  |
| `seed_id_fiv_iatf[]` | Sêmen | select |  |  |  |  |
| `batch_id_fiv_iatf[]` | Transferência/Lote | select |  |  |  |  |
| `animals[]` | Animal | select |  |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `warehouses[]` | Armazém | select |  |  | BARRACAO |  |
| `stocks[]` | Produto | select |  |  |  |  |
| `measurement_id[]` | Un. Medida | select |  |  |  |  |
| `stock_quantity[]` | Estoque | text (moeda) |  |  |  |  |
| `quantity[]` | Quantidade | text (moeda) |  |  |  |  |
| `inseminator[]` | Funcionário/Inseminador | select |  |  | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |  |

**Formulário POST `/admin/breeding-matings/create`** (modal newBatchModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `date` | Data | text | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `parameter_weight_id` | Peso | select |  |  |  |  |
| `specie_id` | Espécie | select | R |  | Bovinos de Corte |  |
| `categories[]` | Categoria | select (múltiplo) | R |  |  |  |
| `description` | Descrição | text | R | 200 |  |  |

**Formulário POST `/admin/breeding-matings/create`** (modal newChangeBatchGrazingAreaModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `date` | Data | text | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `batch` | Lote | text |  |  |  |  |
| `qtd` | Quantidade | text |  |  |  |  |
| `area_id` | Área | select |  |  | 01, 02, 03, 04, 05, 06, 07, 08 … (10) |  |
| `grazing_id` | Módulo | select |  |  |  |  |

**Formulário POST `/admin/breeding-matings/create`** (modal changeBatchModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `animals_to_transfer` | Animais p/ Transferência | text |  |  |  |  |
| `new_batch` | Novo lote | select |  |  |  |  |

## SCR-425 · Pátio

- **Rota:** `/admin/feedlot-yards/create`
- **Módulo:** Operacional > Pecuária > Confinamento > Cadastros > Pátios
- **Tipo:** Cadastro (novo)
- **Finalidade:** Pátios (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/feedlot-yards`

**Formulário POST `/admin/feedlot-yards`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `name` | Nome | text | R | 120 |  |  |
| `is_active` | Status | select | R |  | Ativo, Inativo |  |
| `width` | Largura (m) | text (moeda) | R | 12 |  |  |
| `length` | Comprimento (m) | text (moeda) | R | 12 |  |  |
| `total_area` | Área Total (m²) | text (moeda) | R |  |  |  |
| `observation` | Observações | textarea |  | 600 |  |  |

## SCR-426 · Setores

- **Rota:** `/admin/feedlot-sectors/create`
- **Módulo:** Operacional > Pecuária > Confinamento > Cadastros > Setores
- **Tipo:** Cadastro (novo)
- **Finalidade:** Setores (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/feedlot-sectors`

**Formulário POST `/admin/feedlot-sectors`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `name` | Nome | text | R | 120 |  |  |
| `feedlot_yard_id` | Pátio | select | R |  |  |  |
| `width` | Largura(m) | text (moeda) | R | 12 |  |  |
| `length` | Comprimento(m) | text (moeda) | R | 12 |  |  |
| `total_area` | Área Total(m²) | text (moeda) | R |  |  |  |
| `is_active` | Status | select | R |  | Ativo, Inativo |  |
| `observation` | Observações | textarea |  | 600 |  |  |

## SCR-427 · Curral

- **Rota:** `/admin/feedlot-corrals/create`
- **Módulo:** Operacional > Pecuária > Confinamento > Cadastros > Currais
- **Tipo:** Cadastro (novo)
- **Finalidade:** Currais (cadastro (novo))
- **Abas:** Dados Gerais | Espaço Físico | Lotes
- **Botões/Ações (cabeçalho):** Cancelar → `/admin/feedlot-corrals`
- **Modais:** Novo Cocho; Novo Bebedouro; Novo Lote

**Formulário POST `/admin/feedlot-corrals`**

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `identification` | Identificação | text | R |  |  |  |
| `name` | Nome | text | R | 120 |  |  |
| `feedlot_sector_id` | Setor | select | R |  |  |  |
| `installation_type` | Tipo de Instalação | select | R |  | Coberto, Descoberto |  |
| `status` | Situação | select | R |  | Vazio, Vazio Sanitário, Ocupado, Manutenção, Limpeza, Enfermaria, Interditado |  |
| `available_at` | Liberação em | text (data) | R |  |  |  |
| `note` | Observação | textarea |  | 1500 |  | Adicione informações sobre a mudança da Situação do Curral. |
| `width` | Largura(m) | text (moeda) | R | 12 |  |  |
| `length` | Comprimento(m) | text (moeda) | R | 12 |  |  |
| `total_area` | Área Total(m²) | text (moeda) | R |  |  |  |
| `capacity` | Capacidade | text | R | 20 |  |  |
| `coverage` | Cobertura | select | R |  | Aberto, Cobertura Parcial, Cobertura Total, Galpão Metálico, Galpão com Isolamento, Telha Termoacústica, Fibrocimento, Cerâmica … (10) |  |
| `floor` | Piso | select | R |  | Terra Batida, Concreto, Concreto Ranhurado/Frisado, Cascalho Brita, Pedra, Areia, Borracha, Cama Seca/Sobreposta … (9) |  |
| `shading` | Sombreamento | select | R |  | Natural, Artificial, Não Possui |  |
| `trough_id` | Cocho | select | R |  | cocho 1 |  |
| `drinking_fountain_id` | Bebedouro | select | R |  |  |  |
| `batch_id[]` | Lote | select |  |  |  |  |

**Formulário POST `/admin/feedlot-corrals/create`** (modal newTroughModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `type` | Tipo | select | R |  | Coberto, Descoberto |  |
| `description` | Descrição | text | R | 200 |  |  |
| `total_area` | Área(Cm) | text | R |  |  |  |
| `grazing_id` | Módulo Pastejo | select |  |  |  |  |
| `area_id` | Área | select |  |  | 01 (1 cochos), 02 (0 cochos), 03 (0 cochos), 04 (0 cochos), 05 (0 cochos), 06 (0 cochos), 07 (0 cochos), 08 (0 cochos) … (10) |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |

**Formulário POST `/admin/feedlot-corrals/create`** (modal newDrinkingFountainModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `type` | Tipo | select | R |  | Coberto, Descoberto |  |
| `description` | Descrição | text | R |  |  |  |
| `total_area` | Volume (L) | text | R |  |  |  |
| `length` | Comprimento (cm) | text |  |  |  |  |
| `grazing_id` | Módulo Pastejo | select |  |  |  |  |
| `area_id` | Área | select |  |  | 01 (1 cochos), 02 (0 cochos), 03 (0 cochos), 04 (0 cochos), 05 (0 cochos), 06 (0 cochos), 07 (0 cochos), 08 (0 cochos) … (10) |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |

**Formulário POST `/admin/feedlot-corrals/create`** (modal newBatchModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `date` | Data | text | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `parameter_weight_id` | Peso | select |  |  |  |  |
| `specie_id` | Espécie | select | R |  | Bovinos de Corte |  |
| `categories[]` | Categoria | select (múltiplo) | R |  |  |  |
| `description` | Descrição | text | R | 200 |  |  |

## SCR-428 · Dieta

- **Rota:** `/admin/diets/create`
- **Módulo:** Operacional > Pecuária > Confinamento > Nutrição > Dieta
- **Tipo:** Cadastro (novo)
- **Finalidade:** Dieta (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/diets`; Adicionar Ingrediente

**Tabela** — linhas na amostra: 1

- Colunas: Produto | Unidade | Quantidade | Vl. Unitário | Vl. Total | % M. Seca | (seleção)

**Formulário POST `/admin/diets`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `product_id` | Produto | select | R |  | Dieta Adaptação, Dieta Crescimento, Dieta Engorda |  |
| `quantity` | Quantidade Referência | text (moeda) | R |  |  | Esta é a medida padrão da dieta. Se a dieta foi criada para 1kg, mas você vai produzir 10kg, o sistema multiplicará os insumos por 10 automaticamente. |
| `measurement_id` | Unidade Medida | select | R |  |  |  |
| `date` | Data de Criação | text | R |  |  |  |
| `objective` | Objetivo | select | R |  | Adaptação, Crescimento, Terminação |  |
| `type` | Tipo | select | R |  | Unidade, Porcentagem |  |
| `user_name` | Responsável | text | R |  |  |  |
| `products[]` |  | select | R |  | Bagaço de Cana, CAFE, CALCÁRIO CALCÍTRICO, CALCITE, CASCA DE SOJA PELETIZADA (GRANEL), Dieta Adaptação, Dieta Crescimento, Dieta Engorda … (28) |  |
| `measurements[]` |  | select | R |  |  |  |
| `quantities[]` |  | text (moeda) | R |  |  |  |
| `cost_values[]` |  | text (moeda) | R |  |  |  |
| `totals[]` |  | text (moeda) |  |  |  |  |
| `dry_matter_ingredients[]` |  | text (moeda) | R |  |  |  |
| `observation` | Observação | textarea |  | 1500 |  |  |
| `cost_per_kg` | Custo Por KG | text (moeda) |  |  |  |  |
| `estimated_cost` | Custo Estimado | text (moeda) |  |  |  |  |
| `dry_matter` | Média Matéria Seca (%) | text (moeda) |  |  |  |  |

## SCR-429 · Fases/Regras de Troca

- **Rota:** `/admin/feeding-phases/create`
- **Módulo:** Operacional > Pecuária > Confinamento > Nutrição > Fases/Regras Troca
- **Tipo:** Cadastro (novo)
- **Finalidade:** Fases/Regras Troca (cadastro (novo))
- **Abas:** Configuração das Fases
- **Botões/Ações (cabeçalho):** Voltar → `/admin/feeding-phases`

**Formulário POST `/admin/feeding-phases`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `date` | Data | text | R |  |  |  |
| `name` | Nome da Fase | text | R |  |  |  |
| `user_name` | Funcionário Responsável | text | R |  |  |  |
| `sequence[]` | Ordem | number | R |  |  |  |
| `diet_id[]` | Dieta | select | R |  |  |  |
| `change_rule[]` | Regra de Troca | select | R |  | Por Dias, Por Peso |  |
| `minimum_start[]` | Mínimo/Início(dias) | number | R |  |  |  |
| `maximum_end[]` | Máximo/Fim(dias) | number | R |  |  |  |
| `observation` | Observação | textarea |  | 1500 |  |  |

## SCR-430 · Novo Batelada

- **Rota:** `/admin/diet-beats/create`
- **Módulo:** Operacional > Pecuária > Confinamento > Nutrição > Batelada
- **Tipo:** Cadastro (novo)
- **Finalidade:** Batelada (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/diet-beats`

**Formulário POST `/admin/diet-beats`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `date` | Data | text | R |  |  |  |
| `operator` | Operador | text | R |  |  |  |
| `equipment_id` | Vagão Destino | select | R |  |  |  |
| `diet_id` | Dieta | select |  |  |  |  |
| `quantity` |  | text (moeda) | R |  |  |  |

## SCR-431 · Fornecimento de Trato

- **Rota:** `/admin/diet-beat-supplies/create`
- **Módulo:** Operacional > Pecuária > Confinamento > Nutrição > Trato Diário
- **Tipo:** Cadastro (novo)
- **Finalidade:** Trato Diário (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/diet-beat-supplies`

**Formulário POST `/admin/diet-beat-supplies`** — botões: Finalizar Fornecimento

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `diet_beat_id` |  | select | R |  |  |  |
| `date` |  | date | R |  |  |  |

- Mensagens/alertas: Nenhum curral ativo encontrado para esta fazenda. Cadastre corrais no módulo Confinamento.

## SCR-432 · Nova Leitura de Cocho

- **Rota:** `/admin/trough-readings/create`
- **Módulo:** Operacional > Pecuária > Confinamento > Nutrição > Leitura de Cocho
- **Tipo:** Cadastro (novo)
- **Finalidade:** Leitura de Cocho (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/trough-readings`

**Formulário POST `/admin/trough-readings`**

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `read_at` | Data / Hora da Leitura | datetime-local | R |  |  |  |
| `user_name` | Responsável | text | R |  |  |  |

- Mensagens/alertas: Não há currais com status Ocupado nesta fazenda no momento.

## SCR-433 · Pluviometria

- **Rota:** `/admin/rainfalls/create`
- **Módulo:** Operacional > Pluviometria
- **Tipo:** Cadastro (novo)
- **Finalidade:** Pluviometria (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/rainfalls`

**Formulário POST `/admin/rainfalls`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `user` | Responsável | text | R |  |  |  |
| `date` | Data | text (data) | R |  |  |  |
| `amount` | Chuva (mm) | text (moeda) | R |  |  |  |
| `areas[]` | Áreas | select (múltiplo) | R |  | 01, 02, 03, 04, 05, 06, 07, 08 … (10) |  |

## SCR-434 · Orçamentos

- **Rota:** `/admin/budgets/create`
- **Módulo:** Operacional > Vendas > Orçamentos
- **Tipo:** Cadastro (novo)
- **Finalidade:** Orçamentos (cadastro (novo))
- **Abas:** Itens | Pagamento
- **Botões/Ações (cabeçalho):** Voltar → `/admin/budgets`
- **Modais:** Novo Cliente; Produto

**Tabela**

- Colunas: Parcela | Vencimento | Valor
- Totalizador: Total

**Formulário POST `/admin/budgets`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `date` | Data | text (data) | R |  |  |  |
| `user_id` | Responsável | select | R |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `client_id` | Cliente | select | R |  | (lista dinâmica de cadastro — 7 registros; valores omitidos por privacidade) |  |
| `product_id[]` | Produto | select | R |  | Milho Grão, Soja em grãos, BANANA PRATA 1º CX 15KG, BANANA NANICA CX 20KG, BANANA BC PRATA CX 18KG, BANANA BC PRATA CX 20KG, BANANA NANICA CX 22KG, BANANA NANICA CX 16KG … (813) |  |
| `um[]` | Un. Medida | text |  |  |  |  |
| `quantity[]` | Qtd. | text (moeda) | R |  |  |  |
| `amount[]` | Vl.Unit | text (moeda) | R |  |  |  |
| `discounts[]` | Desconto | text (moeda) |  |  |  |  |
| `discount_percent[]` | Desconto (%) | text (moeda) |  |  |  |  |
| `total_amount[]` | V. Total(R$) | text (moeda) |  |  |  |  |
| `subtotal` | Total de produtos | text (moeda) | R |  |  |  |
| `freight` | Frete | text (moeda) |  |  |  |  |
| `discount` | Desconto | text (moeda) | R |  |  |  |
| `total` | Total | text (moeda) | R |  |  |  |
| `note` | Observações | textarea |  | 200 |  |  |
| `form_pay[]` | F. Pagamento | select | R |  | Dinheiro, Cheque, Cartão de Crédito, Cartão de Débito, Crédito Loja, Vale Alimentação, Vale Refeição, Vale Presente … (15) |  |
| `number_days[]` | Intervalo/dias | number | R |  |  |  |
| `due_dates[]` | Dt. Venc. | date | R |  |  |  |
| `number_installments[]` | Parcelas | number | R |  |  |  |
| `tt_value[]` | Valor Total | text | R |  |  |  |
| `has_input[]` | Possui entrada ? | select |  |  | Sim, Não |  |
| `input_date[]` | Data entrada | text (data) |  |  |  |  |
| `input_value[]` | Valor entrada | text (moeda) |  |  |  |  |
| `qtd_installments[]` | Nª Parcelas | number |  |  |  |  |
| `first_installment[]` | Venc. 1ª. PC | text (data) |  |  |  |  |
| `int_installments[]` | Int. Parcelas (dias) | number |  |  |  |  |
| `fiscal_document[]` | Dedutível | select |  |  | Não, Sim |  |

**Formulário POST `/admin/clients`** (modal newClientModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `nif` | CPF/CNPJ | text | R |  |  |  |
| `nickname` | Razão Social | text | R | 50 |  |  |
| `name` | Nome Fantasia | text | R | 30 |  |  |
| `email` | Email | email | R |  |  |  |
| `city_registration` | Insc. Municipal | text |  | 20 |  |  |
| `phone` | Telefone | text | R |  |  |  |
| `cellphone` | Celular | text |  |  |  |  |
| `contact` | Contato | text |  |  |  |  |
| `contact_phone` | Tel. do contato | text |  |  |  |  |
| `zip_code` | CEP | text |  |  |  |  |
| `address` | Endereço | text | R | 60 |  |  |
| `number` | Número | text | R |  |  |  |
| `district` | Bairro | text | R |  |  |  |
| `city_id` | Cidade | select | R |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `final_costumer` | Consumidor Final | select | R |  | Não, Sim |  |
| `taxpayer` | Contribuinte | select | R |  | Sim, Não |  |
| `id_abroad` | ID estrangeiro | text |  |  |  |  |
| `farm_name` | Nome da Fazenda | text |  | 100 |  |  |
| `state_registrations[]` |  | text |  |  |  |  |

**Formulário POST `/admin/budgets/create`** (modal newProductModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `description` | Descrição | text | R |  |  |  |
| `ncm_id` | Ncm | select |  |  |  |  |
| `measurement_id` | 1ª. Un.Medida | select | R |  | @, %, °C, °F, 1000 un, 1000UN, BAG, Balde … (59) |  |
| `second_measurement_id` | 2ª. Un.Medida | select |  |  | @, %, °C, °F, 1000 un, 1000UN, BAG, Balde … (59) |  |
| `factor_type` | Tipo | select |  |  | Multiplica, Divide |  |
| `factor` | Fator conversão | text (moeda) |  |  |  |  |
| `group_id` | Grupo | select | R |  | Insumos Agrícola, Insumos Gerais, Insumos Industrialização, Insumos Pecuária, Máquinas/Equipamentos/Veículos, Produção, Produtos Exportação |  |
| `category_id` | Cat. Produtos | select | R |  |  |  |
| `kind_id` | Classe | select | R |  |  |  |
| `cultivation_id` | Variedade | select |  |  | Soja - 1823, Soja - Bonus, Soja - Bonus, CANA DE AÇUCAR - ERLAM - CANA DE AÇUCAR, Soja - Extrema, Soja - Monsoy 8606, PLANTAÇÃO DE MORANGO - ERLAM - MORANGO DE MESA, Banana - Nanica … (14) |  |
| `quality` | Qualidade | select |  |  | 1 |  |
| `has_lot` | Cont. Lote | select | R |  | Sim, Não |  |
| `control_stock` | Controla Estoque | select | R |  | Sim, Não |  |
| `min_stock` | Estoque minimo | text (moeda) |  |  |  |  |
| `las_price` | Vl. Referência (R$) | text (moeda) |  |  |  |  |
| `active_principle` | Princípio Ativo | text |  | 50 |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `allow_pointing` | Apontamento | select | R |  | Não, Sim |  |
| `financial_category_id` | Cat. Financeira - Custo | select |  |  | 2.01.001.0001 - Energia Elétrica, 2.01.001.0002 - Telefone/Internet, 2.01.001.0003 - Aluguéis, 2.01.001.0004 - Água/Esgoto, 2.01.001.0005 - Brindes/Cortesias, 2.01.001.0006 - Viagens/Diárias, 2.01.001.0007 - Treinamento Mão de Obra, 2.01.001.0008 - Softwares … (209) | Categoria financeira utilizada para classificação de custos de produção. Obrigatório quando o produto controla estoque. |

## SCR-435 · Pedidos

- **Rota:** `/admin/orders/create`
- **Módulo:** Operacional > Vendas > Pedidos
- **Tipo:** Cadastro (novo)
- **Finalidade:** Pedidos (cadastro (novo))
- **Abas:** Itens
- **Botões/Ações (cabeçalho):** Voltar → `/admin/orders`
- **Modais:** Novo Cliente; Produto

**Tabela**

- Colunas: Parcela | Vencimento | Valor
- Totalizador: Total

**Formulário POST `/admin/orders`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `date` | Data | text (data) | R |  |  |  |
| `user_id` | Responsável | select | R |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `client_id` | Cliente | select | R |  | (lista dinâmica de cadastro — 7 registros; valores omitidos por privacidade) |  |
| `product_id[]` | Produto | select | R |  | ABOBORA 1° KG, ABOBORA 2° KG, ABOBORA KG, ABRACADEIRA INSULOK PRETA 400MMX4,8MM, ABRACADEIRA NYLON 7;2X500MM PR, ABRACADEIRA NYLON PRETA 28X4,8MM, ABRACADEIRA ROS S/FIM FITA 32-50 9MM, ABRACADEIRA RSF 14MM H 51X64MM … (813) |  |
| `um[]` | Un. Medida | text |  |  |  |  |
| `quantity[]` | Qtd. | text (moeda) | R |  |  |  |
| `price[]` | Vl.Unit | text (moeda) | R |  |  |  |
| `discounts[]` | Desconto | text (moeda) |  |  |  |  |
| `discount_percent[]` | Desconto (%) | text (moeda) |  |  |  |  |
| `total_amount[]` | V. Total(R$) | text (moeda) |  |  |  |  |
| `subtotal` | Total de produtos | text (moeda) | R |  |  |  |
| `freight` | Frete | text (moeda) |  |  |  |  |
| `discount` | Desconto | text (moeda) |  |  |  |  |
| `total` | Total | text (moeda) | R |  |  |  |
| `note` | Observações | textarea |  | 200 |  |  |
| `payment_method` | Forma de Pagamento | select | R |  | Dinheiro, Cheque, Cartão de Crédito, Cartão de Débito, Crédito Loja, Vale Alimentação, Vale Refeição, Vale Presente … (15) |  |
| `has_input` | Possui entrada ? | select |  |  | Sim, Não |  |
| `input_date` | Data entrada | text (data) |  |  |  |  |
| `input_value` | Valor entrada | text (moeda) |  |  |  |  |
| `installments` | Nª Parcelas | number | R |  |  |  |
| `due_date` | Venc. 1ª. PC | text (data) | R |  |  |  |
| `interval` | Int. Parcelas (dias) | number |  |  |  |  |
| `fiscal_document` | Dedutível | select |  |  | Não, Sim |  |

**Formulário POST `/admin/clients`** (modal newClientModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `nif` | CPF/CNPJ | text | R |  |  |  |
| `nickname` | Razão Social | text | R | 50 |  |  |
| `name` | Nome Fantasia | text | R | 30 |  |  |
| `email` | Email | email | R |  |  |  |
| `city_registration` | Insc. Municipal | text |  | 20 |  |  |
| `phone` | Telefone | text | R |  |  |  |
| `cellphone` | Celular | text |  |  |  |  |
| `contact` | Contato | text |  |  |  |  |
| `contact_phone` | Tel. do contato | text |  |  |  |  |
| `zip_code` | CEP | text |  |  |  |  |
| `address` | Endereço | text | R | 60 |  |  |
| `number` | Número | text | R |  |  |  |
| `district` | Bairro | text | R |  |  |  |
| `city_id` | Cidade | select | R |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `final_costumer` | Consumidor Final | select | R |  | Não, Sim |  |
| `taxpayer` | Contribuinte | select | R |  | Sim, Não |  |
| `id_abroad` | ID estrangeiro | text |  |  |  |  |
| `farm_name` | Nome da Fazenda | text |  | 100 |  |  |
| `state_registrations[]` |  | text |  |  |  |  |

**Formulário POST `/admin/orders/create`** (modal newProductModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `description` | Descrição | text | R |  |  |  |
| `ncm_id` | Ncm | select |  |  |  |  |
| `measurement_id` | 1ª. Un.Medida | select | R |  | @, %, °C, °F, 1000 un, 1000UN, BAG, Balde … (59) |  |
| `second_measurement_id` | 2ª. Un.Medida | select |  |  | @, %, °C, °F, 1000 un, 1000UN, BAG, Balde … (59) |  |
| `factor_type` | Tipo | select |  |  | Multiplica, Divide |  |
| `factor` | Fator conversão | text (moeda) |  |  |  |  |
| `group_id` | Grupo | select | R |  | Insumos Agrícola, Insumos Gerais, Insumos Industrialização, Insumos Pecuária, Máquinas/Equipamentos/Veículos, Produção, Produtos Exportação |  |
| `category_id` | Cat. Produtos | select | R |  |  |  |
| `kind_id` | Classe | select | R |  |  |  |
| `cultivation_id` | Variedade | select |  |  | Soja - 1823, Soja - Bonus, Soja - Bonus, CANA DE AÇUCAR - ERLAM - CANA DE AÇUCAR, Soja - Extrema, Soja - Monsoy 8606, PLANTAÇÃO DE MORANGO - ERLAM - MORANGO DE MESA, Banana - Nanica … (14) |  |
| `quality` | Qualidade | select |  |  | 1 |  |
| `has_lot` | Cont. Lote | select | R |  | Sim, Não |  |
| `control_stock` | Controla Estoque | select | R |  | Sim, Não |  |
| `min_stock` | Estoque minimo | text (moeda) |  |  |  |  |
| `las_price` | Vl. Referência (R$) | text (moeda) |  |  |  |  |
| `active_principle` | Princípio Ativo | text |  | 50 |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `allow_pointing` | Apontamento | select | R |  | Não, Sim |  |
| `financial_category_id` | Cat. Financeira - Custo | select |  |  | 2.01.001.0001 - Energia Elétrica, 2.01.001.0002 - Telefone/Internet, 2.01.001.0003 - Aluguéis, 2.01.001.0004 - Água/Esgoto, 2.01.001.0005 - Brindes/Cortesias, 2.01.001.0006 - Viagens/Diárias, 2.01.001.0007 - Treinamento Mão de Obra, 2.01.001.0008 - Softwares … (209) | Categoria financeira utilizada para classificação de custos de produção. Obrigatório quando o produto controla estoque. |

## SCR-436 · Vendas

- **Rota:** `/admin/sales/create`
- **Módulo:** Operacional > Vendas > Vendas
- **Tipo:** Cadastro (novo)
- **Finalidade:** Vendas (cadastro (novo))
- **Abas:** Itens
- **Botões/Ações (cabeçalho):** Voltar → `/admin/orders`

**Formulário POST `/admin/sales`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `dt_sale` | Dt.Venda | text (data) | R |  |  |  |
| `dt_shipping` | Dt.Remessa | text (data) | R |  |  |  |
| `due_date` | Dt. Vencimento | text (data) |  |  |  |  |
| `user_id` | Responsável pela carga | select | R |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `warehouse_id[]` | Armazém | select |  |  | Sem Estoque, BARRACAO |  |
| `product_id[]` | Produto | select | R |  | ABOBORA 1° KG, ABOBORA 2° KG, ABOBORA KG, ABRACADEIRA INSULOK PRETA 400MMX4,8MM, ABRACADEIRA NYLON 7;2X500MM PR, ABRACADEIRA NYLON PRETA 28X4,8MM, ABRACADEIRA ROS S/FIM FITA 32-50 9MM, ABRACADEIRA RSF 14MM H 51X64MM … (813) |  |
| `qtd_stock[]` | Estoque | text |  |  |  |  |
| `um[]` | Un. Medida | text |  |  |  |  |
| `quantity[]` | Qtd. | text (moeda) | R |  |  |  |
| `amount[]` | Vl.Unit | text (moeda) | R |  |  |  |
| `item_discount[]` | Desconto | text (moeda) |  |  |  |  |
| `discount_percent[]` | Desconto (%) | text (moeda) |  |  |  |  |
| `total_amount[]` | V. Total(R$) | text (moeda) |  |  |  |  |
| `note_item[]` | Observações | text |  |  |  |  |
| `subtotal` | Total de produtos | text (moeda) | R |  |  |  |
| `icms` | ICMS do Frete | text (moeda) |  |  |  |  |
| `freight` | Frete | text (moeda) |  |  |  |  |
| `other_values` | Outros Valores | text (moeda) |  |  |  |  |
| `discount` | Desconto | text (moeda) |  |  |  |  |
| `total` | Vl. Total | text (moeda) | R |  |  |  |
| `client_id` | Cliente | select | R |  | (lista dinâmica de cadastro — 7 registros; valores omitidos por privacidade) |  |
| `payment_method` | Cond.Pagto | select | R |  | Dinheiro, Cheque, Cartão de Crédito, Cartão de Débito, Crédito Loja, Vale Alimentação, Vale Refeição, Vale Presente … (15) |  |
| `transporter_id` | Transportador | select |  |  |  |  |
| `proprietary_id` | Proprietário Gestor | select |  |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `driver` | Motorista | text |  | 40 |  |  |
| `note` | Observações | textarea |  | 200 |  |  |

## SCR-437 · Identificação da OS

- **Rota:** `/admin/service-orders/create`
- **Módulo:** Operacional > Ordens de Serviço > Lista de OS
- **Tipo:** Cadastro (novo)
- **Finalidade:** Lista de OS (cadastro (novo))
- **Abas:** MO/Serviços | Máq/Implementos | Insumos | Produção | Proteções(EPI)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/service-orders`

**Formulário POST `/admin/service-orders`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `user` | Solicitante | text | R |  |  |  |
| `executor_id` | Responsável | select | R |  | (lista dinâmica de cadastro — 14 registros; valores omitidos por privacidade) … (14) |  |
| `dt_emission` | Dt. Emissão | text (data) | R |  |  |  |
| `execution_date` | Dt. Execução | text (data) | R |  |  |  |
| `deadline` | Prazo Final | text (data) | R |  |  |  |
| `category` | Uso | select | R |  | Ambos, Agricultura, Pecuária |  |
| `operation_id` | Operação | select | R |  |  |  |
| `activity_id` | Atividade | select | R |  |  |  |
| `area_id` | Área | select | R |  | 01, 02, 03, 04, 05, 06, 07, 08 … (10) |  |
| `cultivation_id` | Cultura/Variedade | select |  |  | Soja - 1823, Soja - Bonus, Soja - Bonus, CANA DE AÇUCAR - ERLAM - CANA DE AÇUCAR, Soja - Extrema, Soja - Monsoy 8606, PLANTAÇÃO DE MORANGO - ERLAM - MORANGO DE MESA, Banana - Nanica … (14) |  |
| `batch_id` | Lote | select |  |  |  |  |
| `category_id` | Categoria | select |  |  | Fêmeas > 36 meses, Fêmeas 25 a 36 meses, Fêmeas 13 a 24 meses, Fêmeas 0 a 12 meses, Machos 0 a 12 meses, Machos 13 a 24 meses, Machos 25 a 36 meses, Machos > 36 meses … (42) |  |
| `weather_requirements` | Requisitos Climáticos | text | R |  |  |  |
| `minimum_temperature` | Temperatura Mínima(C°) | text | R |  |  |  |
| `maximum_temperature` | Temperatura Máxima(C°) | text | R |  |  |  |
| `allowed_working_period_start` | Horário de Execução Permitido(Início) | time | R |  |  |  |
| `allowed_working_period_end` | Horário de Execução Permitido(Final) | time | R |  |  |  |
| `service_description` | Descrição do Serviço | textarea | R |  |  |  |
| `expected_result_description` | Resultados Esperados | textarea | R |  |  |  |
| `success_criteria_description` | Críterios de Sucesso | textarea | R |  |  |  |
| `roadmap_description` | Roteiro/Planejamento | textarea | R |  |  |  |
| `environmental_restrictions` | Restrições Ambientais | text | R |  |  |  |
| `legal_compliance` | Conformidade Legal | text | R |  |  |  |
| `func_type[]` | Tipo | select |  |  | Funcionário, Função, Fornecedor |  |
| `func_executor_id[]` | Executador | select |  |  |  |  |
| `equipment_equipment_id[]` | Maq/Equipamento/Veículo | select |  |  | A 73F VALTRA/CABINADO, ADUBADEIRA DE ARRASTE KAMAQ, ADUBADEIRA HIDRÁULICA, BALANÇA, BALANÇA, BALANÇA BONIVA ELETRONICA RETANGULAR FIXA KM-3-N COIMMA, BALANÇA DIGITAL SUSPENSA 3000 KG BIV, BATEDEIRA DE PIMENTA … (118) |  |
| `equipment_note[]` | Observação | text |  |  |  |  |
| `warehouse_id` | Armazem de insumos | select |  |  | BARRACAO |  |
| `product_stock_id[]` | Produto | select |  |  |  |  |
| `product_um[]` | Un. Medida | select |  |  |  |  |
| `qtd_stock[]` | Estoque | text |  |  |  |  |
| `product_quantity[]` | Qtd/ha | text (moeda) |  |  |  |  |
| `product_total_quantity[]` | Qtd Total | text (moeda) |  |  |  |  |
| `warehouse_production_id` | Armazem de produção | select |  |  | Não possui armazém de produção |  |
| `production_product_id[]` | Produto | select |  |  |  |  |
| `production_um[]` | Un. Medida | select |  |  |  |  |
| `production_quantity[]` | Qtde | text (moeda) |  |  |  |  |
| `production_note[]` | Observação | text |  |  |  |  |
| `protection_product_id[]` | Produto | select |  |  |  |  |
| `protection_note[]` | Observação | text |  |  |  |  |

