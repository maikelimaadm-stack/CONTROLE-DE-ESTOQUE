"use client";
import * as React from "react";
import Link from "next/link";
import { formatarChaveDeAcesso, type PreenchimentoDoFornecedor } from "@agro/domain";
import { useAuth } from "@/lib/auth";
import { brl, dateBR } from "@/lib/utils";
import { Button, Dialog, Field, Input, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import type { EstadoTop } from "@/features/sales/tipo-operacao-select";
import type { EstadoDaConferencia } from "./estado";

/**
 * A ABA "CABEÇALHO" DA CONFERÊNCIA (OPERACOES-01 F7, decisão 284): a TOP de compra, a data de entrada, o FORNECEDOR
 * (o parceiro do emitente, como o servidor o achou), a transportadora, os valores da nota (somente leitura — eles vêm
 * do XML guardado) e a observação. Fornecedor ambíguo é ESCOLHA da pessoa (nunca "o primeiro"); sem cadastro, o
 * cadastro rápido nasce pré-preenchido pelo emitente e só grava com a confirmação dela.
 */

// carregado sob demanda, como no seletor de referência (o formulário declarativo usa o seletor)
const ResourceQuickCreate = React.lazy(() => import("@/features/resources/quick-create").then((m) => ({ default: m.ResourceQuickCreate })));

/** O cadastro rápido (a MESMA porta dos cadastros, `POST /api/resources/<recurso>`) com o pré-preenchimento do servidor. */
export function DialogoDeCadastroRapido({ recurso, titulo, aberto, onFechar, preset, onCriado }: {
  recurso: "people" | "products"; titulo: string; aberto: boolean; onFechar: () => void; preset: Record<string, string>; onCriado: (row: Record<string, unknown>) => void;
}) {
  return <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }} title={titulo} size="xl" testId={`importacao-cadastro-${recurso}`}>
    {aberto && <React.Suspense fallback={<div className="p-6 text-sm text-slate-400">Carregando…</div>}>
      <ResourceQuickCreate resourceKey={recurso} preset={preset} onCancel={onFechar} onCreated={(row) => { onCriado(row); onFechar(); }} />
    </React.Suspense>}
  </Dialog>;
}

/** O pré-preenchimento do fornecedor em texto (o formulário declarativo lê `string`): nulo fica de fora; nunca "false". */
export function presetDoFornecedor(p: PreenchimentoDoFornecedor): Record<string, string> {
  const out: Record<string, string> = { is_provider: "true", person_type: p.person_type, document: p.document, name: p.name, legal_name: p.legal_name };
  const opcionais: [string, string | number | null][] = [["state_registration", p.state_registration], ["zip_code", p.zip_code], ["address", p.address],
    ["address_number", p.address_number], ["district", p.district], ["city_id", p.city_id], ["phone", p.phone]];
  for (const [k, v] of opcionais) if (v !== null && v !== undefined && String(v) !== "") out[k] = String(v);
  return out;
}

const Valor = ({ rotulo, valor, testId }: { rotulo: string; valor: React.ReactNode; testId?: string }) =>
  <div className="flex flex-col"><span className="text-[11px] text-slate-500">{rotulo}</span><span className="text-[13px] font-medium" data-testid={testId}>{valor}</span></div>;

