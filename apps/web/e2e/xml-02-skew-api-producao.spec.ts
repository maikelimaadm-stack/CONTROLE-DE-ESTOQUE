import { test as testeSemNavegador } from "@playwright/test";
import { login } from "./helpers";
import { test, expect } from "./central-compras-fixtures";
import { shaDaBase } from "./skew-fonte-da-base";
import { vigiar, type Mundo } from "./operacoes-01-f2-skew-comum";
import {
  COMMITS_DA_XML02, MARCA_DA_XML02, TEXTO_DA_CONFERENCIA_DA_REFERENCIA, TEXTO_DA_CONFERENCIA_DO_PALPITE, abrirConferencia, apiDaBaseTemAXml02, caixaDoProduto, cenarioDaXml02,
  escolherNoSeletor, expectCamposAvancadosAusentes, fonteDoCommitContem, fonteDoHeadContem, gerarCompraPelaTela, importarNota, itemDo, lembrarNoCorpo, lerConferencia, produtoDo,
  resumoDoVinculo, vinculoDe, vinculosLembradosDo, type ConferenciaNoFio
} from "./xml-02-comum";

/**
 * XML-02 (decisão 314) · K1, SENTIDO 1 — O WEB DESTE HEAD CONTRA A API DA BASE (a janela "web antes da API" da
 * DEPLOYMENT, e a reversão só da API).
 *
 * POR QUE ESTE ARQUIVO TEM ESTE NOME. O sentido 1 roda em `playwright.skew.config.ts`, cujo `testMatch` é
 * `/skew-api-producao\.spec\.ts/` (sem âncora: casa com o fim deste nome); o `playwright.config.ts` comum ignora o mesmo
 * padrão — este arquivo NUNCA roda na suíte comum (lá a API seria a deste HEAD e o caso ficaria verde por vacuidade).
 * Sem passo no CI: o job `skew` roda a config inteira, e o arquivo entra pelo nome.
 *
 * O QUE SE MEDE. A tela deste HEAD só LÊ as origens novas ("reference" e "descricao") e o pré-preenchimento do palpite;
 * a API da base não os manda. O navegador roda o bundle deste HEAD contra o binário EXATO da base, servindo o banco
 * migrado e semeado por este HEAD, e a nota do caso tem os três caminhos: o código de barras (que a base já tem), a
 * descrição semelhante e a referência (que a base pode não ter).
 *
 * O MUNDO DA API DA BASE é lido do FONTE do commit (`apiDaBaseTemAXml02`: o `apps/api/src` monta o sugerido de origem
 * "descricao"; reprova quando não consegue ler) e CONFERIDO na conferência que a base responde — o fonte e o binário
 * têm de contar a mesma história, ou o caso reprova:
 *   · LEGADO (a base sem a XML-02): o código de barras SUGERIDO; a descrição e a referência SEM VÍNCULO. A aba renderiza
 *     como hoje — "Sugerido (código de barras)" com "Lembrar" marcado e sem "Criar produto"; os dois sem vínculo com
 *     "Sem vínculo", "Lembrar" marcado e "Criar produto"; nenhuma linha de conferência de palpite (nem da descrição,
 *     nem da referência). A pessoa escolhe os dois produtos no seletor, e o "Gerar compra" dá 201 com
 *     `lembrar_vinculo: true` nos três;
 *   · NOVO (a base já com a XML-02, depois do merge): o mesmo comportamento deste HEAD — a descrição E a referência são
 *     palpite na tela (decisão do dono, 21214fd5): o rótulo de cada uma, a linha da conferência de cada uma, "Lembrar"
 *     desmarcado e "Criar produto"; o Gerar lembra SÓ o código de barras. (O d2086dd8 — a XML-02 com a referência
 *     ainda como identidade na tela — nunca é base: entra na main no mesmo merge que o 21214fd5; ver `COMMITS_DA_XML02`.)
 * PREMISSA anti-vacuidade: as marcas que o ramo legado cobra AUSENTES (os sufixos dos testids das duas linhas de
 * palpite e os rótulos das origens novas) existem no fonte deste HEAD. O VIGIA: nenhuma requisição morta no navegador.
 *
 * PROVA REVERSA DO DETECTOR: o caso "detector" (sem navegador) roda `apiDaBaseTemAXml02` sobre dois commits fixos —
 * a main antes da XML-02 ⇒ falso; o commit da XML-02 na branch da PR #127 ⇒ verdadeiro. Um detector que respondesse
 * sempre o mesmo reprova ali.
 *
 * OS DADOS nascem pela API DA BASE (as portas de `central-compras-fixtures`, com a exclusão lógica no fim do caso); a
 * compra, a importação e os vínculos lembrados ficam (ledger e cadastro que não se apaga; decisão 247).
 */

