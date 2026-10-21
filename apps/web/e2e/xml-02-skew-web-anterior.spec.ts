import { test as testeSemNavegador } from "@playwright/test";
import { login } from "./helpers";
import { test, expect } from "./central-compras-fixtures";
import { shaDaBase } from "./skew-fonte-da-base";
import { vigiar, type Mundo } from "./operacoes-01-f2-skew-comum";
import {
  COMMITS_DA_XML02, MARCA_DA_XML02, ROTULO, TEXTO_DA_CONFERENCIA_DA_REFERENCIA, TEXTO_DA_CONFERENCIA_DO_PALPITE, abrirConferencia, caixaDoProduto, cenarioDaXml02, fonteDoCommitContem,
  fonteDoHeadContem, gerarCompraPelaTela, importarNota, itemDo, lembrarNoCorpo, lerConferencia, produtoDo, resumoDoVinculo, vinculoDe,
  vinculosLembradosDo, webDaBaseTemAXml02, webDaBaseTemImportacaoSemFatorNaTela, type ConferenciaNoFio
} from "./xml-02-comum";

/**
 * XML-02 (decisão 314) · K2, SENTIDO 2 — O WEB DA BASE CONTRA A API DESTE HEAD (a janela "API antes do web" da
 * DEPLOYMENT, e a reversão só do web).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 2 roda em `playwright.skew-web-anterior.config.ts`, cujo `testMatch` é
 * `/skew-web-anterior\.spec\.ts/` (sem âncora: casa com o fim deste nome); o `playwright.config.ts` comum ignora o mesmo
 * padrão — este arquivo NUNCA roda na suíte comum (lá o web seria o deste HEAD e o caso não mediria o cliente anterior).
 * Sem passo no CI: o job `skew` roda a config inteira, e o arquivo entra pelo nome.
 *
 * O QUE SE MEDE. A conferência da API deste HEAD é ADITIVA: a `origem` do sugerido ganha "reference" e "descricao", e o
 * sugerido pela descrição leva o `preenchimento`. O navegador roda o bundle EXATO da base, e faz pela tela dela o que faz
 * hoje: a conferência RENDERIZA (nem "indisponível", nem "não sei ler"), os dois itens chegam com o produto escolhido e
 * a conta feita, e o "Gerar compra" dá 201. PREMISSA, NO FIO: a conferência que a tela recebeu TINHA as origens novas
 * (é a API nova). O VIGIA: nenhuma resposta 404/422/5xx da API nova ao cliente da base e nenhuma requisição morta.
 *
 * O MUNDO DO WEB DA BASE é lido do FONTE do commit (`webDaBaseTemAXml02`: o `apps/web/src` tem a linha da conferência do
 * palpite, `sugestao-descricao`; reprova quando não consegue ler):
 *   · LEGADO (a base sem a XML-02) — O RISCO DECLARADO DA JANELA (decisão 314, riscos (a)): o web da base mostra
 *     "(código do fornecedor)" para toda origem que não é `codigo_barras` e deixa "Lembrar" MARCADO também nos
 *     palpites (a descrição e a referência); gerando assim, os vínculos dos palpites são GRAVADOS. Isto fica OBSERVADO
 *     e registrado (`[skew] …` no log), como FATO da janela — não como asserção de que é bom. O que se afirma é o que
 *     não pode quebrar: lê e gera;
 *   · NOVO (a base já com a XML-02, depois do merge): o web da base é o deste HEAD — a descrição E a referência como
 *     palpite (decisão do dono, 21214fd5): o rótulo de cada uma, a linha da conferência de cada uma, "Lembrar"
 *     desmarcado e "Criar produto" — e o Gerar NÃO grava nenhum dos dois. Aqui é contrato, e se afirma. (O d2086dd8 —
 *     a XML-02 com a referência ainda como identidade na tela — nunca é base: entra na main no mesmo merge que o
 *     21214fd5; ver `COMMITS_DA_XML02`.)
 *
 * PROVA REVERSA DO DETECTOR: o caso "detector" (sem navegador) roda `webDaBaseTemAXml02` sobre dois commits fixos — a
 * main antes da XML-02 ⇒ falso; o commit da XML-02 na branch da PR #127 ⇒ verdadeiro.
 *
 * OS DADOS nascem pela API DESTE HEAD (as portas de `central-compras-fixtures`, com a exclusão lógica no fim do caso); a
 * compra, a importação e os vínculos lembrados ficam (ledger e cadastro que não se apaga; decisão 247).
 */

/** O mundo do web da base, pelo fonte do commit. */
function mundoDoWebDaBase(): Mundo {
  const sha = shaDaBase();
  const mundo: Mundo = webDaBaseTemAXml02(sha) ? "novo" : "legado";
  console.log(`[skew] XML-02 · K2 · o web da base ${sha.slice(0, 8)} ${mundo === "novo" ? "TEM" : "NÃO tem"} ${MARCA_DA_XML02.web} → mundo ${mundo}`);
  return mundo;
}

