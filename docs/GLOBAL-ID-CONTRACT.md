# Contrato do ID Global

> Contrato de plataforma (PRE-BASE2-01). Implementação: `packages/platform/src/global-id.ts` (registry e
> regras), `apps/api/src/lib/global-id.ts` (serviço), `supabase/migrations/0010_platform_foundation.sql`.

## 1. Três identificadores, três papéis

| Identificador | Para que serve | Quem gera |
| --- | --- | --- |
| **UUID** | Chave técnica, integridade referencial, URL de detalhe. | Banco (`gen_random_uuid()`). |
| **Código/número da entidade** | Identidade dentro da entidade (`0001` de entradas, `0001` de requisições). | `erp.next_code(org, entidade)`. |
| **ID Global** (`#55`) | Identidade única do registro **dentro da organização**, atravessando módulos e empresas. | `erp.next_global_id(org)`. |

O ID Global é o que o usuário digita na busca para chegar a qualquer registro sem saber de que módulo ele é.

## 2. Escopo da sequência

- **Única por organização.** Todas as empresas da organização compartilham a mesma sequência:

  ```
  #54  Empresa A · Estoque
  #55  Empresa C · Financeiro
  #56  Empresa B · Pecuária
  #57  Empresa A · Compras
  ```

- **Independente entre organizações.** Nunca existe numeração única entre tenants: o `#55` de um cliente
  não tem relação com o `#55` de outro.

### Garantias (e o que não é garantido)

| Garantia | Vale? |
| --- | --- |
| Unicidade dentro da organização | **Sim** — chave primária `(organization_id, global_id)`. |
| Um registro nunca recebe dois ID Globais | **Sim** — unicidade `(organization_id, entity_type, entity_id)` e alocação idempotente. |
| Alocação correta sob concorrência | **Sim** — `erp.next_global_id` é atômico (mesmo padrão de `erp.next_code`); testado com alocações simultâneas. |
| Crescimento monotônico | **Sim**. |
| Ausência de lacunas | **Não.** Uma transação que aloca e depois falha consome o número. Lacuna é esperada e não é defeito. |
| Ordem temporal perfeita | **Não.** Números próximos foram criados próximos, mas empate de `created_at` (especialmente no backfill) não garante ordenação exata. |

## 3. Quem recebe ID Global

Recebe quem tem **identidade própria e ciclo de vida próprio** para o usuário — aquilo que ele abre, procura
e comenta como "um registro".

**Recebem:** produto · pessoa · entrada de estoque · documento fiscal · requisição · saída direta ·
devolução · transferência · produção de ração · solicitação de compra · título financeiro · movimento
bancário · importação OFX · documento de venda · animal · movimentação de rebanho · manejo · pesagem ·
equipamento · abastecimento · manutenção · ordem de serviço · perfil de acesso.

**Não recebem:** item de documento · linha de rateio · baixa de título · vínculo (`member_farms`,
`role_permissions`, `organization_members`) · qualquer linha auxiliar sem identidade própria · infraestrutura
(`code_sequences`, `idempotency_keys`, `audit_logs`, `stock_movements`).

A elegibilidade é **declarada em um registry central** (`GLOBAL_ID_ENTITIES`), nunca por `if` espalhado na
rota. `assertGlobalIdRegistry()` recusa entrada que aponte para tabela técnica, rota sem `:id` ou permissão
inválida, e o dicionário de dados é cruzado com o registry por teste.

## 4. Registro global (resolução)

`erp.global_records` é o índice que resolve `#N` sem varrer tabelas:

| Coluna | Papel |
| --- | --- |
| `organization_id` + `global_id` | Chave: o número é único no tenant. |
| `entity_type` + `entity_id` | Tipo canônico + UUID do registro (único por organização). |
| `empresa_id` | Empresa dona (nulo = cadastro da organização). Alimenta o escopo de empresa na resolução. |
| `module`, `canonical_route` | Rota de detalhe resolvida na criação. |
| `created_by`, `created_at` | Trilha. |

`GET /api/global-records/:globalId` aceita `55` e `#55`. Responde **404** quando o número não existe, quando
o usuário não tem a permissão de leitura da entidade, ou quando o registro pertence a empresa fora do seu
escopo — a mesma convenção do resto da API: nunca revelar existência.

**A URL deriva do registro, nunca o contrário.** A rota canônica é calculada na criação
(`resolveGlobalRecordRoute`), inclusive quando uma tabela atende a mais de uma tela
(`financial_titles.direction` → contas a pagar/receber; `sales_documents.kind` → orçamento/pedido/venda).

## 5. Backfill dos registros existentes (PRE-BASE2-04)

Projeto aprovado nesta missão, execução na missão própria:

1. **Ordem determinística:** por entidade, `order by created_at, id` — `id` desempata para o resultado ser
   idêntico em qualquer reexecução.
2. **Idempotente:** `insert ... on conflict (organization_id, entity_type, entity_id) do nothing`; reexecutar
   não duplica nem renumera.
3. **Em lotes**, por organização e por entidade, para não travar tabela grande.
4. **A sequência é ajustada ao fim** (`last_value = max(global_id)`), de modo que registros novos continuem
   depois do histórico.
5. **Documentado ao usuário:** registros anteriores à implantação receberam numeração de migração; a ordem
   reflete a data de criação, sem prometer precisão quando há empate.
6. **Verificação obrigatória:** zero duplicidade de `global_id`; zero registro elegível sem ID Global; rota
   canônica resolvida para todos.

## 6. O que ainda não existe

| Item | Missão |
| --- | --- |
| Alocação automática nas rotas de escrita | PRE-BASE2-04 (`assignGlobalId` já existe e é testado). |
| Backfill dos registros históricos | PRE-BASE2-04. |
| `#55` na busca global (Ctrl K) e exibição no cabeçalho do registro | PRE-BASE2-04 / BASE2-01. |
