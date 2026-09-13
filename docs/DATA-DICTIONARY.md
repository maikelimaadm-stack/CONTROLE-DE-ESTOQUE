# Dicionário de Dados

> **Documento gerado.** Não edite à mão: `node scripts/data-dictionary.mjs`.
> A parte técnica (tabelas, colunas, tipos, nulidade, chaves, enums) é derivada de `supabase/migrations/*.sql`;
> a parte funcional (nome, descrição, módulo, rota, TOP futura, notas de migração) é curada em
> `packages/domain/dicionario-dados.mjs`. O gate `--check` recusa entrada que aponte para tabela/coluna inexistente.

Formato do dicionário: versão **1**. Taxonomia própria e neutra `ERP-<MÓDULO>-<ENTIDADE>` (não reproduz códigos do sistema de referência nem amarra o núcleo a um segmento de negócio).

## Panorama

| Métrica | Valor |
| --- | ---: |
| Tabelas no schema `erp` | 179 |
| Tabelas com `organization_id` (escopo de organização) | 124 |
| Tabelas com coluna de empresa (hoje `farm_id`) | 52 |
| Entidades curadas neste dicionário | 37 |
| Entidades com ID Global | 23 |
| Cobertura curada | 20.7% |

Cobertura é incremental por projeto: a certificação de 100% é a missão **DATA-GOV** do roteiro
(`docs/PRE-BASE2-ROADMAP.md`). Toda tabela ainda não curada aparece no apêndice com seus metadados técnicos.

## Plataforma

### ERP-PLATAFORMA-ORGANIZACAO — Organização

Tenant do ERP: o cliente contratante. Agrupa empresas, usuários, permissões e a sequência de ID Global. Nunca se confunde com Empresa.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.organizations` |
| Natureza | entidade |
| Escopo de organização | não |
| Escopo de empresa | não (registro da organização) |
| Exclusão lógica | sim |
| ID Global | não |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `name` |  | text | sim |  |  |  |  |
| `legal_name` |  | text | não |  |  |  |  |
| `document` |  | text | não |  |  |  |  |
| `slug` |  | citext | não |  |  |  |  |
| `parameters` |  | jsonb | sim |  |  |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `updated_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |
| `idioma_padrao` |  | text | sim |  |  |  |  |

### ERP-PLATAFORMA-EMPRESA — Empresa

Entidade operacional/jurídica dos registros: é a EMPRESA do contrato multiempresa. Hoje materializada na tabela `farms` (nome herdado do nicho agro).

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.farms` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | não (registro da organização) |
| Exclusão lógica | sim |
| ID Global | não |
| Migração | PRE-BASE2-02/03: renomeada para empresa/`empresa_id` com camada de compatibilidade. Não renomear em massa antes do plano de migração. |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `code` |  | int | sim |  |  |  |  |
| `name` |  | text | sim |  |  |  |  |
| `legal_name` |  | text | não |  |  |  |  |
| `document` |  | text | não |  |  |  |  |
| `state_registration` |  | text | não |  |  |  |  |
| `address_street` |  | text | não |  |  |  |  |
| `address_number` |  | text | não |  |  |  |  |
| `address_complement` |  | text | não |  |  |  |  |
| `address_district` |  | text | não |  |  |  |  |
| `address_city` |  | text | não |  |  |  |  |
| `address_state` |  | char(2) | não |  |  |  |  |
| `address_zip` |  | text | não |  |  |  |  |
| `area_ha` |  | numeric(14,4) | não |  |  |  |  |
| `latitude` |  | numeric(10,7) | não |  |  |  |  |
| `longitude` |  | numeric(10,7) | não |  |  |  |  |
| `is_active` |  | boolean | sim |  |  |  |  |
| `created_by` |  | uuid | não | FK | `erp.users` |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `updated_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |

### ERP-PLATAFORMA-USUARIO — Usuário

Pessoa que acessa o sistema. Autenticação local (desenvolvimento/teste) ou provedor externo.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.users` |
| Natureza | entidade |
| Escopo de organização | não |
| Escopo de empresa | não (registro da organização) |
| Exclusão lógica | não |
| ID Global | não |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `auth_user_id` |  | uuid | não |  |  |  |  |
| `email` |  | citext | sim |  |  |  |  |
| `name` |  | text | sim |  |  |  |  |
| `phone` |  | text | não |  |  |  |  |
| `password_hash` |  | text | não |  |  |  |  |
| `is_active` |  | boolean | sim |  |  |  |  |
| `last_login_at` |  | timestamptz | não |  |  |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `updated_at` |  | timestamptz | sim |  |  |  |  |
| `idioma` |  | text | não |  |  |  |  |

### ERP-PLATAFORMA-VINCULO — Vínculo de Usuário

Vínculo usuário × organização com perfil de acesso. Sem identidade própria para o usuário final.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.organization_members` |
| Natureza | linha |
| Escopo de organização | sim |
| Escopo de empresa | não (registro da organização) |
| Exclusão lógica | não |
| ID Global | não |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `user_id` |  | uuid | sim | FK | `erp.users` |  |  |
| `role_id` |  | uuid | não | FK | `erp.roles` |  |  |
| `is_owner` |  | boolean | sim |  |  |  |  |
| `is_active` |  | boolean | sim |  |  |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `updated_at` |  | timestamptz | sim |  |  |  |  |

### ERP-PLATAFORMA-EMPRESA-PERMITIDA — Empresa Permitida

Empresas que o vínculo pode acessar. Lista vazia significa TODAS as empresas da organização. É a autoridade de autorização por empresa.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.member_farms` |
| Natureza | linha |
| Escopo de organização | não |
| Escopo de empresa | `farm_id` |
| Exclusão lógica | não |
| ID Global | não |
| Migração | PRE-BASE2-02: vira `member_empresas` (ou equivalente) mantendo a semântica de lista vazia = todas. |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `member_id` |  | uuid | sim | PK | `erp.organization_members` |  |  |
| `farm_id` |  | uuid | sim | PK | `erp.farms` |  |  |

### ERP-PLATAFORMA-PERFIL — Perfil de Acesso

Conjunto de permissões atribuível a usuários da organização.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.roles` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | não (registro da organização) |
| Exclusão lógica | sim |
| ID Global | sim |
| Rota canônica | `/admin/perfis/:id` |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `name` |  | text | sim |  |  |  |  |
| `description` |  | text | não |  |  |  |  |
| `is_system` |  | boolean | sim |  |  |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `updated_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |

### ERP-PLATAFORMA-PERMISSAO-PERFIL — Permissão do Perfil

Vínculo perfil × chave de permissão. Estrutura interna: nunca recebe ID Global.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.role_permissions` |
| Natureza | linha |
| Escopo de organização | não |
| Escopo de empresa | não (registro da organização) |
| Exclusão lógica | não |
| ID Global | não |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `role_id` |  | uuid | sim | PK | `erp.roles` |  |  |
| `permission_key` |  | text | sim | PK | `erp.permissions` |  |  |

### ERP-PLATAFORMA-AUDITORIA — Registro de Auditoria

Trilha imutável de eventos (criação, alteração, cancelamento, login) por organização e usuário.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.audit_logs` |
| Natureza | infraestrutura |
| Escopo de organização | sim |
| Escopo de empresa | não (registro da organização) |
| Exclusão lógica | não |
| ID Global | não |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | bigint | não | PK |  |  |  |
| `organization_id` |  | uuid | não |  |  |  |  |
| `user_id` |  | uuid | não |  |  |  |  |
| `entity` |  | text | sim |  |  |  |  |
| `entity_id` |  | text | sim |  |  |  |  |
| `action` |  | text | sim |  |  |  |  |
| `before` |  | jsonb | não |  |  |  |  |
| `after` |  | jsonb | não |  |  |  |  |
| `metadata` |  | jsonb | não |  |  |  |  |
| `ip` |  | text | não |  |  |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |

### ERP-PLATAFORMA-SEQUENCIA-CODIGO — Sequência de Código

Contador por organização × entidade que gera o código/número próprio de cada entidade.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.code_sequences` |
| Natureza | infraestrutura |
| Escopo de organização | sim |
| Escopo de empresa | não (registro da organização) |
| Exclusão lógica | não |
| ID Global | não |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `organization_id` |  | uuid | sim | PK | `erp.organizations` |  |  |
| `entity` |  | text | sim | PK |  |  |  |
| `last_value` |  | bigint | sim |  |  |  |  |

