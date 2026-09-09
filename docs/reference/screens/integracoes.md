# Telas — Integrações

Detalhamento tela a tela (sistema de referência). Legenda: **R** = obrigatório observado (atributo required/asterisco), tipo = tipo do controle HTML observado; "Opções" mostra amostra (até 8) das opções de listas.

## SCR-262 · Integração Domínio

- **Rota:** `/admin/integration-dominios`
- **Módulo:** Integrações > Software Domínio
- **Tipo:** Listagem
- **Finalidade:** Software Domínio (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/integration-dominios/create`

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Emissor | Contador | Ativo | Ação

## SCR-263 · Integração CTA Smart

- **Rota:** `/admin/integration-cta-smart`
- **Módulo:** Integrações > CTA Smart - Configuração
- **Tipo:** Listagem
- **Finalidade:** CTA Smart - Configuração (listagem)
- **Botões/Ações (cabeçalho):** Abastecimentos Importados → `/admin/cta-smart-supplies`

**Tabela**

- Colunas: Código do Tanque | Nome | Almoxarifado | Produto | (seleção)

**Tabela**

- Colunas: Código do Veículo | Nome | Bem | (seleção)

**Formulário PUT `/admin/integration-cta-smart`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `token` | Token de Acesso | text | R |  |  |  |
| `user_id` | Usuário Padrão dos Lançamentos | select | R |  | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |

## SCR-264 · CTA Smart - Abastecimentos Importados

- **Rota:** `/admin/cta-smart-supplies`
- **Módulo:** Integrações > CTA Smart - Abastecimentos
- **Tipo:** Listagem
- **Finalidade:** CTA Smart - Abastecimentos (listagem)
- **Botões/Ações (cabeçalho):** Configuração → `/admin/integration-cta-smart`; Sincronizar Agora
- **Modais:** Vincular Bem

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `status` | Status | select | Todos, Pendente, Importado, Bem não localizado, Falha, Ignorado |
| `start_date` | Data Inicial | date |  |
| `end_date` | Data Final | date |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Data | Cód. CTA | Veículo | Tanque | Combustível | Volume (L) | Custo | Status | Ação

**Formulário POST `/admin/cta-smart-supplies`** (modal modal-link-vehicle) — botões: Vincular e Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `equipment_id` | Bem | select | R |  | A 73F VALTRA/CABINADO, ADUBADEIRA DE ARRASTE KAMAQ, ADUBADEIRA HIDRÁULICA, BALANÇA, BALANÇA, BALANÇA BONIVA ELETRONICA RETANGULAR FIXA KM-3-N COIMMA, BALANÇA DIGITAL SUSPENSA 3000 KG BIV, BATEDEIRA DE PIMENTA … (132) |  |

## SCR-265 · Exportar CSV - Contas Pagas/Recebidas

- **Rota:** `/admin/financial-export`
- **Módulo:** Integrações > Exportações/CSV > Exportações/CSV
- **Tipo:** Página
- **Finalidade:** Exportações/CSV (página)

**Filtros (GET)** — botões: Exportar Dados

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |

## SCR-448 · Integração Domínio

- **Rota:** `/admin/integration-dominios/create`
- **Módulo:** Integrações > Software Domínio
- **Tipo:** Cadastro (novo)
- **Finalidade:** Software Domínio (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/integration-dominios`

**Formulário POST `/admin/integration-dominios`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `issue_id` | Emissor | select | R |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `contador_id` | Contador | select | R |  |  |  |
| `x_integration_key` | Token de Integração | text | R |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |

