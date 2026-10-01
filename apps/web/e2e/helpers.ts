import { expect, type Page, type Request } from "@playwright/test";
export const ADMIN = { email: process.env.E2E_ADMIN_EMAIL ?? "admin@demo.local", password: process.env.E2E_ADMIN_PASSWORD ?? "Demo@12345" };
export async function login(page: Page, u = ADMIN) {
  await page.goto("/login"); await page.fill("#email", u.email); await page.fill("#password", u.password); await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Início" })).toBeVisible();
}
/** Sai pelo menu do usuário (shell): avatar → "Sair". */
export async function logout(page: Page) {
  await page.getByLabel("Usuário").click(); await page.getByRole("menuitem", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);
}
/**
 * Seleciona uma opção em um RefSelect (popover com busca).
 *
 * TOLERANTE À CENTRAL ANTERIOR E À NOVA (VISUAL-UX-02): a pesquisa de hoje diz "Pesquisar..." e a do desenho
 * diz "Pesquisar <campo>". O campo de busca é procurado DENTRO do painel aberto (o último popover/diálogo, o
 * mesmo recorte da escolha da opção), por isso o prefixo não esbarra em outra busca da página ("Pesquisar por…"
 * da listagem atrás de uma gaveta). Este helper roda também no skew contra o web da base.
 */
export async function pickRef(page: Page, fieldLabel: string, search: string) {
  const field = page.locator("label", { hasText: fieldLabel }).first().locator("..");
  await field.locator("button").first().click();
  const painel = page.locator("div[role='dialog'], [data-radix-popper-content-wrapper]").last();
  const input = painel.getByPlaceholder(/^Pesquisar/).first(); await input.fill(search);
  await painel.getByRole("option", { name: new RegExp(search.slice(0, 12), "i") }).first().click();
}
export const uniq = (p: string) => `${p} ${Date.now().toString(36)}`;