### ERP-PLATAFORMA-SEQUENCIA-ID-GLOBAL — Sequência de ID Global

Contador ÚNICO por organização que gera o ID Global. Compartilhado por todas as empresas da organização; independente entre organizações.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.sequencias_id_global` |
| Natureza | infraestrutura |
| Escopo de organização | sim |
| Escopo de empresa | não (registro da organização) |
| Exclusão lógica | não |
| ID Global | não |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `organization_id` |  | uuid | não | PK | `erp.organizations` |  |  |
| `ultimo_valor` |  | bigint | sim |  |  |  |  |

### ERP-PLATAFORMA-REGISTRO-GLOBAL — Registro Global

Índice que resolve um ID Global no registro real: organização, empresa, tipo de entidade, UUID, módulo e rota canônica.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.registros_globais` |
| Natureza | infraestrutura |
| Escopo de organização | sim |
| Escopo de empresa | `empresa_id` |
| Exclusão lógica | não |
| ID Global | não |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `organization_id` |  | uuid | sim | PK | `erp.organizations` |  |  |
| `id_global` |  | bigint | sim | PK |  |  |  |
| `tipo_entidade` |  | text | sim |  |  |  |  |
| `id_entidade` |  | uuid | sim |  |  |  |  |
| `empresa_id` |  | uuid | não | FK | `erp.farms` |  |  |
| `modulo` |  | text | sim |  |  |  |  |
| `rota_canonica` |  | text | sim |  |  |  |  |
| `criado_por` |  | uuid | não | FK | `erp.users` |  |  |
| `criado_em` |  | timestamptz | sim |  |  |  |  |

## Cadastros

### ERP-CADASTROS-PRODUTO — Produto

Item de estoque, insumo ou serviço. Compartilhado pela organização (não pertence a uma empresa).

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.products` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | não (registro da organização) |
| Exclusão lógica | sim |
| ID Global | sim |
| Rota canônica | `/cadastros/products/:id?view=1` |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `code` |  | text | sim |  |  |  |  |
| `reference` |  | text | não |  |  |  |  |
| `description` |  | text | sim |  |  |  |  |
| `ncm_code` |  | text | não | FK | `erp.ncm` |  |  |
| `measurement_id` |  | uuid | sim | FK | `erp.measurement_units` |  |  |
| `second_measurement_id` |  | uuid | não | FK | `erp.measurement_units` |  |  |
| `factor_type` |  | text | não |  |  | `multiply` · `divide` |  |
| `factor` |  | numeric(18,6) | não |  |  |  |  |
| `group_id` |  | uuid | sim | FK | `erp.product_groups` |  |  |
| `category_id` |  | uuid | sim | FK | `erp.product_categories` |  |  |
| `kind_id` |  | uuid | sim | FK | `erp.product_kinds` |  |  |
| `cultivation_id` |  | uuid | não |  |  |  |  |
| `quality` |  | text | não |  |  |  |  |
| `has_lot` |  | boolean | sim |  |  |  |  |
| `control_stock` |  | boolean | sim |  |  |  |  |
| `min_stock` |  | numeric(18,4) | não |  |  |  |  |
| `last_purchase_date` |  | date | não |  |  |  |  |
| `average_cost` |  | numeric(18,6) | sim |  |  |  |  |
| `reference_price` |  | numeric(18,2) | sim |  |  |  |  |
| `is_active` |  | boolean | sim |  |  |  |  |
| `allow_pointing` |  | boolean | sim |  |  |  |  |
| `financial_category_id` |  | uuid | não | FK | `erp.financial_categories` |  |  |
| `default_cost_center_id` |  | uuid | não | FK | `erp.cost_centers` |  |  |
| `default_warehouse_id` |  | uuid | não | FK | `erp.warehouses` |  |  |
| `active_principle` |  | text | não |  |  |  |  |
| `withdrawal_period_days` |  | int | não |  |  |  |  |
| `is_equipment` |  | boolean | sim |  |  |  |  |
| `addressing_id` |  | uuid | não | FK | `erp.addressings` |  |  |
| `is_fiscal` |  | boolean | sim |  |  |  |  |
| `tax_rule_id` |  | uuid | não | FK | `erp.tax_rules` |  |  |
| `barcode` |  | text | não |  |  |  |  |
| `taxes` |  | jsonb | sim |  |  |  |  |
| `created_by` |  | uuid | não | FK | `erp.users` |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `updated_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |

### ERP-CADASTROS-PESSOA — Pessoa

Cadastro unificado de pessoa física/jurídica; os papéis (fornecedor, cliente, funcionário, proprietário) são perfis dela.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.people` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | não (registro da organização) |
| Exclusão lógica | sim |
| ID Global | sim |
| Rota canônica | `/cadastros/people/:id?view=1` |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `code` |  | text | sim |  |  |  |  |
| `document` |  | text | não |  |  |  |  |
| `person_type` |  | text | sim |  |  | `natural` · `legal` · `foreign` |  |
| `name` |  | text | sim |  |  |  |  |
| `legal_name` |  | text | não |  |  |  |  |
| `email` |  | citext | não |  |  |  |  |
| `phone` |  | text | não |  |  |  |  |
| `cellphone` |  | text | não |  |  |  |  |
| `zip_code` |  | text | não |  |  |  |  |
| `address` |  | text | não |  |  |  |  |
| `address_number` |  | text | não |  |  |  |  |
| `district` |  | text | não |  |  |  |  |
| `city_id` |  | int | não | FK | `erp.cities` |  |  |
| `state_registration` |  | text | não |  |  |  |  |
| `city_registration` |  | text | não |  |  |  |  |
| `contact_name` |  | text | não |  |  |  |  |
| `contact_phone` |  | text | não |  |  |  |  |
| `bank_code` |  | text | não | FK | `erp.banks` |  |  |
| `bank_account_type` |  | text | não |  |  | `checking` · `savings` |  |
| `bank_agency` |  | text | não |  |  |  |  |
| `bank_account` |  | text | não |  |  |  |  |
| `pix_type` |  | text | não |  |  | `document` · `phone` · `email` · `random` |  |
| `pix_key` |  | text | não |  |  |  |  |
| `is_provider` |  | boolean | sim |  |  |  |  |
| `is_client` |  | boolean | sim |  |  |  |  |
| `is_employee` |  | boolean | sim |  |  |  |  |
| `is_proprietary` |  | boolean | sim |  |  |  |  |
| `is_transporter` |  | boolean | sim |  |  |  |  |
| `is_active` |  | boolean | sim |  |  |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `updated_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |

### ERP-CADASTROS-ARMAZEM — Armazém

Local de guarda de estoque, pertencente a uma empresa.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.warehouses` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | `farm_id` |
| Exclusão lógica | sim |
| ID Global | não |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `farm_id` |  | uuid | sim | FK | `erp.farms` |  |  |
| `initials` |  | text | sim |  |  |  |  |
| `description` |  | text | sim |  |  |  |  |
| `type` |  | text | sim |  |  | `inputs` · `production` · `formulation` |  |
| `is_active` |  | boolean | sim |  |  |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `updated_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |

## Estoque

### ERP-ESTOQUE-ENTRADA — Entrada Manual

Lançamento de entrada de produtos sem documento fiscal vinculado.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.input_entries` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | `farm_id` |
| Exclusão lógica | sim |
| ID Global | sim |
| Rota canônica | `/estoque/entradas/:id` |
| TOP futura (contrato) | Entrada de estoque sem documento fiscal |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `farm_id` |  | uuid | sim | FK | `erp.farms` |  |  |
| `code` |  | text | sim |  |  |  |  |
| `entry_date` |  | date | sim |  |  |  |  |
| `harvest_id` |  | uuid | não | FK | `erp.harvests` |  |  |
| `proprietary_id` |  | uuid | não | FK | `erp.people` |  |  |
| `responsible_user_id` |  | uuid | não | FK | `erp.users` |  |  |
| `note` |  | text | não |  |  |  |  |
| `total_amount` |  | numeric(18,2) | sim |  |  |  |  |
| `status` |  | text | sim |  |  | `draft` · `confirmed` · `cancelled` |  |
| `bank_movement_id` |  | uuid | não |  |  |  |  |
| `created_by` |  | uuid | não | FK | `erp.users` |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `updated_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |

### ERP-ESTOQUE-ENTRADA-ITEM — Item da Entrada

