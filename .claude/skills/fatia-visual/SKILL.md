---
name: fatia-visual
description: Executar uma fatia de TELA (faixa F2) que convive com outras PRs visuais abertas sem colidir — dono de arquivo por PR, arquivos compartilhados com um dono só, mapa de colisão pela máquina, gates e corpo da PR. Use em toda edição visual em apps/web que vai virar PR, e antes de cada relatório de uma PR F2.
when_to_use: Pedidos como "ajuste visual", "deixe a tela igual ao desenho", "mude o layout/cor/espaçamento", "várias PRs de tela abertas", "garanta que as PRs não colidam". Complementa implement-slice (o procedimento geral); não use para mudança de API, banco ou regra — isso não é F2.
effort: high
---

# Fatia visual (F2) com várias PRs abertas

A lei de colisão é PRE-PR-02 (`CLAUDE.md` e `.claude/rules/workflow.md`); esta skill não a redefine.
Ela é o jeito de várias fatias de tela correrem juntas sem nunca chegar ao "colidiu, pare".

## 0. O que o prompt tem de trazer

- **Faixa F2** escrita no prompt. Sem faixa: pare e pergunte.
- **Número de decisão** reservado, se a fatia vai escrever linha em `docs/DECISIONS.md`. Sem reserva
  e a fatia precisa de número: pare e pergunte — número escolhido pela sessão é a colisão mais barata.
- **Quais telas** mudam. "Melhorar o visual" sem tela não delimita arquivo, e sem arquivo não há mapa.

F2 é só `apps/web` e documentação: sem migration, sem rota nova, sem mudar regra, API ou domínio.
Precisou de qualquer um desses, a fatia não é F2 — pare e diga.

## 1. Antes de editar: reserve os arquivos pelo mapa

```
git fetch origin && git switch -c claude/<fatia> origin/main
node scripts/mapa-colisao.mjs --faixa F2 --planejado <arquivo1>,<arquivo2>,...
```

Liste os arquivos que a fatia VAI tocar (telas, módulos CSS, specs, a própria linha nos docs). Saída
`1` = colide: não comece; diga com qual PR e em quê. O script lê as PRs abertas por `gh` (só leitura)
e aplica as exceções do workflow (linha própria em `docs/DECISIONS.md`, `docs/DEPLOYMENT.md`,
`docs/TESTING.md`; contagens `*.baseline.json`; gerados).

Para ver o quadro inteiro das PRs abertas entre si: `node scripts/mapa-colisao.mjs --entre-abertas`.

## 2. Desenhe a fatia para não colidir

O que faz duas PRs visuais colidirem quase sempre é um arquivo COMPARTILHADO, não a tela.

| Em vez de… | faça… |
|---|---|
| mexer em `apps/web/src/app/globals.css` para estilizar uma tela | módulo CSS da própria feature (`*.module.css` ao lado do componente, como na `configuracao-layout/`) |
| mudar um primitive de `apps/web/src/components/ui` para uma tela | compor o primitive na tela; mudar o primitive é fatia própria, com E2E das outras telas |
| editar o shell (`apps/web/src/components/layout`) junto com a tela | separar: a tela numa PR, o shell em outra, quando o shell estiver livre |
| reescrever texto existente de um doc de contrato | acrescentar a seção própria nova (só acréscimo não colide; editar uma linha existente colide) |
| renumerar ou "arrumar" a linha de outra PR em `docs/DECISIONS.md` | escrever só a sua linha, com o número reservado, no fim |

**Arquivo compartilhado tem um dono por vez.** Se uma PR aberta já toca o `globals.css`, os
primitives de `apps/web/src/components/ui`, o shell de `apps/web/src/components/layout`,
`apps/web/nav.registry.mjs`, `apps/web/redirects.mjs`, `apps/web/src/lib/utils.ts`,
`apps/web/src/lib/copy.ts`, `apps/web/src/lib/workspace-tabs.tsx`, o motor Base1/Base2 ou
`apps/web/src/features/resources/form-layout.tsx`, a próxima fatia não toca esse arquivo até a
primeira entrar na `main`. O script lista esses arquivos
na seção "Arquivos compartilhados" — ali é onde a PR SEGUINTE vai colidir com a sua.

## 3. Regras de tela que mais reprovam

Os donos são `docs/UI-STANDARD.md`, `.claude/rules/frontend-web.md` e `docs/UI-SUPPORT-MATRIX.md`.
As que mais pegam fatia visual:

- Texto visível em PT-BR, caixa de frase, sem abreviação; "Situação" (não "Status"), "Painel" (não "Dashboard").
- Enum só por `enumLabel`/`StatusBadge`; dinheiro, número e data só pelos formatadores de `apps/web/src/lib/utils.ts`.
- Primitives pelo barrel `@/components/ui`; sem `Button2`/`DialogV2`, sem overlay manual, sem largura própria em Dialog/Drawer.
- Navegação só por `apps/web/nav.registry.mjs`; link para a rota canônica, nunca para redirect.
- Nada de dado de registro, resposta de API ou permissão no armazenamento do navegador.
- Componente genérico alterado exige E2E que prove que as OUTRAS telas não mudaram.
- Desktop (1280 × 720) é gate; tablet é best effort; mobile é DEFERRED — nunca se declara resolvido.
- Baseline (`apps/web/scripts/ui-audit.baseline.json`, `scripts/*.baseline.json`) só desce.

## 4. Provar

Ver no navegador: skill `rodar-local`. Gates (números na PR):

```
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm parity:check
pnpm db:seed:e2e && pnpm e2e        # Postgres local (rodar-local); specs da tela e dos consumidores do que mudou
```

Spec novo nasce com verificação reversa: quebre o comportamento, veja reprovar, restaure. Nunca
`.skip`, `.fixme`, `force: true`, timeout inflado ou retry a mais para ficar verde.

## 5. Abrir e manter a PR

- Título `[F2] <FATIA> — <o que muda>`; PR DRAFT; nunca *ready*, nunca merge.
- Corpo: O quê · **Impacto em dados reais** (decisão 240; tela pura costuma ser "Nenhum", dito com o
  porquê) · **MAPA DE COLISÃO** colado da saída do script, refeito na hora · testes e reversa ·
  diferenças do desenho declaradas · fora de escopo.
- Saída `3` do script (LER O DIFF): leia o diff da outra PR na coluna indicada e escreva no mapa o que
  achou — o script não prova banco nem contrato.
- Depois de CADA merge na `main`: `git merge origin/main` (nunca rebase nem force push), no conflito
  mexa só no que é seu (linhas de outras PRs nos docs ficam, em ordem numérica), refaça gerados e
  contagens, rode os gates e o mapa de novo.
- Antes de CADA relatório: o mapa de novo. O de ontem não prova nada sobre a PR aberta hoje.
