import { expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * OPERACOES-01 · F2 (decisão 279) — AS PEÇAS COMUNS DO VERSION SKEW NOS DOIS SENTIDOS.
 *
 * Módulo de apoio (não é spec: o nome não termina em `.spec.ts`, então nenhuma config o roda). Os dois specs que o
 * usam são `operacoes-01-f2-skew-api-producao.spec.ts` (sentido 1: o web deste HEAD contra a API da base) e
 * `operacoes-01-f2-skew-web-anterior.spec.ts` (sentido 2: o web da base contra a API deste HEAD). Duplicadas, as duas
 * perguntas do mundo envelheceriam cada uma por conta própria — e é delas que depende qual ramo cada caso cobra.
 *
 * O CONTRATO QUE A F2 ACRESCENTA (e que é o que se mede):
 *   · `regrasGerais: { confirmacaoAutomatica, aceitaSemItens }` como ÚLTIMA chave de `GET /api/<área>/<seg>/regras-da-operacao`
 *     — a presença do campo é a declaração (o molde de `reservaEstoque`/`exigeArmazem`, sem capacidade nova);
 *   · `GET /api/aprovacoes/<área>/:id` — a situação da aprovação de UM documento, em prefixo próprio: no binário que não
 *     a tem, a rota inexistente responde o 404 LIMPO "Rota não encontrada" (`plugins/errors.ts` da API); no que a tem, o
 *     id inexistente responde a 404 do DOCUMENTO ("Documento não encontrado", a mesma do GET por id).
 * As duas portas nascem no MESMO binário. Uma sem a outra é defeito, não skew — e a pergunta do mundo reprova.
 *
 * Nada aqui imprime credencial: os cabeçalhos da sessão chegam prontos de quem chama e só viajam nas requisições.
 */
export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
/** Um UUID bem-formado que não existe em organização nenhuma (o mesmo dos specs da Central de Compras). */
export const UUID_INEXISTENTE = "00000000-0000-4000-8000-000000000000";
/** O 404 do manipulador de rota inexistente da API (`plugins/errors.ts`) — a "ausência" da rota nova na base. */
export const MSG_ROTA_NAO_ENCONTRADA = "Rota não encontrada";
/** O 404 da leitura do documento (`notFound("Documento")`) — a resposta da rota nova ao id inexistente. */
export const MSG_DOCUMENTO_NAO_ENCONTRADO = "Documento não encontrado";

export type Mundo = "legado" | "novo";
export type AreaDaCentral = "vendas" | "compras";
/** O bloco que a F2 acrescenta às regras da operação, como a API o declara. */
export type RegrasGeraisNoFio = { confirmacaoAutomatica: boolean; aceitaSemItens: boolean };

/** A porta das regras da operação de cada Central (a da VENDA e a da COMPRA — as variantes que executam regra geral). */
export const PORTA_DAS_REGRAS: Readonly<Record<AreaDaCentral, string>> = Object.freeze({
  vendas: "/api/sales/sales/regras-da-operacao",
  compras: "/api/compras/compras/regras-da-operacao"
});
/** A porta da situação da aprovação de UM documento (a rota de leitura nova da F2). */
export const portaDaSituacao = (area: AreaDaCentral, id: string) => `/api/aprovacoes/${area}/${id}`;

/**
 * Vigia do navegador (o desenho de `top-config-08-skew-api-producao.spec.ts` e de `top-config-08-skew-web-anterior.spec.ts`):
 * falha de CORS não vira exceção nem resposta HTTP — o Chromium aborta a requisição antes de ela existir para a
 * aplicação, e a tela renderiza vazia com o teste verde. Por isso:
 *   · `semBloqueio` — nenhuma requisição à API morreu no navegador (requestfailed, ou CORS/preflight no console). O 404
 *     de rota da base é RESPOSTA (a tela depende de lê-la para esconder o bloco), não falha de rede: se o CORS da base
 *     não o deixasse chegar, é aqui que apareceria;
 *   · `semErroDeContrato` — só no sentido 2: o cliente em produção (o web da base) não recebe 404, 422 nem 5xx da API
 *     nova em nenhuma resposta da página.
 */
export function vigiar(page: Page) {
  const falhas: string[] = []; const respostas: { url: string; status: number }[] = [];
  page.on("requestfailed", (r) => { if (r.url().includes(API)) falhas.push(`${r.url()} → ${r.failure()?.errorText ?? "?"}`); });
  page.on("console", (m) => { if (m.type() === "error" && /CORS|preflight|Access-Control/i.test(m.text())) falhas.push(`console: ${m.text()}`); });
  page.on("response", (r) => { if (r.url().includes("/api/")) respostas.push({ url: r.url(), status: r.status() }); });
  return {
    semBloqueio: () => expect(falhas, "nenhuma requisição pode morrer no navegador (CORS/preflight)").toEqual([]),
    semErroDeContrato: () => {
      const ruins = respostas.filter((r) => r.status === 404 || r.status === 422 || r.status >= 500);
      expect(ruins, `o cliente em produção não pode receber erro de contrato da API nova: ${JSON.stringify(ruins)}`).toEqual([]);
    }
  };
}

/**
 * O bloco `regrasGerais` de um corpo de `/regras-da-operacao`: ausente → `undefined` (a API sem a F2); presente → a
 * forma EXATA (as duas chaves, booleanas) e a ÚLTIMA chave do corpo, ou o teste reprova — um bloco meio-lido não é
 * nenhum dos dois mundos.
 */
export function regrasGeraisDoCorpo(corpo: Record<string, unknown>, contexto: string): RegrasGeraisNoFio | undefined {
  if (!("regrasGerais" in corpo)) return undefined;
  expect(Object.keys(corpo).at(-1), `${contexto}: \`regrasGerais\` é a ÚLTIMA chave (aditivo)`).toBe("regrasGerais");
  const bloco = corpo["regrasGerais"];
  expect(typeof bloco === "object" && bloco !== null ? Object.keys(bloco).sort() : bloco, `${contexto}: o bloco tem exatamente as duas chaves`)
    .toEqual(["aceitaSemItens", "confirmacaoAutomatica"]);
  const { confirmacaoAutomatica, aceitaSemItens } = bloco as Record<string, unknown>;
  expect([typeof confirmacaoAutomatica, typeof aceitaSemItens], `${contexto}: as duas são booleanas`).toEqual(["boolean", "boolean"]);
  return { confirmacaoAutomatica: confirmacaoAutomatica === true, aceitaSemItens: aceitaSemItens === true };
}

/** As regras da operação de UMA TOP, perguntadas direto à API no ar (o contexto de requisição, fora da tela). */
export async function regrasGeraisNaApi(page: Page, cab: Record<string, string>, area: AreaDaCentral, top: string): Promise<RegrasGeraisNoFio | undefined> {
  const r = await page.request.get(`${API}${PORTA_DAS_REGRAS[area]}?tipo_operacao_id=${encodeURIComponent(top)}`, { headers: cab });
  expect(r.status(), `premissa: a API responde as regras da operação (${area}) da TOP do caso`).toBe(200);
  return regrasGeraisDoCorpo(await r.json() as Record<string, unknown>, `regras da operação (${area})`);
}

/**
 * A situação da aprovação do id INEXISTENTE, perguntada direto à API: 404 nos dois mundos, e a MENSAGEM diz qual — a
 * de rota (a rota não existe naquele binário) ou a do documento (a rota existe e o documento não). Qualquer outro
 * status, código ou mensagem é defeito, não skew.
 */
export async function situacaoDoInexistente(page: Page, cab: Record<string, string>, area: AreaDaCentral): Promise<"rota_ausente" | "documento_ausente"> {
  const r = await page.request.get(`${API}${portaDaSituacao(area, UUID_INEXISTENTE)}`, { headers: cab });
  expect(r.status(), `GET da situação (${area}) do id inexistente: 404 nos dois mundos — outro código é defeito`).toBe(404);
  const erro = (await r.json() as { error?: { code?: string; message?: string } }).error;
  expect(erro?.code, `GET da situação (${area}): o código é NOT_FOUND`).toBe("NOT_FOUND");
  expect([MSG_ROTA_NAO_ENCONTRADA, MSG_DOCUMENTO_NAO_ENCONTRADO], `GET da situação (${area}): a 404 da rota ou a do documento, nenhuma outra`).toContain(erro?.message);
  return erro?.message === MSG_ROTA_NAO_ENCONTRADA ? "rota_ausente" : "documento_ausente";
}

/**
 * SENTIDO 1 — O MUNDO É PERGUNTADO À API DA BASE NA HORA, por duas portas que nascem juntas nesta fase: o bloco
 * `regrasGerais` nas regras da operação da TOP do caso e a situação da aprovação do id inexistente. As duas respostas
 * têm de descrever o MESMO binário (uma sem a outra reprova), e a resposta decide o ramo:
 *   · legado (a base de hoje, sem a F2): sem o bloco, e a rota da situação é a 404 de rota;
 *   · novo (a base já com a F2, depois do merge): o bloco, e a rota responde a 404 do documento.
 */
export async function mundoDaApiDaBase(page: Page, cab: Record<string, string>, area: AreaDaCentral, top: string): Promise<Mundo> {
  const bloco = await regrasGeraisNaApi(page, cab, area, top);
  const situacao = await situacaoDoInexistente(page, cab, area);
  const temBloco = bloco !== undefined;
  const temRota = situacao === "documento_ausente";
  expect(temRota, "o bloco `regrasGerais` e a rota da situação da aprovação nascem no MESMO binário: uma resposta sem a outra é defeito").toBe(temBloco);
  const mundo: Mundo = temBloco ? "novo" : "legado";
  console.log(`[skew] OPERACOES-01 F2 · K-1 · a base ${temBloco ? "DECLARA" : "NÃO declara"} \`regrasGerais\` em ${PORTA_DAS_REGRAS[area]} e responde `
    + `"${situacao === "rota_ausente" ? MSG_ROTA_NAO_ENCONTRADA : MSG_DOCUMENTO_NAO_ENCONTRADO}" a GET ${portaDaSituacao(area, UUID_INEXISTENTE)} → mundo ${mundo}`);
  return mundo;
}

/**
 * SENTIDO 2 — O MUNDO É O DO WEB DA BASE. A API no ar é a deste HEAD (perguntar a ela daria sempre "novo" e não diria
 * nada sobre o cliente); a pergunta vai à ÁRVORE da base montada em `.api-anterior`, no commit dela (`git grep` no
 * `HEAD`, imune a arquivo mexido no worktree): o web da base conhece o rótulo "Salvar e confirmar"? Não → legado (a
 * base de hoje: o texto não existe em `apps/web/src` de `622f194`, conferido); sim → novo (a base já com a F2).
 * `git grep` sai 0 com ocorrência e 1 sem nenhuma; qualquer outra saída (árvore ausente, git quebrado) é ERRO — supor
 * o ramo fácil seria certificar o que não se mediu.
 */
export function mundoDoWebDaBase(): Mundo {
  const arvore = path.resolve(__dirname, "../../..", ".api-anterior");
  let ocorrencias = "";
  try {
    ocorrencias = execFileSync("git", ["grep", "-c", "-F", "Salvar e confirmar", "HEAD", "--", "apps/web/src"], { cwd: arvore }).toString().trim();
  } catch (e) {
    if ((e as { status?: number }).status !== 1) throw new Error(`não foi possível medir a árvore da base em ${arvore}: ${String(e)}`);
  }
  const mundo: Mundo = ocorrencias ? "novo" : "legado";
  console.log(`[skew] OPERACOES-01 F2 · K-2 · o web da base ${ocorrencias ? "CONHECE" : "NÃO conhece"} o rótulo "Salvar e confirmar" (${ocorrencias.replace(/\n/g, ", ") || "0 ocorrências"}) → mundo ${mundo}`);
  return mundo;
}

/**
 * SENTIDO 2 — A PREMISSA: a API no ar é a desta fase. As regras da operação de cada TOP do caso trazem `regrasGerais`
 * (forma exata, última chave) e a situação da aprovação do id inexistente é a 404 do DOCUMENTO — não a de rota — nas
 * DUAS áreas. Devolve os blocos, na ordem das TOPs, para o caso conferir o que a API declara de cada uma.
 */
export async function premissaDaApiDestaFase(page: Page, cab: Record<string, string>, area: AreaDaCentral, tops: readonly string[]): Promise<RegrasGeraisNoFio[]> {
  expect(tops.length, "premissa: ao menos uma TOP do caso para perguntar").toBeGreaterThan(0);
  const blocos: RegrasGeraisNoFio[] = [];
  for (const top of tops) {
    const bloco = await regrasGeraisNaApi(page, cab, area, top);
    expect(bloco, `premissa: a API julgada é a desta fase (declara \`regrasGerais\` em ${PORTA_DAS_REGRAS[area]})`).toBeDefined();
    blocos.push(bloco!);
  }
  for (const a of ["vendas", "compras"] as const) {
    expect(await situacaoDoInexistente(page, cab, a), `premissa: a API julgada serve GET ${portaDaSituacao(a, ":id")} (a 404 é a do documento, não a de rota)`)
      .toBe("documento_ausente");
  }
  return blocos;
}
