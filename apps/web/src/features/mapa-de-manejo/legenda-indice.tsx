"use client";
import { CATALOGO_INDICES } from "@agro/domain";
import { num } from "@/lib/utils";
import { COR_SEM_NDVI } from "./ndvi";
import { PALETAS_INDICES, escalaDeCodificacao, gradienteCssDoIndice, type IdIndice } from "./paletas-indices";

/**
 * Legenda do índice por pixel: o gradiente das paradas FIXAS da paleta (as mesmas em qualquer data e área), as pontas
 * em linguagem de sinal e o lembrete de que índice de satélite não é biomassa, oferta de forragem nem lotação.
 * A atribuição do Copernicus NÃO mora aqui — uma só no mapa.
 */
export function LegendaIndice({ indice }: { indice: IdIndice }) {
  const paleta = PALETAS_INDICES[indice];
  const paradas = paleta.paradas;
  const min = paradas[0]!.valor;
  const max = paradas[paradas.length - 1]!.valor;
  const escala = escalaDeCodificacao(indice);
  const cat = CATALOGO_INDICES[indice];
  return (
    <div className="pointer-events-auto rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-sm" data-testid="mapa-legenda-ndvi">
      <div className="mb-1 font-semibold text-slate-700">{cat.nome} por pixel</div>
      <div className="h-3 w-full rounded-sm border border-slate-300" style={{ background: gradienteCssDoIndice(indice) }} data-testid="mapa-legenda-gradiente" aria-hidden />
      <div className="relative mt-0.5 h-3 tabular-nums text-[10px] text-slate-600" data-testid="mapa-legenda-marcas">
        {paradas.map((p, i) => (
          <span
            key={p.valor}
            className="absolute whitespace-nowrap"
            style={{ left: `${((p.valor - min) / (max - min)) * 100}%`, transform: i === 0 ? "none" : i === paradas.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }}
          >
            {num(p.valor, 2)}
          </span>
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-slate-500">
        <span>{paleta.pontas[0]}</span>
        <span>{paleta.pontas[1]}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="h-3 w-4 shrink-0 rounded-sm border border-slate-300" style={{ backgroundColor: COR_SEM_NDVI }} aria-hidden />
        <span className="text-slate-700">Sem imagem útil ou sem análise</span>
      </div>
      <p className="mt-1 max-w-[16rem] text-[10px] leading-tight text-slate-500" data-testid="mapa-legenda-escala">
        Escala fixa de {num(escala.min, 1)} a {num(escala.max, 1)}, igual em qualquer área e data. Resolução nativa {cat.resolucaoNativaM} m.
      </p>
      <p className="mt-1 max-w-[16rem] text-[10px] leading-tight text-slate-500">
        Os índices medem o sinal do satélite. Não é biomassa, oferta de forragem nem lotação.
      </p>
    </div>
  );
}
