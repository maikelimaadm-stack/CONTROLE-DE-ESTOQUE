import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { c, iniciar, encerrar, j } from "./top-config-08-ajuda.js";
import { importar, conferencia, notaSintetica } from "./f7-ajuda.js";
import {
  prepararXml01, notaImportada, conferenciaLida, preenchimentoDo, itemNota, emitenteNovo, unidadeDaOrganizacao, unidadeNovaDoSistema,
  unidadesQueCasam, comConsultas, tocamUnidades, recusa, NCM_VIGENTE,
} from "./xml-01-ajuda.js";

/**
 * XML-01 (decisão 312) — 4.1 A UNIDADE DA NOTA NO PRÉ-PREENCHIMENTO, e a CAPACIDADE declarada na conferência.
 *
 * O item SEM vínculo traz `preenchimento.measurement_id` SÓ quando o uCom casa com UMA unidade: a da organização vence
 * a do sistema; casou com mais de uma (na organização, ou no sistema sem a da organização), não casou ou uCom vazio ⇒ a
 * chave NÃO vem (nem nula). "Casar" é o símbolo aparado e em maiúsculas igual ao uCom normalizado — nunca "o mais
 * parecido". As unidades da nota são perguntadas em UMA consulta, não uma por item.
 *
 *   XML-I1  uCom casa só com a unidade da ORGANIZAÇÃO (símbolo em outra caixa) ⇒ o id dela;
 *   XML-I2  uCom casa só com a do SISTEMA ⇒ o id dela;
 *   XML-I3  organização E sistema com o mesmo símbolo ⇒ a da ORGANIZAÇÃO;
 *   XML-I4  a organização com DUAS ("KG" e " kg") ⇒ a chave AUSENTE — não a do sistema, que existe;
 *   XML-I5  o sistema com DUAS (sem a da organização) ⇒ ausente;
 *   XML-I6  uCom que não casa com nada ⇒ ausente;
 *   XML-I7  nunca "a mais parecida": "KGS", "K" e "CXA" com "kg" e "cx" cadastrados ⇒ ausente;
 *   XML-I8  uCom vazio, só espaços ou sem a tag: o LEITOR recusa a nota (422 no arquivo, no caminho do uCom) — nenhuma
 *           importação nasce, então nenhuma conferência chega a ter item sem unidade;
 *   XML-I9  numa nota só, cada item resolve a SUA unidade (organização, sistema, ambígua, nenhuma);
 *   XML-I10 UMA consulta a erp.measurement_units para a nota inteira (5 unidades distintas, 6 itens), a mesma com 1 item;
 *   XML-I11 a conferência declara `capacidades: { criarProdutosDaNota: 1 }` (no GET e na resposta da importação).
 *
 * A testemunha das premissas é o banco (`unidadesQueCasam`, superusuário): cada "ausente" vem com a contagem do que
 * existe ao lado, e com um item da MESMA nota que resolve — senão "ausente" poderia ser só a chave que nunca vem.
 */

beforeAll(async () => { await iniciar(); await prepararXml01(); }, 240_000);
afterAll(encerrar);

/** O id da unidade do SISTEMA com este símbolo exato (premissa: existe uma só). */
async function doSistema(simbolo: string): Promise<string> {
  const r = await c.admin.query<{ id: string }>("select id::text as id from erp.measurement_units where organization_id is null and symbol=$1", [simbolo]);
  expect(r.rows, `premissa: o sistema tem UMA unidade "${simbolo}"`).toHaveLength(1);
  return r.rows[0]!.id;
}

