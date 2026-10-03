import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Locator, Page, Request } from "@playwright/test";
import { MODULOS_COM_TOP, type ModuloComTop } from "@agro/domain";
import { api, empresaAtiva, login } from "./helpers";
import { test, expect, criarCadastro, doSeed, referenciasDoSeed } from "./central-compras-fixtures";
import { MSG_ROTA_NAO_ENCONTRADA, vigiar, type Mundo } from "./operacoes-01-f2-skew-comum";
import { portaDaCapacidadeDoModulo, saldoInicial, tiposDoModulo } from "./f10-comum";

/**
 * OPERACOES-01 · F10 (decisão 287) · K-1, SENTIDO 1 — O WEB DESTE HEAD CONTRA A API DA BASE (a janela "web antes da
 * API" da DEPLOYMENT, e a reversão só da API), na FROTA: as Centrais do abastecimento, da manutenção e da OS.
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 1 roda em `playwright.skew.config.ts`, cujo `testMatch` é
 * `/skew-api-producao\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o `playwright.config.ts`
 * comum ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (lá a API seria a deste HEAD e o caso
 * ficaria verde por vacuidade). Arquivo próprio: não colide com as fases que correm em paralelo.
 *
 * O MUNDO É PERGUNTADO À BASE NA HORA, por dois caminhos que têm de concordar: a API no ar (`GET /api/modulos/<segmento>/
 * operation-types` dos três módulos da frota) e o FONTE da API da base em `.api-anterior` (a marca `/modulos/` em
 * `apps/api/src`, por `git grep` no HEAD daquela árvore). Os dois ramos cobram prova POSITIVA:
 *   · MUNDO LEGADO (a base de hoje, sem a F10): a pergunta da capacidade que a PRÓPRIA tela faz recebe, no fio, a 404 de
 *     ROTA; as Centrais não desenham "Tipo de operação" (nem a "Observação" da manutenção); os POST levam as chaves de
 *     HOJE, chave por chave (sem `tipo_operacao_id`, sem `note` na manutenção) e a base grava (201) com as chaves de
 *     resposta de hoje; a edição da OS vai pelo PUT que a base já tem (200, `{ id }`);
 *   · MUNDO NOVO (a base já com a F10, depois do merge): a capacidade declarada, o campo "Tipo de operação" e as chaves
 *     a mais (`tipo_operacao_id`; `note` na manutenção); a resposta continua com as chaves de hoje.
 * Em todos: nenhum pedido a `/api/modulos/*` além da pergunta da capacidade da tela, e nenhuma requisição morre no
 * navegador (`semBloqueio`). Não há mock: o servidor é o binário da base, servindo o banco migrado e semeado por este
 * HEAD. Os cadastros (local e produto) e o saldo nascem PELA API DA BASE (as portas de `central-compras-fixtures`, com a
 * exclusão lógica no fim do caso, passou ou falhou); os equipamentos e a pessoa são os do seed, pelo NOME. Os
 * lançamentos ficam (o razão é imutável).
 */

const MODULOS_DA_FROTA: readonly ModuloComTop[] = MODULOS_COM_TOP.filter((m) => m === "abastecimento" || m === "manutencao" || m === "ordem_servico");
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const chaves = (o: unknown) => Object.keys(o as Record<string, unknown>).sort();
const caminho = (r: Request) => new URL(r.url()).pathname;

/** As chaves dos POST de HOJE (o contrato da base), conjunto EXATO. */
const CHAVES_DO_ABASTECIMENTO = ["cost_center_id", "empresa_id", "equipment_id", "harvest_id", "hour_meter", "mileage", "note", "operator_person_id", "origin", "product_id", "quantity", "supply_date", "unit_value", "warehouse_id"];
const CHAVES_DA_MANUTENCAO = ["empresa_id", "harvest_id", "machines", "maintenance_date"];
const CHAVES_DA_OS = ["activity_id", "cost_center_id", "description", "empresa_id", "harvest_id", "lines", "operation_id", "order_date", "planned_end", "planned_start", "responsible_person_id", "team_id"];

/** O fonte da API da BASE (`.api-anterior`, no HEAD daquela árvore) tem a marca `/modulos/`? Erro de leitura reprova. */
function fonteDaBaseTemModulos(): boolean {
  const arvore = path.resolve(__dirname, "../../..", ".api-anterior");
  try {
    execFileSync("git", ["grep", "-q", "-F", "/modulos/", "HEAD", "--", "apps/api/src"], { cwd: arvore, stdio: "pipe" });
    return true;
  } catch (e) {
    if ((e as { status?: number }).status === 1) return false;
    throw new Error(`não foi possível medir a árvore da base em ${arvore}: ${String(e)}`);
  }
}

