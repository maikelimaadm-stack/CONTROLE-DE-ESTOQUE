# Dependência remota em tempo de build

**Estado: CLOSED — `FONTE-LOCAL-01` cumprida.** Nenhum `next build` deste repositório busca fonte na
rede. A contagem de dependências remotas de fonte em tempo de build é **0**.

**Dono único deste assunto.** O que o `next build` buscava na REDE enquanto construía, de quem
buscava, o que acontecia quando aquela resposta vinha numa forma que a ferramenta não sabia ler, e
como a dívida foi encerrada. `CLAUDE.md`, `.claude/rules/testing-gates.md` e `docs/TESTING.md`
referenciam este documento; nenhum deles recopia a medição.

Gate: `scripts/fonte-remota-audit.mjs`, encadeado em `pnpm lint`.

Este documento continua existindo depois do conserto por um motivo: a medição que justificou a
mudança é cara de refazer e é ela que impede a próxima pessoa de reintroduzir a busca remota por
achar que o problema era teórico. O incidente é história — não é aviso para não mexer na fonte.
A fonte É mexível; o que não volta é a busca em tempo de build.

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

| Família | Arquivo | Serviço buscado em tempo de build | Fatia que encerra |
|---|---|---|---|
| *(nenhuma)* | — | — | — |

**Zero linhas, e a tabela vazia não é o que prova zero.** Quem prova é
`scripts/fonte-remota-audit.mjs`, varrendo `apps/web/src` atrás de `next/font/google` em suas três
formas de import. A diferença importa: uma tabela que se esvaziasse sozinha seria exatamente o
defeito que este documento existe para impedir — a dívida sumindo do papel sem sair do código.
Agora a afirmação está ancorada no efeito, e o texto só descreve.

Se uma família nova precisar entrar no produto, ela entra pelo mesmo caminho da DM Sans: pacote de
fonte congelado no lockfile, servido por `next/font/local`. Não há linha a acrescentar aqui.

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

> **Esta taxa NÃO valia para o runner, e a diferença é grande.** As três amostras saíram da rede
> daquela sessão. No histórico de CI deste repositório houve **uma** ocorrência desta falha
> (run `35729528090`), contra as várias que 2,4% previriam para a mesma quantidade de builds. As
> duas explicações possíveis são que a taxa a partir da saída do GitHub Actions fosse muito menor,
> ou que a forma dinâmica fosse mudança recente do lado do Google. **Nenhuma das duas foi medida**,
> e nenhuma é mensurável retroativamente. O conserto não dependeu de qual delas era verdade: com a
> fonte servida localmente, a taxa deixou de existir como variável.

**Reprodução controlada:** mesma árvore, mesma folha de estilo, **única variável = a forma da URL**
(injetada por `NEXT_FONT_GOOGLE_MOCKED_RESPONSES`, o mecanismo do próprio Next):

| Caso | URLs | Resultado |
|---|---|---|
| controle | `…/s/dmsans/…woff2` | `exit 0`, `BUILD_ID` gerado |
| experimento | `…/l/font?kit=…&skey=…&v=…` | `exit 1`, 8 erros idênticos aos do CI, sem `BUILD_ID` |

**Identificação independente:** as 8 linhas `src: url(` que o CI acusou (7, 16, 25, 34, 43, 52, 61,
70) batem linha a linha com a folha de estilo real do Google para esta requisição.

---

## 4. Raio de exposição — o que a dívida alcançava

Cada `next build` fazia a sua **própria** busca — não havia cache entre eles. Eram cinco pontos:

| # | Ponto | Onde |
|---|---|---|
| 1 | CI · job `Build · E2E do escopo SUPORTADO` | `.github/workflows/ci.yml` |
| 2 | CI · job `Version skew`, build do HEAD | `.github/workflows/ci.yml` |
| 3 | CI · job `Version skew`, build da BASE | `scripts/api-anterior.mjs` |
| 4 | Implantação na Vercel | `apps/web/vercel.json` |
| 5 | Imagem Docker (Railway) | `apps/web/Dockerfile` |

Eram **três por execução de CI**, e cada um era um sorteio próprio. Esse número — 3 — foi medido e
não dependia de taxa nenhuma.

O que **não** se podia escrever era quantas execuções de CI isso derrubava: multiplicar os 2,4%
daquela rede pelos três builds daria uma frequência que o histórico do repositório contradiz (§3).
Uma conta assim pareceria medição e seria aritmética sobre um número emprestado do ambiente errado.

