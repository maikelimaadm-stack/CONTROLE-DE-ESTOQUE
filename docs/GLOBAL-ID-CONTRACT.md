# Contrato do ID Global

> Contrato de plataforma (PRE-BASE2-01). Implementação: `packages/plataforma/src/id-global.ts` (MECANISMO
> neutro), `packages/domain/src/id-global.ts` (CATÁLOGO deste produto), `packages/domain/src/rebanho.ts`
> (fonte única das variantes de rebanho), `apps/api/src/lib/id-global.ts` (serviço),
> `supabase/migrations/0010_platform_foundation.sql`.

## 1. Três identificadores, três papéis

| Identificador | Para que serve | Quem gera |
| --- | --- | --- |
| **UUID** | Chave técnica, integridade referencial, URL de detalhe. | Banco (`gen_random_uuid()`). |
| **Código/número da entidade** | Identidade dentro da entidade (`0001` de entradas, `0001` de requisições). | `erp.next_code(org, entidade)`. |
| **ID Global** (`#55`) | Identidade única do registro **dentro da organização**, atravessando módulos e empresas. | `erp.proximo_id_global(org)`. |

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
| Unicidade dentro da organização | **Sim** — chave primária `(organization_id, id_global)`. |
| Um registro nunca recebe dois ID Globais | **Sim** — unicidade `(organization_id, tipo_entidade, id_entidade)` e alocação idempotente. |
| Alocação correta sob concorrência | **Sim** — `erp.proximo_id_global` é atômico (mesmo padrão das sequências de código); testado com alocações simultâneas. |
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

**Não recebem:** movimentação interna de rebanho (evolução, transferência, inventário, processamento —
efeito de outra operação, consultada na tela que a originou) · item de documento · linha de rateio · baixa de título · vínculo (`member_farms`,
`role_permissions`, `organization_members`) · qualquer linha auxiliar sem identidade própria · infraestrutura
(`code_sequences`, `idempotency_keys`, `audit_logs`, `stock_movements`).

A elegibilidade é **declarada em um catálogo central** (`ENTIDADES_ID_GLOBAL`, em `@agro/domain`), nunca por
`if` espalhado na rota. O mecanismo (tipos, resolução, validação) fica em `@erp/plataforma`, que não conhece
tabela, módulo nem permissão deste produto — é o que mantém o núcleo neutro de segmento. `validarRegistroIdGlobal()` recusa entrada que aponte para tabela técnica, rota sem `:id` ou permissão
inválida, e o dicionário de dados é cruzado com o registry por teste.

## 4. Permissão é do REGISTRO, não da tabela

Há tabelas em que uma linha representa coisas com **permissões diferentes**:

| Tabela | Coluna que decide | Variantes → permissão |
| --- | --- | --- |
| `erp.financial_titles` | `direction` | `payable` → `payables.view` · `receivable` → `receivables.view` |
| `erp.sales_documents` | `kind` | `budget` → `budgets.view` · `order` → `orders.view` · `sale` → `sales.view` |
| `erp.animal_handlings` | `handling_type` | nutrição, sanitário, desmama, apartação, pastagem e localização, cada um com a sua |
| `erp.animal_movements` | `movement_type` | compra, venda, nascimento, morte e perda, cada um com a sua |

Uma permissão fixa por tabela produziria dois defeitos, e o segundo é grave:

1. **falso negativo** — quem tem `receivables.view` não conseguiria abrir um recebível;
2. **vazamento de autorização** — quem tem só `payables.view` abriria um recebível.

Por isso o registry usa uma **união discriminada**: numa entidade com variantes é impossível, pelo tipo, ler
uma permissão fixa. `resolverRegistroGlobal` devolve **rota e permissão juntas**, sempre da mesma coluna do
mesmo registro.

Regras que não podem ser violadas:

- a permissão nunca é deduzida da URL — a rota é consequência do registro, não o contrário;
- valor de discriminador fora do mapa **nega** (fail-closed): nada de cair numa permissão mais ampla;
- nunca usar `payables.view OR receivables.view` (ou equivalente) para "resolver" o problema: isso é
  exatamente o vazamento que a variante existe para impedir;
- a resolução lê o discriminador do **registro vivo**, não de um valor copiado no índice — assim rota e
  permissão não envelhecem se o registro mudar de tipo.

### Uma fonte só para as variantes de rebanho

A matriz de manejo e movimentação vive em **um lugar** — `packages/domain/src/rebanho.ts` — e é consumida
pelos três lados que precisam dela: catálogo de ID Global, autorização de anexos
(`apps/api/src/lib/attachment-parent.ts`) e rotas operacionais (`apps/api/src/routes/livestock.ts`).
`apps/api/test/unit/id-global-registry.test.ts` prova que os três não divergem e que a fonte cobre exatamente
os valores aceitos pelo `check` da coluna no banco.

Nenhuma porta usa permissão vizinha como padrão: os antigos `?? "animal_sales.view"` e `?? "nutritions.view"`
foram removidos. Tipo desconhecido ou interno resolve `null` e o chamador **nega com 404**.

