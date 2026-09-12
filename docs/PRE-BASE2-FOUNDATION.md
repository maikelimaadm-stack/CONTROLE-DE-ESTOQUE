# PRE-BASE2-01 — Fundação de plataforma

> Índice da fundação técnica que o **Modelo Base 2** vai consumir. Esta missão **não** implementa o Modelo
> Base 2 (§6): ela entrega a plataforma sobre a qual ele será construído.

## 1. O que foi construído

| Fundamento | Onde vive | Contrato |
| --- | --- | --- |
| Organização × Empresa, escopo e permissão por empresa | `packages/platform/src/company.ts` · ponte em `apps/api/src/lib/company.ts` | `docs/MULTI-COMPANY-CONTRACT.md` |
| ID Global (`#55`) e registro de resolução | `packages/platform/src/global-id.ts` · `apps/api/src/lib/global-id.ts` · migration 0010 | `docs/GLOBAL-ID-CONTRACT.md` |
| Internacionalização e formatação por idioma | `packages/platform/src/i18n.ts`, `locale.ts`, `locales/pt-BR.ts` · `apps/web/src/lib/i18n.ts` | `docs/I18N-CONTRACT.md` |
| Nomenclatura e independência do sistema de referência | `scripts/naming-audit.mjs` | `docs/DOMAIN-NAMING-STANDARD.md` |
| Dicionário de dados versionado | `packages/platform/data-dictionary.registry.mjs` · `scripts/data-dictionary.mjs` | `docs/DATA-DICTIONARY.md` (gerado) |
| Inventário da dependência de "fazenda" | `scripts/farm-inventory.mjs` | `docs/FARM-DEPENDENCY-INVENTORY.md` (gerado) |
| Roteiro das próximas missões | — | `docs/PRE-BASE2-ROADMAP.md` |

## 2. Núcleo neutro de nicho

`@agro/platform` é o núcleo que não conhece o agro. A regra de dependência é unidirecional:

```
@agro/platform   (organização, empresa, ID Global, idioma, formatação)
      ▲
      │  depende
@agro/domain     (permissões, enums, recursos — inclui o nicho agro)
      ▲
apps/api · apps/web
```

`@agro/platform` **nunca** importa `@agro/domain`. É isso que permite atender outro nicho sem reescrever a
fundação: troca-se o domínio, a plataforma fica.

Módulos de nicho (Pecuária, Confinamento, Reprodução) continuam específicos e não contaminam o núcleo —
autenticação, usuários, permissões, estoque, financeiro, auditoria, anexos, busca, cadastros e plataforma
são neutros por contrato.

## 3. Banco (migration 0010, estritamente aditiva)

| Objeto | Papel |
| --- | --- |
| `erp.organizations.default_language` | Idioma padrão da organização (`pt-BR`). |
| `erp.users.language` | Idioma do usuário (nulo = segue a organização). |
| `erp.global_id_sequences` + `erp.next_global_id(uuid)` | Sequência atômica de ID Global por organização. |
| `erp.global_records` | Resolve `#N` → registro (organização, empresa, tipo, UUID, módulo, rota canônica). |

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

Mais 61 testes unitários em `@agro/platform` e 15 testes de integração em
`apps/api/test/integration/platform.test.ts` (alocação, concorrência, idempotência, isolamento por
organização/empresa/permissão, preferência de idioma).
