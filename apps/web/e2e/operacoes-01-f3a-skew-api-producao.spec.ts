import { test, expect, type Locator, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * OPERACOES-01 · F3a · K-1, SENTIDO 1 — O SELETOR DE PARCEIROS DESTE WEB CONTRA A API DA BASE (decisão 280; a janela
 * "web antes da API" da DEPLOYMENT, e a reversão só da API).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O version skew roda em `playwright.skew.config.ts`, cujo `testMatch` é a
 * expressão `/skew-api-producao\.spec\.ts/` — sem âncora, então ela casa também com o fim deste nome; e o
 * `playwright.config.ts` comum ignora o mesmo padrão, então este arquivo NUNCA roda na suíte comum (onde a API seria a
 * deste HEAD e o caso ficaria verde por vacuidade). O caso não foi acrescentado em `skew-api-producao.spec.ts` porque
 * aquele arquivo é compartilhado com as outras fases que correm em paralelo: o arquivo próprio não colide com nenhuma.
 * A identidade da árvore da base é provada pelo caso IDENTIDADE de `skew-api-producao.spec.ts`, na MESMA execução.
 *
 * O QUE SE MEDE. A F3a não muda NENHUM pedido do web: o `RefSelect` pede `/api/resources/people/options?search=…` como
 * sempre, sem `page`/`pageSize`, e mostra o que o servidor responde, sem filtrar nem inventar nada no cliente. Quem
 * passou a achar por razão social e CPF/CNPJ é a API nova. Contra a API da BASE, então: pelo NOME o parceiro aparece
 * (nos dois mundos), e pelo CNPJ ele aparece SE E SÓ SE a base o achar — a pergunta vai à base ANTES da tela e decide o
 * ramo (base anterior à F3a: "Nenhum resultado", sem erro; base já com a F3a, depois do merge: a opção). Não há mock: o
 * servidor é o binário da base, e o parceiro nasce por ela.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";

type Opcao = { id: string; label: string; code: string | null };

/** Cabeçalhos da sessão gravada pelo web depois do login, para perguntar à base direto. */
async function cabecalhosDaSessao(page: Page): Promise<Record<string, string>> {
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token?: string; orgId?: string });
  return { authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}) };
}

/**
 * Vigia do navegador (o mesmo desenho de `skew-api-producao.spec.ts`): falha de CORS não vira exceção nem resposta
 * HTTP — o Chromium aborta a requisição antes de ela existir para a aplicação. Sem o coletor, a tela renderiza
 * vazia e o teste passa, que é exatamente o modo de falha desta janela.
 */
function vigiar(page: Page) {
  const falhas: string[] = [];
  page.on("requestfailed", (r) => { if (r.url().includes(API)) falhas.push(`${r.url()} → ${r.failure()?.errorText ?? "?"}`); });
  page.on("console", (m) => { if (m.type() === "error" && /CORS|preflight|Access-Control/i.test(m.text())) falhas.push(`console: ${m.text()}`); });
  return { semBloqueio: () => expect(falhas, "nenhuma requisição pode morrer no navegador (CORS/preflight)").toEqual([]) };
}

