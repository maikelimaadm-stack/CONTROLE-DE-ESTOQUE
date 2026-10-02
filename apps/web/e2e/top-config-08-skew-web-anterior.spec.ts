import { test, expect, type Page } from "@playwright/test";
import {
  configuracaoNeutraTop, configuracaoNeutraTopV2, configuracaoNeutraTopV3, configuracaoNeutraTopV4,
  type ConfiguracaoTipoOperacao
} from "@agro/domain";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { login, api, uniq, empresaAtiva, primeiroId } from "./helpers";
import { cadastroDeEstoque, hojeISO, saldoNoServidor } from "./estoque-01-comum";

/**
 * TOP-CONFIG-08 · K-2, SENTIDO 2 — O WEB DA BASE CONTRA A API DESTE HEAD (decisão 277; a janela "API antes do web" da
 * DEPLOYMENT).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 2 roda em `playwright.skew-web-anterior.config.ts`, cujo `testMatch` é
 * `/skew-web-anterior\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o `playwright.config.ts` comum
 * ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (lá o web seria o deste HEAD, e o caso não mediria
 * o cliente anterior). O caso não foi acrescentado em `skew-web-anterior.spec.ts` porque aquele arquivo é de outra PR
 * aberta (a da Central de Compras): editar o mesmo arquivo seria colisão (PRE-PR-02). Sem `scripts/lib` e sem passo no
 * CI: o arquivo entra pelo nome. A identidade do bundle da base é a do caso IDENTIDADE de `skew-web-anterior.spec.ts`.
 *
 * O QUE SE MEDE. A API desta fatia só ACRESCENTA para o formato 1, 2 e 3: as rotas, os corpos e as respostas de hoje não
 * mudam, chave por chave. O navegador roda o bundle EXATO da base, e:
 *   · o EDITOR ANTERIOR grava o formato 3 como hoje, e a API nova aceita (ele ignora o bloco `regrasGerais`);
 *   · POST e confirmar com TOP de formato 1 a 3 — mesmo com Automática, Permitido e "Sempre" DECLARADOS, como as TOPs de
 *     produção — dão o corpo de hoje: sem `confirmacaoAutomatica`, documento aberto, confirmação sem recusa de
 *     aprovação, e a prévia do estoque sem `recusas`; a Central de Estoque anterior confirma por esse corpo;
 *   · DECLARADO (observado, sem reprovar pelo que a tela anterior faz): diante de uma recusa de aprovação (TOP de estoque
 *     no formato 4 com "Sempre"), a Central de Estoque anterior não conhece `recusas`, lê `podeConfirmar: false` sem item
 *     faltando como incoerente, mostra "prévia indisponível" e deixa clicar; quem segura é o servidor, com o 409.
 *
 * O MUNDO, NESTE SENTIDO, É O DO WEB DA BASE. A API que está no ar é a deste HEAD — perguntar a ela daria sempre "novo" e
 * não diria nada sobre o cliente. A pergunta vai à ÁRVORE DA BASE montada em `.api-anterior` (a mesma cuja identidade o
 * caso IDENTIDADE prova), no commit dela: o web da base conhece o diálogo "Estas regras passam a valer"
 * (`top-regras-passam-a-valer`, o testId fixo da seção 8)? Não → mundo legado (a base de hoje): o editor anterior grava o
 * 3. Sim → mundo novo (a base já com a fatia): o editor anterior é o desta fatia, e grava o 4 com o diálogo. A API deste
 * HEAD entra como PREMISSA: ela declara o bloco e serve a fila — é ela que está sendo julgada.
 *
 * OPERACOES-01 F4 (decisão 281): um TERCEIRO mundo, medido do mesmo jeito — o web da base conhece também o ASSISTENTE da
 * TOP (`top-assistente`, o testId fixo do passo 1, que só existe no editor do formato 5)? Sim → mundo formato5: o editor
 * anterior é o do 5, lê a TOP como 5, pergunta pelo MESMO diálogo e grava o 5. O K-2 do 5 propriamente dito mora em
 * `top-formato5-skew-web-anterior.spec.ts`; aqui o mundo só decide o formato que o editor da base envia.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
const ROTA_TOPS = "/configuracoes?tab=operacoes&sub=tipos-operacao";
const MENSAGEM_APROVACAO_PENDENTE = "Este documento precisa de aprovação antes de ser confirmado.";

type Mundo = "legado" | "novo" | "formato5";
type DetalheTop = { versao: number; configuracaoSchema: number; configuracao: { valor: { geral: { confirmacao: string } } } };
type Erro = { error: { code: string; message: string } };

/**
 * O WEB DA BASE CONHECE O BLOCO? Medido no commit da árvore montada (`git grep` no `HEAD` de `.api-anterior`, imune a
 * arquivo mexido no worktree). `git grep` sai 0 com ocorrência e 1 sem nenhuma; qualquer outra saída (árvore ausente,
 * git quebrado) é ERRO — supor o ramo fácil seria certificar o que não se mediu.
 */
