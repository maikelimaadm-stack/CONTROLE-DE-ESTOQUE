import { test, expect, type Browser, type Page } from "@playwright/test";
import { ADMIN, login } from "./helpers";

/**
 * A NAVEGAÇÃO SUPERIOR TEM DE SER DETERMINÍSTICA DEPOIS QUE A FONTE CARREGA (R3).
 *
 * DOIS DEFEITOS REAIS, medidos, não "flake":
 *
 * A) CONTAGEM CONGELADA. `useFitCount` decide quantos módulos cabem no `useLayoutEffect` e depois só
 *    quando o `ResizeObserver` do contêiner dispara. Com `font-display: swap`, a primeira pintura usa
 *    a fonte de RESERVA; quando a fonte real entra, a largura dos rótulos muda — mas o contêiner não
 *    muda de tamanho, o observador não é obrigado a disparar, e a barra fica exibindo uma quantidade
 *    calculada com métricas que não são mais as da tela. Medido neste projeto, a 1280px: 6 módulos
 *    pelas métricas da reserva, 5 pelas da fonte real. O usuário vê 5 ou 6 conforme o instante em que
 *    o `.woff2` chegou.
 *
 * B) O "MAIS" SE FECHAVA SOZINHO. Ao abrir o mega-menu a partir de um item do overflow, `openFor`
 *    fazia `setMoreOpen(false)` — desmontando o PRÓPRIO elemento sob o ponteiro. O `mouseleave` que
 *    o desmonte provoca no cabeçalho é indistinguível de o usuário ter ido embora, e agenda o
 *    fechamento; se o ponteiro estiver parado (é o caso de todo clique e de todo teste), o mega-menu
 *    fecha no meio da transição.
 *
 * POR QUE ESTE ARQUIVO SEGURA A FONTE. Esperar a corrida acontecer sozinha é o que já aconteceu — uma
 * execução vermelha, a seguinte verde. Aqui a resposta do `.woff2` fica RETIDA até a primeira medição
 * e só então é liberada: o cenário deixa de depender de sorte e passa a ser encenado.
 *
 * NENHUMA CONTAGEM É FIXADA NO TESTE. O esperado é recalculado no navegador pela MESMA conta do
 * componente, a partir das larguras que o DOM tem naquele instante. Fixar "5" trocaria um gate por um
 * alarme falso na primeira mudança de rótulo.
 */

/**
 * Entrar sem esperar os SUBRECURSOS da página.
 *
 * O `login()` compartilhado usa `page.goto` com o padrão `waitUntil: "load"`, e `load` espera a FONTE
 * terminar de carregar. Com a fonte RETIDA de propósito, esperar por `load` seria esperar por nós
 * mesmos — foi exatamente assim que a primeira versão deste arquivo expirou em 60s. `domcontentloaded`
 * é o ponto certo: o documento existe, o React monta, e a fonte continua pendente, que é o cenário.
 */
async function entrarSemEsperarAFonte(pagina: Page) {
  await pagina.goto("/login", { waitUntil: "domcontentloaded" });
  await pagina.fill("#email", ADMIN.email);
  await pagina.fill("#password", ADMIN.password);
  await pagina.getByRole("button", { name: "Entrar" }).click();
  await expect(pagina.getByRole("heading", { name: "Início" })).toBeVisible();
}

/** A mesma aritmética de `useFitCount`, aplicada às larguras que o DOM tem AGORA. */
async function estadoDaBarra(pagina: Page) {
  return pagina.evaluate(() => {
    const MORE_W = 76;                                   // espelha a constante do componente
    const barra = document.querySelector('[data-testid="nav-barra"]') as HTMLElement | null;
    const regua = document.querySelector('[data-testid="nav-medida"]') as HTMLElement | null;
    if (!barra || !regua) throw new Error("navegação superior não montou");
    const larguras = [...regua.children].map((c) => (c as HTMLElement).offsetWidth + 2);
    const disponivel = barra.clientWidth;
    let soma = 0;
    let n = 0;
    for (let i = 0; i < larguras.length; i++) {
      const precisaDoMais = i < larguras.length - 1 ? MORE_W : 0;
      if (soma + larguras[i]! + precisaDoMais <= disponivel) { soma += larguras[i]!; n = i + 1; } else break;
    }
    if (n < larguras.length) { while (n > 0 && soma + MORE_W > disponivel) { n--; soma -= larguras[n]!; } }
    return {
      cabemPelasMetricasAtuais: n,
      renderizadosNaBarra: document.querySelectorAll('[data-testid="nav-barra"] > [data-testid="nav-module"]').length,
      total: larguras.length,
      larguras,
      disponivel,
      somaDasLarguras: Math.round(larguras.reduce((a, b) => a + b, 0))
    };
  });
}