Produto, quantidade e valor de uma entrada. Identidade pertence ao documento: nunca recebe ID Global.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.input_entry_items` |
| Natureza | linha |
| Escopo de organização | não |
| Escopo de empresa | não (registro da organização) |
| Exclusão lógica | não |
| ID Global | não |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `entry_id` |  | uuid | sim | FK | `erp.input_entries` |  |  |
| `product_id` |  | uuid | sim | FK | `erp.products` |  |  |
| `measurement_id` |  | uuid | não | FK | `erp.measurement_units` |  |  |
| `quantity` |  | numeric(18,4) | sim |  |  |  |  |
| `unit_value` |  | numeric(18,6) | sim |  |  |  |  |
| `total_value` |  | numeric(18,2) | sim |  |  |  |  |
| `generate_stock` |  | boolean | sim |  |  |  |  |
| `warehouse_id` |  | uuid | não | FK | `erp.warehouses` |  |  |
| `appropriation_type` |  | text | não |  |  | `livestock` · `maintenance` · `fuel` |  |
| `provider_lot` |  | text | não |  |  |  |  |
| `expiration_date` |  | date | não |  |  |  |  |
| `cultivation_id` |  | uuid | não | FK | `erp.cultivations` |  |  |
| `financial_category_id` |  | uuid | não | FK | `erp.financial_categories` |  |  |
| `cost_center_id` |  | uuid | não | FK | `erp.cost_centers` |  |  |
| `position` |  | int | sim |  |  |  |  |

### ERP-ESTOQUE-DOCUMENTO-FISCAL — Documento Fiscal

Nota fiscal de entrada: itens, impostos, rateios e geração de estoque/financeiro.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.invoices` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | `farm_id` |
| Exclusão lógica | sim |
| ID Global | sim |
| Rota canônica | `/estoque/documentos-fiscais/:id` |
| TOP futura (contrato) | Entrada por documento fiscal |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `farm_id` |  | uuid | sim | FK | `erp.farms` |  |  |
| `code` |  | text | sim |  |  |  |  |
| `number` |  | text | sim |  |  |  |  |
| `series` |  | text | sim |  |  |  |  |
| `access_key` |  | text | não |  |  |  |  |
| `provider_id` |  | uuid | sim | FK | `erp.people` |  |  |
| `branch_id` |  | uuid | não | FK | `erp.provider_branches` |  |  |
| `proprietary_id` |  | uuid | não | FK | `erp.people` |  |  |
| `harvest_id` |  | uuid | não | FK | `erp.harvests` |  |  |
| `emission_date` |  | date | sim |  |  |  |  |
| `delivery_date` |  | date | não |  |  |  |  |
| `state_code` |  | char(2) | não |  |  |  |  |
| `document_type` |  | text | sim |  |  | `nfe` · `cte` · `nfse` · `nfce` · `danfe` · `darf` · `dare` · `gru` · `other` |  |
| `title_type_id` |  | uuid | não |  |  |  |  |
| `classification` |  | text | sim |  |  | `unclassified` · `capex` · `opex` |  |
| `apportionment_type` |  | text | sim |  |  | `by_value` · `by_product` |  |
| `note` |  | text | não |  |  |  |  |
| `products_total` |  | numeric(18,2) | sim |  |  |  |  |
| `discount_total` |  | numeric(18,2) | sim |  |  |  |  |
| `ipi_total` |  | numeric(18,2) | sim |  |  |  |  |
| `icms_total` |  | numeric(18,2) | sim |  |  |  |  |
| `freight` |  | numeric(18,2) | sim |  |  |  |  |
| `other_expenses` |  | numeric(18,2) | sim |  |  |  |  |
| `total` |  | numeric(18,2) | sim |  |  |  |  |
| `origin` |  | text | sim |  |  | `manual` · `xml` · `dfe` · `purchase_request` |  |
| `purchase_request_id` |  | uuid | não |  |  |  |  |
| `status` |  | text | sim |  |  | `draft` · `confirmed` · `cancelled` |  |
| `created_by` |  | uuid | não | FK | `erp.users` |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `updated_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |

### ERP-ESTOQUE-REQUISICAO — Requisição

Consumo interno de produtos por centro de custo/área.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.requisitions` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | `farm_id` |
| Exclusão lógica | sim |
| ID Global | sim |
| Rota canônica | `/estoque/requisicoes/:id` |
| TOP futura (contrato) | Saída por requisição |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `farm_id` |  | uuid | sim | FK | `erp.farms` |  |  |
| `code` |  | text | sim |  |  |  |  |
| `requisition_date` |  | date | sim |  |  |  |  |
| `classification` |  | text | sim |  |  | `unclassified` · `capex` · `opex` |  |
| `requester_person_id` |  | uuid | não | FK | `erp.people` |  |  |
| `responsible_user_id` |  | uuid | não | FK | `erp.users` |  |  |
| `area_id` |  | uuid | não |  |  |  |  |
| `harvest_id` |  | uuid | não | FK | `erp.harvests` |  |  |
| `total_amount` |  | numeric(18,2) | sim |  |  |  |  |
| `signature_status` |  | text | sim |  |  | `awaiting_signature` · `signed` |  |
| `signed_document_path` |  | text | não |  |  |  |  |
| `status` |  | text | sim |  |  | `confirmed` · `cancelled` |  |
| `created_by` |  | uuid | não | FK | `erp.users` |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `updated_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |

### ERP-ESTOQUE-SAIDA-DIRETA — Saída Direta

Baixa de estoque por perda, deterioração, doação e outros motivos.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.stock_writeoffs` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | `farm_id` |
| Exclusão lógica | sim |
| ID Global | sim |
| Rota canônica | `/estoque/baixas/:id` |
| TOP futura (contrato) | Baixa de estoque |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `farm_id` |  | uuid | sim | FK | `erp.farms` |  |  |
| `code` |  | text | sim |  |  |  |  |
| `writeoff_date` |  | date | sim |  |  |  |  |
| `reason` |  | text | sim |  |  | `loss` · `deterioration` · `theft` · `damage` · `inventory` · `accounting` · `burglary` · `expiration` · `gift` · `donation` · `consumption` · `payment_with_product` · `other` |  |
| `reason_note` |  | text | não |  |  |  |  |
| `cost_center_id` |  | uuid | não | FK | `erp.cost_centers` |  |  |
| `warehouse_id` |  | uuid | sim | FK | `erp.warehouses` |  |  |
| `justification` |  | text | sim |  |  |  |  |
| `total_amount` |  | numeric(18,2) | sim |  |  |  |  |
| `status` |  | text | sim |  |  | `confirmed` · `cancelled` |  |
| `responsible_user_id` |  | uuid | não | FK | `erp.users` |  |  |
| `created_by` |  | uuid | não | FK | `erp.users` |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `updated_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |

### ERP-ESTOQUE-DEVOLUCAO — Devolução

Retorno de produtos ao estoque a partir de uma requisição.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.devolutions` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | `farm_id` |
| Exclusão lógica | sim |
| ID Global | sim |
| Rota canônica | `/estoque/devolucoes/:id` |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `farm_id` |  | uuid | sim | FK | `erp.farms` |  |  |
| `code` |  | text | sim |  |  |  |  |
| `devolution_date` |  | date | sim |  |  |  |  |
| `responsible_person_id` |  | uuid | não | FK | `erp.people` |  |  |
| `harvest_id` |  | uuid | não | FK | `erp.harvests` |  |  |
| `total_amount` |  | numeric(18,2) | sim |  |  |  |  |
| `status` |  | text | sim |  |  | `confirmed` · `cancelled` |  |
| `created_by` |  | uuid | não | FK | `erp.users` |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `updated_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |

### ERP-ESTOQUE-TRANSFERENCIA — Transferência

Movimentação de produtos entre armazéns ou entre empresas.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.warehouse_transfers` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | `origin_farm_id` · `destination_farm_id` |
| Exclusão lógica | sim |
| ID Global | sim |
| Rota canônica | `/estoque/transferencias/:id` |
| Migração | Possui DUAS colunas de empresa (origem e destino): o escopo de leitura considera ambas. |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `code` |  | text | sim |  |  |  |  |
| `transfer_date` |  | date | sim |  |  |  |  |
| `kind` |  | text | sim |  |  | `warehouse` · `farm` |  |
| `origin_farm_id` |  | uuid | sim | FK | `erp.farms` |  |  |
| `origin_warehouse_id` |  | uuid | sim | FK | `erp.warehouses` |  |  |
| `destination_farm_id` |  | uuid | sim | FK | `erp.farms` |  |  |
| `destination_warehouse_id` |  | uuid | sim | FK | `erp.warehouses` |  |  |
| `harvest_id` |  | uuid | não | FK | `erp.harvests` |  |  |
| `generate_financial` |  | boolean | sim |  |  |  |  |
| `total_value` |  | numeric(18,2) | sim |  |  |  |  |
| `proprietary_id` |  | uuid | não | FK | `erp.people` |  |  |
| `status` |  | text | sim |  |  | `pending` · `confirmed` · `cancelled` |  |
| `responsible_user_id` |  | uuid | não | FK | `erp.users` |  |  |
| `created_by` |  | uuid | não | FK | `erp.users` |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `updated_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |

### ERP-ESTOQUE-PRODUCAO-RACAO — Produção de Ração

Produção de ração a partir de uma fórmula: consome insumos e gera produto acabado. Específico do nicho agro.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.feed_batches` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | `farm_id` |
| Exclusão lógica | não |
| ID Global | sim |
| Rota canônica | `/estoque/batidas/:id` |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `farm_id` |  | uuid | sim | FK | `erp.farms` |  |  |
| `code` |  | text | sim |  |  |  |  |
| `batch_date` |  | date | sim |  |  |  |  |
| `formula_id` |  | uuid | sim | FK | `erp.feed_formulas` |  |  |
| `origin_warehouse_id` |  | uuid | sim | FK | `erp.warehouses` |  |  |
| `destination_warehouse_id` |  | uuid | sim | FK | `erp.warehouses` |  |  |
| `quantity_produced` |  | numeric(18,4) | sim |  |  |  |  |
| `production_cost` |  | numeric(18,2) | sim |  |  |  |  |
| `status` |  | text | sim |  |  | `confirmed` · `cancelled` |  |
| `created_by` |  | uuid | não | FK | `erp.users` |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |

