"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ehCadastroComNumeracao } from "@agro/domain";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { Button, Dialog } from "@/components/ui";
import { useCodigoAutomatico } from "@/features/resources/capacidade-codigo";

/** Linha de `GET /api/admin/numeracao` (decisão 257 D-3). */
export interface LinhaNumeracao { cadastro: string; rotulo: string; tipo: "hierarquico" | "sequencial"; registros: number; excluidos: number; proximoCodigo: string | null; podeZerar: boolean; motivo: string | null }

const mensagem = (e: unknown) => { const det = (e as Error & { details?: { message: string }[] }).details; return det?.length ? det.map((d) => d.message).join(" ") : (e as Error).message; };

/**
 * Confirmação do Zerar: o texto diz o efeito inteiro antes do clique. Quem decide se pode é a API (recontagem
 * dentro da transação); a tela só desabilita com o motivo que a própria API devolveu.
 */
function ConfirmarZerar({ linha, onFechar, onZerado }: { linha: LinhaNumeracao; onFechar: () => void; onZerado: (proximo: string | null) => void }) {
  const [gravando, setGravando] = React.useState(false); const [erro, setErro] = React.useState<string | null>(null);
  const zerar = async () => {
    setGravando(true); setErro(null);
    try { const r = await api<{ proximoCodigo: string | null }>(`/api/admin/numeracao/${linha.cadastro}/zerar`, { method: "POST" }); toast.success(`Numeração de ${linha.rotulo} zerada`); onZerado(r.proximoCodigo); }
    catch (e) { setErro(mensagem(e)); } finally { setGravando(false); }
  };
  return <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }} title="Zerar numeração"
    footer={<><Button variant="outline" onClick={onFechar}>Cancelar</Button><Button data-testid="numeracao-confirmar" loading={gravando} onClick={() => { void zerar(); }}>Continuar</Button></>}>
    <p className="text-[13px]" data-testid="numeracao-confirmacao">A numeração de {linha.rotulo} volta para 1. {linha.excluidos} {linha.excluidos === 1 ? "registro excluído terá" : "registros excluídos terão"} o código liberado (ficam como EXC-…). Continuar?</p>
    {erro && <p role="alert" className="mt-2 text-[12px] text-red-600">{erro}</p>}
  </Dialog>;
}

/** Parametrizações → "Numeração dos cadastros": uma linha por cadastro com código. Só com a capacidade da API. */
export function NumeracaoCadastros() {
  const { can } = useAuth(); const qc = useQueryClient(); const capaz = useCodigoAutomatico();
  const podeVer = capaz && can("tenant_parameters.edit");
  const q = useQuery({ queryKey: ["numeracao"], queryFn: () => api<{ cadastros: LinhaNumeracao[] }>("/api/admin/numeracao"), enabled: podeVer });
  const [zerando, setZerando] = React.useState<LinhaNumeracao | null>(null);
  if (!podeVer) return null;
  return <section className="col-span-12 mt-2" data-testid="numeracao-cadastros" aria-label="Numeração dos cadastros">
    <h3 className="mb-1 text-[13px] font-semibold text-slate-800">Numeração dos cadastros</h3>
    <p className="mb-2 text-[12px] text-slate-500">Zerar só com o cadastro vazio. Documentos (títulos, notas, vendas, OS, lançamentos, apurações) nunca voltam a 1.</p>
    {q.isLoading ? <p className="text-[12px] text-slate-400">Carregando…</p> : q.isError ? <p role="alert" className="text-[12px] text-red-600">{mensagem(q.error)}</p> :
      <table className="w-full text-[12px]"><thead><tr className="text-left text-slate-500"><th className="py-1">Cadastro</th><th className="text-right">Registros</th><th className="text-right">Excluídos</th><th className="pl-3">Próximo código</th><th /></tr></thead>
        <tbody>{(q.data?.cadastros ?? []).map((l) => <tr key={l.cadastro} data-testid={`numeracao-${l.cadastro}`} className="border-t border-slate-100">
          <td className="py-1">{l.rotulo}</td><td className="text-right" data-testid="numeracao-registros">{l.registros}</td><td className="text-right" data-testid="numeracao-excluidos">{l.excluidos}</td><td className="pl-3" data-testid="numeracao-proximo">{l.proximoCodigo ?? "—"}</td>
          <td className="text-right"><span className="inline-flex items-center gap-2">{l.motivo && <span className="text-[11px] text-slate-500" data-testid="numeracao-motivo">{l.motivo}</span>}<Button size="sm" variant="outline" data-testid="numeracao-zerar" disabled={!l.podeZerar} title={l.motivo ?? undefined} onClick={() => setZerando(l)}>Zerar</Button></span></td>
        </tr>)}</tbody></table>}
    {zerando && <ConfirmarZerar linha={zerando} onFechar={() => setZerando(null)} onZerado={() => { setZerando(null); void qc.invalidateQueries({ queryKey: ["numeracao"] }); }} />}
  </section>;
}

/**
 * ATALHO NA LISTA VAZIA de um cadastro com numeração: aparece só quando não há registro vivo e a numeração não
 * está no começo (há excluído segurando código ou o próximo não é o primeiro). Mesma API e mesma confirmação.
 */
export function NumeracaoAtalho({ resourceKey }: { resourceKey: string }) {
  const { can } = useAuth(); const capaz = useCodigoAutomatico(); const qc = useQueryClient();
  const ativo = capaz && can("tenant_parameters.edit") && ehCadastroComNumeracao(resourceKey);
  const q = useQuery({ queryKey: ["numeracao", resourceKey], queryFn: () => api<LinhaNumeracao>(`/api/admin/numeracao/${resourceKey}`), enabled: ativo, retry: false });
  const [zerando, setZerando] = React.useState(false);
  const l = q.data;
  if (!ativo || !l || l.registros > 0 || !l.podeZerar) return null;
  const noComeco = l.excluidos === 0 && (l.proximoCodigo === null || Number(l.proximoCodigo) === 1);
  if (noComeco) return null;
  return <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[12px]" data-testid="numeracao-atalho">
    <span>Cadastro vazio. Próximo código: <b>{l.proximoCodigo ?? "—"}</b>.</span>
    <Button size="sm" variant="outline" data-testid="numeracao-atalho-zerar" onClick={() => setZerando(true)}>Zerar numeração</Button>
    {zerando && <ConfirmarZerar linha={l} onFechar={() => setZerando(false)} onZerado={() => { setZerando(false); void qc.invalidateQueries({ queryKey: ["numeracao"] }); }} />}
  </div>;
}
