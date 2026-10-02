import { test as base, expect, type Page } from "@playwright/test";
import { api } from "./helpers";
import { cabecalhosDaSessao } from "./top-config-08-comum";

/**
 * AS FIXTURES DOS SPECS DA CENTRAL DE COMPRAS (OPERACOES-01, resíduos da decisão 278): a LIMPEZA do que o caso cria e
 * os dados de referência do seed pelo NOME. Usadas por `central-compras-desenho-a/-b/-c` e `central-compras-correcoes`
 * (limpeza, seed e `codigoTop`), por `base2-vendas-documentos` (a limpeza do par produto × armazém próprio do caso que
 * confirma a venda, e o seed) e por `compras-02-receber-pedido` e `compras-03-layout` (só o `codigoTop`).
 *
 * ┌─ A LIMPEZA ────────────────────────────────────────────────────────────────────────────────────────┐
 * │ Cada caso monta os PRÓPRIOS cadastros pela API (fornecedor, cliente, armazém, produto, TOP) — nenhum │
 * │ é "o primeiro da lista". Sem limpeza, cada execução deixava no banco do E2E dezenas deles VIVOS,     │
 * │ que entram nas listas, nos seletores, no corte do menu de TOPs e no lançador de quem roda depois.    │
 * │                                                                                                      │
 * │ Quem cria pela porta daqui (`criarCadastro`, `criarTop`) deixa a exclusão registrada NA MESMA        │
 * │ chamada — não há como criar e esquecer de registrar. A exclusão roda no FIM DO CASO, na teardown de  │
 * │ uma fixture automática: é o `finally` do caso, e roda SEMPRE — caso verde, caso que falhou e caso    │
 * │ que estourou o tempo (no estouro, um `finally` dentro do corpo correria com a página já fechada).    │
 * │ Ordem INVERSA da criação: a TOP de pedido, que aponta a de compra como destino, sai antes dela. A    │
 * │ exclusão é a LÓGICA da própria API: `DELETE /api/resources/<recurso>/<id>` (os três recursos daqui   │
 * │ têm `softDelete` no registry) e, para a TOP, a porta administrativa com a revisão corrente — a mesma │
 * │ de `excluirTopE2E`. O registro é SÍNCRONO e vem logo depois do POST, antes de qualquer outra leitura │
 * │ da página: um cadastro criado nunca fica sem registro. A credencial da sessão é lida NA LIMPEZA (uma │
 * │ vez, nunca impressa) e as exclusões vão pelo contexto de requisição do Playwright; se a leitura      │
 * │ falhar, a limpeza reprova e nomeia cada cadastro que ficou vivo.                                     │
 * │                                                                                                      │
 * │ A falha da limpeza NUNCA esconde a do caso: o Playwright soma o erro da teardown aos do caso, e os   │
 * │ dois aparecem. Com o caso verde, a limpeza que falha o REPROVA — limpeza que não limpa seria um verde │
 * │ sem prova. Fail closed: criar por aqui num spec que importou o `test` de `@playwright/test` (sem a   │
 * │ fixture) REPROVA na hora — nunca nasce um cadastro que ninguém vai limpar.                           │
 * │                                                                                                      │
 * │ O QUE FICA: os DOCUMENTOS (compra, pedido de compra, venda, entrada de estoque) não se apagam — o    │
 * │ ledger é imutável (CLAUDE.md, "Dados"); ficam no banco do E2E com as referências aos cadastros       │
 * │ excluídos logicamente. A TOP que um caso cria por outra porta (`criarTopViaApi` no CX-6) continua    │
 * │ com a limpeza própria daquele caso.                                                                  │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ A REFERÊNCIA DO SEED ─────────────────────────────────────────────────────────────────────────────┐
 * │ Unidade, grupo de produto, natureza de despesa e centro de resultado não são criados pelo caso (são │
 * │ árvores com código gerado e regras próprias): vêm do seed, escolhidos pelo NOME — nunca pela posição │
 * │ na lista, que muda com o que outro spec cria. Não são tocados pela limpeza.                          │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/** Os cadastros que os specs da Central de Compras criam (todos com exclusão lógica no registry). */
export type CadastroDoCaso = "people" | "warehouses" | "products";
export type Opcao = { id: string; label: string };

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";

class LimpezaDoCaso {
  private readonly pendentes: { rotulo: string; excluir: (cabecalhos: Record<string, string>) => Promise<void> }[] = [];

  constructor(private readonly page: Page) {}

  /**
   * Síncrono de propósito: entre o POST que criou e este registro não há `await` — nenhuma leitura da página (que
   * pode lançar no meio de uma navegação) deixa um cadastro criado sem a exclusão registrada.
   */
  registrar(rotulo: string, excluir: (cabecalhos: Record<string, string>) => Promise<void>) {
    this.pendentes.push({ rotulo, excluir });
  }

  /** Uma chamada da limpeza; status fora de 2xx vira erro com o método, o caminho e o status (nunca os cabeçalhos). */
  async chamar(metodo: "GET" | "DELETE", caminho: string, cabecalhos: Record<string, string>): Promise<Record<string, unknown>> {
    const r = await this.page.request.fetch(`${API}${caminho}`, { method: metodo, headers: cabecalhos });
    const texto = await r.text();
    if (!r.ok()) throw new Error(`${r.status()} ${metodo} ${caminho}: ${texto.slice(0, 200)}`);
    return texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
  }

