# Contrato multiempresa — Organização × Empresa

> Contrato de plataforma (PRE-BASE2-01). Implementação de referência: `packages/platform/src/company.ts`
> (puro e testado) + `apps/api/src/lib/company.ts` (ponte com o contexto atual).

## 1. Os dois conceitos nunca se colapsam

```
ORGANIZAÇÃO  (tenant/cliente do ERP)
  ├── EMPRESA A   (entidade operacional/jurídica)
  ├── EMPRESA B
  └── EMPRESA C
```

| Conceito | O que é | Onde aparece |
| --- | --- | --- |
| **Organização** | O cliente contratante. Unidade de isolamento de dados, de licenciamento, de permissões e da sequência de ID Global. | `organization_id` em toda tabela de negócio; RLS; `X-Org-Id`. |
| **Empresa** | A entidade operacional/jurídica dona do registro. Unidade de escopo de trabalho, filtro, relatório e autorização fina. | Coluna de empresa nos lançamentos; seleção de contexto; filtros e painéis. |

Uma organização com uma única empresa continua funcionando: a empresa é preenchida automaticamente
(ver §4). O que **não** pode acontecer é tratar organização e empresa como a mesma coisa — isso quebraria
o isolamento de tenant no dia em que um cliente tiver duas empresas.

> **Estado atual:** a Empresa é materializada pela tabela `erp.farms` e pelo vínculo `erp.member_farms`,
> nomes herdados do nicho agro. A troca de nomes é progressiva e tem plano próprio
> (`docs/DOMAIN-NAMING-STANDARD.md`, `docs/FARM-DEPENDENCY-INVENTORY.md`, PRE-BASE2-02/03).
> Este contrato existe justamente para que a regra não dependa do nome.

## 2. Autorização é do backend, sempre

A interface esconder o que o usuário não pode ver é **conveniência**. A autoridade é a API, o serviço e o RLS.

Para um usuário autorizado apenas na Empresa A, todas as portas abaixo respondem como se B e C não
existissem:

| Porta | Comportamento exigido |
| --- | --- |
| Listagem, busca, painel, relatório | Nenhuma linha de B/C. |
| Deep link / URL direta de registro de B/C | 404 (nunca 403: 403 confirmaria a existência). |
| ID Global de registro de B/C | 404. |
| Anexo, auditoria, histórico de registro de B/C | 404. |
| `empresa_id` de B/C enviado no corpo de um lançamento | Recusado. |
| Cabeçalho/parâmetro de empresa apontando para B/C | Recusado (403 quando é seleção explícita de contexto). |

**Regra de ouro:** empresa vinda do cliente é sempre pedido, nunca autorização. O servidor cruza o pedido
com a autorização do vínculo e o resultado só pode diminuir o escopo, jamais aumentá-lo.

### Convenção de lista vazia

`autorizadas = []` significa **todas as empresas da organização** (é a semântica atual de `member_farms`,
preservada deliberadamente para que a migração seja compatível). Restringir um usuário é acrescentar
empresas à lista, nunca esvaziá-la.

## 3. "Todas as empresas" é escopo, não empresa

`ALL_COMPANIES` (`"all"`) é um **escopo de visualização**. Pode ser usado em consulta, listagem, painel,
relatório, indicador e busca. Nunca é persistido: não existe `empresa_id = "all"` em lançamento algum
(`assertPersistableCompanyId` é a guarda).

Escopos possíveis na leitura:

| Escopo | Significado |
| --- | --- |
| `{ kind: "all" }` | Todas as empresas **autorizadas** (não necessariamente todas as da organização). |
| `{ kind: "one", companyId }` | Uma empresa. |
| `{ kind: "set", companyIds }` | Conjunto autorizado (consolidação parcial). |

`resolveCompanyScope` devolve `companyIds: null` quando não há recorte algum a aplicar (usuário autorizado
a tudo e sem filtro); qualquer outro caso devolve a lista explícita. Pedido fora da autorização resulta em
lista **vazia** (nenhuma linha) — nunca em "todas" —, e as empresas recusadas voltam em `denied` para
auditoria e para 403 quando a seleção foi explícita.

## 4. Empresa no lançamento

Um lançamento pertence **sempre a uma empresa concreta**. `selectCompanyForEntry` resolve:

| Situação | Resultado |
| --- | --- |
| Uma única empresa efetiva | `auto` — a interface preenche sem perguntar. |
| Mais de uma empresa efetiva | `required` — seleção explícita obrigatória, sem padrão implícito. |
| Empresa pedida fora da autorização | `denied`. |
| Pedido com `"all"` | Erro de validação (escopo não é empresa). |

## 5. Como usar

```ts
// Leitura (lista, painel, relatório)
const escopo = companyScope(ctx, req.query.empresa_id);      // apps/api/src/lib/company.ts
if (escopo.companyIds) where.push(`t.farm_id = any($n::uuid[])`);  // null = sem recorte

// Escrita (lançamento)
const sel = selectCompanyForEntry(companyAuthorizationOf(ctx), { requested: body.empresa_id });
if (sel.status === "denied") throw new DomainError("NOT_FOUND", "Registro não encontrado");
if (sel.status === "required") throw new DomainError("VALIDATION_ERROR", "Selecione a empresa do lançamento.");
const empresaId = sel.companyId;
```

## 6. Compatibilidade e migração

Enquanto empresa e fazenda coexistem:

1. A autoridade continua sendo `ctx.membership.farmIds` + `farmScope`/`allowedFarms` — nada neste contrato
   afrouxa o escopo existente.
2. `resolveCompanyScope` produz **exatamente** o mesmo resultado de `allowedFarms`. A equivalência é testada
   em `packages/platform/test/company.test.ts` (tabela de casos) e no nível de API em
   `apps/api/test/integration/farm-scope.test.ts`.
3. Quando PRE-BASE2-03 trocar colunas e cabeçalhos, só a ponte (`apps/api/src/lib/company.ts`) muda.

## 7. O que ainda não existe (e por quê)

| Item | Missão |
| --- | --- |
| Tabela/coluna com nome `empresa` em todo o schema | PRE-BASE2-03 (migração coordenada com compatibilidade). |
| `X-Empresa-Id` substituindo `X-Farm-Id` | PRE-BASE2-03 (com aceitação dos dois cabeçalhos durante a transição). |
| Seletor multiempresa e consolidação na interface | PRE-BASE2-05. |
| Permissão por empresa com granularidade por módulo | PRE-BASE2-02. |
