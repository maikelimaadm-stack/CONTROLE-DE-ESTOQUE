"use client";
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { api } from "@/lib/api";
import { Button, Dialog } from "@/components/ui";

interface ErroImportacao { linha: number; coluna: string | null; mensagem: string }
interface Resultado { linhas: number; gravadas: number; erros: ErroImportacao[]; simulacao: boolean }

const paraBase64 = (f: File) => new Promise<string>((ok, falha) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] ?? ""); r.onerror = () => falha(r.error); r.readAsDataURL(f); });

/**
 * Importar a partir do modelo: escolher o arquivo → PRÉVIA (o servidor processa tudo e desfaz) → importar.
 * O botão de importar só aparece com a prévia sem erro; o servidor confere de novo na hora de gravar.
 */
export function ImportDialog({ resourceKey, labelPlural, open, onOpenChange }: { resourceKey: string; labelPlural: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [arquivo, setArquivo] = React.useState<{ nome: string; base64: string } | null>(null);
  const [previa, setPrevia] = React.useState<Resultado | null>(null);
  const [ocupado, setOcupado] = React.useState(false);
  React.useEffect(() => { if (!open) { setArquivo(null); setPrevia(null); } }, [open]);
  const enviar = async (simular: boolean, a = arquivo) => {
    if (!a) return;
    setOcupado(true);
    try {
      const res = await api<Response>(`/api/imports/${resourceKey}?simular=${simular ? 1 : 0}`, { method: "POST", body: { arquivo_base64: a.base64 }, raw: true });
      const corpo = (await res.json()) as Resultado & { error?: { message?: string } };
      if (corpo.error) { toast.error(corpo.error.message ?? "Falha na importação"); return; }
      if (simular || corpo.erros.length) { setPrevia(corpo); return; }
      toast.success(`${corpo.gravadas} registro(s) importado(s)`);
      void qc.invalidateQueries({ queryKey: ["b1", resourceKey] });
      onOpenChange(false);
    } finally { setOcupado(false); }
  };
  const escolher = async (f: File | undefined) => { if (!f) return; const a = { nome: f.name, base64: await paraBase64(f) }; setArquivo(a); setPrevia(null); await enviar(true, a); };
  const semErro = previa && !previa.erros.length && previa.linhas > 0;
  return <Dialog open={open} onOpenChange={onOpenChange} size="lg" title={`Importar ${labelPlural.toLowerCase()}`} description="Use o modelo baixado nesta tela. Nada é gravado se houver qualquer erro." testId="importar-dialogo"
    footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>{semErro && <Button loading={ocupado} data-testid="importar-confirmar" onClick={() => void enviar(false)}>Importar {previa.linhas} registro(s)</Button>}</>}>
    <div className="space-y-3">
      <input type="file" accept=".xlsx" data-testid="importar-arquivo" aria-label="Arquivo XLSX" onChange={(e) => void escolher(e.target.files?.[0])} />
      {ocupado && !previa && <p className="text-sm text-slate-500">Conferindo o arquivo…</p>}
      {previa && <div data-testid="importar-previa">
        <p className="text-sm">{arquivo?.nome}: <b>{previa.linhas}</b> linha(s) preenchida(s), {previa.erros.length ? <b className="text-red-600">{previa.erros.length} erro(s) — nada será gravado</b> : <b className="text-green-700">nenhum erro</b>}.</p>
        {previa.erros.length > 0 && <div className="mt-2 max-h-80 overflow-auto rounded border"><table className="w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="px-2 py-1">Linha</th><th className="px-2 py-1">Coluna</th><th className="px-2 py-1">Problema</th></tr></thead>
          <tbody>{previa.erros.map((e, i) => <tr key={i} className="border-t"><td className="px-2 py-1">{e.linha || "—"}</td><td className="px-2 py-1">{e.coluna ?? "—"}</td><td className="px-2 py-1">{e.mensagem}</td></tr>)}</tbody></table></div>}
      </div>}
    </div>
  </Dialog>;
}