const sorteio = (alfabeto: string, n: number) => Array.from({ length: n }, () => alfabeto[Math.floor(Math.random() * alfabeto.length)]!).join("");
/** CNPJ válido a partir das 12 primeiras posições (molde de `cadastros-parceiros.test.ts`). */
const cnpjDe = (base12: string) => { const v = (c: string) => c.charCodeAt(0) - 48; const dv = (s: string, p: number[]) => { const r = p.reduce((a, x, i) => a + v(s[i]!) * x, 0) % 11; return r < 2 ? 0 : 11 - r; }; const d1 = dv(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); return `${base12}${d1}${dv(`${base12}${d1}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`; };
const fmtCnpj = (c: string) => `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
const literal = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

/** Digita no seletor aberto e devolve a resposta do SERVIDOR a ESTE texto. */
async function pesquisarNoSeletor(page: Page, painel: Locator, texto: string): Promise<Opcao[]> {
  const resposta = page.waitForResponse((r) => { const u = new URL(r.url()); return u.pathname === "/api/resources/people/options" && u.searchParams.get("search") === texto; });
  await painel.getByPlaceholder("Pesquisar...").fill(texto);
  const r = await resposta;
  expect(r.status(), `a base responde 200 à pesquisa "${texto}"`).toBe(200);
  return (await r.json()) as Opcao[];
}

test("OP01-F3a · K-1 (sentido 1) — o seletor de Parceiros deste web contra a API da base: acha pelo nome, acha pelo CNPJ se e só se a base achar, e não manda parâmetro que a base não conhece", async ({ page }) => {
  const v = vigiar(page);
  await login(page);
  const cab = await cabecalhosDaSessao(page);

  // O parceiro nasce PELA BASE (a API que está no ar nesta janela), com documento novo a cada execução.
  const s = sorteio("abcdefghijklmnopqrstuvwxyz", 7);
  const cnpj = cnpjDe(`7${sorteio("0123456789", 7)}0001`);
  const nome = `K1 Parceiro ${s}`;
  const criado = await page.request.post(`${API}/api/resources/people`, { headers: cab, data: { person_type: "legal", name: nome, legal_name: `K1 Razão ${s} Ltda`, document: fmtCnpj(cnpj), is_client: true } });
  expect(criado.status(), `a base cadastra o parceiro: ${await criado.text()}`).toBe(201);
  const id = ((await criado.json()) as { id: string }).id;

  // A PERGUNTA À BASE, antes da tela: ela acha pelo nome (sempre) e pelo CNPJ (só a base com a F3a)?
  const perguntar = async (texto: string) => {
    const r = await page.request.get(`${API}/api/resources/people/options?search=${encodeURIComponent(texto)}`, { headers: cab });
    expect(r.status(), `a base responde ao seletor com "${texto}"`).toBe(200);
    return ((await r.json()) as Opcao[]).some((o) => o.id === id);
  };
  expect(await perguntar(nome), "premissa: a base acha o parceiro pelo nome").toBe(true);
  const baseAchaPeloDocumento = await perguntar(fmtCnpj(cnpj));
  console.log(`[skew] OP01-F3a · K-1 · a base ${baseAchaPeloDocumento ? "ACHA" : "NÃO acha"} o parceiro pelo CNPJ → ${baseAchaPeloDocumento ? "a opção aparece" : "\"Nenhum resultado\""}`);

  // todo pedido do seletor de pessoas, no fio
  const pedidos: URL[] = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname === "/api/resources/people/options") pedidos.push(u); });

  await page.goto("/cadastros/teams/new");
  const form = page.getByTestId("b1-form");
  await expect(form, "o formulário de Equipe deste web abre contra a base").toBeVisible();
  const rotulo = form.locator("label", { hasText: /^Encarregado/ });
  await expect(rotulo, "o formulário tem o campo Encarregado").toHaveCount(1);
  const campo = rotulo.locator(".."); // o pai do rótulo e da caixa é o campo
  await campo.getByRole("combobox").click();
  const painel = page.locator(".cmd-panel");
  await expect(painel.getByPlaceholder("Pesquisar...")).toBeVisible();
  const opcao = painel.getByRole("option", { name: literal(nome) });

  // (a) pelo NOME: positivo nos dois mundos
  const pelonome = await pesquisarNoSeletor(page, painel, nome);
  expect(pelonome.map((o) => o.id), "a base responde o parceiro pelo nome").toContain(id);
  await expect(opcao, "a tela mostra o que a base respondeu").toBeVisible();

  // (b) pelo CNPJ formatado: a tela mostra o que a base responde — nunca filtra nem inventa no cliente
  const pelodoc = await pesquisarNoSeletor(page, painel, fmtCnpj(cnpj));
  expect(pelodoc.some((o) => o.id === id), "a resposta da tela é a mesma da pergunta direta").toBe(baseAchaPeloDocumento);
  if (baseAchaPeloDocumento) {
    await expect(opcao, "a base acha pelo CNPJ: a opção aparece").toBeVisible();
  } else {
    await expect(opcao, "a base não acha pelo CNPJ: nada de opção inventada").toHaveCount(0);
    await expect(painel.getByText("Nenhum resultado", { exact: true }), "e a degradação é a lista vazia, sem erro").toBeVisible();
  }

  // NO FIO: o web deste HEAD não manda parâmetro que a base não conhece (nem `page`, nem `pageSize`)
  expect(pedidos.length, "premissa: o fio registrou os pedidos do seletor").toBeGreaterThanOrEqual(2);
  for (const u of pedidos) expect([...u.searchParams.keys()].filter((k) => k !== "search"), `${u.search}: só \`search\``).toEqual([]);
  v.semBloqueio();
});
