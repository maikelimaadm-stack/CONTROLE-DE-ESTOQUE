"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { D, money } from "@agro/shared";
import { api, newIdem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { enumLabel } from "@/lib/copy";
import { todayISO } from "@/lib/utils";
import { Button, Card, CardBody, CardHeader, Field, Input, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { PlanEditor, defaultPlan, useEmpresaPadrao, useDoc, LoadingOr, type Plan, type Row } from "@/features/docs/shared";
import { dirCfg, type Dir } from "@/features/financial/titles";
import { RateioEmReais, linhaDeRateioVazia, lerDecimal, rateioParaApi, situacaoDoRateio, type LinhaRateio } from "./rateio-em-reais";
import { useFinanceiroPelaTop } from "./capacidade";
import { SeletorDeTopFinanceira, linhasComATrava, primeiraLinhaComOsPadroes, textoDoRateioTravado, travaDaTop, type TopFinanceira } from "./top-financeira";

const FORMAS: [string, string][] = [["single", "À vista"], ["installments", "Parcelado"], ["recurring", "Recorrente"], ["advance", "Adiantamento"]];
const TIPOS_DE_DOCUMENTO = ["nfe", "cte", "nfse", "nfce", "danfe", "darf", "dare", "gru", "other"];

/** O arquivo para a porta de anexos (`POST /api/attachments`, conteúdo em base64). */
const paraBase64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] ?? ""); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
const TIPOS_POR_EXTENSAO: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", txt: "text/plain", csv: "text/csv", xml: "application/xml", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
const tipoDoArquivo = (f: File) => f.type || TIPOS_POR_EXTENSAO[f.name.split(".").pop()?.toLowerCase() ?? ""] || "application/octet-stream";

/** Sobe os anexos DEPOIS do título existir (a porta oficial exige o pai). Falha de um anexo não desfaz o título. */
async function enviarAnexos(tituloId: string, arquivos: readonly File[]): Promise<{ nome: string; erro: string }[]> {
  const falhas: { nome: string; erro: string }[] = [];
  for (const f of arquivos) {
    try { await api("/api/attachments", { method: "POST", body: { entity: "financial_titles", entity_id: tituloId, file_name: f.name, mime_type: tipoDoArquivo(f), description: null, data_base64: await paraBase64(f) } }); }
    catch (e) { falhas.push({ nome: f.name, erro: (e as Error).message }); }
  }
  return falhas;
}

interface Cabecalho {
  empresa_id: string; number: string; person_id: string; title_type_id: string; conta_prevista_id: string;
  emission_date: string; data_competencia: string; due_date: string; amount: string; discount: string;
  payment_type: string; recurrence_type: string; recurrence_count: string; note: string;
  document_type: string; proprietary_id: string; classification: string; is_deductible: boolean; is_tax: boolean; appropriation: string; appropriation_type: string;
  ja_pago: boolean; ja_pago_conta: string; ja_pago_data: string;
}
const cabecalhoNovo = (): Cabecalho => ({
  empresa_id: "", number: "", person_id: "", title_type_id: "", conta_prevista_id: "", emission_date: todayISO(), data_competencia: "", due_date: todayISO(), amount: "", discount: "0",
  payment_type: "single", recurrence_type: "monthly", recurrence_count: "12", note: "", document_type: "", proprietary_id: "", classification: "unclassified", is_deductible: false, is_tax: false,
  appropriation: "direct", appropriation_type: "", ja_pago: false, ja_pago_conta: "", ja_pago_data: todayISO()
});
const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const data10 = (v: unknown) => texto(v).slice(0, 10);

/**
 * LANÇAMENTO AVULSO DA CENTRAL FINANCEIRA (OPERACOES-01 F8, decisão 285) — o formulário de hoje no desenho novo.
 * Parceiro, empresa, emissão e competência, vencimento, valor; natureza, centro, safra e área num RATEIO EM R$ que
 * fecha no líquido; tipo de título, conta prevista, nº do documento, histórico; parcelar em N ou recorrência; "Já
 * pago" (baixa na hora pelo saldo) e anexos (sobem depois do título).
 *
 * A TOP PRIMEIRO (OPERACOES-01 F9, decisão 286): com `financeiroPelaTop` declarado e SÓ no lançamento novo, o primeiro
 * campo é o tipo de operação da família (conta a pagar ou a receber). Escolher a TOP aplica o tipo de título, a conta
 * prevista e a natureza e o centro da 1ª linha do rateio — só o que ela tem, sem apagar o resto do que o usuário
 * digitou —, e o corpo leva `tipo_operacao_id`. Com "o documento pode trocar os padrões" desligado, esses campos
 * travam (o servidor recusa a troca). Sem a capacidade, ou sem TOP escolhida, o corpo é o de HOJE, idêntico.
 *
 * TÍTULO GERADO POR DOCUMENTO (venda, compra, nota…), em edição: só vencimento, conta prevista e observação mudam — o
 * resto mostra o que a origem gravou, travado, e o pedido leva SÓ as três chaves (o servidor recusa o resto com 409).
 */