describe("4.1 a unidade da nota (uCom) no pré-preenchimento", () => {
  it("XML-I1 uCom que casa só com a unidade da ORGANIZAÇÃO (símbolo noutra caixa) ⇒ measurement_id = a da organização", async () => {
    const daOrg = await unidadeDaOrganizacao("Xqa");
    expect(await unidadesQueCasam("XQA"), "premissa: só a organização tem a unidade").toEqual({ organizacao: [daOrg], sistema: [] });
    const item = itemNota("U1-1", "xqa");
    const n = await notaImportada([item]);
    const conf = await conferenciaLida(n.id);
    expect(conf.nota.itens[0]!.unidade, "premissa: o leitor normalizou o uCom").toBe("XQA");
    expect(preenchimentoDo(conf, 1)).toStrictEqual({ description: item.descricao, ncm_code: NCM_VIGENTE, barcode: null, measurement_id: daOrg });
  });

  it("XML-I2 uCom que casa só com a do SISTEMA ⇒ measurement_id = a do sistema", async () => {
    const cx = await doSistema("cx");
    expect(await unidadesQueCasam("CX"), "premissa: só o sistema tem CX").toEqual({ organizacao: [], sistema: [cx] });
    const item = itemNota("U2-1", "CX");
    const conf = await conferenciaLida((await notaImportada([item])).id);
    expect(preenchimentoDo(conf, 1)).toStrictEqual({ description: item.descricao, ncm_code: NCM_VIGENTE, barcode: null, measurement_id: cx });
  });

  it("XML-I3 organização E sistema com o mesmo símbolo ⇒ a da ORGANIZAÇÃO vence", async () => {
    const fd = await doSistema("fd");
    const daOrg = await unidadeDaOrganizacao("FD");
    expect(await unidadesQueCasam("FD"), "premissa: as duas casam (uma de cada)").toEqual({ organizacao: [daOrg], sistema: [fd] });
    const conf = await conferenciaLida((await notaImportada([itemNota("U3-1", "FD")])).id);
    expect(preenchimentoDo(conf, 1).measurement_id).toBe(daOrg);
  });

  it("XML-I4 a organização com DUAS (\"KG\" e \" kg\") ⇒ a chave AUSENTE — nem a da organização, nem a do sistema (que existe)", async () => {
    const kg = await doSistema("kg");
    const a = await unidadeDaOrganizacao("KG");
    const b = await unidadeDaOrganizacao(" kg");
    const casam = await unidadesQueCasam("KG");
    expect(casam.organizacao.sort(), "premissa: DUAS da organização casam").toEqual([a, b].sort());
    expect(casam.sistema, "premissa: a do sistema existe (cair nela seria escolher)").toEqual([kg]);
    const cx = await doSistema("cx");
    const item = itemNota("U4-1", "KG");
    const conf = await conferenciaLida((await notaImportada([item, itemNota("U4-2", "CX")])).id);
    const p = preenchimentoDo(conf, 1);
    expect(Object.hasOwn(p, "measurement_id"), "ambígua na organização: a chave não vem").toBe(false);
    expect(p).toStrictEqual({ description: item.descricao, ncm_code: NCM_VIGENTE, barcode: null });
    expect(preenchimentoDo(conf, 2).measurement_id, "premissa: na mesma nota, o item de unidade única resolve").toBe(cx);
  });

  it("XML-I5 o sistema com DUAS para o uCom (e nenhuma da organização) ⇒ ausente", async () => {
    const a = await unidadeNovaDoSistema("zqs");
    const b = await unidadeNovaDoSistema(" ZQS");
    const casam = await unidadesQueCasam("ZQS");
    expect(casam, "premissa: duas do sistema, nenhuma da organização").toEqual({ organizacao: [], sistema: [a, b].sort() });
    const conf = await conferenciaLida((await notaImportada([itemNota("U5-1", "ZQS"), itemNota("U5-2", "CX")])).id);
    expect(Object.hasOwn(preenchimentoDo(conf, 1), "measurement_id")).toBe(false);
    expect(preenchimentoDo(conf, 2).measurement_id, "premissa: o item de unidade única resolve").toEqual(expect.any(String));
  });

  it("XML-I6 uCom que não casa com unidade nenhuma ⇒ ausente", async () => {
    expect(await unidadesQueCasam("ZZNADA"), "premissa: nada casa").toEqual({ organizacao: [], sistema: [] });
    const conf = await conferenciaLida((await notaImportada([itemNota("U6-1", "ZZNADA"), itemNota("U6-2", "UN")])).id);
    expect(Object.hasOwn(preenchimentoDo(conf, 1), "measurement_id")).toBe(false);
    expect(preenchimentoDo(conf, 2).measurement_id, "premissa: o item de unidade única resolve").toBe(await doSistema("un"));
  });

  it("XML-I7 nunca \"a mais parecida\": KGS, K e CXA com kg e cx cadastrados ⇒ ausente", async () => {
    expect((await unidadesQueCasam("CX")).sistema, "premissa: cx existe").toHaveLength(1);
    expect((await unidadesQueCasam("KG")).sistema, "premissa: kg existe").toHaveLength(1);
    for (const u of ["KGS", "K", "CXA"]) expect(await unidadesQueCasam(u), `premissa: nada casa EXATAMENTE com ${u}`).toEqual({ organizacao: [], sistema: [] });
    const conf = await conferenciaLida((await notaImportada([itemNota("U7-1", "KGS"), itemNota("U7-2", "K"), itemNota("U7-3", "CXA"), itemNota("U7-4", "CX")])).id);
    for (const n of [1, 2, 3]) expect(Object.hasOwn(preenchimentoDo(conf, n), "measurement_id"), `item ${n}: nada de "a mais parecida"`).toBe(false);
    expect(preenchimentoDo(conf, 4).measurement_id, "premissa: o uCom exato resolve").toBe(await doSistema("cx"));
  });

  it("XML-I8 uCom vazio, só espaços ou ausente: o leitor recusa a nota (422 no arquivo, caminho do uCom) e nenhuma importação nasce", async () => {
    const contar = async () => Number((await c.admin.query<{ n: string }>("select count(*)::text n from erp.importacoes_nfe_compra where organization_id=$1", [c.h.demo.orgId])).rows[0]!.n);
    const emitente = emitenteNovo();
    const base = notaSintetica({ emitenteCnpj: emitente, itens: [itemNota("U8-1", "CX")] });
    expect(base.xml, "premissa: o XML tem a tag do uCom").toContain("<uCom>CX</uCom>");
    const variantes: [string, string][] = [
      ["vazio", base.xml.replace("<uCom>CX</uCom>", "<uCom></uCom>")],
      ["só espaços", base.xml.replace("<uCom>CX</uCom>", "<uCom>   </uCom>")],
      ["sem a tag", base.xml.replace("<uCom>CX</uCom>", "")],
    ];
    const antes = await contar();
    for (const [nome, xml] of variantes) {
      const e = recusa(await importar(xml, { empresaId: c.I.empresa }), 422, "VALIDATION_ERROR");
      expect(e.details, `${nome}: a recusa aponta o uCom`).toContainEqual(expect.objectContaining({ path: "arquivo", motivo: "valor_invalido", caminho: expect.stringMatching(/\/uCom$/) }));
    }
    expect(await contar(), "nenhuma importação nasceu").toBe(antes);
    // Premissa: a MESMA nota com o uCom preenchido é importada (e o item resolve a unidade).
    const ok = await importar(base.xml, { empresaId: c.I.empresa });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(await contar()).toBe(antes + 1);
  });

  it("XML-I9 numa nota só, cada item resolve a SUA unidade: organização, sistema, ambígua (duas da organização) e nenhuma", async () => {
    const daOrg = await unidadeDaOrganizacao("XQB");
    const amb1 = await unidadeDaOrganizacao("XQC"); const amb2 = await unidadeDaOrganizacao("xqc ");
    expect((await unidadesQueCasam("XQC")).organizacao.sort(), "premissa: XQC ambígua").toEqual([amb1, amb2].sort());
    const sc = await doSistema("sc");
    const conf = await conferenciaLida((await notaImportada([itemNota("U9-1", "XQB"), itemNota("U9-2", "SC"), itemNota("U9-3", "XQC"), itemNota("U9-4", "ZZNADA")])).id);
    expect([1, 2, 3, 4].map((n) => preenchimentoDo(conf, n).measurement_id ?? "ausente")).toEqual([daOrg, sc, "ausente", "ausente"]);
  });

  it("XML-I10 UMA consulta a erp.measurement_units para a nota inteira (5 unidades distintas em 6 itens) — e a mesma com 1 item", async () => {
    // Emitente SEM cadastro e itens SEM GTIN: o lembrado, o código no fornecedor e o código de barras não são procurados;
    // a referência e a descrição (XML-02) são, e só JUNTAM a tabela de unidades. A única que a LÊ (`tocamUnidades`) é a
    // do cadastro (desde a XML-04, decisão 318, a do fator pelo uCom, que absorveu a das unidades da nota).
    const daOrg = await unidadeDaOrganizacao("XQD");
    const esperado: Record<string, string> = { CX: await doSistema("cx"), UN: await doSistema("un"), SC: await doSistema("sc"), L: await doSistema("L"), XQD: daOrg };
    const varias = await notaImportada(["CX", "UN", "SC", "L", "XQD", "CX"].map((u, k) => itemNota(`U10-${k + 1}`, u)), { fornecedor: false });
    const umaSo = await notaImportada([itemNota("U10-U", "CX")], { fornecedor: false });

    const lida = async (id: string) => comConsultas(() => conferencia(id));
    const v = await lida(varias.id);
    expect(v.r.statusCode, v.r.body).toBe(200);
    const confV = j(v.r) as unknown as Awaited<ReturnType<typeof conferenciaLida>>;
    expect(confV.parceiro.situacao, "premissa: o emitente não tem cadastro (nenhum vínculo é procurado)").toBe("nenhum");
    expect(confV.itens.map((i) => i.vinculo.situacao), "premissa: os 6 itens sem vínculo").toEqual(Array(6).fill("nenhum"));
    expect(confV.itens.map((i) => preenchimentoDo(confV, i.nItem).measurement_id), "premissa: as 5 unidades distintas resolvidas")
      .toEqual(["CX", "UN", "SC", "L", "XQD", "CX"].map((u) => esperado[u]));
    expect(tocamUnidades(v.sqls), "UMA consulta para as unidades da nota inteira").toHaveLength(1);

    const u = await lida(umaSo.id);
    expect(u.r.statusCode, u.r.body).toBe(200);
    expect(tocamUnidades(u.sqls), "a mesma UMA consulta com um item só").toHaveLength(1);
  });
});

describe("a capacidade declarada", () => {
  it("XML-I11 a conferência declara capacidades.criarProdutosDaNota === 1 (no GET e na resposta da importação), como propriedade própria", async () => {
    const emitente = emitenteNovo();
    const r = await importar(notaSintetica({ emitenteCnpj: emitente, itens: [itemNota("C1-1", "CX")] }).xml, { empresaId: c.I.empresa });
    expect(r.statusCode, r.body).toBe(201);
    const daImportacao = JSON.parse(r.body) as Record<string, unknown>;
    expect(Object.hasOwn(daImportacao, "capacidades"), "a resposta da importação declara").toBe(true);
    expect(daImportacao.capacidades).toStrictEqual({ criarProdutosDaNota: 1 });
    const g = await conferencia(String(daImportacao.id));
    expect(g.statusCode, g.body).toBe(200);
    const doGet = JSON.parse(g.body) as Record<string, unknown>;
    expect(Object.hasOwn(doGet, "capacidades"), "o GET declara").toBe(true);
    expect(doGet.capacidades).toStrictEqual({ criarProdutosDaNota: 1 });
  });
});