function mundoDoWebDaBase(): Mundo {
  const arvore = path.resolve(__dirname, "../../..", ".api-anterior");
  const contar = (marca: string): string => {
    try {
      return execFileSync("git", ["grep", "-c", "-F", marca, "HEAD", "--", "apps/web/src"], { cwd: arvore }).toString().trim();
    } catch (e) {
      if ((e as { status?: number }).status !== 1) throw new Error(`não foi possível medir a árvore da base em ${arvore}: ${String(e)}`);
      return "";
    }
  };
  const ocorrencias = contar("top-regras-passam-a-valer");
  // O assistente (editor do 5) só conta no mundo que já tem o diálogo: o editor do 5 é o do 4 mais o passo 1.
  const assistente = ocorrencias ? contar("top-assistente") : "";
  const mundo: Mundo = !ocorrencias ? "legado" : assistente ? "formato5" : "novo";
  console.log(`[skew] TOP-CONFIG-08 · K-2 · o web da base ${ocorrencias ? "CONHECE" : "NÃO conhece"} o diálogo das regras gerais (${ocorrencias.replace(/\n/g, ", ") || "0 ocorrências"}) e ${assistente ? "CONHECE" : "NÃO conhece"} o assistente da TOP (${assistente.replace(/\n/g, ", ") || "0 ocorrências"}) → mundo ${mundo}`);
  return mundo;
}

/** Cabeçalhos da sessão gravada pelo web da base depois do login, para falar com a API deste HEAD direto. */
async function cabecalhosDaSessao(page: Page): Promise<Record<string, string>> {
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token?: string; orgId?: string });
  return { authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}) };
}

/** A PREMISSA: a API no ar é a desta fatia — declara o bloco do formato 4 e serve a fila de aprovação. */
async function premissaDaApi(page: Page, cab: Record<string, string>) {
  const cap = await page.request.get(`${API}/api/admin/tipos-operacao/capabilities`, { headers: cab });
  expect(cap.status(), "premissa: a API serve as capacidades da administração de TOP").toBe(200);
  const capacidades = await cap.json() as { contractVersion?: number; restricoes?: unknown; regrasGerais?: unknown };
  expect(capacidades.contractVersion, "o contrato que o web anterior lê continua o 1").toBe(1);
  expect(capacidades.restricoes, "e o bloco do formato 3 continua lá, igual").toMatchObject({ suportado: true, versaoSchema: 3 });
  expect(capacidades.regrasGerais, "premissa: a API julgada é a desta fatia (bloco do formato 4)").toMatchObject({ suportado: true, versaoSchema: 4 });
  expect((await page.request.get(`${API}/api/aprovacoes/vendas?page=1&pageSize=1`, { headers: cab })).status(), "premissa: e serve a fila").toBe(200);
}

