import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
// @ts-expect-error — harness de skew em JS puro, fora do grafo de tipos da API
import { diagnosticar, blocoDeDiagnostico, ASSINATURAS } from "../../../../scripts/diagnostico-de-build-web.mjs";
// @ts-expect-error — helper em JS puro; `scripts/lib/sem-comentarios.mjs` é o dono único dessa operação
import { semComentarios } from "../../../../scripts/lib/sem-comentarios.mjs";

/**
 * UM VERMELHO TEM DE DIZER A VERDADE SOBRE SI MESMO (HOTFIX-CI-SKEW-01).
 *
 * Em 22/09/2026 o job "Version skew · os dois sentidos entre a base e este HEAD" ficou VERMELHO no
 * push pós-merge da #52. A linha do CI afirmava que a prova de compatibilidade reprovara. Não era
 * isso: o `next build` da base morrera antes de existir binário para comparar, porque o Google Fonts
 * devolvera as URLs de fonte na forma dinâmica (`/l/font?kit=…&skey=…&v=…`) e os `&` dela quebram o
 * round-trip de query do Turbopack. Medição: 6 respostas em 200, ~3% por build.
 *
 * O diagnóstico existe para essa distância entre o que o job diz e o que aconteceu. Ele NÃO conserta
 * nada e NÃO pode mudar resultado — e é isso que estes testes travam, nas duas direções:
 *
 *   (1) RECONHECE a assinatura real (fixture literal do build que falhou de fato);
 *   (2) NÃO reconhece uma falha de build COMUM — porque nomear causa externa num defeito nosso seria
 *       absolver o defeito, que é pior do que não diagnosticar nada.
 */
const RAIZ = path.resolve(__dirname, "../../../..");

/**
 * Fixture LITERAL: recorte da saída do build que falhou na reprodução controlada (mesma árvore, mesma
 * folha de estilo, única variável = a forma da URL). Copiado como veio, com os códigos de cor ANSI
 * removidos apenas para caber na página — nenhuma das duas marcas passa por eles.
 */
const SAIDA_REAL_DA_FALHA = `
> Build error occurred
Error: Turbopack build failed with 8 errors:
[next]/internal/font/google/dm_sans_bcb79813.module.css:7:8
Error: Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'
   5 |   font-weight: 400;
   6 |   font-display: swap;
>  7 |   src: url(@vercel/turbopack-next/internal/font/google/font?{%22url%22:%22https://fonts.gs...
     |        ^
   8 |   unicode-range: U+0100-02BA, U+02BD-02C5, ...
   9 | }

next/font/google queries have exactly one entry

Debug info:
- Execution of *<ModuleAssetContext as AssetContext>::process_resolve_result failed
- Execution of resolve failed
- Execution of resolve_internal failed
- Execution of <NextFontGoogleFontFileReplacer as ImportMappingReplacement>::result failed
- next/font/google queries have exactly one entry

/home/runner/work/CONTROLE-DE-ESTOQUE/CONTROLE-DE-ESTOQUE/.api-anterior/apps/web:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @agro/web@0.1.0 build: \`next build\`
Exit status 1
`;

/** Uma quebra de build REAL desta árvore — a classe que o diagnóstico jamais pode absolver. */
const SAIDA_DE_DEFEITO_NOSSO = `
> Build error occurred
Error: Turbopack build failed with 1 errors:
./apps/web/src/app/vendas/page.tsx:12:31
Error: Module not found: Can't resolve '@/components/naoExiste'
  10 | import { Base1List } from "@/components/base1/Base1List";
> 12 | import { Sumiu } from "@/components/naoExiste";
     |                               ^
Exit status 1
`;

describe("HOTFIX-CI-SKEW-01 · o diagnóstico reconhece a falha externa", () => {
  it("reconhece a saída REAL do build que falhou", () => {
    const d = diagnosticar(SAIDA_REAL_DA_FALHA);
    expect(d, "a assinatura do build que de fato falhou tem de ser reconhecida").not.toBeNull();
    expect(d.id).toBe("fonte-google-url-com-e-comercial");
  });

  it("o texto explica o mecanismo com número medido, e diz o que NÃO fazer", () => {
    const d = diagnosticar(SAIDA_REAL_DA_FALHA);
    // O número é a diferença entre "às vezes falha" e uma dívida com tamanho declarado.
    expect(d.texto, "sem a medição, o leitor não sabe se é ruído ou dívida").toContain("6 respostas em 200");
    expect(d.texto).toContain("ISTO NÃO É UMA FALHA DE COMPATIBILIDADE ENTRE AS VERSÕES");
    expect(d.texto, "quem lê um CI vermelho precisa saber onde NÃO mexer").toContain("Não mexa na fonte");
    expect(d.texto, "a dívida tem dono documental").toContain("docs/BUILD-DEPENDENCIA-REMOTA.md");
  });

  it("o bloco impresso nomeia o contexto e a assinatura", () => {
    const bloco = blocoDeDiagnostico(ASSINATURAS[0], "o build do web da BASE não chegou a terminar");
    expect(bloco).toContain("DIAGNÓSTICO");
    expect(bloco).toContain("o build do web da BASE não chegou a terminar");
    expect(bloco).toContain("[fonte-google-url-com-e-comercial]");
  });
});