export async function api<T = Record<string, unknown>>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
  return page.evaluate(async ({ method, path, body, base }) => {
    const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string | null; empresaId: string | null };
    const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}), ...(s.empresaId ? { "x-empresa-id": s.empresaId } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text(); const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 300)}`);
    return data as T;
  }, { method, path, body, base });
}
/**
 * Empresa efetiva para criar lançamento, pela MESMA regra do app (`useEmpresaPadrao`, features/docs/shared):
 * a empresa da sessão, ou a primeira do contexto. No harness a sessão começa em "Todas as empresas", e
 * `session.empresaId` é `null` — foi isso que reprovou a primeira versão destes testes com 422.
 */
export async function empresaAtiva(page: Page): Promise<string> {
  const daSessao = await page.evaluate(() => (JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { empresaId: string | null }).empresaId);
  if (daSessao) return daSessao;
  const ctx = await api<{ empresas?: { id: string }[] }>(page, "GET", "/api/auth/context");
  const id = ctx.empresas?.[0]?.id;
  expect(id, "o contexto precisa expor ao menos uma empresa visível").toBeTruthy();
  return id!;
}

/** Primeiro id de um recurso, pela listagem oficial. */
export async function primeiroId(page: Page, path: string): Promise<string> {
  const r = await api<{ items: { id: string }[] }>(page, "GET", path);
  const id = r.items?.[0]?.id;
  expect(id, `sem registro em ${path} para montar a fixture`).toBeTruthy();
  return id!;
}

/**
 * A ETAPA DE ESCOLHA DO TIPO DE OPERAÇÃO (TOP-CONFIG-02B).
 *
 * `/vendas/<variante>/new` NÃO abre mais o formulário: abre o lançador. Quem quer chegar ao formulário
 * escolhe a operação primeiro. O passo mora aqui porque três specs precisam dele — duplicá-lo faria cada
 * um envelhecer por conta própria no dia em que o lançador mudar.
 */
export async function abrirLancamentoDeVendas(page: Page, variante: string) {
  await page.goto(`/vendas/${variante}/new`);
  await expect(page.getByTestId("top-lancador"), "sem TOP na URL, a rota /new abre o lançador").toBeVisible();
}

/**
 * Escolhe a TOP no lançador e confirma. Só retorna quando o formulário montou de fato — devolver antes
 * faria o teste seguinte medir uma tela em transição e culpar a asserção errada.
 */
export async function escolherTopEContinuar(page: Page, topId: string) {
  await page.locator(`[data-testid="top-opcao"][data-top-id="${topId}"]`).click();
  await page.getByTestId("top-continuar").click();
  await expect(page.getByTestId("top-contexto"), "depois de Continuar, o formulário abre contextualizado").toBeVisible();
  await expect(page, "a escolha fica na URL, para sobreviver a refresh e a Voltar/Avançar").toHaveURL(new RegExp(`tipo_operacao_id=${topId}`));
}

/**
 * Abre uma aba do painel inferior da Central de Vendas (VISUAL-UX-01): Totais · Financeiro · Frete ·
 * Fiscal · Observações. Os campos dessas abas continuam ligados ao MESMO estado de antes — só a
 * posição na tela mudou —, então quem precisa digitar neles abre a aba primeiro, como o usuário faz.
 * Só retorna quando o painel da aba está visível: preencher durante a troca mediria a aba errada.
 */
export async function abrirAbaDoLancamento(page: Page, nome: "Totais" | "Financeiro" | "Frete e transporte" | "Fiscal" | "Observações") {
  const aba = page.getByTestId("central-vendas-painel").getByRole("tab", { name: nome });
  await aba.click();
  await expect(aba).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("central-vendas-painel").getByRole("tabpanel")).toBeVisible();
}

/**
 * Escolhe o primeiro produto REAL na primeira linha de itens da Central de Vendas (VISUAL-UX-01 R1):
 * abre a pesquisa ancorada à célula de produto e clica na primeira opção que o servidor devolveu.
 */
export async function escolherPrimeiroProdutoDaLinha(page: Page) {
  await page.getByTestId("central-vendas-linha").first().getByTestId("central-vendas-produto").click();
  await page.getByTestId("central-vendas-pesquisa").getByRole("option").first().click();
  await expect(page.getByTestId("central-vendas-pesquisa")).toHaveCount(0);
}

/**
 * ADICIONA UM ITEM NA CRIAÇÃO DA CENTRAL DE VENDAS — TOLERANTE À CENTRAL ANTERIOR E À NOVA (VISUAL-UX-02 Fase B).
 *
 * Na Central anterior o botão da barra se chama "Adicionar item"; na do desenho ele é "Adicionar produto" e, com ZERO
 * itens, a grade vazia mostra também um botão de texto "Adicionar produto" — dois com o mesmo nome. A barra vem antes
 * da grade no DOM, por isso `.first()`. Nas duas, a linha nova nasce marcada (os campos editáveis aparecem nela).
 * Roda também no skew contra o web da base. NÃO serve a compras/estoque: o `ItemsEditor` tem o próprio
 * "Adicionar item", que não muda.
 */
export async function adicionarItemNaCentral(page: Page) {
  await page.getByRole("button", { name: /^Adicionar (item|produto)$/ }).first().click();
}

/**
 * SALVAR SEM O PAR NATUREZA/CENTRO DE RESULTADO (VISUAL-UX-02 Fase B, decisão 270).
 *
 * O CONTRATO não muda: sem o par, nada é gravado. Muda a APRESENTAÇÃO: o Salvar fica HABILITADO (há alteração), e o
 * clique não envia NADA — ZERO POST para `/api/sales/` — e a pílula "N pendências" lista o que falta. `faltando`
 * diz quais dos dois rótulos TÊM de estar na lista; o outro, já escolhido, NÃO pode estar. As requisições são
 * contadas no fio (`request`), não deduzidas da tela. Fecha a lista ao sair, para o passo seguinte achar a página
 * como antes do clique.
 */
export async function salvarSemClassificacaoNaoEnvia(
  page: Page,
  faltando: readonly ("Natureza" | "Centro de resultado")[],
  motivo: string,
) {
  const posts: string[] = [];
  const registrar = (r: Request) => {
    if (r.method() === "POST" && new URL(r.url()).pathname.startsWith("/api/sales/")) posts.push(new URL(r.url()).pathname);
  };
  page.on("request", registrar);
  try {
    const salvar = page.getByRole("button", { name: "Salvar" });
    await expect(salvar, `${motivo}: com alteração, o Salvar fica habilitado`).toBeEnabled();
    await salvar.click();
    const pilula = page.getByTestId("central-vendas-pendencias");
    await expect(pilula, `${motivo}: a pílula de pendências aparece`).toBeVisible();
    await expect(pilula).toHaveText(/\d+ pendências?/);
    // o clique com pendência já abre a lista; se ela estiver fechada, a pílula a abre
    if ((await pilula.getAttribute("aria-expanded")) !== "true") await pilula.click();
    const lista = page.getByTestId("central-vendas-pendencias-lista");
    await expect(lista).toBeVisible();
    for (const rotulo of ["Natureza", "Centro de resultado"] as const) {
      await expect(lista.getByTestId("central-vendas-pendencia").filter({ hasText: rotulo }),
        `${motivo}: ${rotulo} ${faltando.includes(rotulo) ? "é" : "não é"} pendência`).toHaveCount(faltando.includes(rotulo) ? 1 : 0);
    }
    await page.waitForTimeout(300);
    expect(posts, `${motivo}: ZERO POST — sem o par nada é gravado`).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(lista).toBeHidden();
  } finally {
    page.off("request", registrar);
  }
}

/**
 * A CLASSIFICAÇÃO FINANCEIRA DO SEED QUE A CENTRAL DE VENDAS EXIGE (VENDAS-A1).
 *
 * Com a API declarando `capacidades.classificacaoFinanceira`, o Salvar da Central só libera com
 * "Categoria financeira" e "Centro de custo" escolhidos — nas três variantes. Os specs que salvam pela
 * Central escolhem os DOIS pela MESMA porta, e escolhem registros analíticos do seed (a categoria de
 * receita e o centro que o lookup oferece), para que nenhum deles dependa do que outro spec cadastrou.
 * Mora aqui pelo mesmo motivo do lançador: duplicado, cada spec envelheceria por conta própria.
 */
export const CLASSIFICACAO_DO_SEED = {
  categoria: { codigo: "1.01.001", nome: "Venda de Boi Gordo" },
  centro: { codigo: "1.01.001", nome: "Adm Geral" }
} as const;

/** Rótulos da tela deste HEAD; o skew com o web da base passa os rótulos que aquele bundle mostra. */
export const ROTULOS_CLASSIFICACAO = { natureza: "Natureza", centro: "Centro de resultado" } as const;
export const ROTULOS_CLASSIFICACAO_BASE = { natureza: "Categoria financeira", centro: "Centro de custo" } as const;

export async function preencherClassificacaoFinanceira(
  page: Page,
  rotulos: { natureza: string; centro: string } = ROTULOS_CLASSIFICACAO,
) {
  await pickRef(page, rotulos.natureza, CLASSIFICACAO_DO_SEED.categoria.nome);
  await pickRef(page, rotulos.centro, CLASSIFICACAO_DO_SEED.centro.nome);
}

/**
 * UMA AÇÃO DA BARRA DA CENTRAL DE VENDAS QUE PODE MORAR NUM MENU (VISUAL-UX-02, decisão 270).
 *
 * Na Central do desenho, Imprimir, Histórico, Documentos abertos, Cancelar e Alterar operação moram no leque de
 * "Ações rápidas" (`central-vendas-acoes-rapidas`); na Central anterior, Documentos abertos e Alterar operação
 * ficavam direto na barra, e Histórico e Cancelar em "Mais ações" (`central-vendas-mais-acoes`). O testid do ITEM é
 * o mesmo nas duas. TOLERANTE: se o item já está visível, nada é aberto; senão abre o leque (nova) ou "Mais ações"
 * (anterior). Devolve o item visível — quem chama clica ou confere. Roda também no skew contra o web da base.
 */
export async function acaoDaCentral(page: Page, testId: string) {
  await expect(page.getByTestId("central-vendas-acoes"), "a barra da Central montou").toBeVisible();
  const item = page.getByTestId(testId);
  const leque = page.getByTestId("central-vendas-acoes-rapidas");
  if (await leque.count()) {
    // Central nova: quem diz se o leque está aberto é o ⚡ (`aria-expanded`), não a visibilidade do item — um item que
    // ainda está SAINDO (animação de recolher) é visível e some no meio do clique.
    if ((await leque.getAttribute("aria-expanded")) !== "true") {
      await expect(item, "o leque anterior terminou de recolher").toHaveCount(0);
      await leque.click();
    }
    await expect(leque).toHaveAttribute("aria-expanded", "true");
    await expect(item, `a ação ${testId} aparece no leque`).toBeVisible();
    return item;
  }
  // Central anterior: direto na barra, ou em "Mais ações"
  if (await item.isVisible()) return item;
  const mais = page.getByTestId("central-vendas-mais-acoes");
  if (await mais.count()) await mais.click();
  await expect(item, `a ação ${testId} aparece no menu da barra`).toBeVisible();
  return item;
}

/**
 * Abre "Dados adicionais" da Central quando o grupo existe e está recolhido (VISUAL-UX-02: na consulta, Movimento,
 * Versão da operação e Origem moram nele). TOLERANTE: na consulta anterior esses campos estavam soltos em Dados
 * principais e não havia grupo — aí nada é clicado.
 */
export async function abrirDadosAdicionais(page: Page) {
  const dados = page.getByTestId("central-vendas-dados");
  await expect(dados, "Dados principais montou").toBeVisible();
  const grupo = dados.getByRole("button", { name: /^Dados adicionais/ });
  if (!(await grupo.count())) return;
  if ((await grupo.getAttribute("aria-expanded")) !== "true") await grupo.click();
  await expect(grupo).toHaveAttribute("aria-expanded", "true");
}
