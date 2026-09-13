# Contrato multiempresa — Organização × Empresa

> Contrato de plataforma (PRE-BASE2-01). Implementação de referência: `packages/plataforma/src/empresa.ts`
> (puro e testado) + `apps/api/src/lib/empresa.ts` (ponte com o contexto atual).

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

### A autorização é EXPLÍCITA (sem sentinela)

O contrato canônico não tem lista vazia ambígua. `AutorizacaoEmpresas` é uma união discriminada:

| Valor | Significado |
| --- | --- |
| `{ modo: "todas" }` | Autorizado a todas as empresas da organização. |
| `{ modo: "selecionadas", empresaIds: [A, B] }` | Autorizado exatamente a A e B. |
| `{ modo: "selecionadas", empresaIds: [] }` | Autorizado a **NENHUMA** empresa. |

Num sistema multiempresa com autorização estrita, "autorizado a tudo" e "autorizado a nada" não podem ser o
mesmo valor: a diferença entre os dois é a diferença entre um painel vazio e um vazamento.

No runtime (§7) os mesmos três estados aparecem POR MÓDULO: `todas`, `selecionadas` (com ou sem empresas) e
"módulo sem configuração" — que é o mesmo que nenhuma empresa.

**Compatibilidade com o mecanismo legado.** A convenção herdada — lista vazia de fazendas significando
"todas" — não existe mais no runtime. Ela sobrevive apenas na BORDA de administração, onde o formato
`farm_ids` continua sendo aceito e traduzido para o modelo canônico
(`apps/api/src/lib/escopo-admin.ts`, testado em `apps/api/test/unit/empresa-bridge.test.ts`).

## 3. "Todas as empresas" é escopo, não empresa

`TODAS_EMPRESAS` (`"todas"`) é um **escopo de visualização**. Pode ser usado em consulta, listagem, painel,
relatório, indicador e busca. Nunca é persistido: não existe `empresa_id = "todas"` em lançamento algum
(`exigirEmpresaPersistivel` é a guarda).

Escopos possíveis na leitura:

| Escopo | Significado |
| --- | --- |
| `{ tipo: "todas" }` | Todas as empresas **autorizadas** (não necessariamente todas as da organização). |
| `{ tipo: "uma", empresaId }` | Uma empresa. |
| `{ tipo: "conjunto", empresaIds }` | Conjunto autorizado (consolidação parcial). |

`resolverEscopoEmpresa` devolve `empresaIds: null` quando não há recorte algum a aplicar (usuário autorizado
a tudo e sem filtro); qualquer outro caso devolve a lista explícita. Pedido fora da autorização resulta em
lista **vazia** (nenhuma linha) — nunca em "todas" —, e as empresas recusadas voltam em `recusadas` para
auditoria e para 403 quando a seleção foi explícita.

## 4. Empresa no lançamento

Um lançamento pertence **sempre a uma empresa concreta**, e a decisão nunca é tomada só com a autorização:
`selecionarEmpresaDoLancamento` exige a lista **server-side** das empresas realmente disponíveis na
organização e resolve pela **interseção `autorização ∩ disponíveis`**.

Por que a lista é obrigatória: `modo: "todas"` significa *todas as empresas da organização*, e **não**
"qualquer identificador que o cliente mandar". Sem o cruzamento, um id de outra organização — ou de empresa
excluída/inativa — passaria pela autorização "todas". Isso é exatamente a regra de ouro do §2 invertida.

| Situação | Resultado |
| --- | --- |
| Nenhuma empresa efetiva | `indisponivel` — estado explícito; não se inventa empresa padrão. |
| Uma única empresa efetiva | `automatica` — a interface preenche sem perguntar. |
| Mais de uma empresa efetiva | `obrigatoria` — seleção explícita, sem padrão implícito. |
| Empresa pedida dentro da interseção | `escolhida`. |
| Empresa pedida fora da interseção | `recusada` — **inclusive no modo "todas"**. |
| Pedido com `"todas"` | Erro de validação (escopo não é empresa). |

