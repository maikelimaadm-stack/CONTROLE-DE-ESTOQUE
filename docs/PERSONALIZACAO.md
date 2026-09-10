# Personalização de telas ("modelo base")

Inspirado no conceito de **modelo base** do sistema PROJETOMG (motor de tela único + documento de preferências por usuário), reimplementado sobre a arquitetura declarativa deste sistema.

## Princípios
- **Uma definição, todas as telas**: os 63 cadastros nascem de `packages/domain/src/resources` e os documentos transacionais usam `DocList`. O motor de listagem (`apps/web/src/features/listing`) e o de formulário são únicos: uma alteração neles propaga para todas as telas.
- **Documento JSON por (organização, usuário, módulo, tela)** em `erp.user_screen_preferences`, com `revision` (bloqueio otimista: 409 em conflito entre abas) e limite de 256 KB.
- **Precedência**: personalização do usuário > padrão da organização (`user_id null`, definido por quem tem `screen_layouts.edit` ou é owner) > padrão do código.
- **Mesma validação no cliente e no servidor**: `packages/shared/src/preferences.ts` (`normalizeListPreferences`, `normalizeFormLayout`, catálogo de operadores). A API valida contra a definição do recurso (colunas/campos conhecidos), descartando o que não existe.
- **Cache local + sincronização**: o frontend lê `localStorage` imediatamente e sincroniza com a API com debounce (400 ms), adotando a versão do servidor quando ela é mais nova.

## Listagens (`screen = list`)
| Seção | Conteúdo |
|---|---|
| `columns` | `visible[]`, `order[]`, `widths{px}`, `frozen` |
| `sort` | `{ key, dir }` padrão da listagem |
| `pageSize` | 10…200 |
| `view` | `mode: table\|cards`, `cardFields[]`, `cardsPerRow: 2\|3\|4`, `density` |
| `filters` | `visible[]` (campos de filtro exibidos), `operators{campo: operador}` (padrão por campo), `saved[]` (filtros nomeados com valores), `defaultSaved` |

UI: botão de engrenagem no cabeçalho de toda listagem → diálogo com abas Colunas / Filtros / Visualização; "Restaurar padrão"; "Salvar como padrão da organização" (com permissão).

## Filtros avançados (cadastros declarativos)
Query string `campo__operador=valor` (intervalos: `valor|valor2`). Operadores por família:
- texto: contém, não contém, igual, começa com, termina com, vazio, não vazio
- número/dinheiro: =, ≠, >, ≥, <, ≤, entre, vazio, não vazio
- data: em, antes, depois, entre, hoje, ontem, esta semana, este mês, mês passado, este ano, vazio, não vazio
- seleção/referência: igual, diferente, vazio, não vazio; booleano: igual

No servidor (`advancedClause` em `apps/api/src/routes/resources.ts`) o nome da coluna vem **sempre** da definição declarativa e os valores são parametrizados; valor inválido → 422; operador desconhecido é ignorado. Documentos transacionais (`DocList`) mantêm seus filtros próprios (data/texto/seleção/referência) e ganham visibilidade configurável + filtros salvos.

## API
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/preferences/bootstrap` | todas as preferências do usuário e da organização |
| GET | `/api/preferences/:module/:screen` | `{ user, org, canEditOrg }` |
| PUT | `/api/preferences/:module/:screen?scope=user\|org` | `{ preferences, expectedRevision? }` → 409 com `details.current` em conflito |
| PATCH | `/api/preferences/:module/:screen?scope=` | `{ section, patch }` (merge de uma seção) |
| DELETE | `/api/preferences/:module/:screen?scope=` | remove (volta ao nível anterior de precedência) |

`module` = chave do recurso (`products`) ou id derivado do endpoint (`stock.entries`); `screen` = `list` | `form` | outros (documento livre, validado só por tamanho).

## Layout de formulário (`screen = form`)
Documento **painéis → cards → linhas → campos** (`FormLayout` em `@agro/shared`): `panels[]`, `cards[{panelId, colSpan 6|12, rows[{fieldIds[]}]}]`, `hiddenFieldIds`, `lockedFieldIds`, `requiredFieldIds`, `fieldSizes`, `fieldLabels`, `fieldDefaultValues`. Regras: máx. 7 campos por linha em card de largura 12 e 4 em largura 6; campo obrigatório na definição nunca pode ser ocultado; campos sem posição são anexados ao card "Outros campos". Implementado em todos os cadastros declarativos (`ResourceForm`): botão "Configurar layout do formulário" abre o configurador (`apps/web/src/features/resources/form-layout.tsx`) com painéis (viram abas quando há mais de um), cards (largura total ou meia, recolhíveis), linhas e campos com botões de mover/enviar para outro card (acessível, sem arrastar-e-soltar) e propriedades por campo: rótulo exibido, largura em colunas, valor padrão para novos registros, oculto, somente leitura, obrigatório. Campos obrigatórios na definição não podem ser ocultados nem deixar de ser obrigatórios. "Salvar como padrão da organização" e "Restaurar padrão" como nas listagens.

## Relatórios personalizados
Tela **Relatórios › Relatórios personalizados** e botão **Relatório** em toda listagem de cadastro (leva os filtros aplicados). O construtor (`/relatorios/personalizados/novo`) permite: escolher a entidade (recursos declarativos com permissão de visualização), colunas (ordem e seleção), filtros com operadores (mesma barra das listagens), pesquisa livre, ordenação, agrupamento por campo (subtotais por grupo), totais (Σ em campos numéricos), prévia, exportação CSV/XLSX, impressão e salvar como **privado** ou **compartilhado** com a organização (`saved_reports.share`). Persistência em `erp.saved_reports` (definição JSON validada contra o recurso; até 5.000 linhas por execução).

API: `GET /api/saved-reports/resources`, `GET/POST /api/saved-reports`, `GET/PUT/DELETE /api/saved-reports/:id`, `POST /api/saved-reports/run` (`{ resource_key, definition, format?: csv|xlsx }`). Permissões: `saved_reports.view|create|edit|delete|share` (autor sempre pode editar/excluir os seus); executar exige a permissão de visualização do recurso.

## Testes
- `packages/shared/test/preferences.test.ts` (normalizadores, operadores, datas relativas, layout).
- `apps/api/test/integration/preferences.test.ts` (persistência, 409, PATCH, permissão do padrão da organização, validação de layout, filtros avançados) e `saved-reports.test.ts` (execução com agrupamento/totais, CSV/XLSX, salvar/compartilhar/excluir, validação e permissão).
- `apps/web/e2e/personalizacao.spec.ts` (listagem: cards, coluna oculta, filtro salvo, persistência, restaurar; formulário: campo oculto, rótulo, restaurar; relatório: prévia agrupada, salvar, listar).
