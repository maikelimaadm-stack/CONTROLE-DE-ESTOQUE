# Harness de engenharia do Claude Code

Camada versionada de governança para o trabalho assistido por IA neste repositório.
Ela não muda o comportamento do ERP: muda o que uma sessão sabe, o que ela pode e o que
ela nunca consegue fazer.

O objetivo prático é que **o prompt de cada missão possa encolher**. Invariante permanente
mora aqui; o prompt define objetivo, escopo e aceite daquela fatia.

## Árvore

```
CLAUDE.md                     leis permanentes, curtas, carregadas sempre
REVIEW.md                     critérios de code review
.mcp.json.example             modelo de conectores (INERTE — não é lido)
.claude/
  settings.json               permissões (segredos negados) + registro do hook
  rules/                      regras modulares; algumas com escopo por caminho
    workflow.md               branch, PR, merge, encerramento, gate pendente
    architecture.md           SSOT, camadas, identidades, renomeação
    security.md               fail closed, recusa uniforme, RLS, produção, segredos
    backend-api.md            paths: apps/api, packages/{domain,plataforma,shared,validation}
    frontend-web.md           paths: apps/web
    database-migrations.md    paths: supabase, packages/db
    testing-gates.md          paths: testes, scripts, workflows
  skills/                     procedimentos sob demanda
    implement-slice/          executar uma fatia, do fetch à PR DRAFT
    certify-pr/               auditar uma PR pelo diff real
    migration-safety/         checklist de schema, RLS e ordem de deploy
    production-smoke/         verificação em produção (só o usuário invoca)
    multi-company-contract/   Organização × Empresa, capacidade × escopo, 404 vs 403
    id-global-contract/       UUID vs código vs #N
    pre-base2-checkpoint/     ordem do roteiro e gates externos
  agents/                     especialistas com contexto isolado (nenhum escreve arquivo)
    security-rls-auditor.md   opus · xhigh
    migration-auditor.md      opus · xhigh
    performance-reviewer.md   opus · high
    pr-certifier.md           opus · xhigh
    frontend-regression-reviewer.md  sonnet · high
    test-gate-verifier.md     sonnet · medium
  hooks/
    guard-dangerous-command.mjs   recusa determinística, com autoteste por fixtures
docs/
  CLAUDE-CODE-ENGINEERING-HARNESS.md  este documento
  CLAUDE-CODE-CONNECTORS.md           MCP e conectores
scripts/claude-harness-audit.mjs      gate do harness (roda dentro de `pnpm lint`)
```

## Cada mecanismo tem um papel

Se dois lugares dizem a mesma coisa, um deles vai envelhecer sozinho — e ninguém percebe,
porque nada quebra. A separação abaixo é o que evita isso.

| Mecanismo | Papel | Quando carrega | Força |
|---|---|---|---|
| `CLAUDE.md` | leis que valem em quase toda sessão | sempre | contexto |
| `.claude/rules/*.md` sem `paths` | regra permanente e modular | sempre | contexto |
| `.claude/rules/*.md` com `paths` | regra de uma área | ao ler arquivo que casa | contexto |
| `.claude/skills/` | procedimento e checklist | sob demanda | contexto |
| `.claude/agents/` | especialista com contexto próprio | quando delegado | contexto |
| `.claude/hooks/` | proibição determinística | antes da ferramenta | **mecanismo** |
| `.claude/settings.json` | permissão (o que nem é lido) | sempre | **mecanismo** |
| `REVIEW.md` | critérios de revisão | na revisão | contexto |
| MCP | acesso a sistema externo | por configuração | acesso |

A distinção que mais importa é a última coluna. **Contexto o modelo pondera; mecanismo o
modelo não negocia.** Por isso "não fazer merge" está nos dois lugares: como lei em
`CLAUDE.md`, para ser entendida, e como hook, para não depender de ter sido lida.

Onde cada regra tem dono único:

- "Claude não mescla" → `CLAUDE.md` + hook.
- Procedimento de certificação → skill `certify-pr` (e o subagente `pr-certifier` a carrega).
- Contrato multiempresa → `docs/MULTI-COMPANY-CONTRACT.md`; a skill é o resumo operacional.
- Critérios do revisor → `REVIEW.md`.
- Migration e RLS por caminho → `.claude/rules/database-migrations.md`.

## Política de modelos

Padrão de implementação: **Claude Opus 5**, esforço `high`.
Sobe para `xhigh` em runtime difícil, RLS, migration e bug de causa não óbvia.

| Modelo | Papel |
|---|---|
| **Opus 5** | implementação e arquitetura complexa; auditoria de segurança, migration, desempenho e certificação |
| **Sonnet 5** | verificação mecânica, exploração, documentação, subagentes de menor risco |
| **Fable 5.1** | auditor especial: auditoria destrutiva, horizonte longo, raciocínio exigente em que `xhigh` do Opus ainda não bastou |
| **Haiku 4.5** | tarefa curta e barata, sem risco |

