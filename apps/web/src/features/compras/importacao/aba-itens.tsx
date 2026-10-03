"use client";
import * as React from "react";
import { enumLabel } from "@/lib/copy";
import { useAuth } from "@/lib/auth";
import { brl, dateBR } from "@/lib/utils";
import { Button, Field, Input, NativeSelect } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { opcoesDeNaturezaDeDespesa } from "../central/estado";
import { DialogoDeCadastroRapido } from "./aba-cabecalho";
import { decimalDigitado, type EstadoDaConferencia } from "./estado";

/**
 * A ABA "ITENS, VÍNCULOS E LOTES" (OPERACOES-01 F7, decisão 284): cada item da nota com o que a nota diz (código,
 * descrição, unidade e quantidade do fornecedor) e as DECISÕES da pessoa — o produto (o vínculo lembrado ou sugerido
 * pelo servidor vem escolhido; o ambíguo oferece os candidatos; sem vínculo, escolher ou CRIAR o produto, com o
 * pré-preenchimento da nota e só com a confirmação), o fator e o tipo, o Local de estoque, "Gera estoque",
 * "Imobilizado" e "Lembrar este vínculo". A quantidade e o unitário internos são as contas do domínio (as do servidor).
 * Os lotes vêm do rastro da nota (somente leitura); sem rastro, o produto que controla lote pede o lote.
 */

const Checkbox = ({ testId, rotulo, marcado, onMudar, desabilitado }: { testId: string; rotulo: string; marcado: boolean; onMudar: (v: boolean) => void; desabilitado?: boolean }) =>
  <label className="flex items-center gap-1.5 text-[12.5px]"><input type="checkbox" data-testid={testId} checked={marcado} disabled={desabilitado} onChange={(ev) => onMudar(ev.target.checked)} />{rotulo}</label>;

