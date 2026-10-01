"use client";
import * as React from "react";
import { useTradutor } from "@/lib/i18n";
import { AcoesRapidas as AcoesRapidasDoMotor } from "@/features/central/acoes-rapidas";
import { NovoDocumento as NovoDocumentoDoMotor } from "@/features/central/novo-documento";
import {
  IndicadorConfirmando as IndicadorConfirmandoDoMotor, IndicadorSalvo as IndicadorSalvoDoMotor,
  PendenciasDoDocumento as PendenciasDoDocumentoDoMotor, PosicaoDoRotulo as PosicaoDoRotuloDoMotor,
  type ItemRapido, type Pendencia, type PosicaoDoRotuloValor
} from "@/features/central/barra";
import type { VarianteDeVenda } from "./variantes";
import { PREFIXO_CENTRAL_VENDAS, chaveDepoisDeSalvarDeVenda, fonteDoNovoDocumentoDeVenda, fonteDosDocumentosDeVendas } from "./central-vendas-adaptador";

/**
 * BARRA DE AÇÕES DA CENTRAL DE VENDAS (VISUAL-UX-02, decisão 270, item 4.1; motor extraído em VISUAL-UX-04).
 *
 * A apresentação mora no motor (`@/features/central/barra`, `acoes-rapidas`, `novo-documento`). Aqui fica só o que é
 * da venda: o prefixo `central-vendas` dos testids, os documentos abertos de vendas, o menu Novo pelas TOPs da
 * variante (`/operation-types`, a mesma consulta do lançador) e a chave do "Salvo". O que cada botão FAZ continua na
 * página; nenhum componente daqui chama a API de escrita.
 */

export {
  IconeNovo, IconeDuplicar, IconeConfirmar, IconeDescartar, IconeSalvar, IconeImprimir, IconeHistorico, IconeAlterarOperacao,
  IconeCancelarDocumento, IconeConverter, IconeEncerrarSaldo, IconeGirando, ConjuntoDaBarra, ConjuntoDireito, BotaoDaBarra, PilulaDaBarra
} from "@/features/central/barra";
export { posicaoNoLeque } from "@/features/central/acoes-rapidas";
export { TEMPO_DO_SALVO_MS } from "@/features/central/salvo";
export type { DepoisDeSalvar, ItemRapido, Pendencia, PosicaoDoRotuloValor } from "@/features/central/barra";

/** POSIÇÃO DO RÓTULO — estado SÓ da tela (a página o guarda em `useState`). */
export function PosicaoDoRotulo({ valor, onChange }: { valor: PosicaoDoRotuloValor; onChange: (v: PosicaoDoRotuloValor) => void }) {
  return <PosicaoDoRotuloDoMotor prefixoTestid={PREFIXO_CENTRAL_VENDAS} valor={valor} onChange={onChange} />;
}

export const IndicadorSalvo = () => <IndicadorSalvoDoMotor prefixoTestid={PREFIXO_CENTRAL_VENDAS} />;
export const IndicadorConfirmando = () => <IndicadorConfirmandoDoMotor prefixoTestid={PREFIXO_CENTRAL_VENDAS} />;

/** N PENDÊNCIAS — a lista leva ao campo pela página (`onIr`). */
export function PendenciasDoDocumento({ pendencias, aberta, onAbertaChange, onIr }: {
  pendencias: readonly Pendencia[]; aberta: boolean; onAbertaChange: (a: boolean) => void; onIr: (p: Pendencia) => void;
}) {
  return <PendenciasDoDocumentoDoMotor prefixoTestid={PREFIXO_CENTRAL_VENDAS} pendencias={pendencias} aberta={aberta} onAbertaChange={onAbertaChange} onIr={onIr} />;
}

/**
 * NOVO DOCUMENTO — o menu "Nova operação · <Espécie>" com as TOPs que o SERVIDOR lista para a variante, no corte do
 * menu rápido do portal; escolher uma leva a `/vendas/<seg>/new?tipo_operacao_id=<id>`, que RECONFERE a TOP.
 */
export function NovoDocumento({ variante }: { variante: VarianteDeVenda }) {
  const tr = useTradutor();
  const rotulo = tr(variante.chaveI18n);
  const fonte = React.useMemo(() => fonteDoNovoDocumentoDeVenda(variante, rotulo), [variante, rotulo]);
  return <NovoDocumentoDoMotor prefixoTestid={PREFIXO_CENTRAL_VENDAS} fonte={fonte} />;
}

/** AÇÕES RÁPIDAS (⚡) — `antes`, "N documentos abertos" (as abas de vendas) e `depois`. */
export function AcoesRapidas({ antes, depois, desabilitado }: { antes: ItemRapido[]; depois?: ItemRapido[]; desabilitado?: boolean }) {
  return <AcoesRapidasDoMotor prefixoTestid={PREFIXO_CENTRAL_VENDAS} documentosAbertos={fonteDosDocumentosDeVendas} antes={antes} depois={depois} desabilitado={desabilitado} />;
}

/**
 * DEPOIS DE SALVAR — a chave (do Map em memória, nunca storage) do que a criação deixa para a consulta:
 * `central-vendas:salvo:<id>`, a de sempre.
 */
export const chaveDepoisDeSalvar = chaveDepoisDeSalvarDeVenda;
