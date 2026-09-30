# Fluxo de trabalho

Aprofunda a seção "Fluxo" do `CLAUDE.md`. Carregada sempre.

## Branch e PR

- Antes de qualquer edição: `git fetch origin`, working tree limpo, branch criada do
  `origin/main` ATUAL. Base velha produz conflito e revisão sobre código que não existe mais.
- Uma fatia = uma branch = uma PR. A PR nasce e permanece **DRAFT**.
- Correção de PR revisada atualiza a MESMA branch e a MESMA PR. Abrir uma segunda PR
  para o mesmo assunto fragmenta a revisão e perde o histórico do que já foi respondido.
- PR nova exige o mapa de colisão limpo contra TODAS as PRs abertas (PRE-PR-02, abaixo). Se a
  sua já foi mesclada, o trabalho seguinte recomeça da `main` pós-merge — nunca empilhe sobre
  histórico já mesclado.

## PRE-PR-02 — várias PRs abertas, desde que nenhuma colida

`CLAUDE.md` fixa a lei. Aqui está como ela se cumpre.

Não há teto por faixa nem no repositório. O limite é a colisão, e a fórmula é uma só:

- `colisão com PR aberta ⇒ PR nova = PROIBIDA`

### As faixas

A faixa diz o que a PR pode tocar; ela não conta quantas ficam abertas. Duas fatias da mesma
faixa convivem se não colidem, e duas de faixas diferentes não convivem se colidem.

| Faixa | O que cabe | Fronteira |
|---|---|---|
| **F1 Regra e banco** | domínio, API, banco, regra de negócio | segue a ordem do roteiro (seção "Escopo" do `CLAUDE.md`); número de migration, trava da migration e decisão só com o reservado no prompt |
| **F2 Tela** | só `apps/web` e documentação | sem migration, sem rota nova, sem mudar regra, API ou domínio |
| **F3 Desempenho e operação** | desempenho, importação, infraestrutura, observabilidade | sem regra de negócio nova; número de migration, trava da migration e decisão só com o reservado no prompt |

**Identificação.** A faixa vem do PROMPT da fatia e abre o título da PR: `[F1] …`, `[F2] …`,
`[F3] …`. PR aberta sem faixa no título colide com todas (fail closed): o mapa a trata como se
tocasse tudo. Prompt sem faixa: pare e pergunte — a sessão nunca escolhe a faixa.

### O que é colisão

Colisão se confere contra CADA PR aberta, uma por uma. É qualquer uma destas:

- **ARQUIVO.** Há arquivo em comum entre esta fatia e a PR aberta; a lista dela sai de
  `gh pr diff <n> --name-only`. Não contam como colisão:
  - a linha e a seção próprias em `docs/DECISIONS.md`, `docs/DEPLOYMENT.md` e `docs/TESTING.md`
    — cada PR escreve só a sua e nunca edita a de outra;
  - os arquivos de contagem: o total de migrations nos testes do `packages/db` e as bases
    `*.baseline.json` das catracas;
  - os arquivos gerados: `docs/parity/*` e `pnpm-lock.yaml`.

  Contagem e gerados: quem entra depois refaz, depois de trazer a main.
- **NÚMERO.** Número em comum de migration, trava da migration ou decisão. Em qualquer faixa, só
  vale o número reservado no prompt. Prompt sem reserva, e a fatia precisa de número: pare e
  pergunte — número escolhido pela sessão é o jeito mais barato de duas PRs colidirem sem
  nenhum arquivo em comum.
- **BANCO.** Em comum: a mesma tabela, coluna, função, gatilho, restrição, política ou permissão
  mudada pelas duas, mesmo em arquivos diferentes. Também a pré-condição de migration que confere
  um objeto que a outra muda.
- **CONTRATO.** Em comum: rota, corpo, resposta, configuração da TOP, layout ou permissão que a
  outra muda e que esta usa ou também muda.

Número, banco e contrato não aparecem no nome do arquivo: onde a lista da outra PR tocar
migration, API, domínio ou configuração, leia o diff (`gh pr diff <n>`), não só os nomes.

### Ordem