/** PREMISSA: o que o ramo legado cobra ausente existe neste HEAD (sem ela, "não aparece" seria verde por vacuidade). */
function premissaDasMarcas() {
  for (const marca of [MARCA_DA_XML02.web, "sugestao-referencia"]) {
    expect(fonteDoHeadContem(marca, "apps/web/src"), `premissa: o web deste HEAD tem ${marca}`).toBe(true);
  }
  for (const rotulo of ["descricao: \"descrição semelhante\"", "reference: \"referência do produto\""]) {
    expect(fonteDoHeadContem(rotulo, "packages/domain/src/labels.ts"), `premissa: o domínio deste HEAD (embutido no web) tem o rótulo ${rotulo}`).toBe(true);
  }
}

/** O mundo pelo FONTE do commit da base, conferido na conferência que a base respondeu: os dois têm de concordar. */
function mundoDaApiDaBase(conf: ConferenciaNoFio, n: { G: number; D: number; R: number }, produtos: { G: string; D: string; R: string }): Mundo {
  const sha = shaDaBase();
  const mundo: Mundo = apiDaBaseTemAXml02(sha) ? "novo" : "legado";
  console.log(`[skew] XML-02 · K1 · a API da base ${sha.slice(0, 8)} ${mundo === "novo" ? "TEM" : "NÃO tem"} ${MARCA_DA_XML02.api} → mundo ${mundo}`);
  expect(resumoDoVinculo(vinculoDe(conf, n.G)), "nos dois mundos: o código de barras é SUGERIDO (a identidade que a base já tem)").toEqual(["sugerido", "codigo_barras", produtos.G]);
  if (mundo === "legado") {
    expect([resumoDoVinculo(vinculoDe(conf, n.D)), resumoDoVinculo(vinculoDe(conf, n.R))], "mundo legado: a base não acha a descrição nem a referência — SEM VÍNCULO")
      .toEqual([["nenhum", null, null], ["nenhum", null, null]]);
  } else {
    expect([resumoDoVinculo(vinculoDe(conf, n.D)), resumoDoVinculo(vinculoDe(conf, n.R))], "mundo novo: a base acha a descrição e a referência (as duas, palpite na tela)")
      .toEqual([["sugerido", "descricao", produtos.D], ["sugerido", "reference", produtos.R]]);
  }
  return mundo;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * O DETECTOR — prova reversa, sem navegador
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

testeSemNavegador("XML-02 · K1 · prova reversa do detector da API da base: a main antes da XML-02 → false; o commit da XML-02 → true", () => {
  expect(fonteDoHeadContem(MARCA_DA_XML02.api, "apps/api/src"), `premissa: a API deste HEAD tem ${MARCA_DA_XML02.api}`).toBe(true);
  expect(apiDaBaseTemAXml02(COMMITS_DA_XML02.sem), `${COMMITS_DA_XML02.sem.slice(0, 8)} (a main com a EDITAR-02): sem a XML-02`).toBe(false);
  expect(apiDaBaseTemAXml02(COMMITS_DA_XML02.com), `${COMMITS_DA_XML02.com.slice(0, 8)} (a XML-02 na branch da PR #127): com a XML-02`).toBe(true);
  // O detector lê o fonte do COMMIT (e não a árvore de agora): no commit sem a XML-02, a conferência existe e não tem a marca.
  expect(fonteDoCommitContem(COMMITS_DA_XML02.sem, "export async function vinculosDosItens", "apps/api/src"), "premissa: a conferência existe no commit sem a XML-02").toBe(true);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * K1 · A ABA DE ITENS DESTE WEB SOBRE A CONFERÊNCIA DA BASE, ATÉ O GERAR COMPRA
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("XML-02 · K1 (sentido 1) — a aba de itens deste web sobre a API da base: sem as origens novas, os rótulos de identidade, \"Lembrar\" marcado e \"Criar produto\" só no sem vínculo, e o Gerar compra dá 201; com elas, o comportamento deste HEAD (a descrição e a referência como palpite)", async ({ page }) => {
  test.setTimeout(240_000);
  premissaDasMarcas();
  await login(page);
  const c = await cenarioDaXml02(page, "K1", ["G", "D", "R"]);
  const n = { G: itemDo(c, "G"), D: itemDo(c, "D"), R: itemDo(c, "R") };
  const p = { G: produtoDo(c, "G"), D: produtoDo(c, "D"), R: produtoDo(c, "R") };
  const { id, nota } = await importarNota(page, c);
  const direta = await lerConferencia(page, id);
  expect(direta, "premissa: a importação pendente, com o fornecedor (novo) encontrado pelo emitente")
    .toMatchObject({ situacao: "pendente", empresa: { id: c.empresa }, parceiro: { situacao: "encontrado", id: c.fornecedor }, fornecedorEscolhido: c.fornecedor });
  const mundo = mundoDaApiDaBase(direta, n, { G: p.G.id, D: p.D.id, R: p.R.id });

  const v = vigiar(page);
  const noFio = await abrirConferencia(page, id, c.top);
  expect(noFio.itens.map((i) => [i.nItem, i.vinculo]), "a tela recebeu os MESMOS vínculos da leitura direta").toEqual(direta.itens.map((i) => [i.nItem, i.vinculo]));
  const item = (k: number) => page.getByTestId(`importacao-item-${k}`);
  const doItem = (k: number, sufixo: string) => page.getByTestId(`importacao-item-${k}-${sufixo}`);

  // O CÓDIGO DE BARRAS (os dois mundos): data-vinculo, sem rótulo/linha de palpite, sem "Criar produto".
  await expect(item(n.G)).toHaveAttribute("data-vinculo", "sugerido");
  await expect(doItem(n.G, "vinculo")).toHaveCount(0);
  await expectCamposAvancadosAusentes(page, n.G);
  await expect(doItem(n.G, "criar-produto")).toHaveCount(0);
  await expect(doItem(n.G, "sugestao-descricao")).toHaveCount(0);
  await expect(doItem(n.G, "sugestao-referencia")).toHaveCount(0);
  await expect(caixaDoProduto(page, n.G)).toContainText(`${p.G.codigo} — ${p.G.descricao}`);

  if (mundo === "legado") {
    // A API legada: os dois sem vínculo no fio; a pessoa escolhe o produto no seletor (sem rótulo/linha de palpite na tela).
    for (const k of [n.D, n.R]) {
      await expect(item(k), `item ${k}: sem vínculo`).toHaveAttribute("data-vinculo", "nenhum");
      await expect(doItem(k, "vinculo")).toHaveCount(0);
      await expectCamposAvancadosAusentes(page, k);
      await expect(doItem(k, "criar-produto"), `item ${k}: "Criar produto", como hoje`).toBeVisible();
      await expect(doItem(k, "sugestao-descricao"), `item ${k}: nenhuma linha de palpite da descrição`).toHaveCount(0);
      await expect(doItem(k, "sugestao-referencia"), `item ${k}: nenhuma linha de palpite da referência`).toHaveCount(0);
    }
    await expect(page.getByText(TEXTO_DA_CONFERENCIA_DO_PALPITE), "nenhuma linha de palpite da descrição na aba").toHaveCount(0);
    await expect(page.getByText(TEXTO_DA_CONFERENCIA_DA_REFERENCIA), "nenhuma linha de palpite da referência na aba").toHaveCount(0);
    await escolherNoSeletor(page, page.getByTestId(`importacao-item-${n.D}-produto`), p.D.descricao, `Produto do item ${n.D}`);
    await escolherNoSeletor(page, page.getByTestId(`importacao-item-${n.R}-produto`), p.R.descricao, `Produto do item ${n.R}`);
  } else {
    // O MUNDO NOVO: palpite no fio — produto pré-selecionado, sem rótulo nem linha de conferência na tela.
    for (const k of [n.D, n.R]) {
      await expect(item(k), `item ${k}: sugerido`).toHaveAttribute("data-vinculo", "sugerido");
      await expect(doItem(k, "vinculo")).toHaveCount(0);
      await expect(doItem(k, "sugestao-descricao")).toHaveCount(0);
      await expect(doItem(k, "sugestao-referencia")).toHaveCount(0);
      await expectCamposAvancadosAusentes(page, k);
      await expect(doItem(k, "criar-produto")).toBeVisible();
    }
  }
  // Nos dois mundos, os dois itens com o produto certo (escolhido pela pessoa ou sugerido) e a conta feita.
  for (const [k, prod] of [[n.D, p.D], [n.R, p.R]] as const) {
    await expect(caixaDoProduto(page, k), `item ${k}: com o produto certo`).toContainText(prod.descricao);
    await expect(doItem(k, "quantidade-nota"), `item ${k}: a quantidade da nota na tabela`).toBeVisible();
  }

  const rotulos = { G: await item(n.G).getAttribute("data-vinculo"), D: await item(n.D).getAttribute("data-vinculo"), R: await item(n.R).getAttribute("data-vinculo") };

  // O "GERAR COMPRA" contra a base.
  const g = await gerarCompraPelaTela(page, c, id, [n.G, n.D, n.R]);
  expect(g.status, `a base gera a compra deste web: ${g.texto.slice(0, 300)}`).toBe(201);
  expect(g.compra, "a compra nasce ABERTA, com o total da nota").toMatchObject({ situacao: "aberto", valor_total: nota.vNF, importacao_id: id });
  expect(lembrarNoCorpo(g.corpo), `mundo ${mundo}: o corpo manda lembrar_vinculo true em todos os itens`)
    .toEqual([[n.G, p.G.id, true], [n.D, p.D.id, true], [n.R, p.R.id, true]]);
  const gravados = vinculosLembradosDo(c.fornecedor);
  const par = (papel: "G" | "D" | "R") => { const i = c.itens[n[papel] - 1]!; return `${i.codigo}|${i.unidade}|${p[papel].id}`; };
  expect(gravados, `mundo ${mundo}: a base gravou os três vínculos (regra automática)`)
    .toEqual([par("G"), par("D"), par("R")].sort());
  console.log(`[skew] XML-02 · K1 · mundo ${mundo} | rótulos: G="${rotulos.G ?? ""}", D="${rotulos.D ?? ""}", R="${rotulos.R ?? ""}"`
    + ` | gerar ${g.status} | lembrar no corpo ${JSON.stringify(lembrarNoCorpo(g.corpo).map(([k, , l]) => [k, l]))} | vínculos gravados=${gravados.length}`);
  v.semBloqueio();
});
