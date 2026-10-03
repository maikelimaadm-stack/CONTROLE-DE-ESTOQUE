"use client";
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { D, money, type Decimal } from "@agro/shared";
import { brl } from "@/lib/utils";
import { enumLabel } from "@/lib/copy";
import { Button, Input } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import type { ItemRow, Row } from "@/features/docs/shared";

/**
 * OS BLOCOS DA ORDEM DE SERVIÇO (OPERACOES-01 F10, decisão 287) — o que a Central da OS (`central-os.tsx`) desenha
 * FORA do motor, e as contas e conversões das linhas.
 *
 * A OS tem cinco seções numa tabela só (`service_order_lines.section`). Na Central, Insumos e EPIs são a grade do
 * motor (`ItensDoModulo`: o Local de estoque antes do produto, a pesquisa com o saldo) — são as linhas que saem do
 * estoque ao FINALIZAR a OS. Mão de obra, Equipamentos e Produção não são produto que sai do estoque: cada uma é uma
 * grade simples, daqui (`GradeDaSecao`). O corpo do POST e do PUT é o de antes: `lines[]`, cada linha com as nove
 * chaves de sempre (`section`, `person_id`, `equipment_id`, `product_id`, `warehouse_id`, `quantity`, `unit_value`,
 * `hours`, `note`). Nas linhas de Insumos e EPIs, `hours` e `note` viajam como chaves a mais do item do motor (ele as
 * preserva) e voltam no PUT da edição.
 *
 * Contas só com `D` (decimal), nunca `Number()`: os totais da tela são prévia — os gravados são os do servidor.
 */

/** As seções que NÃO são do motor (grades simples). */
export type SecaoLivre = "labor" | "machine" | "production";
/** As seções do motor (Insumos e EPIs: saem do estoque ao finalizar). */
export type SecaoDoMotor = "input" | "ppe";

/** O pedaço do testid de cada seção (`central-os-<pedaço>-…`), em português, como o de Insumos e EPIs. */
export const PEDACO_DO_TESTID: Readonly<Record<SecaoLivre | SecaoDoMotor, string>> = Object.freeze({
  labor: "mao-de-obra", machine: "equipamentos", production: "producao", input: "insumos", ppe: "epis"
});

/** Uma linha das grades simples. `chave` é a identidade da linha na tela (a chave do React), nunca enviada. */
export interface LinhaLivre {
  chave: number;
  person_id: string; equipment_id: string; product_id: string; quantity: string; unit_value: string; hours: string; note: string;
}
export const linhaLivreNova = (chave: number): LinhaLivre => ({ chave, person_id: "", equipment_id: "", product_id: "", quantity: "1", unit_value: "0", hours: "", note: "" });

/** As linhas da OS, por seção, como a Central as edita. */
export interface SecoesDaOs {
  labor: LinhaLivre[]; machine: LinhaLivre[]; production: LinhaLivre[];
  input: ItemRow[]; ppe: ItemRow[];
}
export const secoesVazias = (): SecoesDaOs => ({ labor: [], machine: [], production: [], input: [], ppe: [] });

/** Texto decimal da tela → `Decimal`; vazio ou fora da forma decimal conta zero (só prévia: quem grava é o servidor). */
export const decimal = (v: unknown): Decimal => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? D(v.trim()) : D(0));
const totalDe = (l: { quantity?: unknown; unit_value?: unknown }) => decimal(l.quantity).mul(decimal(l.unit_value));
const somar = (linhas: readonly { quantity?: unknown; unit_value?: unknown }[]) => linhas.reduce((a, l) => a.plus(totalDe(l)), D(0));

/** Os totais da prévia, pela MESMA regra do servidor (`saveLines`): Insumos = insumos + EPIs; a Produção fica fora do total. */
export function totaisDaOs(s: SecoesDaOs) {
  const maoDeObra = somar(s.labor); const equipamentos = somar(s.machine); const insumos = somar(s.input).plus(somar(s.ppe));
  return { maoDeObra: money(maoDeObra), equipamentos: money(equipamentos), insumos: money(insumos), total: money(maoDeObra.plus(equipamentos).plus(insumos)) };
}

