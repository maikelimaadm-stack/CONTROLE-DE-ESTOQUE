"use client";
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { D, money, sum } from "@agro/shared";
import { rotuloFinanceiro } from "@agro/domain";
import { api, newIdem } from "@/lib/api";
import { toast } from "@/lib/toast";
import { brl, todayISO } from "@/lib/utils";
import { Button, Dialog, Field, Input, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { lerDecimal } from "./rateio-em-reais";

/**
 * AÇÕES EM LOTE DOS TÍTULOS (OPERACOES-01 F8, decisão 285): baixar, estornar a baixa e alterar o vencimento, cada uma
 * com o seu diálogo, e o RESULTADO do lote — cada título sai "feito" ou "pulado" com o MOTIVO que o servidor deu
 * (antes o lote pulava em silêncio). Os pedidos levam `Idempotency-Key`: um clique duplo não baixa duas vezes.
 */

/** O mínimo de um título que os diálogos precisam (a linha da Central ou o título aberto no detalhe). */
export interface TituloDoLote { id: string; direcao: "payable" | "receivable"; codigo: string; numero: string; pessoa_nome: string | null; empresa_id: string; status: string; saldo: string }

export interface ResultadoLote {
  titulo: string;
  /** "baixado(s)", "estornado(s)", "alterado(s)" */
  verbo: string;
  feitos: number;
  pulados: { id: string; motivo: string }[];
  extra?: string;
}

/** O identificador humano de um título no resultado (número e código), nunca o UUID. */
const nomeDo = (t: TituloDoLote | undefined) => (t ? `${t.numero} (${t.codigo})` : "Título fora da lista carregada");

/** Mutação de lote: POST com `Idempotency-Key` NOVA por envio, invalidação das listas e erro no toast. */
function usePedidoDeLote<T>(aoConcluir: (r: T) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => api<T>(path, { method: "POST", body, idempotencyKey: newIdem() }),
    onSuccess: (r) => { void qc.invalidateQueries(); aoConcluir(r); },
    onError: (e) => toast.error((e as Error).message)
  });
}

interface ItemDaBaixa { valor: string; juros: string; multa: string; desconto: string }

/**
 * BAIXA EM LOTE: uma direção só (a rota é por direção). A grade traz cada título baixável com Valor (o saldo, por
 * padrão), Juros, Multa e Desconto; os títulos que não estão em aberto não entram na grade e vão no pedido só pelo id,
 * para o SERVIDOR dizer por que ficaram de fora. Movimento "Um por título" ou "Único (agrupado)" (este exige uma
 * empresa só), e uma tarifa do lote — lançamento separado de saída.
 */
