# Contrato de internacionalização

> Contrato de plataforma (PRE-BASE2-01). Implementação: `packages/platform/src/i18n.ts`,
> `packages/platform/src/locale.ts`, catálogo `packages/platform/src/locales/pt-BR.ts`,
> ligação da interface em `apps/web/src/lib/i18n.ts`.

## 1. Três coisas que nunca se misturam

| | Exemplo | Muda com o idioma? | Vai para o banco? |
| --- | --- | --- | --- |
| **Chave canônica** | `acoes.salvar` | Não | Não |
| **Tradução** | "Salvar" / "Save" | Sim | **Nunca** |
| **Valor de domínio** | `pending` | Não | Sim |

**Regra dura:** tradução nunca é persistida como dado de negócio. Uma situação é gravada como `pending` em
qualquer idioma e traduzida só na apresentação. Persistir "Pendente"/"Pending"/"Pendiente" quebraria
consulta, índice, integração e relatório — e é o erro que este contrato existe para impedir.

A ponte entre os dois mundos é `enumMessageKey("status", "pending")` → `enums.status.pending`.

## 2. Idiomas

- Idioma inicial obrigatório: **pt-BR** (`DEFAULT_LOCALE`), que é também a **referência de completude**.
- `SUPPORTED_LOCALES` lista os idiomas com catálogo publicado. Acrescentar um idioma é acrescentar um
  catálogo e uma entrada — nenhuma tela muda.
- `missingMessageKeys(catálogo, ptBR)` aponta exatamente o que falta traduzir.

## 3. Precedência e negociação

```
idioma do usuário  ›  idioma padrão da organização  ›  padrão do sistema (pt-BR)
```

- `erp.organizations.default_language` — obrigatório, `pt-BR` por padrão.
- `erp.users.language` — opcional; nulo significa "seguir a organização".
- Idioma pedido sem catálogo publicado **cai para o próximo da cadeia**; a tela nunca quebra por causa de
  idioma. Idioma sem região casa com a região publicada (`pt` → `pt-BR`).

O servidor resolve e entrega o resultado pronto: `/api/auth/context` devolve
`language: { organization, user, effective }`; `GET|PUT /api/platform/language` lê e grava a preferência do
usuário. Idioma não publicado é recusado na escrita — preferência inválida não entra no banco.

## 4. Formatação

Data, hora, número, moeda e percentual saem de **um lugar só** (`packages/platform/src/locale.ts`). Código
novo não formata à mão: nada de `toFixed`, concatenação de `dd/mm/aaaa` ou `Intl` espalhado pela tela.

| Função | Observação |
| --- | --- |
| `formatDate` | Data de negócio (`AAAA-MM-DD`) sem deslocamento de fuso. |
| `formatDateTime` | Timestamp com fuso explícito. |
| `formatNumber` / `formatQuantity` | Casas decimais controladas. |
| `formatCurrency` | Moeda vem do idioma (`pt-BR` → BRL) e pode ser sobrescrita. |
| `formatPercent` | Entrada em **pontos percentuais** (12.5 → "12,5%"), como o domínio persiste. |
| `createFormatter({ locale })` | Formatadores já amarrados ao idioma — o que a tela usa (`useFormatter`). |

Valor ausente devolve string vazia, nunca "R$ 0,00": zero é um dado, ausência é outro.

Decimais trafegam como **string** (`"1234.56"`) e só viram número na apresentação. Cálculo continua em
`@agro/shared/money` (Decimal) — formatar não é calcular.

## 5. Como a interface usa

```ts
const tr = useTranslator();     // tradutor do idioma da sessão
const f  = useFormatter();      // formatadores do idioma da sessão

tr("acoes.salvar")              // "Salvar"
f.currencyValue("1234.56")      // "R$ 1.234,56"
f.date("2026-09-12")            // "12/09/2026"
```

`COPY` (`apps/web/src/lib/copy.ts`) continua existindo com a mesma forma, mas **deriva do catálogo**: há uma
única fonte de texto pt-BR. Código novo (e todo o Modelo Base 2) usa `t(...)` diretamente.

O guardrail de copy (`apps/web/scripts/copy-audit.mjs`) audita o catálogo junto com as telas: a terminologia
oficial (Situação, Painel, sem abreviações — `docs/UI-STANDARD.md`) vale para as traduções.

## 6. O que ainda não existe

| Item | Missão |
| --- | --- |
| Tradução de 100% das telas atuais (migração de literais para chaves) | Incremental; obrigatório para componente novo desde já. |
| Segundo idioma publicado | Quando houver demanda: catálogo + entrada em `SUPPORTED_LOCALES`. |
| Rótulos de enum servidos por `enums.<domínio>.<valor>` | DATA-GOV (hoje vêm de `@agro/domain`). |
| Seletor de idioma na interface | PRE-BASE2-05 (contrato e API já prontos). |
