"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { api, qs, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, dateBR } from "@/lib/utils";
import { Card, CardHeader, CardBody, Button, Dialog, Field, Input, NativeSelect, Badge } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { RefSelect } from "@/components/ui/ref-select";
import { FilterBar, useFilters, type Row } from "@/features/docs/shared";
import { parseNfeXml } from "@/features/docs/nfe-xml";
import { enumLabel, enumOptions } from "@/lib/copy";
import { useImportacaoXml } from "@/features/compras/importacao/capacidade";
import { importacaoPendenteDoConflito, importarDaDfe, lerConferencia, rotaDaConferencia } from "@/features/compras/importacao/api";
import { novaChaveDeIdempotencia, type ChaveDeIdempotencia } from "@/features/compras/pedido-e-orcamento";

/**
 * OPERACOES-01 F7 (decisão 284): o maior XML que o servidor guarda (2 MB, o limite do corpo `xml` de `POST /stock/dfe`).
 * O XML escolhido no diálogo vai INTEIRO no corpo (`xml`) SÓ com a capacidade `importacaoXml` "sim" (a API que o lê e
 * guarda); sem ela, o diálogo é o de hoje (o XML só pré-preenche, nada a mais no corpo). Com o `xml`, o servidor lê a
 * nota, confere os campos enviados contra ela, resolve a empresa destinatária e guarda o original (`xml_id` na DF-e).
 * A leitura que o servidor RECUSA (devolução, sem protocolo, homologação, destinatário fora do escopo…) não prende a
 * pessoa: a recusa aparece no diálogo com "Registrar sem guardar o XML" — o registro de hoje, por escolha dela.
 */
const XML_MAXIMO_CARACTERES = 2_097_152;