/** O mundo da base: a API no ar (os três módulos, a MESMA resposta) e o fonte dela têm de concordar. */
async function mundoDaFrotaNaBase(page: Page): Promise<Mundo> {
  const respostas = await Promise.all(MODULOS_DA_FROTA.map((m) => tiposDoModulo(page, m)));
  const lidas = respostas.map((r, i) => {
    if (r.status === 404) {
      expect((r.corpo as unknown as { error?: unknown }).error, `${MODULOS_DA_FROTA[i]}: a 404 é a de ROTA (a base não tem a porta)`).toEqual({ code: "NOT_FOUND", message: MSG_ROTA_NAO_ENCONTRADA });
      return "legado" as const;
    }
    expect([r.status, r.corpo.capacidades], `${MODULOS_DA_FROTA[i]}: fora da 404 de rota, só a capacidade declarada`).toEqual([200, { topNoModulo: 1 }]);
    return "novo" as const;
  });
  expect(new Set(lidas).size, "as três portas da frota nascem no MESMO binário").toBe(1);
  const mundo = lidas[0]!;
  const fonte = fonteDaBaseTemModulos();
  expect(fonte, "o fonte da API da base concorda com a API no ar (a marca `/modulos/`)").toBe(mundo === "novo");
  console.log(`[skew] OPERACOES-01 F10 · K-1 · a base ${mundo === "novo" ? "DECLARA" : "NÃO declara"} /api/modulos/{abastecimento,manutencao,ordem-servico}/operation-types e o fonte ${fonte ? "TEM" : "NÃO tem"} a marca → mundo ${mundo}`);
  return mundo;
}

/**
 * Todo pedido da tela a `/api/modulos/*` (método e caminho), para provar que só a pergunta da capacidade sai. A conta é
 * por CAMINHO, não por vez: o Salvar do motor invalida as consultas da tela antes de navegar, e a pergunta, ainda
 * montada, sai de novo — a mesma porta (o que se proíbe é qualquer OUTRA rota de `/api/modulos/*` na base).
 */
function ouvirModulos(page: Page): string[] {
  const vistos: string[] = [];
  page.on("request", (r) => { if (caminho(r).startsWith("/api/modulos/")) vistos.push(`${r.method()} ${caminho(r)}`); });
  return vistos;
}

