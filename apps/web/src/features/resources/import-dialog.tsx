"use client";
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { api, encerrarSessaoExpirada } from "@/lib/api";
import { Button, Dialog } from "@/components/ui";

interface ErroImportacao { linha: number; coluna: string | null; mensagem: string }
/**
 * Campos novos da Fase 2 (`modo`, `certas`, `com_erro`, `planilha_erros_base64`) são OPCIONAIS aqui: a API anterior
 * não os manda, e a tela continua funcionando com ela (prévia e "Importar tudo" não enviam `modo`).
 */
interface Resultado { linhas: number; gravadas: number; erros: ErroImportacao[]; simulacao: boolean; modo?: "tudo" | "parcial"; certas?: number; com_erro?: number; planilha_erros_base64?: string | null }
type Resposta = Partial<Resultado> & { error?: { code?: string; message?: string; details?: unknown } };
type Modo = "tudo" | "parcial";

/** A API anterior recusa `modo` como parâmetro desconhecido (query estrita): 422 "Campo não reconhecido". */
const ehRecusaDeModo = (c: Resposta) => c.error?.code === "VALIDATION_ERROR" && Array.isArray(c.error.details) && (c.error.details as { message?: unknown }[]).some((d) => d?.message === "Campo não reconhecido");
const MENSAGEM_SEM_PARCIAL = "O servidor ainda não aceita importação parcial; use Importar tudo.";
/** Linhas com erro: da API nova vem pronto; da anterior, conta as linhas distintas da lista. */
const linhasComErro = (r: Resultado) => r.com_erro ?? new Set(r.erros.map((e) => e.linha)).size;
const linhasCertas = (r: Resultado) => r.certas ?? Math.max(0, r.linhas - linhasComErro(r));

function baixarPlanilhaDeErros(base64: string, nome: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a"); a.href = url; a.download = nome; a.click(); URL.revokeObjectURL(url);
}

/** Mesmo teto da rota `/imports` no servidor: acima disso o arquivo nem é enviado. */
const ARQUIVO_MAXIMO = 8 * 1024 * 1024;

const paraBase64 = (f: File) => new Promise<string>((ok, falha) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] ?? ""); r.onerror = () => falha(r.error); r.readAsDataURL(f); });
/** Corpo sem a forma do resultado (JSON de outra coisa vindo de um proxy) é falha, não prévia. */
const ehResultado = (c: Resposta): c is Resposta & Resultado => Array.isArray(c.erros) && typeof c.linhas === "number" && typeof c.gravadas === "number";

/**
 * Importar a partir do modelo: escolher o arquivo → PRÉVIA (o servidor processa tudo e desfaz) → importar.
 * "Importar tudo" só aparece com a prévia sem erro; com erro e alguma linha certa aparece "Importar só as X linhas
 * certas" (modo parcial), que grava as certas e devolve a planilha com as linhas de erro. O servidor confere de novo.
 * Todo desfecho que não é uma prévia nova APAGA a anterior: o botão nunca fica valendo para um estado velho.
 */
