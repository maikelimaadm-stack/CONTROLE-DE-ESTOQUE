"use client";
import { brl } from "@/lib/utils";
import { abaDoCaminho, type AbaDaConferencia, type EstadoDaConferencia } from "./estado";

/**
 * A ABA "DIVERGÊNCIAS" (OPERACOES-01 F7, decisão 284): o que o servidor apontou na nota e o que a tela sabe que falta,
 * cada uma dizendo se BLOQUEIA o "Gerar compra" e em que aba se resolve; o total calculado contra o da nota; e as
 * recusas do último "Gerar compra" (o servidor é a autoridade — a recusa dele aparece aqui e no campo).
 */

const NOME_DA_ABA: Record<AbaDaConferencia, string> = {
  cabecalho: "Cabeçalho", itens: "Itens, vínculos e lotes", pedido: "Pedido", financeiro: "Financeiro", divergencias: "Divergências"
};

export function AbaDivergencias({ e, irPara }: { e: EstadoDaConferencia; irPara: (aba: AbaDaConferencia) => void }) {
  const { divergencias, total } = e;
  return <div data-testid="importacao-aba-divergencias" className="flex flex-col gap-3">
    {total && <p className="text-[12.5px]" data-testid="importacao-total-calculado" data-confere={total.confere ? "sim" : "nao"}>
      Total calculado da compra: <strong>{brl(total.total)}</strong> · total da nota: <strong>{brl(e.conf.nota.totais.nota)}</strong>
      {total.confere ? " — confere." : ` — diferença de ${brl(total.diferenca)}.`}
    </p>}
    {e.recusas.length > 0 && <section className="rounded border border-red-200 bg-red-50 px-3 py-2">
      <h3 className="text-[12px] font-semibold text-red-800">O servidor recusou o "Gerar compra"</h3>
      <ul data-testid="importacao-recusas-do-servidor" className="ml-4 list-disc text-[12.5px] text-red-800">
        {e.recusas.map((r, k) => <li key={k} data-testid="importacao-recusa-do-servidor" data-caminho={r.path}>
          {r.message} <button type="button" className="underline" onClick={() => irPara(abaDoCaminho(r.path))}>({NOME_DA_ABA[abaDoCaminho(r.path)]})</button>
        </li>)}
      </ul>
    </section>}
    {divergencias.length === 0
      ? <p className="text-[12.5px] text-slate-600" data-testid="importacao-divergencias-vazia">Nenhuma divergência.</p>
      : <ul data-testid="importacao-divergencias" className="flex flex-col gap-1.5">
        {divergencias.map((d, k) => <li key={`${d.codigo}-${d.nItem ?? ""}-${k}`} data-testid="importacao-divergencia" data-codigo={d.codigo} data-bloqueia={d.bloqueia ? "sim" : "nao"}
          className={`rounded border px-3 py-1.5 text-[12.5px] ${d.bloqueia ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          <span className="font-medium">{d.bloqueia ? "Bloqueia: " : "Aviso: "}</span>{d.mensagem}
          {d.aba !== "divergencias" && <button type="button" className="ml-2 underline" onClick={() => irPara(d.aba)}>Ir para {NOME_DA_ABA[d.aba]}</button>}
        </li>)}
      </ul>}
  </div>;
}
