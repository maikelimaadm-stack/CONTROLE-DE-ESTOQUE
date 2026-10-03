"use client";
import { D } from "@agro/shared";
import { enumLabel } from "@/lib/copy";
import { brl, dateBR } from "@/lib/utils";
import { Button, Field, Input, NativeSelect } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { opcoesDeNaturezaDeDespesa } from "../central/estado";
import { decimalDigitado, percentualValido, type EstadoDaConferencia, type FinanceiroNaTela } from "./estado";

/**
 * A ABA "FINANCEIRO" DA CONFERÊNCIA (OPERACOES-01 F7, decisão 284): as parcelas da NOTA (as duplicatas, quando somam o
 * líquido e o líquido é o total da compra) ou a condição de pagamento; a forma, o tipo de título, a classificação
 * CAPEX/OPEX e o rateio (natureza e centro do documento, por valor — percentuais em TEXTO decimal —, ou por produto,
 * com o par em cada item). O título nasce na CONFIRMAÇÃO da compra, nunca aqui; a TOP decide se há financeiro.
 */
export function AbaFinanceiro({ e }: { e: EstadoDaConferencia }) {
  const { fin } = e;
  const leitura = !e.pendente;
  const conferem = e.parcelas.situacao === "conferem" ? e.parcelas : null;
  const somaDoRateio = fin.linhas.reduce((a, l) => (percentualValido(l.percentual) ? a.plus(D(l.percentual)) : a), D(0));

  return <div data-testid="importacao-aba-financeiro" className="flex flex-col gap-4">
    <section className="flex flex-col gap-2">
      <h3 className="text-[12px] font-semibold text-slate-600">Parcelas</h3>
      {conferem
        ? <table data-testid="importacao-parcelas" className="w-full max-w-xl text-[12.5px]">
          <thead><tr className="text-left text-slate-500"><th>Duplicata</th><th>Vencimento</th><th className="text-right">Valor</th></tr></thead>
          <tbody>{conferem.parcelas.map((p, k) => <tr key={k} data-testid="importacao-parcela"><td>{p.numero}</td><td>{dateBR(p.vencimento)}</td><td className="text-right">{brl(p.valor)}</td></tr>)}</tbody>
        </table>
        : <p className="text-[12.5px] text-slate-600" data-testid="importacao-parcelas-indisponiveis">
          {e.parcelas.situacao === "sem_duplicatas" ? "A nota não traz duplicatas: a compra usa a condição de pagamento."
            : `As duplicatas da nota (${brl(e.parcelas.situacao === "nao_conferem" ? e.parcelas.soma : "0")}) não conferem com o líquido: a compra usa a condição de pagamento.`}
        </p>}
      <label className="flex items-center gap-1.5 text-[12.5px]">
        <input type="checkbox" data-testid="importacao-usar-condicao" checked={fin.parcelas === "condicao"} disabled={leitura || !conferem}
          onChange={(ev) => e.mudarFin({ parcelas: ev.target.checked ? "condicao" : "nota" })} />
        Usar a condição de pagamento
      </label>
      {e.erroEm("financeiro.parcelas") && <p className="text-[11px] text-red-600">{e.erroEm("financeiro.parcelas")}</p>}
    </section>

    <div className="grid grid-cols-12 gap-3">
      {fin.parcelas === "condicao" && <>
        <Field label="Condição de pagamento" span={4} error={e.erroEm("financeiro.condicao_pagamento_id")}>
          <div data-testid="importacao-condicao"><RefSelect resource="condicoes_pagamento" value={fin.condicaoId} disabled={leitura} onChange={(v) => e.mudarFin({ condicaoId: v ?? "" })} /></div>
        </Field>
        <Field label="Vencimento" span={3} error={e.erroEm("financeiro.data_vencimento")}>
          <Input data-testid="importacao-vencimento" type="date" value={fin.vencimento} disabled={leitura} onChange={(ev) => e.mudarFin({ vencimento: ev.target.value })} />
        </Field>
      </>}
      <Field label="Forma de pagamento" span={5} error={e.erroEm("financeiro.forma_pagamento_id")}>
        <div data-testid="importacao-forma"><RefSelect resource="payment_methods" value={fin.formaId} disabled={leitura} onChange={(v) => e.mudarFin({ formaId: v ?? "" })} /></div>
      </Field>
      <Field label="Tipo de título" span={4} error={e.erroEm("financeiro.tipo_titulo_id")}>
        <div data-testid="importacao-tipo-titulo"><RefSelect resource="title_types" value={fin.tipoTituloId} disabled={leitura} onChange={(v) => e.mudarFin({ tipoTituloId: v ?? "" })} /></div>
      </Field>
      <Field label="Classificação" span={3} error={e.erroEm("financeiro.classificacao_gasto")}>
        <NativeSelect data-testid="importacao-classificacao" value={fin.classificacao} disabled={leitura} onChange={(ev) => e.mudarFin({ classificacao: ev.target.value === "capex" || ev.target.value === "opex" ? ev.target.value : "" })}>
          <option value="">Não classificado</option>
          <option value="capex">{enumLabel("classificacao_gasto", "capex")}</option>
          <option value="opex">{enumLabel("classificacao_gasto", "opex")}</option>
        </NativeSelect>
      </Field>
      <Field label="Rateio" span={5} error={e.erroEm("financeiro.rateio")}>
        <NativeSelect data-testid="importacao-rateio-tipo" value={fin.rateioTipo} disabled={leitura}
          onChange={(ev) => e.mudarFin({ rateioTipo: (["documento", "por_valor", "por_produto"] as const).find((x) => x === ev.target.value) ?? "documento" } satisfies Partial<FinanceiroNaTela>)}>
          <option value="documento">{enumLabel("rateio_compra", "documento")}</option>
          <option value="por_valor">{enumLabel("rateio_compra", "por_valor")}</option>
          <option value="por_produto">{enumLabel("rateio_compra", "por_produto")}</option>
        </NativeSelect>
      </Field>
    </div>

    {fin.rateioTipo === "documento" && <div className="grid grid-cols-12 gap-3">
      <Field label="Natureza de despesa" span={6} error={e.erroEm("financeiro.rateio.categoria_financeira_id")}>
        <div data-testid="importacao-natureza"><RefSelect resource="financial_categories" value={fin.categoriaId} buscarOpcoes={opcoesDeNaturezaDeDespesa} disabled={leitura} onChange={(v) => e.mudarFin({ categoriaId: v ?? "" })} /></div>
      </Field>
      <Field label="Centro de resultado" span={6} error={e.erroEm("financeiro.rateio.centro_custo_id")}>
        <div data-testid="importacao-centro"><RefSelect resource="cost_centers" value={fin.centroId} filter={{ kind: "analytic" }} disabled={leitura} onChange={(v) => e.mudarFin({ centroId: v ?? "" })} /></div>
      </Field>
    </div>}
    {fin.rateioTipo === "por_produto" && <p className="text-[12.5px] text-slate-600">A natureza e o centro de resultado ficam em cada item (aba Itens, vínculos e lotes).</p>}
    {fin.rateioTipo === "por_valor" && <section className="flex flex-col gap-2">
      {fin.linhas.map((l, k) => {
        const caminho = `financeiro.rateio.linhas[${k}]`;
        return <div key={k} data-testid={`importacao-rateio-linha-${k}`} className="grid grid-cols-12 items-end gap-3 rounded border px-2 py-2">
          <Field label="Natureza" span={3} required error={e.erroEm(`${caminho}.categoria_financeira_id`)}>
            <RefSelect resource="financial_categories" value={l.categoriaId} buscarOpcoes={opcoesDeNaturezaDeDespesa} disabled={leitura} onChange={(v) => e.mudarLinhaDoRateio(k, { categoriaId: v ?? "" })} />
          </Field>
          <Field label="Centro de resultado" span={3} required error={e.erroEm(`${caminho}.centro_custo_id`)}>
            <RefSelect resource="cost_centers" value={l.centroId} filter={{ kind: "analytic" }} disabled={leitura} onChange={(v) => e.mudarLinhaDoRateio(k, { centroId: v ?? "" })} />
          </Field>
          <Field label="Conta contábil" span={2} error={e.erroEm(`${caminho}.conta_contabil_id`)}>
            <RefSelect resource="chart_accounts" value={l.contaId} disabled={leitura} onChange={(v) => e.mudarLinhaDoRateio(k, { contaId: v ?? "" })} />
          </Field>
          <Field label="Safra" span={2} error={e.erroEm(`${caminho}.safra_id`)}>
            <RefSelect resource="harvests" value={l.safraId} disabled={leitura} onChange={(v) => e.mudarLinhaDoRateio(k, { safraId: v ?? "" })} />
          </Field>
          <Field label="Percentual (%)" span={1} required error={e.erroEm(`${caminho}.percentual`)}>
            <Input data-testid={`importacao-rateio-linha-${k}-percentual`} inputMode="decimal" value={l.percentual} disabled={leitura} onChange={(ev) => e.mudarLinhaDoRateio(k, { percentual: decimalDigitado(ev.target.value) })} />
          </Field>
          <div className="col-span-12 md:col-span-1">{!leitura && fin.linhas.length > 1 && <Button size="sm" variant="ghost" onClick={() => e.removerLinhaDoRateio(k)}>Remover</Button>}</div>
        </div>;
      })}
      <div className="flex items-center gap-3 text-[12.5px]">
        {!leitura && <Button size="sm" variant="outline" data-testid="importacao-rateio-adicionar" onClick={e.adicionarLinhaDoRateio} disabled={fin.linhas.length >= 50}>Adicionar linha</Button>}
        <span data-testid="importacao-rateio-soma">Soma: {somaDoRateio.toFixed()}%</span>
      </div>
    </section>}
  </div>;
}
