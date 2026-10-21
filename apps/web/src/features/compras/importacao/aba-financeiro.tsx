"use client";
import * as React from "react";
import { brl, dateBR } from "@/lib/utils";
import { Field, Input } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import type { EstadoDaConferencia } from "./estado";
import { explicacaoDasParcelas } from "./explicacao-das-parcelas";

/**
 * Aba Financeiro da conferência — só o pagamento que veio da nota (duplicatas) e, se a nota não
 * trouxer parcelas que conferem, a condição + vencimento para fechar. Natureza, centro, CAPEX/OPEX,
 * rateio e tipo de título ficam para editar na compra depois de gerar.
 */
export function AbaFinanceiro({ e }: { e: EstadoDaConferencia }) {
  const { fin } = e;
  const leitura = !e.pendente;
  const conferem = e.parcelas.situacao === "conferem" ? e.parcelas : null;
  const explicacao = explicacaoDasParcelas(e.parcelas);
  const { forma } = e;
  const pedeCondicao = !conferem || fin.parcelas === "condicao";

  return <div data-testid="importacao-aba-financeiro" className="flex flex-col gap-4">
    <section className="flex flex-col gap-2">
      <h3 className="text-[12px] font-semibold text-slate-600">Parcelas da nota</h3>
      {conferem
        ? <table data-testid="importacao-parcelas" className="table-dense w-full max-w-xl text-[12.5px]">
          <thead><tr className="text-left text-slate-500"><th>Duplicata</th><th>Vencimento</th><th className="text-right">Valor</th></tr></thead>
          <tbody>{conferem.parcelas.map((p, k) => <tr key={k} data-testid="importacao-parcela"><td>{p.numero}</td><td>{dateBR(p.vencimento)}</td><td className="text-right">{brl(p.valor)}</td></tr>)}</tbody>
        </table>
        : <>
          <p className="text-[12.5px] text-slate-600" data-testid="importacao-parcelas-indisponiveis">{explicacao?.resumo}</p>
          {explicacao?.numeros && <p className="text-[12.5px] text-slate-600" data-testid="importacao-parcelas-numeros">{explicacao.numeros}</p>}
          {explicacao?.falhas.map((f) => <p key={f.codigo} className="text-[12.5px] text-slate-600" data-testid="importacao-parcelas-falha" data-falha={f.codigo}>{f.texto}</p>)}
          <p className="text-[12px] text-slate-500" data-testid="importacao-parcelas-dica-condicao">
            A nota não trouxe duplicatas que conferem: informe a condição e o 1º vencimento.
          </p>
        </>}
      {e.erroEm("financeiro.parcelas") && <p className="text-[11px] text-red-600">{e.erroEm("financeiro.parcelas")}</p>}
    </section>

    <div className="grid grid-cols-12 gap-3">
      {pedeCondicao && <>
        <Field label="Condição de pagamento" span={5} error={e.erroEm("financeiro.condicao_pagamento_id")}>
          <div data-testid="importacao-condicao"><RefSelect resource="condicoes_pagamento" value={fin.condicaoId} disabled={leitura} onChange={(v) => e.mudarFin({ condicaoId: v ?? "", parcelas: "condicao" })} /></div>
        </Field>
        <Field label="Vencimento" span={3} error={e.erroEm("financeiro.data_vencimento")}>
          <Input data-testid="importacao-vencimento" type="date" value={fin.vencimento} disabled={leitura} onChange={(ev) => e.mudarFin({ vencimento: ev.target.value, parcelas: "condicao" })} />
        </Field>
      </>}
      <Field label="Forma de pagamento" span={pedeCondicao ? 4 : 5} error={e.erroEm("financeiro.forma_pagamento_id")}>
        <div data-testid="importacao-forma" data-origem={forma.declarada ? forma.origem : undefined} data-travado-pela-top={forma.travada ? "true" : undefined}>
          <RefSelect resource="payment_methods" value={forma.formaId} labelHint={forma.rotulo} disabled={leitura || forma.travada} onChange={(v) => e.mudarFin({ formaId: v ?? "", formaEscolhida: true })} />
        </div>
      </Field>
      {forma.texto && <p className="col-span-12 text-[12.5px] text-slate-600" data-testid="importacao-forma-origem">{forma.texto}</p>}
      {forma.pergunta && <p className="col-span-12 text-[12px] text-amber-800" data-testid="importacao-forma-pergunta">{forma.pergunta}</p>}
      {forma.aviso && <p className="col-span-12 text-[12px] text-amber-800" data-testid="importacao-forma-aviso">{forma.aviso}</p>}
    </div>
  </div>;
}