export function ImportDialog({ resourceKey, labelPlural, open, onOpenChange, avisoFiltro }: { resourceKey: string; labelPlural: string; open: boolean; onOpenChange: (o: boolean) => void; /** lista com filtro fixo: o que a planilha precisa preencher para o registro aparecer nela */ avisoFiltro?: string }) {
  const qc = useQueryClient();
  const [arquivo, setArquivo] = React.useState<{ nome: string; base64: string } | null>(null);
  const [previa, setPrevia] = React.useState<Resultado | null>(null);
  const [ocupado, setOcupado] = React.useState(false);
  /** resultado da importação parcial: fica na tela para o usuário baixar a planilha com as linhas de erro */
  const [feito, setFeito] = React.useState<Resultado | null>(null);
  const [semParcial, setSemParcial] = React.useState(false);
  React.useEffect(() => { if (!open) { setArquivo(null); setPrevia(null); setFeito(null); setSemParcial(false); } }, [open]);
  const descartar = () => { setPrevia(null); setArquivo(null); setFeito(null); };
  const enviar = async (simular: boolean, a = arquivo, modo: Modo = "tudo") => {
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
        // `modo` só vai quando é parcial: prévia e "Importar tudo" saem iguais às de antes e valem com a API anterior
        const res = await api<Response>(`/api/imports/${resourceKey}?simular=${simular ? 1 : 0}${modo === "parcial" ? "&modo=parcial" : ""}`, { method: "POST", body: { arquivo_base64: a.base64 }, raw: true });
        // `raw` escapa do tratamento de sessão de `api()`: a sessão expirada termina aqui do mesmo jeito
        if (res.status === 401) { descartar(); encerrarSessaoExpirada(); return; }
        corpo = (await res.json()) as Resposta;
      } catch { falhou(); return; }
      // servidor anterior à importação parcial: recusou o `modo` antes de abrir o arquivo; nada foi gravado e a prévia continua valendo
      if (modo === "parcial" && ehRecusaDeModo(corpo)) { setSemParcial(true); return; }
      if (corpo.error) { descartar(); toast.error(corpo.error.message ?? "Falha na importação"); return; }
      if (!ehResultado(corpo)) { falhou(); return; }
      if (simular || corpo.gravadas === 0) { setFeito(null); setPrevia(corpo); return; }
      void qc.invalidateQueries({ queryKey: ["b1", resourceKey] });
      if (modo === "parcial" && corpo.erros.length) { setPrevia(null); setFeito(corpo); return; }
      toast.success(`${corpo.gravadas} registro(s) importado(s)`);
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
  const certas = previa ? linhasCertas(previa) : 0;
  const parcialPossivel = previa && previa.erros.length > 0 && certas > 0 && !semParcial;
  const tabelaDeErros = (erros: ErroImportacao[]) => <div className="mt-2 max-h-80 overflow-auto rounded border"><table className="w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="px-2 py-1">Linha</th><th className="px-2 py-1">Coluna</th><th className="px-2 py-1">Problema</th></tr></thead>
    <tbody>{erros.map((e, i) => <tr key={i} className="border-t"><td className="px-2 py-1">{e.linha || "—"}</td><td className="px-2 py-1">{e.coluna ?? "—"}</td><td className="px-2 py-1">{e.mensagem}</td></tr>)}</tbody></table></div>;
  return <Dialog open={open} onOpenChange={onOpenChange} size="lg" title={`Importar ${labelPlural.toLowerCase()}`} description="Use o modelo baixado nesta tela. A prévia mostra as linhas certas e as com erro antes de gravar." testId="importar-dialogo"
    footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
      {parcialPossivel && <Button variant="outline" loading={ocupado} data-testid="importar-parcial" onClick={() => void enviar(false, arquivo, "parcial")}>Importar só as {certas} linhas certas</Button>}
      {semErro && <Button loading={ocupado} data-testid="importar-confirmar" onClick={() => void enviar(false)}>Importar tudo</Button>}</>}>
    <div className="space-y-3">
      {avisoFiltro && <p data-testid="importar-aviso-filtro" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">{avisoFiltro}</p>}
      {/* o valor é zerado a cada escolha: reescolher o MESMO arquivo depois de corrigi-lo gera nova prévia */}
      <input type="file" accept=".xlsx" data-testid="importar-arquivo" aria-label="Arquivo XLSX" onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; void escolher(f); }} />
      {ocupado && !previa && <p className="text-sm text-slate-500">Conferindo o arquivo…</p>}
      {semParcial && <p data-testid="importar-sem-parcial" role="alert" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">{MENSAGEM_SEM_PARCIAL}</p>}
      {previa && <div data-testid="importar-previa">
        <p className="text-sm">{arquivo?.nome}: <b data-testid="importar-certas">{certas} linha(s) certa(s)</b> · {previa.erros.length ? <b className="text-red-600" data-testid="importar-com-erro">{linhasComErro(previa)} com erro</b> : <b className="text-green-700">nenhum erro</b>}.</p>
        {previa.erros.length > 0 && <p className="mt-1 text-[12px] text-slate-600">“Importar tudo” só grava sem nenhum erro: com erro, nada será gravado por ele. {certas > 0 && !semParcial ? `“Importar só as ${certas} linhas certas” grava as certas e devolve uma planilha com as linhas de erro para corrigir.` : "Corrija as linhas abaixo e escolha o arquivo de novo."}</p>}
        {previa.erros.length > 0 && tabelaDeErros(previa.erros)}
      </div>}
      {feito && <div data-testid="importar-resultado">
        <p className="text-sm"><b className="text-green-700">{feito.gravadas} gravada(s)</b> · <b className="text-red-600">{linhasComErro(feito)} com erro</b>.</p>
        {feito.planilha_erros_base64
          ? <Button className="mt-2" variant="outline" data-testid="importar-baixar-erros" onClick={() => baixarPlanilhaDeErros(feito.planilha_erros_base64!, `erros-${resourceKey}.xlsx`)}>Baixar planilha com as linhas de erro</Button>
          : <p className="mt-1 text-[12px] text-slate-600">A planilha de erros passou do limite de 8 MB; corrija pelas linhas abaixo.</p>}
        <p className="mt-1 text-[12px] text-slate-600">Corrija a planilha baixada e importe de novo: a coluna “Erros” é ignorada.</p>
        {tabelaDeErros(feito.erros)}
      </div>}
    </div>
  </Dialog>;
}
