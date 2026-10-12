import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedDemo } from "@agro/db";
import { LAYOUT_DO_SISTEMA, type EstruturaLayout } from "@agro/domain";
import {
  c, iniciar, encerrar, j, erro, produto, top, cfg4, novaVersao, itemCompra, corpoCompra, compraLancada, lancarCompra, confirmarCompra, lerCompra,
  receberPedido, corpoReceber, usuario, escopos, unico,
  type EspecieCompra, type Hdr, type Resposta,
} from "./top-config-08-ajuda.js";
import { MSG_EDICAO_COMPRA_CONFIRMADA, msgEdicaoPedidoComCompraViva, MSG_EDICAO_FORNECEDOR_DA_COMPRA_DO_PEDIDO, MSG_EDICAO_PRODUTO_DA_COMPRA_DO_PEDIDO,
  MSG_EDICAO_ITEM_NOVO_NA_COMPRA_DO_PEDIDO } from "../../src/routes/compras-edicao-regras.js";

/**
 * EDITAR-02 (decisão 313) — `GET /api/compras/{pedidos|compras}/:id/edicao` e a PORTA das duas rotas da edição.
 *
 *   (e) a capacidade: `<recurso>.view` sem `.edit` → 403; `.edit` sem `.view` → 403 — no `/edicao` e na PATCH, nas duas
 *       espécies, a MESMA 403 para o documento que existe e o que não existe (a negação não revela existência), nada lido
 *       nem gravado;
 *   (g) a MESMA 404 (status e corpo, o do `GET :id`) para outra organização, fora do escopo de empresa, inexistente, id
 *       malformado e espécie errada — no `/edicao` e na PATCH; "excluído" não existe no documento de compra (provado
 *       pelo catálogo: a tabela não tem coluna de exclusão — decisão 247, nada se apaga);
 *   (m) o `/edicao`: `podeEditar`/`motivo` da MESMA função da PATCH (a mensagem do 409 é o `motivo`), `version`, os
 *       `limites`, `regras` pela versão CONGELADA (a TOP republicada depois não muda o que a edição cobra), `layout` o de
 *       HOJE da TOP, `documento` = o `GET :id`; leitura pura (nada gravado, a versão não sobe).
 *
 * TESTEMUNHA: o banco, por conexão de superusuário (sem RLS).
 */

beforeAll(iniciar, 240_000);
afterAll(encerrar);

const SEGMENTO: Record<EspecieCompra, string> = { compra: "compras", pedido: "pedidos" };
const RECURSO: Record<EspecieCompra, string> = { compra: "compras", pedido: "pedidos_compra" };
const FAMILIA: Record<EspecieCompra, string> = { compra: "compras.compra", pedido: "compras.pedido" };
const ESPECIES: readonly EspecieCompra[] = ["compra", "pedido"];
const NAO_ACHADO = "00000000-0000-4000-8000-000000000000";

