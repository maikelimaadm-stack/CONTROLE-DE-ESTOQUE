# Conectores do Claude Code (MCP)

Como o responsável pelo repositório conecta o Claude Code aos sistemas externos deste
produto. **Este documento ensina a conectar; ele não conecta por você e não guarda segredo.**

Prioridade: GitHub · Supabase · Vercel · Railway · (Sentry no futuro, se existir).

## Decisão: o repositório NÃO versiona um `.mcp.json` funcional

Existe apenas `.mcp.json.example`, que o Claude Code **não lê**. A razão é de risco.

Um `.mcp.json` na raiz é escopo de PROJETO: normalmente exige aprovação interativa, mas a
documentação oficial é explícita em que `claude -p`, sessões do Agent SDK e sessões na
nuvem **não conseguem mostrar esse diálogo e carregam os servidores sem perguntar**. Este
repositório é trabalhado por sessões automatizadas. Versionar um `.mcp.json` funcional
concederia, de uma vez e para sempre, acesso a Supabase, Vercel e Railway a toda sessão
futura — inclusive às que ninguém está acompanhando.

O modelo inerte custa uma cópia manual e mantém a decisão com quem tem de tomá-la.

Para adotar: copie `.mcp.json.example` para `.mcp.json` (fora do versionamento) ou, melhor,
instale no escopo de USUÁRIO com `claude mcp add --scope user`, que vale para todos os seus
projetos e não passa pelo repositório.

## Regra geral

Conectar ≠ autorizar escrita. Todo servidor abaixo entra **somente leitura** por padrão.
Ação mutável (implantar, redeploy, aplicar migration, alterar variável, apagar recurso)
exige autorização explícita do Maike, pedida na hora, para aquela ação — autorização dada
uma vez não vale para a próxima.

Segredo nunca entra em arquivo versionado. Prefira OAuth; quando não houver, variável de
ambiente da máquina. Token colado em configuração é token que vaza em backup, em captura
de tela e em `git status` distraído.

## GitHub

Já disponível pelo próprio Claude Code (CLI/conector). Uso de rotina: ler PR, diff, CI,
comentários, issues. Criar e atualizar a PR da branch é permitido quando a missão pedir.

**Mesclar e marcar como pronta para revisão continuam bloqueados** — por regra (`CLAUDE.md`)
e por mecanismo (`.claude/hooks/guard-dangerous-command.mjs`), que recusa esses subcomandos
do `gh`, inclusive a variante `--auto`, antes de o comando rodar.

## Supabase

Servidor oficial, **sempre com escopo de projeto e somente leitura**. A URL tem esta forma
(o modelo completo está em `.mcp.json.example`):

```
https://mcp.supabase.com/mcp?project_ref=${SUPABASE_PROJECT_REF}&read_only=true&features=database%2Cdocs%2Cdebugging
```

- `project_ref` limita o alcance a UM projeto. Sem ele, o servidor enxerga a organização
  inteira — inclusive projetos que nada têm a ver com este repositório.
- `read_only=true` é o que impede uma consulta exploratória de virar escrita.
- `features=database,docs,debugging` habilita só o necessário para auditar e diagnosticar.
  **Não habilite** `development`, `functions`, `branching` nem `storage` nesta configuração:
  cada um acrescenta superfície de escrita que a auditoria não precisa.
- Autenticação por OAuth (`claude mcp login supabase`) ou variável de ambiente local.
  Nunca cole o token de acesso em arquivo do repositório.

Instalação no escopo do usuário:

```
claude mcp add --transport http --scope user supabase "<a URL acima, com o seu project_ref>"
```

Atenção: variável de ambiente ausente **não** derruba a configuração — o Claude Code
mantém o texto `${...}` literal e só avisa em `claude mcp list`. O resultado é uma URL
quebrada em silêncio. Confira com `claude mcp get supabase` depois de instalar.

Existe também um plugin oficial da Supabase no marketplace da Anthropic, que traz skills e
o MCP juntos. **Não instale automaticamente**: plugin acrescenta instruções ao seu contexto
e ferramentas à sessão; revise o conteúdo antes e instale por decisão sua.

## Vercel

Servidor oficial: `https://mcp.vercel.com`. Autenticação por OAuth.
Quando você souber o time e o projeto, prefira a URL específica do projeto — alcance menor
é a proteção.

Uso previsto: estado de implantação, logs, diagnóstico de build, erros de runtime.
Nenhuma ação de produção sem autorização explícita.

## Railway

Servidor oficial. Instalação orientada pelo próprio CLI (`railway mcp install --agent
claude-code`) ou por OAuth com a credencial do CLI (`railway login`).

Uso previsto: estado do serviço, logs, métricas, variáveis (leitura), diagnóstico.

São **ações mutáveis** e exigem autorização explícita a cada vez: redeploy, aceitar
implantação, subir serviço, criar ou apagar serviço e volume, alterar variável, gerar
domínio. O hook do repositório já recusa os subcomandos de implantação e de remoção do
`railway` pela linha de comando.

## Sentry

Ainda não existe no produto. Quando existir, entra aqui com a mesma regra: leitura por
padrão, escrita só com autorização explícita.

## Conferir o que está ligado

`/mcp` (servidores e estado da autenticação) · `claude mcp list` · `claude mcp get <nome>` ·
`/doctor` (diagnóstico geral) · `/context` (o que está ocupando contexto).

## Se algo der errado

- Entrada com `url` e sem `type` é lida como processo local e falha de um jeito confuso:
  toda entrada com `url` precisa de `"type": "http"`.
- Escopos **não** se mesclam. O mesmo nome em dois escopos não combina campos: um vence
  inteiro. Use nomes distintos ou mantenha um só lugar.
- Para uma sessão automatizada que não deve carregar servidor nenhum: `--strict-mcp-config`.
