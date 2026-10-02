import { test, expect, type Page } from "@playwright/test";
import { login, uniq } from "./helpers";

/**
 * OPERACOES-01 · F3a · K-2, SENTIDO 2 — O WEB DA BASE CONTRA A API DESTE HEAD (decisão 280; a janela "API antes do web"
 * da DEPLOYMENT, e a reversão só do web).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 2 roda em `playwright.skew-web-anterior.config.ts`, cujo `testMatch` é
 * `/skew-web-anterior\.spec\.ts/` — sem âncora, então casa também com o fim deste nome; e o `playwright.config.ts` comum
 * ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (lá o web seria o deste HEAD, e o caso não mediria
 * o cliente anterior). O caso não foi acrescentado em `skew-web-anterior.spec.ts` porque aquele arquivo é compartilhado
 * com as outras fases que correm em paralelo: o arquivo próprio não colide com nenhuma. A identidade do bundle da base é
 * a do caso IDENTIDADE de `skew-web-anterior.spec.ts`, na MESMA execução.
 *
 * O QUE SE MEDE. A API desta fase mudou `GET /api/resources/:key/options`: aceita `page`/`pageSize` (opcionais; padrão
 * 1 × 200, a página de hoje), recusa entrada não canônica com 422 e, para Parceiros, acha também por razão social e
 * CPF/CNPJ normalizado. A resposta NÃO mudou de forma: o array de `{ code, id, label }`. O navegador roda o bundle EXATO
 * da base — que não manda `page`/`pageSize` — e usa o seletor do jeito do usuário: acha o parceiro pelo CNPJ (sem nada
 * mudar nele), escolhe, e salva a equipe; a API nova aceita o corpo de sempre. A marca do mundo do web da base não é
 * necessária: o seletor de pessoas e o cadastro de equipe existem iguais na base, e o caso não depende de recurso novo
 * do web.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";

type Opcao = Record<string, unknown> & { id: string; label: string };

/** Cabeçalhos da sessão gravada pelo web da base depois do login, para falar com a API deste HEAD direto. */
async function cabecalhosDaSessao(page: Page): Promise<Record<string, string>> {
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token?: string; orgId?: string });
  return { authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}) };
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

