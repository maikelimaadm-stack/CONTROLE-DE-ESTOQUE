"use client";
import * as React from "react";
import Link from "next/link";
import { enumLabel, statusLabel } from "@/lib/copy";
import { statusTone } from "@/components/ui";
import type { Row } from "@/features/docs/shared";
import { Relacao, Selo, TitulosDoDocumento as TitulosDoMotor, type ColunaDaRelacao } from "@/features/central/painel";
import estilos from "@/features/central/painel.module.css";
import { linkDoDerivadoDeVenda, linkDoTituloDeVenda } from "./central-vendas-adaptador";

/**
 * CENTRAL DE VENDAS — O CONTEÚDO DAS ABAS DO PAINEL INFERIOR (VISUAL-UX-02, decisão 270; motor extraído em VISUAL-UX-04).
 *
 * As peças são as do motor (`@/features/central/painel`). Da venda ficam: o link de cada título (conta a receber) e os
 * DOCUMENTOS DERIVADOS (pedido e orçamento), com o link na rota da variante dele. Nada aqui calcula, decide ou grava:
 * em consulta os valores chegam prontos do detalhe (`/api/sales/<segmento>/<id>`).
 */

export { PainelRepartido, PainelColuna, PainelLargo, PlanoDaCentral, PlanoEmLeitura, lerPlano, dedutivelDoPlano } from "@/features/central/painel";

/** Os títulos (contas a receber) vinculados ao documento — do servidor. Sem título: a frase do desenho. */
export function TitulosDoDocumento({ titulos, legenda }: { titulos: Row[]; legenda: string }) {
  return <TitulosDoMotor titulos={titulos} legenda={legenda} linkDoTitulo={linkDoTituloDeVenda} />;
}

const COLUNAS_DERIVADOS: readonly ColunaDaRelacao[] = [
  { chave: "kind", rotulo: "Tipo", celula: (r) => enumLabel("sales_kind", r["kind"]) },
  { chave: "code", rotulo: "Código", celula: (r) => <Link className={estilos.codigo} href={linkDoDerivadoDeVenda(r)}>{String(r["code"] ?? "")}</Link> },
  { chave: "status", rotulo: "Situação", celula: (r) => <Selo tom={statusTone(r["status"])} valor={r["status"]}>{statusLabel(r["status"])}</Selo> }
];

/** Documentos derivados (pedido e orçamento): mesma pauta dos títulos, com o link na rota da variante DELE. */
export function DerivadosDoDocumento({ derivados, legenda }: { derivados: Row[]; legenda: string }) {
  return <Relacao legenda={legenda} modelo="derivados" colunas={COLUNAS_DERIVADOS} linhas={derivados} vazio="Nenhum documento derivado." />;
}
