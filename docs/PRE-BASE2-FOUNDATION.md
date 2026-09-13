# PRE-BASE2-01 — Fundação de plataforma

> Índice da fundação técnica que o **Modelo Base 2** vai consumir. Esta missão **não** implementa o Modelo
> Base 2 (§6): ela entrega a plataforma sobre a qual ele será construído.

## 1. O que foi construído

| Fundamento | Onde vive | Contrato |
| --- | --- | --- |
| Organização × Empresa, escopo e permissão por empresa | `packages/plataforma/src/empresa.ts` · ponte em `apps/api/src/lib/empresa.ts` | `docs/MULTI-COMPANY-CONTRACT.md` |
| ID Global (`#55`) e registro de resolução | mecanismo em `packages/plataforma/src/id-global.ts` · catálogo em `packages/domain/src/id-global.ts` · serviço em `apps/api/src/lib/id-global.ts` · migration 0010 | `docs/GLOBAL-ID-CONTRACT.md` |
| Internacionalização e formatação por idioma | `packages/plataforma/src/idioma.ts`, `formatacao.ts`, `idiomas/pt-BR.ts` · `apps/web/src/lib/i18n.ts` | `docs/I18N-CONTRACT.md` |
| Nomenclatura e independência do sistema de referência | `scripts/naming-audit.mjs` | `docs/DOMAIN-NAMING-STANDARD.md` |
| Matriz única das operações de rebanho | `packages/domain/src/rebanho.ts` | `docs/GLOBAL-ID-CONTRACT.md` §4 |
| Dicionário de dados versionado | `packages/domain/dicionario-dados.mjs` · `scripts/data-dictionary.mjs` | `docs/DATA-DICTIONARY.md` (gerado) |
| Inventário da dependência de "fazenda" | `scripts/farm-inventory.mjs` | `docs/FARM-DEPENDENCY-INVENTORY.md` (gerado) |
| Roteiro das próximas missões | — | `docs/PRE-BASE2-ROADMAP.md` |

## 2. Núcleo neutro de nicho

`@erp/plataforma` é o núcleo que não conhece segmento de negócio — a começar pelo próprio nome. A regra de
dependência é unidirecional:

```
@erp/plataforma  (organização, empresa, ID Global, idioma, formatação)
      ▲
      │  depende
@agro/domain     (permissões, enums, recursos — inclui o nicho agro)
      ▲
apps/api · apps/web
```

`@erp/plataforma` **nunca** importa o pacote de domínio. É isso que permite atender outro segmento sem
reescrever a fundação: troca-se o domínio, a plataforma fica. O cruzamento entre os dois (por exemplo,
conferir que toda permissão do registry existe no catálogo) acontece na camada que já depende dos dois —
`apps/api/test/unit/id-global-registry.test.ts` —, nunca invertendo a dependência.

**Mecanismo e configuração estão separados.** O núcleo guarda só o *mecanismo* — tipos, resolução conjunta de
rota e permissão, validação de catálogo, contrato de empresa, idioma e formatação. A *configuração deste
produto* — a lista de entidades elegíveis a ID Global, a matriz de operações de rebanho e o dicionário de
dados — vive em `@agro/domain`, que pode conhecer tabelas, módulos e permissões. Com isso a catraca
`nucleo-neutro-nicho` foi **zerada**: não há mais nome de tabela nem de coluna de nicho dentro da plataforma.

Módulos de nicho (Pecuária, Confinamento, Reprodução) continuam específicos e não contaminam o núcleo —
autenticação, usuários, permissões, estoque, financeiro, auditoria, anexos, busca, cadastros e plataforma
são neutros por contrato.

### 2.1 Autorização e autoridade do dado

Dois princípios que a fundação passa a garantir por construção, e não por disciplina:

- **A autorização de empresa é explícita.** `{ modo: "todas" }` e `{ modo: "selecionadas", empresaIds: [] }`
  são estados distintos; a sentinela "lista vazia = todas" do mecanismo legado é traduzida na ponte
  `apps/api/src/lib/empresa.ts` e não entra no núcleo (`docs/MULTI-COMPANY-CONTRACT.md` §2).
- **A empresa de um lançamento é a interseção `autorização ∩ disponíveis`.** A lista de empresas disponíveis é
  carregada pelo servidor (`empresasDisponiveis`, tenant-scoped, sem excluídas nem inativas) e é parâmetro
  OBRIGATÓRIO da regra: "todas" quer dizer todas as empresas da organização, nunca "qualquer identificador
  enviado pelo cliente". Sem empresa efetiva o resultado é o estado explícito `indisponivel` — não existe
  empresa padrão inventada (`docs/MULTI-COMPANY-CONTRACT.md` §4).