Exemplos da interseção (`disponiveis` = `[A, B, C]` salvo indicação):

| Autorização | Disponíveis | Efetivas |
| --- | --- | --- |
| `{ modo: "todas" }` | `[A, B, C]` | `[A, B, C]` |
| `{ modo: "selecionadas", [A, B] }` | `[A, B, C]` | `[A, B]` |
| `{ modo: "selecionadas", [A, B] }` | `[A]` | `[A]` |
| `{ modo: "selecionadas", [A, B] }` | `[C]` | `[]` → `indisponivel` |
| `{ modo: "selecionadas", [] }` | `[A, B]` | `[]` → `indisponivel` |

**O que entra em `disponiveis`:** empresas da organização atual, não excluídas (`deleted_at is null`) e
ativas quando a operação exige empresa ativa — carregadas pelo servidor
(`empresasDisponiveis`, em `apps/api/src/lib/empresa.ts`). A consulta ao banco fica na API: o núcleo
`@erp/plataforma` continua puro, sem banco, e não conhece a materialização atual (`erp.farms`).

## 5. Como usar

```ts
// LEITURA (lista, painel, relatório): o escopo é uma CLÁUSULA SQL do módulo ativo, nunca uma lista em memória
const params: unknown[] = [ctx.orgId];
const where = ["t.organization_id=$1", ...empresaScope(ctx, "t", params)];   // apps/api/src/lib/context.ts

// SQL já pronto: marcadores resolvidos na hora da consulta
const r = await consultaEscopada(ctx, "select … from erp.financial_titles t where t.organization_id=$1 and {{escopo:t.farm_id}}", [ctx.orgId]);

// ESCRITA (lançamento): a empresa do corpo é PEDIDO, nunca autorização
await exigirEmpresaDeLancamento(ctx, body.farm_id);      // fora do escopo do módulo → VALIDATION_ERROR
await exigirEmpresaVisivel(ctx, registro.farm_id);       // registro carregado fora do escopo → NOT_FOUND
```

Quando a porta não tem permissão fixa (a permissão depende do registro: tipo de movimentação, direção do
título, entidade do ID Global), o módulo é resolvido a partir da permissão REAL, e só então o escopo é
aplicado:

```ts
const permissao = permissaoMovimentacao(linha.movement_type, "view");
if (!permissao) throw notFound();
await comPermissaoResolvida(ctx, permissao);                                  // valida a empresa SELECIONADA
await exigirEmpresaVisivel(ctx, linha.farm_id, "Movimentação", moduloDaPermissao(permissao));
if (!hasPermission(ctx, permissao)) throw notFound();
```

## 6. Compatibilidade e migração

1. `erp.member_farms` **deixou de ser autoridade de runtime** (PRE-BASE2-02). A tabela continua no banco até a
   migração física da PRE-BASE2-03; o gate `scripts/member-farms-audit.mjs` impede que volte ao código.
2. O backfill traduziu o estado legado sem que ninguém ganhasse ou perdesse acesso — vínculo vazio virou
   `todas`, vínculo preenchido virou `selecionadas` com exatamente as mesmas empresas, em todos os módulos.
   A equivalência é provada em `packages/db/test/backfill-empresas.test.ts` (matriz completa membro × empresa
   × módulo, comparando a autoridade nova com a regra antiga).
3. A API de administração continua aceitando `farm_ids`; a tradução acontece na borda
   (`apps/api/src/lib/escopo-admin.ts`), nunca no runtime de autorização.
4. `X-Farm-Id` continua sendo SELEÇÃO de contexto de trabalho. A validação dele passou a ser POR MÓDULO, na
   porta: seleção explícita que o usuário não pode usar naquele módulo é 403.

## 7. Acesso por empresa E módulo (autoridade de runtime)