/**
 * Retém toda resposta de `.woff2` até o liberador ser chamado.
 *
 * `document.fonts.ready` fica PENDENTE enquanto a requisição não se resolve, e é isso que dá ao teste
 * um antes e um depois nítidos em vez de uma janela de milissegundos.
 */
async function reterFonte(pagina: Page) {
  let liberar!: () => void;
  const retida = new Promise<void>((resolve) => { liberar = resolve; });
  let retidas = 0;
  await pagina.route("**/*.woff2", async (rota) => {
    retidas += 1;
    await retida;
    await rota.continue();
  });
  return { liberar: () => liberar(), quantasRetidas: () => retidas };
}

/** A conta de `useFitCount`, feita fora do navegador, para calibrar o cenário. */
function quantosCabem(larguras: number[], disponivel: number) {
  const MORE_W = 76;
  let soma = 0;
  let n = 0;
  for (let i = 0; i < larguras.length; i++) {
    const precisaDoMais = i < larguras.length - 1 ? MORE_W : 0;
    if (soma + larguras[i]! + precisaDoMais <= disponivel) { soma += larguras[i]!; n = i + 1; } else break;
  }
  if (n < larguras.length) { while (n > 0 && soma + MORE_W > disponivel) { n--; soma -= larguras[n]!; } }
  return n;
}

/**
 * Descobre uma largura de janela em que a troca de fonte REALMENTE muda a contagem.
 *
 * A primeira versão disto previa o espaço disponível como "viewport menos uma constante". Era falso: o
 * cabeçalho redistribui espaço entre marca, barra e ferramentas, então a constante não existe — a
 * previsão apontou 910px, onde na prática os dois regimes exibem 3. Aqui o espaço é MEDIDO em cada
 * largura, nos dois regimes, e a escolha sai da medição.
 */
async function calibrarLarguraQueDiverge(navegador: Browser) {
  const candidatas: number[] = [];
  for (let w = 780; w <= 1580; w += 20) candidatas.push(w);

  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 720 }, locale: "pt-BR" });
  const pagina = await contexto.newPage();
  try {
    const fonte = await reterFonte(pagina);
    await entrarSemEsperarAFonte(pagina);
    await expect(pagina.locator('[data-testid="nav-barra"] > [data-testid="nav-module"]').first()).toBeVisible();

    const varrer = async () => {
      const espaco = new Map<number, number>();
      for (const w of candidatas) {
        await pagina.setViewportSize({ width: w, height: 720 });
        espaco.set(w, (await estadoDaBarra(pagina)).disponivel);
      }
      await pagina.setViewportSize({ width: 1280, height: 720 });
      return espaco;
    };

    const espacoReserva = await varrer();
    const larguraReserva = (await estadoDaBarra(pagina)).larguras;

    fonte.liberar();
    await pagina.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect.poll(async () => (await estadoDaBarra(pagina)).somaDasLarguras, { timeout: 10_000 }).not.toBe(larguraReserva.reduce((a, b) => a + b, 0));

    const espacoReal = await varrer();
    const larguraReal = (await estadoDaBarra(pagina)).larguras;

    for (const w of candidatas) {
      const comReserva = quantosCabem(larguraReserva, espacoReserva.get(w)!);
      const comFonte = quantosCabem(larguraReal, espacoReal.get(w)!);
      if (comReserva !== comFonte && comReserva > 0 && comFonte > 0) return { largura: w, comReserva, comFonte };
    }
    return { largura: 0, comReserva: 0, comFonte: 0 };
  } finally {
    await contexto.close();
  }
}