export function LancamentoAvulso({ dir, id }: { dir: Dir; id?: string }) {
  const c = dirCfg(dir); const router = useRouter(); const empresa = useEmpresaPadrao(); const qc = useQueryClient(); const { can } = useAuth();
  const existente = useDoc<Row & { apportionments: Row[] }>(`${c.endpoint}/${id}`, Boolean(id));
  const [h, setH] = React.useState<Cabecalho>(cabecalhoNovo);
  const [linhas, setLinhas] = React.useState<LinhaRateio[]>(() => [linhaDeRateioVazia()]);
  const [plan, setPlan] = React.useState<Plan>(defaultPlan());
  const [arquivos, setArquivos] = React.useState<File[]>([]);
  const chave = React.useRef(newIdem());
  // F9: a TOP do lançamento novo (só com a capacidade); a trava dos padrões quando ela não deixa trocar.
  const comTop = useFinanceiroPelaTop() && !id;
  const [top, setTop] = React.useState<TopFinanceira | null>(null);
  const trava = React.useMemo(() => travaDaTop(comTop ? top : null), [comTop, top]);
  const mudarLinhas = React.useCallback((ls: LinhaRateio[]) => setLinhas(linhasComATrava(ls, trava)), [trava]);
  const escolherTop = (t: TopFinanceira | null) => {
    setTop(t);
    if (!t) return;
    setH((o) => ({ ...o, title_type_id: t.padroes.tipoTitulo?.id ?? o.title_type_id, conta_prevista_id: t.padroes.conta?.id ?? o.conta_prevista_id }));
    setLinhas((ls) => linhasComATrava(primeiraLinhaComOsPadroes(ls, t), travaDaTop(t)));
  };
  React.useEffect(() => { setH((o) => ({ ...o, empresa_id: o.empresa_id || empresa })); }, [empresa]);
  React.useEffect(() => {
    const d = existente.data; if (!d) return;
    setH((o) => ({ ...o, empresa_id: texto(d["empresa_id"]), number: texto(d["number"]), person_id: texto(d["person_id"]), title_type_id: texto(d["title_type_id"]), conta_prevista_id: texto(d["conta_prevista_id"]),
      emission_date: data10(d["emission_date"]), data_competencia: data10(d["data_competencia"]), due_date: data10(d["due_date"]), amount: texto(d["amount"]), discount: texto(d["discount"] ?? "0"),
      payment_type: texto(d["payment_type"]), note: texto(d["note"]), document_type: texto(d["document_type"]), proprietary_id: texto(d["proprietary_id"]), classification: texto(d["classification"] ?? "unclassified"),
      is_deductible: Boolean(d["is_deductible"]), is_tax: Boolean(d["is_tax"]), appropriation: texto(d["appropriation"] ?? "direct"), appropriation_type: texto(d["appropriation_type"]) }));
    setLinhas(d.apportionments.map((a) => ({ financial_category_id: texto(a["financial_category_id"]), cost_center_id: texto(a["cost_center_id"]), harvest_id: texto(a["harvest_id"]), area_id: texto(a["area_id"]), amount: texto(a["amount"]) })));
  }, [existente.data]);

  const d = existente.data;
  const travadoPelaOrigem = Boolean(id && d?.["bloqueado_pela_origem"]);
  const origem = travadoPelaOrigem ? enumLabel("source_type", d?.["source_type"]) : null;
  const valor = lerDecimal(h.amount); const desconto = lerDecimal(h.discount || "0");
  const liquido = valor !== null && desconto !== null && valor.gt(0) && desconto.gte(0) && desconto.lte(valor) ? money(valor.minus(desconto)) : null;
  const rateio = situacaoDoRateio(liquido, linhas);
  const parcelado = h.payment_type === "installments"; const recorrente = h.payment_type === "recurring";
  const pendencia = travadoPelaOrigem
    ? (!h.due_date ? "Informe o vencimento." : !h.note.trim() ? "Informe a observação." : null)
    : !h.empresa_id ? "Escolha a empresa."
    : !h.number.trim() ? "Informe o nº do documento."
    : !h.person_id ? `Escolha o ${c.person.toLowerCase()}.`
    : liquido === null ? "Informe um valor positivo e um desconto entre zero e o valor."
    : !h.note.trim() ? "Informe a observação."
    : !rateio.fechado ? "Feche o rateio: natureza e centro em cada linha, e a soma igual ao valor líquido."
    : !id && h.ja_pago && !h.ja_pago_conta ? "Escolha a conta bancária da baixa."
    : null;

  const corpoNovo = () => ({
    empresa_id: h.empresa_id, number: h.number.trim(), title_type_id: h.title_type_id || null, proprietary_id: h.proprietary_id || null, person_id: h.person_id || null,
    payment_type: h.payment_type, recurrence_type: recorrente ? h.recurrence_type : null, recurrence_count: recorrente ? Number.parseInt(h.recurrence_count, 10) : undefined,
    classification: h.classification, document_type: h.document_type || null, is_deductible: h.is_deductible, is_tax: h.is_tax,
    amount: money(valor ?? D(0)), discount: money(desconto ?? D(0)), emission_date: h.emission_date, due_date: h.due_date, note: h.note,
    appropriation: h.appropriation, appropriation_type: h.appropriation === "indirect" ? h.appropriation_type || "indirect" : null,
    apportionment: rateioParaApi(linhas), plan: parcelado ? plan : null,
    auto_settle: h.ja_pago && h.ja_pago_conta ? { bank_account_id: h.ja_pago_conta, date: h.ja_pago_data } : null,
    data_competencia: h.data_competencia || null, conta_prevista_id: h.conta_prevista_id || null,
    // F9: a TOP escolhida (só no novo e com a capacidade); sem ela, a chave não existe — o corpo de hoje.
    ...(comTop && top ? { tipo_operacao_id: top.id } : {})
  });
  // Edição: os campos de hoje, sem forma de pagamento, plano, recorrência nem "já pago" (o servidor não os muda), com o
  // `version` lido — o título que mudou desde a abertura é recusado (409), nunca sobrescrito.
  const corpoEdicao = () => {
    const versao = { version: Number.parseInt(texto(d?.["version"]), 10) };
    if (travadoPelaOrigem) return { due_date: h.due_date, conta_prevista_id: h.conta_prevista_id || null, note: h.note, ...versao };
    const { payment_type: _forma, recurrence_type: _rec, recurrence_count: _qtd, plan: _plano, auto_settle: _auto, ...resto } = corpoNovo();
    return { ...resto, ...versao };
  };

  const criar = useMutation({
    mutationFn: async () => {
      const r = await api<{ id: string; ids: string[] }>(c.endpoint, { method: "POST", body: corpoNovo(), idempotencyKey: chave.current });
      return { r, falhas: await enviarAnexos(r.id, arquivos) };
    },
    onSuccess: ({ r, falhas }) => {
      toast.success("Salvo com sucesso");
      for (const f of falhas) toast.error(`O título foi salvo, mas o anexo ${f.nome} não subiu: ${f.erro}`);
      void qc.invalidateQueries(); router.push(`${c.base}/${r.id}`);
    },
    onError: (e) => { toast.error((e as Error).message); chave.current = newIdem(); }
  });
  const editar = useMutation({
    mutationFn: () => api(`${c.endpoint}/${id}`, { method: "PUT", body: corpoEdicao() }),
    onSuccess: () => { toast.success("Salvo com sucesso"); void qc.invalidateQueries(); router.push(`${c.base}/${id}`); },
    onError: (e) => toast.error((e as Error).message)
  });
  const ocupado = criar.isPending || editar.isPending;
  const travar = travadoPelaOrigem;

  return <Card data-testid="fin-lancamento"><CardHeader title={`${id ? "Editar" : "Novo"} título — ${c.title}`} actions={<>
    <Button variant="outline" size="sm" onClick={() => router.back()}>Voltar</Button>
    <Button size="sm" loading={ocupado} disabled={Boolean(pendencia)} title={pendencia ?? undefined} onClick={() => (id ? editar.mutate() : criar.mutate())}>Salvar</Button>
  </>} /><CardBody className="space-y-4">
    <LoadingOr q={{ isLoading: Boolean(id) && existente.isLoading, error: existente.error }}>
      {comTop && <div className="grid grid-cols-12 gap-3" data-testid="fin-lancamento-operacao">
        <SeletorDeTopFinanceira direcao={dir === "payable" ? "pagar" : "receber"} valor={top?.id ?? null} onChange={escolherTop} testId="fin-lancamento-top" />
      </div>}
      {travadoPelaOrigem && <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800" data-testid="fin-aviso-origem">Título gerado por {origem}: valor, parceiro e rateio mudam pela origem.</p>}
      <div className="grid grid-cols-12 gap-3">
        <Field label="Empresa" required span={3}><RefSelect resource="empresas" value={h.empresa_id} disabled={travar || Boolean(id)} onChange={(v) => setH({ ...h, empresa_id: v ?? "" })} /></Field>
        <Field label="Nº do documento" required span={2}><Input value={h.number} disabled={travar} maxLength={40} onChange={(e) => setH({ ...h, number: e.target.value })} /></Field>
        <Field label={c.person} required span={4}><RefSelect resource="people" value={h.person_id} disabled={travar} onChange={(v) => setH({ ...h, person_id: v ?? "" })} filter={c.personFilter} /></Field>
        <Field label="Tipo de título" span={3} help={trava.tipoTitulo ? "Padrão da operação: não muda neste lançamento" : undefined}><RefSelect resource="title_types" value={h.title_type_id} disabled={travar || Boolean(trava.tipoTitulo)} onChange={(v) => setH({ ...h, title_type_id: v ?? "" })} /></Field>
        <Field label="Emissão" required span={2}><Input type="date" value={h.emission_date} disabled={travar} onChange={(e) => setH({ ...h, emission_date: e.target.value })} /></Field>
        <Field label="Competência" span={2} help="Mês do resultado (DRE por competência); vazio = a emissão"><Input type="date" value={h.data_competencia} disabled={travar} onChange={(e) => setH({ ...h, data_competencia: e.target.value })} /></Field>
        <Field label="Vencimento" required span={2}><Input type="date" value={h.due_date} onChange={(e) => setH({ ...h, due_date: e.target.value })} /></Field>
        <Field label="Valor" required span={2}><Input type="number" step="0.01" min="0.01" value={h.amount} disabled={travar} onChange={(e) => setH({ ...h, amount: e.target.value })} /></Field>
        <Field label="Desconto" span={2}><Input type="number" step="0.01" min="0" value={h.discount} disabled={travar} onChange={(e) => setH({ ...h, discount: e.target.value })} /></Field>
        <Field label="Conta prevista" span={2} help={trava.conta ? "Padrão da operação: não muda neste lançamento" : "A conta por onde o título deve ser pago ou recebido (fluxo de caixa)"}><RefSelect resource="bank_accounts" value={h.conta_prevista_id} disabled={Boolean(trava.conta)} onChange={(v) => setH({ ...h, conta_prevista_id: v ?? "" })} /></Field>
        <Field label="Forma de pagamento" span={3}><NativeSelect value={h.payment_type} disabled={Boolean(id)} onChange={(e) => setH({ ...h, payment_type: e.target.value })}>
          {FORMAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          {!FORMAS.some(([v]) => v === h.payment_type) && <option value={h.payment_type}>{enumLabel("payment_type", h.payment_type)}</option>}
        </NativeSelect></Field>
        {recorrente && !id && <>
          <Field label="Recorrência" span={2}><NativeSelect value={h.recurrence_type} onChange={(e) => setH({ ...h, recurrence_type: e.target.value })}><option value="weekly">Semanal</option><option value="monthly">Mensal</option><option value="quarterly">Trimestral</option><option value="yearly">Anual</option></NativeSelect></Field>
          <Field label="Quantidade de ocorrências" span={2}><Input type="number" min={1} max={60} value={h.recurrence_count} onChange={(e) => setH({ ...h, recurrence_count: e.target.value })} /></Field>
        </>}
        <Field label="Observação" required span={12}><Textarea value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></Field>
      </div>

      {parcelado && !id && <><h3 className="text-xs font-semibold uppercase text-brand-700">Parcelamento</h3><PlanEditor plan={plan} onChange={setPlan} /></>}

      <h3 className="text-xs font-semibold uppercase text-brand-700">Classificação</h3>
      <div className="grid grid-cols-12 gap-3">
        <Field label="Tipo de documento" span={2}><NativeSelect value={h.document_type} disabled={travar} onChange={(e) => setH({ ...h, document_type: e.target.value })}><option value="">—</option>{TIPOS_DE_DOCUMENTO.map((x) => <option key={x} value={x}>{enumLabel("document_type", x)}</option>)}</NativeSelect></Field>
        <Field label="Proprietário gestor" span={3}><RefSelect resource="people" value={h.proprietary_id} disabled={travar} onChange={(v) => setH({ ...h, proprietary_id: v ?? "" })} filter={{ is_proprietary: "true" }} /></Field>
        <Field label="Classificação" span={2}><NativeSelect value={h.classification} disabled={travar} onChange={(e) => setH({ ...h, classification: e.target.value })}><option value="unclassified">Não classificado</option><option value="capex">CAPEX</option><option value="opex">OPEX</option></NativeSelect></Field>
        <Field label="Dedutível (IR)" span={1}><NativeSelect value={h.is_deductible ? "1" : "0"} disabled={travar} onChange={(e) => setH({ ...h, is_deductible: e.target.value === "1" })}><option value="0">Não</option><option value="1">Sim</option></NativeSelect></Field>
        <Field label="Tributo" span={1}><NativeSelect value={h.is_tax ? "1" : "0"} disabled={travar} onChange={(e) => setH({ ...h, is_tax: e.target.value === "1" })}><option value="0">Não</option><option value="1">Sim</option></NativeSelect></Field>
        <Field label="Apropriação" span={1}><NativeSelect value={h.appropriation} disabled={travar} onChange={(e) => setH({ ...h, appropriation: e.target.value })}><option value="direct">Direta</option><option value="indirect">Indireta</option></NativeSelect></Field>
        {h.appropriation === "indirect" && <Field label="Tipo de apropriação" span={2}><NativeSelect value={h.appropriation_type} disabled={travar} onChange={(e) => setH({ ...h, appropriation_type: e.target.value })}><option value="indirect">Indireta</option><option value="livestock">Pecuária</option><option value="area">Área</option><option value="maintenance">Manutenção</option><option value="fuel">Combustível</option></NativeSelect></Field>}
      </div>

      <h3 className="text-xs font-semibold uppercase text-brand-700">Rateio em R$ (natureza, centro de resultado, safra e área)</h3>
      {textoDoRateioTravado(trava) && <p className="text-[12px] text-amber-800" data-testid="fin-rateio-travado">{textoDoRateioTravado(trava)}</p>}
      <RateioEmReais total={liquido} linhas={linhas} onChange={mudarLinhas} desabilitado={travar} travados={{ natureza: Boolean(trava.natureza), centro: Boolean(trava.centro) }} />
      {!id && <>
        <h3 className="text-xs font-semibold uppercase text-brand-700">Já pago e anexos</h3>
        <div className="grid grid-cols-12 gap-3">
          <Field label="Já pago" span={2} help="Baixa o título na hora, pelo saldo, com um movimento na conta escolhida"><NativeSelect value={h.ja_pago ? "1" : "0"} onChange={(e) => setH({ ...h, ja_pago: e.target.value === "1" })}><option value="0">Não</option><option value="1">Sim (gera movimento bancário)</option></NativeSelect></Field>
          {h.ja_pago && <>
            <Field label="Conta da baixa" required span={4}><RefSelect resource="bank_accounts" value={h.ja_pago_conta} onChange={(v) => setH({ ...h, ja_pago_conta: v ?? "" })} /></Field>
            <Field label="Data da baixa" span={2}><Input type="date" value={h.ja_pago_data} onChange={(e) => setH({ ...h, ja_pago_data: e.target.value })} /></Field>
          </>}
          {can("attachments.create") && <Field label="Anexos" span={h.ja_pago ? 4 : 10} help="Os arquivos sobem depois de o título ser salvo (no primeiro título, quando parcelado ou recorrente)">
            <input type="file" multiple aria-label="Anexos do título" className="block w-full text-[12px]" data-testid="fin-lancamento-anexos" onChange={(e) => setArquivos(Array.from(e.target.files ?? []))} />
          </Field>}
        </div>
        {arquivos.length > 0 && <ul className="text-[12px] text-slate-600" data-testid="fin-lancamento-arquivos">{arquivos.map((f) => <li key={f.name}>{f.name}</li>)}</ul>}
      </>}
      {pendencia && <p className="text-[12px] text-slate-500" data-testid="fin-lancamento-pendencia">{pendencia}</p>}
    </LoadingOr>
  </CardBody></Card>;
}