ORDEM não é colisão, mas tem de ser declarada. Migration de número maior entra depois da de
número menor. A PR diz no corpo "Merge depois de #N" e o motivo — o merge é em fila, e quem
mescla precisa ver a ordem escrita, não deduzi-la do diff.

### MAPA DE COLISÃO

- **Quando:** antes de abrir a PR e antes de CADA relatório — o inicial e os de correção —,
  porque outra PR pode ter sido aberta no meio.
- **Onde:** no corpo da PR e no relatório.
- **Formato:** uma tabela, uma linha por PR aberta:

| PR | faixa | arquivos em comum | números | banco | contrato | ordem de merge |
|---|---|---|---|---|---|---|
| #N | F1 | nenhum (só a própria linha em `docs/DECISIONS.md`) | nenhum (esta usa o número reservado no prompt) | nenhum | nenhum | indiferente |
| #M | F2 | nenhum | nenhum | nenhum | nenhum | Merge depois de #M — motivo |

Sem PR aberta, o mapa diz isso numa linha — continua sendo mapa. Sem mapa, sem PR.

### Com colisão

- Colisão antes de abrir: não abra a PR. Pare e diga com qual PR e em quê. O Maike decide qual
  espera ou como muda o escopo.
- Colisão descoberta com a PR já aberta (outra abriu depois, ou o escopo cresceu): pare, sem
  editar o que é da outra, e diga com qual PR e em quê.

### Merge em fila

- Revisão, merge e deploy seguem um por vez: o próximo merge só depois do deploy do anterior
  conferido. O que corre em paralelo é a execução, nunca a entrada na `main`.
- Depois de cada merge, toda PR aberta traz a main antes da revisão final: `git merge origin/main`,
  nunca rebase nem force push.
- No conflito, mexa só no que é da própria fatia; a seção de outra PR fica como está na main.
- Refaça as contagens (total de migrations, catracas) e os gerados, e rode o CI de novo no HEAD novo.

### Dentro da fatia

Quando a fatia usa mais de um agente, cada agente é dono dos seus arquivos, e dois agentes não
editam o mesmo arquivo. O coordenador define o dono de cada arquivo antes de começar, e integra:
junta o trabalho, roda os gates com os arquivos de todos e commita. É a mesma lei em escala
menor — o que vale entre PRs vale entre agentes.

### A checagem que vem antes de abrir qualquer PR

**Antes de abrir PR, LISTE as abertas.** Não confie na memória da sessão: a conversa pode ter
sido resumida, e a PR aberta pode ser de outra sessão. Uma listagem de leitura basta
(`list_pull_requests` com `state=open`, ou `gh pr list --state open`) — ela não muta nada.
Para CADA aberta, leia os arquivos (`gh pr diff <n> --name-only`, ou `pull_request_read` com
`get_files`) e monte o MAPA DE COLISÃO contra a sua fatia.

- **Nenhuma colisão** → pode abrir, DRAFT, com a faixa no título e o mapa no corpo.
- **Colisão** → não abre. Pare e diga com qual PR e em quê: a decisão de qual espera, ou de como
  muda o escopo, é do Maike.

Repita a listagem e o mapa antes de cada relatório. O mapa de ontem não prova nada sobre a PR
aberta hoje.

**Não existe caminho lateral.** Todas estas são a mesma violação, e a última é a mais
tentadora porque parece obediência:

| Jeito de burlar | Por que é a mesma coisa |
|---|---|
| fechar a PR aberta para liberar o caminho | você não fecha PR — e fechar para abrir outra é abrir outra |
| mesclar a PR aberta | você nunca faz merge; o merge é do Maike, depois de revisão |
| marcar *ready* para "destravar" | marcar ready não é seu, e não destrava nada |
| criar branch concorrente e deixá-la sem PR | é trabalho paralelo sem mapa, que ninguém confere; a revisão some do mesmo jeito |
| abrir PR "temporária", "de rascunho", "só para o CI rodar" | o CI roda na branch da PR aberta; "temporária" é adjetivo, não exceção |