/** A API julgada é a deste HEAD: a conferência traz as origens novas e o pré-preenchimento só no palpite. */
function origensNovas(conf: ConferenciaNoFio, n: { D: number; R: number }, produtos: { D: string; R: string }, contexto: string) {
  expect([resumoDoVinculo(vinculoDe(conf, n.D)), resumoDoVinculo(vinculoDe(conf, n.R))], `${contexto}: as origens novas (a descrição e a referência)`)
    .toEqual([["sugerido", "descricao", produtos.D], ["sugerido", "reference", produtos.R]]);
  expect(vinculoDe(conf, n.D).preenchimento?.["description"], `${contexto}: o palpite com o pré-preenchimento`).toBeTruthy();
  expect(Object.hasOwn(vinculoDe(conf, n.R), "preenchimento"), `${contexto}: a referência sem pré-preenchimento`).toBe(false);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * O DETECTOR — prova reversa, sem navegador
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

testeSemNavegador("XML-02 · K2 · prova reversa do detector do web da base: a main antes da XML-02 → false; o commit da XML-02 → true; este HEAD → true", () => {
  // O HEAD também é lido como "tem a XML-02": é ele que vira a base depois do merge (com o hífen, o 21214fd5 seria legado).
  expect(fonteDoHeadContem(MARCA_DA_XML02.web, "apps/web/src"), `este HEAD: o web tem ${MARCA_DA_XML02.web}`).toBe(true);
  expect(webDaBaseTemAXml02(COMMITS_DA_XML02.sem), `${COMMITS_DA_XML02.sem.slice(0, 8)} (a main com a EDITAR-02): sem a XML-02`).toBe(false);
  expect(webDaBaseTemAXml02(COMMITS_DA_XML02.com), `${COMMITS_DA_XML02.com.slice(0, 8)} (a XML-02 na branch da PR #127): com a XML-02`).toBe(true);
  // O detector lê o fonte do COMMIT (e não a árvore de agora): no commit sem a XML-02, a aba de itens existe e não tem a marca.
  expect(fonteDoCommitContem(COMMITS_DA_XML02.sem, "data-testid={`${pede}-candidatos`}", "apps/web/src"), "premissa: a aba de itens existe no commit sem a XML-02").toBe(true);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K2 · A CONFERÊNCIA DA BASE LÊ AS ORIGENS NOVAS E GERA A COMPRA
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("XML-02 · K2 (sentido 2) — a conferência da base sobre a API deste HEAD: com as origens novas (lidas no fio) renderiza sem erro e o Gerar compra dá 201; o risco da janela (o rótulo, o \"Lembrar\" e o vínculo dos palpites) fica observado no mundo legado e afirmado no novo", async ({ page }) => {
  test.setTimeout(240_000);
  const mundo = mundoDoWebDaBase();
  await login(page);
  const c = await cenarioDaXml02(page, "K2", ["D", "R"]);
  const n = { D: itemDo(c, "D"), R: itemDo(c, "R") };
  const p = { D: produtoDo(c, "D"), R: produtoDo(c, "R") };
  const { id, nota } = await importarNota(page, c);
  origensNovas(await lerConferencia(page, id), n, { D: p.D.id, R: p.R.id }, "premissa: a API julgada é a deste HEAD");
  expect(vinculosLembradosDo(c.fornecedor), "premissa: o fornecedor do caso é novo — nenhum vínculo lembrado").toEqual([]);

  const v = vigiar(page);
  const noFio = await abrirConferencia(page, id, c.top);
  origensNovas(noFio, n, { D: p.D.id, R: p.R.id }, "no fio, a conferência que o web da base recebeu");
  await expect(page.getByText("A importação de XML não está disponível"), "não é a tela de indisponível").toHaveCount(0);

  // O QUE NÃO PODE QUEBRAR: os dois itens desenham, com o produto escolhido e a conta feita.
  const item = (k: number) => page.getByTestId(`importacao-item-${k}`);
  for (const [k, prod] of [[n.D, p.D], [n.R, p.R]] as const) {
    await expect(item(k), `item ${k}: o web da base desenhou o sugerido`).toHaveAttribute("data-vinculo", "sugerido");
    await expect(caixaDoProduto(page, k), `item ${k}: com o produto escolhido`).toContainText(`${prod.codigo} — ${prod.descricao}`);
    const qtdInterna = page.getByTestId(`importacao-item-${k}-quantidade-interna`);
    if (await qtdInterna.count()) await expect(qtdInterna, `item ${k}: a conta feita`).not.toHaveText("—");
    else await expect(page.getByTestId(`importacao-item-${k}-quantidade-nota`), `item ${k}: quantidade da nota`).toBeVisible();
  }

  const semFatorNaTela = webDaBaseTemImportacaoSemFatorNaTela();
  // O QUE A JANELA MOSTRA: o rótulo, o "Criar produto" e (se existir) o "Lembrar".
  const rotuloNaTela = async (k: number) => (await item(k).getByText(/^Sugerido( \(.+\))?$/).allTextContents()).join(" | ");
  const lembrarNaTela = async (k: number) => ((await page.getByTestId(`importacao-item-${k}-lembrar`).count()) > 0 ? await page.getByTestId(`importacao-item-${k}-lembrar`).isChecked() : null);
  const doCartao = async (k: number) => ({
    rotulo: await rotuloNaTela(k), lembrar: await lembrarNaTela(k), criarProduto: await page.getByTestId(`importacao-item-${k}-criar-produto`).count(),
    conferenciaDaDescricao: await page.getByTestId(`importacao-item-${k}-sugestao-descricao`).count(),
    conferenciaDaReferencia: await page.getByTestId(`importacao-item-${k}-sugestao-referencia`).count()
  });
  const observado = { D: await doCartao(n.D), R: await doCartao(n.R) };
  const linha = (o: typeof observado.D) => `rótulo="${o.rotulo}" Lembrar=${o.lembrar ? "MARCADO" : "desmarcado"} Criar produto=${o.criarProduto} linha do palpite (descrição/referência)=${o.conferenciaDaDescricao}/${o.conferenciaDaReferencia}`;
  console.log(`[skew] XML-02 · K2 · mundo ${mundo} · na tela da base: item ${n.D} (descrição) ${linha(observado.D)} | item ${n.R} (referência) ${linha(observado.R)}`);
  if (mundo === "novo") {
    expect(observado.D?.rotulo, "mundo novo: palpite da descrição").toBe(ROTULO.descricao);
    expect(observado.R?.rotulo, "mundo novo: palpite da referência").toBe(ROTULO.referencia);
    if (!semFatorNaTela) {
      expect(observado, "mundo novo (com Lembrar na tela): os dois palpites desmarcados").toEqual({
        D: { rotulo: ROTULO.descricao, lembrar: false, criarProduto: 1, conferenciaDaDescricao: 1, conferenciaDaReferencia: 0 },
        R: { rotulo: ROTULO.referencia, lembrar: false, criarProduto: 1, conferenciaDaDescricao: 0, conferenciaDaReferencia: 1 }
      });
    }
    await expect(page.getByTestId(`importacao-item-${n.D}-sugestao-descricao`)).toHaveText(TEXTO_DA_CONFERENCIA_DO_PALPITE);
    await expect(page.getByTestId(`importacao-item-${n.R}-sugestao-referencia`)).toHaveText(TEXTO_DA_CONFERENCIA_DA_REFERENCIA);
  }

  // O "GERAR COMPRA" da base, sem tocar em nada.
  const g = await gerarCompraPelaTela(page, c, id, [n.D, n.R]);
  expect(g.status, `a API nova gera a compra do web da base: ${g.texto.slice(0, 300)}`).toBe(201);
  expect(g.compra, "a compra nasce ABERTA, com o total da nota").toMatchObject({ situacao: "aberto", valor_total: nota.vNF, importacao_id: id });
  expect(lembrarNoCorpo(g.corpo).map(([k, prod]) => [k, prod]), "o corpo da base: os produtos sugeridos").toEqual([[n.D, p.D.id], [n.R, p.R.id]]);
  await expect(page, "a base abre a consulta da compra").toHaveURL(new RegExp(`/compras/compras/${g.compra!.id}$`));
  const gravados = vinculosLembradosDo(c.fornecedor);
  const par = (papel: "D" | "R") => { const i = c.itens[n[papel] - 1]!; return `${i.codigo}|${i.unidade}|${p[papel].id}`; };
  const gravado = (papel: "D" | "R") => (gravados.includes(par(papel)) ? "GRAVADO — o risco declarado da janela" : "não gravado");
  console.log(`[skew] XML-02 · K2 · mundo ${mundo} · gerar ${g.status} | lembrar_vinculo no corpo: ${JSON.stringify(lembrarNoCorpo(g.corpo).map(([k, , l]) => [k, l]))}`
    + ` | vínculos lembrados do fornecedor depois: ${gravados.length} (o do palpite da descrição ${gravado("D")}; o da referência ${gravado("R")})`);
  if (mundo === "novo") {
    if (semFatorNaTela) {
      expect(lembrarNoCorpo(g.corpo), "mundo novo (sem fator na tela): lembrar_vinculo true nos dois palpites").toEqual([[n.D, p.D.id, true], [n.R, p.R.id, true]]);
      expect(gravados.sort(), "mundo novo: o banco ganha os dois pares").toEqual([par("D"), par("R")].sort());
    } else {
      expect(lembrarNoCorpo(g.corpo), "mundo novo: os dois palpites vão com lembrar_vinculo false").toEqual([[n.D, p.D.id, false], [n.R, p.R.id, false]]);
      expect(gravados, "mundo novo: o banco NÃO ganha par nenhum do fornecedor").toEqual([]);
    }
  } else {
    expect(gravados, "mundo legado: o web da base deixa \"Lembrar\" marcado na referência, e o par dela é gravado (o risco da janela, observado)").toContain(par("R"));
  }
  v.semBloqueio();
  v.semErroDeContrato();
});
