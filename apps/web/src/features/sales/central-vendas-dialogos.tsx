"use client";
import * as React from "react";
import { brl, dateBR } from "@/lib/utils";
import { DialogoCancelarDocumento as DialogoCancelarDoMotor, DialogoConfirmar } from "@/features/central/dialogos";
import { MOTIVO_PADRAO_DO_CANCELAMENTO, PREFIXO_CENTRAL_VENDAS } from "./central-vendas-adaptador";
import { linhaDeEstoque, linhaFinanceira, TEXTO_SEM_PREVIA, type EstadoDaPrevia, type PreviaDaConfirmacao } from "./previa-confirmacao";
import { TEXTO_BAIXA_SEM_NUMEROS, TEXTO_NUMEROS_NA_EDICAO, TEXTO_RECEBER_SEM_NUMEROS, TEXTO_SALVAR_COM_RECUSA_PREVISTA } from "./central-vendas-editar";

/**
 * OS DIÁLOGOS DA CENTRAL DE VENDAS (VISUAL-UX-02, decisão 270, item 4.6; motor extraído em VISUAL-UX-04).
 *
 * A casca é a do motor (`@/features/central/dialogos`, sobre o `Dialog` oficial). Aqui fica o texto da venda
 * ("Confirmar venda"), o prefixo dos testids e o motivo do cancelamento: o `reason` aparado (1–500) ou, vazio,
 * "Cancelado pelo usuário". Quem confirma, cancela ou descarta continua sendo a PÁGINA.
 */

export { DialogoDescartar } from "@/features/central/dialogos";

/** CONFIRMAR VENDA — o corpo é a PRÉVIA do servidor, montada pela página. */
export function DialogoConfirmarVenda({ aberto, onFechar, codigo, carregando, confirmarDesabilitado, onConfirmar, children }: {
  aberto: boolean; onFechar: () => void; codigo: string; carregando: boolean; confirmarDesabilitado: boolean; onConfirmar: () => void; children: React.ReactNode;
}) {
  return <DialogoConfirmar aberto={aberto} onFechar={onFechar} rotulo="Confirmar venda" codigo={codigo} carregando={carregando}
    confirmarDesabilitado={confirmarDesabilitado} onConfirmar={onConfirmar}>{children}</DialogoConfirmar>;
}

/** A política da prévia SEM os números da venda gravada: "baixa"/"receber" pelos textos sem contagem; "nenhum", a linha de sempre. */
const estoqueSemNumeros = (p: PreviaDaConfirmacao): string | null => (p.estoque.efeito === "baixa" ? TEXTO_BAIXA_SEM_NUMEROS : p.estoque.efeito === "nenhum" ? linhaDeEstoque(p) : null);
const financeiroSemNumeros = (p: PreviaDaConfirmacao): string | null => (p.financeiro.efeito === "receber" ? TEXTO_RECEBER_SEM_NUMEROS : p.financeiro.efeito === "nenhum" ? linhaFinanceira(p, { dinheiro: brl, data: dateBR }) : null);

/**
 * O corpo do diálogo "Confirmar venda". Três estados, e nenhum deles promete efeito que o servidor não disse:
 * carregando (botão desabilitado), sem prévia (texto neutro) e com prévia (as linhas de efeito, ou a recusa).
 * Com recusa prevista só a recusa aparece — listar efeitos de uma confirmação que não vai acontecer seria
 * prometer de novo.
 *
 * EDITAR-03 (decisão 315): o MESMO corpo é o do aviso do Salvar que confirma (`naEdicao`). Sem `naEdicao`, o de sempre,
 * byte a byte. Com ele, as duas diferenças do A0: a recusa prevista diz o que o Salvar faz mesmo assim (o botão continua
 * habilitado), e os NÚMEROS da prévia — que são da venda GRAVADA — saem quando a PATCH muda o que ela lê
 * (`numerosDaPreviaValem` falso): fica a política, e a frase de onde saem os números.
 */
export function PreviaNoDialogo({ estado, naEdicao }: { estado: EstadoDaPrevia; naEdicao?: { numerosDaPreviaValem: boolean } }) {
  if (estado.situacao === "carregando") return <p data-testid="previa-confirmacao-carregando" className="text-[12.5px] leading-[1.5] text-slate-600">Carregando o que a confirmação vai fazer nesta venda…</p>;
  if (estado.situacao === "nao-confirmado") return <p data-testid="previa-confirmacao-neutra" className="text-[12.5px] leading-[1.5] text-slate-600">{TEXTO_SEM_PREVIA}</p>;
  const p = estado.previa;
  if (!p.podeConfirmar) {
    return <div data-testid="previa-confirmacao-recusa" role="alert" className="space-y-1 text-[12.5px] leading-[1.5] text-slate-700">
      <p className="font-medium">Esta venda não pode ser confirmada agora:</p>
      {p.recusas.map((r, i) => <p key={i} data-testid="previa-confirmacao-recusa-mensagem">{r.message}</p>)}
      {naEdicao && <p data-testid="previa-confirmacao-na-edicao">{TEXTO_SALVAR_COM_RECUSA_PREVISTA}</p>}
    </div>;
  }
  if (naEdicao && !naEdicao.numerosDaPreviaValem) {
    const estoque = estoqueSemNumeros(p);
    const financeiro = financeiroSemNumeros(p);
    return <ul data-testid="previa-confirmacao-politica" className="space-y-1 text-[12.5px] leading-[1.5] text-slate-700">
      {estoque && <li data-testid="previa-confirmacao-estoque">{estoque}</li>}
      {financeiro && <li data-testid="previa-confirmacao-financeiro">{financeiro}</li>}
      <li data-testid="previa-confirmacao-na-edicao">{TEXTO_NUMEROS_NA_EDICAO}</li>
    </ul>;
  }
  const estoque = linhaDeEstoque(p);
  const financeiro = linhaFinanceira(p, { dinheiro: brl, data: dateBR });
  return <ul data-testid="previa-confirmacao" className="space-y-1 text-[12.5px] leading-[1.5] text-slate-700">
    {estoque && <li data-testid="previa-confirmacao-estoque">{estoque}</li>}
    {financeiro && <li data-testid="previa-confirmacao-financeiro">{financeiro}</li>}
  </ul>;
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