### ERP-ESTOQUE-MOVIMENTO — Movimento de Estoque

Razão imutável de estoque (custo médio e saldo). Não é lançamento: é consequência contábil de um.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.stock_movements` |
| Natureza | infraestrutura |
| Escopo de organização | sim |
| Escopo de empresa | `farm_id` |
| Exclusão lógica | não |
| ID Global | não |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `farm_id` |  | uuid | sim | FK | `erp.farms` |  |  |
| `warehouse_id` |  | uuid | sim | FK | `erp.warehouses` |  |  |
| `product_id` |  | uuid | sim | FK | `erp.products` |  |  |
| `movement_type` |  | text | sim |  |  | `opening_balance` · `entry` · `invoice_entry` · `receipt` · `devolution` · `requisition` · `writeoff` · `correction_in` · `correction_out` · `transfer_out` · `transfer_in` · `farm_transfer_out` · `farm_transfer_in` · `sale` · `production_in` · `production_out` · `maintenance` · `fuel_supply` · `nutrition` · `reversal` |  |
| `direction` |  | smallint | sim |  |  | `1` · `-1` |  |
| `quantity` |  | numeric(18,4) | sim |  |  |  |  |
| `unit_cost` |  | numeric(18,6) | sim |  |  |  |  |
| `total_cost` |  | numeric(18,2) | não |  |  |  |  |
| `balance_after` |  | numeric(18,4) | não |  |  |  |  |
| `avg_cost_after` |  | numeric(18,6) | não |  |  |  |  |
| `provider_lot` |  | text | não |  |  |  |  |
| `expiration_date` |  | date | não |  |  |  |  |
| `cost_center_id` |  | uuid | não | FK | `erp.cost_centers` |  |  |
| `harvest_id` |  | uuid | não | FK | `erp.harvests` |  |  |
| `cultivation_id` |  | uuid | não | FK | `erp.cultivations` |  |  |
| `source_type` |  | text | sim |  |  |  |  |
| `source_id` |  | uuid | sim |  |  |  |  |
| `reversed_by` |  | uuid | não | FK | `erp.stock_movements` |  |  |
| `movement_date` |  | date | sim |  |  |  |  |
| `note` |  | text | não |  |  |  |  |
| `created_by` |  | uuid | não | FK | `erp.users` |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |

## Compras

### ERP-COMPRAS-SOLICITACAO — Solicitação de Compra

Pedido interno de compra que percorre autorização, cotação e recebimento.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.purchase_requests` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | `farm_id` |
| Exclusão lógica | sim |
| ID Global | sim |
| Rota canônica | `/suprimentos/view/:id` |
| TOP futura (contrato) | Solicitação de compra |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `farm_id` |  | uuid | sim | FK | `erp.farms` |  |  |
| `code` |  | text | sim |  |  |  |  |
| `parent_id` |  | uuid | não | FK | `erp.purchase_requests` |  |  |
| `request_date` |  | date | sim |  |  |  |  |
| `priority` |  | text | sim |  |  | `low` · `medium` · `high` |  |
| `request_type` |  | text | sim |  |  | `product` · `service` · `advance` · `refund` · `daily` · `contract` · `finished_product` |  |
| `requester_user_id` |  | uuid | sim | FK | `erp.users` |  |  |
| `authorizer_id` |  | uuid | não | FK | `erp.authorizers` |  |  |
| `current_responsible_user_id` |  | uuid | não | FK | `erp.users` |  |  |
| `status` |  | text | sim |  |  | `request` · `quotation_in_progress` · `awaiting_approval` · `awaiting_awareness` · `not_approved` · `awaiting_purchase` · `purchase_done` · `purchase_received` · `finished` · `cancelled` · `under_review` |  |
| `status_changed_at` |  | timestamptz | sim |  |  |  |  |
| `description` |  | text | sim |  |  |  |  |
| `justification` |  | text | sim |  |  |  |  |
| `observation` |  | text | não |  |  |  |  |
| `final_observation` |  | text | não |  |  |  |  |
| `classification` |  | text | não |  |  | `unclassified` · `capex` · `opex` |  |
| `financial_due_date` |  | date | não |  |  |  |  |
| `invoice_number` |  | text | não |  |  |  |  |
| `estimated_total` |  | numeric(18,2) | sim |  |  |  |  |
| `approved_total` |  | numeric(18,2) | não |  |  |  |  |
| `selected_quotation_id` |  | uuid | não |  |  |  |  |
| `invoice_id` |  | uuid | não | FK | `erp.invoices` |  |  |
| `version` |  | int | sim |  |  |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `updated_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |

## Financeiro

### ERP-FINANCEIRO-TITULO — Título Financeiro

Obrigação ou direito financeiro. A coluna `direction` decide a tela (pagar/receber) — uma tabela, duas telas.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.financial_titles` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | `farm_id` |
| Exclusão lógica | sim |
| ID Global | sim |
| Discriminador | `direction` (decide tela **e** permissão — ver docs/GLOBAL-ID-CONTRACT.md) |
| Rotas por variante | `payable` → `/financeiro/contas-a-pagar/:id` · `receivable` → `/financeiro/contas-a-receber/:id` |
| TOP futura (contrato) | Conta a pagar / Conta a receber |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `farm_id` |  | uuid | sim | FK | `erp.farms` |  |  |
| `code` |  | text | sim |  |  |  |  |
| `direction` |  | text | sim |  |  | `payable` · `receivable` |  |
| `number` |  | text | sim |  |  |  |  |
| `title_type_id` |  | uuid | não | FK | `erp.title_types` |  |  |
| `proprietary_id` |  | uuid | não | FK | `erp.people` |  |  |
| `person_id` |  | uuid | não | FK | `erp.people` |  |  |
| `branch_id` |  | uuid | não | FK | `erp.provider_branches` |  |  |
| `payment_type` |  | text | sim |  |  | `single` · `installments` · `recurring` · `advance` · `invoice_group` |  |
| `recurrence_type` |  | text | não |  |  | `weekly` · `monthly` · `quarterly` · `yearly` |  |
| `classification` |  | text | sim |  |  | `unclassified` · `capex` · `opex` |  |
| `document_type` |  | text | não |  |  | `nfe` · `cte` · `nfse` · `nfce` · `danfe` · `darf` · `dare` · `gru` · `other` |  |
| `is_deductible` |  | boolean | sim |  |  |  |  |
| `is_tax` |  | boolean | sim |  |  |  |  |
| `amount` |  | numeric(18,2) | sim |  |  |  |  |
| `discount` |  | numeric(18,2) | sim |  |  |  |  |
| `net_amount` |  | numeric(18,2) | não |  |  |  |  |
| `emission_date` |  | date | sim |  |  |  |  |
| `due_date` |  | date | sim |  |  |  |  |
| `installment_number` |  | int | sim |  |  |  |  |
| `installment_count` |  | int | sim |  |  |  |  |
| `group_id` |  | uuid | não |  |  |  |  |
| `appropriation` |  | text | sim |  |  | `direct` · `indirect` |  |
| `appropriation_type` |  | text | não |  |  | `indirect` · `livestock` · `area` · `maintenance` · `fuel` |  |
| `note` |  | text | sim |  |  |  |  |
| `harvest_id` |  | uuid | não | FK | `erp.harvests` |  |  |
| `paid_amount` |  | numeric(18,2) | sim |  |  |  |  |
| `balance` |  | numeric(18,2) | não |  |  |  |  |
| `status` |  | text | sim |  |  | `open` · `partially_paid` · `paid` · `cancelled` |  |
| `source_type` |  | text | não |  |  |  |  |
| `source_id` |  | uuid | não |  |  |  |  |
| `version` |  | int | sim |  |  |  |  |
| `created_by` |  | uuid | não | FK | `erp.users` |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `updated_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |

### ERP-FINANCEIRO-BAIXA — Baixa de Título

Pagamento/recebimento parcial ou total de um título. Identidade pertence ao título.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.title_settlements` |
| Natureza | linha |
| Escopo de organização | sim |
| Escopo de empresa | não (registro da organização) |
| Exclusão lógica | não |
| ID Global | não |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `title_id` |  | uuid | sim | FK | `erp.financial_titles` |  |  |
| `settlement_date` |  | date | sim |  |  |  |  |
| `settlement_kind` |  | text | sim |  |  | `bank_movement` · `cross_settlement` · `advance_compensation` |  |
| `bank_account_id` |  | uuid | não | FK | `erp.bank_accounts` |  |  |
| `bank_movement_id` |  | uuid | não | FK | `erp.bank_movements` |  |  |
| `cross_title_id` |  | uuid | não | FK | `erp.financial_titles` |  |  |
| `amount` |  | numeric(18,2) | sim |  |  |  |  |
| `discount` |  | numeric(18,2) | sim |  |  |  |  |
| `penalty` |  | numeric(18,2) | sim |  |  |  |  |
| `interest` |  | numeric(18,2) | sim |  |  |  |  |
| `increase` |  | numeric(18,2) | sim |  |  |  |  |
| `foreign_amount` |  | numeric(18,2) | não |  |  |  |  |
| `ptax_rate` |  | numeric(12,6) | não |  |  |  |  |
| `exchange_adjustment` |  | numeric(18,2) | sim |  |  |  |  |
| `net_amount` |  | numeric(18,2) | sim |  |  |  |  |
| `note` |  | text | não |  |  |  |  |
| `status` |  | text | sim |  |  | `confirmed` · `cancelled` |  |
| `cancelled_at` |  | timestamptz | não |  |  |  |  |
| `cancelled_by` |  | uuid | não | FK | `erp.users` |  |  |
| `cancel_reason` |  | text | não |  |  |  |  |
| `created_by` |  | uuid | não | FK | `erp.users` |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |

