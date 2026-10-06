"use client";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, Button, NativeSelect } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { dateBR, num } from "@/lib/utils";
import { CATALOGO_INDICES, INDICES_BUNDLE_ESSENCIAL } from "@agro/domain";
import {
  MSG_COMPARACAO_GEOMETRIA,
  alturasDoHistograma,
  compararObservacoes,
  itemDaObservacao,
  lerHistograma,
  observacoesComparaveis,
  type HistogramaIndice,
  type HistoricoIndice,
  type IdIndice
} from "./condicao-modelo";
import { CHAVE_CONDICAO, useHistoricosDaArea } from "./condicao-dados";
import { analiseIdDaData, diaDaObservacao } from "./data-camada";
import { nomeDoIndice } from "./paletas-indices";
import {
  carregarEntradaRaster,
  gerarRasterDaAnalise,
  liberarEntrada,
  listarRastersPorAreas,
  mensagemDoErroDeRaster,
  type EntradaRasterEmMemoria,
  type RasterIndiceDto
} from "./rasters-indice";

const PERMISSAO_VER = "analises_satelitais.view";
const PERMISSAO_PEDIR = "analises_satelitais.create";

/** Variação com sinal e duas casas: "+0,14" / "−0,05" / "0,00". */
function comSinal(v: number): string {
  const t = num(Math.abs(v), 2);
  return v > 0 ? `+${t}` : v < 0 ? `−${t}` : t;
}

/**
 * A imagem JÁ GERADA do índice num dia (listagem com `data_imagem`): nunca chama o provedor. Sem imagem naquele dia,
 * `dto` fica nulo e a tela diz isso. O PNG é baixado pela URL assinada e colorido na paleta do índice.
 */
function useRasterDoDia(areaId: string, indice: IdIndice, dia: string | null, ativo: boolean) {
  const { can, session } = useAuth();
  const listagem = useQuery({
    queryKey: [...CHAVE_CONDICAO, "raster-do-dia", areaId, indice, dia, session?.empresaId ?? null],
    enabled: ativo && dia !== null && can(PERMISSAO_VER),
    retry: false,
    staleTime: 30_000,
    queryFn: async ({ signal }): Promise<RasterIndiceDto | null> => {
      const lista = await listarRastersPorAreas([areaId], indice, { signal, dataImagem: dia! });
      return lista.find((r) => r.area_id === areaId && r.data_imagem === dia) ?? null;
    }
  });
  const dto = listagem.data ?? null;
  const [entrada, setEntrada] = React.useState<EntradaRasterEmMemoria | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  React.useEffect(() => {
    setEntrada(null);
    setErro(null);
    if (!dto) return;
    const controle = new AbortController();
    let viva: EntradaRasterEmMemoria | null = null;
    carregarEntradaRaster(dto, indice, controle.signal)
      .then((e) => {
        if (controle.signal.aborted) { liberarEntrada(e); return; }
        viva = e;
        setEntrada(e);
      })
      .catch((e: unknown) => {
        if (!controle.signal.aborted) setErro(e instanceof Error ? e.message : "Não foi possível carregar a imagem.");
      });
    return () => {
      controle.abort();
      liberarEntrada(viva ?? undefined);
    };
  }, [dto, indice]);
  return { dto, entrada, erro, carregando: listagem.isLoading, consultou: listagem.isSuccess };
}