/**
 * VERIFICAÇÃO REVERSA — o gate novo nasce com prova de que RECUSA.
 *
 * Sem estes quatro casos, um diagnóstico que casasse com qualquer coisa seria indistinguível de um
 * diagnóstico correto: todo build vermelho ganharia o parágrafo "a culpa é do Google", e o primeiro
 * import errado de verdade sairia absolvido.
 */
describe("HOTFIX-CI-SKEW-01 · verificação reversa do diagnóstico", () => {
  it("NÃO diagnostica uma quebra de build desta árvore (import inexistente)", () => {
    expect(diagnosticar(SAIDA_DE_DEFEITO_NOSSO), "defeito nosso não pode ser absolvido como causa externa").toBeNull();
  });

  it("UMA marca sozinha não basta — `Module not found` aparece em build quebrado de verdade", () => {
    const soUmaMarca = "Error: Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'";
    expect(diagnosticar(soUmaMarca)).toBeNull();
  });

  it("a outra marca sozinha também não basta", () => {
    expect(diagnosticar("next/font/google queries have exactly one entry")).toBeNull();
  });

  it("saída vazia, nula ou indefinida não inventa diagnóstico", () => {
    expect(diagnosticar("")).toBeNull();
    expect(diagnosticar(null)).toBeNull();
    expect(diagnosticar(undefined)).toBeNull();
  });
});

/**
 * O DIAGNÓSTICO NUNCA VIRA DECISÃO.
 *
 * Esta é a trava que impede o arquivo de se transformar no oposto do que é. Um diagnóstico consultado
 * dentro de um `if` que decide o destino do build seria um gate que se autoaprova quando o texto certo
 * aparece no log — e a primeira falha real com assinatura parecida passaria em silêncio.
 */
describe("HOTFIX-CI-SKEW-01 · o diagnóstico não pode mudar o resultado", () => {
  const fonte = fs.readFileSync(path.join(RAIZ, "scripts/api-anterior.mjs"), "utf8");
  /**
   * A regra é sobre CÓDIGO, e o arquivo explica em prosa justamente o que não faz — a primeira versão
   * deste teste reprovou o arquivo por causa do próprio comentário que promete não ter `|| true`.
   * Um auditor que acusa a própria documentação ensina a apagar a documentação.
   */
  const codigo: string = semComentarios(fonte);

  it("o harness do skew não tem reexecução nem supressão de erro", () => {
    for (const proibido of ["|| true", "continue-on-error", "--no-verify"]) {
      expect(codigo, `"${proibido}" transformaria a falha em verde`).not.toContain(proibido);
    }
  });

  /**
   * `process.exit(0)` EXISTE no arquivo, e é legítimo: o atalho de `--dir` imprime o diretório já
   * montado e sai com sucesso, porque ali não há build nenhum para fazer. O que não pode existir é
   * uma saída bem-sucedida DENTRO do caminho que constrói — por isso a asserção é por região, e não
   * pelo arquivo inteiro. Escrever a versão ampla foi o primeiro reflexo, e ela reprovou o código
   * correto: uma catraca que acusa o inocente é desligada na primeira semana.
   */
  it("não existe saída bem-sucedida dentro do caminho que constrói o web da base", () => {
    const bloco = fonte.slice(fonte.indexOf("function construirWebAnterior"));
    const corpo = bloco.slice(0, bloco.indexOf("\n}\n") + 3);
    expect(corpo).not.toContain("process.exit(0)");
    expect(corpo, "capturar a saída não pode virar engolir a falha").not.toMatch(/catch\s*\{/);
  });

  it("o build do web da base sempre LANÇA quando falha — com assinatura reconhecida ou sem", () => {
    const bloco = fonte.slice(fonte.indexOf("function construirWebAnterior"));
    const corpo = bloco.slice(0, bloco.indexOf("\n}\n") + 3);
    expect(corpo, "o throw é incondicional: fica depois do if do diagnóstico, nunca dentro dele").toMatch(
      /if \(assinatura\) [^\n]*\n\s*throw new Error/
    );
    expect(corpo).not.toMatch(/if \(!?assinatura\)\s*\{[\s\S]*throw/);
  });

  it("nenhuma assinatura é declarada sem as duas marcas", () => {
    expect(ASSINATURAS.length).toBeGreaterThan(0);
    for (const a of ASSINATURAS) {
      expect(a.marcas.length, `assinatura ${a.id} com marca única casaria larga demais`).toBeGreaterThanOrEqual(2);
    }
  });
});
