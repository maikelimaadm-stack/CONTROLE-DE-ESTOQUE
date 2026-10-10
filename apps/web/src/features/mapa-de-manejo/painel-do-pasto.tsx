"use client";
import * as React from "react";
import { X } from "lucide-react";
import { Button, StatusBadge, buttonVariants } from "@/components/ui";
import { enumLabel } from "@/lib/copy";
import { cn, dateBR, num } from "@/lib/utils";
import type { AreaOperacional, FaixaDto, LoteNaArea, ObjetoDeMapa } from "./operacional-dados";

/**
 * MAPA-MANEJO-04 (F2) — CAMADA 2: o PAINEL DO PASTO. Abre no clique do marcador ou do polígono (selecao-no-mapa.ts) e
 * mostra SÓ o que `GET /api/mapa/operacional` mandou para a área: nenhuma conta aqui. Cabeças, UA, UA/ha, dias no
 * piquete, dias de descanso, situação de lotação e faixa chegam prontos; a tela só formata para exibir.
 *
 * Forma: o precedente do /mapa-geral (legenda-condicao.tsx, variante "painel"), que já passou por revisão. É um
 * `<aside>` — NÃO um modal (sem papel de diálogo, sem foco preso, sem camada escura): o mapa continua usável atrás.
 *   telas estreitas: bottom sheet — `MolduraDoPainel` prende o painel na base do mapa; altura limitada e rolagem interna
 *   de lg para cima: painel lateral de 320 px, na altura do mapa
 *
 * "Sem registro" ≠ "0 dias": `dias_de_descanso === null` (área que nunca teve saída) diz "Sem registro de ocupação";
 * `0` diz "0 dias". A distinção é da API; o texto só a respeita.
 */

/** Ficha da área (rota real: `/cadastros/:resource/:id`, a mesma do "Abrir cadastro" do /mapa-geral). */
export const fichaDaArea = (id: string) => `/cadastros/areas/${id}`;

/** Alvo de toque de 44 px no celular. `!`: a classe `tb-btn` do botão fixa a própria altura fora das camadas do Tailwind. */
const ALVO_DE_TOQUE = "!min-h-11 sm:!min-h-0";

/** Classes do painel: as do precedente do /mapa-geral (bottom sheet → lateral de 320 px em lg). */
export const CLASSES_DO_PAINEL =
  "pointer-events-auto flex max-h-[min(45dvh,22rem)] w-full flex-col gap-2 overflow-hidden rounded-t-xl border border-slate-200 bg-white p-3 shadow-lg sm:max-h-[min(50dvh,26rem)] sm:rounded-md lg:h-full lg:max-h-none lg:w-[320px] lg:shrink-0";

/** Classes da moldura: no celular prende o painel na base do mapa (bottom sheet); em lg ele vira coluna ao lado do mapa. */
export const CLASSES_DA_MOLDURA =
  "pointer-events-none absolute inset-x-0 bottom-0 z-20 p-2 lg:pointer-events-auto lg:static lg:inset-auto lg:z-auto lg:p-0";

const inteiro = (n: number | string) => num(n, 0);

/** "1 dia" · "21 dias" (o número é o que a API mandou). */
export function textoDeDias(dias: number | string): string {
  return `${inteiro(dias)} ${Number(dias) === 1 ? "dia" : "dias"}`;
}

/** "1 cabeça" · "120 cabeças". */
export function textoDeCabecas(cabecas: number | string): string {
  return `${inteiro(cabecas)} ${Number(cabecas) === 1 ? "cabeça" : "cabeças"}`;
}

/** Descanso da área vazia: `null` é "sem registro" (nunca teve saída) — NUNCA "0 dias". */
export function textoDoDescanso(dias: number | null): string {
  return dias === null ? "Sem registro de ocupação" : textoDeDias(dias);
}

/** O número que justifica a faixa, com a unidade que a API mandou ("1,45 UA/ha", "21 dias"); `null` sem número. */
export function textoDoNumeroDaFaixa(faixa: Pick<FaixaDto, "numero" | "unidade">): string | null {
  const { numero, unidade } = faixa;
  if (numero === null || numero === "") return null;
  if (unidade === "ua_ha") return `${num(numero, 2)} UA/ha`;
  if (unidade === "dias") return textoDeDias(numero);
  if (unidade === "cabecas") return textoDeCabecas(numero);
  return num(numero, 2);
}

