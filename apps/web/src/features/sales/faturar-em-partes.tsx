"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { D, money } from "@agro/shared";
import { api } from "@/lib/api";
import { brl, num } from "@/lib/utils";
import { Button, Dialog, Field, Input, Textarea } from "@/components/ui";
import type { Row } from "@/features/docs/shared";
import { variantesDeVenda } from "./variantes";

/**
 * FATURAR EM PARTES (TOP-CONFIG-06) — o que a tela precisa para converter um documento várias vezes.
 *
 * Nada aqui DECIDE saldo: o servidor recalcula e recusa (422) quantidade acima do saldo. O cálculo do
 * total da parte é só exibição — o valor gravado é o que a API devolve no documento gerado.
 */

/** Quantidade como o contrato a aceita: decimal com até 4 casas, ponto como separador. */
const QUANTIDADE_CANONICA = /^\d+(\.\d{1,4})?$/;

/** O saldo do item: o que o servidor declarou, ou a quantidade inteira enquanto nenhuma parte foi gerada. */
export const saldoDoItem = (it: Row): string => {
  const s = it["saldo"];
  return s === undefined || s === null ? String(it["quantity"] ?? "0") : String(s);
};

/** O documento já gerou alguma parte? O servidor só manda `faturado`/`saldo` nesse caso. */
export const temParteGerada = (itens: Row[]): boolean => itens.some((it) => it["faturado"] !== undefined && it["faturado"] !== null);

/** O documento É uma parte gerada? Os itens dela apontam para o item da origem. */
export const ehParteGerada = (itens: Row[]): boolean => itens.some((it) => typeof it["origem_item_id"] === "string" && it["origem_item_id"] !== "");

export interface LinhaDaParte { itemId: string; incluir: boolean; quantidade: string }

/** Linhas iniciais: só itens com saldo, quantidade começando no saldo, todas marcadas. */
export const linhasIniciais = (itens: Row[]): LinhaDaParte[] =>
  itens.filter((it) => D(saldoDoItem(it)).gt(0)).map((it) => ({ itemId: String(it["id"]), incluir: true, quantidade: D(saldoDoItem(it)).toString() }));

const normalizar = (v: string) => v.trim().replace(",", ".");

/** A quantidade digitada é aceitável? Canônica, maior que zero e até o saldo. */
const quantidadeValida = (q: string, saldo: string): boolean => {
  const n = normalizar(q);
  return QUANTIDADE_CANONICA.test(n) && D(n).gt(0) && D(n).lte(D(saldo));
};

/** Total aproximado de UMA linha da parte: descontos da origem aplicados na proporção da quantidade. */
const totalDaLinha = (it: Row, quantidade: string): string => {
  const q = D(normalizar(quantidade));
  const original = D(String(it["quantity"] ?? "0"));
  const bruto = q.mul(String(it["unit_price"] ?? "0"));
  const descontoValor = original.gt(0) ? D(String(it["discount"] ?? "0")).mul(q).div(original) : D(0);
  const descontoPct = bruto.mul(String(it["discount_percent"] ?? "0")).div(100);
  const t = bruto.minus(descontoValor).minus(descontoPct);
  return money(t.lt(0) ? 0 : t);
};

/** O corpo `itens` do convert, ou `null` quando a seleção não pode ser enviada. */
export function itensParaEnvio(itens: Row[], linhas: LinhaDaParte[]): { item_id: string; quantidade: string }[] | null {
  const marcadas = linhas.filter((l) => l.incluir);
  if (marcadas.length === 0) return null;
  const porId = new Map(itens.map((it) => [String(it["id"]), it]));
  const out: { item_id: string; quantidade: string }[] = [];
  for (const l of marcadas) {
    const it = porId.get(l.itemId);
    if (!it || !quantidadeValida(l.quantidade, saldoDoItem(it))) return null;
    out.push({ item_id: l.itemId, quantidade: D(normalizar(l.quantidade)).toFixed() });
  }
  return out;
}