const textoOuVazio = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const textoOuNulo = (v: unknown) => { const t = textoOuVazio(v); return t ? t : null; };

/**
 * As linhas do corpo, na ordem das seções (Mão de obra, Equipamentos, Insumos, EPIs, Produção), cada uma com as nove
 * chaves de sempre — vazio vai como `null` (e a quantidade/valor vazios como "0", como antes).
 */
export function corpoDasLinhas(s: SecoesDaOs) {
  const livre = (section: SecaoLivre, l: LinhaLivre) => ({
    section,
    person_id: section === "labor" ? l.person_id || null : null,
    equipment_id: section === "machine" ? l.equipment_id || null : null,
    product_id: section === "production" ? l.product_id || null : null,
    warehouse_id: null,
    quantity: l.quantity || "0", unit_value: l.unit_value || "0", hours: l.hours || null, note: l.note || null
  });
  const doMotor = (section: SecaoDoMotor, it: ItemRow) => ({
    section, person_id: null, equipment_id: null, product_id: it.product_id || null, warehouse_id: it.warehouse_id || null,
    quantity: it.quantity || "0", unit_value: it.unit_value || "0", hours: textoOuNulo(it["hours"]), note: textoOuNulo(it["note"])
  });
  return [
    ...s.labor.map((l) => livre("labor", l)), ...s.machine.map((l) => livre("machine", l)),
    ...s.input.map((it) => doMotor("input", it)), ...s.ppe.map((it) => doMotor("ppe", it)),
    ...s.production.map((l) => livre("production", l))
  ];
}

/** As linhas que a API devolve no detalhe da OS (`lines[]`) → as seções da Central (a edição). */
export function secoesDoDocumento(linhas: readonly Row[], proximaChave: () => number): SecoesDaOs {
  const s = secoesVazias();
  for (const l of linhas) {
    const section = l["section"];
    if (section === "input" || section === "ppe") {
      const warehouse = textoOuVazio(l["warehouse_id"]);
      s[section].push({
        product_id: textoOuVazio(l["product_id"]), quantity: textoOuVazio(l["quantity"]), unit_value: textoOuVazio(l["unit_value"]),
        generate_stock: true, ...(warehouse ? { warehouse_id: warehouse } : {}), hours: textoOuNulo(l["hours"]), note: textoOuNulo(l["note"])
      });
    } else if (section === "labor" || section === "machine" || section === "production") {
      s[section].push({
        chave: proximaChave(), person_id: textoOuVazio(l["person_id"]), equipment_id: textoOuVazio(l["equipment_id"]), product_id: textoOuVazio(l["product_id"]),
        quantity: textoOuVazio(l["quantity"]), unit_value: textoOuVazio(l["unit_value"]), hours: textoOuVazio(l["hours"]), note: textoOuVazio(l["note"])
      });
    }
  }
  return s;
}

/** O recurso de cada grade simples (a coluna da referência) e o rótulo dela. */
const REFERENCIA: Readonly<Record<SecaoLivre, { chave: "person_id" | "equipment_id" | "product_id"; recurso: string; rotulo: string; filtro?: Record<string, string> }>> = Object.freeze({
  labor: { chave: "person_id", recurso: "people", rotulo: "Pessoa", filtro: { is_employee: "true" } },
  machine: { chave: "equipment_id", recurso: "equipments", rotulo: "Equipamento" },
  production: { chave: "product_id", recurso: "products", rotulo: "Produto" }
});

/** A largura de cada coluna das grades simples (a referência é a coluna elástica). */
const CLASSE_DA_COLUNA: Readonly<Record<string, string>> = Object.freeze({
  Pessoa: "min-w-[200px]", Equipamento: "min-w-[200px]", Produto: "min-w-[200px]", Quantidade: "w-24", "Valor unitário": "w-28", Horas: "w-20",
  Total: "w-28 text-right", "": "w-8"
});