/** Nome do lote como a API o mandou: código e descrição. */
export function nomeDoLote(lote: LoteNaArea["lote"]): string {
  const partes = [lote.code, lote.description].filter((p): p is string => typeof p === "string" && p.trim() !== "");
  return partes.length > 0 ? partes.join(" · ") : "Lote sem código";
}

/** Os objetos de mapa daquela área (a API já recortou o escopo; aqui só o vínculo `area_id`). */
export function objetosDaArea(objetos: readonly ObjetoDeMapa[], areaId: string): ObjetoDeMapa[] {
  return objetos.filter((o) => o.area_id === areaId);
}

const decimalCurto = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

/** "12 metros", "2,5 toneladas"; `null` sem capacidade cadastrada. */
export function textoDaCapacidade(o: Pick<ObjetoDeMapa, "capacidade" | "unidade_capacidade">): string | null {
  if (o.capacidade === null || o.capacidade === "") return null;
  const valor = decimalCurto.format(Number(o.capacidade));
  return o.unidade_capacidade ? `${valor} ${enumLabel("unidade_capacidade_objeto_mapa", o.unidade_capacidade)}` : valor;
}

/** Moldura do painel: no celular, bottom sheet sobre a base do mapa; em lg, coluna estática ao lado dele. */
export function MolduraDoPainel({ children }: { children: React.ReactNode }) {
  return <div className={CLASSES_DA_MOLDURA} data-testid="painel-do-pasto-moldura">{children}</div>;
}

function Linha({ rotulo, children, testId }: { rotulo: string; children: React.ReactNode; testId?: string }) {
  return (
    <>
      <dt className="text-slate-500">{rotulo}</dt>
      <dd className="min-w-0 text-right font-medium tabular-nums text-slate-800" data-testid={testId}>{children}</dd>
    </>
  );
}

function Secao({ titulo, children, testId }: { titulo: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="space-y-1.5" data-testid={testId}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{titulo}</h3>
      {children}
    </section>
  );
}

export interface PainelDoPastoProps {
  area: AreaOperacional;
  /** Os objetos da resposta (o painel mostra só os desta área). */
  objetos: readonly ObjetoDeMapa[];
  aoFechar: () => void;
}

