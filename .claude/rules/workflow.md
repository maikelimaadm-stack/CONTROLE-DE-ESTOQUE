# Fluxo de trabalho

Aprofunda a seção "Fluxo" do `CLAUDE.md`. Carregada sempre.

## Branch e PR

- Antes de qualquer edição: `git fetch origin`, working tree limpo, branch criada do
  `origin/main` ATUAL. Base velha produz conflito e revisão sobre código que não existe mais.
- Uma fatia = uma branch = uma PR. A PR nasce e permanece **DRAFT**.
- Correção de PR revisada atualiza a MESMA branch e a MESMA PR. Abrir uma segunda PR
  para o mesmo assunto fragmenta a revisão e perde o histórico do que já foi respondido.
- PR nova exige a anterior mesclada ou fechada. Se a sua já foi mesclada, o trabalho
  seguinte recomeça da `main` pós-merge — nunca empilhe sobre histórico já mesclado.

## PRE-PR-01 — a checagem que vem antes de abrir qualquer PR

`CLAUDE.md` fixa a lei: `PRs abertas > 0 ⇒ PR nova = PROIBIDA`. Aqui está como ela se cumpre.

**Antes de abrir PR, LISTE as abertas.** Não confie na memória da sessão: a conversa pode ter
sido resumida, e a PR aberta pode ser de outra sessão. Uma listagem de leitura basta
(`list_pull_requests` com `state=open`, ou `gh pr list --state open`) — ela não muta nada.

- **Zero aberta** → pode abrir, DRAFT.
- **Uma ou mais abertas** → o trabalho entra na que está aberta, na mesma branch. Se o assunto
  não couber nela, **pare e diga isso**: a decisão de fechar a atual é do Maike.

**Não existe caminho lateral.** Todas estas são a mesma violação, e a última é a mais
tentadora porque parece obediência:

| Jeito de burlar | Por que é a mesma coisa |
|---|---|
| fechar a PR aberta para liberar o caminho | você não fecha PR — e fechar para abrir outra é abrir outra |
| mesclar a PR aberta | você nunca faz merge; o merge é do Maike, depois de revisão |
| marcar *ready* para "destravar" | marcar ready não é seu, e não destrava nada |
| criar branch concorrente e deixá-la sem PR | é a segunda fatia ativa; a revisão some do mesmo jeito |
| abrir PR "temporária", "de rascunho", "só para o CI rodar" | o CI roda na branch da PR aberta; "temporária" é adjetivo, não exceção |

**Se o pedido mandar abrir PR nova e houver uma aberta, a lei vence o pedido.** Isto não é
desobediência: é a regra permanente do repositório prevalecendo sobre uma instrução de sessão,
exatamente como acontece com merge, force push e escrita em `main`. Responda dizendo qual PR
está aberta, entregue o trabalho nela, e deixe registrado o que foi pedido e por que não foi
feito daquele jeito.

**Por que isto é lei e não preferência.** Duas PRs abertas sobre o mesmo código produzem
revisão dividida, conflito entre as próprias branches e um histórico em que a resposta a um
comentário está numa PR e o código correspondente está na outra. O custo não aparece na hora:
aparece na revisão seguinte, quando ninguém mais consegue dizer qual das duas é a verdade.

O gate é `scripts/claude-harness-audit.mjs`: ele confere que esta lei continua ESCRITA nos dois
donos (`CLAUDE.md` e este arquivo). É proteção estática de propósito — o gate roda dentro de
`pnpm lint`, e `pnpm lint` não fala com a rede nem depende da API do GitHub. Um lint que
precisasse de token ficaria vermelho offline, e o que ele mediria seria a rede, não o contrato.
Quem conta PR aberta é você, na hora de abrir, com a listagem acima.

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
