# Padrão de interface — MODELO BASE1

Contrato de interface do ERP. Cada fase da padronização visual acrescenta uma seção; o que está aqui vale para toda
tela nova ou alterada e é verificado por guardrails (`pnpm --filter @agro/web lint` roda `nav-audit` e `copy-audit`;
`pnpm --filter @agro/domain test` verifica os rótulos de enums).

## Idioma e terminologia

### Regras gerais
- **PT-BR obrigatório** em tudo que o usuário lê: rótulos, títulos, colunas, botões, mensagens, avisos, placeholders,
  opções de seletores, rótulos de permissões e nomes de relatórios.
- **Valor interno ≠ rótulo exibido.** Chaves de API, colunas do banco, enums, parâmetros de rota, chaves de permissão,
  `data-testid` e códigos fiscais (NCM, CFOP, CST, NF-e, DFe…) nunca são traduzidos nem renomeados; o que muda é só o
  texto apresentado. Nenhum valor técnico (`written_off`, `awaiting_purchase`, `pregnant`…) chega cru à tela.
- **Rótulos de enums** vêm de uma fonte única: `ENUM_LABELS` / `enumLabel(domínio, valor)` em
  `packages/domain/src/labels.ts` (reexportado em `apps/web/src/lib/copy.ts`). Cada domínio mantém o seu contexto
  (`open` de título = "A vencer"; `open` de documento = "Aberto"). `enumLabel` nunca devolve o valor cru: vazio →
  "Não informado"; valor sem rótulo → "Desconhecido". Padrões como `LABELS[v] ?? v` são proibidos.
- **Glossário** (`COPY` em `apps/web/src/lib/copy.ts`) centraliza só os termos com alto risco de divergência
  (Situação, Painel, Informações, Aviso, Erro, Sucesso, Pesquisar, Buscar, Excluir, Remover, Fechar, "Nenhum registro
  encontrado."…). Não é obrigatório usar constante para toda palavra do sistema.
- **Capitalização**: caixa de frase ("Valor unitário", "Nova solicitação de compra", "Gerar movimento bancário").
  Title Case só em nomes próprios de módulo, tela, recurso ou entrada de catálogo (menu, permissões, relatórios:
  "Contas a Pagar", "Painel Financeiro", "Manutenções de Equipamentos").
- **Sem abreviações** em rótulos: Data (não "Dt."), Valor ("Vl."), Quantidade ("Qtd./Qtde."), Código ("Cód."),
  Observação ("Obs."), Transferência ("Transf."), Documento ("Doc."), Categoria ("Cat."), Vencimento ("Venc."),
  "com/sem/por" ("c/", "s/", "p/"). Siglas consagradas do domínio permanecem (NF-e, DFe, OFX, XML, GMD, SLA, CNPJ,
  UF, IATF, CAPEX/OPEX, "Nº" como prefixo de número de documento, "cab." como unidade).
- **Feedback**: Sucesso · Erro · Aviso · Informações (nunca Success/Error/Warning/Information). "OK" em caixa alta.

### Decisões canônicas
| Termo | Uso |
|---|---|
| **Situação** | rótulo visível do campo/coluna/filtro de status. Nunca "Status" como rótulo (a chave `status` continua). |
| **Painel** | nunca "Dashboard" (Painel de Controle, Painel Financeiro, "Painel não encontrado"). |
| **Buscar** | localizar uma tela, função, registro ou destino (busca global, "Buscar animal", "Buscar relatório"). |
| **Pesquisar** | pesquisar o conteúdo da listagem/tela atual ("Pesquisar por nome ou e-mail", "Pesquisar nesta aba"). |
| **Excluir** | apagar um registro (a ação fica na auditoria). |
| **Remover** | desfazer um vínculo/relação/associação ("Remover dos favoritos", "Remover do painel"). |
| **Fechar** | fechar diálogo/painel sem significado de negócio (botão secundário do `Confirm`). |
| **Cancelar** | cancelar a edição em curso (formulário, diálogo com campos) ou a operação de negócio — sempre com o objeto quando for negócio: "Cancelar documento", "Cancelar movimentação", "Cancelar baixa". Nunca como sinônimo genérico de fechar. |
| **Equipamento** | termo operacional geral de frota (abastecimento, manutenção, transferência, OS). "Máquina" só quando o contexto for realmente uma máquina. |
| **Bem** | termo patrimonial (inventário de bens, depreciação, painel "Bens e frota"). O módulo continua "Frota e Ativos" no menu (registro de navegação). |
| **A vencer** | sem crase ("Á vencer" é erro). Situações de título: A vencer · Vencida · Baixa parcial · Baixada · Cancelada. |

### Moeda, número, data e percentual (`apps/web/src/lib/utils.ts`)
| Helper | Uso | Exemplo |
|---|---|---|
| `brl(v)` | qualquer valor monetário exibido — nunca `"R$ " + valor` | `R$ 1.234,56` |
| `num(v, casas)` | quantidades e números para exibição (Intl pt-BR) — nunca `.toFixed()` só para exibir | `1.234,5` |
| `pct(v, casas = 1)` | percentual em **pontos percentuais** (a API já entrega 0–100) | `3.1 → 3,1%` |
| `dateBR(iso)` | datas (`dd/MM/yyyy`) — nunca `String(date)` nem fatiar ISO à mão | `12/09/2026` |
| `dateTimeBR(iso)` | data e hora curtas em pt-BR | `12/09/2026, 09:30` |
| `monthBR(iso)` | mês de referência | `09/2026` |

Valores enviados à API não mudam (ISO, decimal string): a formatação é só de apresentação. `.toFixed()` continua
válido em cálculo e serialização.

### Ambiente de demonstração
As credenciais demo (`admin@demo.local / Demo@12345`) só aparecem na tela de login quando o build declara
`NEXT_PUBLIC_DEMO_MODE=true`. Produção não define a variável.

### Guardrails
- `apps/web/scripts/copy-audit.mjs` (no `lint`): inglês residual, "Status"/"Dashboard" como rótulo, "Ok", "Á vencer",
  abreviações proibidas e renderização crua de colunas de enum (`?? String(r["status"])`, `{String(r["origin"])}`,
  coluna de enum sem `render`). Só olha texto JSX, props de rótulo, toasts e rótulos do domínio; exceções conscientes
  ficam na lista `ALLOW` com a razão.
- `packages/domain/test/labels.test.ts`: os valores conhecidos têm rótulo PT-BR; todo valor declarado em `check
  constraint` das migrations (`supabase/migrations`) tem rótulo no domínio correspondente; rótulos do domínio
  (campos, permissões, opções) sem inglês/abreviação.
