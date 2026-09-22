import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * A DM SANS VEM DO PRÓPRIO PROJETO, E ISSO SE MEDE NO NAVEGADOR (FONTE-LOCAL-01).
 *
 * `scripts/fonte-remota-audit.mjs` prova que ninguém IMPORTA `next/font/google`. É necessário e não
 * é suficiente: dizer que o import sumiu não diz que a fonte chegou. Um `next/font/local` apontando
 * para arquivo errado passa no auditor, passa no `pnpm build` se o caminho existir, e entrega a
 * aplicação inteira desenhada com a fonte de reserva — sem erro nenhum, porque cair para a reserva é
 * o comportamento CORRETO do navegador. O prejuízo apareceria como "está um pouco diferente", que é
 * o defeito mais caro de diagnosticar.
 *
 * Então aqui se mede EFEITO, no app de verdade:
 *
 *   1. de onde o arquivo veio     — toda requisição de fonte sai da PRÓPRIA origem, e nenhuma vai
 *                                   para fonts.googleapis.com / fonts.gstatic.com;
 *   2. se ele chegou              — a família efetiva está `loaded` em `document.fonts`;
 *   3. se está sendo USADA        — o texto medido com ela é mais largo que o mesmo texto medido
 *                                   numa família que não existe (a reserva). Se a fonte não tivesse
 *                                   chegado, as duas medidas seriam a MESMA — é esse o falso verde
 *                                   que este arquivo existe para impedir;
 *   4. se os quatro pesos existem — 400/500/600/700 dão larguras ESTRITAMENTE crescentes. O eixo
 *                                   `wght` é contínuo, então cada peso tem avanço próprio; uma
 *                                   reserva estática só teria dois desenhos, e pelo menos um par
 *                                   coincidiria. É assim que "peso sintetizado em silêncio" reprova.
 *
 * NENHUMA MEDIDA ABSOLUTA É ASSERTADA. Largura em pixel depende de versão do navegador e do sistema;
 * fixá-la seria trocar um gate por um alarme falso semestral. O que se cobra é RELAÇÃO — igual à
 * reserva reprova, crescente entre pesos passa —, que é o que a afirmação realmente diz.
 */

const HOSTS_DE_FONTE_REMOTA = /fonts\.(googleapis|gstatic)\.com/;
const FAMILIA_AUSENTE = "__familia_inexistente_para_medir_reserva";
const PESOS = [400, 500, 600, 700] as const;
const AMOSTRA = "Agro ERP — lançamento 1.234,56";

/** Diferença relativa entre duas larguras. */
const distancia = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b);

/** Abaixo disto duas medidas são a MESMA fonte; acima, são fontes diferentes. Medido: 7,4% entre DM Sans e a reserva. */
const SEPARACAO_MINIMA = 0.02;

type Medida = {
  familias: string;
  primeira: string;
  estadoNoDocumento: string | null;
  fonteAplicada: Record<number, string>;
  larguraPorPeso: Record<number, number>;
  larguraNaReserva: number;
};