export function AbaItens({ e }: { e: EstadoDaConferencia }) {
  const { can } = useAuth();
  const [criandoPara, setCriandoPara] = React.useState<number | null>(null);
  const { conf } = e;
  const leitura = !e.pendente;
  const itemDoCadastro = criandoPara === null ? null : conf.itens.find((i) => i.nItem === criandoPara) ?? null;
  const presetDoProduto = (): Record<string, string> => {
    if (!itemDoCadastro || itemDoCadastro.vinculo.situacao !== "nenhum") {
      const n = conf.nota.itens.find((i) => i.nItem === criandoPara);
      return n ? { description: n.descricao.slice(0, 120), ...(n.ncm ? { ncm_code: n.ncm } : {}) } : {};
    }
    const p = itemDoCadastro.vinculo.preenchimento;
    return { description: p.description.slice(0, 120), ...(p.ncm_code ? { ncm_code: p.ncm_code } : {}), ...(p.barcode ? { barcode: p.barcode } : {}) };
  };

  return <div data-testid="importacao-aba-itens" className="flex flex-col gap-3">
    {conf.nota.itens.map((item) => {
      const n = item.nItem;
      const d = e.itens.find((x) => x.nItem === n)!;
      const v = conf.itens.find((x) => x.nItem === n)!.vinculo;
      const conta = e.contas.get(n)!;
      const produto = d.produtoId ? e.produtos[d.produtoId] : undefined;
      const pede = `importacao-item-${n}`;
      const comEntrada = d.geraEstoque && (produto?.controlaEstoque ?? true);
      const pedeLote = item.rastro.length === 0 && comEntrada && produto && produto.controleLote !== "nenhum";
      const rotuloDoProduto = v.situacao === "lembrado" || v.situacao === "sugerido" ? `${v.produto.codigo} — ${v.produto.descricao}` : null;
      return <section key={n} data-testid={pede} data-vinculo={v.situacao} className="rounded border px-3 py-2">
        <header className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <strong className="text-[13px]">Item {n}</strong>
          <span className="font-mono text-[11px] text-slate-500">{item.codigo}</span>
          <span className="text-[13px]">{item.descricao}</span>
          <span className="text-[12px] text-slate-600" data-testid={`${pede}-quantidade-nota`}>{item.quantidade} {item.unidade} × {brl(item.valorUnitario)} = {brl(item.valorProdutos)}</span>
          <span className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-600">{enumLabel("vinculo_item_nfe", v.situacao)}{v.situacao === "sugerido" ? ` (${v.origem === "codigo_barras" ? "código de barras" : "código do fornecedor"})` : ""}</span>
        </header>
        <div className="grid grid-cols-12 gap-3">
          <Field label="Produto" span={5} required error={e.erroDoItem(n, "produto_id")}>
            <div data-testid={`${pede}-produto`}>
              <RefSelect resource="products" value={d.produtoId} disabled={leitura} labelHint={d.produtoId && produto ? `${produto.codigo} — ${produto.descricao}` : rotuloDoProduto}
                onChange={(id) => e.mudarItem(n, { produtoId: id ?? "", produtoManual: true })} />
            </div>
          </Field>
          <Field label="Fator" span={2} required error={e.erroDoItem(n, "fator")}>
            <Input data-testid={`${pede}-fator`} inputMode="decimal" value={d.fator} disabled={leitura} onChange={(ev) => e.mudarItem(n, { fator: decimalDigitado(ev.target.value) })} />
          </Field>
          <Field label="Conversão" span={2} error={e.erroDoItem(n, "tipo_fator")}>
            <NativeSelect data-testid={`${pede}-tipo-fator`} value={d.tipoFator} disabled={leitura} onChange={(ev) => e.mudarItem(n, { tipoFator: ev.target.value === "divide" ? "divide" : "multiply" })}>
              <option value="multiply">{enumLabel("tipo_fator_conversao", "multiply")}</option>
              <option value="divide">{enumLabel("tipo_fator_conversao", "divide")}</option>
            </NativeSelect>
          </Field>
          <div className="col-span-12 flex flex-col justify-end gap-0.5 text-[12px] md:col-span-3">
            <span>Quantidade interna: <strong data-testid={`${pede}-quantidade-interna`}>{conta.situacao === "pronta" ? conta.quantidadeInterna : "—"}</strong></span>
            <span>Unitário interno: <strong data-testid={`${pede}-unitario-interno`}>{conta.situacao === "pronta" ? conta.unitarioInterno : "—"}</strong></span>
          </div>

          {v.situacao === "ambiguo" && !leitura && <div className="col-span-12 flex flex-wrap items-center gap-1.5" data-testid={`${pede}-candidatos`}>
            <span className="text-[12px] text-amber-800">Mais de um produto corresponde:</span>
            {v.candidatos.map((c) => <Button key={c.id} size="sm" variant={d.produtoId === c.id ? "default" : "outline"} data-testid={`${pede}-candidato-${c.id}`}
              onClick={() => e.mudarItem(n, { produtoId: c.id, produtoManual: true })}>{c.codigo} — {c.descricao}</Button>)}
          </div>}
          {!leitura && can("products.create") && (v.situacao === "nenhum" || v.situacao === "ambiguo") && <div className="col-span-12">
            <Button size="sm" variant="outline" data-testid={`${pede}-criar-produto`} onClick={() => setCriandoPara(n)}>Criar produto</Button>
          </div>}

          <div className="col-span-12 flex flex-wrap items-center gap-4">
            <Checkbox testId={`${pede}-gera-estoque`} rotulo="Gera estoque" marcado={d.geraEstoque} desabilitado={leitura} onMudar={(x) => e.mudarItem(n, { geraEstoque: x })} />
            <Checkbox testId={`${pede}-imobilizado`} rotulo="Imobilizado (cria o bem na confirmação)" marcado={d.imobilizado} desabilitado={leitura} onMudar={(x) => e.mudarItem(n, { imobilizado: x })} />
            <Checkbox testId={`${pede}-lembrar`} rotulo="Lembrar este vínculo para as próximas notas" marcado={d.lembrar} desabilitado={leitura} onMudar={(x) => e.mudarItem(n, { lembrar: x })} />
          </div>
          {d.geraEstoque && <Field label="Local de estoque" span={5} error={e.erroDoItem(n, "armazem_id")}>
            <div data-testid={`${pede}-local`}>
              <RefSelect resource="warehouses" value={d.armazemId} filter={{ empresa_id: conf.empresa.id }} disabled={leitura} onChange={(id) => e.mudarItem(n, { armazemId: id ?? "" })} />
            </div>
          </Field>}

          {item.rastro.length > 0 && <div className="col-span-12" data-testid={`${pede}-rastro`}>
            <span className="text-[12px] text-slate-600">Lotes do rastro da nota:</span>
            <ul className="ml-4 list-disc text-[12px]">
              {item.rastro.map((r, k) => <li key={k} data-testid={`${pede}-rastro-lote`}>{r.lote} — {r.quantidade} {item.unidade}{r.validade ? ` — validade ${dateBR(r.validade)}` : ""}</li>)}
            </ul>
          </div>}
          {pedeLote && <>
            <Field label="Lote" span={3} required error={e.erroDoItem(n, "lote")}>
              <Input data-testid={`${pede}-lote`} maxLength={60} value={d.lote} disabled={leitura} onChange={(ev) => e.mudarItem(n, { lote: ev.target.value })} />
            </Field>
            {produto?.controleLote === "lote_validade" && <Field label="Validade" span={3} required error={e.erroDoItem(n, "validade")}>
              <Input data-testid={`${pede}-validade`} type="date" value={d.validade} disabled={leitura} onChange={(ev) => e.mudarItem(n, { validade: ev.target.value })} />
            </Field>}
          </>}

          {e.fin.rateioTipo === "por_produto" && <>
            <Field label="Natureza de despesa do item" span={6} required error={e.erroDoItem(n, "categoria_financeira_id")}>
              <div data-testid={`${pede}-natureza`}>
                <RefSelect resource="financial_categories" value={d.categoriaId} buscarOpcoes={opcoesDeNaturezaDeDespesa} disabled={leitura} onChange={(id) => e.mudarItem(n, { categoriaId: id ?? "" })} />
              </div>
            </Field>
            <Field label="Centro de resultado do item" span={6} required error={e.erroDoItem(n, "centro_custo_id")}>
              <div data-testid={`${pede}-centro`}>
                <RefSelect resource="cost_centers" value={d.centroId} filter={{ kind: "analytic" }} disabled={leitura} onChange={(id) => e.mudarItem(n, { centroId: id ?? "" })} />
              </div>
            </Field>
          </>}
          {e.erroDoItem(n, "n_item") && <p className="col-span-12 text-[11px] text-red-600">{e.erroDoItem(n, "n_item")}</p>}
        </div>
      </section>;
    })}
    {e.erroEm("itens") && <p className="text-[12px] text-red-600" data-testid="importacao-itens-erro">{e.erroEm("itens")}</p>}
    <DialogoDeCadastroRapido recurso="products" titulo="Criar produto pelo item da nota" aberto={criandoPara !== null} onFechar={() => setCriandoPara(null)}
      preset={presetDoProduto()} onCriado={(row) => {
        if (criandoPara === null) return;
        e.conhecerProduto(row);
        e.mudarItem(criandoPara, { produtoId: String(row["id"]), produtoManual: true, fator: "1", tipoFator: "multiply" });
      }} />
  </div>;
}