/** O cabeçalho de um bloco da OS: o rótulo da seção (`enumLabel("os_section", …)`) e, à direita, o que a página põe. */
export function CabecalhoDoBloco({ secao, children }: { secao: SecaoLivre | SecaoDoMotor; children?: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-2">
    <h3 className="text-[12px] font-semibold uppercase text-brand-700">{enumLabel("os_section", secao)}</h3>
    {children}
  </div>;
}

/**
 * Uma grade simples da OS (Mão de obra, Equipamentos ou Produção): a referência da seção, Quantidade, Valor unitário,
 * Horas (não na Produção), Observação e o Total da linha. Testids: `central-os-<pedaço>-adicionar`,
 * `central-os-<pedaço>-linha` e `central-os-<pedaço>-remover`.
 */
export function GradeDaSecao({ secao, linhas, onChange, novaChave }: { secao: SecaoLivre; linhas: LinhaLivre[]; onChange: (l: LinhaLivre[]) => void; novaChave: () => number }) {
  const p = `central-os-${PEDACO_DO_TESTID[secao]}`;
  const ref = REFERENCIA[secao];
  const comHoras = secao !== "production";
  const mudar = (i: number, x: Partial<LinhaLivre>) => onChange(linhas.map((l, j) => (j === i ? { ...l, ...x } : l)));
  const referencia = (valor: string): Partial<LinhaLivre> =>
    ref.chave === "person_id" ? { person_id: valor } : ref.chave === "equipment_id" ? { equipment_id: valor } : { product_id: valor };
  /** As colunas da grade — a contagem do "Nenhuma linha." sai daqui, nunca escrita à mão. */
  const colunas = [ref.rotulo, "Quantidade", "Valor unitário", ...(comHoras ? ["Horas"] : []), "Observação", "Total", ""];
  return <section className="flex flex-col gap-2" aria-label={enumLabel("os_section", secao)} data-testid={`${p}-bloco`}>
    <CabecalhoDoBloco secao={secao}>
      <Button type="button" size="sm" variant="outline" data-testid={`${p}-adicionar`} onClick={() => onChange([...linhas, linhaLivreNova(novaChave())])}>
        <Plus className="h-3.5 w-3.5" aria-hidden /> Adicionar
      </Button>
    </CabecalhoDoBloco>
    <div className="overflow-x-auto rounded border border-slate-200">
      <table className="table-dense w-full text-[12.5px]">
        <thead><tr>{colunas.map((c, k) => <th key={k} className={CLASSE_DA_COLUNA[c] ?? ""}>{c}</th>)}</tr></thead>
        <tbody>
          {linhas.length === 0 && <tr><td colSpan={colunas.length} className="py-2 text-center text-slate-400">Nenhuma linha.</td></tr>}
          {linhas.map((l, i) => <tr key={l.chave} data-testid={`${p}-linha`}>
            <td><RefSelect resource={ref.recurso} value={l[ref.chave]} filter={ref.filtro} onChange={(v) => mudar(i, referencia(v ?? ""))} /></td>
            <td><Input aria-label={`Quantidade da linha ${i + 1}`} type="number" step="0.0001" min="0" value={l.quantity} onChange={(e) => mudar(i, { quantity: e.target.value })} /></td>
            <td><Input aria-label={`Valor unitário da linha ${i + 1}`} type="number" step="0.01" min="0" value={l.unit_value} onChange={(e) => mudar(i, { unit_value: e.target.value })} /></td>
            {comHoras && <td><Input aria-label={`Horas da linha ${i + 1}`} type="number" step="0.1" min="0" value={l.hours} onChange={(e) => mudar(i, { hours: e.target.value })} /></td>}
            <td><Input aria-label={`Observação da linha ${i + 1}`} value={l.note} onChange={(e) => mudar(i, { note: e.target.value })} /></td>
            <td className="num">{brl(money(totalDe(l)))}</td>
            <td><button type="button" className="p-1 text-slate-400 hover:text-red-600" aria-label={`Remover a linha ${i + 1}`} data-testid={`${p}-remover`}
              onClick={() => onChange(linhas.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden /></button></td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </section>;
}