/** Encena a corrida uma vez, num contexto novo (fonte não cacheada) e num viewport dado. */
async function encenarTrocaDeFonte(navegador: Browser, largura: number) {
  const contexto = await navegador.newContext({ viewport: { width: largura, height: 720 }, locale: "pt-BR" });
  const pagina = await contexto.newPage();
  try {
    const fonte = await reterFonte(pagina);
    await entrarSemEsperarAFonte(pagina);
    await expect(pagina.locator('[data-testid="nav-barra"] > [data-testid="nav-module"]').first()).toBeVisible();
    const retidas = fonte.quantasRetidas();
    const antes = await estadoDaBarra(pagina);

    fonte.liberar();
    await pagina.evaluate(() => document.fonts.ready.then(() => undefined));
    // Espera a MUDANÇA das métricas, não um tempo arbitrário.
    await expect.poll(async () => (await estadoDaBarra(pagina)).somaDasLarguras, { timeout: 10_000 }).not.toBe(antes.somaDasLarguras);

    const depois = await estadoDaBarra(pagina);
    return { retidas, antes, depois };
  } finally {
    await contexto.close();
  }
}

test.describe("Navegação superior · a contagem acompanha a fonte efetiva", () => {
  test("FT1–FT5 · a fonte chega DEPOIS da primeira medição e a barra se corrige sem resize", async ({ browser }) => {
    // POR QUE CALIBRAR, e não fixar um viewport.
    //
    // A troca de fonte muda a largura dos rótulos, mas só muda a CONTAGEM em algumas larguras de
    // janela: nas outras a diferença não cruza limiar nenhum e os dois regimes exibem o mesmo número.
    // No viewport padrão (1280) é exatamente esse o caso — foi por isso que a corrida passou tanto
    // tempo invisível. E fixar outra largura seria apostar que o CI tem as mesmas fontes instaladas
    // que esta máquina; aqui, por exemplo, a reserva `local("Arial")` NEM EXISTE e a cadeia cai no
    // padrão do sistema. Então o teste mede os dois regimes e escolhe onde eles divergem.
    const alvo = await calibrarLarguraQueDiverge(browser);
    expect(alvo.largura, "não há largura de janela em que a troca de fonte mude a contagem: o cenário não pode ser provado neste ambiente").toBeGreaterThan(0);

    const r = await encenarTrocaDeFonte(browser, alvo.largura);

    // FT1 — a fonte foi mesmo retida (sem isso, não houve encenação nenhuma).
    expect(r.retidas, "nenhum .woff2 foi retido: o cenário não encenou nada").toBeGreaterThan(0);

    // FT2 — antes da fonte, a barra é coerente com as métricas da reserva.
    expect(r.antes.renderizadosNaBarra, `antes da fonte: exibe ${r.antes.renderizadosNaBarra}, cabiam ${r.antes.cabemPelasMetricasAtuais}`).toBe(r.antes.cabemPelasMetricasAtuais);

    // GUARDA DE VACUIDADE — os dois regimes TÊM de divergir, senão o verde não separa nada.
    expect(
      r.depois.cabemPelasMetricasAtuais,
      `em ${alvo.largura}px os dois regimes cabem o mesmo (${r.antes.cabemPelasMetricasAtuais}); este verde não provaria nada`
    ).not.toBe(r.antes.cabemPelasMetricasAtuais);

    // FT5 — SEM nenhum resize, a barra passou a refletir as métricas finais.
    expect(
      r.depois.renderizadosNaBarra,
      `depois da fonte: exibe ${r.depois.renderizadosNaBarra}, deveria exibir ${r.depois.cabemPelasMetricasAtuais} — a contagem ficou congelada nas métricas da reserva`
    ).toBe(r.depois.cabemPelasMetricasAtuais);

    console.log(`[fit] janela ${alvo.largura}px · reserva ${r.antes.renderizadosNaBarra}/${r.antes.total} (soma ${r.antes.somaDasLarguras}) → fonte real ${r.depois.renderizadosNaBarra}/${r.depois.total} (soma ${r.depois.somaDasLarguras})`);
  });

  test("FT6 · o mesmo cenário, repetido, dá sempre o mesmo resultado", async ({ browser }) => {
    const alvo = await calibrarLarguraQueDiverge(browser);
    expect(alvo.largura, "sem largura divergente, não há o que repetir").toBeGreaterThan(0);

    const finais: string[] = [];
    for (let volta = 0; volta < 3; volta++) {
      const r = await encenarTrocaDeFonte(browser, alvo.largura);
      expect(r.depois.renderizadosNaBarra, `volta ${volta + 1}: barra fora das métricas finais`).toBe(r.depois.cabemPelasMetricasAtuais);
      finais.push(`${r.antes.renderizadosNaBarra}->${r.depois.renderizadosNaBarra}`);
    }
    expect(new Set(finais).size, `o resultado variou entre as voltas: ${finais.join(", ")}`).toBe(1);
    console.log(`[fit] 3 voltas independentes em ${alvo.largura}px, mesmo resultado: ${finais.join(" · ")}`);
  });

  test("RV7 · redimensionar a janela continua sendo detectado", async ({ page }) => {
    await login(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const largo = await estadoDaBarra(page);
    await page.setViewportSize({ width: 820, height: 720 });
    await expect.poll(async () => (await estadoDaBarra(page)).renderizadosNaBarra).toBeLessThan(largo.renderizadosNaBarra);
    const estreito = await estadoDaBarra(page);
    expect(estreito.renderizadosNaBarra).toBe(estreito.cabemPelasMetricasAtuais);
    console.log(`[resize] 1280 → ${largo.renderizadosNaBarra} módulos · 820 → ${estreito.renderizadosNaBarra} módulos`);
  });
});

/** O tempo que o próprio componente espera antes de fechar (`scheduleClose`), com folga. */
const ALEM_DO_TIMER_DE_FECHAMENTO = 420;

/**
 * Espera a barra PARAR de se mexer antes de interagir com ela.
 *
 * Não é conforto de teste: é precondição. A própria correção desta rodada faz a contagem ser
 * recalculada quando a fonte entra, e `document.fonts.ready` resolve um instante ANTES de o React
 * comprometer o novo estado. Quem abrisse o "Mais" nessa fresta veria a lista do overflow se refazer
 * debaixo do ponteiro — e foi exatamente isso que reprovou 3 de 5 voltas da primeira repetição, com
 * `element was detached from the DOM`. O produto está correto: a barra se acomoda. O que estava
 * errado era o teste medir durante a acomodação.
 */
async function barraEstavel(pagina: Page) {
  await expect
    .poll(async () => { const e = await estadoDaBarra(pagina); return e.renderizadosNaBarra === e.cabemPelasMetricasAtuais; }, { timeout: 10_000 })
    .toBe(true);
  // Duas leituras iguais em sequência: se ainda houvesse um recálculo a caminho, a segunda difere.
  const primeira = await estadoDaBarra(pagina);
  await pagina.waitForTimeout(150);
  const segunda = await estadoDaBarra(pagina);
  expect(segunda.renderizadosNaBarra, "a barra ainda estava se acomodando").toBe(primeira.renderizadosNaBarra);
}

/** Um módulo que está no menu "Mais" neste viewport. */
async function moduloNoOverflow(pagina: Page) {
  await barraEstavel(pagina);
  await pagina.getByTestId("nav-more").click();
  const item = pagina.locator('[data-testid="nav-mais-menu"] [data-testid="nav-module"]').first();
  await expect(item, "não há módulo no overflow neste viewport").toBeVisible();
  return { item, id: await item.getAttribute("data-module-btn") };
}

test.describe("Navegação superior · o menu Mais não se fecha sozinho", () => {
  test("M1–M5 · abrir pelo overflow mantém o mega-menu aberto e navegável", async ({ page }) => {
    await login(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    // M1/M2 — existe overflow, e o "Mais" abre.
    const { item, id } = await moduloNoOverflow(page);

    // M3 — escolher um módulo do overflow.
    await item.click();

    // M4 — e ele CONTINUA aberto depois de o temporizador de fechamento do componente ter passado.
    //      `toBeVisible` sozinho não provaria: ele reconsulta e passaria num menu que abriu e fechou.
    await expect(page.getByTestId("mega-menu")).toBeVisible();
    await page.waitForTimeout(ALEM_DO_TIMER_DE_FECHAMENTO);
    await expect(
      page.getByTestId("mega-menu"),
      `o mega-menu de ${id} fechou sozinho depois de aberto pelo overflow`
    ).toBeVisible();

    // M5 — e uma opção dele navega de verdade.
    const opcao = page.getByTestId("mega-menu").getByTestId("mega-item").first();
    const destino = await opcao.getAttribute("href");
    await opcao.click();
    await expect(page).toHaveURL(new RegExp(destino!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  test("M6 · Escape fecha o mega-menu aberto pelo overflow", async ({ page }) => {
    await login(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const { item } = await moduloNoOverflow(page);
    await item.click();
    await expect(page.getByTestId("mega-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("mega-menu")).toBeHidden();
  });

  test("M7 · o teclado ativa um item do overflow", async ({ page }) => {
    await login(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const { item } = await moduloNoOverflow(page);
    await item.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("mega-menu")).toBeVisible();
    await page.waitForTimeout(ALEM_DO_TIMER_DE_FECHAMENTO);
    await expect(page.getByTestId("mega-menu"), "aberto pelo teclado e fechou sozinho").toBeVisible();
  });

  test("M8 · levar o ponteiro até o mega-menu não fecha no meio", async ({ page }) => {
    await login(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const { item } = await moduloNoOverflow(page);
    await item.click();
    await expect(page.getByTestId("mega-menu")).toBeVisible();

    // O ponteiro atravessa devagar, como o de uma pessoa — é no meio do caminho que o fechamento batia.
    const destino = await page.getByTestId("mega-menu").boundingBox();
    await page.mouse.move(destino!.x + destino!.width / 2, destino!.y + destino!.height / 2, { steps: 12 });
    await page.waitForTimeout(ALEM_DO_TIMER_DE_FECHAMENTO);
    await expect(page.getByTestId("mega-menu"), "fechou durante a travessia do ponteiro").toBeVisible();
  });

  test("M9 · passar o ponteiro sobre um item do overflow NÃO o faz sumir debaixo do cursor", async ({ page }) => {
    await login(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const { item, id } = await moduloNoOverflow(page);

    // ESTE É O DEFEITO, e o caso existe para que ele não volte.
    // O item tinha `onMouseEnter={openFor}`, e `openFor` fecha o "Mais": o próprio elemento sob o
    // ponteiro desmontava. Aqui o hover acontece e o item TEM de continuar lá, apontável e clicável.
    await item.hover();
    await page.waitForTimeout(ALEM_DO_TIMER_DE_FECHAMENTO);
    await expect(item, `o item ${id} desapareceu ao receber o ponteiro`).toBeVisible();

    // E continua funcionando: o clique depois do hover abre o mega-menu.
    await item.click();
    await expect(page.getByTestId("mega-menu")).toBeVisible();
  });

  test("M8b · sair de vez com o ponteiro AINDA fecha (a correção não pode travar o menu aberto)", async ({ page }) => {
    await login(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const { item } = await moduloNoOverflow(page);
    await item.click();
    await expect(page.getByTestId("mega-menu")).toBeVisible();

    const caixa = await page.getByTestId("mega-menu").boundingBox();
    await page.mouse.move(caixa!.x + caixa!.width / 2, caixa!.y + caixa!.height / 2, { steps: 8 });
    await page.mouse.move(caixa!.x + caixa!.width / 2, caixa!.y + caixa!.height + 260, { steps: 10 });
    await expect(page.getByTestId("mega-menu"), "o menu ficou preso aberto depois de o ponteiro sair").toBeHidden();
  });
});
