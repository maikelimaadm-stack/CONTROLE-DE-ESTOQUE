"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { D, money } from "@agro/shared";
import { api, qs, ApiError } from "@/lib/api";
import { brl, dateBR, todayISO } from "@/lib/utils";
import { Button, Dialog, Field, Input, NativeSelect } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { useAction } from "@/features/docs/actions";
import { lerDecimal } from "./rateio-em-reais";

type Direcao = "payable" | "receivable";
type Tipo = "bank_movement" | "cross_settlement" | "advance_compensation";
type Row = Record<string, unknown>;

interface Adiantamento { id: string; codigo: string; numero: string; emissao: string; credito_disponivel: string }
interface TituloContrario { id: string; codigo: string; numero: string; pessoa_nome: string | null; vencimento: string; saldo: string }

/**
 * Os adiantamentos do MESMO parceiro, na MESMA empresa e na MESMA direção, com crédito (rota nova, decisão 285). A
 * conferência de verdade (crédito, parceiro, empresa) é do servidor e do gatilho do banco.
 */
function useAdiantamentos(dir: Direcao, titulo: Row, ativo: boolean) {
  return useQuery({
    queryKey: ["financeiro-adiantamentos-titulos", dir, titulo["person_id"], titulo["empresa_id"]],
    enabled: ativo,
    queryFn: () => api<{ itens: Adiantamento[] }>(`/api/financeiro/adiantamentos/titulos${qs({ direcao: dir, pessoa_id: titulo["person_id"] as string | null, empresa_id: titulo["empresa_id"] as string, pageSize: 100 })}`)
  });
}

/**
 * A contrapartida do ENCONTRO DE CONTAS: títulos em aberto da direção contrária do MESMO parceiro, filtrados no
 * SERVIDOR (a tela de hoje buscava 100 títulos e filtrava a situação no cliente — o 101º nunca aparecia).
 */
function useContrapartidas(dir: Direcao, titulo: Row, ativo: boolean) {
  const outra: Direcao = dir === "payable" ? "receivable" : "payable";
  return useQuery({
    queryKey: ["financeiro-contrapartidas", outra, titulo["person_id"]],
    enabled: ativo,
    retry: false,
    queryFn: () => api<{ items: TituloContrario[] }>(`/api/financeiro/titulos${qs({ direcao: outra, situacao: "a_vencer,vencido,parcial", pessoa_id: titulo["person_id"] as string | null, pageSize: 100 })}`)
  });
}

/**
 * DIÁLOGO DE BAIXA DA CENTRAL FINANCEIRA (OPERACOES-01 F8, decisão 285) — só no modo `central` (no legado, o de hoje).
 *
 * Semântica B (a do servidor): o "Valor" é o que sai do saldo do título e JÁ INCLUI o desconto; o caixa é valor −
 * desconto + juros + multa + acréscimo. A tarifa é um lançamento SEPARADO de saída (nunca entra no líquido).
 *   · valor MENOR que o saldo: o usuário escolhe "Deixar o saldo em aberto" (padrão: baixa parcial) ou "Dar como
 *     desconto" (o título quita pelo saldo e a diferença vira desconto: amount = saldo, desconto = saldo − valor +
 *     desconto digitado — o caixa continua sendo o valor digitado);
 *   · valor MAIOR que o saldo (só com conta bancária): o excedente vira CRÉDITO do parceiro, e só com a marca
 *     explícita — sem ela o "Confirmar baixa" fica desabilitado;
 *   · compensação com adiantamento: usa o crédito de um adiantamento do mesmo parceiro e empresa, só pelo valor;
 *   · encontro de contas: o título contrário abate valor − desconto (o desconto é deste título; juros e multa também
 *     ficam nele), e o desconto do valor inteiro não deixa nada para compensar.
 * Toda conta aqui é `decimal.js` e é PRÉVIA: quem recusa é o servidor.
 */
