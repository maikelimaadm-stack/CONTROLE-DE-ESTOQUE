import { expect } from "vitest";
import { c, j, produto, unico } from "./top-config-08-ajuda.js";
import { cnpjComDv, notaSintetica, fornecedorComDocumento, importada, gerar, ITEM_PADRAO, type NotaSintetica } from "./f7-ajuda.js";

/**
 * EDITAR-02 (decisão 313, P6) — o cenário da COMPRA VINDA DA NOTA, comum à PATCH (`editar-02-patch.test.ts`) e ao
 * `/edicao` (`editar-02-edicao.test.ts`). O estado é o do módulo de cada arquivo (`c`, preenchido pelo `iniciar`).
 */

let seqCnpj = 0;
/** Um CNPJ novo, válido (12 dígitos de base + os DVs), que nenhum outro caso usa. */
export const cnpjNovo = (): string => cnpjComDv(`6${String(Date.now() % 1e8).padStart(8, "0")}${String(++seqCnpj % 1000).padStart(3, "0")}`);

export interface CompraDoXml {
  id: string;
  /** O fornecedor com o CNPJ do emitente da nota. */
  fornecedor: string;
  nota: NotaSintetica;
  /** O único item, como o banco o guarda (superusuário). */
  item: Record<string, unknown> & { id: string; n_item_nota: number | null; quantidade: string };
}

/**
 * Uma compra VINDA DA NOTA (importada do XML pela porta real: importar → gerar), com ou sem as duplicatas: o fornecedor
 * com o CNPJ do emitente, 1 item (10 × 100.00) no ALM, a chave, o número e a série da nota. TOP: a neutra do formato 4.
 */
export async function compraDoXml(o: { duplicatas: boolean }): Promise<CompraDoXml> {
  const emitente = cnpjNovo();
  const fornecedor = await fornecedorComDocumento(emitente);
  const p = await produto();
  const nota = notaSintetica({ emitenteCnpj: emitente, itens: [{ ...ITEM_PADRAO, codigo: `E2-P6-${unico()}`, quantidade: "10.0000", valorUnitario: "100.00", valorProdutos: "1000.00" }],
    ...(o.duplicatas ? { duplicatas: [{ numero: "001", vencimento: "2026-10-08", valor: "500.00" }, { numero: "002", vencimento: "2026-11-07", valor: "500.00" }] } : {}) });
  const conf = await importada(nota.xml, { empresaId: c.I.empresa });
  const g = await gerar(conf.id, { tipo_operacao_id: c.tops.compra, fornecedor_id: fornecedor, data_entrada: "2026-09-10",
    financeiro: { parcelas: o.duplicatas ? "nota" : "condicao", rateio: { tipo: "documento", categoria_financeira_id: c.I.category, centro_custo_id: c.I.costCenter } },
    itens: [{ n_item: 1, produto_id: p.id, fator: "1", tipo_fator: "multiply", armazem_id: c.I.warehouse }] });
  expect(g.statusCode, `premissa: a compra da nota nasce — ${g.body}`).toBe(201);
  const id = j(g).id as string;
  const banco = (await c.admin.query<Record<string, unknown>>("select * from erp.documentos_compra where id = $1", [id])).rows[0]!;
  expect([banco["chave_acesso"], banco["numero_nota"], banco["serie_nota"], banco["fornecedor_id"], banco["parcelas_nota"] === null],
    "premissa: a chave, o número, a série e o fornecedor da nota; as duplicatas só quando pedidas").toEqual([nota.chave, nota.numero, nota.serie, fornecedor, !o.duplicatas]);
  const item = (await c.admin.query<CompraDoXml["item"]>("select * from erp.documentos_compra_itens where documento_id = $1 order by posicao, id", [id])).rows[0]!;
  return { id, fornecedor, nota, item };
}
