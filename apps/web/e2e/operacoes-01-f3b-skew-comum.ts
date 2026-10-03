import { expect, type APIResponse, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { api, empresaAtiva } from "./helpers";
import { criarCadastro, referenciasDoSeed } from "./central-compras-fixtures";
import { API, MSG_ROTA_NAO_ENCONTRADA, type Mundo } from "./operacoes-01-f2-skew-comum";

export { API, MSG_ROTA_NAO_ENCONTRADA, vigiar, type Mundo } from "./operacoes-01-f2-skew-comum";

/**
 * OPERACOES-01 · F3b (decisão 280) — AS PEÇAS COMUNS DO VERSION SKEW DA PESQUISA DE PRODUTO, NOS DOIS SENTIDOS.
 *
 * Módulo de apoio (não é spec: o nome não termina em `.spec.ts`, então nenhuma config o roda). Os dois specs que o
 * usam são `operacoes-01-f3b-skew-api-producao.spec.ts` (sentido 1: o web deste HEAD contra a API da base) e
 * `operacoes-01-f3b-skew-web-anterior.spec.ts` (sentido 2: o web da base contra a API deste HEAD). A vigia do
 * navegador, a URL da API, a 404 de rota e o tipo do mundo vêm IMPORTADOS de `operacoes-01-f2-skew-comum.ts` (sem
 * edição: aquele arquivo é da F2): duplicados, envelheceriam cada um por conta própria.
 *
 * O CONTRATO QUE A F3b ACRESCENTA (e que é o que se mede):
 *   · `GET /api/produtos/pesquisa/capacidades` → `{ capacidades: { pesquisaDeProdutos: 1 } }` — a DECLARAÇÃO. No binário
 *     que não a tem, a rota inexistente responde o 404 LIMPO "Rota não encontrada" (`plugins/errors.ts` da API);
 *   · `GET /api/produtos/pesquisa` aceita `pagina`, `com_saldo` e `controla_estoque` e responde, ao fim, `pagina`,
 *     `temMais` e `filtradoPorSaldo`. No binário anterior a query é `.strict()`: `?pagina=1` → 422 (chave não reconhecida).
 * As duas nascem no MESMO binário. Uma sem a outra é defeito, não skew — e a pergunta do mundo reprova.
 *
 * Nada aqui imprime credencial: os cabeçalhos da sessão chegam prontos de quem chama e só viajam nas requisições.
 */

/** A porta da pesquisa de produto (existe nos dois binários; os parâmetros novos, só no da F3b). */
export const PORTA_DA_PESQUISA = "/api/produtos/pesquisa";
/** A declaração da capacidade (só no binário da F3b). */
export const PORTA_DAS_CAPACIDADES_DA_PESQUISA = "/api/produtos/pesquisa/capacidades";
/** A pesquisa de produto de HOJE nas Centrais (a que o web usa sem a capacidade). */
export const PORTA_DA_PESQUISA_DE_HOJE = "/api/resources/products/options";
/** O corpo EXATO da declaração, escrito à mão (é o contrato do fio, não a constante de um dos dois lados). */
export const CAPACIDADE_DECLARADA = Object.freeze({ capacidades: Object.freeze({ pesquisaDeProdutos: 1 }) });
/** As chaves da resposta da pesquisa: as duas de antes, nesta ordem, e as três que a F3b acrescentou, ao fim. */
export const CHAVES_DA_RESPOSTA_DE_HOJE = ["itens", "estoqueDoArmazem"] as const;
export const CHAVES_ADITIVAS_DA_RESPOSTA = ["pagina", "temMais", "filtradoPorSaldo"] as const;
/** As seis chaves de cada item da pesquisa, na ordem de antes. */
export const CHAVES_DO_ITEM_DA_PESQUISA = ["id", "codigo", "descricao", "referencia", "unidade", "estoque"] as const;

export type CapacidadeDaPesquisa = "ausente" | "declarada";
export type PaginaNaPesquisa = "recusada" | "aceita";

/** O corpo de uma resposta como JSON, ou o texto cru se não for JSON (a asserção mostra o que veio). */
async function corpoDe(r: APIResponse): Promise<unknown> {
  const texto = await r.text();
  try { return JSON.parse(texto) as unknown; } catch { return texto; }
}
const erroDo = (corpo: unknown) => (typeof corpo === "object" && corpo !== null ? (corpo as { error?: Record<string, unknown> }).error : undefined);

/**
 * A capacidade da pesquisa, perguntada direto à API no ar: a 404 de ROTA ("Rota não encontrada", código NOT_FOUND) =
 * `ausente`; 200 com o corpo EXATO `{ capacidades: { pesquisaDeProdutos: 1 } }` = `declarada`. Qualquer outra coisa
 * (outro status, outra mensagem, outra forma, outra versão) reprova: não é nenhum dos dois mundos.
 */
export async function capacidadeDaPesquisaNaApi(page: Page, cab: Record<string, string>): Promise<CapacidadeDaPesquisa> {
  const r = await page.request.get(`${API}${PORTA_DAS_CAPACIDADES_DA_PESQUISA}`, { headers: cab });
  const corpo = await corpoDe(r);
  if (r.status() === 404) {
    expect(erroDo(corpo), `GET ${PORTA_DAS_CAPACIDADES_DA_PESQUISA}: a 404 é a de ROTA (o binário não tem a rota), nenhuma outra`)
      .toEqual({ code: "NOT_FOUND", message: MSG_ROTA_NAO_ENCONTRADA });
    return "ausente";
  }
  expect([r.status(), corpo], `GET ${PORTA_DAS_CAPACIDADES_DA_PESQUISA}: a 404 de rota ou 200 com a declaração EXATA — outra resposta é defeito`)
    .toEqual([200, CAPACIDADE_DECLARADA]);
  return "declarada";
}

/**
 * O parâmetro `pagina` na pesquisa, perguntado direto à API no ar: 422 de chave não reconhecida (a query `.strict()`
 * de antes) = `recusada`; 200 que ECOA `pagina: 1` = `aceita`. Qualquer outra resposta reprova.
 */
export async function paginaNaApi(page: Page, cab: Record<string, string>): Promise<PaginaNaPesquisa> {
  const r = await page.request.get(`${API}${PORTA_DA_PESQUISA}?pagina=1`, { headers: cab });
  const corpo = await corpoDe(r);
  if (r.status() === 422) {
    expect(erroDo(corpo), `GET ${PORTA_DA_PESQUISA}?pagina=1: a 422 é a da chave que a query estrita não conhece`)
      .toMatchObject({ code: "VALIDATION_ERROR", details: [{ message: "Campo não reconhecido" }] });
    return "recusada";
  }
  expect(r.status(), `GET ${PORTA_DA_PESQUISA}?pagina=1: 422 (o binário não conhece) ou 200 — outra resposta é defeito: ${JSON.stringify(corpo)}`).toBe(200);
  expect((corpo as { pagina?: unknown }).pagina, "quem aceita `pagina` ECOA a página respondida").toBe(1);
  return "aceita";
}

/**
 * SENTIDO 1 — O MUNDO É PERGUNTADO À API DA BASE NA HORA, pelas duas portas que nascem juntas na F3b: a declaração da
 * capacidade e o parâmetro `pagina`. As duas respostas têm de descrever o MESMO binário (ausente ⇔ recusada; declarada
 * ⇔ aceita), e a resposta decide o ramo:
 *   · legado (a base de hoje, sem a F3b): 404 de rota e 422 — o web deste HEAD usa a pesquisa de HOJE;
 *   · novo (a base já com a F3b, depois do merge): a declaração e a página — o web usa a pesquisa nova.
 */
export async function mundoDaPesquisaNaBase(page: Page, cab: Record<string, string>): Promise<Mundo> {
  const capacidade = await capacidadeDaPesquisaNaApi(page, cab);
  const pagina = await paginaNaApi(page, cab);
  expect(pagina === "aceita", "a capacidade e o parâmetro `pagina` nascem no MESMO binário: uma resposta sem a outra é defeito")
    .toBe(capacidade === "declarada");
  const mundo: Mundo = capacidade === "declarada" ? "novo" : "legado";
  console.log(`[skew] OPERACOES-01 F3b · K-1 · a base ${capacidade === "declarada" ? "DECLARA" : "NÃO declara"} a pesquisa de produtos em `
    + `${PORTA_DAS_CAPACIDADES_DA_PESQUISA} e ${pagina === "aceita" ? "ACEITA" : "RECUSA (422)"} \`pagina\` em ${PORTA_DA_PESQUISA} → mundo ${mundo}`);
  return mundo;
}

/**
 * SENTIDO 2 — O MUNDO É O DO WEB DA BASE. A API no ar é a deste HEAD (perguntar a ela daria sempre "novo" e não diria
 * nada sobre o cliente); a pergunta vai à ÁRVORE da base montada em `.api-anterior`, no commit dela (`git grep` no
 * `HEAD`, imune a arquivo mexido no worktree): o web da base conhece a porta da capacidade
 * (`produtos/pesquisa/capacidades`)? Não → legado (a base de hoje: o texto não existe em `apps/web/src` de `622f194`,
 * conferido); sim → novo (a base já com a F3b). `git grep` sai 0 com ocorrência e 1 sem nenhuma; qualquer outra saída
 * (árvore ausente, git quebrado) é ERRO — supor o ramo fácil seria certificar o que não se mediu.
 */
export function mundoDoWebDaBaseF3b(): Mundo {
  const arvore = path.resolve(__dirname, "../../..", ".api-anterior");
  let ocorrencias = "";
  try {
    ocorrencias = execFileSync("git", ["grep", "-c", "-F", "produtos/pesquisa/capacidades", "HEAD", "--", "apps/web/src"], { cwd: arvore }).toString().trim();
  } catch (e) {
    if ((e as { status?: number }).status !== 1) throw new Error(`não foi possível medir a árvore da base em ${arvore}: ${String(e)}`);
  }
  const mundo: Mundo = ocorrencias ? "novo" : "legado";
  console.log(`[skew] OPERACOES-01 F3b · K-2 · o web da base ${ocorrencias ? "CONHECE" : "NÃO conhece"} a porta "produtos/pesquisa/capacidades" `
    + `(${ocorrencias.replace(/\n/g, ", ") || "0 ocorrências"}) → mundo ${mundo}`);
  return mundo;
}

/** SENTIDO 2 — A PREMISSA: a API no ar é a desta fase (declara a capacidade E aceita `pagina`). */
export async function premissaDaApiF3b(page: Page, cab: Record<string, string>): Promise<void> {
  expect(await capacidadeDaPesquisaNaApi(page, cab), "premissa: a API julgada é a desta fase (declara a pesquisa de produtos)").toBe("declarada");
  expect(await paginaNaApi(page, cab), "premissa: a API julgada aceita `pagina` na pesquisa").toBe("aceita");
}

export type Cadastro = { id: string; nome: string };
export type CenarioDaPesquisa = { empresa: string; tag: string; l1: Cadastro; p1: Cadastro; p2: Cadastro; p3: Cadastro };

/**
 * O cenário da pesquisa, PELA API NO AR (a da base no sentido 1, a deste HEAD no sentido 2), pelas portas de
 * `central-compras-fixtures` (a exclusão lógica roda no fim do caso, passou ou falhou): o local L1 da empresa ativa e
 * três produtos com um TAG único na descrição — P1 e P2 controlam estoque, P3 não. P1 tem 5 em L1 (estoque inicial,
 * `POST /api/stock/opening-balances`, que existe nos dois binários); P2 nasce sem saldo. Os saldos são PREMISSA lida
 * no servidor, nunca suposta. A descrição começa pelo TAG: a ordem por descrição é P1, P2, P3 nas duas pesquisas.
 */
export async function cenarioDaPesquisa(page: Page, rotulo: string): Promise<CenarioDaPesquisa> {
  const empresa = await empresaAtiva(page);
  const ref = await referenciasDoSeed(page);
  const tag = `f3bk${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const local = await criarCadastro(page, "warehouses", {
    empresa_id: empresa, initials: `K${Math.random().toString(36).slice(2, 7).toUpperCase()}`, description: `${tag} ${rotulo} local`, type: "inputs"
  });
  const lido = await api<Record<string, unknown>>(page, "GET", `/api/resources/warehouses/${local.id}`);
  expect(lido["empresa_id"], "premissa: L1 é da empresa ativa (a do documento)").toBe(empresa);
  const l1 = { id: local.id, nome: String(lido["description"]) };
  const produto = async (sufixo: string, controla: boolean): Promise<Cadastro> => {
    const { id } = await criarCadastro(page, "products", {
      description: `${tag} ${sufixo}`, group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id, control_stock: controla
    });
    const p = await api<Record<string, unknown>>(page, "GET", `/api/resources/products/${id}`);
    expect(p["control_stock"], `premissa: ${sufixo} ${controla ? "controla" : "NÃO controla"} estoque`).toBe(controla);
    return { id, nome: String(p["description"]) };
  };
  const p1 = await produto("P1", true);
  const p2 = await produto("P2", true);
  const p3 = await produto("P3", false);
  await api(page, "POST", "/api/stock/opening-balances", { empresa_id: empresa, warehouse_id: l1.id, product_id: p1.id, quantity: "5", unit_value: "3" });
  const saldo = (p: Cadastro) => api<{ quantity: string }>(page, "GET", `/api/stock/balances/${l1.id}/${p.id}`).then((s) => s.quantity);
  expect(await saldo(p1), "premissa: P1 tem 5 em L1").toBe("5.0000");
  expect(await saldo(p2), "premissa: P2 não tem saldo em L1").toBe("0.0000");
  return { empresa, tag, l1, p1, p2, p3 };
}
