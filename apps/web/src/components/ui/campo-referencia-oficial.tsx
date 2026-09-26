"use client";
/**
 * CAMPO DE REFERÊNCIA OFICIAL (CADASTROS AJUSTES 02, 2.1).
 *
 * Um dado, um lugar para digitar: a BUSCA (nome ou código) é a única parte editável; o código (e a UF do município)
 * são caixas próprias, só leitura, SEMPRE visíveis, lado a lado. Cada parte é desenhada por `envolver` — o
 * formulário passa um B1Field por parte (rótulo da parte, `hasValue`), a grade passa a célula.
 *
 * Busca escolhida mostra SÓ o nome (partesDaReferencia de @agro/domain — nunca recortando o rótulo). Carregando →
 * "carregando…"; falha → aviso legível. A caixa do nome NUNCA mostra o código; na LISTA de opções o código pode
 * aparecer. O valor gravado continua o código oficial (o corpo enviado à API não muda).
 *
 * testids: ref-<chave>-busca, ref-<chave>-codigo (bancos, cbo, ncm). Município usa CampoCidade (ref-select.tsx).
 */
import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";
import { getReferencia, partesDaReferencia, ROTULOS_DAS_PARTES, type ChaveReferencia } from "@agro/domain";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { BotaoTentarDeNovo, CmdDisplay, CmdPanel, desenharPartes, EntradaDeCodigo, MSG_LISTA_FALHOU, rotaDeBuscaAusente, TXT_CARREGANDO, useBuscaReferencia, useComEspera, type EnvolverParte, type ItemReferencia } from "./ref-select";

export type { ParteDoCampo, ParteRenderizada, EnvolverParte } from "./ref-select";
export { TXT_CARREGANDO } from "./ref-select";

export interface CampoReferenciaOficialProps {
  referencia: Exclude<ChaveReferencia, "municipios">;
  value: string | number | null | undefined;
  onChange: (v: string | number | null) => void;
  disabled?: boolean;
  /** id da caixa de busca (para <label htmlFor>); o código recebe `${id}-codigo` */
  id?: string;
  /** classe das caixas (a mesma das outras entradas de quem chama) */
  classeEntrada?: string;
  onOpenChange?: (o: boolean) => void;
  envolver?: EnvolverParte;
}

export function CampoReferenciaOficial({ referencia, value, onChange, disabled, id, classeEntrada, onOpenChange, envolver }: CampoReferenciaOficialProps): React.ReactElement | null {
  const def = getReferencia(referencia); const rotulos = ROTULOS_DAS_PARTES[referencia];
  const gerado = React.useId(); const base = id ?? `ref-${gerado}`;
  const [open, setOpen] = React.useState(false); const [search, setSearch] = React.useState("");
  const [picked, setPicked] = React.useState<ItemReferencia | null>(null);
  const temValor = value !== null && value !== undefined && value !== "";
  const noFormato = temValor && Boolean(def) && new RegExp(def!.padraoCodigo).test(String(value));
  const valorEstavel = useComEspera(temValor ? String(value) : "", 400);
  const lista = useBuscaReferencia(referencia, search, open);
  const atual = picked && String(picked.codigo) === String(value) ? picked : null;
  const um = useQuery({ queryKey: ["referencia-um", referencia, valorEstavel], queryFn: () => api<ItemReferencia>(`/api/referencias/${referencia}/${encodeURIComponent(valorEstavel)}`), enabled: noFormato && valorEstavel === String(value) && !atual, staleTime: 300_000, retry: false });
  if (rotaDeBuscaAusente(lista.error)) return <EntradaDeCodigo referencia={referencia} value={value} onChange={onChange} disabled={disabled} className={classeEntrada} id={id} />;
  const item = atual ?? um.data ?? null;
  const partes = item ? partesDaReferencia(referencia, item) : temValor ? partesDaReferencia(referencia, { codigo: String(value) }) : null;
  // a caixa do nome: o nome; enquanto consulta, "carregando…"; falha/sem nome, aviso legível — nunca o código
  const aviso = !temValor || partes?.nome ? null
    : !noFormato ? "Código fora do formato; escolha de novo."
    : um.error ? (um.error instanceof ApiError && um.error.status === 404 ? "Código não encontrado na referência." : "Não foi possível carregar o nome.")
    : item && !partes?.nome ? "Nome indisponível agora." : null;
  const texto = !temValor ? null : partes?.nome ?? (aviso ? null : TXT_CARREGANDO);
  const falhou = Boolean(lista.error) && !lista.isFetching;
  const opcoes = falhou ? [] : (lista.data?.items ?? []).map((i) => ({ value: String(i.codigo), label: i.rotulo }));
  const busca = <span className="flex w-full min-w-0 flex-col">
    <Popover.Root open={open} onOpenChange={(o) => { if (disabled) return; setOpen(o); onOpenChange?.(o); if (!o) setSearch(""); }}>
      <Popover.Trigger asChild>
        <CmdDisplay id={base} disabled={disabled} empty={!temValor} placeholder={`Buscar ${def?.label.toLowerCase() ?? ""}`} aria-label={rotulos.busca} aria-expanded={open} className={cn("w-full", classeEntrada)} data-testid={`ref-${referencia}-busca`} onClear={() => { setPicked(null); onChange(null); }}>{texto}</CmdDisplay>
      </Popover.Trigger>
      <Popover.Portal><Popover.Content align="start" sideOffset={4} className="cmd-panel z-[10000] w-[var(--radix-popover-trigger-width)] min-w-[280px] outline-none">
        <CmdPanel options={opcoes} value={temValor ? String(value) : null} search={search} onSearch={setSearch} loading={lista.isFetching && !lista.data} emptyText={falhou ? MSG_LISTA_FALHOU : "Nenhum resultado"}
          footer={falhou ? <BotaoTentarDeNovo onClick={() => void lista.refetch()} /> : undefined}
          onPick={(o) => { const it = lista.data?.items.find((x) => String(x.codigo) === o.value) ?? null; if (!it) return; setPicked(it); onChange(it.codigo); setOpen(false); setSearch(""); }} />
      </Popover.Content></Popover.Portal>
    </Popover.Root>
    {aviso && <span className="text-[11px] text-amber-600" data-testid={`ref-${referencia}-aviso`}>{aviso}</span>}
  </span>;
  const codigo = <input id={`${base}-codigo`} aria-label={rotulos.codigo} readOnly tabIndex={-1} className={cn("w-full", classeEntrada)} data-testid={`ref-${referencia}-codigo`} value={partes?.codigo ?? ""} />;
  return desenharPartes([
    { parte: "busca", rotulo: rotulos.busca, hasValue: temValor, somenteLeitura: false, node: busca, id: base },
    { parte: "codigo", rotulo: rotulos.codigo, hasValue: temValor, somenteLeitura: true, node: codigo, id: `${base}-codigo` }
  ], envolver, undefined, `campo-ref-${referencia}`);
}