function BarrasDoHistograma({ h, rotulo, testId }: { h: HistogramaIndice | null; rotulo: string; testId: string }) {
  if (!h) return <div className="text-[11px] text-slate-400" data-testid={`${testId}-ausente`}>{rotulo}: histograma não disponível</div>;
  const alturas = alturasDoHistograma(h);
  const L = 140, A = 40;
  const largura = L / h.bins.length;
  return (
    <figure className="flex flex-col gap-0.5" data-testid={testId}>
      <svg viewBox={`0 0 ${L} ${A}`} className="h-12 w-full" role="img" aria-label={`Distribuição dos pixels — ${rotulo}`}>
        <line x1={0} x2={L} y1={A - 0.5} y2={A - 0.5} stroke="#cbd5e1" strokeWidth={1} />
        {alturas.map((alt, i) => (
          <rect key={i} x={i * largura + 0.5} y={A - alt * (A - 2)} width={Math.max(0.5, largura - 1)} height={alt * (A - 2)} fill="#64748b">
            <title>{`${num(h.bins[i]!.baixo, 2)} a ${num(h.bins[i]!.alto, 2)}: ${h.bins[i]!.contagem}`}</title>
          </rect>
        ))}
      </svg>
      <figcaption className="flex justify-between text-[10px] tabular-nums text-slate-500">
        <span>{num(h.bins[0]!.baixo, 2)}</span>
        <span>{rotulo}</span>
        <span>{num(h.bins[h.bins.length - 1]!.alto, 2)}</span>
      </figcaption>
    </figure>
  );
}

function ImagemDoLado({ rotulo, dia, estado, indice, testId }: {
  rotulo: string;
  dia: string | null;
  estado: ReturnType<typeof useRasterDoDia>;
  indice: IdIndice;
  testId: string;
}) {
  const cabecalho = `${rotulo} · ${dia ? dateBR(dia) : "—"}`;
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <div className="text-xs font-medium text-slate-600">{cabecalho}</div>
      {estado.entrada?.blobUrl ? (
        <>
          <img src={estado.entrada.blobUrl} alt={`${nomeDoIndice(indice)} por pixel — ${cabecalho}`} className="w-full rounded border border-slate-200 bg-slate-50 [image-rendering:pixelated]" />
          <span className="text-[10px] tabular-nums text-slate-500">resolução {num(estado.entrada.dto.resolucao_m, 0)} m</span>
        </>
      ) : estado.erro ? (
        <p className="text-xs text-red-600">{estado.erro}</p>
      ) : estado.carregando || (estado.dto && !estado.entrada) ? (
        <p className="text-xs text-slate-500">Carregando a imagem…</p>
      ) : (
        <p className="rounded border border-dashed border-slate-300 p-2 text-xs text-slate-500" data-testid={`${testId}-ausente`}>Imagem ainda não gerada.</p>
      )}
    </div>
  );
}

/**
 * Comparar A × B: duas datas da MESMA área lado a lado, médias por índice e variação (B − A), a distribuição dos pixels
 * (quando a análise guardou o histograma) e, para o índice ativo, as imagens A/B JÁ GERADAS. Gerar imagem é ação
 * deliberada (consome crédito): a tela nunca chama o Process API sozinha. Só compara observações calculadas sobre o
 * mesmo contorno; contornos diferentes (hash diferente) bloqueiam tabela, histogramas e imagens.
 */
