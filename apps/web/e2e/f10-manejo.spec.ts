import { test, expect, type Page } from "@playwright/test";
import { withdrawalUntil } from "@agro/domain";
import { login } from "./helpers";
import { contarEscritas, corpoDoPost, criarTopDoModulo, excluirTopDoModulo, exigir, sqlE2e, tiposDoModulo } from "./f10-comum";
import { animaisNovos, empresaELocal, escolherNoCampo, loteDeAnimaisNovo, produtoComSaldo, rebanhoNovo } from "./f10-pecuaria-comum";

/**
 * OPERACOES-01 F10 (decisão 287) · A CENTRAL DO MANEJO — nutrição e sanitário no motor da Central.
 *
 * O que se prova, na tela e no fio, contra a API deste HEAD:
 *   · F10-J1 (sanitário, 3 animais identificados, dose 2): o Local de estoque vem ANTES do Produto; sem animal, o Salvar
 *     não envia nada e a pendência diz "Inclua ao menos um animal."; o Resumo mostra 3 cabeças e a quantidade do
 *     produto 6 (a MESMA conta do servidor) e a carência pelo cadastro do produto; o POST leva CADA animal com
 *     `quantity: "1"` — a cabeça (a tela anterior mandava a dose no lugar dela) — e as chaves de hoje mais a TOP (a
 *     capacidade está declarada); o razão baixa 6 com o lote de animais como destino; o detalhe mostra 6 e a carência;
 *   · F10-J2 (nutrição, rebanho por contagem de 10 cabeças, dose 0,5): o POST leva `[{ herd_lot_id, quantity: "10" }]` e
 *     a quantidade do produto é 5 no Resumo, na resposta e no razão;
 *   · F10-J3 (a TOP do manejo): a TOP PADRÃO da família, que exige a observação, já vem escolhida no campo; sem a
 *     observação, o Salvar não envia nada e a pendência tem o MESMO texto da recusa do servidor; com ela, o POST leva a
 *     TOP e o servidor a grava com a versão congelada.
 * Cada caso cria os PRÓPRIOS cadastros e saldo (`f10-pecuaria-comum.ts`).
 */
const P = "central-manejo";
const CHAVES_DO_POST = ["batch_id", "dose", "empresa_id", "handling_date", "handling_type", "items", "note", "product_id", "provider_lot", "responsible", "tipo_operacao_id", "warehouse_id"];
const CHAVES_DA_RESPOSTA = ["animals", "code", "id", "total", "withdrawal_until"];

/** O valor do campo da lista de definição do detalhe (`KV`: `<dt>` rótulo, `<dd>` valor). */
const valorNoDetalhe = (page: Page, rotulo: string) => page.locator("dt", { hasText: new RegExp(`^${rotulo}$`) }).locator("xpath=following-sibling::dd[1]");