const sorteio = (alfabeto: string, n: number) => Array.from({ length: n }, () => alfabeto[Math.floor(Math.random() * alfabeto.length)]!).join("");
/** CNPJ válido a partir das 12 primeiras posições (molde de `cadastros-parceiros.test.ts`). */
const cnpjDe = (base12: string) => { const v = (c: string) => c.charCodeAt(0) - 48; const dv = (s: string, p: number[]) => { const r = p.reduce((a, x, i) => a + v(s[i]!) * x, 0) % 11; return r < 2 ? 0 : 11 - r; }; const d1 = dv(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); return `${base12}${d1}${dv(`${base12}${d1}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`; };
const fmtCnpj = (c: string) => `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

test("OP01-F3a · K-2 (sentido 2) — o seletor de Parceiros do web da base contra a API deste HEAD: acha pelo CNPJ, recebe o array de sempre e salva a equipe", async ({ page }) => {
  await login(page);
  const cab = await cabecalhosDaSessao(page);

  // O parceiro nasce pela API DESTE HEAD (a que está sendo julgada), com documento novo a cada execução.
  const s = sorteio("abcdefghijklmnopqrstuvwxyz", 7);
  const cnpj = cnpjDe(`7${sorteio("0123456789", 7)}0001`);
  const nome = `K2 Parceiro ${s}`; const doc = fmtCnpj(cnpj);
  const criado = await page.request.post(`${API}/api/resources/people`, { headers: cab, data: { person_type: "legal", name: nome, legal_name: `K2 Razão ${s} Ltda`, document: doc, is_client: true } });
  expect(criado.status(), `a API cadastra o parceiro: ${await criado.text()}`).toBe(201);
  const id = ((await criado.json()) as { id: string }).id;

  // PREMISSA: a API no ar é a desta fase — recusa a página malformada e acha pelo CNPJ
  const malformada = await page.request.get(`${API}/api/resources/people/options?page=abc`, { headers: cab });
  expect(malformada.status(), "premissa: a API julgada é a nova (page=abc → 422)").toBe(422);
  const porDoc = await page.request.get(`${API}/api/resources/people/options?search=${encodeURIComponent(doc)}`, { headers: cab });
  expect(porDoc.status()).toBe(200);
  expect(((await porDoc.json()) as Opcao[]).map((o) => o.id), "premissa: a API julgada acha pelo CNPJ").toContain(id);

  const v = vigiar(page);
  const pedidos: URL[] = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname === "/api/resources/people/options") pedidos.push(u); });

  await page.goto("/cadastros/teams/new");
  const form = page.getByTestId("b1-form");
  await expect(form, "o formulário de Equipe do web da base abre").toBeVisible();
  const rotulo = form.locator("label", { hasText: /^Encarregado/ });
  await expect(rotulo, "o formulário tem o campo Encarregado").toHaveCount(1);
  const campo = rotulo.locator(".."); // o pai do rótulo e da caixa é o campo
  await campo.getByRole("combobox").click();
  const painel = page.locator(".cmd-panel");
  await expect(painel.getByPlaceholder("Pesquisar...")).toBeVisible();

  // o seletor da base pesquisa pelo CNPJ formatado: a API nova responde o array de sempre, com o parceiro
  const resposta = page.waitForResponse((r) => { const u = new URL(r.url()); return u.pathname === "/api/resources/people/options" && u.searchParams.get("search") === doc; });
  await painel.getByPlaceholder("Pesquisar...").fill(doc);
  const r = await resposta;
  expect(r.status()).toBe(200);
  const corpo = (await r.json()) as unknown;
  expect(Array.isArray(corpo), "a resposta continua um ARRAY (o web da base lê array)").toBe(true);
  const itens = corpo as Opcao[];
  expect(itens.length, "premissa: a resposta tem itens para conferir").toBeGreaterThan(0);
  for (const it of itens) expect(Object.keys(it).sort(), "cada item tem as chaves de sempre, nenhuma a mais").toEqual(["code", "id", "label"]);
  expect(itens.map((o) => o.id), "o parceiro está na resposta").toContain(id);
  const opcao = painel.getByRole("option", { name: literal(nome) });
  await expect(opcao, "o seletor da base mostra a opção achada pelo CNPJ").toBeVisible();
  await opcao.click();
  await expect(campo.getByRole("combobox"), "a escolha aparece na caixa").toHaveText(nome);

  // salvar a equipe: o corpo do web da base, aceito pela API nova
  const nomeEquipe = uniq("K2 Equipe");
  await form.getByLabel(/^Nome/).fill(nomeEquipe);
  const post = page.waitForResponse((x) => x.request().method() === "POST" && new URL(x.url()).pathname === "/api/resources/teams");
  await page.getByRole("button", { name: /^Salvar/ }).click();
  const salvo = await post;
  expect(salvo.status(), `a API nova aceita o corpo do web da base: ${await salvo.text()}`).toBe(201);
  const equipe = (await salvo.json()) as { id: string };
  const lida = await page.request.get(`${API}/api/resources/teams/${equipe.id}`, { headers: cab });
  expect(lida.status()).toBe(200);
  expect(await lida.json(), "a equipe gravada aponta para o parceiro escolhido").toMatchObject({ name: nomeEquipe, leader_person_id: id });

  // NO FIO: o web da base não manda `page`/`pageSize` (recebe a página 1 de 200, a de hoje)
  expect(pedidos.length, "premissa: o fio registrou os pedidos do seletor").toBeGreaterThanOrEqual(2);
  for (const u of pedidos) expect([...u.searchParams.keys()].filter((k) => k !== "search"), `${u.search}: só \`search\``).toEqual([]);
  v.semBloqueio();
  v.semErroDeContrato();
});
