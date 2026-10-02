/**
 * OPERACOES-01 F3a (decisão 280) — "Armazém" passa a "Local de estoque" em todo texto VISÍVEL do domínio e da
 * plataforma; os IDENTIFICADORES não mudam. Mais o contrato do domínio que a API lê nesta fase: o nome antigo da
 * coluna na importação (`FieldDef.rotulosAnteriores`), a pesquisa do seletor (`ResourceDef.pesquisaDoSeletor`,
 * `documentoParaPesquisa`) e o rótulo do motivo de baixa `payment_with_product`.
 *
 * Cada caso afirma a PREMISSA (leu os lugares certos, achou o que devia achar) junto com a conclusão.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ptBR } from "@erp/plataforma";
import {
  ACTION_LABELS,
  ENUM_LABELS,
  FAMILIAS_COM_LAYOUT,
  MINIMO_DOCUMENTO_PESQUISA,
  PERMISSION_RESOURCES,
  RESOURCES,
  catalogoDaFamilia,
  documentoParaPesquisa,
  enumLabel,
  enumOptions,
  getResource,
  type FieldDef
} from "../src/index.js";

/** "armazém"/"armazéns" com ou sem acento, em qualquer caixa. */
const ARMAZEM = /armaz[ée]m|armaz[ée]ns/i;

interface Texto { origem: string; texto: string }

/** Todo texto que o usuário vê num campo de cadastro (recursivo em `camposJson`). `rotulosAnteriores` fica FORA: é o nome antigo de propósito. */
function textosDoCampo(origem: string, f: FieldDef, out: Texto[]): void {
  out.push({ origem: `${origem}.label`, texto: f.label });
  if (f.help) out.push({ origem: `${origem}.help`, texto: f.help });
  if (f.grupo) out.push({ origem: `${origem}.grupo`, texto: f.grupo });
  if (f.padrao) out.push({ origem: `${origem}.padrao`, texto: f.padrao.mensagem });
  for (const o of f.options ?? []) out.push({ origem: `${origem}.options.${o.value}`, texto: o.label });
  for (const [v, r] of Object.entries(f.rotuloQuando?.rotulos ?? {})) out.push({ origem: `${origem}.rotuloQuando.${v}`, texto: r });
  for (const c of f.camposJson ?? []) textosDoCampo(`${origem}.camposJson.${c.name}`, c, out);
}

/** A varredura: cadastros, permissões, rótulos de enum, mensagens do idioma pt-BR e o catálogo do layout de cada família. */
function textosVisiveis(): Texto[] {
  const out: Texto[] = [];
  for (const r of RESOURCES) {
    out.push({ origem: `res.${r.key}.label`, texto: r.label }, { origem: `res.${r.key}.labelPlural`, texto: r.labelPlural });
    for (const f of r.fields) textosDoCampo(`res.${r.key}.${f.name}`, f, out);
    for (const a of r.abas ?? []) {
      out.push({ origem: `res.${r.key}.aba.${a.key}`, texto: a.label });
      if (a.link) out.push({ origem: `res.${r.key}.aba.${a.key}.link`, texto: a.link.label });
    }
    for (const d of r.detalhes ?? []) {
      out.push({ origem: `res.${r.key}.detalhe.${d.key}`, texto: d.label });
      for (const f of d.fields) textosDoCampo(`res.${r.key}.detalhe.${d.key}.${f.name}`, f, out);
    }
    for (const p of r.perfis ?? []) {
      out.push({ origem: `res.${r.key}.perfil.${p.key}`, texto: p.label });
      for (const f of p.fields) textosDoCampo(`res.${r.key}.perfil.${p.key}.${f.name}`, f, out);
    }
    if (r.criacao) out.push({ origem: `res.${r.key}.criacao`, texto: r.criacao.mensagem });
  }
  for (const p of PERMISSION_RESOURCES) out.push({ origem: `perm.${p.key}.label`, texto: p.label }, { origem: `perm.${p.key}.module`, texto: p.module });
  for (const [a, l] of Object.entries(ACTION_LABELS)) out.push({ origem: `perm.acao.${a}`, texto: l });
  for (const [d, mapa] of Object.entries(ENUM_LABELS)) for (const [k, v] of Object.entries(mapa)) out.push({ origem: `enum.${d}.${k}`, texto: v });
  for (const [k, v] of Object.entries(ptBR.mensagens)) out.push({ origem: `ptBR.${k}`, texto: v });
  for (const familia of FAMILIAS_COM_LAYOUT) for (const c of catalogoDaFamilia(familia)) out.push({ origem: `layout.${familia}.${c.parte}.${c.chave}`, texto: c.rotulo });
  return out;
}