### ERP-FINANCEIRO-MOVIMENTO-BANCARIO — Movimento Bancário

Lançamento em conta bancária (transferência, tarifa, aplicação).

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.bank_movements` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | `farm_id` |
| Exclusão lógica | sim |
| ID Global | sim |
| Rota canônica | `/financeiro/movimentos/:id` |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `farm_id` |  | uuid | não | FK | `erp.farms` |  |  |
| `code` |  | text | sim |  |  |  |  |
| `bank_account_id` |  | uuid | sim | FK | `erp.bank_accounts` |  |  |
| `movement_date` |  | date | sim |  |  |  |  |
| `type` |  | text | sim |  |  | `in` · `out` |  |
| `category_type` |  | text | sim |  |  | `in` · `out` · `internal_transfer` · `financing` · `check_return` · `opening_balance` |  |
| `destination_account_id` |  | uuid | não | FK | `erp.bank_accounts` |  |  |
| `transfer_pair_id` |  | uuid | não | FK | `erp.bank_movements` |  |  |
| `amount` |  | numeric(18,2) | sim |  |  |  |  |
| `interest` |  | numeric(18,2) | sim |  |  |  |  |
| `document` |  | text | não |  |  |  |  |
| `generates_obligation` |  | boolean | sim |  |  |  |  |
| `is_deductible` |  | boolean | sim |  |  |  |  |
| `note` |  | text | não |  |  |  |  |
| `proprietary_id` |  | uuid | não | FK | `erp.people` |  |  |
| `person_id` |  | uuid | não | FK | `erp.people` |  |  |
| `harvest_id` |  | uuid | não | FK | `erp.harvests` |  |  |
| `source_type` |  | text | não |  |  |  |  |
| `source_id` |  | uuid | não |  |  |  |  |
| `reconciled_at` |  | timestamptz | não |  |  |  |  |
| `ofx_transaction_id` |  | uuid | não |  |  |  |  |
| `status` |  | text | sim |  |  | `confirmed` · `cancelled` |  |
| `reversed_by` |  | uuid | não | FK | `erp.bank_movements` |  |  |
| `created_by` |  | uuid | não | FK | `erp.users` |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `updated_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |

### ERP-FINANCEIRO-IMPORTACAO-OFX — Importação OFX

