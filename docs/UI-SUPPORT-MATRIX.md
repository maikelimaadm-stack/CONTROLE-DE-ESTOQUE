# Matriz de suporte visual

**Este documento é o DONO da matriz de suporte por formato de tela.** `CLAUDE.md`,
`.claude/rules/frontend-web.md`, `docs/UI-STANDARD.md` e `docs/UX-ARCHITECTURE.md` REFERENCIAM esta
matriz; nenhum deles a recopia. Uma segunda tabela com a mesma informação não fica desatualizada com
barulho — ela envelhece em silêncio, e o formato novo simplesmente não aparece.

O gate obrigatório mede **o contrato de suporte vigente**, não uma promessa futura.

## A matriz

| Formato | Estado atual | Gate obrigatório | Observação |
|---|---|---|---|
| **Desktop** | **SUPORTADO** | **SIM** | alvo principal desta fase; regressão aqui bloqueia a entrega |
| **Tablet** | BEST EFFORT | NÃO | regressão estrutural grave é tratada caso a caso, sem virar gate automático |
| **Mobile** | **DEFERRED** | NÃO | adiado por decisão de produto; correção prevista para `MOBILE-01` |

## O que "desktop" significa para os gates

Não há dezenas de breakpoints declarados aqui. O gate usa o viewport que o projeto já pratica:

| | Viewport | Origem |
|---|---|---|
| **Desktop (obrigatório)** | 1280 × 720 | `devices["Desktop Chrome"]` do projeto `chromium` em `apps/web/playwright.config.ts` — é o padrão de toda a suíte |
| **Mobile (deferred)** | 390 × 844 | `test.use({ viewport })` declarado no próprio bloco marcado `@mobile` |

Tablet não tem viewport de gate porque não tem gate. Quando ganhar um, ele nasce aqui.

## DEFERRED não é "resolvido", e não é "sumido"

Mobile estar fora do gate **não** significa que o layout mobile está correto. Significa que o produto
decidiu, explicitamente, não entregar mobile nesta fase. A dívida continua:

- **documentada** — nesta tabela, abaixo;
- **versionada** — o teste continua no repositório, sem `.skip`, sem `.fixme`, sem asserção afrouxada;
- **executável** — `pnpm e2e:mobile` roda e reproduz o defeito;
- **não declarada verde** — nenhum baseline afirma que o cenário passou.

Um teste apagado deixa de ser dívida e vira esquecimento. Por isso o auditor
`scripts/ui-support-matrix-audit.mjs` reprova quem **remover** o débito ou a etiqueta, e quem
introduzir um dos afrouxamentos **mecanicamente detectáveis** que ele nomeia (`.skip`, `.fixme`,
`test.fail`, `force: true`, timeout inflado, `test.slow`).

O que ele **não** faz, para ninguém confundir cobertura com garantia: ele **não analisa asserção**.
Casa texto contra uma lista fechada de padrões. Trocar um limite por outro mais frouxo, esvaziar o
corpo do teste ou mudar o viewport para desktop passam por ele sem uma ofensa sequer. Contra esses,
a proteção continua sendo revisão humana — e é por isso que a dívida também fica escrita aqui.

## Débitos declarados (formato DEFERRED)

Esta tabela é lida pelo auditor. Cada linha declara um débito que **precisa continuar existindo e
falhando** enquanto o formato estiver DEFERRED.

<!-- DEBITOS:INICIO -->

| Débito | Arquivo | Etiqueta | Estado esperado |
|---|---|---|---|
| `UX15` | `apps/web/e2e/portal-vendas-lancador-ux.spec.ts` | `@mobile` | VERMELHO — defeito conhecido, ver abaixo |

<!-- DEBITOS:FIM -->

### UX15 — o `+ Novo` do Portal de Vendas em tela estreita

Medido em `/vendas`, viewport 375 × 667, na base `917d210` (antes da fatia que escreveu o teste):

```
.mg-toolbar   top 117.5  bottom 153.5  h 36.0   flex-wrap: wrap   static  z-index auto
+ Novo        top 150.0  bottom 178.0  h 28.0   (2ª linha, fora da caixa)
.ws-filters   top 162.0  bottom 256.0  h 94.0   static  z-index auto
```

`apps/web/src/app/globals.css` dá ao `.mg-toolbar` uma `height` **fixa** junto com `flex-wrap`: o
conteúdo quebra para a segunda linha mas a caixa continua travada, então o botão vaza 24,5px para
fora. Os dois elementos são `static` com `z-index: auto`, e o `.ws-filters` vem depois no DOM — ganha
por ordem de pintura e intercepta o ponteiro sobre 16px (57%) da altura do botão.

**A correção não é de uma linha.** Remover a `height` fixa faz o UX15 passar e quebra
`cadastros.spec.ts` (`.cmd-panel [role=option]` sai da área visível). `.mg-toolbar` é o cabeçalho de
16 telas, então o conserto precisa da prova de não-regressão dessas telas — é o conteúdo de `MOBILE-01`.

## Como as suítes se separam

Etiqueta, não arquivo separado nem `.skip`: o teste mora ao lado dos irmãos, e a suíte obrigatória o
exclui pelo `grep`.

| Comando | O que roda | Bloqueia entrega? |
|---|---|---|
| `pnpm e2e` | tudo, MENOS o que está etiquetado `@mobile` | **SIM** |
| `pnpm e2e:mobile` | somente `@mobile` | NÃO — pode ficar vermelho |

`pnpm e2e:mobile` imprime, antes de rodar, que o resultado não certifica nada.

## Saída de DEFERRED

Mobile deixa de ser DEFERRED quando `MOBILE-01` entregar o conserto do cabeçalho com a prova de
não-regressão das telas afetadas. Nessa fatia, esta matriz muda de linha e o débito sai da tabela
acima — nunca o contrário: **tirar o teste do gate nunca é o caminho para fechar a dívida.**