- **O índice não é autoridade de segurança.** `erp.registros_globais.empresa_id` é denormalizado e pode
  envelhecer; a empresa que autoriza vem sempre do **registro fonte vivo**, junto com o discriminador e a
  existência (`docs/GLOBAL-ID-CONTRACT.md` §5.1).
- **Nenhuma porta usa permissão vizinha como padrão.** Variante desconhecida ou interna nega com 404
  (fail-closed), nas três portas de rebanho e na autorização de anexos.
- **Existência funcional é uma regra só.** Numa entidade com exclusão lógica, lista, detalhe, cancelamento,
  anexos e ID Global concordam: `deleted_at` preenchido = inexistente (404). Cancelado não é excluído —
  `status='cancelled'` com `deleted_at` nulo continua existindo e continua consultável.

## 3. Banco (migration 0010, estritamente aditiva)

| Objeto | Papel |
| --- | --- |
| `erp.organizations.idioma_padrao` | Idioma padrão da organização (`pt-BR`). |
| `erp.users.idioma` | Idioma do usuário (nulo = segue a organização). |
| `erp.sequencias_id_global` + `erp.proximo_id_global(uuid)` | Sequência atômica de ID Global por organização. |
| `erp.registros_globais` | Resolve `#N` → registro (organização, empresa, tipo, identificador, módulo, rota canônica). |

Estrutura nova nasce com o nome canônico em português (`docs/DOMAIN-NAMING-STANDARD.md`); `organization_id`
permanece como exceção registrada, por ser convenção transversal das 176 tabelas e do RLS.

Nada existente foi alterado, renomeado ou removido; nenhuma estrutura de `farms`/`farm_id` foi tocada. As
duas tabelas novas declaram a própria política de RLS (o laço genérico da 0007 já havia rodado) com a mesma
regra de tenant do resto do schema.

## 4. Contrato de TOP (ainda não implementada)

TOP = **Tipo de Operação** — a classificação funcional que vai organizar os lançamentos e eliminar telas
duplicadas. Nesta missão fica apenas o contrato; nada de motor genérico.

Uma TOP poderá futuramente determinar: tipo de operação · campos visíveis/obrigatórios · regras permitidas ·
efeito em estoque · efeito financeiro · efeito fiscal · contabilização · permissões · layout do Base 2.

**Princípio que não pode ser violado:**

> **Tela unificada ≠ regra de negócio unificada.**

Unificar a *apresentação* de lançamentos não autoriza fundir as *regras*. Entrada de estoque, documento
fiscal e requisição podem compartilhar a moldura do Base 2 e continuar com serviços, validações e efeitos
contábeis distintos. Motor genérico criado cedo demais vira acoplamento irreversível.

O dicionário de dados já registra, por entidade, a **TOP futura** (coluna "TOP futura (contrato)") para que
BASE2-02 comece de um mapa real em vez de uma folha em branco.

## 5. O que esta missão deliberadamente NÃO fez

| Não feito | Por quê / quando |
| --- | --- |
| Renomear `farm_id`/`farms` | Exige migration coordenada, compatibilidade e teste — PRE-BASE2-03. |
| Trocar `X-Farm-Id` por `X-Empresa-Id` | Quebraria clientes sem camada de compatibilidade — PRE-BASE2-03. |
| Alocar ID Global nas rotas de escrita e fazer backfill | Serviço e contrato prontos e testados; execução em PRE-BASE2-04. |
| Traduzir as telas existentes | Infraestrutura pronta; migração de literais é incremental. |
| Modelo Base 2, TOP, Posting Engine, Transaction Kernel, Layout Engine | Fora do escopo por contrato da missão. |
| Redesenhar Compras/Estoque/Financeiro/Fiscal | Fora do escopo. |

## 6. Gates acrescentados

Rodam em `pnpm lint` (e portanto na CI):

```
node scripts/naming-audit.mjs              referências proibidas + catraca de identificadores herdados
node scripts/farm-inventory.mjs --check    catraca: a dependência de "fazenda" não pode crescer
node scripts/data-dictionary.mjs --check   dicionário íntegro e documento em dia
```

Mais 64 testes unitários em `@erp/plataforma`, 4 de contrato em `apps/api/test/unit/id-global-registry.test.ts`
(toda permissão declarada existe no catálogo real) e 20 de integração em
`apps/api/test/integration/plataforma.test.ts` — incluindo a matriz de permissão por variante: quem tem a
permissão de uma tela resolve só o ID Global da sua, nos dois sentidos.
