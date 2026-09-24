"use client";
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { api, encerrarSessaoExpirada } from "@/lib/api";
import { Button, Dialog } from "@/components/ui";

interface ErroImportacao { linha: number; coluna: string | null; mensagem: string }
interface Resultado { linhas: number; gravadas: number; erros: ErroImportacao[]; simulacao: boolean }
type Resposta = Partial<Resultado> & { error?: { message?: string } };

/** Mesmo teto da rota `/imports` no servidor: acima disso o arquivo nem é enviado. */
const ARQUIVO_MAXIMO = 8 * 1024 * 1024;

const paraBase64 = (f: File) => new Promise<string>((ok, falha) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] ?? ""); r.onerror = () => falha(r.error); r.readAsDataURL(f); });
/** Corpo sem a forma do resultado (JSON de outra coisa vindo de um proxy) é falha, não prévia. */
const ehResultado = (c: Resposta): c is Resposta & Resultado => Array.isArray(c.erros) && typeof c.linhas === "number" && typeof c.gravadas === "number";

/**
 * Importar a partir do modelo: escolher o arquivo → PRÉVIA (o servidor processa tudo e desfaz) → importar.
 * O botão de importar só aparece com a prévia sem erro; o servidor confere de novo na hora de gravar.
 * Todo desfecho que não é uma prévia nova APAGA a anterior: o botão nunca fica valendo para um estado velho.
 */
export function ImportDialog({ resourceKey, labelPlural, open, onOpenChange, avisoFiltro }: { resourceKey: string; labelPlural: string; open: boolean; onOpenChange: (o: boolean) => void; /** lista com filtro fixo: o que a planilha precisa preencher para o registro aparecer nela */ avisoFiltro?: string }) {
  const qc = useQueryClient();
  const [arquivo, setArquivo] = React.useState<{ nome: string; base64: string } | null>(null);
  const [previa, setPrevia] = React.useState<Resultado | null>(null);
  const [ocupado, setOcupado] = React.useState(false);
  React.useEffect(() => { if (!open) { setArquivo(null); setPrevia(null); } }, [open]);
  const descartar = () => { setPrevia(null); setArquivo(null); };
  const enviar = async (simular: boolean, a = arquivo) => {
    if (!a) return;
    // falha de rede ou resposta ilegível (502 em HTML): na gravação o efeito é desconhecido, então a listagem recarrega
    const falhou = () => {
      descartar();
      if (simular) { toast.error("Não foi possível conferir o arquivo. Tente de novo."); return; }
      toast.error("Não foi possível confirmar a importação. Confira a listagem antes de tentar de novo.");
      void qc.invalidateQueries({ queryKey: ["b1", resourceKey] });
    };
    setOcupado(true);
    try {
      let corpo: Resposta;
      try {
        const res = await api<Response>(`/api/imports/${resourceKey}?simular=${simular ? 1 : 0}`, { method: "POST", body: { arquivo_base64: a.base64 }, raw: true });
        // `raw` escapa do tratamento de sessão de `api()`: a sessão expirada termina aqui do mesmo jeito
        if (res.status === 401) { descartar(); encerrarSessaoExpirada(); return; }
        corpo = (await res.json()) as Resposta;
      } catch { falhou(); return; }
      if (corpo.error) { descartar(); toast.error(corpo.error.message ?? "Falha na importação"); return; }
      if (!ehResultado(corpo)) { falhou(); return; }
      if (simular || corpo.erros.length) { setPrevia(corpo); return; }
      toast.success(`${corpo.gravadas} registro(s) importado(s)`);
      void qc.invalidateQueries({ queryKey: ["b1", resourceKey] });
      onOpenChange(false);
    } finally { setOcupado(false); }
  };
  const escolher = async (f: File | undefined) => {
    if (!f) return;
    descartar();
    if (f.size > ARQUIVO_MAXIMO) { toast.error("Arquivo maior que 8 MB. Divida em arquivos menores."); return; }
    let a: { nome: string; base64: string };
    try { a = { nome: f.name, base64: await paraBase64(f) }; } catch { toast.error("Não foi possível conferir o arquivo. Tente de novo."); return; }
    setArquivo(a); await enviar(true, a);
  };
  const semErro = previa && !previa.erros.length && previa.linhas > 0;
  return <Dialog open={open} onOpenChange={onOpenChange} size="lg" title={`Importar ${labelPlural.toLowerCase()}`} description="Use o modelo baixado nesta tela. Nada é gravado se houver qualquer erro." testId="importar-dialogo"
    footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>{semErro && <Button loading={ocupado} data-testid="importar-confirmar" onClick={() => void enviar(false)}>Importar {previa.linhas} registro(s)</Button>}</>}>
    <div className="space-y-3">
      {avisoFiltro && <p data-testid="importar-aviso-filtro" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">{avisoFiltro}</p>}
      {/* o valor é zerado a cada escolha: reescolher o MESMO arquivo depois de corrigi-lo gera nova prévia */}
      <input type="file" accept=".xlsx" data-testid="importar-arquivo" aria-label="Arquivo XLSX" onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; void escolher(f); }} />
      {ocupado && !previa && <p className="text-sm text-slate-500">Conferindo o arquivo…</p>}
      {previa && <div data-testid="importar-previa">
        <p className="text-sm">{arquivo?.nome}: <b>{previa.linhas}</b> linha(s) preenchida(s), {previa.erros.length ? <b className="text-red-600">{previa.erros.length} erro(s) — nada será gravado</b> : <b className="text-green-700">nenhum erro</b>}.</p>
        {previa.erros.length > 0 && <div className="mt-2 max-h-80 overflow-auto rounded border"><table className="w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="px-2 py-1">Linha</th><th className="px-2 py-1">Coluna</th><th className="px-2 py-1">Problema</th></tr></thead>
          <tbody>{previa.erros.map((e, i) => <tr key={i} className="border-t"><td className="px-2 py-1">{e.linha || "—"}</td><td className="px-2 py-1">{e.coluna ?? "—"}</td><td className="px-2 py-1">{e.mensagem}</td></tr>)}</tbody></table></div>}
      </div>}
    </div>
  </Dialog>;
}