/** A normalização do cabeçalho da importação (`apps/api/src/lib/importacao.ts`): aparado, minúsculas pt-BR, sem o `*` final. */
const cabecalhoNormal = (s: string) => s.trim().replace(/\s*\*$/, "").trim().toLocaleLowerCase("pt-BR");
/** Os campos que viram coluna do modelo de importação (`camposImportaveis` da API): editáveis e não JSON. */
const importaveis = (fields: readonly FieldDef[]) => fields.filter((f) => !f.readOnly && f.type !== "json");

describe("F3A-D1 · nenhum texto visível do domínio diz 'armazém'", () => {
  it("cadastros, permissões, enums, mensagens pt-BR e catálogo do layout falam 'Local de estoque'", () => {
    const textos = textosVisiveis();
    const de = (prefixo: string) => textos.filter((t) => t.origem.startsWith(prefixo));
    const valor = (origem: string) => textos.find((t) => t.origem === origem)?.texto;

    // PREMISSA: a varredura leu cada uma das cinco fontes, e muito texto (medido em 02/10: cadastros 1.018, permissões 587,
    // enums 323, pt-BR 78, layout 129 — 2.135 no total; o piso fica ~10% abaixo: enxugar um cadastro não reprova, a varredura que não leu a fonte reprova)
    expect(de("res.").length).toBeGreaterThan(900);
    expect(de("perm.").length).toBeGreaterThan(500);
    expect(de("enum.").length).toBeGreaterThan(280);
    expect(de("ptBR.").length).toBeGreaterThan(60);
    expect(de("layout.").length).toBeGreaterThan(100);
    expect(textos.length).toBeGreaterThan(1900);
    // PREMISSA: leu os lugares certos — o nome novo está em cada fonte que tinha o antigo
    expect(valor("res.warehouses.label")).toBe("Local de estoque");
    expect(valor("res.warehouses.labelPlural")).toBe("Locais de estoque");
    expect(valor("res.products.default_warehouse_id.label")).toBe("Local de estoque padrão");
    expect(valor("res.products.controle_lote.help")).toContain("zerar o saldo em todos os locais de estoque");
    expect(valor("perm.warehouses.label")).toBe("Locais de estoque");
    expect(valor("perm.warehouse_transfers.label")).toBe("Transferência entre locais de estoque");
    expect(valor("enum.source_type.warehouse_transfers")).toBe("Transferência entre locais de estoque");
    expect(valor("enum.transfer_kind.warehouse")).toBe("Entre locais de estoque");
    expect(valor("ptBR.top.estoque.transferencia_entre_armazens")).toBe("Transferência entre locais de estoque");
    const doLayout = de("layout.").filter((t) => t.origem.endsWith(".itens.warehouse_id") || t.origem.endsWith(".itens.armazem_id"));
    // OPERACOES-01 F6a: o orçamento de compra não tem a coluna (não mexe em estoque); toda outra família com layout tem.
    expect(doLayout.length).toBeGreaterThanOrEqual(FAMILIAS_COM_LAYOUT.filter((f) => f !== "compras.orcamento").length);
    expect(new Set(doLayout.map((t) => t.texto))).toEqual(new Set(["Local de estoque"]));

    // CONCLUSÃO
    const comArmazem = textos.filter((t) => ARMAZEM.test(t.texto)).map((t) => `${t.origem} = ${t.texto}`);
    expect(comArmazem, "texto visível com 'armazém':\n" + comArmazem.join("\n")).toEqual([]);
  });

  it("a regra da varredura reconhece a palavra antiga (com e sem acento, singular e plural)", () => {
    for (const t of ["Armazém", "armazéns", "ARMAZEM padrão", "entre armazens"]) expect(ARMAZEM.test(t), t).toBe(true);
    for (const t of ["Local de estoque", "Locais de estoque", "armazenagem"]) expect(ARMAZEM.test(t), t).toBe(false);
  });
});

