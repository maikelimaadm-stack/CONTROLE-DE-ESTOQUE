"use client";
import Link from "next/link";
import { ArrowLeft, Building2, Eye, Pencil, Redo2, RotateCcw, Save, Undo2, X } from "lucide-react";
import { Menu } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { PropsBarra } from "./tipos";
import estilos from "./pagina.module.css";

const inicio = cn(estilos.acao, estilos.dicaInicio);
const fim = cn(estilos.acao, estilos.dicaFim);

/**
 * Barra da configuração de layout. Consulta: [Voltar] | [Editar layout] … [Padrão da organização] | [Pré-visualizar]
 * [Restaurar padrão]. Edição: [Salvar] [Descartar] | [Desfazer] [Refazer] … o mesmo grupo da direita.
 */
export function Barra(props: PropsBarra) {
  const { modo, carregado, alterado, podeDesfazer, podeRefazer, preVisualizar, temPersonalizacao, podeEditarOrg, temPadraoOrg, voltarHref } = props;
  const edicao = modo === "edicao";
  // na consulta não há rascunho a perder; na edição, só a personalização do usuário tem o que restaurar
  const restaurarAtivo = edicao && temPersonalizacao;
  const dicaRestaurar = edicao && !temPersonalizacao ? "Já está no padrão" : "Restaurar padrão";
  return <section data-parte="barra" className={estilos.barraCartao}>
    <div role="toolbar" aria-label="Ações da configuração de layout" className={estilos.barra}>
      {edicao
        ? <div className={estilos.grupo}>
          <button type="button" aria-label="Salvar layout" data-dica={alterado ? "Salvar layout" : "Nada mudou ainda"} disabled={!alterado}
            className={cn(inicio, alterado && estilos.salvar)} onClick={props.aoSalvar}><Save size={16} aria-hidden /></button>
          <button type="button" aria-label="Descartar alterações" data-dica="Descartar alterações" className={inicio} onClick={props.aoDescartar}><X size={16} aria-hidden /></button>
          <span className={estilos.divisor} aria-hidden />
          <button type="button" aria-label="Desfazer" data-dica="Desfazer" disabled={!podeDesfazer} className={inicio} onClick={props.aoDesfazer}><Undo2 size={16} aria-hidden /></button>
          <button type="button" aria-label="Refazer" data-dica="Refazer" disabled={!podeRefazer} className={inicio} onClick={props.aoRefazer}><Redo2 size={16} aria-hidden /></button>
        </div>
        : <div className={estilos.grupo}>
          <Link href={voltarHref} aria-label="Voltar" data-dica="Voltar para o cadastro" className={inicio}><ArrowLeft size={16} aria-hidden /></Link>
          <span className={estilos.divisor} aria-hidden />
          {/* sem as preferências carregadas o rascunho nasceria do padrão, e o Salvar trocaria a personalização real */}
          <button type="button" aria-label="Editar layout" data-dica="Editar layout" disabled={!carregado} className={inicio} onClick={props.aoEditar}><Pencil size={16} aria-hidden /></button>
        </div>}
      <span className={estilos.espaco} />
      <div className={estilos.grupo}>
        {podeEditarOrg && <>
          {edicao
            // o padrão da organização publica o SALVO: no meio da edição ele publicaria outra coisa que a tela mostra
            ? <button type="button" aria-label="Padrão da organização" data-dica="Salve antes de mexer no padrão da organização" disabled className={fim}><Building2 size={16} aria-hidden /></button>
            : <Menu
              trigger={<button type="button" aria-label="Padrão da organização" data-dica="Padrão da organização" className={fim}><Building2 size={16} aria-hidden /></button>}
              items={[
                { label: "Usar este layout como padrão da organização", onClick: props.aoUsarComoPadraoOrg },
                ...(temPadraoOrg ? [{ label: "Remover o padrão da organização", onClick: props.aoRemoverPadraoOrg }] : []),
              ]} />}
          <span className={estilos.divisor} aria-hidden />
        </>}
        <button type="button" aria-label="Pré-visualizar formulário" data-dica="Pré-visualizar" aria-pressed={preVisualizar} className={fim} onClick={props.aoAlternarPreVisualizar}><Eye size={16} aria-hidden /></button>
        <button type="button" aria-label="Restaurar padrão" data-dica={dicaRestaurar} disabled={!restaurarAtivo} className={fim} onClick={props.aoRestaurar}><RotateCcw size={16} aria-hidden /></button>
      </div>
    </div>
  </section>;
}