export function CompararModal({ aberto, onFechar, areaId, areaNome, indiceAtivo }: {
  aberto: boolean;
  onFechar: () => void;
  areaId: string;
  areaNome: string;
  indiceAtivo: IdIndice;
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const hist = useHistoricosDaArea(areaId, INDICES_BUNDLE_ESSENCIAL, aberto);
  const referencia = hist.porIndice.ndvi;
  const datas = React.useMemo(() => (referencia ? observacoesComparaveis(referencia.itens) : []), [referencia]);
  const [a, setA] = React.useState("");
  const [b, setB] = React.useState("");
  const [confirmando, setConfirmando] = React.useState(false);
  const [aviso, setAviso] = React.useState<{ tom: "ok" | "erro"; texto: string } | null>(null);

  React.useEffect(() => {
    if (!aberto || datas.length < 2) return;
    setA((x) => (x && datas.some((d) => d.chave === x) ? x : datas[1]!.chave));
    setB((x) => (x && datas.some((d) => d.chave === x) ? x : datas[0]!.chave));
  }, [aberto, datas]);
  React.useEffect(() => { setConfirmando(false); setAviso(null); }, [a, b, indiceAtivo]);

  const resultado = a && b && a !== b ? compararObservacoes(a, b, hist.porIndice) : null;
  const liberada = resultado?.tipo === "ok";
  const histAtivo: HistoricoIndice | undefined = hist.porIndice[indiceAtivo];
  const diaA = diaDaObservacao(a);
  const diaB = diaDaObservacao(b);
  const histogramaA = histAtivo ? lerHistograma(itemDaObservacao(histAtivo.itens, a)?.histograma) : null;
  const histogramaB = histAtivo ? lerHistograma(itemDaObservacao(histAtivo.itens, b)?.histograma) : null;

  const imgA = useRasterDoDia(areaId, indiceAtivo, diaA, aberto && liberada);
  const imgB = useRasterDoDia(areaId, indiceAtivo, diaB, aberto && liberada);
  const hashAtual = histAtivo?.geometria_sha256 ?? null;
  // Imagens de contornos diferentes (ou de um contorno que não é o vigente) não se comparam.
  const hashesDasImagens = new Set([imgA.dto?.geometria_sha256, imgB.dto?.geometria_sha256, hashAtual].filter((h): h is string => Boolean(h)));
  const imagensBloqueadas = hashesDasImagens.size > 1;

  const analiseA = histAtivo && diaA ? analiseIdDaData(histAtivo.itens, diaA) : null;
  const analiseB = histAtivo && diaB ? analiseIdDaData(histAtivo.itens, diaB) : null;
  const faltantes = [
    ...(imgA.consultou && !imgA.dto && analiseA ? [analiseA] : []),
    ...(imgB.consultou && !imgB.dto && analiseB ? [analiseB] : [])
  ];
  const podeGerar = can(PERMISSAO_PEDIR) && liberada && !imagensBloqueadas && faltantes.length > 0;

  const gerar = useMutation({
    mutationFn: async () => {
      for (const id of faltantes) await gerarRasterDaAnalise(id);
    },
    onSuccess: async () => {
      setConfirmando(false);
      setAviso({ tom: "ok", texto: "Imagens geradas. O que já existia não foi cobrado de novo." });
      await qc.invalidateQueries({ queryKey: [...CHAVE_CONDICAO, "raster-do-dia", areaId, indiceAtivo] });
    },
    onError: async (e) => {
      setConfirmando(false);
      setAviso({ tom: "erro", texto: mensagemDoErroDeRaster(e) });
      await qc.invalidateQueries({ queryKey: [...CHAVE_CONDICAO, "raster-do-dia", areaId, indiceAtivo] });
    }
  });

  return (
    <Dialog
      open={aberto}
      onOpenChange={(o) => { if (!o) onFechar(); }}
      title={`Comparar datas — ${areaNome}`}
      description="Médias de cada índice nas duas datas, sobre o mesmo contorno da área."
      size="lg"
      testId="comparar-modal"
      footer={<Button type="button" variant="ghost" onClick={onFechar} data-testid="comparar-fechar">Fechar</Button>}
    >
      <div className="flex flex-col gap-3 text-sm">
        {hist.carregando && <p className="text-xs text-slate-500">Carregando o histórico…</p>}
        {hist.erro && <p className="text-xs text-red-600">Não foi possível carregar o histórico desta área.</p>}
        {!hist.carregando && datas.length < 2 && (
          <p className="text-xs text-slate-600" data-testid="comparar-poucas-datas">São necessárias ao menos duas datas com análise do contorno atual para comparar.</p>
        )}
        {datas.length >= 2 && (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-slate-600">Data A (antes)
              <NativeSelect value={a} onChange={(e) => setA(e.target.value)} data-testid="comparar-data-a" aria-label="Data A">
                {datas.map((d) => <option key={d.chave} value={d.chave}>{dateBR(d.data)}</option>)}
              </NativeSelect>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600">Data B (depois)
              <NativeSelect value={b} onChange={(e) => setB(e.target.value)} data-testid="comparar-data-b" aria-label="Data B">
                {datas.map((d) => <option key={d.chave} value={d.chave}>{dateBR(d.data)}</option>)}
              </NativeSelect>
            </label>
          </div>
        )}
        {a && b && a === b && <p className="text-xs text-amber-700">Escolha datas diferentes.</p>}
        {resultado?.tipo === "bloqueada" && <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" role="alert" data-testid="comparar-bloqueada">{resultado.motivo}</p>}
        {resultado?.tipo === "ok" && (
          <table className="w-full text-[13px] tabular-nums" data-testid="comparar-tabela">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1 font-medium">Índice</th>
                <th className="py-1 text-right font-medium">A · {dateBR(a)}</th>
                <th className="py-1 text-right font-medium">B · {dateBR(b)}</th>
                <th className="py-1 text-right font-medium">B − A</th>
              </tr>
            </thead>
            <tbody>
              {resultado.linhas.map((l) => (
                <tr key={l.indice} className="border-b border-slate-100" data-testid={`comparar-linha-${l.indice}`}>
                  <td className="py-1 font-medium text-slate-700">{CATALOGO_INDICES[l.indice].nome}</td>
                  <td className="py-1 text-right">{l.a === null ? "—" : num(l.a, 2)}</td>
                  <td className="py-1 text-right">{l.b === null ? "—" : num(l.b, 2)}</td>
                  <td className={`py-1 text-right font-medium ${l.delta === null ? "text-slate-400" : l.delta > 0 ? "text-green-700" : l.delta < 0 ? "text-red-700" : "text-slate-600"}`}>{l.delta === null ? "—" : comSinal(l.delta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {liberada && (histogramaA || histogramaB) && (
          <section className="flex flex-col gap-1" data-testid="comparar-histogramas">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Distribuição dos pixels — {nomeDoIndice(indiceAtivo)}</h3>
            <div className="grid grid-cols-2 gap-3">
              <BarrasDoHistograma h={histogramaA} rotulo={`A · ${dateBR(a)}`} testId="comparar-histograma-a" />
              <BarrasDoHistograma h={histogramaB} rotulo={`B · ${dateBR(b)}`} testId="comparar-histograma-b" />
            </div>
          </section>
        )}

        {liberada && imagensBloqueadas && (
          <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" role="alert" data-testid="comparar-imagens-bloqueadas">{MSG_COMPARACAO_GEOMETRIA}</p>
        )}
        {liberada && !imagensBloqueadas && (
          <section className="flex flex-col gap-1.5" data-testid="comparar-imagens">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Imagem por pixel — {nomeDoIndice(indiceAtivo)}</h3>
            <div className="grid grid-cols-2 gap-3">
              <ImagemDoLado rotulo="A" dia={diaA} estado={imgA} indice={indiceAtivo} testId="comparar-imagem-a" />
              <ImagemDoLado rotulo="B" dia={diaB} estado={imgB} indice={indiceAtivo} testId="comparar-imagem-b" />
            </div>
            {podeGerar && !confirmando && (
              <div>
                <Button type="button" size="sm" variant="outline" disabled={gerar.isPending} onClick={() => { setAviso(null); setConfirmando(true); }} data-testid="comparar-gerar-imagem">
                  Gerar imagem A/B
                </Button>
              </div>
            )}
            {confirmando && (
              <div className="flex w-full flex-col gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-1.5" data-testid="comparar-gerar-confirmacao">
                <p className="text-xs text-amber-900">
                  Gerar {faltantes.length === 1 ? "a imagem que falta" : "as duas imagens"} do {nomeDoIndice(indiceAtivo)} consome crédito de satélite e pode levar até 2 minutos. Continuar?
                </p>
                <div className="flex flex-wrap gap-1">
                  <Button type="button" size="sm" loading={gerar.isPending} onClick={() => gerar.mutate()} data-testid="comparar-gerar-confirmar">Sim, gerar</Button>
                  <Button type="button" size="sm" variant="ghost" disabled={gerar.isPending} onClick={() => setConfirmando(false)}>Cancelar</Button>
                </div>
              </div>
            )}
            {aviso && <p className={`text-xs ${aviso.tom === "erro" ? "text-red-600" : "text-green-700"}`} role="status" data-testid="comparar-aviso">{aviso.texto}</p>}
          </section>
        )}
        <p className="text-[11px] text-slate-500">Variação de índice indica mudança no sinal de satélite; confirme em campo antes de decidir.</p>
      </div>
    </Dialog>
  );
}