export function DialogoDeBaixa({ open, onOpenChange, dir, titulo, aoConcluir }: { open: boolean; onOpenChange: (o: boolean) => void; dir: Direcao; titulo: Row; aoConcluir: () => void }) {
  const saldoTexto = String(titulo["balance"]);
  const inicial = React.useCallback(() => ({ settlement_date: todayISO(), settlement_kind: "bank_movement" as Tipo, bank_account_id: "", cross_title_id: "", adiantamento_id: "", amount: saldoTexto, discount: "0", penalty: "0", interest: "0", increase: "0", tarifa: "0", note: "", movement_mode: "separate" }), [saldoTexto]);
  const [v, setV] = React.useState(inicial);
  const [menor, setMenor] = React.useState<"aberto" | "desconto">("aberto");
  const [excedente, setExcedente] = React.useState(false);
  React.useEffect(() => { if (open) { setV(inicial()); setMenor("aberto"); setExcedente(false); } }, [open, inicial]);
  const act = useAction(() => { onOpenChange(false); aoConcluir(); });
  const adiantamentos = useAdiantamentos(dir, titulo, open && v.settlement_kind === "advance_compensation");
  const contrapartidas = useContrapartidas(dir, titulo, open && v.settlement_kind === "cross_settlement");

  const bancaria = v.settlement_kind === "bank_movement";
  const comAdiantamento = v.settlement_kind === "advance_compensation";
  const saldo = lerDecimal(saldoTexto) ?? D(0);
  const valor = lerDecimal(v.amount);
  const desconto = comAdiantamento ? D(0) : lerDecimal(v.discount || "0");
  const juros = comAdiantamento ? D(0) : lerDecimal(v.interest || "0");
  const multa = comAdiantamento ? D(0) : lerDecimal(v.penalty || "0");
  const acrescimo = comAdiantamento ? D(0) : lerDecimal(v.increase || "0");
  const tarifa = bancaria ? lerDecimal(v.tarifa || "0") : D(0);
  const extras = [desconto, juros, multa, acrescimo, tarifa];
  const abaixo = valor !== null && valor.gt(0) && valor.lt(saldo);
  const acima = valor !== null && valor.gt(saldo);
  const adt = adiantamentos.data?.itens.find((a) => a.id === v.adiantamento_id);

  // O que vai no corpo (semântica B): "dar como desconto" quita pelo saldo e manda a diferença como desconto.
  const comoDesconto = abaixo && menor === "desconto" && !comAdiantamento;
  const amount = valor === null ? null : comoDesconto ? saldo : valor;
  const discount = valor === null || desconto === null ? null : comoDesconto ? saldo.minus(valor).plus(desconto) : desconto;
  const liquido = amount !== null && discount !== null && juros && multa && acrescimo ? amount.minus(discount).plus(juros).plus(multa).plus(acrescimo) : null;

  const erro = (() => {
    if (valor === null || !valor.gt(0)) return "Informe um valor positivo.";
    if (extras.some((x) => x === null || x.lt(0))) return "Juros, multa, acréscimo, desconto e tarifa não podem ser negativos.";
    if (desconto !== null && desconto.gt(valor)) return "O desconto não pode ser maior que o valor baixado.";
    if (acima && !bancaria) return "O valor da baixa não pode exceder o saldo.";
    if (acima && excedente && desconto !== null && desconto.gt(0)) return "O excedente só vira crédito sem desconto.";
    if (bancaria && !v.bank_account_id) return "Escolha a conta bancária.";
    if (v.settlement_kind === "cross_settlement" && !v.cross_title_id) return "Escolha o título da contrapartida.";
    if (v.settlement_kind === "cross_settlement" && amount !== null && discount !== null && !amount.minus(discount).gt(0)) return "Na baixa cruzada o desconto não pode ser o valor inteiro.";
    if (comAdiantamento && !v.adiantamento_id) return "Escolha o adiantamento.";
    if (comAdiantamento && adt && valor.gt(D(adt.credito_disponivel))) return "Crédito do adiantamento insuficiente.";
    return null;
  })();
  const bloqueado = Boolean(erro) || (acima && !excedente);

  const confirmar = () => {
    if (amount === null || discount === null) return;
    const base = { settlement_date: v.settlement_date, note: v.note || null };
    const corpo = comAdiantamento
      ? { ...base, settlement_kind: "advance_compensation", adiantamento_id: v.adiantamento_id, amount: money(amount) }
      : {
        ...base, settlement_kind: v.settlement_kind, movement_mode: v.movement_mode,
        amount: money(amount), discount: money(discount), penalty: money(multa ?? 0), interest: money(juros ?? 0), increase: money(acrescimo ?? 0),
        ...(bancaria ? { bank_account_id: v.bank_account_id, ...(tarifa && tarifa.gt(0) ? { tarifa: money(tarifa) } : {}), ...(acima && excedente ? { excedente: "credito" } : {}) } : { cross_title_id: v.cross_title_id })
      };
    act.mutate({ path: `/api/financial/${dir}s/${String(titulo["id"])}/settle`, idem: true, body: corpo });
  };

  const erroContrapartida = contrapartidas.error instanceof ApiError && contrapartidas.error.status === 403 ? "Sem acesso aos títulos da outra direção." : contrapartidas.error ? (contrapartidas.error as Error).message : null;
  return <Dialog open={open} onOpenChange={onOpenChange} title={`Baixar título ${String(titulo["number"])}`} size="lg" profile="content" testId="fin-dialogo-baixa"
    footer={<><Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button><Button size="sm" loading={act.isPending} disabled={bloqueado} title={erro ?? undefined} onClick={confirmar}>Confirmar baixa</Button></>}>
    <div className="grid grid-cols-12 gap-2">
      <Field label="Data da baixa" required span={4}><Input type="date" value={v.settlement_date} onChange={(e) => setV({ ...v, settlement_date: e.target.value })} /></Field>
      <Field label="Tipo" span={4}><NativeSelect value={v.settlement_kind} onChange={(e) => setV({ ...v, settlement_kind: e.target.value as Tipo })}><option value="bank_movement">Movimento bancário</option><option value="cross_settlement">Encontro de contas</option><option value="advance_compensation">Compensação com adiantamento</option></NativeSelect></Field>
      {!comAdiantamento && <Field label="Movimento" span={4}><NativeSelect value={v.movement_mode} onChange={(e) => setV({ ...v, movement_mode: e.target.value })}><option value="separate">Separado (valor + juros)</option><option value="single">Único (líquido)</option></NativeSelect></Field>}
      {bancaria && <Field label="Conta bancária" required span={12}><RefSelect resource="bank_accounts" value={v.bank_account_id} onChange={(x) => setV({ ...v, bank_account_id: x ?? "" })} /></Field>}
      {v.settlement_kind === "cross_settlement" && <Field label={dir === "payable" ? "Título a receber (contrapartida)" : "Título a pagar (contrapartida)"} required span={12} error={erroContrapartida ?? undefined}>
        <NativeSelect value={v.cross_title_id} onChange={(e) => setV({ ...v, cross_title_id: e.target.value })}><option value="">Selecione</option>{contrapartidas.data?.items.map((t) => <option key={t.id} value={t.id}>{t.numero} ({t.codigo}) — {t.pessoa_nome ?? ""} — vence {dateBR(t.vencimento)} — saldo {brl(t.saldo)}</option>)}</NativeSelect>
      </Field>}
      {comAdiantamento && <Field label="Adiantamento" required span={12} help="Adiantamentos do mesmo parceiro e da mesma empresa, com crédito disponível">
        <NativeSelect value={v.adiantamento_id} onChange={(e) => setV({ ...v, adiantamento_id: e.target.value })}><option value="">{adiantamentos.isLoading ? "Carregando…" : adiantamentos.data?.itens.length ? "Selecione" : "Nenhum adiantamento com crédito"}</option>{adiantamentos.data?.itens.map((a) => <option key={a.id} value={a.id}>{a.numero} ({a.codigo}) — emitido em {dateBR(a.emissao)} — crédito {brl(a.credito_disponivel)}</option>)}</NativeSelect>
      </Field>}
      <Field label="Valor" required span={3}><Input type="number" step="0.01" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
      {!comAdiantamento && <>
        <Field label="Juros" span={2}><Input type="number" step="0.01" min="0" value={v.interest} onChange={(e) => setV({ ...v, interest: e.target.value })} /></Field>
        <Field label="Multa" span={2}><Input type="number" step="0.01" min="0" value={v.penalty} onChange={(e) => setV({ ...v, penalty: e.target.value })} /></Field>
        <Field label="Desconto" span={2}><Input type="number" step="0.01" min="0" value={v.discount} onChange={(e) => setV({ ...v, discount: e.target.value })} /></Field>
        <Field label="Acréscimo" span={3}><Input type="number" step="0.01" min="0" value={v.increase} onChange={(e) => setV({ ...v, increase: e.target.value })} /></Field>
      </>}
      {bancaria && <Field label="Tarifa" span={3} help="Tarifa bancária da baixa: lançamento separado de saída, com a natureza padrão da tarifa"><Input type="number" step="0.01" min="0" value={v.tarifa} onChange={(e) => setV({ ...v, tarifa: e.target.value })} /></Field>}
      <Field label="Observação" span={12}><Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
    </div>

    {abaixo && !comAdiantamento && <div role="radiogroup" aria-label="Valor menor que o saldo" data-testid="fin-baixa-menor" data-escolha={menor} className="mt-3 flex flex-wrap items-center gap-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px]">
      <span className="font-semibold text-amber-800">O valor é menor que o saldo:</span>
      <label className="flex items-center gap-1.5"><input type="radio" name="fin-baixa-menor" checked={menor === "aberto"} onChange={() => setMenor("aberto")} /> Deixar o saldo em aberto</label>
      <label className="flex items-center gap-1.5"><input type="radio" name="fin-baixa-menor" checked={menor === "desconto"} onChange={() => setMenor("desconto")} /> Dar como desconto</label>
    </div>}
    {acima && bancaria && <label data-testid="fin-baixa-excedente" className="mt-3 flex items-center gap-1.5 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px]">
      <input type="checkbox" checked={excedente} onChange={(e) => setExcedente(e.target.checked)} /> O excedente vira crédito do parceiro ({brl(valor!.minus(saldo).toFixed(2))})
    </label>}

    <p className="mt-3 text-sm" data-testid="fin-baixa-previa">
      Saldo do título: <b>{brl(saldo.toFixed(2))}</b>
      {!comAdiantamento && <> · Valor líquido do movimento: <b data-testid="fin-baixa-liquido">{liquido ? brl(liquido.toFixed(2)) : "—"}</b></>}
      {v.settlement_kind === "cross_settlement" && amount !== null && discount !== null && <> · Abate do título contrário: <b data-testid="fin-baixa-compensado">{brl(amount.minus(discount).toFixed(2))}</b></>}
      {bancaria && tarifa && tarifa.gt(0) && <> · Tarifa (lançamento separado): <b>{brl(tarifa.toFixed(2))}</b></>}
      {comAdiantamento && adt && <> · Crédito disponível: <b>{brl(adt.credito_disponivel)}</b></>}
    </p>
    {erro && <p className="mt-1 text-sm text-red-600">{erro}</p>}
    {!erro && acima && bancaria && !excedente && <p className="mt-1 text-sm text-red-600">O valor é maior que o saldo: marque que o excedente vira crédito do parceiro, ou corrija o valor.</p>}
  </Dialog>;
}
