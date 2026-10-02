"use client";
import * as React from "react";
import {
  ListaDeDocumentosAbertos as ListaDoMotor, useDocumentosAbertos, type DocumentoAberto, type DocumentosAbertos
} from "@/features/central/documentos-abertos";
import { PREFIXO_CENTRAL_VENDAS, fonteDosDocumentosDeVendas } from "./central-vendas-adaptador";

/**
 * DOCUMENTOS ABERTOS DE VENDAS (VISUAL-UX-01 R2; motor extraído em VISUAL-UX-04).
 *
 * A lista é a do motor (`@/features/central/documentos-abertos`): uma fonte só, `useWorkspaceTabs`, com o MESMO
 * `closeTab` e o MESMO diálogo da barra de abas. A venda só diz quais abas são documentos dela
 * (`/vendas/<seg>/new` e `/vendas/<seg>/<id>` de uma variante conhecida), a porta de leitura (`/api/sales/<seg>/<id>`,
 * a mesma chave de cache do detalhe) e que a contraparte é o cliente (`client_name`).
 */

export type Documento = DocumentoAberto;
export type DocumentosDeVendas = DocumentosAbertos;

/** Os documentos de vendas abertos nas abas — a MESMA fonte da barra de abas. Fora do shell, nada. */
export function useDocumentosDeVendas(): DocumentosDeVendas | null {
  return useDocumentosAbertos(fonteDosDocumentosDeVendas);
}

/** A LISTA, aberta pelo item "N documentos abertos" do leque de Ações rápidas. */
export function ListaDeDocumentosAbertos({ aberta, onFechar, ancora, botao, documentos }: {
  aberta: boolean; onFechar: () => void;
  /** o invólucro do ⚡ e da lista: clique fora dele fecha a lista */
  ancora: React.RefObject<HTMLSpanElement | null>;
  /** o ⚡: é para ele que o foco volta quando a lista fecha */
  botao: React.RefObject<HTMLButtonElement | null>;
  documentos: DocumentosDeVendas;
}) {
  return <ListaDoMotor prefixoTestid={PREFIXO_CENTRAL_VENDAS} fonte={fonteDosDocumentosDeVendas} aberta={aberta} onFechar={onFechar} ancora={ancora} botao={botao} documentos={documentos} />;
}