O acesso efetivo é a **interseção** de duas dimensões independentes:

| Dimensão | Pergunta | Fonte |
| --- | --- | --- |
| CAPACIDADE | o *quê* o usuário pode fazer | perfil (`erp.role_permissions`) |
| ESCOPO | *onde* ele pode fazer | `erp.membro_escopos_empresa` + `erp.membro_empresas`, por MÓDULO |

Nunca `OU`. Permissão sem escopo não vê nada; escopo sem permissão não abre porta alguma.

### Granularidade

A granularidade é o **módulo de negócio**, não a tela e não a ação. O catálogo é
`MODULOS_ESCOPO_EMPRESA` (`packages/domain/src/escopo-permissao.ts`), semeado em
`erp.modulos_escopo_empresa`. Início, Relatórios e Configurações **não** são escopos: um relatório financeiro
respeita o escopo de FINANCEIRO, um painel de rebanho respeita PECUÁRIA, e um painel que combina áreas aplica,
bloco a bloco, o módulo da fonte de cada informação.

Não existe permissão por empresa (`empresa_a.payables.view` multiplicaria o catálogo por número de empresas).
O que existe é UMA permissão funcional e, ao lado, o conjunto de empresas daquele módulo.

### Modos e fail-closed

| Configuração do módulo | Empresas |
| --- | --- |
| ausente | **nenhuma** (fail-closed — módulo novo não vira acesso automático) |
| `todas` | todas as empresas REAIS da organização (não "qualquer UUID") |
| `selecionadas` com lista | exatamente aquelas |
| `selecionadas` com lista vazia | nenhuma |
| proprietário | todas, em todos os módulos, inclusive os criados depois |

### Como o módulo ativo é decidido

`runService` deriva o módulo da PERMISSÃO exigida pela rota (`moduloDaPermissao`), o expõe em
`ctx.moduloEmpresa` e o publica na transação (`app.modulo_empresa`). Nunca vem da URL, do pathname, do menu
nem do cliente. Recurso de organização não tem módulo: a capacidade basta, e não há empresa a cruzar.

### Onde o conjunto de empresas vive

No banco. `RequestContext` carrega apenas os MODOS por módulo — uma organização pode ter centenas de empresas,
e trafegá-las a cada requisição não escala. No modo `selecionadas`, o recorte é um semi-join
(`exists (… erp.membro_empresas …)`) sobre a chave primária da tabela, verificado com `EXPLAIN`.

Para verificação PONTUAL (uma linha) e para a RLS empresarial da PRE-BASE2-03 existem as funções SQL
`erp.tem_acesso_empresa(org, usuário, módulo, empresa)` e `erp.empresa_no_escopo(empresa[, módulo])`. Elas não
são usadas nas listagens: o PostgreSQL não embute função cujo corpo contém sublink, e toda regra de escopo
depende de `exists` — embutida seria uma chamada por linha em vez de um semi-join.

### Respostas

| Situação | Resposta |
| --- | --- |
| registro fora do escopo (id na URL) | **404** — não se revela existência |
| empresa proibida escolhida explicitamente (X-Farm-Id ou corpo) | **403** / `VALIDATION_ERROR` — o id veio do cliente |
| sem a permissão funcional | **403** |

## 8. O que ainda não existe (e por quê)

| Item | Missão |
| --- | --- |
| Tabela/coluna com nome `empresa` em todo o schema | PRE-BASE2-03 (migração coordenada com compatibilidade). |
| `X-Empresa-Id` substituindo `X-Farm-Id` | PRE-BASE2-03 (com aceitação dos dois cabeçalhos durante a transição). |
| RLS de empresa aplicada às tabelas de negócio | PRE-BASE2-03 (a base — `erp.tem_acesso_empresa` — já existe). |
| Remoção física de `erp.member_farms` | PRE-BASE2-03. |
| Seletor multiempresa e consolidação na interface | PRE-BASE2-05. |