Cobertura: `apps/api/test/integration/plataforma.test.ts` prova, nos dois sentidos, que quem tem a permissão
de uma tela resolve só a sua, que o registro que muda de empresa passa a responder pela empresa nova e que
registro excluído deixa de ser navegável; `apps/api/test/integration/rebanho-autorizacao.test.ts` cobre as
matrizes de detalhe, listagem, criação e anexos por tipo de movimentação; `apps/api/test/unit/id-global-registry.test.ts` prova que toda permissão
declarada existe no catálogo real.

## 5. Registro global (resolução)

`erp.registros_globais` é o índice que resolve `#N` sem varrer tabelas:

| Coluna | Papel |
| --- | --- |
| `organization_id` + `id_global` | Chave: o número é único no tenant. |
| `tipo_entidade` + `id_entidade` | Tipo canônico + UUID do registro (único por organização). |
| `empresa_id` | **Índice denormalizado** da empresa no momento da criação. Serve para navegação e diagnóstico e **NUNCA é autoridade de segurança** (ver §5.1). |
| `modulo`, `rota_canonica` | Rota de detalhe resolvida na criação. |
| `criado_por`, `criado_em` | Trilha. |

`GET /api/registros-globais/:idGlobal` aceita `55` e `#55`. Responde **404** quando o número não existe,
quando o registro sumiu, quando o usuário está fora do escopo de empresa e quando lhe falta **a permissão
daquele registro** (não a de uma tela vizinha) — a mesma convenção do resto da API: nunca revelar existência,
nunca 403.

### 5.1 O REGISTRO FONTE É A AUTORIDADE

`empresa_id` no índice pode envelhecer: um animal transferido de empresa mantém no índice a empresa antiga.
Autorizar por ele deixaria quem só tem acesso à empresa antiga abrindo o registro, e daria 404 a quem tem a
empresa nova. Por isso a resolução de `#N` segue esta ordem, sem atalho:

1. localizar o índice global dentro da organização;
2. identificar a entidade no catálogo;
3. carregar o **registro fonte vivo** — tabela literal do catálogo, id parametrizado, `organization_id`, e
   `deleted_at is null` quando a entidade tem exclusão lógica;
4. obter **do registro fonte**: empresa atual, discriminador e existência/visibilidade;
5. autorizar a empresa usando **a empresa atual**;
6. resolver rota + permissão a partir do registro atual;
7. verificar a permissão;
8. só então responder.

Nenhum dado da entidade sai antes do passo 8, e toda negativa é a mesma 404.

**Existência funcional.** O resolvedor enxerga exatamente o que a rota canônica enxerga: registro com
exclusão lógica marcada não é navegável por ID Global. `exclusaoLogica` é declarado por entidade e conferido
contra o schema real das migrations por teste. **Cancelado não é excluído**: um lançamento cancelado continua
existindo e continua navegável — a tela é que mostra a situação.

**A alocação não confia no chamador.** `atribuirIdGlobal(ctx, tipoEntidade, idEntidade)` lê o registro na
mesma transação; UUID inexistente (ou já excluído) nunca vira ponte global.

**A URL deriva do registro, nunca o contrário.** A rota canônica é calculada na criação e, em entidade com
variantes, **reresolvida na leitura** a partir do registro vivo.

**Cadastro abre em consulta.** O ID Global é uma localização de registro, não um atalho para edição: as rotas
dos cadastros genéricos (Modelo Base1) usam o modo de visualização (`?view=1`). Telas de detalhe próprias
(ordem de serviço, perfil de acesso, lançamentos) não precisam do parâmetro.

## 6. Backfill dos registros existentes (PRE-BASE2-04)

Projeto aprovado nesta missão, execução na missão própria:

1. **Ordem determinística:** por entidade, `order by created_at, id` — `id` desempata para o resultado ser
   idêntico em qualquer reexecução.
2. **Idempotente:** `insert ... on conflict (organization_id, tipo_entidade, id_entidade) do nothing`; reexecutar
   não duplica nem renumera.
3. **Em lotes**, por organização e por entidade, para não travar tabela grande.
4. **A sequência é ajustada ao fim** (`ultimo_valor = max(id_global)`), de modo que registros novos continuem
   depois do histórico.
5. **Documentado ao usuário:** registros anteriores à implantação receberam numeração de migração; a ordem
   reflete a data de criação, sem prometer precisão quando há empate.
6. **Verificação obrigatória:** zero duplicidade de `id_global`; zero registro elegível sem ID Global; rota
   canônica resolvida para todos.

## 7. O que ainda não existe

| Item | Missão |
| --- | --- |
| Alocação automática nas rotas de escrita | PRE-BASE2-04 (`atribuirIdGlobal` já existe e é testado). |
| Backfill dos registros históricos | PRE-BASE2-04. |
| `#55` na busca global (Ctrl K) e exibição no cabeçalho do registro | PRE-BASE2-04 / BASE2-01. |