  /**
   * Exclui tudo, na ordem inversa; junta as falhas e só no fim reprova (uma falha não deixa as outras sem tentar).
   * A credencial da sessão é lida AQUI, uma vez, e nunca impressa; sem ela, cada cadastro pendente vira uma falha
   * com o próprio rótulo — o que ficou vivo aparece pelo nome, nunca em silêncio.
   */
  async limpar() {
    const pendentes = [...this.pendentes].reverse();
    this.pendentes.length = 0;
    if (pendentes.length === 0) return;
    const falhas: string[] = [];
    let cabecalhos: Record<string, string> | null = null;
    try { cabecalhos = await cabecalhosDaSessao(this.page); } catch (e) { falhas.push(`credencial da sessão: ${e instanceof Error ? e.message : String(e)}`); }
    for (const p of pendentes) {
      if (!cabecalhos) { falhas.push(`${p.rotulo}: não excluído (sem a credencial da sessão)`); continue; }
      try { await p.excluir(cabecalhos); } catch (e) { falhas.push(`${p.rotulo}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    expect(falhas, "a limpeza excluiu tudo o que o caso criou").toEqual([]);
  }
}

const LIMPEZAS = new WeakMap<Page, LimpezaDoCaso>();

function limpezaDe(page: Page): LimpezaDoCaso {
  const l = LIMPEZAS.get(page);
  if (!l) throw new Error("sem a limpeza do caso: importe `test` de ./central-compras-fixtures (a fixture registra a limpeza da página)");
  return l;
}

/** O `test` dos specs da Central de Compras: o de sempre, mais a limpeza automática no fim de cada caso. */
export const test = base.extend<{ limpezaDoCaso: void }>({
  limpezaDoCaso: [async ({ page }, use) => {
    const l = new LimpezaDoCaso(page);
    LIMPEZAS.set(page, l);
    await use();
    LIMPEZAS.delete(page);
    await l.limpar();
  }, { auto: true }]
});
export { expect };

/** Cria um cadastro pela porta oficial (`POST /api/resources/<recurso>`) e deixa a exclusão lógica registrada. */
export async function criarCadastro(page: Page, recurso: CadastroDoCaso, corpo: Record<string, unknown>): Promise<{ id: string }> {
  const l = limpezaDe(page);
  const criado = await api<{ id: string }>(page, "POST", `/api/resources/${recurso}`, corpo);
  expect(criado.id, `premissa: o cadastro ${recurso} foi criado`).toBeTruthy();
  l.registrar(`${recurso} ${criado.id}`, async (cab) => { await l.chamar("DELETE", `/api/resources/${recurso}/${criado.id}`, cab); });
  return criado;
}

/** Cria uma TOP pela porta administrativa e deixa a exclusão lógica registrada (com a revisão lida no fim). */
export async function criarTop(page: Page, corpo: Record<string, unknown>): Promise<{ id: string }> {
  const l = limpezaDe(page);
  const criada = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", corpo);
  expect(criada.id, "premissa: a TOP foi criada").toBeTruthy();
  l.registrar(`TOP ${criada.id}`, async (cab) => {
    const caminho = `/api/admin/tipos-operacao/${criada.id}`;
    const { revisao } = await l.chamar("GET", caminho, cab);
    if (typeof revisao !== "number") throw new Error(`GET ${caminho} sem a revisão corrente`);
    await l.chamar("DELETE", `${caminho}?revisao=${revisao}`, cab);
  });
  return criada;
}

/** Código de TOP único por execução: tempo E sorteio (só o tempo colide entre casos do mesmo milissegundo; só o sorteio, entre execuções). */
export const codigoTop = (prefixo: string) => `${prefixo}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Um item de referência do seed pelo NOME. Fail closed: o nome tem de casar com UM item só — nenhum é premissa
 * quebrada, e mais de um é ambíguo (seria "o primeiro que casou", a mesma escolha pela posição que isto evita);
 * a falha mostra os rótulos que casaram.
 */
export async function doSeed(page: Page, rota: string, nome: string): Promise<Opcao> {
  const opcoes = await api<Opcao[]>(page, "GET", rota);
  const achadas = opcoes.filter((o) => o.label.includes(nome));
  expect(achadas.map((o) => o.label), `premissa: o seed tem UM só item com "${nome}" em ${rota} (nenhum falta; mais de um é ambíguo)`).toHaveLength(1);
  return achadas[0]!;
}

/** A referência do seed que os specs usam: unidade UN, grupo analítico, natureza de despesa analítica, centro analítico. */
export async function referenciasDoSeed(page: Page) {
  const unidade = (await api<Opcao[]>(page, "GET", "/api/resources/measurement_units/options")).find((u) => u.label.toUpperCase() === "UN");
  expect(unidade, "premissa: o seed tem a unidade UN").toBeTruthy();
  return {
    unidade: unidade!,
    grupo: await doSeed(page, "/api/resources/product_groups/options?kind=analytic", "Fertilizantes"),
    natureza: await doSeed(page, "/api/resources/financial_categories/options?kind=analytic&nature=expense", "Nutrição Animal"),
    centro: await doSeed(page, "/api/resources/cost_centers/options?kind=analytic", "Adm Geral")
  };
}
