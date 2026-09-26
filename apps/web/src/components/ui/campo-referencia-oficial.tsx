"use client";
/**
 * CAMPO DE REFERÊNCIA OFICIAL (CADASTROS AJUSTES 02, 2.1) — CONTRATO (PASSO 0).
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
import type { ChaveReferencia } from "@agro/domain";

export type ParteDoCampo = "busca" | "codigo" | "extra";
/** Uma parte desenhada: quem chama decide a moldura (B1Field no formulário, célula na grade). */
export interface ParteRenderizada { parte: ParteDoCampo; rotulo: string; hasValue: boolean; somenteLeitura: boolean; node: React.ReactNode }
export type EnvolverParte = (p: ParteRenderizada) => React.ReactNode;

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

export function CampoReferenciaOficial(_props: CampoReferenciaOficialProps): React.ReactElement | null {
  return null; // implementado pelo agente REF
}
