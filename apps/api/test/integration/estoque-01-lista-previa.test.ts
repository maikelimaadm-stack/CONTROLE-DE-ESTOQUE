import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import {
  c, iniciar, encerrar, top, produto, armazem, saldoInicial, lancado, confirmado, cancelar, previa, movimentos, itens, recusadoNoCampo,
  j, type Hdr, type Resposta,
} from "./estoque-01-ajuda.js";

/**
 * ESTOQUE-01 (decisão 274) — A LISTA ÚNICA (ES-10) e a PRÉVIA DA CONFIRMAÇÃO (ES-11).
 *
 * A lista: filtros, paginação, ordenação e busca no SERVIDOR, e NÚMERO FIXO DE CONSULTAS — CONTADO (espião em
 * `pg.Client.prototype.query`), com uma página de 2 e outra de 12 documentos: as contagens têm de ser iguais. O
 * cenário de cada caso é isolado por armazém NOVO (o filtro `armazem_id`), para que os números não dependam dos
 * outros casos.
 *
 * A prévia: saldo atual, saldo depois, insuficiente e diferença, como texto com 4 casas — e NENHUM efeito.
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

type Linha = { id: string; codigo: string; especie: string; especie_rotulo: string; situacao: string; data_documento: string; armazem_id: string;
  armazem_destino_id: string | null; tipo_operacao_id: string; tipo_operacao: { id: string; codigo_base: string } | null; quantidade_itens: number; id_global: number | null };
type Pagina = { items: Linha[]; total: number; page: number; pageSize: number; idGlobal: { tipoEntidade: string } };
const listar = (q: string, headers: Hdr = c.h.headers()) => c.h.app.inject({ method: "GET", url: `/api/estoque/documentos?${q}`, headers });
async function pagina(q: string): Promise<Pagina> {
  const r = await listar(q);
  expect(r.statusCode, r.body).toBe(200);
  return j(r) as unknown as Pagina;
}
const idsDe = (p: Pagina) => p.items.map((x) => x.id);

describe("ES-10 — lista única: filtros, paginação, ordenação, busca e número fixo de consultas", () => {
  it("ES-10a filtros por armazém (origem OU destino), espécie, situação, período, TOP e código; ordem por data desc; forma da linha", async () => {
    const w1 = await armazem(); const w2 = await armazem();
    const p = await produto();
    const topEntrada2 = await top("estoque.entrada");
    const ent = await lancado("entrada", [{ produto_id: p.id, quantidade: "5", custo_unitario: "2" }, { produto_id: p.id, quantidade: "1", custo_unitario: "2" }], { armazem_id: w1, data_documento: "2026-05-01", tipo_operacao_id: topEntrada2 });
    const tra = await lancado("transferencia", [{ produto_id: p.id, quantidade: "1" }], { armazem_id: w1, armazem_destino_id: w2, data_documento: "2026-05-02" });
    const sai = await lancado("saida", [{ produto_id: p.id, quantidade: "1" }], { armazem_id: w1, data_documento: "2026-05-03" });
    const aju = await lancado("ajuste", [{ produto_id: p.id, quantidade_contada: "1" }], { armazem_id: w2, data_documento: "2026-05-04" });
    await confirmado("entrada", ent);
    expect((await cancelar("saida", sai)).statusCode).toBe(200);

    // Armazém: origem OU destino — a transferência aparece nos dois.
    const de1 = await pagina(`armazem_id=${w1}&pageSize=50`);
    expect([idsDe(de1), de1.total], "ordem: data do documento, da mais nova").toEqual([[sai, tra, ent], 3]);
    expect(idsDe(await pagina(`armazem_id=${w2}&pageSize=50`))).toEqual([aju, tra]);
    // A forma da linha.
    const linhaEnt = de1.items.find((x) => x.id === ent)!;
    expect(linhaEnt).toMatchObject({ especie: "entrada", especie_rotulo: expect.any(String), situacao: "confirmado", data_documento: expect.stringContaining("2026-05-01"),
      armazem_id: w1, armazem_destino_id: null, tipo_operacao_id: topEntrada2, tipo_operacao: { id: topEntrada2, codigo_base: "estoque.entrada" }, quantidade_itens: 2 });
    expect(typeof linhaEnt.id_global, "o ID Global vem na linha").toBe("number");
    expect(de1.idGlobal).toMatchObject({ tipoEntidade: "documentos_estoque" });
    expect(de1.items.find((x) => x.id === tra)).toMatchObject({ armazem_destino_id: w2 });

    // Espécie (csv), situação (csv), período, TOP e busca por código — sempre dentro do armazém do cenário.
    expect(idsDe(await pagina(`armazem_id=${w1}&especie=entrada,saida`))).toEqual([sai, ent]);
    expect(idsDe(await pagina(`armazem_id=${w1}&situacao=aberto`))).toEqual([tra]);
    expect(idsDe(await pagina(`armazem_id=${w1}&situacao=confirmado,cancelado`))).toEqual([sai, ent]);
    expect(idsDe(await pagina(`armazem_id=${w1}&start_date=2026-05-02&end_date=2026-05-02`))).toEqual([tra]);
    expect(idsDe(await pagina(`armazem_id=${w1}&start_date=2026-05-02`))).toEqual([sai, tra]);
    expect(idsDe(await pagina(`tipo_operacao_id=${topEntrada2}`))).toEqual([ent]);
    const codigo = de1.items.find((x) => x.id === tra)!.codigo;
    const busca = await pagina(`armazem_id=${w1}&search=${encodeURIComponent(codigo)}`);
    expect(idsDe(busca), "a busca é pelo código").toContain(tra);
    expect(busca.items.every((x) => x.codigo.includes(codigo))).toBe(true);
    // espécie desconhecida não amplia: zero linhas
    expect(idsDe(await pagina(`armazem_id=${w1}&especie=inventada`))).toEqual([]);
  });

  it("ES-10b paginação no servidor (total, página, tamanho) e entradas tortas: repetido → 422; uuid e data malformados → zero linhas, nunca 500", async () => {
    const w = await armazem(); const p = await produto();
    const criados: string[] = [];
    for (let d = 1; d <= 5; d++) criados.push(await lancado("saida", [{ produto_id: p.id, quantidade: "1" }], { armazem_id: w, data_documento: `2026-04-0${d}` }));
    const ordem = [...criados].reverse();
    const p1 = await pagina(`armazem_id=${w}&pageSize=2&page=1`);
    const p2 = await pagina(`armazem_id=${w}&pageSize=2&page=2`);
    const p3 = await pagina(`armazem_id=${w}&pageSize=2&page=3`);
    expect([p1.total, p1.page, p1.pageSize, p2.total, p3.total]).toEqual([5, 1, 2, 5, 5]);
    expect([...idsDe(p1), ...idsDe(p2), ...idsDe(p3)], "as páginas cobrem tudo, sem repetir, na ordem").toEqual(ordem);
    expect(idsDe(await pagina(`armazem_id=${w}&limit=1`)), "limit é apelido de pageSize").toEqual([ordem[0]]);

    recusadoNoCampo(await listar(`armazem_id=${w}&situacao=aberto&situacao=cancelado`), "situacao");
    for (const q of [`armazem_id=nao-uuid`, `tipo_operacao_id=123`, `empresa_id=x`, `armazem_id=${w}&start_date=2026-13-45`, `armazem_id=${w}&end_date=ontem`]) {
      const r = await listar(q);
      expect(r.statusCode, `${q}: ${r.body}`).toBe(200);
      expect((j(r) as unknown as Pagina).total, q).toBe(0);
    }
  });

  it("ES-10c NÚMERO FIXO de consultas: a página de 2 e a de 12 documentos fazem as MESMAS consultas (count + página + ID Global), nenhuma por linha", async () => {
    const poucos = await armazem(); const muitos = await armazem(); const p = await produto();
    for (let i = 0; i < 2; i++) await lancado("entrada", [{ produto_id: p.id, quantidade: "1", custo_unitario: "1" }, { produto_id: p.id, quantidade: "2", custo_unitario: "1" }], { armazem_id: poucos });
    for (let i = 0; i < 12; i++) await lancado("entrada", [{ produto_id: p.id, quantidade: "1", custo_unitario: "1" }, { produto_id: p.id, quantidade: "2", custo_unitario: "1" }], { armazem_id: muitos });
    async function contar(w: string): Promise<{ todas: number; documentos: number; itens: number; idGlobal: number; linhas: number }> {
      const espiao = vi.spyOn(pg.Client.prototype, "query");
      try {
        const r = await listar(`armazem_id=${w}&pageSize=50`);
        expect(r.statusCode, r.body).toBe(200);
        const sqls = espiao.mock.calls.map((x) => (typeof x[0] === "string" ? x[0] : (x[0] as { text?: unknown } | undefined)?.text)).filter((x): x is string => typeof x === "string");
        return {
          todas: sqls.length,
          documentos: sqls.filter((s) => /from erp\.documentos_estoque d\b/.test(s)).length,
          itens: sqls.filter((s) => /erp\.documentos_estoque_itens/.test(s)).length,
          idGlobal: sqls.filter((s) => /from erp\.registros_globais/.test(s)).length,
          linhas: (j(r) as unknown as Pagina).items.length,
        };
      } finally { espiao.mockRestore(); }
    }
    const a = await contar(poucos); const b = await contar(muitos);
    expect([a.linhas, b.linhas], "premissa: 2 e 12 linhas (senão a contagem não prova nada)").toEqual([2, 12]);
    expect(a).toMatchObject({ documentos: 2, itens: 1, idGlobal: 1 });
    expect(b).toMatchObject({ documentos: 2, itens: 1, idGlobal: 1 });
    expect(b.todas, "a mesma quantidade de consultas, qualquer que seja o tamanho da página").toBe(a.todas);
  });
});

describe("ES-11 — prévia: saldo, depois, insuficiente, diferença — sem efeito", () => {
  type ItemPrevia = { item_id: string; posicao: number; produto_id: string; lote: string | null; saldo_atual: string; saldo_depois: string; insuficiente: boolean; diferenca: string | null; movimento: string | null };
  type Previa = { contractVersion: number; documento: { id: string; especie: string; situacao: string; codigo: string }; podeConfirmar: boolean; itens: ItemPrevia[] };
  async function lerPrevia(especie: Parameters<typeof previa>[0], id: string): Promise<Previa> {
    const r = await previa(especie, id);
    expect(r.statusCode, r.body).toBe(200);
    return j(r) as unknown as Previa;
  }
  const resumo = (pv: Previa) => pv.itens.map((i) => [i.saldo_atual, i.saldo_depois, i.insuficiente, i.diferenca, i.movimento]);

  it("ES-11a entrada, saída (com e sem saldo), transferência e ajuste: os números como texto, e a prévia não grava nada", async () => {
    const p = await produto(); await saldoInicial(p.id, "10");
    const ent = await lancado("entrada", [{ produto_id: p.id, quantidade: "5", custo_unitario: "1" }]);
    const pe = await lerPrevia("entrada", ent);
    expect(pe).toMatchObject({ contractVersion: 1, documento: { id: ent, especie: "entrada", situacao: "aberto" }, podeConfirmar: true });
    expect(resumo(pe)).toEqual([["10.0000", "15.0000", false, null, "entry"]]);

    // saída: dois itens do mesmo produto — o segundo enxerga o que o primeiro deixou
    const sai = await lancado("saida", [{ produto_id: p.id, quantidade: "6" }, { produto_id: p.id, quantidade: "6" }]);
    const ps = await lerPrevia("saida", sai);
    expect(resumo(ps)).toEqual([["10.0000", "4.0000", false, null, "writeoff"], ["4.0000", "-2.0000", true, null, "writeoff"]]);
    expect(ps.podeConfirmar).toBe(false);
    const cabe = await lancado("saida", [{ produto_id: p.id, quantidade: "10" }]);
    const pc = await lerPrevia("saida", cabe);
    expect([pc.podeConfirmar, resumo(pc)]).toEqual([true, [["10.0000", "0.0000", false, null, "writeoff"]]]);

    const tra = await lancado("transferencia", [{ produto_id: p.id, quantidade: "2.5" }]);
    expect(resumo(await lerPrevia("transferencia", tra))).toEqual([["10.0000", "7.5000", false, null, "transfer"]]);

    const aju = await lancado("ajuste", [{ produto_id: p.id, quantidade_contada: "7" }]);
    const pa = await lerPrevia("ajuste", aju);
    expect(resumo(pa)).toEqual([["10.0000", "7.0000", false, "-3.0000", "correction_out"]]);
    const mais = await lancado("ajuste", [{ produto_id: p.id, quantidade_contada: "12.25" }]);
    expect(resumo(await lerPrevia("ajuste", mais))).toEqual([["10.0000", "12.2500", false, "2.2500", "correction_in"]]);
    const igual = await lancado("ajuste", [{ produto_id: p.id, quantidade_contada: "10" }]);
    expect(resumo(await lerPrevia("ajuste", igual))).toEqual([["10.0000", "10.0000", false, "0.0000", null]]);

    // NENHUM efeito: nada moveu, nenhum item ganhou custo, saldo ou diferença.
    for (const id of [ent, sai, cabe, tra, aju, mais, igual]) {
      expect(await movimentos(id)).toEqual([]);
      expect((await itens(id)).every((x) => x.saldo_na_confirmacao === null && x.diferenca === null)).toBe(true);
    }
    expect((await itens(sai)).map((x) => x.custo_unitario)).toEqual([null, null]);

    // A prévia diz a verdade: o ajuste confirmado grava exatamente a diferença que ela mostrou.
    await confirmado("ajuste", aju);
    expect((await itens(aju)).map((x) => [x.saldo_na_confirmacao, x.diferenca])).toEqual([["10.0000", "-3.0000"]]);
    // documento que não está aberto → 409
    const r = await previa("ajuste", aju);
    expect([r.statusCode, j(r).error?.code]).toEqual([409, "CONFLICT"]);
  });

  it("ES-11b com lote: a saída sem lote soma todos os lotes; com lote, só o dele; o ajuste olha o balde do lote", async () => {
    const p = await produto({ lote: "lote" });
    await saldoInicial(p.id, "4", { lote: "P-1" }); await saldoInicial(p.id, "6", { lote: "P-2" });
    const sai = await lancado("saida", [{ produto_id: p.id, quantidade: "7" }, { produto_id: p.id, quantidade: "5", lote: "P-1" }]);
    expect(resumo(await lerPrevia("saida", sai))).toEqual([["10.0000", "3.0000", false, null, "writeoff"], ["4.0000", "-1.0000", true, null, "writeoff"]]);
    const aju = await lancado("ajuste", [{ produto_id: p.id, quantidade_contada: "1", lote: "P-2" }, { produto_id: p.id, quantidade_contada: "2", lote: "P-NOVO" }]);
    expect(resumo(await lerPrevia("ajuste", aju))).toEqual([["6.0000", "1.0000", false, "-5.0000", "correction_out"], ["0.0000", "2.0000", false, "2.0000", "correction_in"]]);
  });

  it("ES-11c a prévia também faz número fixo de consultas: 2 itens e 12 itens, as mesmas consultas", async () => {
    const p = await produto(); await saldoInicial(p.id, "100");
    const doisItens = await lancado("saida", Array.from({ length: 2 }, () => ({ produto_id: p.id, quantidade: "1" })));
    const dozeItens = await lancado("saida", Array.from({ length: 12 }, () => ({ produto_id: p.id, quantidade: "1" })));
    async function contar(id: string): Promise<{ todas: number; itens: number }> {
      const espiao = vi.spyOn(pg.Client.prototype, "query");
      try {
        const r: Resposta = await previa("saida", id);
        expect(r.statusCode, r.body).toBe(200);
        return { todas: espiao.mock.calls.length, itens: (j(r).itens as unknown[]).length };
      } finally { espiao.mockRestore(); }
    }
    const a = await contar(doisItens); const b = await contar(dozeItens);
    expect([a.itens, b.itens], "premissa: 2 e 12 itens").toEqual([2, 12]);
    expect(b.todas, "as mesmas consultas, qualquer que seja o número de itens").toBe(a.todas);
  });
});