/** Vigia do navegador (o desenho de `skew-web-anterior.spec.ts`): CORS morto e erro de contrato não passam calados. */
function vigiar(page: Page) {
  const falhas: string[] = []; const respostas: { url: string; status: number }[] = [];
  page.on("requestfailed", (r) => { if (r.url().includes(API)) falhas.push(`${r.url()} → ${r.failure()?.errorText ?? "?"}`); });
  page.on("console", (m) => { if (m.type() === "error" && /CORS|preflight|Access-Control/i.test(m.text())) falhas.push(`console: ${m.text()}`); });
  page.on("response", (r) => { if (r.url().includes("/api/")) respostas.push({ url: r.url(), status: r.status() }); });
  return {
    semBloqueio: () => expect(falhas, "nenhuma requisição do cliente em produção pode morrer no navegador").toEqual([]),
    semErroDeContrato: () => {
      const ruins = respostas.filter((r) => r.status === 404 || r.status === 422 || r.status >= 500);
      expect(ruins, `o cliente em produção não pode receber erro de contrato da API nova: ${JSON.stringify(ruins)}`).toEqual([]);
    }
  };
}

const codigoNovo = (prefixo: string) => `${prefixo}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.toUpperCase();
const detalheTop = (page: Page, id: string) => api<DetalheTop>(page, "GET", `/api/admin/tipos-operacao/${id}`);
const chaves = (o: object) => Object.keys(o).sort();

/**
 * AS QUATRO REGRAS GERAIS DECLARADAS FORA DO NEUTRO — o que as TOPs de produção têm (Automática, Permitido, Permitida) e
 * mais "Sempre". No formato 1 a 3 nada disso executa: é o corte da decisão 277, e é ele que este arquivo cobra no fio.
 */
function comRegrasDeclaradas<C extends ConfiguracaoTipoOperacao>(c: C): C {
  return {
    ...c,
    geral: { ...c.geral, confirmacao: "automatica", documentoSemItens: "permitido", alteracaoAposConfirmacao: "permitida" },
    aprovacao: { ...c.aprovacao, politica: "sempre", valorMinimo: null }
  };
}
const FORMATOS = [
  { formato: 1, configuracao: () => comRegrasDeclaradas(configuracaoNeutraTop()) },
  { formato: 2, configuracao: () => comRegrasDeclaradas(configuracaoNeutraTopV2()) },
  { formato: 3, configuracao: () => comRegrasDeclaradas(configuracaoNeutraTopV3()) }
] as const;

/** Uma TOP criada pela API deste HEAD, com a configuração dada; o formato GRAVADO é conferido no servidor. */
async function criarTop(page: Page, codigoBase: string, configuracao: ConfiguracaoTipoOperacao | undefined, formatoEsperado: number): Promise<string> {
  const top = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", {
    codigo: codigoNovo("K2"), codigoBase, nome: uniq(`K-2 ${codigoBase} f${formatoEsperado}`), ...(configuracao ? { configuracao } : {})
  });
  expect((await detalheTop(page, top.id)).configuracaoSchema, `premissa: ${codigoBase} gravada no formato ${formatoEsperado}`).toBe(formatoEsperado);
  return top.id;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K-2 · O EDITOR ANTERIOR
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("TOP-CONFIG-08 · K-2 (sentido 2) — o editor da TOP do web da base contra a API deste HEAD: grava o formato 3 como hoje, e a API nova aceita (ou, com a base já na fatia, o diálogo e o formato 4)", async ({ page }) => {
  const mundo = mundoDoWebDaBase();
  await login(page);
  await premissaDaApi(page, await cabecalhosDaSessao(page));
  const codigo = codigoNovo("K2E");
  const top = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase: "vendas.venda", nome: uniq("K-2 editor") });
  const antes = await detalheTop(page, top.id);
  expect(antes.configuracaoSchema, "premissa: sem configuração no corpo, a API grava o formato 2 (como hoje)").toBe(2);

  const v = vigiar(page);
  await page.goto(ROTA_TOPS);
  await expect(page.getByRole("heading", { name: "Tipos de Operação" })).toBeVisible();
  await page.getByLabel("Buscar tipo de operação").fill(codigo);
  const linha = page.getByRole("row").filter({ hasText: codigo });
  await expect(linha, "a busca recorta para exatamente a TOP do caso").toHaveCount(1);
  await linha.getByRole("button", { name: "Mais opções" }).click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const forma = page.getByTestId("form-tipo-operacao");
  await expect(forma).toBeVisible();

  const corpos: { configuracao?: { versaoSchema?: number; geral?: { confirmacao?: string } } }[] = [];
  page.on("request", (r) => { if (r.method() === "PUT" && r.url().includes(`/api/admin/tipos-operacao/${top.id}`)) corpos.push(r.postDataJSON()); });
  await forma.getByTestId("top-aba-geral").click();
  await forma.getByTestId("top-campo-geral-confirmacao").selectOption("automatica");
  const resposta = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(`/api/admin/tipos-operacao/${top.id}`));
  await forma.getByTestId("top-salvar").click();
  const dialogoDasRegras = page.getByTestId("top-regras-passam-a-valer");
  if (mundo !== "legado") {
    await expect(dialogoDasRegras, `o editor da base, já na fatia, pergunta antes de gravar o formato ${mundo === "formato5" ? 5 : 4}`).toBeVisible();
    await dialogoDasRegras.getByTestId("top-regras-salvar").click();
  }
  expect((await resposta).status(), "a API deste HEAD aceita o que o editor anterior enviou").toBe(200);
  expect(corpos, "uma gravação").toHaveLength(1);
  const formato = mundo === "formato5" ? 5 : mundo === "novo" ? 4 : 3;
  expect(corpos[0]!.configuracao?.versaoSchema, `o editor anterior gravou o formato ${formato}`).toBe(formato);
  expect(corpos[0]!.configuracao?.geral?.confirmacao).toBe("automatica");
  if (mundo === "legado") await expect(dialogoDasRegras, "o web de hoje não tem o diálogo das regras").toHaveCount(0);
  const depois = await detalheTop(page, top.id);
  expect([depois.versao, depois.configuracaoSchema, depois.configuracao.valor.geral.confirmacao],
    "a API criou a versão nova no formato enviado — nunca o promoveu nem rebaixou").toEqual([antes.versao + 1, formato, "automatica"]);
  v.semBloqueio();
  v.semErroDeContrato();
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K-2 · FORMATO 1 A 3: O CORPO DE HOJE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("TOP-CONFIG-08 · K-2 (sentido 2) — com TOP de formato 1 a 3 (regras gerais e aprovação DECLARADAS), POST e confirmar de venda, compra e estoque dão o corpo de hoje: sem `confirmacaoAutomatica`, aberto, sem recusa de aprovação; e a Central de Estoque anterior confirma pela prévia sem `recusas`", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  await premissaDaApi(page, cab);
  const empresa = await empresaAtiva(page);
  const cliente = await primeiroId(page, "/api/resources/people?is_client=true&pageSize=1");
  const fornecedor = await primeiroId(page, "/api/resources/people?is_provider=true&pageSize=1");
  const produtoDoSeed = await primeiroId(page, "/api/resources/products?pageSize=1");
  const naturezas = await api<{ id: string }[]>(page, "GET", "/api/resources/financial_categories/options?kind=analytic&nature=expense");
  const centros = await api<{ id: string }[]>(page, "GET", "/api/resources/cost_centers/options?kind=analytic");
  expect(naturezas.length && centros.length, "premissa: há natureza de despesa e centro analíticos (a compra gera conta a pagar)").toBeTruthy();
  const c = await cadastroDeEstoque(page);

  // ── VENDA. A referência do "corpo de hoje" é a venda SEM TOP, que esta fatia não toca: as chaves têm de ser as mesmas.
  const corpoVenda = (top?: string) => ({
    empresa_id: empresa, document_date: hojeISO(), client_id: cliente, ...(top ? { tipo_operacao_id: top } : {}),
    items: [{ product_id: produtoDoSeed, warehouse_id: null, quantity: "1", unit_price: "10.00" }]
  });
  const semTop = await api<Record<string, unknown>>(page, "POST", "/api/sales/sales", corpoVenda());
  expect(semTop, "premissa: a resposta de hoje não tem a chave nova").not.toHaveProperty("confirmacaoAutomatica");
  for (const f of FORMATOS) {
    const top = await criarTop(page, "vendas.venda", f.configuracao(), f.formato);
    const venda = await api<Record<string, unknown> & { id: string }>(page, "POST", "/api/sales/sales", corpoVenda(top));
    expect(chaves(venda), `venda, formato ${f.formato}: as chaves da resposta são as de hoje (as da venda sem TOP)`).toEqual(chaves(semTop));
    expect((await api<{ status: string }>(page, "GET", `/api/sales/sales/${venda.id}`)).status, `venda, formato ${f.formato}: "Automática" declarada não confirma`).toBe("open");
    const confirmada = await api<Record<string, unknown>>(page, "POST", `/api/sales/sales/${venda.id}/confirm`, {});
    expect(chaves(confirmada), `venda, formato ${f.formato}: a confirmação responde o corpo de hoje`).toEqual(["id", "status", "title_ids"]);
    expect(confirmada["status"], `venda, formato ${f.formato}: "Sempre" declarado não retém a confirmação`).toBe("confirmed");
  }

  // ── COMPRA. A referência é a compra com a TOP neutra do formato 2 (o que a API grava sem configuração).
  const corpoCompra = (top: string) => ({
    empresa_id: empresa, tipo_operacao_id: top, fornecedor_id: fornecedor, data_documento: hojeISO(),
    categoria_financeira_id: naturezas[0]!.id, centro_custo_id: centros[0]!.id,
    itens: [{ produto_id: c.produto, armazem_id: c.armazem, quantidade: "1", valor_unitario: "10.00" }]
  });
  const referenciaCompra = await api<Record<string, unknown>>(page, "POST", "/api/compras/compras", corpoCompra(await criarTop(page, "compras.compra", undefined, 2)));
  expect(referenciaCompra, "premissa: a compra de hoje nasce aberta e sem a chave nova").toMatchObject({ situacao: "aberto" });
  expect(referenciaCompra).not.toHaveProperty("confirmacaoAutomatica");
  for (const f of FORMATOS) {
    const top = await criarTop(page, "compras.compra", f.configuracao(), f.formato);
    const compra = await api<Record<string, unknown> & { id: string; situacao: string }>(page, "POST", "/api/compras/compras", corpoCompra(top));
    expect(chaves(compra), `compra, formato ${f.formato}: as chaves de hoje`).toEqual(chaves(referenciaCompra));
    expect(compra.situacao, `compra, formato ${f.formato}: "Automática" declarada não confirma`).toBe("aberto");
    const confirmada = await api<Record<string, unknown>>(page, "POST", `/api/compras/compras/${compra.id}/confirm`, {});
    expect(chaves(confirmada), `compra, formato ${f.formato}: a confirmação responde o corpo de hoje`).toEqual(["id", "movimento_ids", "situacao", "titulo_ids"]);
    expect(confirmada["situacao"], `compra, formato ${f.formato}: "Sempre" declarado não retém a confirmação`).toBe("confirmado");
  }

  // ── ESTOQUE (entrada). A prévia de hoje tem exatamente quatro chaves; `recusas` só existe no formato 4.
  const corpoEntrada = (top: string) => ({
    empresa_id: c.empresa, tipo_operacao_id: top, armazem_id: c.armazem, data_documento: hojeISO(),
    itens: [{ produto_id: c.produto, quantidade: "2", custo_unitario: "10" }]
  });
  const entradas: { id: string; formato: number }[] = [];
  for (const f of FORMATOS) {
    const top = await criarTop(page, "estoque.entrada", f.configuracao(), f.formato);
    const doc = await api<Record<string, unknown> & { id: string; situacao: string }>(page, "POST", "/api/estoque/entradas", corpoEntrada(top));
    expect(doc, `entrada, formato ${f.formato}: sem a chave nova`).not.toHaveProperty("confirmacaoAutomatica");
    expect(doc.situacao, `entrada, formato ${f.formato}: "Automática" declarada não confirma`).toBe("aberto");
    const previa = await api<Record<string, unknown>>(page, "GET", `/api/estoque/entradas/${doc.id}/previa-confirmacao`);
    expect(chaves(previa), `entrada, formato ${f.formato}: a prévia de hoje, sem \`recusas\``).toEqual(["contractVersion", "documento", "itens", "podeConfirmar"]);
    expect(previa["podeConfirmar"], `entrada, formato ${f.formato}: "Sempre" declarado não retém`).toBe(true);
    entradas.push({ id: doc.id, formato: f.formato });
  }
  // Os de formato 1 e 2 confirmam pela API; o de formato 3 pela CENTRAL DE ESTOQUE ANTERIOR, lendo o corpo de hoje.
  for (const d of entradas.slice(0, -1)) {
    const confirmado = await api<Record<string, unknown>>(page, "POST", `/api/estoque/entradas/${d.id}/confirmar`, {});
    expect(chaves(confirmado), `entrada, formato ${d.formato}: a confirmação responde o corpo de hoje`).toEqual(["id", "movimentos", "situacao"]);
    expect(confirmado["situacao"]).toBe("confirmado");
  }
  const pelaTela = entradas[entradas.length - 1]!;
  const v = vigiar(page);
  const confirmacaoNoFio = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/api/estoque/entradas/${pelaTela.id}/confirmar`));
  await page.goto(`/estoque/movimentacoes/entradas/${pelaTela.id}`);
  const central = page.getByTestId("estoque-central");
  await expect(central, "a Central de Estoque anterior abre a consulta").toHaveAttribute("data-situacao", "aberto");
  await page.getByTestId("estoque-confirmar").click();
  await expect(page.getByTestId("estoque-previa-corpo"), "a prévia de hoje é lida como PRONTA pelo web anterior").toHaveAttribute("data-situacao", "pronta");
  await expect(page.getByTestId("estoque-previa-item")).toHaveCount(1);
  await expect(page.getByTestId("estoque-previa-confirmar")).toBeEnabled();
  await page.getByTestId("estoque-previa-confirmar").click();
  const r = await confirmacaoNoFio;
  expect(r.status(), "a API deste HEAD confirma pelo clique do web anterior").toBe(200);
  expect(chaves(await r.json() as object), `entrada, formato ${pelaTela.formato}: o corpo de hoje no fio do web anterior`).toEqual(["id", "movimentos", "situacao"]);
  await expect(central, "e a tela anterior mostra o documento confirmado").toHaveAttribute("data-situacao", "confirmado");
  v.semBloqueio();
  v.semErroDeContrato();
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K-2 · DECLARADO: A CENTRAL DE ESTOQUE ANTERIOR DIANTE DE UMA RECUSA DE APROVAÇÃO
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("TOP-CONFIG-08 · K-2 (sentido 2) — DECLARADO: diante de uma recusa de aprovação (estoque, formato 4, \"Sempre\"), o que a Central de Estoque da base mostra é OBSERVADO e registrado; o servidor responde 409 APROVACAO_PENDENTE à confirmação, e nada se move", async ({ page }) => {
  const mundo = mundoDoWebDaBase();
  await login(page);
  const cab = await cabecalhosDaSessao(page);
  await premissaDaApi(page, cab);

  const configuracao = { ...configuracaoNeutraTopV4(), aprovacao: { politica: "sempre" as const, valorMinimo: null, momento: "antes_da_confirmacao" as const } };
  const top = await criarTop(page, "estoque.entrada", configuracao, 4);
  const c = await cadastroDeEstoque(page);
  const doc = await api<Record<string, unknown> & { id: string; situacao: string }>(page, "POST", "/api/estoque/entradas", {
    empresa_id: c.empresa, tipo_operacao_id: top, armazem_id: c.armazem, data_documento: hojeISO(),
    itens: [{ produto_id: c.produto, quantidade: "4", custo_unitario: "10" }]
  });
  expect(doc.situacao, "premissa: o documento nasce aberto").toBe("aberto");
  expect(doc, "premissa: Confirmação Manual, sem a chave da automática").not.toHaveProperty("confirmacaoAutomatica");
  // A RECUSA, dita pelo servidor antes da tela: `podeConfirmar` falso sem item faltando, com a recusa da aprovação.
  const previa = await api<{ podeConfirmar: boolean; recusas?: { code: string; message: string }[]; itens: { insuficiente: boolean }[] }>(
    page, "GET", `/api/estoque/entradas/${doc.id}/previa-confirmacao`);
  expect(previa.podeConfirmar, "premissa: a API deste HEAD recusa na prévia").toBe(false);
  expect(previa.itens.some((i) => i.insuficiente), "premissa: nenhum item falta (é uma entrada)").toBe(false);
  expect(previa.recusas?.map((x) => [x.code, x.message]), "premissa: a recusa é a da aprovação").toEqual([["APROVACAO_PENDENTE", MENSAGEM_APROVACAO_PENDENTE]]);

  const v = vigiar(page);
  await page.goto(`/estoque/movimentacoes/entradas/${doc.id}`);
  const central = page.getByTestId("estoque-central");
  await expect(central, "a Central de Estoque anterior abre a consulta").toHaveAttribute("data-situacao", "aberto");
  await page.getByTestId("estoque-confirmar").click();
  const corpo = page.getByTestId("estoque-previa-corpo");
  await expect(page.getByTestId("estoque-previa")).toBeVisible();
  await expect(corpo, "a prévia terminou de carregar").not.toHaveAttribute("data-situacao", "carregando");
  const situacaoDaPrevia = await corpo.getAttribute("data-situacao");
  const botao = page.getByTestId("estoque-previa-confirmar");
  const deixaClicar = await botao.isEnabled();

  // A CONFIRMAÇÃO: pelo clique, se a tela anterior deixa; senão, pela API — o servidor é quem responde nos dois casos.
  let status: number; let erro: Erro["error"];
  if (deixaClicar) {
    const noFio = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/api/estoque/entradas/${doc.id}/confirmar`));
    await botao.click();
    const r = await noFio;
    status = r.status(); erro = (await r.json() as Erro).error;
  } else {
    const r = await page.request.post(`${API}/api/estoque/entradas/${doc.id}/confirmar`, { headers: cab, data: {} });
    status = r.status(); erro = (await r.json() as Erro).error;
  }
  const declarado = `a Central de Estoque da base (mundo ${mundo}) mostrou a prévia como "${situacaoDaPrevia}" e ${deixaClicar ? "DEIXOU" : "NÃO deixou"} clicar em Confirmar; `
    + `o servidor respondeu ${status} ${erro?.code ?? "?"} à confirmação${deixaClicar ? " pedida pelo clique" : " pedida direto à API"}`;
  console.log(`[skew] TOP-CONFIG-08 · K-2 · DECLARADO: ${declarado}`);
  test.info().annotations.push({ type: "declarado", description: declarado });

  // O fio da TELA, conferido antes das leituras de conferência abaixo (que passam pelo mesmo navegador): nenhuma
  // requisição morreu e nenhuma resposta foi erro de contrato — o 409 é a recusa do servidor, não um contrato quebrado.
  v.semBloqueio();
  v.semErroDeContrato();

  // O QUE SE COBRA É O SERVIDOR: a recusa com o código e a mensagem dele, e nada mexido.
  expect(status, "o servidor responde 409 à confirmação sem aprovação").toBe(409);
  expect([erro.code, erro.message], "com o código e a mensagem da aprovação pendente").toEqual(["APROVACAO_PENDENTE", MENSAGEM_APROVACAO_PENDENTE]);
  const lido = await api<{ situacao: string; movimentos: unknown[] }>(page, "GET", `/api/estoque/entradas/${doc.id}`);
  expect([lido.situacao, lido.movimentos.length], "o documento continua aberto e sem movimento").toEqual(["aberto", 0]);
  expect(Number((await saldoNoServidor(page, c.armazem, c.produto)).quantity), "o saldo do produto novo não se moveu").toBe(0);
});
