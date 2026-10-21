"use client";
import * as React from "react";
import { FileUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";
import { Button, Dialog, Field, NativeSelect } from "@/components/ui";
import { useChaveDeIdempotencia } from "../pedido-e-orcamento";
import { useTopsDaEspecie, varianteDeCompra } from "../variantes";
import {
  ARQUIVO_MAXIMO_BYTES, arquivoEmBase64, candidatasDoDestinatario, idDaCompraPeloCodigo, importacaoPendenteDoConflito, importarArquivo,
  lerConferencia, notaJaLancadaDoConflito, recusasNoCampo, rotaDaConferencia
} from "./api";

/** Chave da TOP escolhida ANTES do upload — a conferência a lê e a mantém (decisão 324). */
export const CHAVE_TOP_PRE_UPLOAD = "compras.importacao.topPreUpload";

/**
 * O DIÁLOGO "IMPORTAR XML DE NOTA DE COMPRA" (OPERACOES-01 F7, decisão 284) — aberto pelo botão dos Documentos de
 * Compras (ou por `?importar=xml`, vindo da solicitação de compra). O arquivo (XML, ou ZIP com um único XML) vai em
 * base64, como veio: quem lê a nota, confere o protocolo, a chave e o destinatário, e guarda o original é o SERVIDOR.
 *
 * Visual: mesma família do sistema (dialog + zona de arquivo + alertas densos) — sem wizard Base44 nem parser no cliente.
 *
 *   201 → a conferência (`/compras/importacoes/<id>`, levando a solicitação quando houver);
 *   422 → as recusas, uma por linha (`importacao-recusa`); o destinatário que corresponde a mais de uma empresa pede a
 *         escolha da empresa (`importacao-empresa`, só as do escopo que o servidor mandou) e o reenvio;
 *   409 → a importação PENDENTE da mesma nota abre a pendente; a nota já lançada mostra onde (e abre a Compra).
 *
 * A chave de idempotência é a MESMA até o servidor RECUSAR (`useChaveDeIdempotencia`): na queda de rede o reenvio
 * recebe a resposta gravada, nunca uma segunda importação.
 */

interface Conflito { mensagem: string; compra: string | null }

function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DialogoImportarXml({ aberto, onFechar, solicitacaoId }: { aberto: boolean; onFechar: () => void; solicitacaoId: string | null }) {
  const router = useRouter();
  const chave = useChaveDeIdempotencia();
  const segmentoCompra = varianteDeCompra("compra")?.segmento ?? "compras";
  const tops = useTopsDaEspecie(segmentoCompra);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  const [arrastando, setArrastando] = React.useState(false);
  const [recusas, setRecusas] = React.useState<string[]>([]);
  const [candidatas, setCandidatas] = React.useState<{ id: string; nome: string }[] | null>(null);
  const [empresaId, setEmpresaId] = React.useState("");
  const [topId, setTopId] = React.useState("");
  const [conflito, setConflito] = React.useState<Conflito | null>(null);
  const [enviando, setEnviando] = React.useState(false);
  const [abrindoCompra, setAbrindoCompra] = React.useState(false);

  React.useEffect(() => {
    if (!aberto || tops.situacao !== "pronto") return;
    setTopId((atual) => {
      if (atual && tops.dados.items.some((t) => t.id === atual)) return atual;
      return tops.dados.defaultId ?? "";
    });
  }, [aberto, tops]);

  const limpar = () => { setRecusas([]); setConflito(null); };
  const escolherArquivo = (f: File | null) => {
    setArquivo(f); limpar(); setCandidatas(null); setEmpresaId("");
    if (f && f.size > ARQUIVO_MAXIMO_BYTES) setRecusas(["Arquivo maior que 3 MB."]);
  };

  const enviar = async () => {
    if (!arquivo || enviando) return;
    if (arquivo.size > ARQUIVO_MAXIMO_BYTES) { setRecusas(["Arquivo maior que 3 MB."]); return; }
    if (!topId) { setRecusas(["Escolha a TOP de compra antes de enviar o XML."]); return; }
    if (candidatas && !empresaId) { setRecusas(["Escolha a empresa da compra."]); return; }
    limpar();
    setEnviando(true);
    try {
      const arquivoBase64 = await arquivoEmBase64(arquivo);
      const corpo = { nome_arquivo: arquivo.name.slice(0, 255) || "nota.xml", arquivo_base64: arquivoBase64, ...(empresaId ? { empresa_id: empresaId } : {}) };
      const r = await importarArquivo(corpo, chave.doEnvio(corpo));
      const conf = lerConferencia(r);
      if (!conf) { setRecusas(["A resposta do servidor não é a conferência que esta tela sabe ler."]); return; }
      try { sessionStorage.setItem(CHAVE_TOP_PRE_UPLOAD, topId); } catch { /* sessão sem storage */ }
      router.push(rotaDaConferencia(conf.id, solicitacaoId));
    } catch (e) {
      const mensagem = chave.depoisDoErro(e);
      const pendente = importacaoPendenteDoConflito(e);
      if (pendente) {
        toast.info(e instanceof Error ? e.message : "Esta nota já tem uma importação pendente.");
        router.push(rotaDaConferencia(pendente, solicitacaoId));
        return;
      }
      const lancada = notaJaLancadaDoConflito(e);
      if (lancada || (e instanceof ApiError && e.status === 409)) {
        setConflito({ mensagem, compra: lancada?.onde === "compra" ? lancada.codigo : null });
        return;
      }
      const empresas = candidatasDoDestinatario(e);
      if (empresas) {
        setCandidatas(empresas);
        setEmpresaId((atual) => (empresas.some((x) => x.id === atual) ? atual : ""));
        setRecusas([mensagem]);
        return;
      }
      const doCampo = recusasNoCampo(e).map((x) => x.message);
      setRecusas(doCampo.length ? doCampo : [mensagem]);
    } finally {
      setEnviando(false);
    }
  };

  const abrirCompra = async (codigo: string) => {
    setAbrindoCompra(true);
    try {
      const id = await idDaCompraPeloCodigo(codigo);
      if (id) router.push(`/compras/compras/${id}`);
      else toast.error(`A Compra ${codigo} não está visível na empresa selecionada.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setAbrindoCompra(false);
    }
  };

  const fechar = (o: boolean) => {
    if (o || enviando) return;
    setArquivo(null); limpar(); setCandidatas(null); setEmpresaId(""); setTopId(""); setArrastando(false);
    if (inputRef.current) inputRef.current.value = "";
    onFechar();
  };

  const soltar = (ev: React.DragEvent) => {
    ev.preventDefault();
    setArrastando(false);
    if (enviando) return;
    const f = ev.dataTransfer.files?.[0] ?? null;
    if (!f) return;
    const nome = f.name.toLowerCase();
    if (!nome.endsWith(".xml") && !nome.endsWith(".zip")) {
      setRecusas(["Envie um arquivo .xml ou .zip."]);
      setArquivo(null);
      return;
    }
    escolherArquivo(f);
  };

  const topsProntas = tops.situacao === "pronto";
  return <Dialog open={aberto} onOpenChange={fechar} title="Importar XML de nota de compra" size="md" testId="importacao-upload" preventClose={enviando}
    footer={<>
      <Button variant="outline" onClick={() => fechar(false)} disabled={enviando}>Fechar</Button>
      <Button data-testid="importacao-enviar" loading={enviando}
        disabled={!arquivo || !topId || (candidatas !== null && !empresaId)}
        onClick={() => void enviar()}>Enviar e conferir</Button>
    </>}>
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-600">Escolha a TOP de compra, envie o XML e confira. O servidor só lê e guarda a NF-e — nada é lançado até você gerar a compra.</p>
      {solicitacaoId && <p className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-[12.5px] text-sky-900" data-testid="importacao-upload-solicitacao">A compra gerada fica vinculada à solicitação de compra de origem.</p>}

      <Field label="TOP de compra" span={12} required>
        {topsProntas
          ? <NativeSelect data-testid="importacao-top-upload" value={topId} disabled={enviando}
              onChange={(ev) => { setTopId(ev.target.value); setRecusas([]); }}>
              <option value="">Escolha a TOP</option>
              {tops.dados.items.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
            </NativeSelect>
          : <span className="text-xs text-slate-500" data-testid="importacao-top-upload-indisponivel">
              {tops.situacao === "carregando" ? "Carregando as TOPs de compra…"
                : tops.situacao === "sem-top" ? "Nenhuma TOP de compra ativa: configure uma TOP de compra."
                  : "As TOPs de compra não puderam ser lidas."}
            </span>}
      </Field>

      <Field label="Arquivo da nota (XML ou ZIP)" span={12}>
        <div
          data-testid="importacao-zona-arquivo"
          data-arrastando={arrastando ? "sim" : "nao"}
          data-com-arquivo={arquivo ? "sim" : "nao"}
          onDragEnter={(ev) => { ev.preventDefault(); if (!enviando) setArrastando(true); }}
          onDragOver={(ev) => { ev.preventDefault(); if (!enviando) setArrastando(true); }}
          onDragLeave={(ev) => { ev.preventDefault(); setArrastando(false); }}
          onDrop={soltar}
          className={`relative flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors ${
            arrastando ? "border-brand-500 bg-brand-50" : arquivo ? "border-slate-300 bg-slate-50" : "border-slate-300 bg-white hover:border-brand-400 hover:bg-slate-50"
          } ${enviando ? "pointer-events-none opacity-60" : "cursor-pointer"}`}
          onClick={() => { if (!enviando) inputRef.current?.click(); }}
          onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); if (!enviando) inputRef.current?.click(); } }}
          role="button"
          tabIndex={enviando ? -1 : 0}
          aria-label="Escolher arquivo XML ou ZIP da nota"
        >
          <FileUp className={`h-8 w-8 ${arrastando ? "text-brand-600" : "text-slate-400"}`} aria-hidden />
          {arquivo ? (
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-sm font-medium text-slate-800" data-testid="importacao-arquivo-nome">{arquivo.name}</span>
              <span className="text-[12px] text-slate-500" data-testid="importacao-arquivo-tamanho">{tamanhoLegivel(arquivo.size)} · clique para trocar</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-sm font-medium text-slate-700">Arraste o XML aqui ou clique para escolher</span>
              <span className="text-[12px] text-slate-500">XML da NF-e ou ZIP com um único XML · até 3 MB</span>
            </div>
          )}
          <input
            ref={inputRef}
            data-testid="importacao-arquivo"
            type="file"
            accept=".xml,.zip"
            className="sr-only"
            disabled={enviando}
            onChange={(ev) => {
              escolherArquivo(ev.target.files?.[0] ?? null);
              ev.currentTarget.value = "";
            }}
          />
        </div>
      </Field>

      {candidatas && <Field label="Empresa da compra" span={12} required>
        <NativeSelect data-testid="importacao-empresa" value={empresaId} onChange={(ev) => { setEmpresaId(ev.target.value); setRecusas([]); }} disabled={enviando}>
          <option value="">Escolha a empresa</option>
          {candidatas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </NativeSelect>
      </Field>}

      {recusas.length > 0 && <ul data-testid="importacao-recusas" className="list-disc rounded border border-red-200 bg-red-50 py-2 pl-6 pr-3 text-[12.5px] text-red-800">
        {recusas.map((m, k) => <li key={k} data-testid="importacao-recusa">{m}</li>)}
      </ul>}
      {conflito && <div data-testid="importacao-conflito" className="flex flex-col gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
        <span>{conflito.mensagem}</span>
        {conflito.compra && <Button size="sm" variant="outline" className="self-start" data-testid="importacao-abrir-compra" loading={abrindoCompra} onClick={() => void abrirCompra(conflito.compra!)}>Abrir a Compra {conflito.compra}</Button>}
      </div>}
    </div>
  </Dialog>;
}