/** A tabela de itens do diálogo de conversão quando o destino é "Em partes". */
export function ItensDaConversao({ itens, linhas, onChange }: { itens: Row[]; linhas: LinhaDaParte[]; onChange: (l: LinhaDaParte[]) => void }) {
  const porId = new Map(itens.map((it) => [String(it["id"]), it]));
  const mudar = (itemId: string, patch: Partial<LinhaDaParte>) => onChange(linhas.map((l) => l.itemId === itemId ? { ...l, ...patch } : l));
  const total = linhas.reduce((acc, l) => {
    const it = porId.get(l.itemId);
    return l.incluir && it && quantidadeValida(l.quantidade, saldoDoItem(it)) ? acc.plus(totalDaLinha(it, l.quantidade)) : acc;
  }, D(0));
  return <div className="space-y-2" data-testid="conversao-itens">
    <p className="text-xs text-slate-500">Escolha os itens e as quantidades desta parte.</p>
    <table className="w-full text-sm" aria-label="Itens da parte">
      <thead><tr className="text-left text-xs text-slate-500">
        <th className="py-1">Incluir</th><th>Produto</th><th className="text-right">Saldo</th><th className="text-right">Quantidade</th>
      </tr></thead>
      <tbody>
        {linhas.length === 0 && <tr><td colSpan={4} className="py-2 text-slate-500">Nenhum item com saldo.</td></tr>}
        {linhas.map((l) => {
          const it = porId.get(l.itemId);
          if (!it) return null;
          const saldo = saldoDoItem(it);
          const invalida = l.incluir && !quantidadeValida(l.quantidade, saldo);
          return <tr key={l.itemId} className="border-t">
            <td className="py-1"><input type="checkbox" aria-label={`Incluir ${String(it["product_name"] ?? "")}`} data-testid={`conversao-item-${l.itemId}-incluir`}
              checked={l.incluir} onChange={(e) => mudar(l.itemId, { incluir: e.target.checked })} /></td>
            <td>{String(it["product_name"] ?? "—")}</td>
            <td className="text-right tabular-nums">{num(saldo, 4)}</td>
            <td className="w-32 py-1"><Input inputMode="decimal" aria-label={`Quantidade de ${String(it["product_name"] ?? "")}`} aria-invalid={invalida || undefined}
              data-testid={`conversao-item-${l.itemId}-quantidade`} className="text-right" disabled={!l.incluir}
              value={l.quantidade} onChange={(e) => mudar(l.itemId, { quantidade: e.target.value })} /></td>
          </tr>;
        })}
      </tbody>
    </table>
    <p className="text-right text-sm">Total da parte <b data-testid="conversao-total">{brl(money(total))}</b></p>
    <p className="text-[11px] text-slate-500">Quantidade maior que zero, até o saldo, com até 4 casas decimais. O total é uma prévia; o valor final é calculado ao converter.</p>
  </div>;
}

/** Diálogo "Encerrar saldo": motivo obrigatório (1 a 500 caracteres). */
export function DialogoEncerrarSaldo({ open, onOpenChange, loading, onConfirmar }: { open: boolean; onOpenChange: (o: boolean) => void; loading: boolean; onConfirmar: (motivo: string) => void }) {
  const [motivo, setMotivo] = React.useState("");
  React.useEffect(() => { if (open) setMotivo(""); }, [open]);
  const limpo = motivo.trim();
  return <Dialog open={open} onOpenChange={onOpenChange} title="Encerrar saldo" size="sm" testId="dialog-encerrar-saldo"
    footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Voltar</Button>
      <Button variant="danger" loading={loading} disabled={limpo.length === 0 || limpo.length > 500} data-testid="encerrar-saldo-confirmar" onClick={() => onConfirmar(limpo)}>Encerrar saldo</Button></>}>
    <p className="mb-3 text-sm text-slate-600">O saldo restante deixa de poder ser convertido. As partes já geradas não mudam.</p>
    <div className="grid grid-cols-12 gap-2">
      <Field label="Motivo" required span={12}>
        <Textarea data-testid="encerrar-saldo-motivo" maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </Field>
    </div>
  </Dialog>;
}

/**
 * O código do documento de origem de uma parte gerada. Usa o que o detalhe trouxer; senão pergunta a
 * origem pelas portas das variantes que o usuário pode ver — 404 numa porta é só "não é desta variante".
 */
export function useCodigoDaOrigem(d: Row | undefined, habilitado: boolean, podeVer: (perm: string) => boolean): string | null {
  const direto = d ? (d["origin_document_code"] ?? d["origem_codigo"]) : undefined;
  const origem = d && typeof d["origin_document_id"] === "string" ? d["origin_document_id"] : "";
  const precisa = habilitado && !direto && Boolean(origem);
  const q = useQuery<string | null>({
    queryKey: ["sales-origem-codigo", origem],
    enabled: precisa,
    retry: false,
    queryFn: async () => {
      for (const v of variantesDeVenda().filter((x) => podeVer(`${x.perm}.view`))) {
        try {
          const r = await api<Row>(`/api/sales/${v.segmento}/${origem}`);
          if (r && r["code"] !== undefined && r["code"] !== null) return String(r["code"]);
        } catch { /* outra variante: segue */ }
      }
      return null;
    }
  });
  if (typeof direto === "string" && direto) return direto;
  return q.data ?? null;
}