export function DialogoBaixaEmLote({ open, onOpenChange, direcao, titulos, aoConcluir }: { open: boolean; onOpenChange: (o: boolean) => void; direcao: "payable" | "receivable"; titulos: TituloDoLote[]; aoConcluir: (r: ResultadoLote) => void }) {
  const baixaveis = React.useMemo(() => titulos.filter((t) => t.status === "open" || t.status === "partially_paid"), [titulos]);
  const fora = titulos.length - baixaveis.length;
  const [cab, setCab] = React.useState({ settlement_date: todayISO(), bank_account_id: "", movement_mode: "separate", tarifa: "", note: "" });
  const [itens, setItens] = React.useState<Record<string, ItemDaBaixa>>({});
  // Recomeça SÓ ao abrir (a seleção que abriu o diálogo); um novo render da lista atrás não apaga o que foi digitado.
  React.useEffect(() => {
    if (!open) return;
    setCab({ settlement_date: todayISO(), bank_account_id: "", movement_mode: "separate", tarifa: "", note: "" });
    setItens(Object.fromEntries(baixaveis.map((t) => [t.id, { valor: t.saldo, juros: "0", multa: "0", desconto: "0" }])));
  }, [open]);
  const pedido = usePedidoDeLote<{ settled: number; total: string; lote_id: string | null; pulados: { id: string; motivo: string }[] }>((r) => {
    onOpenChange(false);
    aoConcluir({ titulo: "Resultado da baixa em lote", verbo: "baixado(s)", feitos: r.settled, pulados: r.pulados ?? [], extra: `Total movimentado: ${brl(r.total)}` });
  });

  // Conferência no cliente (prévia, em decimal): valor positivo até o saldo, desconto até o valor, nada negativo.
  const linhas = baixaveis.map((t) => {
    const it = itens[t.id] ?? { valor: t.saldo, juros: "0", multa: "0", desconto: "0" };
    const valor = lerDecimal(it.valor); const juros = lerDecimal(it.juros || "0"); const multa = lerDecimal(it.multa || "0"); const desconto = lerDecimal(it.desconto || "0");
    const erro = valor === null || !valor.gt(0) ? "Valor positivo" : valor.gt(D(t.saldo)) ? "Maior que o saldo" : [juros, multa, desconto].some((x) => x === null || x.lt(0)) ? "Sem negativos" : desconto!.gt(valor) ? "Desconto maior que o valor" : null;
    const liquido = erro ? null : valor!.minus(desconto!).plus(juros!).plus(multa!);
    return { t, it, erro, liquido };
  });
  const tarifa = lerDecimal(cab.tarifa || "0");
  const empresas = new Set(baixaveis.map((t) => t.empresa_id));
  const total = linhas.every((l) => l.liquido) ? sum(linhas.map((l) => l.liquido!)) : null;
  const erroGeral = !baixaveis.length ? "Nenhum título selecionado está em aberto."
    : !cab.bank_account_id ? "Escolha a conta bancária."
    : tarifa === null || tarifa.lt(0) ? "A tarifa não pode ser negativa."
    : cab.movement_mode === "single" && empresas.size > 1 ? "Movimento único exige títulos da mesma empresa."
    : tarifa.gt(0) && empresas.size > 1 ? "Tarifa do lote exige títulos da mesma empresa."
    : linhas.some((l) => l.erro) ? "Corrija os valores destacados na grade."
    : null;
  const upd = (id: string, k: keyof ItemDaBaixa, v: string) => setItens((o) => ({ ...o, [id]: { ...(o[id] ?? { valor: "", juros: "0", multa: "0", desconto: "0" }), [k]: v } }));
  const confirmar = () => {
    const corpo = {
      itens: [
        ...linhas.map(({ t, it }) => ({ id: t.id, valor: money(lerDecimal(it.valor) ?? 0), juros: money(lerDecimal(it.juros || "0") ?? 0), multa: money(lerDecimal(it.multa || "0") ?? 0), desconto: money(lerDecimal(it.desconto || "0") ?? 0) })),
        ...titulos.filter((t) => !baixaveis.includes(t)).map((t) => ({ id: t.id }))
      ],
      settlement_date: cab.settlement_date, bank_account_id: cab.bank_account_id, movement_mode: cab.movement_mode,
      note: cab.note || null, ...(tarifa && tarifa.gt(0) ? { tarifa: money(tarifa) } : {})
    };
    pedido.mutate({ path: `/api/financial/${direcao}s/settle-batch`, body: corpo });
  };
  return <Dialog open={open} onOpenChange={onOpenChange} title={`Baixa em lote (${baixaveis.length} título(s))`} size="lg" testId="fin-dialogo-baixa-lote"
    footer={<><Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button><Button size="sm" loading={pedido.isPending} disabled={Boolean(erroGeral)} title={erroGeral ?? undefined} onClick={confirmar}>Confirmar baixa</Button></>}>
    <div className="overflow-x-auto rounded border">
      <table className="table-dense w-full text-[12.5px]">
        <thead><tr><th>Título</th><th>Parceiro</th><th className="text-right">Saldo</th><th className="w-28 text-right">Valor</th><th className="w-24 text-right">Juros</th><th className="w-24 text-right">Multa</th><th className="w-24 text-right">Desconto</th><th className="text-right">Líquido</th></tr></thead>
        <tbody>
          {linhas.map(({ t, it, erro, liquido }) => <tr key={t.id} data-testid="fin-baixa-lote-linha" data-titulo={t.id}>
            <td>{t.numero} <span className="text-slate-400">({t.codigo})</span></td>
            <td>{t.pessoa_nome ?? "—"}</td>
            <td className="num">{brl(t.saldo)}</td>
            <td><Input type="number" step="0.01" min="0" className="text-right" aria-label={`Valor de ${t.numero}`} value={it.valor} onChange={(e) => upd(t.id, "valor", e.target.value)} /></td>
            <td><Input type="number" step="0.01" min="0" className="text-right" aria-label={`Juros de ${t.numero}`} value={it.juros} onChange={(e) => upd(t.id, "juros", e.target.value)} /></td>
            <td><Input type="number" step="0.01" min="0" className="text-right" aria-label={`Multa de ${t.numero}`} value={it.multa} onChange={(e) => upd(t.id, "multa", e.target.value)} /></td>
            <td><Input type="number" step="0.01" min="0" className="text-right" aria-label={`Desconto de ${t.numero}`} value={it.desconto} onChange={(e) => upd(t.id, "desconto", e.target.value)} /></td>
            <td className="num">{erro ? <span className="text-red-600">{erro}</span> : brl(liquido!.toFixed(2))}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {fora > 0 && <p className="mt-2 text-[12px] text-slate-500">{fora} título(s) selecionado(s) não estão em aberto e ficam fora da baixa (o resultado diz o motivo de cada um).</p>}
    <div className="mt-3 grid grid-cols-12 gap-2">
      <Field label="Data da baixa" required span={3}><Input type="date" value={cab.settlement_date} onChange={(e) => setCab({ ...cab, settlement_date: e.target.value })} /></Field>
      <Field label="Conta bancária" required span={5}><RefSelect resource="bank_accounts" value={cab.bank_account_id} onChange={(x) => setCab({ ...cab, bank_account_id: x ?? "" })} /></Field>
      <Field label="Movimento" span={4}><NativeSelect value={cab.movement_mode} onChange={(e) => setCab({ ...cab, movement_mode: e.target.value })}><option value="separate">Um por título</option><option value="single">Único (agrupado)</option></NativeSelect></Field>
      <Field label="Tarifa do lote" span={3} help="Um lançamento separado de saída, com a natureza padrão da tarifa bancária"><Input type="number" step="0.01" min="0" value={cab.tarifa} onChange={(e) => setCab({ ...cab, tarifa: e.target.value })} /></Field>
      <Field label="Observação" span={9}><Input value={cab.note} onChange={(e) => setCab({ ...cab, note: e.target.value })} /></Field>
    </div>
    <p className="mt-2 text-sm">Total do movimento: <b data-testid="fin-baixa-lote-total">{total ? brl(total.toFixed(2)) : "—"}</b>{tarifa && tarifa.gt(0) && <> · Tarifa do lote (lançamento separado): <b>{brl(tarifa.toFixed(2))}</b></>}</p>
    {erroGeral && <p className="mt-1 text-sm text-red-600">{erroGeral}</p>}
  </Dialog>;
}

/** ESTORNO DA BAIXA em lote: as baixas confirmadas dos títulos escolhidos, com MOTIVO obrigatório (vai para a trilha). */
export function DialogoEstorno({ open, onOpenChange, titulos, aoConcluir }: { open: boolean; onOpenChange: (o: boolean) => void; titulos: TituloDoLote[]; aoConcluir: (r: ResultadoLote) => void }) {
  const [motivo, setMotivo] = React.useState("");
  React.useEffect(() => { if (open) setMotivo(""); }, [open]);
  const pedido = usePedidoDeLote<{ estornados: number; itens: { id: string; resultado: string; motivo?: string }[] }>((r) => {
    onOpenChange(false);
    aoConcluir({ titulo: "Resultado do estorno", verbo: "estornado(s)", feitos: r.estornados, pulados: r.itens.filter((i) => i.resultado === "pulado").map((i) => ({ id: i.id, motivo: i.motivo ?? "" })) });
  });
  return <Dialog open={open} onOpenChange={onOpenChange} title={`Estornar baixa (${titulos.length} título(s))`} size="md" testId="fin-dialogo-estorno"
    footer={<><Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button><Button size="sm" variant="danger" loading={pedido.isPending} disabled={!motivo.trim()} onClick={() => pedido.mutate({ path: "/api/financeiro/titulos/estornar-baixas", body: { ids: titulos.map((t) => t.id), motivo: motivo.trim() } })}>Confirmar estorno</Button></>}>
    <p className="mb-3 text-sm text-slate-600">As baixas confirmadas destes títulos são estornadas: os movimentos bancários são cancelados (nunca excluídos) e o saldo volta ao título. Baixa em lote com movimento único só sai com todos os títulos do lote.</p>
    <div className="grid grid-cols-12 gap-2"><Field label="Motivo" required span={12}><Textarea value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} /></Field></div>
  </Dialog>;
}

/**
 * ALTERAR VENCIMENTO (e/ou a conta prevista), em lote ou de um título só, com MOTIVO. Vale também para título gerado por
 * documento — vencimento e conta prevista são as duas coisas que mudam fora da origem.
 */
export function DialogoVencimento({ open, onOpenChange, titulos, aoConcluir }: { open: boolean; onOpenChange: (o: boolean) => void; titulos: TituloDoLote[]; aoConcluir: (r: ResultadoLote) => void }) {
  const [v, setV] = React.useState({ vencimento: "", conta: "", removerConta: false, motivo: "" });
  React.useEffect(() => { if (open) setV({ vencimento: "", conta: "", removerConta: false, motivo: "" }); }, [open]);
  const pedido = usePedidoDeLote<{ alterados: number; itens: { id: string; resultado: string; motivo?: string }[] }>((r) => {
    onOpenChange(false);
    aoConcluir({ titulo: "Resultado da alteração de vencimento", verbo: "alterado(s)", feitos: r.alterados, pulados: r.itens.filter((i) => i.resultado === "pulado").map((i) => ({ id: i.id, motivo: i.motivo ?? "" })) });
  });
  const mudaConta = v.removerConta || Boolean(v.conta);
  const erro = !v.vencimento && !mudaConta ? "Informe o novo vencimento ou a conta prevista." : !v.motivo.trim() ? "Informe o motivo." : null;
  const confirmar = () => pedido.mutate({ path: "/api/financeiro/titulos/alterar-vencimento", body: { ids: titulos.map((t) => t.id), ...(v.vencimento ? { vencimento: v.vencimento } : {}), ...(mudaConta ? { conta_prevista_id: v.removerConta ? null : v.conta } : {}), motivo: v.motivo.trim() } });
  return <Dialog open={open} onOpenChange={onOpenChange} title={titulos.length === 1 ? `Alterar vencimento de ${titulos[0]!.numero}` : `Alterar vencimento (${titulos.length} título(s))`} size="md" testId="fin-dialogo-vencimento"
    footer={<><Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button><Button size="sm" loading={pedido.isPending} disabled={Boolean(erro)} title={erro ?? undefined} onClick={confirmar}>Confirmar alteração</Button></>}>
    <div className="grid grid-cols-12 gap-2">
      <Field label="Novo vencimento" span={6}><Input type="date" value={v.vencimento} onChange={(e) => setV({ ...v, vencimento: e.target.value })} /></Field>
      <Field label="Conta prevista" span={6}><RefSelect resource="bank_accounts" value={v.conta || null} disabled={v.removerConta} onChange={(x) => setV({ ...v, conta: x ?? "" })} placeholder="Manter a atual" /></Field>
      <label className="col-span-12 flex items-center gap-1.5 text-[12.5px]"><input type="checkbox" checked={v.removerConta} onChange={(e) => setV({ ...v, removerConta: e.target.checked, conta: "" })} /> Remover a conta prevista</label>
      <Field label="Motivo" required span={12}><Textarea value={v.motivo} maxLength={500} onChange={(e) => setV({ ...v, motivo: e.target.value })} /></Field>
    </div>
    {erro && <p className="mt-2 text-sm text-red-600">{erro}</p>}
  </Dialog>;
}

/** O RESULTADO do lote: "N feito(s) · M pulado(s)" e, para cada pulado, o título e o motivo em PT-BR. */
export function ResultadoDoLote({ resultado, onOpenChange, titulos }: { resultado: ResultadoLote | null; onOpenChange: (o: boolean) => void; titulos: ReadonlyMap<string, TituloDoLote> }) {
  return <Dialog open={Boolean(resultado)} onOpenChange={onOpenChange} title={resultado?.titulo ?? "Resultado"} size="md" testId="fin-resultado-lote"
    footer={<Button size="sm" data-testid="fin-resultado-fechar" onClick={() => onOpenChange(false)}>Fechar</Button>}>
    {resultado && <>
      <p className="text-sm font-semibold" data-testid="fin-resultado-resumo">{resultado.feitos} {resultado.verbo} · {resultado.pulados.length} pulado(s)</p>
      {resultado.extra && <p className="mt-1 text-sm text-slate-600">{resultado.extra}</p>}
      {resultado.pulados.length > 0 && <ul className="mt-2 space-y-1 text-[12.5px]">
        {resultado.pulados.map((p) => <li key={p.id} data-testid="fin-resultado-pulado" data-motivo={p.motivo}><b>{nomeDo(titulos.get(p.id.toLowerCase()))}</b>: {rotuloFinanceiro("motivo_lote", p.motivo)}</li>)}
      </ul>}
    </>}
  </Dialog>;
}