test.describe("OPERACOES-01 F10 · a Central do manejo", () => {
  test("F10-J1 — sanitário com 3 animais e dose 2: Local antes do Produto, pendência sem animal, Resumo 3 cabeças × 2 = 6, cada animal com quantity '1', baixa de 6 com o lote de animais e a carência", async ({ page }) => {
    await login(page);
    const { empresa, local } = await empresaELocal(page, "manejo J1");
    const produto = await produtoComSaldo(page, { empresa, local: local.id, rotulo: "vacina J1", quantidade: "50", custo: "4", extra: { withdrawal_period_days: 10 } });
    const lote = await loteDeAnimaisNovo(page, empresa, "lote J1");
    const animais = await animaisNovos(page, { empresa, lote: lote.id, n: 3, marca: `J1${Date.now().toString(36)}` });
    const capacidade = await tiposDoModulo(page, "manejo");
    expect(capacidade.status, "premissa: a API deste HEAD declara a capacidade do manejo").toBe(200);

    await page.goto("/pecuaria/manejo/sanitary/new");
    await expect(page.getByTestId(`${P}-identidade-nome`)).toHaveText("Novo manejo sanitário");
    await expect(page.getByTestId(`${P}-top`), "com a capacidade, o campo Tipo de operação aparece").toBeVisible();
    const rotulos = (await page.getByTestId(`${P}-dados`).locator("[data-parte='rotulo']").allInnerTexts()).map((t) => t.replace(/\s*\*\s*$/, "").trim());
    expect(rotulos.indexOf("Local de estoque"), "premissa: os Dados têm o Local de estoque").toBeGreaterThan(-1);
    expect(rotulos.indexOf("Local de estoque"), "o Local de estoque vem ANTES do Produto").toBeLessThan(rotulos.indexOf("Produto"));

    await escolherNoCampo(page, page.getByTestId(`${P}-campo-lote`), lote.nome);
    await escolherNoCampo(page, page.getByTestId(`${P}-campo-local`), local.nome);
    await escolherNoCampo(page, page.getByTestId(`${P}-campo-produto`), produto.nome);
    await page.getByTestId(`${P}-campo-dose`).locator("input").fill("2");

    // sem animal: o Salvar abre a pendência e NADA sai
    const escritas = contarEscritas(page, "/api/livestock/handlings");
    await page.getByTestId(`${P}-salvar`).click();
    await expect(page.getByTestId(`${P}-pendencias-lista`), "a pendência do item").toContainText("Inclua ao menos um animal.");
    expect(escritas.total(), "com pendência, nenhum POST").toBe(0);
    await page.keyboard.press("Escape");

    const grade = page.getByTestId(`${P}-animais`);
    await expect(grade.getByText("Todos (3)"), "premissa: o seletor mostra os 3 animais do lote").toBeVisible();
    await grade.getByText("Todos (3)").click();
    await expect(grade.getByText("3 selecionado(s)")).toBeVisible();
    await expect(page.getByTestId(`${P}-resumo-cabecas`), "Resumo: 3 cabeças").toContainText(/^Cabeças\s*3$/);
    await expect(page.getByTestId(`${P}-resumo-quantidade`), "Resumo: dose 2 × 3 cabeças").toContainText("6,0000");
    const data = await page.getByTestId(`${P}-campo-data`).locator("input[type='hidden']").inputValue();
    const carencia = withdrawalUntil(data, 10);
    expect(carencia, "premissa: o produto tem 10 dias de carência").toBeTruthy();
    const carenciaBR = carencia!.split("-").reverse().join("/");
    await expect(page.getByTestId(`${P}-resumo-carencia`), "Resumo: a carência pelo cadastro do produto").toContainText(carenciaBR);

    const escrita = corpoDoPost(page, "/api/livestock/handlings");
    await page.getByTestId(`${P}-salvar`).click();
    const { corpo, status, resposta } = await escrita;
    expect(status, JSON.stringify(resposta)).toBe(201);
    expect(Object.keys(corpo).sort(), "as chaves de hoje, mais a TOP (a capacidade está declarada)").toEqual(CHAVES_DO_POST);
    expect(corpo["tipo_operacao_id"], "a TOP é a padrão da família (ou nenhuma)").toBe(capacidade.corpo.defaultId);
    expect([corpo["handling_type"], corpo["batch_id"], corpo["warehouse_id"], corpo["product_id"], corpo["dose"]]).toEqual(["sanitary", lote.id, local.id, produto.id, "2"]);
    const itens = corpo["items"] as { animal_id: string; quantity: string }[];
    expect([...itens].sort((a, b) => a.animal_id.localeCompare(b.animal_id)), "CADA animal com quantity '1' — a cabeça, nunca a dose")
      .toEqual([...animais].sort().map((animal_id) => ({ animal_id, quantity: "1" })));
    expect(Object.keys(resposta).sort(), "a resposta de hoje, chave por chave").toEqual(CHAVES_DA_RESPOSTA);
    expect([resposta["animals"], resposta["total"], resposta["withdrawal_until"]], "3 cabeças; 6 × 4,00 = 24,00; a carência").toEqual([3, "24.00", carencia]);
    await expect(page).toHaveURL(/\/pecuaria\?tab=manejos&type=sanitary$/);

    const id = String(resposta["id"]);
    expect(sqlE2e(`select movement_type || '|' || quantity::text || '|' || coalesce(lote_animais_id::text, '-') from erp.stock_movements where source_type = 'animal_handlings' and source_id = '${id}'`),
      "o razão baixou 6 (dose × cabeças), com o lote de animais como destino").toBe(`nutrition|6.0000|${lote.id}`);

    await page.goto(`/pecuaria/manejo/sanitary/${id}`);
    await expect(valorNoDetalhe(page, "Quantidade total"), "o detalhe mostra a quantidade 6").toHaveText("6,0000");
    await expect(valorNoDetalhe(page, "Carência até"), "e a carência").toHaveText(carenciaBR);
    await expect(valorNoDetalhe(page, "Animais")).toHaveText("3");
  });

  test("F10-J2 — nutrição por contagem: 10 cabeças × dose 0,5 → o POST leva [{ herd_lot_id, quantity: '10' }] e a quantidade é 5", async ({ page }) => {
    await login(page);
    const { empresa, local } = await empresaELocal(page, "manejo J2");
    const produto = await produtoComSaldo(page, { empresa, local: local.id, rotulo: "sal J2", quantidade: "20", custo: "3" });
    const lote = await loteDeAnimaisNovo(page, empresa, "lote J2");
    const rebanho = await rebanhoNovo(page, { empresa, lote: lote.id, cabecas: 10 });

    await page.goto("/pecuaria/manejo/nutrition/new");
    await expect(page.getByTestId(`${P}-identidade-nome`)).toHaveText("Novo manejo de nutrição");
    await escolherNoCampo(page, page.getByTestId(`${P}-campo-local`), local.nome);
    await escolherNoCampo(page, page.getByTestId(`${P}-campo-produto`), produto.nome);
    await page.getByTestId(`${P}-campo-dose`).locator("input").fill("0.5");
    await page.getByTestId(`${P}-modo`).selectOption("count");
    await page.getByTestId(`${P}-rebanho`).locator("select").selectOption(rebanho);
    await page.getByTestId(`${P}-cabecas`).fill("10");
    await expect(page.getByTestId(`${P}-resumo-cabecas`)).toContainText(/^Cabeças\s*10$/);
    await expect(page.getByTestId(`${P}-resumo-quantidade`), "Resumo: dose 0,5 × 10 cabeças").toContainText("5,0000");
    await expect(page.getByTestId(`${P}-resumo-carencia`), "nutrição não tem carência").toHaveCount(0);

    const escrita = corpoDoPost(page, "/api/livestock/handlings");
    await page.getByTestId(`${P}-salvar`).click();
    const { corpo, status, resposta } = await escrita;
    expect(status, JSON.stringify(resposta)).toBe(201);
    expect(corpo["items"], "o rebanho por contagem vai com as CABEÇAS").toEqual([{ herd_lot_id: rebanho, quantity: "10" }]);
    expect([corpo["handling_type"], corpo["dose"]]).toEqual(["nutrition", "0.5"]);
    expect([resposta["animals"], resposta["total"]], "10 cabeças; 5 × 3,00 = 15,00").toEqual([10, "15.00"]);
    expect(sqlE2e(`select quantity::text from erp.stock_movements where source_type = 'animal_handlings' and source_id = '${String(resposta["id"])}'`),
      "o razão baixou 5").toBe("5.0000");
    expect(sqlE2e(`select quantity::text from erp.animal_handlings where id = '${String(resposta["id"])}'`), "o manejo gravou 5").toBe("5.0000");
  });

  test("F10-J3 — a TOP padrão do manejo que exige a observação: vem escolhida, segura o Salvar com a pendência do servidor e, com a observação, viaja e é gravada", async ({ page }) => {
    await login(page);
    const top = await criarTopDoModulo(page, "manejo", exigir("exigeObservacao"), { padrao: true });
    try {
      const capacidade = await tiposDoModulo(page, "manejo");
      expect([capacidade.status, capacidade.corpo.defaultId], "premissa: a TOP do caso é a padrão da família").toEqual([200, top.id]);
      expect(capacidade.corpo.items.find((t) => t.id === top.id)?.camposExigidos, "premissa: ela exige a observação").toEqual(["note"]);
      const { empresa } = await empresaELocal(page, "manejo J3");
      const lote = await loteDeAnimaisNovo(page, empresa, "lote J3");
      await animaisNovos(page, { empresa, lote: lote.id, n: 1, marca: `J3${Date.now().toString(36)}` });

      await page.goto("/pecuaria/manejo/sanitary/new");
      await expect(page.getByTestId(`${P}-top`), "a TOP padrão já vem escolhida").toHaveValue(top.id);
      await escolherNoCampo(page, page.getByTestId(`${P}-campo-lote`), lote.nome);
      const grade = page.getByTestId(`${P}-animais`);
      await expect(grade.getByText("Todos (1)")).toBeVisible();
      await grade.getByText("Todos (1)").click();

      const escritas = contarEscritas(page, "/api/livestock/handlings");
      await page.getByTestId(`${P}-salvar`).click();
      await expect(page.getByTestId(`${P}-pendencias-lista`), "a exigência da TOP, com o texto da recusa do servidor").toContainText("Observação é obrigatório nesta operação.");
      expect(escritas.total(), "com a pendência, nenhum POST").toBe(0);
      await page.keyboard.press("Escape");

      await page.getByTestId(`${P}-campo-observacao`).locator("textarea").fill("F10-J3 observação exigida");
      const escrita = corpoDoPost(page, "/api/livestock/handlings");
      await page.getByTestId(`${P}-salvar`).click();
      const { corpo, status, resposta } = await escrita;
      expect(status, JSON.stringify(resposta)).toBe(201);
      expect([corpo["tipo_operacao_id"], corpo["note"]], "a TOP e a observação viajam").toEqual([top.id, "F10-J3 observação exigida"]);
      expect(sqlE2e(`select (h.tipo_operacao_id = '${top.id}' and v.tipo_operacao_id = h.tipo_operacao_id)::text from erp.animal_handlings h join erp.tipos_operacao_versoes v on v.id = h.tipo_operacao_versao_id where h.id = '${String(resposta["id"])}'`),
        "o servidor gravou a TOP com a versão congelada").toBe("true");
    } finally {
      await excluirTopDoModulo(page, top.id);
    }
  });
});
