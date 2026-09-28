"use client";
/**
 * TOP-CONFIG-05 — os campos fiscais do formato 3 (modelo, finalidade, natureza, CFOPs) + o aviso fixo de que a
 * emissão não existe. SÓ CONFIGURAÇÃO. (esqueleto do contrato; implementação: agente W3)
 */
import * as React from "react";
import type { ConfiguracaoFiscalV3 } from "@agro/domain";

export interface PropsFiscalFormato3 {
  fiscal: ConfiguracaoFiscalV3;
  /** Família canônica da TOP (`vendas.pedido`…): decide o sentido imposto aos CFOPs. */
  familia: string;
  onChange: (f: ConfiguracaoFiscalV3) => void;
  desabilitado?: boolean;
  /** Erros por caminho (`fiscal.cfopDentroEstado` → mensagem), do domínio ou do 422 do servidor. */
  erros: Readonly<Record<string, string>>;
}

export function FiscalFormato3(_props: PropsFiscalFormato3): React.ReactElement | null {
  return null;
}