const edicao = (especie: EspecieCompra, id: string, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.ligada.inject({ method: "GET", url: `/api/compras/${SEGMENTO[especie]}/${id}/edicao`, headers });
const patch = (especie: EspecieCompra, id: string, payload: Record<string, unknown>, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.ligada.inject({ method: "PATCH", url: `/api/compras/${SEGMENTO[especie]}/${id}`, headers, payload });
const get = (url: string, headers: Hdr = c.h.headers()): Promise<Resposta> => c.ligada.inject({ method: "GET", url, headers });

type Linha = Record<string, unknown>;
const versao = async (id: string): Promise<string> => (await c.admin.query<{ v: string }>("select version::text v from erp.documentos_compra where id = $1", [id])).rows[0]!.v;
const foto = async (id: string) => ({
  doc: (await c.admin.query<Linha>("select * from erp.documentos_compra where id = $1", [id])).rows[0]!,
  itens: (await c.admin.query<Linha>("select * from erp.documentos_compra_itens where documento_id = $1 order by posicao, id", [id])).rows,
  eventos: (await c.admin.query<Linha>("select id, action from erp.audit_logs where entity = 'documentos_compra' and entity_id = $1 order by id", [id])).rows,
});
async function documento(especie: EspecieCompra, extra: Record<string, unknown> = {}): Promise<string> {
  return (await compraLancada(especie, corpoCompra([itemCompra((await produto()).id, "2", "10.00")], extra, especie))).id;
}
type EdicaoLida = {
  podeEditar: boolean; motivo: string | null; version: string; documento: Record<string, unknown>;
  regras: Record<string, unknown> & { exigencias: unknown[]; condicoesPermitidas: unknown }; condicoesPermitidas: unknown;
  layout: Record<string, unknown>;
  limites: { campos: Record<string, string>; itemNovo: string | null; itens: { id: string; campos: Record<string, string>; quantidadeMaxima: string | null }[] };
};
async function lida(especie: EspecieCompra, id: string): Promise<EdicaoLida> {
  const r = await edicao(especie, id);
  expect(r.statusCode, r.body).toBe(200);
  return j(r) as unknown as EdicaoLida;
}

// ─────────────── (e) a capacidade ───────────────

describe("(e) a porta: `<recurso>.edit` E `<recurso>.view`", () => {
  it("só .view → 403; só .edit → 403 — no /edicao e na PATCH, nas duas espécies; a MESMA 403 para o que existe e o que não existe; nada gravado", async () => {
    const soVer = await usuario("E2 só ver", ["compras.view", "pedidos_compra.view"]);
    const soEditar = await usuario("E2 só editar", ["compras.edit", "pedidos_compra.edit"]);
    const ambos = await usuario("E2 edita e vê", ["compras.edit", "compras.view", "pedidos_compra.edit", "pedidos_compra.view"]);
    let provados = 0;
    for (const especie of ESPECIES) {
      const id = await documento(especie);
      const antes = await foto(id);
      for (const [quem, headers, falta] of [["só .view", soVer, `${RECURSO[especie]}.edit`], ["só .edit", soEditar, `${RECURSO[especie]}.view`]] as const) {
        for (const porta of ["edicao", "patch"] as const) {
          const chamar = (alvo: string) => porta === "edicao" ? edicao(especie, alvo, headers) : patch(especie, alvo, { version: antes.doc.version, observacao: "x" }, headers);
          const r = await chamar(id);
          expect(r.statusCode, `${especie} ${quem} ${porta}: ${r.body}`).toBe(403);
          expect(erro(r).code).toBe("PERMISSION_DENIED");
          expect(erro(r).message, `${especie} ${quem} ${porta}: a capacidade que falta`).toContain(falta);
          const inexistente = await chamar(NAO_ACHADO);
          expect([inexistente.statusCode, inexistente.body], `${especie} ${quem} ${porta}: a MESMA 403`).toEqual([403, r.body]);
          provados++;
        }
      }
      expect(await foto(id), `${especie}: nada gravado`).toEqual(antes);
      // Premissa: com as duas, as duas portas respondem.
      expect((await edicao(especie, id, ambos)).statusCode, especie).toBe(200);
      expect((await patch(especie, id, { version: antes.doc.version, observacao: "com as duas" }, ambos)).statusCode, especie).toBe(200);
    }
    expect(provados).toBe(8);
  });
});

// ─────────────── (g) a MESMA 404 ───────────────

describe("(g) a negação não revela existência: a MESMA 404 do GET :id", () => {
  it("outra organização, fora do escopo de empresa, inexistente, malformado e espécie errada → a mesma 404 (status e corpo) no /edicao e na PATCH", async () => {
    const o = await seedDemo(c.admin, { orgName: "[TEST] Org E2", adminEmail: `admin-e2-${unico()}@demo.local`, adminPassword: "Demo@12345", slug: `orge2${unico()}` }, () => {});
    const login = await c.h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: o.adminEmail, password: "Demo@12345" } });
    expect(login.statusCode, login.body).toBe(200);
    const daOutraOrg: Hdr = { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": o.orgId };
    const foraDoEscopo = await usuario("E2 só da empresa 2", ["compras.edit", "compras.view", "pedidos_compra.edit", "pedidos_compra.view"], escopos({ compras: [c.I.empresa2] }));
    const docs = { compra: await documento("compra"), pedido: await documento("pedido") };
    const fotos = { compra: await foto(docs.compra), pedido: await foto(docs.pedido) };
    let provados = 0;
    for (const especie of ESPECIES) {
      const outra: EspecieCompra = especie === "compra" ? "pedido" : "compra";
      const referencia = await get(`/api/compras/${SEGMENTO[especie]}/${NAO_ACHADO}`);
      expect(referencia.statusCode, "premissa: o GET :id do inexistente é 404").toBe(404);
      const casos: [string, string, Hdr][] = [
        ["outra organização", docs[especie], daOutraOrg],
        ["fora do escopo de empresa", docs[especie], foraDoEscopo],
        ["inexistente", NAO_ACHADO, c.h.headers()],
        ["malformado", "nao-e-uuid", c.h.headers()],
        ["espécie errada", docs[outra], c.h.headers()],
      ];
      for (const [nome, alvo, headers] of casos) {
        const e = await edicao(especie, alvo, headers);
        expect([e.statusCode, e.body], `${especie} /edicao ${nome}`).toEqual([404, referencia.body]);
        const p = await patch(especie, alvo, { version: "0", observacao: "x" }, headers);
        expect([p.statusCode, p.body], `${especie} PATCH ${nome}`).toEqual([404, referencia.body]);
        provados += 2;
      }
      // Premissa: o documento EXISTE e o admin da organização o lê pela mesma porta.
      expect((await edicao(especie, docs[especie])).statusCode, especie).toBe(200);
    }
    expect(provados).toBe(20);
    expect(await foto(docs.compra), "nada gravado").toEqual(fotos.compra);
    expect(await foto(docs.pedido), "nada gravado").toEqual(fotos.pedido);
    // "Excluído" não existe: o documento de compra não tem coluna de exclusão (nada se apaga — decisão 247).
    const colunas = await c.admin.query("select column_name from information_schema.columns where table_schema = 'erp' and table_name = 'documentos_compra' and column_name in ('deleted_at', 'excluido_em', 'excluido_por')");
    expect(colunas.rows, "a tabela não tem exclusão lógica").toEqual([]);
  });
});