async function medirFamilia(pagina: Page, amostra = AMOSTRA): Promise<Medida> {
  return pagina.evaluate(async ({ amostra, pesos, ausente }) => {
    await document.fonts.ready;
    const familias = getComputedStyle(document.body).fontFamily;
    const primeira = familias.split(",")[0].trim().replace(/^["']|["']$/g, "");
    const ctx = document.createElement("canvas").getContext("2d")!;
    // `ctx.font` REJEITA valor inválido mantendo o anterior, em silêncio. Sem devolver o que ficou
    // aplicado, uma família escrita errada faria todas as medidas saírem da fonte anterior — e o
    // teste compararia duas vezes a mesma coisa, passando por vacuidade.
    const medir = (peso: number, familia: string) => {
      ctx.font = `${peso} 32px "${familia}"`;
      return { aplicada: ctx.font, largura: ctx.measureText(amostra).width };
    };
    let estadoNoDocumento: string | null = null;
    document.fonts.forEach((f) => { if (f.family === primeira) estadoNoDocumento = f.status; });
    const fonteAplicada: Record<number, string> = {};
    const larguraPorPeso: Record<number, number> = {};
    for (const p of pesos) { const m = medir(p, primeira); fonteAplicada[p] = m.aplicada; larguraPorPeso[p] = m.largura; }
    return { familias, primeira, estadoNoDocumento, fonteAplicada, larguraPorPeso, larguraNaReserva: medir(400, ausente).largura };
  }, { amostra, pesos: [...PESOS], ausente: FAMILIA_AUSENTE });
}

/**
 * A geometria de UMA superfície, e a prova de que o texto DELA está desenhado com a fonte local.
 *
 * A comparação é em três pontas: o que o layout realmente ocupou (`Range`), o que a família local
 * mediria para aquele mesmo texto, peso e tamanho, e o que a reserva mediria. Bater com a primeira e
 * destoar da segunda é o que distingue "usa a fonte" de "tem a fonte declarada".
 */
async function medirSuperficie(pagina: Page, seletor: string) {
  return pagina.evaluate(async ({ seletor, ausente, amostra }) => {
    // Medir antes da troca de fonte compararia o layout da RESERVA com o avanço da fonte local, e o
    // teste acusaria o que ele existe para provar. A espera é do contrato, não conveniência.
    await document.fonts.ready;
    const candidatos = [...document.querySelectorAll(seletor)] as HTMLElement[];
    if (!candidatos.length) throw new Error(`superfície ausente na tela: ${seletor}`);
    // O NÓ DE TEXTO, não o elemento. Um botão de menu carrega ícone junto, e `selectNodeContents`
    // mediria o SVG como se fosse letra — a comparação com o avanço da fonte sairia 22% fora e o
    // teste acusaria fonte de reserva onde só havia uma seta desenhada. E o PRIMEIRO elemento que
    // casa nem sempre tem texto (a primeira coluna da grade é a de seleção): percorre até achar um
    // que tenha, em vez de declarar a superfície ausente.
    let el: HTMLElement | null = null;
    let no: Text | null = null;
    for (const c of candidatos) {
      const andarilho = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
      while (andarilho.nextNode()) {
        const n = andarilho.currentNode as Text;
        if ((n.data ?? "").trim().length > 1 && n.parentElement && n.parentElement.offsetParent !== null) { no = n; break; }
      }
      if (no) { el = c; break; }
    }
    if (!no || !el) throw new Error(`nenhum "${seletor}" visível tem nó de texto para medir (${candidatos.length} candidato(s))`);
    const texto = no.data;
    const est = getComputedStyle(no.parentElement as HTMLElement);
    const primeira = est.fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "");
    const espacamento = est.letterSpacing === "normal" ? 0 : parseFloat(est.letterSpacing) || 0;
    const ctx = document.createElement("canvas").getContext("2d")!;
    const medir = (familia: string) => {
      ctx.font = `${est.fontWeight} ${est.fontSize} "${familia}"`;
      return ctx.measureText(texto).width + espacamento * Math.max(texto.length - 1, 0);
    };
    const faixa = document.createRange();
    faixa.selectNode(no);
    const caixa = el.getBoundingClientRect();
    // DUAS PERGUNTAS DIFERENTES, e por isso duas medidas.
    //
    // O texto DESTA superfície responde "o layout usou a família local?" — e responde com precisão,
    // porque é exatamente o que o navegador desenhou.
    //
    // A separação em relação à reserva NÃO pode ser perguntada ao mesmo texto: um cabeçalho de
    // coluna tem 3 a 9 letras em 12px, e aí a diferença entre duas fontes distintas cabe dentro do
    // arredondamento — "NCM" mede 28,0 na DM Sans e 28,7 na reserva, 2,3%, e bastaria uma palavra um
    // pouco mais curta para o gate acusar reserva onde não há. Então essa pergunta vai para uma
    // amostra longa, medida no MESMO peso e tamanho desta superfície: o que se quer saber é se a
    // família local é uma fonte de verdade ali, não se aquela palavra específica é comprida.
    const medirAmostra = (familia: string) => { ctx.font = `${est.fontWeight} ${est.fontSize} "${familia}"`; return ctx.measureText(amostra).width; };
    return {
      seletor, texto: texto.trim().slice(0, 40), familiaEfetiva: primeira, peso: est.fontWeight, tamanho: est.fontSize,
      larguraDoLayout: faixa.getBoundingClientRect().width,
      larguraNaFamiliaLocal: medir(primeira),
      amostraNaFamiliaLocal: medirAmostra(primeira),
      amostraNaReserva: medirAmostra(ausente),
      caixa: { largura: Math.round(caixa.width * 100) / 100, altura: Math.round(caixa.height * 100) / 100 }
    };
  }, { seletor, ausente: FAMILIA_AUSENTE, amostra: AMOSTRA });
}

test.describe("Tipografia servida do próprio projeto", () => {
  test("T1+T2+T3 · a DM Sans chega da própria origem, carrega e é a família em uso", async ({ page, baseURL }) => {
    const requisicoesDeFonte: string[] = [];
    const requisicoesRemotas: string[] = [];
    page.on("request", (r) => {
      if (HOSTS_DE_FONTE_REMOTA.test(r.url())) requisicoesRemotas.push(r.url());
      if (r.resourceType() === "font") requisicoesDeFonte.push(r.url());
    });

    await login(page);                                            // T1 — app de verdade, autenticado

    // DE ONDE VEIO. A lista precisa ser NÃO VAZIA: "nenhuma requisição remota" também seria verdade
    // numa página que não pediu fonte nenhuma, e aí o verde não provaria nada.
    expect(requisicoesDeFonte.length, "nenhuma requisição de fonte: não há o que provar").toBeGreaterThan(0);
    for (const url of requisicoesDeFonte) {
      expect(url, "toda fonte tem de sair da própria origem").toContain(baseURL!);
    }
    expect(requisicoesDeFonte.some((u) => /dm.?sans/i.test(u)), "a DM Sans precisa estar entre as fontes servidas").toBe(true);
    expect(requisicoesRemotas, "nenhuma requisição pode ir para o Google Fonts").toEqual([]);

    const m = await medirFamilia(page);

    // T2 — a família efetiva do `body` é a local, e ela CARREGOU.
    expect(m.familias, "a cadeia precisa manter a DM Sans nomeada").toMatch(/DM Sans/i);
    expect(m.estadoNoDocumento, `a família efetiva "${m.primeira}" não está carregada em document.fonts`).toBe("loaded");
    for (const p of PESOS) {
      expect(m.fonteAplicada[p], `o canvas recusou a família em silêncio no peso ${p}`).toContain(m.primeira);
    }

    // T2 (continuação) — ESTÁ SENDO USADA. Igual à reserva significaria que não chegou.
    expect(
      distancia(m.larguraPorPeso[400], m.larguraNaReserva),
      `o texto na família "${m.primeira}" mede o mesmo que numa família inexistente (${m.larguraPorPeso[400]} × ${m.larguraNaReserva}): a fonte não está sendo aplicada`
    ).toBeGreaterThan(SEPARACAO_MINIMA);

    // T3 — os quatro pesos existem de verdade, um a um.
    for (let i = 1; i < PESOS.length; i++) {
      const [leve, pesado] = [PESOS[i - 1], PESOS[i]];
      expect(
        m.larguraPorPeso[pesado],
        `peso ${pesado} não ficou mais largo que ${leve} (${m.larguraPorPeso[pesado]} × ${m.larguraPorPeso[leve]}): sinal de reserva estática ou peso sintetizado`
      ).toBeGreaterThan(m.larguraPorPeso[leve]);
    }
    console.log(`[tipografia] família=${m.primeira} pesos=${PESOS.map((p) => `${p}:${m.larguraPorPeso[p].toFixed(1)}`).join(" ")} reserva=${m.larguraNaReserva.toFixed(1)} fontes=${requisicoesDeFonte.length}`);
  });

  test("T4 · as quatro superfícies do contrato desenham com a fonte local", async ({ page }) => {
    await login(page);

    const superficies: { nome: string; ir: () => Promise<void>; seletor: string }[] = [
      { nome: "navegação superior", ir: async () => {}, seletor: '[data-testid="nav-module"]' },
      { nome: "tabela", ir: async () => { await page.goto("/cadastros/products"); await page.locator("thead th").first().waitFor(); }, seletor: "thead th" },
      { nome: "formulário", ir: async () => { await page.goto("/cadastros/products/new"); await page.locator("label").first().waitFor(); }, seletor: "label" },
      // O LANÇADOR, e não uma opção dentro dele. Quantas operações a organização tem é dado de seed;
      // amarrar a prova tipográfica a isso faria o teste falhar num banco recém-criado por um motivo
      // que não tem nada a ver com fonte. O cabeçalho do lançador está lá em qualquer estado.
      { nome: "lançador de Vendas", ir: async () => { await page.goto("/vendas/sales/new"); await page.getByTestId("top-lancador").waitFor(); }, seletor: '[data-testid="top-lancador"]' }
    ];

    const medidas = [];
    for (const s of superficies) {
      await s.ir();
      const m = await medirSuperficie(page, s.seletor);
      medidas.push({ nome: s.nome, ...m });

      expect(m.familiaEfetiva, `${s.nome}: a família efetiva não é a local do body`).not.toMatch(/^(ui-sans-serif|system-ui|sans-serif|Arial|Times)/i);
      // O layout bate com a fonte local e destoa da reserva: é o par que separa "usa" de "declara".
      expect(
        distancia(m.larguraDoLayout, m.larguraNaFamiliaLocal),
        `${s.nome}: o texto ocupou ${m.larguraDoLayout.toFixed(1)}px, e a fonte local mediria ${m.larguraNaFamiliaLocal.toFixed(1)}px`
      ).toBeLessThan(SEPARACAO_MINIMA);
      expect(
        distancia(m.amostraNaFamiliaLocal, m.amostraNaReserva),
        `${s.nome}: no peso ${m.peso} e tamanho ${m.tamanho} a família local mede o MESMO que a reserva (${m.amostraNaFamiliaLocal.toFixed(1)}px × ${m.amostraNaReserva.toFixed(1)}px) — não há fonte local ali`
      ).toBeGreaterThan(SEPARACAO_MINIMA);
      expect(m.caixa.largura, `${s.nome}: caixa sem largura`).toBeGreaterThan(0);
      expect(m.caixa.altura, `${s.nome}: caixa sem altura`).toBeGreaterThan(0);
    }
    console.log(`[geometria] ${medidas.map((m) => `${m.nome}=${m.caixa.largura}x${m.caixa.altura}`).join(" · ")}`);
  });
});