/** O texto do arquivo XML na codificação que ele declara (ISO-8859-1 ou, como padrão, UTF-8). */
async function textoDoArquivoXml(arquivo: File): Promise<string> {
  const bytes = await arquivo.arrayBuffer();
  const inicio = new TextDecoder("utf-8").decode(bytes.slice(0, 256));
  const latin1 = /^\s*<\?xml[^>]*encoding\s*=\s*["']iso-8859-1["']/i.test(inicio.replace(/^\uFEFF/, ""));
  return new TextDecoder(latin1 ? "iso-8859-1" : "utf-8").decode(bytes).replace(/^\uFEFF/, "");
}

export function DfeQueue() {
  const { can } = useAuth(); const qc = useQueryClient(); const { f, set, reset } = useFilters({}); const [applied, setApplied] = React.useState({}); const [page, setPage] = React.useState(1);
  const [open, setOpen] = React.useState(false); const [v, setV] = React.useState({ empresa_id: "", access_key: "", document_type: "nfe", number: "", series: "", issuer_document: "", issuer_name: "", emission_date: "", total: "" });
  const [manifest, setManifest] = React.useState<{ id: string; status: string } | null>(null);
  const [xml, setXml] = React.useState<string | null>(null);
  const [recusaDoXml, setRecusaDoXml] = React.useState<string | null>(null);
  const router = useRouter();
  // O XML vai no corpo só com a capacidade declarada (a mesma pergunta da Central de Compras; sem ela, o de hoje).
  const guardaXml = useImportacaoXml(can("dfe.create")) === "sim";
  // "Lançar" pela importação na Central de Compras: dfe.launch ∧ compras.create ∧ a capacidade ∧ o XML guardado na linha.
  const importacao = useImportacaoXml(can("dfe.launch"));
  const lancaPelaImportacao = (r: Row) => can("dfe.launch") && can("compras.create") && importacao === "sim" && typeof r["xml_id"] === "string" && Boolean(r["xml_id"]);
  // Uma chave de idempotência por DF-e (a mesma até o servidor recusar: o reenvio na queda de rede não importa duas vezes).
  const chaves = React.useRef(new Map<string, ChaveDeIdempotencia>());
  const [lancando, setLancando] = React.useState<string | null>(null);
  const lancar = async (dfeId: string) => {
    if (lancando) return;
    const chave = chaves.current.get(dfeId) ?? novaChaveDeIdempotencia();
    chaves.current.set(dfeId, chave);
    setLancando(dfeId);
    try {
      const conf = lerConferencia(await importarDaDfe(dfeId, chave.doEnvio({ dfeId })));
      if (!conf) { toast.error("A resposta do servidor não é a conferência que esta tela sabe ler."); return; }
      router.push(rotaDaConferencia(conf.id));
    } catch (e) {
      const mensagem = chave.depoisDoErro(e);
      const pendente = importacaoPendenteDoConflito(e);
      if (pendente) { toast.info(mensagem); router.push(rotaDaConferencia(pendente)); return; }
      toast.error(mensagem);
    } finally {
      setLancando(null);
    }
  };
  const q = useQuery({ queryKey: ["dfe", applied, page], queryFn: () => api<{ items: Row[]; total: number }>(`/api/stock/dfe${qs({ ...applied, page, pageSize: 30 })}`) });
  const fecharRegistro = () => { setOpen(false); setXml(null); setRecusaDoXml(null); };
  const reg = useMutation({
    mutationFn: (o: { comXml: boolean }) => api("/api/stock/dfe", { method: "POST", body: { ...v, empresa_id: v.empresa_id || null, number: v.number || null, series: v.series || null, issuer_document: v.issuer_document || null, issuer_name: v.issuer_name || null, emission_date: v.emission_date || null, total: v.total || null, ...(o.comXml && xml && guardaXml ? { xml } : {}) } }),
    onSuccess: () => { toast.success("DFe registrada"); fecharRegistro(); void qc.invalidateQueries({ queryKey: ["dfe"] }); },
    onError: (e, o) => {
      // A recusa COM o XML (422): fica no diálogo, com a saída de registrar sem guardar o arquivo.
      if (o.comXml && xml && guardaXml && e instanceof ApiError && e.status === 422) setRecusaDoXml(e.message);
      toast.error((e as Error).message);
    }
  });
  const man = useMutation({ mutationFn: (m: { id: string; status: string }) => api(`/api/stock/dfe/${m.id}/manifest`, { method: "POST", body: { status: m.status } }), onSuccess: () => { toast.success("Manifestação registrada"); setManifest(null); void qc.invalidateQueries({ queryKey: ["dfe"] }); } });
  const ign = useMutation({ mutationFn: (id: string) => api(`/api/stock/dfe/${id}/ignore`, { method: "POST" }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["dfe"] }) });
  const onXml = async (file: File) => {
    const texto = await textoDoArquivoXml(file);
    setRecusaDoXml(null);
    const p = parseNfeXml(texto); if (!p) { toast.error("XML inválido"); setXml(null); return; }
    setV({ ...v, access_key: p.accessKey, number: p.number, series: p.series, issuer_document: p.issuerDocument, issuer_name: p.issuerName, emission_date: p.emissionDate, total: p.total });
    // O texto fica guardado na tela; vai no corpo SÓ com a capacidade (decidido no envio — a pergunta pode chegar depois).
    if (texto.length > XML_MAXIMO_CARACTERES) { setXml(null); toast.warning("O XML passa de 2 MB: a DF-e é registrada sem guardar o arquivo."); } else setXml(texto);
  };
  return <Card><CardHeader title="DFe Recebidas" subtitle="Documentos fiscais eletrônicos recebidos. A captura automática na SEFAZ depende de certificado digital (integração futura); XMLs podem ser importados manualmente." actions={<>{can("dfe.create") && <Button size="sm" onClick={() => setOpen(true)}>Importar DFe</Button>}<Link href="/estoque?tab=entradas&sub=conferencia"><Button size="sm" variant="outline">Aprovação de notas</Button></Link></>} /><CardBody>
    <FilterBar filters={[{ name: "search", label: "Chave/Emitente/Número", type: "text" }, { name: "launch_status", label: "Lançamento", type: "select", options: enumOptions("launch_status") }, { name: "manifest_status", label: "Manifestação", type: "select", options: enumOptions("manifest_status") }]} f={f} set={set} reset={() => { reset(); setApplied({}); }} onApply={() => { setApplied({ ...f }); setPage(1); }} />
    <DataTable rows={q.data?.items ?? []} total={q.data?.total} page={page} pageSize={30} onPage={setPage} loading={q.isLoading} columns={[{ key: "access_key", label: "Chave", render: (r) => <span className="font-mono text-[11px]">{String(r["access_key"])}</span> }, { key: "number", label: "Nº" }, { key: "issuer_name", label: "Emitente" }, { key: "emission_date", label: "Emissão", render: (r) => dateBR(r["emission_date"] as string) }, { key: "total", label: "Total", align: "right", render: (r) => brl(r["total"] as string) }, { key: "manifest_status", label: "Manifestação", render: (r) => enumLabel("manifest_status", r["manifest_status"]) }, { key: "launch_status", label: "Lançamento", render: (r) => <Badge tone={r["launch_status"] === "launched" ? "green" : r["launch_status"] === "ignored" ? "slate" : "amber"}>{enumLabel("launch_status", r["launch_status"])}</Badge> }]}
      actions={(r) => <div className="flex justify-end gap-1">{can("dfe.manifest") && <Button size="sm" variant="ghost" onClick={() => setManifest({ id: String(r["id"]), status: "confirmed" })}>Manifestar</Button>}{can("dfe.launch") && r["launch_status"] !== "launched" && (lancaPelaImportacao(r)
        ? <Button size="sm" variant="ghost" data-testid="dfe-lancar-importacao" loading={lancando === String(r["id"])} onClick={() => void lancar(String(r["id"]))}>Lançar</Button>
        : <Link href={`/estoque/documentos-fiscais/new?dfe_id=${r["id"]}`}><Button size="sm" variant="ghost">Lançar</Button></Link>)}{can("dfe_drafts.ignore") && r["launch_status"] !== "launched" && <Button size="sm" variant="ghost" onClick={() => ign.mutate(String(r["id"]))}>Ignorar</Button>}</div>} />
    <Dialog open={open} onOpenChange={(o) => { if (o) setOpen(true); else fecharRegistro(); }} title="Registrar DFe recebida" footer={<><Button variant="outline" onClick={fecharRegistro}>Cancelar</Button><Button loading={reg.isPending} onClick={() => reg.mutate({ comXml: true })}>Salvar</Button></>}>
      <div className="mb-3 rounded border border-dashed p-2 text-xs">Importar XML: <input type="file" accept=".xml" onChange={(e) => e.target.files?.[0] && onXml(e.target.files[0])} />{xml && guardaXml && !recusaDoXml && <span className="ml-2 text-slate-500" data-testid="dfe-xml-anexado">o XML vai junto e fica guardado</span>}</div>
      {recusaDoXml && <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" data-testid="dfe-xml-recusado">
        <p>O servidor não aceitou o XML: {recusaDoXml}</p>
        <p className="mt-1">Você pode registrar a DF-e com os dados acima, sem guardar o arquivo.</p>
        <Button size="sm" variant="outline" className="mt-2" data-testid="dfe-registrar-sem-xml" loading={reg.isPending} onClick={() => reg.mutate({ comXml: false })}>Registrar sem guardar o XML</Button>
      </div>}
      <div className="grid grid-cols-12 gap-3">
        <Field label="Chave de acesso (44 dígitos)" required span={12}><Input maxLength={44} value={v.access_key} onChange={(e) => setV({ ...v, access_key: e.target.value })} /></Field>
        <Field label="Tipo" span={3}><NativeSelect value={v.document_type} onChange={(e) => setV({ ...v, document_type: e.target.value })}><option value="nfe">NFe</option><option value="cte">CTe</option><option value="nfse">NFSe</option></NativeSelect></Field>
        <Field label="Número" span={3}><Input value={v.number} onChange={(e) => setV({ ...v, number: e.target.value })} /></Field><Field label="Série" span={2}><Input value={v.series} onChange={(e) => setV({ ...v, series: e.target.value })} /></Field><Field label="Emissão" span={4}><Input type="date" value={v.emission_date} onChange={(e) => setV({ ...v, emission_date: e.target.value })} /></Field>
        <Field label="CNPJ emitente" span={4}><Input value={v.issuer_document} onChange={(e) => setV({ ...v, issuer_document: e.target.value })} /></Field><Field label="Emitente" span={5}><Input value={v.issuer_name} onChange={(e) => setV({ ...v, issuer_name: e.target.value })} /></Field><Field label="Total" span={3}><Input type="number" step="0.01" value={v.total} onChange={(e) => setV({ ...v, total: e.target.value })} /></Field>
        <Field label="Empresa" span={6}><RefSelect resource="empresas" value={v.empresa_id} onChange={(x) => setV({ ...v, empresa_id: x ?? "" })} /></Field>
      </div>
    </Dialog>
    <Dialog open={Boolean(manifest)} onOpenChange={() => setManifest(null)} title="Manifestar documento" size="sm" footer={<><Button variant="outline" onClick={() => setManifest(null)}>Fechar</Button><Button loading={man.isPending} onClick={() => manifest && man.mutate(manifest)}>Salvar</Button></>}>
      <Field label="Tipo de manifestação"><NativeSelect value={manifest?.status ?? "confirmed"} onChange={(e) => setManifest((m) => (m ? { ...m, status: e.target.value } : m))}><option value="awareness">Ciência da operação</option><option value="confirmed">Confirmação da operação</option><option value="unknown">Desconhecimento</option><option value="not_performed">Operação não realizada</option></NativeSelect></Field>
      <p className="mt-2 text-xs text-slate-500">A transmissão do evento à SEFAZ exige certificado digital (integração futura); aqui registramos a manifestação para controle interno.</p>
    </Dialog>
  </CardBody></Card>;
}
