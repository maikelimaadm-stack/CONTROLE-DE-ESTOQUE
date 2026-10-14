import { test as testeSemNavegador, type Page } from "@playwright/test";
import { D } from "@agro/shared";
import { api, login } from "./helpers";
import { shaDaBase } from "./skew-fonte-da-base";
import { vigiar, type Mundo } from "./operacoes-01-f2-skew-comum";
import { escolherNoSeletor, fonteDoCommitContem, fonteDoHeadContem } from "./xml-02-comum";
import {
  COBRANCA_DO_CENARIO, COMMITS_DA_XML04, MARCA_DA_XML04, abrirConferenciaDaXml04, caminho, cenarioDaXml04, compraNoBanco, dataComoSeDigita, expect, importarNotaDaXml04,
  irParaAba, nDo, test, testidsDaXml04NaTela, textoNormalizado, vinculoNoFio, vinculosDoFornecedor, webDaBaseTemAXml04, type CenarioDaXml04, type ConferenciaNoFioDaXml04
} from "./xml-04-comum";

/**
 * XML-04 (decisão 318) · K2, SENTIDO 2 — O WEB DA BASE CONTRA A API DESTE HEAD (a janela "API antes do web" da
 * DEPLOYMENT, e a reversão só do web).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 2 roda em `playwright.skew-web-anterior.config.ts`, cujo `testMatch` é
 * `/skew-web-anterior\.spec\.ts/` (sem âncora: casa com o fim deste nome); o `playwright.config.ts` comum ignora o mesmo
 * padrão — este arquivo NUNCA roda na suíte comum (lá o web seria o deste HEAD e o caso não mediria o cliente anterior).
 * Sem passo no CI: o job `skew` roda a config inteira, e o arquivo entra pelo nome.
 *
 * O QUE SE MEDE. A conferência da API deste HEAD é ADITIVA: `itens[].vinculo.fatorPelaNota`, `financeiro.forma` e os
 * campos novos de `financeiro.parcelas`; o fator PERGUNTADO continua vindo "1" (o valor de compatibilidade) e as
 * divergências novas do fator (`fator_a_informar`, `fator_do_vinculo_diferente_do_cadastro`) chegam com
 * `bloqueia: false`. O navegador roda o bundle EXATO da base com a nota de 10 itens da medição (`xml-04-comum.ts`) e o
 * tPag da nota LIGADO a uma forma (fixture do caso: a API deste HEAD tem o cadastro). PREMISSA, NO FIO: a conferência
 * que a tela recebeu TINHA o fator pela nota, as perguntas com "1", os avisos que não bloqueiam e a forma ligada (é a
 * API nova). O VIGIA: nenhuma resposta 404/422/5xx da API nova ao cliente da base e nenhuma requisição morta.
 *
 * O MUNDO DO WEB DA BASE é lido do FONTE do commit (`webDaBaseTemAXml04`: o `apps/web/src` diz a origem do fator,
 * `fator-origem`; reprova quando não consegue ler):
 *   · LEGADO (a base sem a XML-04): a conferência ABRE (nem "indisponível", nem "não sei ler"); os itens perguntados
 *     aparecem com o fator 1 (o valor de compatibilidade) e o lembrado com o 6 do vínculo; as divergências novas do
 *     fator aparecem na aba Divergências como AVISO (não bloqueiam); o "Gerar compra" dá 201. O RISCO DECLARADO DA JANELA
 *     — a pessoa que não confere gera com o "1" nos itens perguntados, e a forma da nota não vem escolhida — fica
 *     OBSERVADO e registrado (`[skew] …` no log), como FATO da janela (é a tela de hoje): o que se afirma é o que não
 *     pode quebrar — lê, avisa sem bloquear e gera;
 *   · NOVO (a base já com a XML-04, depois do merge): o web da base é o deste HEAD — o campo vazio na pergunta (a
 *     pessoa digita) e a forma da nota escolhida; o "Gerar compra" dá 201 com a forma da nota.
 *
 * PROVA REVERSA DO DETECTOR: o caso "detector" (sem navegador) roda `webDaBaseTemAXml04` sobre dois commits fixos — a
 * main antes da XML-04 ⇒ falso; o commit da XML-04 na branch da fatia ⇒ verdadeiro; este HEAD ⇒ verdadeiro.
 *
 * OS DADOS nascem pela API DESTE HEAD (as portas de `central-compras-fixtures`, com a exclusão lógica no fim do caso; a
 * ligação tPag → forma pela fixture `ligacoes`, desligada no fim); a compra, a importação e os vínculos ficam (decisão 247).
 */