/** O cenário pela API DA BASE: um local da empresa ativa e um produto com saldo nele; o equipamento e a pessoa do seed. */
async function cenario(page: Page) {
  const empresa = await empresaAtiva(page);
  const ref = await referenciasDoSeed(page);
  const tag = `f10k1${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const { id: local } = await criarCadastro(page, "warehouses", { empresa_id: empresa, initials: `K${Math.random().toString(36).slice(2, 7).toUpperCase()}`, description: `${tag} local`, type: "inputs" });
  const { id: produto } = await criarCadastro(page, "products", { description: `${tag} produto`, group_id: ref.grupo.id, measurement_id: ref.unidade.id, financial_category_id: ref.natureza.id, control_stock: true });
  await saldoInicial(page, { empresa, local, produto, quantidade: "50", custo: "3" });
  expect((await api<{ quantity: string }>(page, "GET", `/api/stock/balances/${local}/${produto}`)).quantity, "premissa: o produto tem 50 no local").toBe("50.0000");
  const eq = await doSeed(page, "/api/resources/equipments/options?search=Trator", "Trator 4x4");
  return { empresa, tag, local: { id: local, nome: `${tag} local` }, produto: { id: produto, nome: `${tag} produto` }, equipamento: { id: eq.id, nome: "Trator 4x4" } };
}

/** Escolhe num RefSelect (o invólucro do campo) pelo nome — o painel do Radix, o último aberto. */
async function escolherNoCampo(page: Page, campo: Locator, nome: string) {
  await campo.locator("button").first().click();
  const painel = page.locator("[data-radix-popper-content-wrapper]").last();
  await painel.getByPlaceholder(/^Pesquisar/).first().fill(nome);
  await painel.getByRole("option", { name: literal(nome) }).first().click();
  await expect(campo, "o campo mostra a escolha").toContainText(nome);
}

/** Pesquisa na célula da linha (local ou produto) da grade `prefixo` pelo nome e escolhe — a pesquisa que o mundo der. */
async function escolherNaCelula(page: Page, prefixo: string, celula: Locator, nome: string) {
  await celula.click();
  const painel = page.getByTestId(`${prefixo}-pesquisa`);
  await expect(painel).toBeVisible();
  await painel.getByRole("combobox").fill(nome);
  await painel.getByRole("option", { name: literal(nome) }).first().click();
  await expect(painel).toHaveCount(0);
  await expect(celula).toContainText(nome);
}

/** Abre a Central e confere, no fio, a pergunta da capacidade que a PRÓPRIA tela fez: a 404 de rota (legado) ou 200. */
async function abrirCentral(page: Page, rota: string, modulo: ModuloComTop, prefixo: string, mundo: Mundo) {
  const capacidade = page.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname === portaDaCapacidadeDoModulo(modulo));
  await page.goto(rota);
  await expect(page.getByTestId(prefixo)).toBeVisible();
  const r = await capacidade;
  expect(r.status(), `mundo ${mundo}: a tela perguntou a capacidade e a base respondeu (chegou no fio)`).toBe(mundo === "novo" ? 200 : 404);
  await expect(page.getByTestId(`${prefixo}-campo-top`), `mundo ${mundo}: o campo "Tipo de operação" ${mundo === "novo" ? "aparece" : "não aparece"}`).toHaveCount(mundo === "novo" ? 1 : 0);
}

test("OP01-F10 · K-1a (sentido 1) — a Central do abastecimento sobre a API da base: sem a capacidade, sem o campo Tipo de operação, o POST de hoje chave por chave e 201 com a resposta de hoje", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const mundo = await mundoDaFrotaNaBase(page);
  const c = await cenario(page);
  const modulos = ouvirModulos(page);
  const P = "central-abastecimento";
  await abrirCentral(page, "/frota/abastecimentos/new", "abastecimento", P, mundo);

  await escolherNoCampo(page, page.getByTestId(`${P}-equipamento`), c.equipamento.nome);
  const linha = page.getByTestId(`${P}-linha`);
  await escolherNaCelula(page, P, linha.getByTestId(`${P}-armazem`), c.local.nome);
  await escolherNaCelula(page, P, linha.getByTestId(`${P}-produto`), c.produto.nome);
  await page.getByLabel("Quantidade do item 1").fill("5");

  const post = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/fleet/fuel-supplies");
  await page.getByTestId(`${P}-salvar`).click();
  const r = await post;
  const corpo = r.request().postDataJSON() as Record<string, unknown>;
  expect(chaves(corpo), `mundo ${mundo}: o POST leva as chaves de hoje${mundo === "novo" ? " MAIS tipo_operacao_id" : ", chave por chave"}`)
    .toEqual(mundo === "novo" ? [...CHAVES_DO_ABASTECIMENTO, "tipo_operacao_id"].sort() : CHAVES_DO_ABASTECIMENTO);
  expect([r.status(), corpo["product_id"], corpo["warehouse_id"], corpo["equipment_id"]], "a base gravou o abastecimento da tela").toEqual([201, c.produto.id, c.local.id, c.equipamento.id]);
  expect(chaves(await r.json()), "a resposta da base, com as chaves de hoje").toEqual(["code", "id", "total"]);
  await expect(page, "depois de salvar, a lista").toHaveURL(/\/frota\?tab=abastecimentos/);
  expect([...new Set(modulos)], "nenhum pedido a /api/modulos/* além da pergunta da capacidade").toEqual([`GET ${portaDaCapacidadeDoModulo("abastecimento")}`]);
  v.semBloqueio();
});

test("OP01-F10 · K-1b (sentido 1) — a Central da manutenção sobre a API da base: sem o campo Tipo de operação e sem a Observação; o POST de hoje (sem note) e 201 com a resposta de hoje", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const mundo = await mundoDaFrotaNaBase(page);
  const c = await cenario(page);
  const modulos = ouvirModulos(page);
  const P = "central-manutencao";
  await abrirCentral(page, "/frota/manutencoes/new", "manutencao", P, mundo);
  await expect(page.getByTestId(`${P}-observacao`), `mundo ${mundo}: a Observação ${mundo === "novo" ? "aparece" : "não aparece"}`).toHaveCount(mundo === "novo" ? 1 : 0);

  await escolherNoCampo(page, page.getByTestId(`${P}-local-padrao`), c.local.nome);
  const m0 = page.getByTestId(`${P}-maquina-0`);
  await escolherNoCampo(page, m0.getByTestId(`${P}-m0-equipamento`), c.equipamento.nome);
  await m0.getByTestId(`${P}-m0-adicionar-item`).click();
  const linha = m0.getByTestId(`${P}-m0-linha`);
  await expect(linha.getByTestId(`${P}-m0-armazem`), "a linha nova nasce com o local do cabeçalho (estado da tela)").toContainText(c.local.nome);
  await escolherNaCelula(page, `${P}-m0`, linha.getByTestId(`${P}-m0-produto`), c.produto.nome);
  await m0.getByLabel("Quantidade do item 1").fill("1");

  const post = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/fleet/maintenances");
  await page.getByTestId(`${P}-salvar`).click();
  const r = await post;
  const corpo = r.request().postDataJSON() as Record<string, unknown> & { machines: { items: Record<string, unknown>[] }[] };
  expect(chaves(corpo), `mundo ${mundo}: o POST leva as chaves de hoje${mundo === "novo" ? " MAIS note e tipo_operacao_id" : " (sem note, sem tipo_operacao_id)"}`)
    .toEqual(mundo === "novo" ? [...CHAVES_DA_MANUTENCAO, "note", "tipo_operacao_id"].sort() : CHAVES_DA_MANUTENCAO);
  expect([r.status(), corpo.machines[0]?.items[0]?.["warehouse_id"]], "a base gravou a manutenção, com a peça no local da linha").toEqual([201, c.local.id]);
  const salvo = await r.json() as Record<string, unknown>;
  expect(chaves(salvo), "a resposta da base, com as chaves de hoje").toEqual(["code", "id", "total_parts", "total_services"]);
  await expect(page, "depois de salvar, o detalhe (como antes)").toHaveURL(new RegExp(`/frota/manutencoes/${String(salvo["id"])}$`));
  expect([...new Set(modulos)], "nenhum pedido a /api/modulos/* além da pergunta da capacidade").toEqual([`GET ${portaDaCapacidadeDoModulo("manutencao")}`]);
  v.semBloqueio();
});

test("OP01-F10 · K-1c (sentido 1) — a Central da OS sobre a API da base: cria com o POST de hoje (201) e edita pelo PUT que a base já tem (200), sem tipo_operacao_id", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const mundo = await mundoDaFrotaNaBase(page);
  const c = await cenario(page);
  const modulos = ouvirModulos(page);
  const P = "central-os";
  await abrirCentral(page, "/os/new", "ordem_servico", P, mundo);

  await page.getByTestId(`${P}-descricao`).locator("textarea").fill(`K-1c ${c.tag}`);
  await escolherNoCampo(page, page.getByTestId(`${P}-local-padrao`), c.local.nome);
  await page.getByTestId(`${P}-insumos-adicionar-vazio`).click();
  const insumo = page.getByTestId(`${P}-insumos-linha`);
  await escolherNaCelula(page, `${P}-insumos`, insumo.getByTestId(`${P}-insumos-produto`), c.produto.nome);
  await page.getByTestId(`${P}-insumos-itens-corpo`).getByLabel("Quantidade do item 1").fill("2");

  const post = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/service-orders");
  await page.getByTestId(`${P}-salvar`).click();
  const r = await post;
  const corpo = r.request().postDataJSON() as Record<string, unknown>;
  expect(chaves(corpo), `mundo ${mundo}: o POST leva as chaves de hoje${mundo === "novo" ? " MAIS tipo_operacao_id" : ", chave por chave"}`)
    .toEqual(mundo === "novo" ? [...CHAVES_DA_OS, "tipo_operacao_id"].sort() : CHAVES_DA_OS);
  expect(r.status(), "a base criou a OS").toBe(201);
  const criada = await r.json() as { id: string; code: string };
  expect(chaves(criada), "a resposta da base, com as chaves de hoje").toEqual(["code", "id"]);
  const id = criada.id;
  await expect(page).toHaveURL(new RegExp(`/os/${id}$`));

  // A EDIÇÃO: o PUT que a base já tem (aberta), com o corpo de hoje e SEM tipo_operacao_id
  await page.getByTestId("os-editar").click();
  await expect(page.getByTestId(P)).toBeVisible();
  await expect(page.getByTestId(`${P}-top-gravada`), `mundo ${mundo}: a TOP gravada ${mundo === "novo" ? "aparece" : "não aparece"} (a chave do detalhe)`).toHaveCount(mundo === "novo" ? 1 : 0);
  await page.getByTestId(`${P}-descricao`).locator("textarea").fill(`K-1c editada ${c.tag}`);
  const put = page.waitForResponse((x) => x.request().method() === "PUT" && new URL(x.url()).pathname === `/api/service-orders/${id}`);
  await page.getByTestId(`${P}-salvar`).click();
  const p = await put;
  expect(chaves(p.request().postDataJSON()), "o PUT leva o corpo de hoje, sem tipo_operacao_id").toEqual(CHAVES_DA_OS);
  expect([p.status(), chaves(await p.json())], "a base aceitou a edição, com a resposta de hoje").toEqual([200, ["id"]]);
  await expect(page).toHaveURL(new RegExp(`/os/${id}$`));
  await expect(page.getByText(`K-1c editada ${c.tag}`), "o detalhe da base mostra a descrição nova").toBeVisible();
  expect([...new Set(modulos)], "nenhum pedido a /api/modulos/* além da pergunta da capacidade da criação").toEqual([`GET ${portaDaCapacidadeDoModulo("ordem_servico")}`]);
  v.semBloqueio();
});