describe("F3A-D2 · os identificadores técnicos não mudaram", () => {
  it("recurso, tabela, permissão, rota, chave do idioma e chave do enum continuam os de antes", () => {
    const w = getResource("warehouses");
    expect(w).toBeDefined();
    expect(w?.label).toBe("Local de estoque");
    expect({ key: w?.key, route: w?.route, permission: w?.permission, table: w?.table, labelField: w?.labelField }).toEqual({
      key: "warehouses", route: "/cadastros/armazens", permission: "warehouses", table: "warehouses", labelField: "description"
    });
    expect(PERMISSION_RESOURCES.filter((p) => p.key === "warehouses" || p.key === "warehouse_transfers").map((p) => p.key).sort()).toEqual(["warehouse_transfers", "warehouses"]);
    expect(Object.keys(ptBR.mensagens)).toContain("top.estoque.transferencia_entre_armazens");
    expect(Object.keys(ENUM_LABELS.transfer_kind).sort()).toEqual(["farm", "warehouse"]);
    expect(enumLabel("transfer_kind", "warehouse")).toBe("Entre locais de estoque");
    expect(Object.keys(ENUM_LABELS.source_type)).toContain("warehouse_transfers");
    const produtos = getResource("products");
    expect(produtos?.fields.find((f) => f.name === "default_warehouse_id")?.ref?.resource).toBe("warehouses");
    for (const familia of FAMILIAS_COM_LAYOUT) {
      const chaves = catalogoDaFamilia(familia).filter((c) => c.rotulo === "Local de estoque").map((c) => `${c.parte}.${c.chave}`);
      // OPERACOES-01 F6a: o orçamento de compra não tem Local de estoque (premissa: o catálogo dele existe e é lido).
      if (familia === "compras.orcamento") {
        expect(catalogoDaFamilia(familia).length, familia).toBeGreaterThan(0);
        expect(chaves, familia).toEqual([]);
        continue;
      }
      expect(chaves.length, familia).toBe(1);
      expect(["itens.warehouse_id", "itens.armazem_id"], familia).toContain(chaves[0]);
    }
  });
});

describe("F3A-D3 · rótulos anteriores da importação sem colisão", () => {
  it("cada rótulo anterior é texto aparado, não vazio e não colide com rótulo atual nem com outro anterior do mesmo cadastro", () => {
    const declarados: string[] = [];
    const problemas: string[] = [];
    for (const r of RESOURCES) {
      // fora da importação a marca não teria efeito: declaração morta é recusada aqui
      for (const f of r.fields) if (f.rotulosAnteriores && (!r.importacao || f.readOnly || f.type === "json")) problemas.push(`${r.key}.${f.name}: rótulo anterior em campo que não é importável`);
      for (const d of r.detalhes ?? []) for (const f of d.fields) if (f.rotulosAnteriores) problemas.push(`${r.key}.${d.key}.${f.name}: rótulo anterior fora do cadastro principal`);
      if (!r.importacao) continue;
      const campos = importaveis(r.fields);
      const atuais = new Set(campos.flatMap((f) => [cabecalhoNormal(f.label), cabecalhoNormal(`${f.label} [${f.name}]`)]));
      const anteriores = new Map<string, string>();
      for (const f of campos) {
        if (f.rotulosAnteriores === undefined) continue;
        if (f.rotulosAnteriores.length === 0) problemas.push(`${r.key}.${f.name}: lista vazia`);
        for (const rotulo of f.rotulosAnteriores) {
          declarados.push(`${r.key}.${f.name}=${rotulo}`);
          const n = cabecalhoNormal(rotulo);
          if (!rotulo || rotulo !== rotulo.trim() || !n) problemas.push(`${r.key}.${f.name}: "${rotulo}" vazio ou não aparado`);
          if (atuais.has(n)) problemas.push(`${r.key}.${f.name}: "${rotulo}" é o rótulo atual de uma coluna`);
          const outro = anteriores.get(n);
          if (outro !== undefined) problemas.push(`${r.key}.${f.name}: "${rotulo}" já é o rótulo anterior de ${outro}`);
          anteriores.set(n, f.name);
        }
      }
    }
    // PREMISSA: ao menos um campo declara — o Local de estoque padrão do Produto, que antes era "Armazém padrão"
    expect(declarados).toContain("products.default_warehouse_id=Armazém padrão");
    expect(getResource("products")?.importacao).toBe(true);
    expect(getResource("products")?.fields.find((f) => f.name === "default_warehouse_id")?.label).toBe("Local de estoque padrão");
    // CONCLUSÃO
    expect(problemas).toEqual([]);
  });

  it("a conferência acusa a colisão: um rótulo anterior igual ao atual (outra caixa, com '*') colidiria", () => {
    const atual = cabecalhoNormal("Local de estoque padrão");
    expect(cabecalhoNormal("LOCAL DE ESTOQUE PADRÃO *")).toBe(atual);
    expect(cabecalhoNormal("Armazém padrão")).not.toBe(atual);
  });
});

