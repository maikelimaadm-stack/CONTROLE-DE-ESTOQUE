# Dependência remota em tempo de build

**Dono único deste assunto.** O que o `next build` busca na REDE enquanto constrói, de quem busca,
o que acontece quando aquela resposta vem numa forma que a ferramenta não sabe ler, e qual é a
condição de saída. `CLAUDE.md`, `.claude/rules/testing-gates.md` e `docs/TESTING.md` referenciam
este documento; nenhum deles recopia a tabela.

Gate: `scripts/fonte-remota-audit.mjs`, encadeado em `pnpm lint`.

---

## 1. Por que este documento existe

Um build que busca na internet não é determinístico, por melhor que seja o código. Ele passa a
depender de um terceiro que ninguém deste repositório controla, versiona ou pode reexecutar em
estado conhecido. Enquanto esse terceiro responde sempre igual, a dependência é invisível; no dia em
que ele responde diferente, o vermelho aparece num lugar que não tem nada a ver com a causa.

Foi exatamente o que aconteceu em **2026-09-22**, no push pós-merge da PR #52
(`main` = `6bf774a`, run `35729528090`, job `106751740459`): o CI acusou
**"Version skew · os dois sentidos entre a base e este HEAD — FAILURE"**. A leitura natural dessa
linha é "a compatibilidade entre as versões reprovou". Não foi isso. O `next build` da base morreu
antes de existir binário para comparar, e **nenhum dos dois sentidos do skew chegou a rodar**.

---

## 2. A dependência declarada

<!-- DEPENDENCIAS:INICIO -->
| Família | Arquivo | Serviço buscado em tempo de build | Fatia que encerra |
|---|---|---|---|
| `DM_Sans` | `apps/web/src/app/layout.tsx` | `fonts.googleapis.com` + `fonts.gstatic.com` | `FONTE-LOCAL-01` |
<!-- DEPENDENCIAS:FIM -->

A tabela acima é lida por máquina. Uma linha a mais só entra com a fatia que a encerra declarada;
uma família que sair do código tem de sair daqui junto, e vice-versa — o gate confere os dois
sentidos. **A contagem é catraca: ela só diminui.**

---

## 3. O mecanismo, medido

1. `next/font/google` busca a folha de estilo em `fonts.googleapis.com/css2?family=…` **durante o
   build**, sempre com o mesmo User-Agent compilado no binário do Turbopack
   (`crates/next-core/src/next_font/google/mod.rs`, constante `USER_AGENT_FOR_GOOGLE_FONTS`).
2. O Google responde, **para a mesma requisição**, em duas formas diferentes:
   - estática — `fonts.gstatic.com/s/<família>/<v>/<arquivo>.woff2` (sem query string);
   - dinâmica — `fonts.gstatic.com/l/font?kit=…&skey=…&v=…` (**com dois `&`**).
3. `update_google_stylesheet` reembala cada URL de fonte numa **query string** para si mesmo:
   `url(@vercel/turbopack-next/internal/font/google/font?<json>)`, onde `<json>` contém a URL.
4. `&` é o separador de pares de uma query string. Ao reabrir,
   `font_file_options_from_query_map` faz `if (query_map.len() != 1) { bail!(…) }`. Com a URL
   dinâmica são **3** pares, e o build aborta com
   `next/font/google queries have exactly one entry`.

**Medição (2026-09-22), desta rede:** três amostragens independentes, com o User-Agent exato do
Turbopack, na mesma URL — **6 respostas na forma dinâmica em 200**, **7 em 210** e **8 em 450**.
Somadas, **21 em 860 ≈ 2,4%**. Nunca misturado: ou os 8 blocos `@font-face` vêm na forma dinâmica,
ou nenhum vem.

> **Esta taxa NÃO vale para o runner, e a diferença é grande.** As três amostras saíram da rede
> desta sessão. No histórico de CI deste repositório houve **uma** ocorrência desta falha
> (run `35729528090`), contra as várias que 2,4% previriam para a mesma quantidade de builds. As
> duas explicações possíveis são que a taxa a partir da saída do GitHub Actions seja muito menor,
> ou que a forma dinâmica seja mudança recente do lado do Google. **Nenhuma das duas foi medida**,
> e nenhuma é mensurável retroativamente. Quem for decidir com base em probabilidade, decida com
> esta frase, e não com os 2,4%.

**Reprodução controlada:** mesma árvore, mesma folha de estilo, **única variável = a forma da URL**
(injetada por `NEXT_FONT_GOOGLE_MOCKED_RESPONSES`, o mecanismo do próprio Next):

| Caso | URLs | Resultado |
|---|---|---|
| controle | `…/s/dmsans/…woff2` | `exit 0`, `BUILD_ID` gerado |
| experimento | `…/l/font?kit=…&skey=…&v=…` | `exit 1`, 8 erros idênticos aos do CI, sem `BUILD_ID` |

**Identificação independente:** as 8 linhas `src: url(` que o CI acusou (7, 16, 25, 34, 43, 52, 61,
70) batem linha a linha com a folha de estilo real do Google para esta requisição.