/** Detalhe da área selecionada no mapa operacional (ocupada ou vazia). */
export function PainelDoPasto({ area, objetos, aoFechar }: PainelDoPastoProps) {
  const ocupada = area.lotes.length > 0;
  const objetosDaAreaAtual = objetosDaArea(objetos, area.id);
  const numeroDaFaixa = area.faixa ? textoDoNumeroDaFaixa(area.faixa) : null;
  const categorias = area.icone?.categorias ?? [];

  return (
    <aside className={CLASSES_DO_PAINEL} data-testid="painel-do-pasto" data-area-id={area.id} aria-label={`Detalhe de ${area.name}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-slate-800" data-testid="painel-nome">{area.name}</h2>
          <p className="text-xs tabular-nums text-slate-500" data-testid="painel-codigo">Código {area.code}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("shrink-0 !min-w-11 sm:!min-w-0", ALVO_DE_TOQUE)}
          aria-label="Fechar detalhe"
          title="Fechar detalhe"
          onClick={aoFechar}
          data-testid="painel-fechar"
        >
          <X aria-hidden />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain text-xs text-slate-700">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <Linha rotulo="Área total" testId="painel-area-total">{num(area.area_ha, 2)} ha</Linha>
          <Linha rotulo="Área pastejável" testId="painel-area-pastejavel">
            {area.usable_area_ha === null ? "Não informada" : `${num(area.usable_area_ha, 2)} ha`}
          </Linha>
        </dl>

        {area.faixa && (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5" data-testid="painel-faixa" data-faixa={area.faixa.chave}>
            <span className="font-medium text-slate-800">{area.faixa.rotulo}</span>
            {numeroDaFaixa && <span className="tabular-nums text-slate-600" data-testid="painel-faixa-numero"> · {numeroDaFaixa}</span>}
          </div>
        )}

        {ocupada ? (
          <>
            <Secao titulo="Lotação" testId="painel-lotacao">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <Linha rotulo="Cabeças" testId="painel-cabecas">{inteiro(area.cabecas_total)}</Linha>
                <Linha rotulo="UA" testId="painel-ua">{num(area.ua_total, 2)}</Linha>
                <Linha rotulo="UA/ha" testId="painel-ua-ha">{area.ua_por_hectare === null ? "—" : num(area.ua_por_hectare, 2)}</Linha>
                <Linha rotulo="Situação" testId="painel-situacao-lotacao">
                  {area.situacao_de_lotacao === null
                    ? "Sem referência"
                    : <StatusBadge domain="situacao_lotacao" value={area.situacao_de_lotacao} />}
                </Linha>
              </dl>
              {categorias.length > 0 && (
                <p className="text-slate-600" data-testid="painel-categorias">Categorias na área: {categorias.join(", ")}</p>
              )}
            </Secao>

            <Secao titulo={`Lotes presentes (${area.lotes.length})`}>
              <ul className="space-y-1.5">
                {area.lotes.map((l) => (
                  <li key={l.id} className="rounded-md border border-slate-100 px-2 py-1.5" data-testid="painel-lote" data-lote-id={l.lote.id}>
                    <div className="truncate font-medium text-slate-800">{nomeDoLote(l.lote)}</div>
                    <div className="tabular-nums text-slate-600">
                      <span data-testid="painel-lote-cabecas">{textoDeCabecas(l.cabecas)}</span>
                      {" · "}
                      <span data-testid="painel-lote-ua">{num(l.ua, 2)} UA</span>
                      {" · "}
                      <span
                        data-testid="painel-lote-dias"
                        title={`Entrada em ${dateBR(l.data_inicio)} — ${enumLabel("origem_da_data_ocupacao", l.origem_da_data)}`}
                      >
                        {textoDeDias(l.dias_de_ocupacao)} no piquete
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </Secao>
          </>
        ) : (
          <Secao titulo="Descanso" testId="painel-descanso">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <Linha rotulo="Dias de descanso" testId="painel-dias-descanso">{textoDoDescanso(area.dias_de_descanso)}</Linha>
              {area.ultima_saida !== null && <Linha rotulo="Última saída" testId="painel-ultima-saida">{dateBR(area.ultima_saida)}</Linha>}
            </dl>
          </Secao>
        )}

        {(area.ultimo_manejo !== null || area.ultima_pesagem !== null) && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {area.ultimo_manejo !== null && <Linha rotulo="Último manejo" testId="painel-ultimo-manejo">{dateBR(area.ultimo_manejo)}</Linha>}
            {area.ultima_pesagem !== null && <Linha rotulo="Última pesagem" testId="painel-ultima-pesagem">{dateBR(area.ultima_pesagem)}</Linha>}
          </dl>
        )}

        {objetosDaAreaAtual.length > 0 && (
          <Secao titulo={`Objetos do mapa (${objetosDaAreaAtual.length})`}>
            <ul className="space-y-1">
              {objetosDaAreaAtual.map((o) => {
                const capacidade = textoDaCapacidade(o);
                return (
                  <li key={o.id} className="flex items-baseline justify-between gap-2" data-testid="painel-objeto" data-objeto-id={o.id}>
                    <span className="min-w-0 truncate text-slate-800">
                      {o.name}
                      {o.code ? <span className="text-slate-500"> ({o.code})</span> : null}
                      {!o.is_active && <span className="text-slate-500"> · inativo</span>}
                    </span>
                    <span className="shrink-0 text-right text-slate-600">
                      {enumLabel("tipo_objeto_mapa", o.tipo)}
                      {capacidade && <span className="tabular-nums"> · {capacidade}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Secao>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
        <a
          href={fichaDaArea(area.id)}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), ALVO_DE_TOQUE)}
          data-testid="painel-abrir-cadastro"
        >
          Abrir cadastro
        </a>
      </div>
    </aside>
  );
}