Sobre o **Fable 5.1**: use em **sessão separada** de auditoria ou checkpoint crítico.
Não troque o executor para Fable no meio de uma PR por ansiedade — trocar de modelo no meio
perde o contexto do que já foi decidido e costuma render releitura, não revisão. E não o
transforme em subagente do dia a dia.

Os arquivos de subagente usam os apelidos (`opus`, `sonnet`), não identificadores fixos:
apelido sobrevive a renomeação de modelo e respeita a lista de modelos disponíveis do
plano. Modelo indisponível é ignorado em silêncio e a sessão mantém o atual — por isso,
confira com `/status` quando o comportamento parecer estranho.

## Ultracode

Ultracode é **modo/configuração do Claude Code**, não um modelo. Usa `xhigh` e pode acionar
workflows dinâmicos com vários agentes.

**Use quando** o trabalho é largo e particionável: auditoria do código inteiro, auditoria de
segurança, migração transversal, refactor que atravessa camadas, caça a defeito sistêmico,
verificação adversarial de achados. Ou quando um contexto único tenderia a perder o objetivo
no meio do caminho.

**Não use** por padrão em fatia pequena, quando os arquivos são os mesmos, quando a
coordenação custa mais que a execução, ou quando o resultado precisa de uma única sequência
transacional de decisões.

Ao usar: delimite o escopo, limite o orçamento quando houver, prefira leque + síntese com
verificação adversarial, use worktrees para agentes que editam e **nunca** deixe agentes
paralelos editando o mesmo arquivo. A síntese final é obrigatória, e os gates continuam
sendo a autoridade — paralelismo não substitui prova.

**O harness não depende de Ultracode para funcionar.**

## Agent teams

Experimental. Use só quando os agentes precisam conversar entre si e o trabalho é
particionável de verdade. Não use para vários agentes mexerem no mesmo arquivo.
Para trabalho paralelo comum, subagentes continuam sendo o padrão.

## Política de PR

Uma fatia, uma branch, uma PR, sempre DRAFT. Correção atualiza a mesma PR.
**O merge é manual, do responsável pelo repositório.** Nenhuma sessão mescla, marca como
pronta para revisão nem habilita merge automático — e o hook recusa esses comandos antes de
rodarem. Detalhe em `.claude/rules/workflow.md` e `docs/REPOSITORY-GOVERNANCE.md`.

## Depurar a configuração

| Comando | Para quê |
|---|---|
| `/status` | modelo, esforço, modo de permissão |
| `/context` | o que está ocupando contexto (inclui a seção de memória) |
| `/memory` | quais arquivos de memória existem — aparecer aqui não significa carregado |
| `/skills` | skills visíveis |
| `/agents` | subagentes visíveis |
| `/hooks` | hooks registrados |
| `/mcp` | servidores e autenticação |
| `/doctor` | diagnóstico geral |

## Testar o harness

```
pnpm audit:claude-harness                                  # gate completo (dentro de pnpm lint)
node .claude/hooks/guard-dangerous-command.mjs --autoteste  # fixtures do guarda
```

O autoteste do guarda roda por **fixtures**: nenhum comando perigoso é executado, nem em
ambiente descartável. Ele confere as duas direções — que o proibido é negado e, igualmente
importante, que o cotidiano (`git status`, `git push -u`, `pnpm lint`, `pnpm db:migrate`)
continua passando. Guarda que bloqueia trabalho legítimo é desinstalado na primeira semana.

O corpo de here-document é tratado como DADO. Documentar um comando proibido não pode
disparar o bloqueio — foi o primeiro defeito real que este guarda produziu, e a fixture
que o cobre continua no arquivo.

## Atualizar o harness sem quebrar o projeto

1. Mudança de harness é PR de governança. Não misture com fatia de produto.
2. Acrescentou arquivo esperado (rule, skill, agent)? Declare-o em
   `scripts/claude-harness-audit.mjs` — o gate cobra a existência.
3. Mudou o guarda? Acrescente a fixture ANTES: uma para o caso negado, outra para o
   cotidiano que não pode quebrar.
4. Rode a **verificação reversa** do gate: quebre uma regra, veja reprovar, restaure.
5. Mudou schema de configuração? Confira na documentação oficial da versão instalada
   (`claude --version`), não em blog. Campo inventado é ignorado em silêncio — o pior modo
   de falhar, porque parece configurado.

Cuidado conhecido: regra com `paths:` **não sobrevive à compactação** por si só — ela é
recarregada quando um arquivo que casa é lido de novo. Invariante que precisa valer sempre
vai para `CLAUDE.md` ou para rule sem `paths`.

## O que NUNCA se automatiza

- **Merge de PR** e marcação de pronta para revisão.
- **Ação destrutiva em produção**: implantar, redeploy, aplicar migration, reset, apagar
  recurso, alterar variável.
- **Segredo**: ler, commitar, imprimir, pôr em relatório.
- **Reescrita de histórico**: force push, `reset --hard`, `clean -fd`, exclusão de branch
  com trabalho não mesclado.

Os quatro estão no hook. O hook é rede de segurança, não permissão para tentar.
