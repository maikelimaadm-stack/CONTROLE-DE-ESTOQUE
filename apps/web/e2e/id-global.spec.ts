import { test, expect, type Page } from "@playwright/test";
import { login, logout } from "./helpers";

/**
 * PRE-BASE2-04 — ID GLOBAL na interface: busca (Ctrl+K) e identidade na tela do registro.
 *
 * O que estes testes protegem, e que nenhum teste de API pega:
 *  - a URL que o usuário acaba vendo é a ROTA CANÔNICA com o UUID. Se alguém "otimizar" a busca montando
 *    `/registro/55`, o número vira uma segunda identidade permanente — e uma que resolve SEM a autorização
 *    daquele registro. Por isso o teste afirma explicitamente que a URL NÃO contém o número;
 *  - o número aparece na tela do registro para quem abriu por navegação normal, não só para quem veio da busca;
 *  - a GRAFIA ANTIGA continua entrando. A tela parou de escrever `#55` na PRE-BASE2-05B.2, e é de propósito
 *    que os casos abaixo continuam DIGITANDO `#55`: o que saiu foi a exibição, não a compatibilidade de
 *    leitura. Se a busca passasse a recusar o prefixo, quem o copiou de um documento antigo perderia o
 *    caminho até o registro — e esta suíte reprovaria.
 */

/** Cria um registro pela API, com a sessão do navegador, e devolve o ID Global que o backend deu a ele. */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
async function criarComIdGlobal(page: Page): Promise<{ id: string; idGlobal: number; rota: string }> {
  return page.evaluate(async (base: string) => {
    const sessao = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string };
    const cab = { "content-type": "application/json", authorization: `Bearer ${sessao.token}`, "x-org-id": sessao.orgId };
    const ctx = await (await fetch(`${base}/api/auth/context`, { headers: cab })).json();
    const empresa = ctx.empresas[0].id;
    const os = await (await fetch(`${base}/api/service-orders`, { method: "POST", headers: cab,
      body: JSON.stringify({ empresa_id: empresa, order_date: "2031-05-01", description: `OS ID Global ${Date.now()}`, lines: [] }) })).json();
    const reg = await (await fetch(`${base}/api/registros-globais/entidade/service_orders/${os.id}`, { headers: cab })).json();
    return { id: os.id as string, idGlobal: reg.idGlobal as number, rota: reg.rota as string };
  }, API);
}