Os pontos 4 e 5 eram **implantação**: ali a mesma falha derrubava um deploy, e não tinha nada a ver
com skew nem com testes. É por isso que o raio importava mesmo com a frequência desconhecida — a
dívida não estava no gate, estava no build. **Os cinco pontos deixaram de buscar fonte na rede
com `FONTE-LOCAL-01`; o `.woff2` sai do `node_modules`, congelado no lockfile.**

---

## 5. O que NÃO resolvia

Registro das saídas consideradas e recusadas, porque cada uma volta a parecer razoável quando o
incidente esfria.

| Tentativa | Por que não |
|---|---|
| Atualizar o Next | O arquivo do `canary` é **byte a byte idêntico** ao da v16.3.4 — o defeito está lá também |
| Reexecutar o job | Reexecutar é **sortear de novo**, não corrigir — e "rerodar até verde" é proibido. Note ainda que ninguém mediu quanto valia esse sorteio no runner (§3): quem reexecutava não sabia nem a própria chance |
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
seja: **ficar sem rede também reprovava o build.** Não havia caminho gentil.

Isso é o que tornou a dívida maior, não menor — os dois modos de falha derrubavam o build, e um
deles não precisava nem que o Google respondesse errado: bastava a rede oscilar. E `max_retries`
não alcançava nenhum dos dois casos: no da forma dinâmica o `bail!` acontece **antes** de qualquer
requisição do arquivo de fonte.

**O caso da ocorrência de 2026-09-22 foi o segundo — a busca funcionou, e o corpo veio na outra
forma.**

---

## 6. Como a dívida foi encerrada (`FONTE-LOCAL-01`)

A DM Sans passou a ser servida **do próprio projeto**. `apps/web/src/app/layout.tsx` troca
`next/font/google` por `next/font/local` apontando para o arquivo de
`@fontsource-variable/dm-sans` — dependência declarada no `package.json` e congelada no
`pnpm-lock.yaml`, licença **OFL-1.1** no LICENSE do pacote. Não é binário baixado de URL avulsa,
não é cópia sem procedência, não é base64 no repositório e não é CDN alternativo.

**Mesma fonte, mesma aparência.** O eixo `wght` do arquivo variável vai de 100 a 1000, então os
quatro pesos em uso (400, 500, 600, 700) continuam disponíveis — num arquivo só, em vez de quatro. O
subconjunto é `latin`, o mesmo que `subsets: ["latin"]` pedia. `display: "swap"` e a variável CSS
`--font-dm-sans` não mudaram, e por isso `globals.css` não precisou ser tocado. Nenhuma alteração de
tipografia, paleta, token, espaçamento ou layout entrou junto.

Medido no artefato construído, e não só no código-fonte:

| O que se conferiu | Resultado |
|---|---|
| Referências a `fonts.googleapis.com` / `fonts.gstatic.com` no que é SERVIDO (`.next/static`, `.next/server`) | **0** |
| `@font-face` gerado | `src: url(../media/dm_sans_latin_wght_normal-….woff2)`, caminho do próprio bundle |
| `.woff2` servido × arquivo do pacote | **byte a byte idêntico** (`cmp`) |
| `pnpm build` com a árvore limpa (`rm -rf apps/web/.next`) | `exit 0` |

O que a fatia **NÃO** fez: não mudou tipografia, não mexeu em design, não tocou banco, migration,
TOP, estoque, financeiro, fiscal nem mobile.

---

## 7. Condição de saída — **CUMPRIDA**

A dívida encerrava quando **nenhum** `next build` deste repositório precisasse da rede para
construir. O caminho previsto era servir a fonte do próprio projeto com `next/font/local` e o
arquivo versionado, removendo a busca sem mudar uma linha de tipografia — mesma família, mesmos
pesos, mesmo `display`. Foi o caminho seguido, e o §6 mostra a medição.

A ordem exigida era: consertar, e **então** esvaziar a tabela do §2. Foi nessa ordem — o conserto
está em `layout.tsx` e o gate prova zero por varredura, não pela ausência de uma linha num
documento.

O gate continua rodando em toda execução de `pnpm lint`. Ele não é monumento ao incidente: é o que
impede a busca remota de voltar num `import` distraído, e a linha verde dele declara a contagem
(`REMOTE_FONT_BUILD_DEPENDENCIES = 0`) em vez de apenas não reclamar.