**Se o pedido mandar abrir PR que colide com uma aberta, a lei vence o pedido.** Isto não é
desobediência: é a regra permanente do repositório prevalecendo sobre uma instrução de sessão,
exatamente como acontece com merge, force push e escrita em `main`. Responda dizendo com qual PR
e em quê, não abra, e deixe registrado o que foi pedido e por que não foi feito daquele jeito.

**Por que isto é lei e não preferência.** Duas PRs abertas sobre o mesmo código produzem
revisão dividida, conflito entre as próprias branches e um histórico em que a resposta a um
comentário está numa PR e o código correspondente está na outra. A decisão 222 resolveu isso com
uma PR por vez. A 264 abriu uma por faixa, porque faixa era o jeito barato de SUPOR código
diferente. A 273 troca a suposição pela prova: o mapa confere PR por PR — libera duas fatias da
mesma faixa quando elas não se tocam, e barra duas de faixas diferentes quando se tocam, coisa
que a 264 não barrava. O que não muda: o merge continua em fila, a correção vai na mesma PR e a
sessão nunca mescla. O custo fica declarado: mais PRs abertas significam mais "trazer a main +
CI" depois de cada merge.

O gate é `scripts/claude-harness-audit.mjs`: ele confere que esta lei continua ESCRITA nos dois
donos (`CLAUDE.md` e este arquivo), e que as leis anteriores (264 e 222) não continuam escritas
como vigentes. É
proteção estática de propósito — o gate roda dentro de `pnpm lint`, e `pnpm lint` não fala com a
rede nem depende da API do GitHub. Um lint que precisasse de token ficaria vermelho offline, e o
que ele mediria seria a rede, não o contrato. Quem monta o mapa de colisão é você, na hora de
abrir e antes de cada relatório, com a listagem de leitura e o `gh pr diff` acima; o gate só
confere que a lei continua escrita.

## O que você nunca faz

- `merge` de PR, habilitar auto-merge, marcar *ready for review*.
- **Escrever direto em `main`** — `git push origin main`, `HEAD:main`, `HEAD:refs/heads/main`
  ou qualquer refspec cujo destino seja a branch protegida. Toda mudança entra por PR.
- **Apagar ref remota** (`git push --delete`, `-d`, `:branch`): é configuração do
  repositório, e configuração é humana. `git branch -d` local continua liberado — ele
  remove a referência da SUA cópia, não a do servidor.
- **Mutar o GitHub pela API**: `gh api` com método POST/PUT/PATCH/DELETE, `gh api graphql`
  e `gh repo edit|delete|archive|rename`. `gh api` de leitura continua liberado — o que
  se recusa é o contorno das recusas especializadas, não o diagnóstico.
- `git push --force`, `--force-with-lease`, `git reset --hard`, `git clean -fd`,
  rebase de branch alheia, reescrita de `main`.
- **Mutar banco direto** (`db:migrate`, `db:seed`, `db:reset`): a conexão vem do ambiente e
  o guarda não distingue local de remoto. Detalhe em `database-migrations.md`.
- Alterar configuração do repositório no GitHub (default branch, exclusão de branch):
  é ação humana e a sessão automatizada não tem essa permissão.

Envolver o comando em outro shell (`bash -c`, `sh -c`, `pwsh -Command`) não muda nada: o
payload é reavaliado pelas mesmas regras.

`.claude/hooks/guard-dangerous-command.mjs` bloqueia isso de forma determinística.
O hook é a rede; a regra é a intenção. Não procure a variante que escapa do hook.

## Encerramento de fatia

Toda fatia termina com: gates executados de verdade (com números), diff revisado por
você mesmo de forma adversarial, riscos remanescentes escritos, e o que NÃO foi feito
declarado explicitamente. Escopo reduzido é decisão do Maike, não sua — entregue o
resto por inteiro e diga o que ficou de fora e por quê.

## Gate externo pendente

Quando a prova exige acesso que você não tem (produção autenticada, credencial real),
o resultado é `PENDING`, escrito como tal. Nunca substitua por mock, fixture, preview,
`localhost`, E2E, `curl` sem sessão, health check ou "deploy verde". Um gate que se
autoaprova não é gate.
