"use client";
import { use } from "react";
import { useTabTitle } from "@/lib/workspace-tabs";
import { LayoutsDocumentoPanel } from "@/features/admin/layouts-documento";
import { useNomeDoLayout } from "@/features/admin/layout-configurador/tela";

/**
 * CONFIGURAÇÕES › OPERAÇÕES › LAYOUT DO DOCUMENTO (VENDAS-A3-1c, decisão 261; VENDAS-A3-1d, decisão 262): a MESMA tela
 * única de Layouts de documento, com a linha deste id já selecionada e a área de configuração dela aberta.
 * `key={id}`: trocar de id pela navegação monta a tela de novo com a nova seleção. A aba leva o nome do layout.
 */
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const nome = useNomeDoLayout(id);
  useTabTitle(nome);
  return <LayoutsDocumentoPanel key={id} idInicial={id} />;
}