Importação de extrato bancário para conciliação. Pertence à conta bancária, não a uma empresa.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.ofx_imports` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | não (registro da organização) |
| Exclusão lógica | sim |
| ID Global | sim |
| Rota canônica | `/financeiro/ofx/:id` |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `code` |  | text | sim |  |  |  |  |
| `description` |  | text | sim |  |  |  |  |
| `bank_account_id` |  | uuid | sim | FK | `erp.bank_accounts` |  |  |
| `start_date` |  | date | sim |  |  |  |  |
| `end_date` |  | date | sim |  |  |  |  |
| `file_path` |  | text | não |  |  |  |  |
| `status` |  | text | sim |  |  | `imported` · `reconciling` · `reconciled` |  |
| `created_by` |  | uuid | não | FK | `erp.users` |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |

## Vendas

### ERP-VENDAS-DOCUMENTO — Documento de Venda

Documento comercial. A coluna `kind` decide a etapa e a tela (orçamento, pedido, venda).

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.sales_documents` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | `farm_id` |
| Exclusão lógica | sim |
| ID Global | sim |
| Discriminador | `kind` (decide tela **e** permissão — ver docs/GLOBAL-ID-CONTRACT.md) |
| Rotas por variante | `budget` → `/vendas/budgets/:id` · `order` → `/vendas/orders/:id` · `sale` → `/vendas/sales/:id` |
| TOP futura (contrato) | Orçamento / Pedido / Venda |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `farm_id` |  | uuid | sim | FK | `erp.farms` |  |  |
| `kind` |  | text | sim |  |  | `budget` · `order` · `sale` |  |
| `code` |  | text | sim |  |  |  |  |
| `document_date` |  | date | sim |  |  |  |  |
| `shipping_date` |  | date | não |  |  |  |  |
| `due_date` |  | date | não |  |  |  |  |
| `responsible_user_id` |  | uuid | não | FK | `erp.users` |  |  |
| `client_id` |  | uuid | sim | FK | `erp.people` |  |  |
| `transporter_id` |  | uuid | não | FK | `erp.people` |  |  |
| `proprietary_id` |  | uuid | não | FK | `erp.people` |  |  |
| `driver_name` |  | text | não |  |  |  |  |
| `payment_method_id` |  | uuid | não | FK | `erp.payment_methods` |  |  |
| `subtotal` |  | numeric(18,2) | sim |  |  |  |  |
| `freight` |  | numeric(18,2) | sim |  |  |  |  |
| `freight_icms` |  | numeric(18,2) | sim |  |  |  |  |
| `other_values` |  | numeric(18,2) | sim |  |  |  |  |
| `discount` |  | numeric(18,2) | sim |  |  |  |  |
| `total` |  | numeric(18,2) | sim |  |  |  |  |
| `note` |  | text | não |  |  |  |  |
| `installment_plan` |  | jsonb | sim |  |  |  |  |
| `origin_document_id` |  | uuid | não | FK | `erp.sales_documents` |  |  |
| `status` |  | text | sim |  |  | `open` · `approved` · `converted` · `confirmed` · `invoiced` · `cancelled` |  |
| `nfe_id` |  | uuid | não |  |  |  |  |
| `created_by` |  | uuid | não | FK | `erp.users` |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `updated_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |

## Pecuária

### ERP-PECUARIA-ANIMAL — Animal

Animal identificado individualmente. Módulo específico do nicho agro (não faz parte do núcleo neutro).

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.animals` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | `farm_id` |
| Exclusão lógica | sim |
| ID Global | sim |
| Rota canônica | `/pecuaria/animais/:id` |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `farm_id` |  | uuid | sim | FK | `erp.farms` |  |  |
| `species_id` |  | uuid | sim | FK | `erp.animal_species` |  |  |
| `category_id` |  | uuid | sim | FK | `erp.animal_categories` |  |  |
| `breed_id` |  | uuid | não | FK | `erp.breeds` |  |  |
| `batch_id` |  | uuid | não | FK | `erp.batches` |  |  |
| `sex` |  | text | não |  |  | `M` · `F` |  |
| `entry_date` |  | date | sim |  |  |  |  |
| `birth_date` |  | date | não |  |  |  |  |
| `reproductive_stage` |  | text | não |  |  | `lactation` · `multiparous` · `heifer` · `nulliparous` · `primiparous` |  |
| `reproductive_status` |  | text | não |  |  | `pregnant` · `empty` · `calved` |  |
| `current_weight` |  | numeric(10,2) | não |  |  |  |  |
| `entry_weight` |  | numeric(10,2) | não |  |  |  |  |
| `price_kg_alive` |  | numeric(18,4) | não |  |  |  |  |
| `price_arroba_alive` |  | numeric(18,4) | não |  |  |  |  |
| `unit_value` |  | numeric(18,2) | não |  |  |  |  |
| `ua` |  | numeric(6,3) | não |  |  |  |  |
| `mother_id` |  | uuid | não | FK | `erp.animals` |  |  |
| `father_id` |  | uuid | não | FK | `erp.animals` |  |  |
| `mother_ref` |  | text | não |  |  |  |  |
| `father_ref` |  | text | não |  |  |  |  |
| `fur_description` |  | text | não |  |  |  |  |
| `birth_forecast` |  | date | não |  |  |  |  |
| `proprietary_id` |  | uuid | não | FK | `erp.people` |  |  |
| `origin_provider_id` |  | uuid | não | FK | `erp.people` |  |  |
| `note` |  | text | não |  |  |  |  |
| `depreciation` |  | jsonb | sim |  |  |  |  |
| `status` |  | text | sim |  |  | `active` · `sold` · `dead` · `lost` · `transferred` · `inventoried` |  |
| `exit_date` |  | date | não |  |  |  |  |
| `photo_path` |  | text | não |  |  |  |  |
| `created_by` |  | uuid | não | FK | `erp.users` |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `updated_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |

### ERP-PECUARIA-MOVIMENTACAO — Movimentação de Rebanho

Entrada, saída, venda ou morte de animais. O tipo faz parte da rota canônica.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.animal_movements` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | `farm_id` · `destination_farm_id` |
| Exclusão lógica | sim |
| ID Global | sim |
| Discriminador | `movement_type` (decide tela **e** permissão — ver docs/GLOBAL-ID-CONTRACT.md) |
| Rotas por variante | `purchase` → `/pecuaria/movimentacoes/purchase/:id` · `sale` → `/pecuaria/movimentacoes/sale/:id` · `birth` → `/pecuaria/movimentacoes/birth/:id` · `death` → `/pecuaria/movimentacoes/death/:id` · `loss` → `/pecuaria/movimentacoes/loss/:id` |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `farm_id` |  | uuid | sim | FK | `erp.farms` |  |  |
| `code` |  | text | sim |  |  |  |  |
| `movement_type` |  | text | sim |  |  | `purchase` · `sale` · `birth` · `death` · `loss` · `evolution` · `batch_transfer` · `farm_transfer` · `module_area_transfer` · `inventory` · `weaning` · `separation` · `processing` |  |
| `movement_date` |  | date | sim |  |  |  |  |
| `person_id` |  | uuid | não | FK | `erp.people` |  |  |
| `batch_id` |  | uuid | não | FK | `erp.batches` |  |  |
| `destination_batch_id` |  | uuid | não | FK | `erp.batches` |  |  |
| `destination_farm_id` |  | uuid | não | FK | `erp.farms` |  |  |
| `destination_module_id` |  | uuid | não | FK | `erp.grazing_modules` |  |  |
| `destination_area_id` |  | uuid | não | FK | `erp.areas` |  |  |
| `quantity` |  | int | sim |  |  |  |  |
| `total_weight` |  | numeric(12,2) | não |  |  |  |  |
| `total_value` |  | numeric(18,2) | sim |  |  |  |  |
| `cause` |  | text | não |  |  |  |  |
| `note` |  | text | não |  |  |  |  |
| `invoice_number` |  | text | não |  |  |  |  |
| `financial_title_id` |  | uuid | não | FK | `erp.financial_titles` |  |  |
| `status` |  | text | sim |  |  | `pending` · `confirmed` · `cancelled` |  |
| `created_by` |  | uuid | não | FK | `erp.users` |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `updated_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |

### ERP-PECUARIA-MANEJO — Manejo

Manejo sanitário, nutricional ou reprodutivo aplicado a animais/lotes.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.animal_handlings` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | `farm_id` |
| Exclusão lógica | sim |
| ID Global | sim |
| Discriminador | `handling_type` (decide tela **e** permissão — ver docs/GLOBAL-ID-CONTRACT.md) |
| Rotas por variante | `nutrition` → `/pecuaria/manejo/nutrition/:id` · `sanitary` → `/pecuaria/manejo/sanitary/:id` · `weaning` → `/pecuaria/manejo/weaning/:id` · `separation` → `/pecuaria/manejo/separation/:id` · `pasture` → `/pecuaria/manejo/pasture/:id` · `locate` → `/pecuaria/manejo/locate/:id` |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `farm_id` |  | uuid | sim | FK | `erp.farms` |  |  |
| `code` |  | text | sim |  |  |  |  |
| `handling_type` |  | text | sim |  |  | `nutrition` · `sanitary` · `weaning` · `separation` · `pasture` · `locate` |  |
| `handling_date` |  | date | sim |  |  |  |  |
| `batch_id` |  | uuid | não | FK | `erp.batches` |  |  |
| `product_id` |  | uuid | não | FK | `erp.products` |  |  |
| `warehouse_id` |  | uuid | não | FK | `erp.warehouses` |  |  |
| `quantity` |  | numeric(18,4) | não |  |  |  |  |
| `unit_value` |  | numeric(18,6) | não |  |  |  |  |
| `total` |  | numeric(18,2) | sim |  |  |  |  |
| `withdrawal_until` |  | date | não |  |  |  |  |
| `responsible` |  | text | não |  |  |  |  |
| `note` |  | text | não |  |  |  |  |
| `animals_count` |  | int | sim |  |  |  |  |
| `created_by` |  | uuid | não | FK | `erp.users` |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |

### ERP-PECUARIA-PESAGEM — Pesagem