// ─────────────── (m) o /edicao ───────────────

describe("(m) o /edicao: a mesma pergunta da PATCH, a versão congelada, o layout de hoje", () => {
  it("documento aberto: podeEditar, version, documento = GET :id, regras = /regras-da-operacao (versão única), layout = /layout-efetivo, limites vazios; leitura pura", async () => {
    for (const especie of ESPECIES) {
      const t = await top(FAMILIA[especie], { configuracao: cfg4() });
      const id = await documento(especie, { tipo_operacao_id: t });
      const antes = await foto(id);
      const e = await lida(especie, id);
      expect([e.podeEditar, e.motivo], especie).toEqual([true, null]);
      expect(e.version, especie).toBe(await versao(id));
      expect(e.documento, especie).toEqual(j(await lerCompra(especie, id)));
      expect(e.regras, especie).toEqual(j(await get(`/api/compras/${SEGMENTO[especie]}/regras-da-operacao?tipo_operacao_id=${t}`)));
      expect(e.condicoesPermitidas, especie).toEqual(e.regras.condicoesPermitidas);
      expect(e.layout, especie).toEqual(j(await get(`/api/compras/${SEGMENTO[especie]}/layout-efetivo?tipo_operacao_id=${t}`)));
      const itemId = (e.documento.itens as { id: string }[])[0]!.id;
      expect(e.limites, especie).toEqual({ campos: {}, itemNovo: null, itens: [{ id: itemId, campos: {}, quantidadeMaxima: null }] });
      expect(await foto(id), `${especie}: leitura pura`).toEqual(antes);
    }
  });

  it("REGRAS pela versão CONGELADA: a TOP republicada exigindo a observação não muda o /edicao nem a PATCH; LAYOUT de HOJE: o layout ligado depois aparece", async () => {
    for (const especie of ESPECIES) {
      const t = await top(FAMILIA[especie], { configuracao: cfg4() });
      const id = await documento(especie, { tipo_operacao_id: t });
      const regrasDaV1 = (await lida(especie, id)).regras;
      expect(regrasDaV1.exigencias, `${especie}: premissa — a v1 não exige nada`).toEqual([]);
      await novaVersao(t, cfg4((x) => { x.geral.exigeObservacao = true; }));
      const atual = j(await get(`/api/compras/${SEGMENTO[especie]}/regras-da-operacao?tipo_operacao_id=${t}`)) as { exigencias: unknown[] };
      expect(atual.exigencias.length, `${especie}: premissa — a versão ATUAL exige a observação`).toBeGreaterThan(0);
      const posto = await lancarCompra(especie, corpoCompra([itemCompra((await produto()).id)], { tipo_operacao_id: t }, especie));
      expect(erro(posto).code, `${especie}: premissa — o POST de hoje cobra a versão nova`).toBe("TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA");
      const depois = await lida(especie, id);
      expect(depois.regras, `${especie}: o /edicao responde a versão congelada`).toEqual(regrasDaV1);
      const r = await patch(especie, id, { version: depois.version, data_documento: "2026-09-11" });
      expect(r.statusCode, `${especie}: a PATCH cobra a versão congelada (sem observação, passa) — ${r.body}`).toBe(200);
      // O layout ligado HOJE à TOP do documento: o /edicao responde o mesmo que `/layout-efetivo`.
      const sistema = depois.layout;
      expect(sistema.origem, `${especie}: premissa — sem layout ligado, o do sistema`).toBe("sistema");
      const estrutura: EstruturaLayout = structuredClone(LAYOUT_DO_SISTEMA(FAMILIA[especie]));
      const criado = await c.h.app.inject({ method: "POST", url: "/api/admin/layouts-documento", headers: c.h.headers(), payload: { familia: FAMILIA[especie], nome: `E2 m ${unico()}`, estrutura } });
      expect(criado.statusCode, criado.body).toBe(201);
      const ligado = await c.h.app.inject({ method: "PUT", url: `/api/admin/layouts-documento/${j(criado).id as string}/tops`, headers: c.h.headers(), payload: { tipoOperacaoIds: [t] } });
      expect(ligado.statusCode, ligado.body).toBe(200);
      const comLayout = (await lida(especie, id)).layout;
      expect(comLayout.origem, especie).not.toBe("sistema");
      expect(comLayout, especie).toEqual(j(await get(`/api/compras/${SEGMENTO[especie]}/layout-efetivo?tipo_operacao_id=${t}`)));
    }
  });

  it("podeEditar/motivo = a recusa da PATCH: compra confirmada e pedido com compra viva", async () => {
    const compra = await documento("compra");
    expect((await confirmarCompra(compra)).statusCode).toBe(200);
    const ec = await lida("compra", compra);
    const pc = await patch("compra", compra, { version: ec.version, observacao: "x" });
    expect(pc.statusCode).toBe(409);
    expect([ec.podeEditar, ec.motivo]).toEqual([false, erro(pc).message]);
    expect(ec.motivo).toBe(MSG_EDICAO_COMPRA_CONFIRMADA);

    const topPedido = await top("compras.pedido", { configuracao: cfg4(), destinos: [{ tipoOperacaoId: c.tops.compra, ordem: 0, emPartes: true }] });
    const pedido = await documento("pedido", { tipo_operacao_id: topPedido });
    const item = ((j(await lerCompra("pedido", pedido)).itens) as { id: string }[])[0]!.id;
    const rec = await receberPedido(pedido, corpoReceber(c.tops.compra, [{ item_origem_id: item, quantidade: "1" }]));
    expect(rec.statusCode, rec.body).toBe(201);
    const ep = await lida("pedido", pedido);
    const pp = await patch("pedido", pedido, { version: ep.version, observacao: "x" });
    expect(pp.statusCode).toBe(409);
    expect([ep.podeEditar, ep.motivo]).toEqual([false, erro(pp).message]);
    expect(ep.motivo).toBe(msgEdicaoPedidoComCompraViva([j(rec).codigo as string]));

    // Os LIMITES da compra gerada do pedido (D2), os mesmos que a PATCH recusa: o saldo do item do pedido é o teto.
    const gerada = await lida("compra", j(rec).id as string);
    expect(gerada.podeEditar).toBe(true);
    const itemGerado = (gerada.documento.itens as { id: string }[])[0]!.id;
    expect(gerada.limites).toEqual({
      campos: { fornecedor_id: MSG_EDICAO_FORNECEDOR_DA_COMPRA_DO_PEDIDO },
      itemNovo: MSG_EDICAO_ITEM_NOVO_NA_COMPRA_DO_PEDIDO,
      itens: [{ id: itemGerado, campos: { produto_id: MSG_EDICAO_PRODUTO_DA_COMPRA_DO_PEDIDO }, quantidadeMaxima: "2.0000" }],
    });
  });
});
