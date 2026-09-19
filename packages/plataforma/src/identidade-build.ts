/**
 * IDENTIDADE DO ARTEFATO IMPLANTADO — qual COMMIT está servindo esta superfície.
 *
 * POR QUE ISTO EXISTE. O produto publica o web em DOIS provedores (docs/DEPLOYMENT.md § Superfície
 * web), e cada um constrói de um jeito por contrato: a Vercel usa o Next gerenciado e a Railway usa
 * Docker com `output: "standalone"`. A consequência é que os dois artefatos são LEGITIMAMENTE
 * diferentes byte a byte — e, por isso, comparar HTML, tamanho ou caminho de asset NÃO diz nada
 * sobre qual commit cada um serve. Antes desta função não existia NENHUMA forma de provar por HTTP
 * qual commit estava no ar: medido, não suposto — nenhuma das quatro superfícies públicas expunha
 * cabeçalho, meta ou endpoint de versão, e o `version` do `/health` é o do `package.json`, que não
 * muda de um commit para outro.
 *
 * O QUE ELA É. Uma função PURA de ambiente → identidade. Não lê arquivo, não chama rede, não usa
 * `process.env` implicitamente: o ambiente entra como argumento, que é o que a torna testável nas
 * duas direções sem subir servidor.
 *
 * O QUE ELA NÃO PROVA — e isto precisa estar escrito, senão a próxima pessoa confia demais:
 *  1. NÃO prova que o código servido corresponde ao commit: prova o que o PROVEDOR injetou no
 *     processo. Quem tem o painel pode definir a variável à mão. É medida de confiança, não de
 *     integridade criptográfica.
 *  2. NÃO prova nada quando o deploy não veio de gatilho git (imagem pronta, CLI, `--prebuilt`).
 *     Nesse caso o valor é legitimamente `unknown` — e `unknown` NÃO é evidência de deploy velho.
 *  3. NÃO prova que o SHA existe no repositório nem que a árvore é a esperada. Quem responde isso é
 *     o git, comparando o valor devolvido com a ponta de `main`.
 */

/** O provedor que construiu e serve o artefato. `ambiguo` é recusa, não categoria. */
export type ProvedorDeBuild = "vercel" | "railway" | "local" | "ambiguo";

export interface IdentidadeDeBuild {
  /** SHA completo do commit, ou `unknown` quando o provedor não o injetou. Nunca um valor inventado. */
  sha: string;
  /** Os 7 primeiros caracteres, para leitura humana. `unknown` acompanha `sha`. */
  shaCurto: string;
  provedor: ProvedorDeBuild;
  /** Ambiente declarado pelo provedor (`production`, `preview`…), ou `unknown`. */
  ambiente: string;
  /**
   * O NOME da variável que forneceu o SHA — `nenhuma` quando não havia, `conflito` quando duas
   * discordaram. Sem este campo, `unknown` por ausência e `unknown` por erro seriam indistinguíveis,
   * e a pessoa que investiga um incidente não saberia se o deploy é antigo ou se a leitura falhou.
   */
  origem: string;
}

const DESCONHECIDO = "unknown";

/** Um SHA de git é hexadecimal de 7 a 64 caracteres. O que não for isso é descartado, não "corrigido". */
const SHA_VALIDO = /^[0-9a-f]{7,64}$/i;

const limpo = (v: string | undefined): string | undefined => {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : undefined;
};

/**
 * Resolve a identidade a partir de um ambiente qualquer.
 *
 * FAIL-CLOSED, pela mesma razão de `.claude/rules/security.md` ("discriminador desconhecido NEGA"):
 * se as variáveis dos DOIS provedores estiverem presentes com SHAs DIFERENTES, não há como saber
 * quem construiu o artefato — e escolher uma delas seria afirmar pela ordem do código o que o
 * ambiente não disse. O resultado é `provedor: "ambiguo"`, `sha: "unknown"` e `origem: "conflito"`.
 * Um valor errado com cara de certo é pior que a ausência declarada.
 */
export function identidadeDeBuild(env: Record<string, string | undefined> = {}): IdentidadeDeBuild {
  const shaVercel = limpo(env["VERCEL_GIT_COMMIT_SHA"]);
  const shaRailway = limpo(env["RAILWAY_GIT_COMMIT_SHA"]);

  const naVercel = Boolean(limpo(env["VERCEL"]) ?? limpo(env["VERCEL_ENV"]));
  const naRailway = Boolean(
    limpo(env["RAILWAY_ENVIRONMENT_ID"]) ?? limpo(env["RAILWAY_SERVICE_ID"]) ?? limpo(env["RAILWAY_ENVIRONMENT_NAME"])
  );

  // Conflito real: os dois provedores se anunciam com SHAs que discordam.
  if (shaVercel && shaRailway && shaVercel !== shaRailway) {
    return { sha: DESCONHECIDO, shaCurto: DESCONHECIDO, provedor: "ambiguo", ambiente: DESCONHECIDO, origem: "conflito" };
  }
  // Conflito de provedor: os dois marcadores de plataforma presentes ao mesmo tempo.
  if (naVercel && naRailway) {
    return { sha: DESCONHECIDO, shaCurto: DESCONHECIDO, provedor: "ambiguo", ambiente: DESCONHECIDO, origem: "conflito" };
  }

  const provedor: ProvedorDeBuild = naVercel ? "vercel" : naRailway ? "railway" : "local";

  const bruto = shaVercel ?? shaRailway;
  const origem = shaVercel ? "VERCEL_GIT_COMMIT_SHA" : shaRailway ? "RAILWAY_GIT_COMMIT_SHA" : "nenhuma";
  // SHA malformado é tratado como AUSENTE, e a origem diz que ele veio malformado: publicar lixo
  // como se fosse identidade é pior do que publicar `unknown`.
  const valido = bruto && SHA_VALIDO.test(bruto) ? bruto : undefined;

  const ambiente = limpo(env["VERCEL_ENV"]) ?? limpo(env["RAILWAY_ENVIRONMENT_NAME"]) ?? DESCONHECIDO;

  return {
    sha: valido ?? DESCONHECIDO,
    shaCurto: valido ? valido.slice(0, 7) : DESCONHECIDO,
    provedor,
    ambiente,
    origem: valido ? origem : bruto ? `${origem} (valor inválido)` : "nenhuma"
  };
}
