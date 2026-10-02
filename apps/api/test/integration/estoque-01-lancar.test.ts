import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedDemo } from "@agro/db";
import { configuracaoNeutraTopV3, ESPECIES_DOCUMENTO_ESTOQUE, MENSAGEM_FAMILIA_SEM_EXECUCAO_TOP } from "@agro/domain";
import {
  c, iniciar, encerrar, top, produto, armazem, lancar, lancado, ler, doc, itens, movimentos, contarDocumentos, recusadoNoCampo, caminhos,
  j, unico, DATA, type Item, type Resposta,
} from "./estoque-01-ajuda.js";

/**
 * ESTOQUE-01 (decisão 274) — LANÇAR O DOCUMENTO DE ESTOQUE. ES-1 e a parte de lançamento da ES-9.
 *
 * O documento nasce ABERTO e NÃO mexe no saldo: cada lançamento é conferido no ledger (zero movimento). A TOP é
 * obrigatória e da família da espécie; o servidor CONGELA a versão atual. Recusas são 422 no CAMPO e não gravam
 * nada (contagem de documentos antes e depois), sempre com a premissa: o mesmo corpo, corrigido, salva.
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

const item = (produtoId: string, especie: (typeof ESPECIES_DOCUMENTO_ESTOQUE)[number], extra: Record<string, unknown> = {}): Item =>
  especie === "ajuste" ? { produto_id: produtoId, quantidade_contada: "3", ...extra }
    : especie === "entrada" ? { produto_id: produtoId, quantidade: "3", custo_unitario: "2.5", ...extra }
      : { produto_id: produtoId, quantidade: "3", ...extra };

const versaoAtual = async (topId: string) => (await c.admin.query<{ id: string; versao: number }>(
  "select v.id, v.versao from erp.tipos_operacao t join erp.tipos_operacao_versoes v on v.tipo_operacao_id=t.id and v.versao=t.versao_atual where t.id=$1", [topId])).rows[0]!;

describe("ES-1 — lançar cada espécie: ABERTO, sem movimento, TOP da família, versão congelada", () => {
  it("ES-1a as quatro espécies nascem abertas, com código por espécie, ID Global, a versão atual congelada — e NENHUM movimento", async () => {
    const p = await produto();
    const antes = await contarDocumentos();
    for (const especie of ESPECIES_DOCUMENTO_ESTOQUE) {
      const r = await lancar(especie, [item(p.id, especie)]);
      expect(r.statusCode, `${especie}: ${r.body}`).toBe(201);
      const corpo = j(r) as { id: string; codigo: string; especie: string; situacao: string };
      expect(corpo).toMatchObject({ especie, situacao: "aberto" });
      expect(corpo.codigo, "número do documento").toMatch(/\S/);
      const d = await doc(corpo.id);
      const v = await versaoAtual(c.tops[especie]);
      expect([d.situacao, d.especie, d.codigo, d.tipo_operacao_id, d.tipo_operacao_versao_id]).toEqual(["aberto", especie, corpo.codigo, c.tops[especie], v.id]);
      expect(await movimentos(corpo.id), `${especie}: lançar NÃO mexe no saldo`).toEqual([]);
      const gid = (await c.admin.query("select 1 from erp.registros_globais where organization_id=$1 and tipo_entidade='documentos_estoque' and id_entidade=$2", [c.h.demo.orgId, corpo.id])).rowCount;
      expect(gid, `${especie}: ID Global alocado`).toBe(1);
      // Os itens como o banco os guarda: a espécie copiada e os números exatos.
      const [it] = await itens(corpo.id);
      if (especie === "ajuste") expect([it!.quantidade, it!.quantidade_contada, it!.custo_unitario]).toEqual([null, "3.0000", null]);
      else if (especie === "entrada") expect([it!.quantidade, it!.quantidade_contada, it!.custo_unitario]).toEqual(["3.0000", null, "2.500000"]);
      else expect([it!.quantidade, it!.quantidade_contada, it!.custo_unitario]).toEqual(["3.0000", null, null]);
      // A leitura devolve a TOP congelada e os itens; nenhum movimento.
      const lida = await ler(especie, corpo.id);
      expect(lida.statusCode, lida.body).toBe(200);
      expect(j(lida)).toMatchObject({ id: corpo.id, especie, situacao: "aberto", tipo_operacao: { id: c.tops[especie], codigo_base: `estoque.${especie}`, versao: v.versao }, movimentos: [] });
      expect((j(lida).itens as { produto_id: string; produto_nome: string }[]).map((x) => [x.produto_id, x.produto_nome])).toEqual([[p.id, p.nome]]);
    }
    expect(await contarDocumentos()).toBe(antes + 4);
    expect(await c.admin.query("select 1 from erp.stock_balances where product_id=$1", [p.id]).then((x) => x.rowCount), "nenhum saldo nasceu").toBe(0);
  });

  it("ES-1b TOP de OUTRA família (outra espécie de estoque, compra, família antiga de estoque) → 422 TIPO_OPERACAO_INDISPONIVEL e nada gravado", async () => {
    const p = await produto();
    const topCompra = await top("compras.compra");
    const topAntiga = await top("estoque.entrada_manual");
    const antes = await contarDocumentos();
    const casos: [string, (typeof ESPECIES_DOCUMENTO_ESTOQUE)[number], string][] = [
      ["TOP de saída na entrada", "entrada", c.tops.saida],
      ["TOP de entrada na saída", "saida", c.tops.entrada],
      ["TOP de ajuste na transferência", "transferencia", c.tops.ajuste],
      ["TOP de transferência no ajuste", "ajuste", c.tops.transferencia],
      ["TOP de compra na entrada", "entrada", topCompra],
      ["TOP inexistente", "saida", "00000000-0000-4000-8000-000000000000"],
    ];
    casos.push(["TOP de família ANTIGA de estoque (entrada manual)", "entrada", topAntiga]);
    for (const [nome, especie, topId] of casos) {
      const r = await lancar(especie, [item(p.id, especie)], { tipo_operacao_id: topId });
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(422);
      expect(j(r).error!.code, nome).toBe("TIPO_OPERACAO_INDISPONIVEL");
    }
    expect(await contarDocumentos(), "as recusas não gravaram nada").toBe(antes);
    // TOP inativa da família certa → a mesma recusa.
    const inativa = await top("estoque.entrada");
    expect((await c.admin.query("update erp.tipos_operacao set ativo=false where id=$1", [inativa])).rowCount).toBe(1);
    expect(j(await lancar("entrada", [item(p.id, "entrada")], { tipo_operacao_id: inativa })).error?.code).toBe("TIPO_OPERACAO_INDISPONIVEL");
    // PREMISSA: a TOP certa salva.
    for (const especie of ESPECIES_DOCUMENTO_ESTOQUE) await lancado(especie, [item(p.id, especie)]);
  });

  it("ES-1c a VERSÃO fica congelada: a TOP ganha versão nova; o documento antigo continua na dele, o novo nasce na nova", async () => {
    const p = await produto();
    const t = await top("estoque.saida");
    const v1 = await versaoAtual(t);
    const antigo = await lancado("saida", [item(p.id, "saida")], { tipo_operacao_id: t });
    const revisao = (await c.admin.query<{ revisao: number }>("select revisao from erp.tipos_operacao where id=$1", [t])).rows[0]!.revisao;
    const put = await c.ligada.inject({ method: "PUT", url: `/api/admin/tipos-operacao/${t}`, headers: c.h.headers(), payload: { revisao, nome: `Saída renomeada ${unico()}` } });
    expect(put.statusCode, put.body).toBe(200);
    const v2 = await versaoAtual(t);
    expect(v2.versao, "premissa: a TOP ganhou versão nova").toBe(v1.versao + 1);
    const novo = await lancado("saida", [item(p.id, "saida")], { tipo_operacao_id: t });
    expect((await doc(antigo)).tipo_operacao_versao_id).toBe(v1.id);
    expect((await doc(novo)).tipo_operacao_versao_id).toBe(v2.id);
    expect(j(await ler("saida", antigo)).tipo_operacao).toMatchObject({ id: t, versao: v1.versao });
    // A versão não muda depois do lançamento nem no banco (gatilho da 0040).
    await expect(c.admin.query("update erp.documentos_estoque set tipo_operacao_versao_id=$2 where id=$1", [antigo, v2.id])).rejects.toThrow();
    // O cliente não escolhe a versão: chave a mais no corpo é recusada.
    expect((await lancar("saida", [item(p.id, "saida")], { tipo_operacao_id: t, tipo_operacao_versao_id: v1.id })).statusCode).toBe(422);
  });

  it("ES-1d a mesma Idempotency-Key devolve o mesmo documento (um só no banco); outra chave lança outro", async () => {
    const p = await produto();
    const chave = `es1d-${unico()}`;
    const h = c.h.headers({ "idempotency-key": chave });
    const antes = await contarDocumentos();
    const a = await lancar("entrada", [item(p.id, "entrada")], {}, h);
    const b = await lancar("entrada", [item(p.id, "entrada")], {}, h);
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(j(b)).toEqual(j(a));
    expect(await contarDocumentos()).toBe(antes + 1);
    const outro = await lancar("entrada", [item(p.id, "entrada")], {}, c.h.headers({ "idempotency-key": `es1d-${unico()}` }));
    expect(outro.statusCode).toBe(201);
    expect(j(outro).id).not.toBe(j(a).id);
  });

  it("ES-1e a TOP com \"observação obrigatória\" recusa o documento sem observação (422 no campo); com observação, salva", async () => {
    const p = await produto();
    const conf = configuracaoNeutraTopV3(); conf.geral.exigeObservacao = true;
    const t = await top("estoque.ajuste", { configuracao: conf });
    const antes = await contarDocumentos();
    for (const observacao of [undefined, "   "]) {
      const r = await lancar("ajuste", [item(p.id, "ajuste")], { tipo_operacao_id: t, ...(observacao === undefined ? {} : { observacao }) });
      expect(r.statusCode, r.body).toBe(422);
      expect(j(r).error!.code).toBe("TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA");
      expect(JSON.stringify(j(r).error!.details)).toContain("observacao");
    }
    expect(await contarDocumentos()).toBe(antes);
    await lancado("ajuste", [item(p.id, "ajuste")], { tipo_operacao_id: t, observacao: "inventário de setembro" });
  });

  it("ES-1f a execução configurada continua RECUSADA nas famílias novas: TOP de estoque com efeito configurado → 422, nada cadastrado", async () => {
    for (const especie of ESPECIES_DOCUMENTO_ESTOQUE) {
      const conf = configuracaoNeutraTopV3();
      conf.execucao = { estoque: "configurada", financeiro: "legado" };
      conf.estoque.atualizacao = especie === "saida" ? "saida" : "entrada";
      const codigo = `75${unico()}`.slice(0, 10);
      const r = await c.ligada.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: c.h.headers(),
        payload: { codigo, codigoBase: `estoque.${especie}`, nome: `Configurada ${especie}`, configuracao: conf } });
      expect(r.statusCode, `${especie}: ${r.body}`).toBe(422);
      expect(j(r).error!.code).toBe("TIPO_OPERACAO_CONFIGURACAO_INVALIDA");
      expect(j(r).error!.message, "a mensagem de hoje").toContain(MENSAGEM_FAMILIA_SEM_EXECUCAO_TOP);
      expect((await c.admin.query("select 1 from erp.tipos_operacao where organization_id=$1 and codigo=$2", [c.h.demo.orgId, codigo])).rowCount).toBe(0);
    }
  });
});

describe("ES-1 — contrato de entrada ESTRITO por espécie, números como texto canônico (422, nunca 500, nunca arredondado)", () => {
  it("ES-1g chave desconhecida, campo de outra espécie e destino fora da transferência → 422 no campo; nada gravado", async () => {
    const p = await produto();
    const antes = await contarDocumentos();
    // chave desconhecida: recusada (nunca descartada em silêncio), no cabeçalho e no item
    for (const r of [await lancar("entrada", [item(p.id, "entrada")], { campo_inventado: 1 }), await lancar("entrada", [item(p.id, "entrada", { inventado: true })])]) {
      expect(r.statusCode, r.body).toBe(422);
      expect(j(r).error!.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(j(r).error!.details)).toContain("Campo não reconhecido");
    }
    // entrada: quantidade contada proibida (o custo passou a ser OPCIONAL — OPERACOES-01 F5a, abaixo)
    recusadoNoCampo(await lancar("entrada", [item(p.id, "entrada", { quantidade_contada: "1" })]), "itens.0.quantidade_contada");
    // saída e transferência: custo e contada proibidos; quantidade obrigatória
    recusadoNoCampo(await lancar("saida", [item(p.id, "saida", { custo_unitario: "1" })]), "itens.0.custo_unitario");
    recusadoNoCampo(await lancar("transferencia", [item(p.id, "transferencia", { custo_unitario: "1" })]), "itens.0.custo_unitario");
    recusadoNoCampo(await lancar("transferencia", [item(p.id, "transferencia", { quantidade_contada: "1" })]), "itens.0.quantidade_contada");
    recusadoNoCampo(await lancar("saida", [{ produto_id: p.id }]), "itens.0.quantidade");
    // ajuste: contada obrigatória; quantidade proibida (o custo passou a ser OPCIONAL — OPERACOES-01 F5a, abaixo)
    recusadoNoCampo(await lancar("ajuste", [{ produto_id: p.id }]), "itens.0.quantidade_contada");
    recusadoNoCampo(await lancar("ajuste", [item(p.id, "ajuste", { quantidade: "1" })]), "itens.0.quantidade");
    // destino: só na transferência, obrigatório nela
    recusadoNoCampo(await lancar("entrada", [item(p.id, "entrada")], { armazem_destino_id: c.I.warehouse2 }), "armazem_destino_id");
    recusadoNoCampo(await lancar("transferencia", [item(p.id, "transferencia")], { armazem_destino_id: null }), "armazem_destino_id");
    // sem itens
    expect((await lancar("entrada", [])).statusCode).toBe(422);
    expect(await contarDocumentos(), "nenhuma recusa gravou").toBe(antes);
    // PREMISSA
    await lancado("entrada", [item(p.id, "entrada")]);
    // OPERACOES-01 F5a (decisão 282): a ENTRADA SEM CUSTO e o AJUSTE COM CUSTO passaram a ser ACEITOS. Lançados, o
    // item guarda o que veio: a entrada sem custo fica sem custo até a confirmação (que grava o custo médio do
    // produto), e o ajuste guarda o custo informado, EXATO.
    const semCusto = await lancado("entrada", [{ produto_id: p.id, quantidade: "1" }]);
    expect((await itens(semCusto)).map((x) => [x.quantidade, x.custo_unitario])).toEqual([["1.0000", null]]);
    const ajusteComCusto = await lancado("ajuste", [item(p.id, "ajuste", { custo_unitario: "1.25" })]);
    expect((await itens(ajusteComCusto)).map((x) => [x.quantidade_contada, x.custo_unitario])).toEqual([["3.0000", "1.250000"]]);
    expect(await movimentos(semCusto), "lançar continua sem mexer no saldo").toEqual([]);
    expect(await movimentos(ajusteComCusto)).toEqual([]);
  });

  it("ES-1h números: JSON number, vírgula, sinal, expoente, casas e inteiros além da coluna, zero onde é positivo → 422 no campo; o válido grava EXATO", async () => {
    const p = await produto();
    const antes = await contarDocumentos();
    const ruins: [string, Item, string][] = [
      ["quantidade como número JSON", { produto_id: p.id, quantidade: 3, custo_unitario: "1" }, "itens.0.quantidade"],
      ["vírgula decimal", { produto_id: p.id, quantidade: "3,5", custo_unitario: "1" }, "itens.0.quantidade"],
      ["sinal negativo", { produto_id: p.id, quantidade: "-3", custo_unitario: "1" }, "itens.0.quantidade"],
      ["expoente", { produto_id: p.id, quantidade: "1e3", custo_unitario: "1" }, "itens.0.quantidade"],
      ["5 casas na quantidade (a coluna tem 4)", { produto_id: p.id, quantidade: "1.00001", custo_unitario: "1" }, "itens.0.quantidade"],
      ["15 dígitos inteiros (a coluna tem 14)", { produto_id: p.id, quantidade: "123456789012345", custo_unitario: "1" }, "itens.0.quantidade"],
      ["quantidade zero", { produto_id: p.id, quantidade: "0", custo_unitario: "1" }, "itens.0.quantidade"],
      ["7 casas no custo (a coluna tem 6)", { produto_id: p.id, quantidade: "1", custo_unitario: "1.0000001" }, "itens.0.custo_unitario"],
      ["custo negativo", { produto_id: p.id, quantidade: "1", custo_unitario: "-1" }, "itens.0.custo_unitario"],
      ["custo como número JSON", { produto_id: p.id, quantidade: "1", custo_unitario: 1.5 }, "itens.0.custo_unitario"],
      ["espaço", { produto_id: p.id, quantidade: " 1", custo_unitario: "1" }, "itens.0.quantidade"],
    ];
    for (const [nome, it, campo] of ruins) {
      const r = await lancar("entrada", [it]);
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(422);
      expect(caminhos(r), nome).toContain(campo);
    }
    // ajuste: contagem negativa recusada; ZERO é contagem válida.
    recusadoNoCampo(await lancar("ajuste", [{ produto_id: p.id, quantidade_contada: "-1" }]), "itens.0.quantidade_contada");
    expect(await contarDocumentos(), "nenhuma recusa gravou").toBe(antes);
    // PREMISSA: no limite exato da coluna grava como veio — nada arredondado.
    const id = await lancado("entrada", [{ produto_id: p.id, quantidade: "12345678901234.1234", custo_unitario: "123456789012.123456" }]);
    expect((await itens(id)).map((x) => [x.quantidade, x.custo_unitario])).toEqual([["12345678901234.1234", "123456789012.123456"]]);
    const zero = await lancado("ajuste", [{ produto_id: p.id, quantidade_contada: "0" }]);
    expect((await itens(zero))[0]!.quantidade_contada).toBe("0.0000");
  });
});

describe("ES-9 — no lançamento: produto sem controle de estoque, produto ou armazém inativo, armazém de outra empresa, lote obrigatório → 422 no campo", () => {
  it("ES-9a cada cadastro inválido é recusado no campo e nada é gravado; corrigido, salva", async () => {
    const p = await produto();
    const servico = await produto({ controla: false });
    const inativo = await produto({ ativo: false });
    const comLote = await produto({ lote: "lote" });
    const comValidade = await produto({ lote: "lote_validade" });
    const armazemInativo = await armazem({ ativo: false });
    const armazemExcluido = await armazem();
    await c.admin.query("update erp.warehouses set deleted_at=now() where id=$1", [armazemExcluido]);
    const antes = await contarDocumentos();
    const casos: [string, Promise<Resposta>, string][] = [
      ["produto que não controla estoque", lancar("entrada", [item(servico.id, "entrada")]), "itens.0.produto_id"],
      ["produto inativo", lancar("saida", [item(inativo.id, "saida")]), "itens.0.produto_id"],
      ["produto de outra organização (inexistente aqui)", lancar("ajuste", [item("00000000-0000-4000-8000-000000000001", "ajuste")]), "itens.0.produto_id"],
      ["armazém inativo", lancar("entrada", [item(p.id, "entrada")], { armazem_id: armazemInativo }), "armazem_id"],
      ["armazém excluído", lancar("saida", [item(p.id, "saida")], { armazem_id: armazemExcluido }), "armazem_id"],
      ["armazém de outra empresa", lancar("entrada", [item(p.id, "entrada")], { armazem_id: c.I.warehouseEmpresa2 }), "armazem_id"],
      ["destino de outra empresa", lancar("transferencia", [item(p.id, "transferencia")], { armazem_destino_id: c.I.warehouseEmpresa2 }), "armazem_destino_id"],
      ["destino inativo", lancar("transferencia", [item(p.id, "transferencia")], { armazem_destino_id: armazemInativo }), "armazem_destino_id"],
      ["origem = destino", lancar("transferencia", [item(p.id, "transferencia")], { armazem_destino_id: c.I.warehouse }), "armazem_destino_id"],
      ["entrada de produto com lote sem lote", lancar("entrada", [item(comLote.id, "entrada")]), "itens.0.lote"],
      ["ajuste de produto com lote sem lote", lancar("ajuste", [item(comLote.id, "ajuste")]), "itens.0.lote"],
      ["entrada de lote e validade sem validade", lancar("entrada", [item(comValidade.id, "entrada", { lote: "LV" })]), "itens.0.validade"],
      ["lote em produto sem lote", lancar("entrada", [item(p.id, "entrada", { lote: "L1" })]), "itens.0.lote"],
      ["o mesmo saldo contado duas vezes no ajuste", lancar("ajuste", [item(p.id, "ajuste"), item(p.id, "ajuste")]), "itens.1.produto_id"],
    ];
    for (const [nome, prom, campo] of casos) {
      const r = await prom;
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(422);
      expect(caminhos(r), `${nome}: o 422 aponta o campo — ${r.body}`).toContain(campo);
    }
    expect(await contarDocumentos(), "nenhuma recusa gravou").toBe(antes);
    // PREMISSAS: cada um, corrigido, salva. Na saída e na transferência o lote é opcional (escolha por validade).
    await lancado("entrada", [item(comLote.id, "entrada", { lote: "L-ES9" })]);
    await lancado("ajuste", [item(comLote.id, "ajuste", { lote: "L-ES9" })]);
    await lancado("entrada", [item(comValidade.id, "entrada", { lote: "LV-ES9", validade: "2027-12-31" })]);
    await lancado("saida", [item(comLote.id, "saida")]);
    await lancado("transferencia", [item(p.id, "transferencia")], { armazem_destino_id: c.I.warehouse2 });
    await lancado("ajuste", [item(p.id, "ajuste"), item(comLote.id, "ajuste", { lote: "L-A" }), item(comLote.id, "ajuste", { lote: "L-B" })]);
  });
});

describe("ES-1 — superfície de recusa da leitura: outra organização, outra espécie, inexistente e malformado → a MESMA 404", () => {
  it("ES-1i o documento de outra organização não se distingue do inexistente; a lista não o mostra", async () => {
    const demoB = await seedDemo(c.admin, { slug: `es01b${unico()}`, orgName: "[TEST] Org ES-1", adminEmail: `admin-b-${unico()}@es01.local`, adminPassword: "Restrito@12345" }, () => {});
    const lb = await c.h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: demoB.adminEmail, password: demoB.adminPassword } });
    expect(lb.statusCode, lb.body).toBe(200);
    const hB = { authorization: `Bearer ${(lb.json() as { token: string }).token}`, "x-org-id": demoB.orgId };
    const um = async (sql: string, params: unknown[]) => (await c.admin.query<{ id: string }>(sql, params)).rows[0]!.id;
    const topB = await top("estoque.entrada", {}, hB);
    const rB = await c.h.app.inject({ method: "POST", url: "/api/estoque/entradas", headers: hB, payload: {
      empresa_id: demoB.empresaIds[0], tipo_operacao_id: topB, data_documento: DATA,
      armazem_id: await um("select id from erp.warehouses where organization_id=$1 and empresa_id=$2 and is_active and deleted_at is null order by initials limit 1", [demoB.orgId, demoB.empresaIds[0]]),
      itens: [{ produto_id: await um("select id from erp.products where organization_id=$1 and description like 'Ração%'", [demoB.orgId]), quantidade: "1", custo_unitario: "1" }] } });
    expect(rB.statusCode, `premissa: o documento da outra organização existe — ${rB.body}`).toBe(201);
    const idB = (j(rB) as { id: string }).id;
    expect((await ler("entrada", idB, hB)).statusCode, "premissa: o dono lê").toBe(200);

    const p = await produto();
    const meu = await lancado("entrada", [item(p.id, "entrada")]);
    const inexistente = await ler("entrada", "00000000-0000-4000-8000-000000000000");
    const forma = (r: Resposta) => [r.statusCode, j(r).error?.code, j(r).error?.message];
    expect(inexistente.statusCode).toBe(404);
    for (const [nome, r] of [
      ["de outra organização", await ler("entrada", idB)],
      ["de outra espécie (a entrada pela porta da saída)", await ler("saida", meu)],
      ["malformado", await ler("entrada", "nao-e-um-uuid")],
      ["uuid em maiúsculas de outra organização", await ler("entrada", idB.toUpperCase())],
    ] as const) expect(forma(r), nome).toEqual(forma(inexistente));
    // a prévia, a confirmação e o cancelamento respondem a mesma 404 (nada sai antes da autorização)
    for (const acao of ["previa-confirmacao", "confirmar", "cancelar"]) {
      const r = await c.h.app.inject({ method: acao === "previa-confirmacao" ? "GET" : "POST", url: `/api/estoque/entradas/${idB}/${acao}`, headers: c.h.headers(), ...(acao === "previa-confirmacao" ? {} : { payload: {} }) });
      expect(forma(r), acao).toEqual(forma(inexistente));
    }
    expect((await doc(idB)).situacao, "nada aconteceu com o documento alheio").toBe("aberto");
    const lista = await c.h.app.inject({ method: "GET", url: "/api/estoque/documentos?pageSize=200", headers: c.h.headers() });
    expect(lista.statusCode, lista.body).toBe(200);
    const ids = (j(lista).items as { id: string }[]).map((x) => x.id);
    expect(ids, "premissa: a lista traz os meus").toContain(meu);
    expect(ids).not.toContain(idB);
  });
});