test.describe("ID Global — busca e identidade", () => {
  test("Ctrl+K → `#N` (grafia antiga) → abre a ROTA CANÔNICA, e a URL tem o UUID, não o número", async ({ page }) => {
    await login(page);
    const alvo = await criarComIdGlobal(page);

    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("global-search")).toBeFocused();
    await page.getByTestId("global-search").fill(`#${alvo.idGlobal}`);

    const resultado = page.getByTestId("nav-search-id-global-item");
    await expect(resultado).toBeVisible();
    // o resultado mostra o NÚMERO PURO (PRE-BASE2-05B.2), mesmo tendo sido encontrado por `#N`
    await expect(resultado).toContainText(new RegExp(`(^|\\s)${alvo.idGlobal} ·`));
    await expect(resultado, "o resultado diz QUE COISA é, não só o número").toContainText("Ordem de Serviço");

    await resultado.click();
    await expect(page).toHaveURL(new RegExp(`/os/${alvo.id}`));
    expect(page.url(), "o ID Global é localizador; a identidade da URL continua sendo o UUID").not.toContain(`/os/${alvo.idGlobal}`);
    await expect(page.getByTestId("id-global-registro"), "o registro aberto mostra a própria identidade, sem prefixo").toHaveText(new RegExp(`(^|\\s)${alvo.idGlobal}$`));
  });

  test("`ID N` (com espaço) funciona e Enter abre o registro", async ({ page }) => {
    await login(page);
    const alvo = await criarComIdGlobal(page);
    await page.keyboard.press("Control+k");
    await page.getByTestId("global-search").fill(`ID ${alvo.idGlobal}`);
    await expect(page.getByTestId("nav-search-id-global-item")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/os/${alvo.id}`));
  });

  test("número que não existe não vira navegação nem some com a busca de telas", async ({ page }) => {
    await login(page);
    await page.keyboard.press("Control+k");
    await page.getByTestId("global-search").fill("#999999");
    await expect(page.getByTestId("nav-search-id-global-item")).toHaveCount(0);
    // e a busca por texto continua funcionando exatamente como antes
    await page.getByTestId("global-search").fill("Estoque");
    await expect(page.getByTestId("nav-search-results")).toBeVisible();
  });

  test("o número aparece ao abrir o registro por navegação normal, em módulos diferentes", async ({ page }) => {
    await login(page);
    const alvo = await criarComIdGlobal(page);
    await page.goto(`/os/${alvo.id}`);
    await expect(page.getByTestId("id-global-registro")).toHaveText(new RegExp(`(^|\\s)${alvo.idGlobal}$`));

    // Cadastro compartilhado (Produto): abre em CONSULTA e também mostra a identidade. O produto é CRIADO
    // aqui de propósito — os do seed são acervo histórico e só ganham número depois do backfill, e é
    // justamente esse o estado em que a tela precisa não quebrar (o badge some, a tela fica inteira).
    const produto = await page.evaluate(async (base: string) => {
      const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string };
      const cab = { "content-type": "application/json", authorization: `Bearer ${s.token}`, "x-org-id": s.orgId };
      const um = async (r: string) => (await (await fetch(`${base}/api/resources/${r}/options`, { headers: cab })).json())[0].id;
      const cat = await (await fetch(`${base}/api/resources/financial_categories?pageSize=1&kind=analytic`, { headers: cab })).json();
      const novo = await (await fetch(`${base}/api/resources/products`, { method: "POST", headers: cab, body: JSON.stringify({
        description: `Produto ID Global ${Date.now()}`, measurement_id: await um("measurement_units"), group_id: await um("product_groups"),
        category_id: await um("product_categories"), kind_id: await um("product_kinds"), control_stock: true,
        financial_category_id: cat.items[0].id }) })).json();
      return novo.id as string;
    }, API);
    await page.goto(`/cadastros/products/${produto}?view=1`);
    await expect(page.getByTestId("id-global-registro")).toBeVisible();
  });

  test("tela que não é registro não mostra identidade nenhuma", async ({ page }) => {
    await login(page);
    await page.goto("/os");
    await expect(page.getByTestId("id-global-registro")).toHaveCount(0);
  });
});

/**
 * CROSS-MÓDULO / CROSS-EMPRESA — a segunda metade do defeito, que nenhum teste de API pega.
 *
 * O backend localizar o registro certo não basta: se a navegação apenas abrisse a rota, a tela de destino
 * sairia pedindo dados com a empresa ANTIGA no cabeçalho e responderia 403 — o usuário clicaria no resultado
 * correto e veria um erro. A busca por `#N` precisa SINCRONIZAR o contexto antes de navegar, e é isso que
 * este teste observa de fora: empresa ativa muda para a do registro, a rota final continua com o UUID e o
 * distintivo mostra o MESMO número.
 */
type Restrito = { email: string; senha: string; idGlobal: number; titulo: string; empresaA: string; empresaB: string; nomeB: string };

/** Prepara, com a sessão do administrador, o usuário restrito (Estoque→A, Financeiro→B) e um título na B. */
async function cenarioCruzado(page: Page): Promise<Restrito> {
  return page.evaluate(async (base: string) => {
    const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string };
    const cab = { "content-type": "application/json", authorization: `Bearer ${s.token}`, "x-org-id": s.orgId };
    const post = async (rota: string, corpo: unknown) => (await fetch(`${base}${rota}`, { method: "POST", headers: cab, body: JSON.stringify(corpo) })).json();
    const get = async (rota: string) => (await fetch(`${base}${rota}`, { headers: cab })).json();
    const ctx = await get("/api/auth/context");
    const A = ctx.empresas[0]; const B = ctx.empresas[1];
    const pessoa = (await get("/api/resources/people/options?is_provider=true"))[0];
    const cats = await get("/api/resources/financial_categories?pageSize=1&kind=analytic&nature=expense");
    const centros = await get("/api/resources/cost_centers/options");
    const titulo = await post("/api/financial/payables", { empresa_id: B.id, number: `CRUZ-${Date.now()}`, person_id: pessoa.id, amount: "10",
      emission_date: "2031-06-01", due_date: "2031-07-01", note: "cruzado",
      apportionment: [{ financial_category_id: cats.items[0].id, cost_center_id: centros[0].id, percentage: "100" }] });
    const reg = await get(`/api/registros-globais/entidade/financial_titles/${titulo.id}`);
    const marca = Date.now().toString(36);
    const papel = await post("/api/admin/roles", { name: `Cruzado ${marca}`, permissions: ["input_entries.view", "payables.view"] });
    const email = `cruzado-${marca}@demo.local`; const senha = "Cruzado@12345";
    await post("/api/admin/members", { name: `Cruzado ${marca}`, email, password: senha, role_id: papel.id,
      escopos_empresas: [{ modulo: "estoque", modo: "selecionadas", empresas: [A.id] }, { modulo: "financeiro", modo: "selecionadas", empresas: [B.id] }] });
    return { email, senha, idGlobal: reg.idGlobal as number, titulo: titulo.id as string, empresaA: A.id as string, empresaB: B.id as string, nomeB: B.name as string };
  }, API);
}

test.describe("ID Global — localização cross-empresa", () => {
  test("com a empresa A ativa, `#N` de um título da empresa B abre — e o contexto vira B ANTES da tela", async ({ page }) => {
    await login(page);
    const c = await cenarioCruzado(page);
    await logout(page);
    await login(page, { email: c.email, password: c.senha });

    const seletor = page.getByLabel("Empresa ativa");
    await seletor.selectOption(c.empresaA);
    await expect(seletor).toHaveValue(c.empresaA);

    const respostas: number[] = [];
    page.on("response", (r) => { if (r.url().includes("/api/")) respostas.push(r.status()); });

    await page.keyboard.press("Control+k");
    await page.getByTestId("global-search").fill(`#${c.idGlobal}`);
    const resultado = page.getByTestId("nav-search-id-global-item");
    await expect(resultado, "o localizador global não pode depender da empresa selecionada").toBeVisible();
    await resultado.click();

    await expect(seletor, "a empresa ativa acompanha o registro").toHaveValue(c.empresaB);
    await expect(page).toHaveURL(new RegExp(`/financeiro/contas-a-pagar/${c.titulo}`));
    expect(page.url(), "o ID Global nunca vira URL").not.toContain(`/${c.idGlobal}`);
    await expect(page.getByTestId("id-global-registro")).toHaveText(new RegExp(`(^|\\s)${c.idGlobal}$`));
    expect(respostas.filter((s) => s === 403), "nenhuma chamada da navegação pode ser recusada por contexto").toEqual([]);
  });

  test("a troca passa pela MESMA porta do seletor de empresa — é o que preserva a proteção de abas sujas", async ({ page }) => {
    // A proteção de alterações não salvas vive no guard do shell, que escuta `agro:empresa-request`. O risco
    // real desta rodada não é a confirmação em si (ela já existia e é testada pelo seletor): é a busca por
    // `#N` ganhar um caminho PRÓPRIO — `setEmpresa` + navegação — que passasse por fora dela e descartasse
    // trabalho em silêncio. Por isso o que se observa aqui é a PORTA: o clique no resultado pede a troca pelo
    // mesmo evento, com o destino junto, em vez de trocar por conta própria.
    // A máquina de estado dessa decisão (quando trocar, quando preservar "todas", pedido legado) está coberta
    // sem navegador em packages/plataforma/test/contexto-empresa.test.ts.
    await login(page);
    const c = await cenarioCruzado(page);
    const seletor = page.getByLabel("Empresa ativa");
    await seletor.selectOption(c.empresaA);
    await expect(seletor).toHaveValue(c.empresaA);

    await page.evaluate(() => {
      (window as unknown as { __pedidos: unknown[] }).__pedidos = [];
      window.addEventListener("agro:empresa-request", (e) => (window as unknown as { __pedidos: unknown[] }).__pedidos.push((e as CustomEvent).detail));
    });

    await page.keyboard.press("Control+k");
    await page.getByTestId("global-search").fill(`#${c.idGlobal}`);
    const resultado = page.getByTestId("nav-search-id-global-item");
    await expect(resultado).toBeVisible();
    await resultado.click();

    const pedidos = await page.evaluate(() => (window as unknown as { __pedidos: unknown[] }).__pedidos);
    expect(pedidos, "a busca por ID Global não pode ter um atalho próprio para trocar de empresa").toEqual([
      { empresaId: c.empresaB, rota: `/financeiro/contas-a-pagar/${c.titulo}` }
    ]);
    await expect(seletor).toHaveValue(c.empresaB);
  });
});