describe("F3A-D4 · pesquisaDoSeletor bem declarada", () => {
  it("só Parceiros declara; aponta campos de texto que existem e não são sigilosos", () => {
    const comMarca = RESOURCES.filter((r) => r.pesquisaDoSeletor);
    // PREMISSA: a marca existe e está só em people
    expect(comMarca.map((r) => r.key)).toEqual(["people"]);
    expect(getResource("people")?.pesquisaDoSeletor).toEqual({ texto: ["legal_name"], documento: "document" });
    // CONCLUSÃO: cada nome aponta um campo de texto do próprio cadastro, visível a quem vê o cadastro
    const problemas: string[] = [];
    for (const r of comMarca) {
      const p = r.pesquisaDoSeletor!;
      const nomes = [...(p.texto ?? []), ...(p.documento ? [p.documento] : [])];
      expect(nomes.length, r.key).toBeGreaterThan(0);
      for (const nome of nomes) {
        const f = r.fields.find((x) => x.name === nome);
        if (!f) { problemas.push(`${r.key}.${nome}: campo inexistente`); continue; }
        if (f.type !== "text") problemas.push(`${r.key}.${nome}: tipo ${f.type}, não text`);
        if (f.sigilo) problemas.push(`${r.key}.${nome}: campo sigiloso`);
      }
      if (p.documento && (p.texto ?? []).includes(p.documento)) problemas.push(`${r.key}.${p.documento}: documento repetido em texto`);
      if ((p.texto ?? []).includes(r.labelField)) problemas.push(`${r.key}.${r.labelField}: o rótulo já é pesquisado`);
    }
    expect(problemas).toEqual([]);
  });
});

describe("F3A-D5 · documentoParaPesquisa (a normalização do índice ux_people_documento_normalizado)", () => {
  it("só [0-9A-Z] em maiúsculas; o CNPJ alfanumérico mantém as letras; curto ou sem dígito → null", () => {
    expect(MINIMO_DOCUMENTO_PESQUISA).toBe(3);
    const casos: [string, string | null][] = [
      ["12.345.678/0001-95", "12345678000195"],
      ["12.abc.345/01de-35", "12ABC34501DE35"],
      ["123.456.789-09", "12345678909"],
      [" 1a2 ", "1A2"],
      ["123", "123"],
      ["12", null],
      ["Ana", null],
      ["abc", null],
      ["é1-2", null],
      ["", null]
    ];
    for (const [entrada, esperado] of casos) expect(documentoParaPesquisa(entrada), JSON.stringify(entrada)).toBe(esperado);
  });
});

describe("F3A-D6 · motivo da baixa: os 13 do CHECK da 0003 com rótulo", () => {
  it("enumOptions('writeoff_reason') = o CHECK de erp.stock_writeoffs.reason, na ordem, e payment_with_product tem rótulo", () => {
    const sql = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/0003_stock_supply.sql", import.meta.url)), "utf8");
    const m = /\breason text not null check \(reason in \(((?:'[a-z_0-9]+'\s*,?\s*)+)\)\)/.exec(sql);
    expect(m, "CHECK de reason na 0003").not.toBeNull();
    const doCheck = [...m![1]!.matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]!);
    // PREMISSA: a regex achou os 13 valores, com o que faltava rótulo
    expect(doCheck).toHaveLength(13);
    expect(doCheck).toContain("payment_with_product");
    // CONCLUSÃO
    expect(enumOptions("writeoff_reason").map((o) => o.value)).toEqual(doCheck);
    expect(enumLabel("writeoff_reason", "payment_with_product")).toBe("Pagamento com produto");
    expect(enumLabel("writeoff_reason", "other")).toBe("Outro");
    for (const o of enumOptions("writeoff_reason")) expect(o.label, o.value).not.toBe(o.value);
  });
});