---

## 4. Raio de exposição

Cada `next build` faz a sua **própria** busca — não há cache entre eles. São cinco pontos:

| # | Ponto | Onde |
|---|---|---|
| 1 | CI · job `Build · E2E do escopo SUPORTADO` | `.github/workflows/ci.yml` |
| 2 | CI · job `Version skew`, build do HEAD | `.github/workflows/ci.yml` |
| 3 | CI · job `Version skew`, build da BASE | `scripts/api-anterior.mjs` |
| 4 | Implantação na Vercel | `apps/web/vercel.json` |
| 5 | Imagem Docker (Railway) | `apps/web/Dockerfile` |

São **três por execução de CI**, e cada um é um sorteio próprio: não há cache de resposta entre
builds. Esse número — 3 — é medido e não depende de taxa nenhuma.

O que **não** se pode escrever aqui é quantas execuções de CI isso derruba: multiplicar os 2,4%
desta rede pelos três builds daria uma frequência que o histórico do repositório contradiz (§3).
Uma conta assim pareceria medição e seria aritmética sobre um número emprestado do ambiente errado.

Os pontos 4 e 5 são **implantação**: ali a mesma falha derruba um deploy, e não tem nada a ver com
skew nem com testes. É por isso que o raio importa mesmo com a frequência desconhecida — a dívida
não está no gate, está no build.

---

## 5. O que NÃO resolve

| Tentativa | Por que não |
|---|---|
| Atualizar o Next | O arquivo do `canary` é **byte a byte idêntico** ao da v16.3.4 — o defeito está lá também |
| Reexecutar o job | Reexecutar é **sortear de novo**, não corrigir — e "rerodar até verde" é proibido. Note ainda que ninguém mediu quanto vale esse sorteio no runner (§3): quem reexecuta não sabe nem a própria chance |
| `max_retries` do cliente de fetch | Não alcança o caso: o `bail!` acontece em `mod.rs:399`, **antes** da única chamada de rede daquele quadro (`fetch_from_google_fonts`, linha 420). Nenhuma requisição do arquivo de fonte chega a ser emitida, então não há falha para a guarda de retry examinar |
| Trocar o User-Agent | Constante compilada no binário; e nenhum UA testado produz `&` na URL |
| Mocar a resposta no CI | O bundle do version skew tem de ser **real**, nunca mock (`.claude/rules/testing-gates.md`) |
| Tirar o build da base do gate | Removeria o sentido 2 do skew — proibido |

### Uma correção, porque a primeira versão deste documento afirmava o contrário

Escrevi aqui que uma falha de REDE seria benigna — que o Next emitiria aviso e seguiria com fonte de
reserva. **É falso em `next build`.** O que degrada com fonte de reserva é `next dev`. Medido no
código, `crates/next-core/src/next_font/issue.rs` da v16.3.4:

```
/// Emitted when the compile-time Google Fonts fetch fails. Error on `next build`, warning in
/// `next dev` (which renders a fallback font).
fn severity(&self) -> IssueSeverity { if self.is_dev { IssueSeverity::Warning } else { IssueSeverity::Error } }
```

O texto `" from Google Fonts. Using a fallback font instead."` existe **só** no ramo `is_dev`. Ou
seja: **ficar sem rede também reprova o build.** Não há caminho gentil.

Isso torna a dívida maior, não menor — os dois modos de falha derrubam o build, e um deles não
precisa nem que o Google responda errado: basta a rede oscilar. E `max_retries` não alcança nenhum
dos dois casos aqui: no da forma dinâmica o `bail!` acontece **antes** de qualquer requisição do
arquivo de fonte.

**O caso desta ocorrência é o segundo — a busca funcionou, e o corpo veio na outra forma.**

---

## 6. O que esta fatia entregou, e o que ela deliberadamente NÃO fez

Entregou **diagnóstico**, não conserto: `scripts/diagnostico-de-build-web.mjs` reconhece a
assinatura e imprime, abaixo do log, o que de fato aconteceu. O build continua falhando, com o mesmo
código de saída, e o gate continua vermelho — o que muda é o vermelho parar de afirmar uma
reprovação de compatibilidade que não houve.

**Não** removeu `next/font/google`, **não** trocou a fonte, **não** alterou tipografia, **não**
baixou arquivo de fonte para o repositório e **não** mexeu em nada visível. A correção de verdade é
uma mudança de produto, e mudança de produto por causa desta descoberta precisa de autorização
explícita — está registrado como `FONTE-LOCAL-01`.

---

## 7. Condição de saída (`FONTE-LOCAL-01`)

A dívida encerra quando **nenhum** `next build` deste repositório precisar da rede para construir.
O caminho conhecido é servir a fonte do próprio projeto (`next/font/local` com o arquivo
versionado), o que remove a busca sem mudar uma linha de tipografia — mesma família, mesmos pesos,
mesmo `display`.

Encerrar é: consertar, e **então** remover a linha da tabela do §2. Nessa ordem. Remover a linha
antes faz o gate passar sobre uma dívida que continua existindo, que é o defeito que este documento
existe para impedir.
