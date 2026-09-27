"use client";
import * as React from "react";
import { LockKeyhole } from "lucide-react";
import { cn } from "@/lib/utils";
import { AcoesDoCampo } from "./acoes-campo";
import { MIME_ARRASTE, campoDaChave, ehChaveDeColuna, useConfigurador, type CampoDoLayout, type ColunaDoLayout, type EstruturaLayout } from "./contrato";

/** Acha o campo no layout pela chave de seleção (documento: cabeçalho ou qualquer aba; coluna: "itens.<campo>"). */
function noLayout(estrutura: EstruturaLayout, chave: string): CampoDoLayout | ColunaDoLayout | undefined {
  const campo = campoDaChave(chave);
  if (ehChaveDeColuna(chave)) return estrutura.itens.find((c) => c.campo === campo);
  return estrutura.cabecalho.find((c) => c.campo === campo) ?? estrutura.rodape.flatMap((a) => a.campos).find((c) => c.campo === campo);
}

/**
 * O campo na prévia do configurador (VENDAS-A3-1c): chip no estilo do configurador dos cadastros (verde; vermelho =
 * obrigatório). Clique seleciona, duplo clique abre "Configurar campo", arrastável (HTML5) quando em edição.
 * Serve ao cabeçalho, às abas do rodapé e às colunas dos itens (chave "itens.<campo>").
 */
export function CampoPrevia({ chave }: { chave: string }) {
  const ctx = useConfigurador();
  const coluna = ehChaveDeColuna(chave);
  const campo = campoDaChave(chave);
  const noLay = noLayout(ctx.estrutura, chave);
  const cat = ctx.catalogo.find((c) => c.chave === campo && (coluna ? c.parte === "itens" : c.parte !== "itens"));
  const rotulo = noLay?.rotulo ?? cat?.rotulo ?? campo;
  const obrigatorio = Boolean(noLay?.obrigatorio);
  const editavel = noLay && "editavel" in noLay ? noLay.editavel : true;
  const travado = !editavel || Boolean(cat?.somenteLeitura);
  const temPadrao = Boolean(noLay?.valorPadrao);
  const padraoInvalido = ctx.padroesInvalidos.has(chave);
  const selecionado = ctx.selecionado === chave;

  const arraste: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean } = ctx.editando
    ? {
        draggable: true,
        onDragStart: (e) => { e.stopPropagation(); e.dataTransfer.setData(MIME_ARRASTE, chave); e.dataTransfer.effectAllowed = "move"; ctx.setArrastando(chave); },
        onDragEnd: () => ctx.setArrastando(null),
      }
    : {};

  return (
    <div className="emp-layout-config-field-slot" style={{ flex: "3 1 0" }}>
      <div
        role="button"
        tabIndex={0}
        aria-label={rotulo}
        aria-pressed={selecionado}
        data-testid={`config-campo-${chave}`}
        data-chave={chave}
        data-selecionado={selecionado ? "true" : "false"}
        {...arraste}
        onClick={(e) => { e.stopPropagation(); ctx.selecionar(selecionado ? null : chave); }}
        onDoubleClick={(e) => { e.stopPropagation(); ctx.selecionar(chave); ctx.configurar(chave); }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter") { e.preventDefault(); ctx.selecionar(chave); ctx.configurar(chave); }
          else if (e.key === " ") { e.preventDefault(); ctx.selecionar(selecionado ? null : chave); }
        }}
        className={cn(
          "emp-layout-config-field emp-layout-config-field-panel",
          obrigatorio ? "emp-layout-config-field-required" : "emp-layout-config-field-optional",
          selecionado && "emp-layout-config-field-selected",
          !ctx.editando && "emp-layout-config-field-readonly",
          ctx.arrastando === chave && "emp-layout-config-field--dragging",
        )}
      >
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">
          {rotulo}
          {obrigatorio && <span data-testid="config-marca-obrigatorio" aria-label="Obrigatório" className="ml-0.5">*</span>}
        </span>
        <span className="emp-layout-config-field-status-icons flex items-center gap-1">
          {temPadrao && !padraoInvalido && <span data-testid="config-marca-padrao" title="Tem valor padrão" aria-label="Tem valor padrão" className="text-[10px] font-semibold">=</span>}
          {padraoInvalido && <span data-testid="config-marca-padrao-invalido" title="O registro padrão não existe mais ou está inativo" className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">Padrão inválido</span>}
          {travado && <LockKeyhole data-testid="config-marca-travado" className="h-3 w-3" aria-label={cat?.somenteLeitura ? "Somente leitura" : "Não editável"} />}
        </span>
      </div>
      {selecionado && ctx.editando && <AcoesDoCampo chave={chave} />}
    </div>
  );
}
