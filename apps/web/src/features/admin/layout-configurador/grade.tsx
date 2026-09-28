"use client";
import * as React from "react";
import { StatusBadge } from "@/components/ui";
import { DataTable, type Column } from "@/components/ui/data-table";
import { usoDaLinha, type LayoutLinha } from "./contrato";

/**
 * GRADE DE LAYOUTS (VENDAS-A3-1d, decisão 262) — a parte de cima da tela única: Código · Descrição · Movimento ·
 * Padrão · Em uso · Ativo. Clique em qualquer célula da linha SELECIONA (a tela abre a área de configuração logo
 * abaixo, sem navegar); a linha selecionada fica com o fundo verde claro da grade base.
 *
 * É a grade única do modelo base (`DataTable` sobre `Base1Grid`), sem ação de linha nem duplo clique: aqui não se
 * "abre" registro, só se escolhe qual configurar. A grade base seleciona por conjunto (clique, Ctrl, caixa da
 * linha); nesta tela vale UMA linha — a que entrou agora. Desmarcar a selecionada ou marcar todas não troca nada.
 * Quem decide se a troca acontece (rascunho sujo pergunta antes) é a tela, em `onSelecionar`.
 */
export function GradeLayouts({ linhas, selecionadoId, onSelecionar, rotuloMovimento }: {
  linhas: LayoutLinha[];
  selecionadoId: string | null;
  onSelecionar: (id: string) => void;
  rotuloMovimento: (familia: string) => string;
}) {
  const selecionados = React.useMemo(() => new Set(selecionadoId ? [selecionadoId] : []), [selecionadoId]);
  /** Uma linha nova por vez (clique, Ctrl+clique ou a caixa da linha); "marcar todas" traz várias e não escolhe nada. */
  const aoSelecionar = (ids: Set<string>) => {
    const [nova, ...outras] = [...ids].filter((id) => id !== selecionadoId);
    if (nova && outras.length === 0) onSelecionar(nova);
  };

  const colunas: Column<LayoutLinha>[] = [
    {
      key: "code", label: "Código", width: 110,
      render: (l) => <span data-testid={`layout-linha-${l.id}`} data-selecionado={l.id === selecionadoId ? "true" : "false"}
        data-ativo={l.ativo ? "true" : "false"} data-padrao={l.padrao ? "true" : "false"} className="font-medium">{l.code}</span>
    },
    { key: "nome", label: "Descrição" },
    { key: "familia", label: "Movimento", render: (l) => rotuloMovimento(l.familia), text: (l) => rotuloMovimento(l.familia) },
    { key: "padrao", label: "Padrão", width: 90, render: (l) => (l.padrao ? "Sim" : "Não"), text: (l) => (l.padrao ? "Sim" : "Não") },
    {
      key: "emUso", label: "Em uso",
      render: (l) => {
        const uso = usoDaLinha(l);
        return <span data-testid={`layout-em-uso-${l.id}`} data-em-uso={uso.emUso ? "true" : "false"}
          className={uso.emUso ? "text-slate-700" : "rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800"}>{uso.texto}</span>;
      },
      text: (l) => usoDaLinha(l).texto
    },
    {
      key: "ativo", label: "Ativo", width: 100,
      render: (l) => <StatusBadge domain="status" value={l.ativo ? "active" : "inactive"} />,
      text: (l) => (l.ativo ? "Ativo" : "Inativo")
    }
  ];

  return <DataTable rows={linhas} columns={colunas} selected={selecionados} onSelect={aoSelecionar} />;
}