/** O mundo do web da base, pelo fonte do commit. */
function mundoDoWebDaBase(): Mundo {
  const sha = shaDaBase();
  const mundo: Mundo = webDaBaseTemAXml04(sha) ? "novo" : "legado";
  console.log(`[skew] XML-04 · K2 · o web da base ${sha.slice(0, 8)} ${mundo === "novo" ? "TEM" : "NÃO tem"} ${MARCA_DA_XML04.web} → mundo ${mundo}`);
  return mundo;
}

/** A API julgada é a deste HEAD: o fator pela nota, as perguntas com o "1" de compatibilidade, os avisos que não bloqueiam e a forma ligada. */
function premissaDaApiNova(conf: ConferenciaNoFioDaXml04, c: CenarioDaXml04, contexto: string) {
  const n = { U1: nDo(c, "U1"), U2: nDo(c, "U2"), V: nDo(c, "V") };
  expect(c.itensDoCenario.map((_, k) => vinculoNoFio(conf, k + 1).fatorPelaNota?.origem ?? null), `${contexto}: o fator pela nota de cada item`)
    .toEqual(c.itensDoCenario.map((i) => (i.grupo === "principal" ? "unidade_principal" : i.grupo === "alternativa" ? "unidade_do_produto" : i.grupo === "fora_do_cadastro" ? "pergunta" : "vinculo")));
  expect([n.U1, n.U2].map((k) => D(vinculoNoFio(conf, k).fator ?? "0").toFixed()), `${contexto}: a pergunta continua mandando "1" (compatibilidade)`).toEqual(["1", "1"]);
  expect(conf.divergencias.filter((d) => /fator/.test(d.codigo)).map((d) => [d.codigo, d.nItem, d.bloqueia]), `${contexto}: os avisos novos do fator, nenhum bloqueia`)
    .toEqual([["fator_a_informar", n.U1, false], ["fator_a_informar", n.U2, false], ["fator_do_vinculo_diferente_do_cadastro", n.V, false]]);
  expect(conf.financeiro.forma, `${contexto}: a forma da nota, ligada`).toEqual({ situacao: "ligada", tPag: COBRANCA_DO_CENARIO.tPag, forma: { id: c.formaCerta.id, nome: c.formaCerta.label } });
}

