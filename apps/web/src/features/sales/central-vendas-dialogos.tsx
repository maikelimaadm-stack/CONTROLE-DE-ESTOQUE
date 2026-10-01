"use client";
import * as React from "react";
import {
  DialogoCancelarDocumento as DialogoCancelarDoMotor, DialogoConfirmar, motivoDoCancelamento as motivoDoCancelamentoDoMotor
} from "@/features/central/dialogos";
import { MOTIVO_PADRAO_DO_CANCELAMENTO, PREFIXO_CENTRAL_VENDAS } from "./central-vendas-adaptador";

/**
 * OS DIÁLOGOS DA CENTRAL DE VENDAS (VISUAL-UX-02, decisão 270, item 4.6; motor extraído em VISUAL-UX-04).
 *
 * A casca é a do motor (`@/features/central/dialogos`, sobre o `Dialog` oficial). Aqui fica o texto da venda
 * ("Confirmar venda"), o prefixo dos testids e o motivo do cancelamento: o `reason` aparado (1–500) ou, vazio,
 * "Cancelado pelo usuário". Quem confirma, cancela ou descarta continua sendo a PÁGINA.
 */

export { MOTIVO_PADRAO_DO_CANCELAMENTO } from "./central-vendas-adaptador";
export { DialogoDescartar } from "@/features/central/dialogos";

/** O `reason` que vai no corpo: o motivo aparado (1–500) ou, vazio, o texto padrão de hoje. */
export function motivoDoCancelamento(digitado: string): string {
  return motivoDoCancelamentoDoMotor(digitado, MOTIVO_PADRAO_DO_CANCELAMENTO);
}

/** CONFIRMAR VENDA — o corpo é a PRÉVIA do servidor, montada pela página. */
export function DialogoConfirmarVenda({ aberto, onFechar, codigo, carregando, confirmarDesabilitado, onConfirmar, children }: {
  aberto: boolean; onFechar: () => void; codigo: string; carregando: boolean; confirmarDesabilitado: boolean; onConfirmar: () => void; children: React.ReactNode;
}) {
  return <DialogoConfirmar aberto={aberto} onFechar={onFechar} rotulo="Confirmar venda" codigo={codigo} carregando={carregando}
    confirmarDesabilitado={confirmarDesabilitado} onConfirmar={onConfirmar}>{children}</DialogoConfirmar>;
}

/** CANCELAR <ESPÉCIE> — o motivo é opcional e vai no `reason`. */
export function DialogoCancelarDocumento({ aberto, onFechar, especie, codigo, texto, carregando, onCancelar }: {
  aberto: boolean; onFechar: () => void;
  /** a espécie em minúsculas, como no título e no botão ("venda", "pedido de venda", "orçamento") */
  especie: string; codigo: string; texto: string; carregando: boolean;
  onCancelar: (reason: string) => void;
}) {
  return <DialogoCancelarDoMotor prefixoTestid={PREFIXO_CENTRAL_VENDAS} aberto={aberto} onFechar={onFechar} especie={especie} codigo={codigo}
    texto={texto} carregando={carregando} motivoVazio={MOTIVO_PADRAO_DO_CANCELAMENTO} onCancelar={onCancelar} />;
}