export function AbaCabecalho({ e, tops, onEscolherFornecedor, solicitacaoId, onDesvincularSolicitacao }: {
  e: EstadoDaConferencia; tops: EstadoTop; onEscolherFornecedor: (id: string) => void; solicitacaoId: string | null; onDesvincularSolicitacao: () => void;
}) {
  const { can } = useAuth();
  const { conf, cab } = e;
  const nota = conf.nota;
  const p = conf.parceiro;
  const [cadastrando, setCadastrando] = React.useState(false);
  const leitura = !e.pendente;

  return <div data-testid="importacao-aba-cabecalho" className="flex flex-col gap-4">
    <div className="grid grid-cols-12 gap-3">
      <Field label="TOP de compra" span={6} required error={e.erroEm("tipo_operacao_id")}>
        {tops.situacao === "pronto"
          ? <NativeSelect data-testid="importacao-top" value={cab.topId} disabled={leitura} onChange={(ev) => e.mudarCab({ topId: ev.target.value })}>
            <option value="">Escolha a TOP</option>
            {tops.dados.items.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
          </NativeSelect>
          : <span className="text-xs text-slate-500" data-testid="importacao-top-indisponivel">
            {tops.situacao === "carregando" ? "Carregando as TOPs de compra…" : tops.situacao === "sem-top" ? "Nenhuma TOP de compra ativa: configure uma TOP de compra." : "As TOPs de compra não puderam ser lidas."}
          </span>}
      </Field>
      <Field label="Data de entrada" span={3} error={e.erroEm("data_entrada")}>
        <Input data-testid="importacao-data-entrada" type="date" value={cab.dataEntrada} disabled={leitura} onChange={(ev) => e.mudarCab({ dataEntrada: ev.target.value })} />
      </Field>
      <Field label="Transportadora" span={3} error={e.erroEm("transportadora_id")}>
        <RefSelect resource="people" value={cab.transportadoraId} filter={{ is_transporter: "true" }} disabled={leitura} onChange={(v) => e.mudarCab({ transportadoraId: v ?? "" })} />
      </Field>
    </div>

    <section data-testid="importacao-parceiro" data-situacao={p.situacao} className="rounded border px-3 py-2">
      <h3 className="mb-1 text-[12px] font-semibold text-slate-600">Fornecedor (emitente {nota.emitente.nome} — {nota.emitente.documento})</h3>
      {p.situacao === "encontrado" && <p className="text-[13px]">Fornecedor encontrado: <strong>{p.nome}</strong> ({p.documento})</p>}
      {p.situacao === "nao_fornecedor" && <p className="text-[13px] text-amber-800">O cadastro encontrado não é do tipo Fornecedor. <Link className="underline" href={`/cadastros/pessoas/${p.id}`}>Abrir o cadastro de {p.nome}</Link> e marcá-lo como fornecedor.</p>}
      {p.situacao === "ambiguo" && <div className="flex flex-col gap-2">
        <p className="text-[13px] text-amber-800">Mais de um cadastro corresponde ao emitente: escolha o fornecedor.</p>
        <NativeSelect data-testid="importacao-parceiro-escolha" className="max-w-xl" value={conf.fornecedorEscolhido ?? ""} disabled={leitura} onChange={(ev) => { if (ev.target.value) onEscolherFornecedor(ev.target.value); }}>
          <option value="">Escolha o fornecedor</option>
          {p.candidatos.map((c) => <option key={c.id} value={c.id}>{c.nome} — {c.documento}{c.origem === "filial" ? " (filial)" : ""}{c.ie ? ` — IE ${c.ie}` : ""}</option>)}
        </NativeSelect>
      </div>}
      {p.situacao === "nenhum" && <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] text-amber-800">Nenhum cadastro com este CNPJ/CPF.</p>
        {can("people.create") && !leitura && <Button size="sm" variant="outline" data-testid="importacao-parceiro-cadastrar" onClick={() => setCadastrando(true)}>Cadastrar fornecedor</Button>}
      </div>}
      {e.erroEm("fornecedor_id") && <p className="mt-1 text-[11px] text-red-600">{e.erroEm("fornecedor_id")}</p>}
    </section>
    {p.situacao === "nenhum" && <DialogoDeCadastroRapido recurso="people" titulo="Cadastrar fornecedor pelo emitente da nota" aberto={cadastrando}
      onFechar={() => setCadastrando(false)} preset={presetDoFornecedor(p.preenchimento)} onCriado={(row) => onEscolherFornecedor(String(row["id"]))} />}

    {solicitacaoId && <section data-testid="importacao-solicitacao" className="flex flex-wrap items-center gap-2 rounded border border-sky-200 bg-sky-50 px-3 py-2 text-[13px]">
      <span>Solicitação de compra vinculada: a compra gerada fica ligada a ela (e o recebimento da solicitação passa a aceitar a compra).</span>
      <Link className="underline" href={`/suprimentos/view/${solicitacaoId}`}>Abrir a solicitação</Link>
      {!leitura && <Button size="sm" variant="ghost" onClick={onDesvincularSolicitacao}>Desvincular</Button>}
      {e.erroEm("solicitacao_compra_id") && <span className="text-[11px] text-red-600">{e.erroEm("solicitacao_compra_id")}</span>}
    </section>}

    <section data-testid="importacao-valores-da-nota" className="rounded border px-3 py-2">
      <h3 className="mb-2 text-[12px] font-semibold text-slate-600">Valores da nota (do XML guardado)</h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Valor rotulo="Número / série" valor={`${nota.numero} / ${nota.serie}`} />
        <Valor rotulo="Emissão" valor={dateBR(nota.dataEmissao)} />
        <Valor rotulo="Chave de acesso" valor={<span className="font-mono text-[11px]">{formatarChaveDeAcesso(nota.chave)}</span>} />
        <Valor rotulo="Natureza da operação" valor={nota.naturezaOperacao ?? "—"} />
        <Valor rotulo="Produtos" valor={brl(nota.totais.produtos)} />
        <Valor rotulo="Desconto" valor={brl(nota.totais.desconto)} />
        <Valor rotulo="Frete" valor={brl(nota.totais.frete)} />
        <Valor rotulo="Seguro" valor={brl(nota.totais.seguro)} />
        <Valor rotulo="Outras despesas" valor={brl(nota.totais.outras)} />
        <Valor rotulo="IPI" valor={brl(nota.totais.ipi)} />
        <Valor rotulo="ICMS-ST" valor={brl(nota.totais.icmsSt)} />
        <Valor rotulo="Total da nota" valor={brl(nota.totais.nota)} testId="importacao-total-da-nota" />
      </div>
    </section>

    <div className="grid grid-cols-12 gap-3">
      <Field label="Observação" span={12} error={e.erroEm("observacao")}>
        <Textarea data-testid="importacao-observacao" rows={2} maxLength={2000} value={cab.observacao} disabled={leitura} onChange={(ev) => e.mudarCab({ observacao: ev.target.value })} />
      </Field>
    </div>
  </div>;
}