/** O vencimento (a condição: as duplicatas não fecham), a natureza e o centro do documento, na aba Financeiro. */
async function resolverOFinanceiro(page: Page, c: CenarioDaXml04) {
  await irParaAba(page, "financeiro");
  const vencimento = page.getByTestId("importacao-aba-financeiro").getByLabel("Vencimento", { exact: true });
  await vencimento.fill(dataComoSeDigita("2026-11-16"));
  await vencimento.press("Enter");
  await expect(page.getByTestId("importacao-vencimento")).toHaveValue("2026-11-16");
  await escolherNoSeletor(page, page.getByTestId("importacao-natureza"), c.ref.natureza.label, "Natureza de despesa da compra");
  await escolherNoSeletor(page, page.getByTestId("importacao-centro"), c.ref.centro.label, "Centro de resultado da compra");
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * O DETECTOR — prova reversa, sem navegador
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

testeSemNavegador("XML-04 · K2 · prova reversa do detector do web da base: a main antes da XML-04 → false; o commit da XML-04 → true; este HEAD → true", () => {
  expect(fonteDoHeadContem(MARCA_DA_XML04.web, "apps/web/src"), `este HEAD: o web tem ${MARCA_DA_XML04.web}`).toBe(true);
  expect(webDaBaseTemAXml04(COMMITS_DA_XML04.sem), `${COMMITS_DA_XML04.sem.slice(0, 8)} (a main com a XML-02): sem a XML-04`).toBe(false);
  expect(webDaBaseTemAXml04(COMMITS_DA_XML04.com), `${COMMITS_DA_XML04.com.slice(0, 8)} (a XML-04 na branch da fatia): com a XML-04`).toBe(true);
  // O detector lê o fonte do COMMIT (e não a árvore de agora): no commit sem a XML-04, a aba de itens existe e não tem a marca.
  expect(fonteDoCommitContem(COMMITS_DA_XML04.sem, "data-testid={`${pede}-fator`}", "apps/web/src"), "premissa: o campo Fator existe no commit sem a XML-04").toBe(true);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K2 · A CONFERÊNCIA DA BASE LÊ A API NOVA, AVISA SEM BLOQUEAR E GERA A COMPRA
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("XML-04 · K2 (sentido 2) — a conferência da base sobre a API deste HEAD: abre, os itens perguntados com o fator 1 de compatibilidade, os avisos novos do fator sem bloquear, e o Gerar compra dá 201; o risco da janela fica observado no mundo legado e o comportamento deste HEAD afirmado no novo", async ({ page, ligacoes }) => {
  test.setTimeout(240_000);
  const mundo = mundoDoWebDaBase();
  await login(page);
  const c = await cenarioDaXml04(page);
  await ligacoes.ligar(COBRANCA_DO_CENARIO.tPag, c.formaCerta.id);
  const id = await importarNotaDaXml04(page, c, c.nota);
  premissaDaApiNova(await api<ConferenciaNoFioDaXml04>(page, "GET", `/api/compras/importacoes/${id}`), c, "premissa: a API julgada é a deste HEAD");
  const n = { U1: nDo(c, "U1"), U2: nDo(c, "U2"), V: nDo(c, "V") };

  const v = vigiar(page);
  const noFio = await abrirConferenciaDaXml04(page, id, c.top);
  premissaDaApiNova(noFio, c, "no fio, a conferência que o web da base recebeu");
  await expect(page.getByText("A importação de XML não está disponível"), "não é a tela de indisponível").toHaveCount(0);
  await irParaAba(page, "itens");
  const papeis = c.itensDoCenario;

  if (mundo === "legado") {
    // O QUE NÃO PODE QUEBRAR: cada item desenha com o produto e o fator que a API manda — o "1" na pergunta.
    for (const [k, i] of papeis.entries()) {
      const vin = vinculoNoFio(noFio, k + 1);
      await expect(page.getByTestId(`importacao-item-${k + 1}`), `${i.papel}: o web da base desenhou o vínculo`).toHaveAttribute("data-vinculo", vin.situacao);
      await expect(page.getByTestId(`importacao-item-${k + 1}-fator`), `${i.papel}: o fator que a API manda (${vin.fator})`).toHaveValue(D(vin.fator ?? "0").toFixed());
    }
    for (const k of [n.U1, n.U2]) await expect(page.getByTestId(`importacao-item-${k}-fator`), `item ${k}: a pergunta aparece com o fator 1 (compatibilidade)`).toHaveValue("1");
    expect(await testidsDaXml04NaTela(page), "o web da base não tem nada da XML-04 na aba Itens").toEqual([]);
    // As divergências novas do fator: AVISO na lista, nenhuma bloqueia.
    await irParaAba(page, "divergencias");
    const doFator = await page.getByTestId("importacao-divergencia").evaluateAll((els) => els
      .filter((e) => /fator/.test(e.getAttribute("data-codigo") ?? ""))
      .map((e) => [e.getAttribute("data-codigo") ?? "", e.getAttribute("data-bloqueia") ?? "", (e as HTMLElement).innerText]));
    const doServidor = noFio.divergencias.filter((d) => /fator/.test(d.codigo));
    expect(doFator.map(([codigo, bloqueia, texto]) => [codigo, bloqueia, textoNormalizado(texto!).replace(/\s*Ir para .*$/, "")]),
      "a aba Divergências da base: os três avisos novos do fator, com o texto do servidor, sem bloquear")
      .toEqual(doServidor.map((d) => [d.codigo, "nao", `Aviso: ${d.mensagem}`]));
  } else {
    // O MUNDO NOVO: o web da base é o deste HEAD — a pergunta com o campo vazio (a pessoa digita).
    for (const k of [n.U1, n.U2]) await expect(page.getByTestId(`importacao-item-${k}-fator`), `mundo novo: o item ${k} com o fator perguntado (vazio)`).toHaveValue("");
    for (const [k, fator] of [[n.U1, "20"], [n.U2, "10"]] as const) await page.getByTestId(`importacao-item-${k}-fator`).fill(fator);
  }

  await resolverOFinanceiro(page, c);
  const formaNaBase = await page.getByTestId("importacao-forma").getByRole("combobox").innerText();
  const gerar = page.getByTestId("importacao-gerar-compra");
  await expect(gerar, "os avisos novos não bloqueiam: o Gerar compra está livre").toBeEnabled();
  const vinculosAntes = vinculosDoFornecedor(c.fornecedor);
  const post = page.waitForResponse((r) => r.request().method() === "POST" && caminho(r) === `/api/compras/importacoes/${id}/gerar-compra`, { timeout: 30_000 });
  await gerar.click();
  const resposta = await post;
  const texto = await resposta.text();
  expect(resposta.status(), `a API nova gera a compra do web da base: ${texto.slice(0, 300)}`).toBe(201);
  const compra = JSON.parse(texto) as { id: string; situacao: string; valor_total: string };
  expect([compra.situacao, D(compra.valor_total).toFixed(2)], "a compra nasce ABERTA, com o total da nota").toEqual(["aberto", c.nota.vNF]);
  const corpo = resposta.request().postDataJSON() as { financeiro: Record<string, unknown>; itens: { n_item: number; fator: string; lembrar_vinculo?: boolean }[] };
  const gravada = compraNoBanco(compra.id);
  const fatoresDoCorpo = corpo.itens.map((i) => D(i.fator).toFixed());
  expect(gravada.itens.map((l) => l.split("|")[3]), "o banco gravou o fator que a tela mandou").toEqual(fatoresDoCorpo);
  const vinculosDepois = vinculosDoFornecedor(c.fornecedor);
  console.log(`[skew] XML-04 · K2 · mundo ${mundo} · gerar ${resposta.status()} | fatores no corpo ${JSON.stringify(fatoresDoCorpo)} (perguntados: item ${n.U1}=${fatoresDoCorpo[n.U1 - 1]}, item ${n.U2}=${fatoresDoCorpo[n.U2 - 1]})`
    + ` | forma na tela "${formaNaBase.trim()}" → gravada ${gravada.forma ?? "nenhuma"} | vínculos do fornecedor ${vinculosAntes.length} → ${vinculosDepois.length}`);
  if (mundo === "legado") {
    // O RISCO DA JANELA, OBSERVADO E AFIRMADO COMO FATO (a tela de hoje): o "1" de compatibilidade vai no corpo dos
    // perguntados; a forma da nota não vem escolhida.
    expect([fatoresDoCorpo[n.U1 - 1], fatoresDoCorpo[n.U2 - 1]], "mundo legado: a pessoa que não conferiu gera com o 1 de compatibilidade (o risco da janela, observado)").toEqual(["1", "1"]);
    expect(gravada.forma, "mundo legado: a forma da nota não vem escolhida (o web da base não lê financeiro.forma)").toBeNull();
  } else {
    expect([fatoresDoCorpo[n.U1 - 1], fatoresDoCorpo[n.U2 - 1]], "mundo novo: os fatores digitados").toEqual(["20", "10"]);
    expect(gravada.forma, "mundo novo: a forma da nota").toBe(c.formaCerta.id);
  }
  v.semBloqueio();
  v.semErroDeContrato();
});
