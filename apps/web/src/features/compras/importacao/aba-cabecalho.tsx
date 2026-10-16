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
 * A ABA "CABEÇALHO" DA CONFERÊNCIA (OPERACOES-01 F7, decisão 284): TOP, datas, FORNECEDOR e o essencial da nota.
 * Valores fiscais da nota ficam num resumo compacto (o XML já guarda o detalhe) — o foco é o que a pessoa decide
 * para gerar a compra, no mesmo espírito da Central.
 */

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

export function AbaCabecalho({ e, tops, onEscolherFornecedor, solicitacaoId, onDesvincularSolicitacao }: {
  e: EstadoDaConferencia; tops: EstadoTop; onEscolherFornecedor: (id: string) => void; solicitacaoId: string | null; onDesvincularSolicitacao: () => void;
}) {
  const { can } = useAuth();
  const { conf, cab } = e;
  const nota = conf.nota;
  const p = conf.parceiro;
  const [cadastrando, setCadastrando] = React.useState(false);
  const [detalheNota, setDetalheNota] = React.useState(false);
  const leitura = !e.pendente;

  return <div data-testid="importacao-aba-cabecalho" className="flex flex-col gap-4">
    <div className="grid grid-cols-12 gap-3">
      <Field label="TOP de compra" span={5} required error={e.erroEm("tipo_operacao_id")}>
        {tops.situacao === "pronto"
          ? <NativeSelect data-testid="importacao-top" value={cab.topId} disabled={leitura} onChange={(ev) => e.mudarCab({ topId: ev.target.value })}>
            <option value="">Escolha a TOP</option>
            {tops.dados.items.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
          </NativeSelect>
          : <span className="text-xs text-slate-500" data-testid="importacao-top-indisponivel">
            {tops.situacao === "carregando" ? "Carregando as TOPs de compra…" : tops.situacao === "sem-top" ? "Nenhuma TOP de compra ativa: configure uma TOP de compra." : "As TOPs de compra não puderam ser lidas."}
          </span>}
      </Field>
      <Field label="Emissão (nota)" span={2}>
        <Input data-testid="importacao-data-emissao" type="date" value={nota.dataEmissao} disabled readOnly />
      </Field>
      <Field label="Data de entrada" span={2} error={e.erroEm("data_entrada")}>
        <Input data-testid="importacao-data-entrada" type="date" value={cab.dataEntrada} disabled={leitura} onChange={(ev) => e.mudarCab({ dataEntrada: ev.target.value })} />
      </Field>
      <Field label="Transportadora" span={3} error={e.erroEm("transportadora_id")}>
        <RefSelect resource="people" value={cab.transportadoraId} filter={{ is_transporter: "true" }} disabled={leitura} onChange={(v) => e.mudarCab({ transportadoraId: v ?? "" })} />
      </Field>
    </div>

    <section data-testid="importacao-parceiro" data-situacao={p.situacao} className="rounded border px-3 py-2">
      <h3 className="mb-1 text-[12px] font-semibold text-slate-600">Fornecedor</h3>
      <p className="mb-1 text-[11.5px] text-slate-500">Emitente da nota: {nota.emitente.nome} — {nota.emitente.documento}</p>
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
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px]">
          <span className="text-slate-500">Nota</span>{" "}
          <strong>{nota.numero}/{nota.serie}</strong>
          <span className="text-slate-400"> · </span>
          <span className="text-slate-500">emissão</span> {dateBR(nota.dataEmissao)}
          <span className="text-slate-400"> · </span>
          <span className="text-slate-500">total</span>{" "}
          <strong data-testid="importacao-total-da-nota">{brl(nota.totais.nota)}</strong>
        </p>
        <button type="button" className="text-[12px] font-medium text-emerald-700 underline" data-testid="importacao-valores-detalhe"
          aria-expanded={detalheNota} onClick={() => setDetalheNota((v) => !v)}>
          {detalheNota ? "Ocultar detalhe da nota" : "Ver detalhe da nota"}
        </button>
      </div>
      {detalheNota && <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] md:grid-cols-4">
        <div><span className="text-slate-500">Chave</span><div className="font-mono text-[11px]">{formatarChaveDeAcesso(nota.chave)}</div></div>
        <div><span className="text-slate-500">Natureza</span><div>{nota.naturezaOperacao ?? "—"}</div></div>
        <div><span className="text-slate-500">Produtos</span><div>{brl(nota.totais.produtos)}</div></div>
        <div><span className="text-slate-500">Desconto</span><div>{brl(nota.totais.desconto)}</div></div>
        <div><span className="text-slate-500">Frete</span><div>{brl(nota.totais.frete)}</div></div>
        <div><span className="text-slate-500">Seguro</span><div>{brl(nota.totais.seguro)}</div></div>
        <div><span className="text-slate-500">Outras</span><div>{brl(nota.totais.outras)}</div></div>
        <div><span className="text-slate-500">IPI / ICMS-ST</span><div>{brl(nota.totais.ipi)} / {brl(nota.totais.icmsSt)}</div></div>
      </div>}
    </section>

    <div className="grid grid-cols-12 gap-3">
      <Field label="Observação" span={12} error={e.erroEm("observacao")}>
        <Textarea data-testid="importacao-observacao" rows={2} maxLength={2000} value={cab.observacao} disabled={leitura} onChange={(ev) => e.mudarCab({ observacao: ev.target.value })} />
      </Field>
    </div>
  </div>;
}