Evento de pesagem de animais, base de desempenho e ganho de peso.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.weighings` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | `farm_id` |
| Exclusão lógica | sim |
| ID Global | sim |
| Rota canônica | `/pecuaria/pesagens/:id` |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `farm_id` |  | uuid | sim | FK | `erp.farms` |  |  |
| `code` |  | text | sim |  |  |  |  |
| `weighing_date` |  | date | sim |  |  |  |  |
| `batch_id` |  | uuid | não | FK | `erp.batches` |  |  |
| `responsible` |  | text | não |  |  |  |  |
| `note` |  | text | não |  |  |  |  |
| `animals_count` |  | int | sim |  |  |  |  |
| `total_weight` |  | numeric(12,2) | sim |  |  |  |  |
| `created_by` |  | uuid | não | FK | `erp.users` |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |

## Frota e Ativos

### ERP-FROTA-EQUIPAMENTO — Equipamento

Bem/máquina da empresa, com depreciação e histórico de manutenção.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.equipments` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | `farm_id` |
| Exclusão lógica | sim |
| ID Global | sim |
| Rota canônica | `/cadastros/equipments/:id?view=1` |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `farm_id` |  | uuid | sim | FK | `erp.farms` |  |  |
| `code` |  | text | sim |  |  |  |  |
| `description` |  | text | sim |  |  |  |  |
| `family_id` |  | uuid | não | FK | `erp.equipment_families` |  |  |
| `equipment_type` |  | text | não |  |  | `own` · `outsourced` |  |
| `proprietary_id` |  | uuid | não | FK | `erp.people` |  |  |
| `hour_value` |  | numeric(18,2) | sim |  |  |  |  |
| `hour_meter` |  | numeric(18,2) | não |  |  |  |  |
| `year_model` |  | text | não |  |  |  |  |
| `brand` |  | text | não |  |  |  |  |
| `model` |  | text | não |  |  |  |  |
| `patrimony` |  | text | não |  |  |  |  |
| `chassis` |  | text | não |  |  |  |  |
| `renavam` |  | text | não |  |  |  |  |
| `serial_number` |  | text | não |  |  |  |  |
| `plate` |  | text | não |  |  |  |  |
| `plate_state` |  | char(2) | não |  |  |  |  |
| `color` |  | text | não |  |  |  |  |
| `has_depreciation` |  | boolean | sim |  |  |  |  |
| `acquisition_value` |  | numeric(18,2) | sim |  |  |  |  |
| `acquisition_date` |  | date | não |  |  |  |  |
| `depreciation_type` |  | text | não |  |  | `with_residual` · `without_residual` |  |
| `residual_percent` |  | numeric(7,4) | não |  |  |  |  |
| `life_years` |  | numeric(7,2) | não |  |  |  |  |
| `depreciation_percent` |  | numeric(7,4) | não |  |  |  |  |
| `residual_value` |  | numeric(18,2) | não |  |  |  |  |
| `depreciable_value` |  | numeric(18,2) | não |  |  |  |  |
| `depreciated_value` |  | numeric(18,2) | sim |  |  |  |  |
| `status` |  | text | sim |  |  | `active` · `inactive` · `sold` · `written_off` |  |
| `provider_id` |  | uuid | não | FK | `erp.people` |  |  |
| `product_id` |  | uuid | não | FK | `erp.products` |  |  |
| `use_fiscal` |  | boolean | sim |  |  |  |  |
| `features` |  | text[] | sim |  |  |  |  |
| `specification` |  | text | não |  |  |  |  |
| `vehicle` |  | jsonb | sim |  |  |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `updated_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |

### ERP-FROTA-ABASTECIMENTO — Abastecimento

Consumo de combustível por equipamento, com baixa de estoque.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.fuel_supplies` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | `farm_id` |
| Exclusão lógica | sim |
| ID Global | sim |
| Rota canônica | `/frota/abastecimentos/:id` |
| TOP futura (contrato) | Abastecimento |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `farm_id` |  | uuid | sim | FK | `erp.farms` |  |  |
| `code` |  | text | sim |  |  |  |  |
| `supply_date` |  | date | sim |  |  |  |  |
| `equipment_id` |  | uuid | sim | FK | `erp.equipments` |  |  |
| `operator_person_id` |  | uuid | não | FK | `erp.people` |  |  |
| `warehouse_id` |  | uuid | não | FK | `erp.warehouses` |  |  |
| `product_id` |  | uuid | sim | FK | `erp.products` |  |  |
| `quantity` |  | numeric(18,4) | sim |  |  |  |  |
| `unit_value` |  | numeric(18,6) | sim |  |  |  |  |
| `total` |  | numeric(18,2) | sim |  |  |  |  |
| `hour_meter` |  | numeric(18,2) | não |  |  |  |  |
| `mileage` |  | numeric(18,2) | não |  |  |  |  |
| `cost_center_id` |  | uuid | não | FK | `erp.cost_centers` |  |  |
| `harvest_id` |  | uuid | não | FK | `erp.harvests` |  |  |
| `origin` |  | text | sim |  |  | `manual` · `cta_smart` · `import` |  |
| `status` |  | text | sim |  |  | `confirmed` · `cancelled` |  |
| `note` |  | text | não |  |  |  |  |
| `created_by` |  | uuid | não | FK | `erp.users` |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |

### ERP-FROTA-MANUTENCAO — Manutenção

Serviço e peças aplicados a um ou mais equipamentos.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.maintenances` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | `farm_id` |
| Exclusão lógica | sim |
| ID Global | sim |
| Rota canônica | `/frota/manutencoes/:id` |
| TOP futura (contrato) | Manutenção |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `farm_id` |  | uuid | sim | FK | `erp.farms` |  |  |
| `code` |  | text | sim |  |  |  |  |
| `maintenance_date` |  | date | sim |  |  |  |  |
| `responsible_user_id` |  | uuid | não | FK | `erp.users` |  |  |
| `harvest_id` |  | uuid | não | FK | `erp.harvests` |  |  |
| `total_parts` |  | numeric(18,2) | sim |  |  |  |  |
| `total_services` |  | numeric(18,2) | sim |  |  |  |  |
| `status` |  | text | sim |  |  | `confirmed` · `cancelled` |  |
| `created_by` |  | uuid | não | FK | `erp.users` |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `updated_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |

## Ordens de Serviço

### ERP-OS-ORDEM — Ordem de Serviço

Serviço planejado/executado com apontamento de recursos.

| Propriedade | Valor |
| --- | --- |
| Tabela | `erp.service_orders` |
| Natureza | entidade |
| Escopo de organização | sim |
| Escopo de empresa | `farm_id` |
| Exclusão lógica | sim |
| ID Global | sim |
| Rota canônica | `/os/:id` |
| TOP futura (contrato) | Ordem de serviço |

| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` |  | uuid | não | PK |  |  |  |
| `organization_id` |  | uuid | sim | FK | `erp.organizations` |  |  |
| `farm_id` |  | uuid | sim | FK | `erp.farms` |  |  |
| `code` |  | text | sim |  |  |  |  |
| `order_date` |  | date | sim |  |  |  |  |
| `harvest_id` |  | uuid | não | FK | `erp.harvests` |  |  |
| `activity_id` |  | uuid | não | FK | `erp.activities` |  |  |
| `operation_id` |  | uuid | não | FK | `erp.operations` |  |  |
| `cost_center_id` |  | uuid | não | FK | `erp.cost_centers` |  |  |
| `responsible_person_id` |  | uuid | não | FK | `erp.people` |  |  |
| `team_id` |  | uuid | não | FK | `erp.teams` |  |  |
| `description` |  | text | não |  |  |  |  |
| `planned_start` |  | date | não |  |  |  |  |
| `planned_end` |  | date | não |  |  |  |  |
| `started_at` |  | timestamptz | não |  |  |  |  |
| `finished_at` |  | timestamptz | não |  |  |  |  |
| `status` |  | text | sim |  |  | `open` · `in_progress` · `finished` · `evaluated` · `cancelled` |  |
| `rating` |  | smallint | não |  |  |  |  |
| `rating_note` |  | text | não |  |  |  |  |
| `labor_total` |  | numeric(18,2) | sim |  |  |  |  |
| `machines_total` |  | numeric(18,2) | sim |  |  |  |  |
| `inputs_total` |  | numeric(18,2) | sim |  |  |  |  |
| `total` |  | numeric(18,2) | sim |  |  |  |  |
| `created_by` |  | uuid | não | FK | `erp.users` |  |  |
| `created_at` |  | timestamptz | sim |  |  |  |  |
| `updated_at` |  | timestamptz | sim |  |  |  |  |
| `deleted_at` |  | timestamptz | não |  |  |  |  |

## Apêndice — tabelas ainda não curadas

Metadados técnicos derivados do schema. Acrescentar a entrada funcional em
`packages/domain/dicionario-dados.mjs` promove a tabela para as seções acima.

| Tabela | Campos | Organização | Empresa | Exclusão lógica |
| --- | ---: | --- | --- | --- |
| `erp.absences` | 10 | sim | — | sim |
| `erp.activities` | 11 | sim | — | sim |
| `erp.activity_operations` | 2 | não | — | não |
| `erp.additional_infos` | 8 | sim | — | sim |
| `erp.addressings` | 7 | sim | — | sim |
| `erp.animal_categories` | 9 | sim | — | não |
| `erp.animal_handling_items` | 8 | não | — | não |
| `erp.animal_identifications` | 6 | sim | — | não |
| `erp.animal_movement_items` | 10 | não | — | não |
| `erp.animal_retroactive_costs` | 10 | sim | `farm_id` | não |
| `erp.animal_species` | 3 | sim | — | não |
| `erp.apportionment_categories` | 7 | sim | — | sim |
| `erp.apportionment_category_items` | 4 | não | — | não |
| `erp.areas` | 13 | sim | `farm_id` | sim |
| `erp.attachment_blobs` | 3 | sim | — | não |
| `erp.attachments` | 12 | sim | — | não |
| `erp.authorizer_farms` | 2 | não | `farm_id` | não |
| `erp.authorizers` | 13 | sim | — | sim |
| `erp.bank_account_farms` | 2 | não | `farm_id` | não |
| `erp.bank_account_proprietaries` | 2 | não | — | não |
| `erp.bank_accounts` | 20 | sim | — | sim |
| `erp.bank_movement_apportionments` | 8 | não | — | não |
| `erp.banks` | 2 | não | — | não |
| `erp.batch_categories` | 2 | não | — | não |
| `erp.batches` | 21 | sim | `farm_id` | sim |
| `erp.bonuses` | 11 | sim | — | sim |
| `erp.breeding_protocols` | 7 | sim | — | não |
| `erp.breeding_season_batches` | 2 | não | — | não |
| `erp.breeding_seasons` | 10 | sim | `farm_id` | sim |
| `erp.breeding_sires` | 9 | sim | — | não |
| `erp.breeds` | 4 | sim | — | não |
| `erp.budget_planning_values` | 4 | não | — | não |
| `erp.budget_plannings` | 10 | sim | `farm_id` | sim |
| `erp.chart_accounts` | 12 | sim | — | sim |
| `erp.cities` | 3 | não | — | não |
| `erp.client_profiles` | 8 | não | — | não |
| `erp.contract_items` | 6 | não | — | não |
| `erp.contracts` | 18 | sim | `farm_id` | sim |
| `erp.cost_centers` | 11 | sim | — | sim |
| `erp.cultivations` | 5 | sim | — | não |
| `erp.depreciations` | 9 | sim | — | não |
| `erp.devolution_items` | 8 | não | — | não |
| `erp.dfe_documents` | 18 | sim | `farm_id` | não |
| `erp.dfe_drafts` | 8 | sim | — | não |
| `erp.diet_batch_items` | 6 | não | — | não |
| `erp.diet_batches` | 13 | sim | `farm_id` | não |
| `erp.diet_items` | 5 | não | — | não |
| `erp.diets` | 11 | sim | — | sim |
| `erp.document_types` | 9 | sim | — | sim |
| `erp.documents` | 13 | sim | `farm_id` | sim |
| `erp.earning_lines` | 7 | não | — | não |
| `erp.earnings` | 12 | sim | `farm_id` | não |
| `erp.employee_events` | 6 | sim | — | não |
| `erp.employee_profiles` | 13 | não | — | não |
| `erp.equipment_cost_centers` | 3 | não | — | não |
| `erp.equipment_families` | 5 | sim | — | não |
| `erp.equipment_transfers` | 10 | sim | `origin_farm_id` · `destination_farm_id` | não |
| `erp.export_jobs` | 10 | sim | — | não |
| `erp.farm_cost_centers` | 2 | não | `farm_id` | não |
| `erp.feed_batch_items` | 6 | não | — | não |
| `erp.feed_deliveries` | 13 | sim | `farm_id` | não |
| `erp.feed_formula_items` | 5 | não | — | não |
| `erp.feed_formulas` | 11 | sim | — | sim |
| `erp.feeding_phases` | 10 | sim | — | sim |
| `erp.feedlot_corrals` | 10 | sim | — | sim |
| `erp.feedlot_sectors` | 8 | sim | — | sim |
| `erp.feedlot_yards` | 8 | sim | `farm_id` | sim |
| `erp.financial_categories` | 13 | sim | — | sim |
| `erp.financial_freezes` | 9 | sim | `farm_id` | não |
| `erp.fodders` | 7 | sim | — | sim |
| `erp.grazing_modules` | 13 | sim | `farm_id` | sim |
| `erp.harvests` | 14 | sim | — | sim |
| `erp.herd_lots` | 13 | sim | `farm_id` | não |
| `erp.hr_events` | 12 | sim | — | sim |
| `erp.idempotency_keys` | 6 | sim | — | não |
| `erp.identification_types` | 3 | sim | — | não |
| `erp.integrations` | 8 | sim | — | não |
| `erp.invoice_apportionments` | 8 | não | — | não |
| `erp.invoice_items` | 23 | não | — | não |
| `erp.job_functions` | 12 | sim | — | sim |
| `erp.journal_entries` | 13 | sim | `farm_id` | não |
| `erp.livestock_plannings` | 12 | sim | `farm_id` | sim |
| `erp.maintenance_items` | 9 | não | — | não |
| `erp.maintenance_machines` | 10 | não | — | não |
| `erp.matings` | 15 | sim | — | não |
| `erp.measurement_units` | 5 | sim | — | não |
| `erp.membro_empresas` | 6 | sim | `empresa_id` | não |
| `erp.membro_escopos_empresa` | 7 | sim | — | não |
| `erp.modulos_escopo_empresa` | 3 | não | — | não |
| `erp.nature_operations` | 21 | sim | — | sim |
| `erp.ncm` | 2 | não | — | não |
| `erp.notifications` | 9 | sim | — | não |
| `erp.ofx_transactions` | 10 | sim | — | não |
| `erp.opening_balances` | 15 | sim | `farm_id` | não |
| `erp.operations` | 11 | sim | — | sim |
| `erp.payment_methods` | 4 | sim | — | não |
| `erp.permissions` | 5 | não | — | não |
| `erp.preventive_maintenances` | 12 | sim | — | sim |
| `erp.processings` | 13 | sim | `farm_id` | não |
| `erp.product_categories` | 5 | sim | — | não |
| `erp.product_groups` | 4 | sim | — | não |
| `erp.product_kinds` | 5 | sim | — | não |
| `erp.product_merges` | 6 | sim | — | não |
| `erp.product_packages` | 6 | sim | — | não |
| `erp.proprietary_farms` | 4 | não | `farm_id` | não |
| `erp.proprietary_profiles` | 2 | não | — | não |
| `erp.provider_branches` | 8 | não | — | não |
| `erp.provider_launch_profile_items` | 5 | não | — | não |
| `erp.provider_launch_profiles` | 8 | sim | — | sim |
| `erp.provider_profiles` | 6 | não | — | não |
| `erp.provider_sellers` | 5 | não | — | não |
| `erp.purchase_approvals` | 8 | não | — | não |
| `erp.purchase_quotation_items` | 7 | não | — | não |
| `erp.purchase_quotations` | 14 | sim | — | não |
| `erp.purchase_request_events` | 10 | sim | — | não |
| `erp.purchase_request_items` | 10 | não | — | não |
| `erp.rainfalls` | 8 | sim | `farm_id` | não |
| `erp.requisition_items` | 10 | não | — | não |
| `erp.salary_advances` | 14 | sim | `farm_id` | sim |
| `erp.sales_document_items` | 11 | não | — | não |
| `erp.saved_reports` | 11 | sim | — | sim |
| `erp.scheduled_reviews` | 10 | sim | — | sim |
| `erp.service_order_lines` | 12 | não | — | não |
| `erp.states` | 3 | não | — | não |
| `erp.stock_balances` | 10 | sim | — | não |
| `erp.stock_corrections` | 16 | sim | `farm_id` | não |
| `erp.stock_writeoff_items` | 7 | não | — | não |
| `erp.supply_status_sla` | 3 | sim | — | não |
| `erp.tax_rules` | 25 | sim | — | sim |
| `erp.team_members` | 4 | não | — | não |
| `erp.teams` | 9 | sim | — | sim |
| `erp.title_apportionments` | 9 | não | — | não |
| `erp.title_appropriations` | 5 | não | — | não |
| `erp.title_types` | 4 | sim | — | não |
| `erp.trough_readings` | 10 | sim | `farm_id` | não |
| `erp.troughs` | 12 | sim | — | sim |
| `erp.user_bosses` | 3 | sim | — | não |
| `erp.user_favorites` | 5 | sim | — | não |
| `erp.user_screen_preferences` | 10 | sim | — | não |
| `erp.warehouse_transfer_items` | 8 | não | — | não |
| `erp.weighing_items` | 6 | não | — | não |
| `erp.weight_parameters` | 10 | sim | — | sim |
