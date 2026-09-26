"use client";
/**
 * CARTÃO ADICIONAL (CADASTROS AJUSTES 02, 2.4).
 * Cada endereço/conta/contato adicional é um CARTÃO cujo corpo é desenhado pelo MESMO componente do bloco
 * principal (blocos-parceiro.tsx), na ordem de BLOCO_* (@agro/domain). A regra da linha (permissões criar/editar/excluir,
 * gravada × nova, CEP com resposta velha descartada, trava "pelo CEP", limite de linhas) continua na GradeDeDetalhe
 * (ficha-em-abas.tsx); aqui só se desenha: cartão, marca de erro do servidor ("Endereço N: …" / "Conta N: …" / "Contato N: …" — R1-C; tabelas seguem "Linha N"), Incluir e Remover.
 * testids: contêiner `grade-<detalhe>`; cartão `linha-<detalhe>-N`; botão `incluir-<detalhe>` ("Incluir endereço" /
 * "Incluir conta" / "Incluir contato"); remover com aria-label "Remover endereço N" / "Remover conta N" / "Remover contato N".
 */
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import type { BlocoDoParceiro, ParteDoBloco } from "@agro/domain";
import { Card } from "@/components/ui";
import { PillBtn } from "@/features/base1/ui";
import { cn } from "@/lib/utils";
import { CorpoDoBloco } from "./blocos-parceiro";

/** Um cartão: a chave da linha na tela, as mensagens do servidor, se sai, e o controle de cada parte. */
export interface CartaoDaGrade { chave: string; erros: string[]; podeRemover: boolean; campo: (parte: ParteDoBloco) => React.ReactNode }

export interface GradeDeCartoesProps {
  bloco: BlocoDoParceiro;
  /** título da grade (rótulo do detalhe no registry: "Outros endereços") */
  titulo: string;
  cartoes: CartaoDaGrade[];
  /** Incluir aparece (edição + permissão de criar) */
  podeIncluir: boolean;
  /** limite de linhas (`maxLinhas`) alcançado: Incluir fica desabilitado */
  noLimite?: { max: number } | null;
  onIncluir: () => void;
  onRemover: (chave: string) => void;
}
export function GradeDeCartoes({ bloco, titulo, cartoes, podeIncluir, noLimite, onIncluir, onRemover }: GradeDeCartoesProps): React.ReactElement | null {
  return <Card className="col-span-12 p-3" data-testid={`grade-${bloco.detalhe}`}>
    <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-[13px] font-semibold text-slate-800">{titulo}</h3>
      {podeIncluir && <PillBtn tone="gray" data-testid={`incluir-${bloco.detalhe}`} disabled={Boolean(noLimite)} title={noLimite ? `Limite de ${noLimite.max} alcançado.` : undefined} onClick={onIncluir}><Plus className="h-3.5 w-3.5" /> {bloco.incluir}</PillBtn>}</div>
    {cartoes.length === 0 ? <p className="text-[12px] text-slate-400">Nenhuma linha.</p> :
      <div className="flex flex-col gap-2">{cartoes.map((c, i) => <div key={c.chave} data-testid={`linha-${bloco.detalhe}-${i + 1}`} data-chave-da-linha={c.chave}
        className={cn("rounded-md border p-2", c.erros.length > 0 ? "border-red-300 bg-red-50" : "border-slate-200")}>
        <div className="mb-1.5 flex items-center justify-between"><span className="text-[12px] font-semibold text-slate-600">{bloco.secao} {i + 1}</span>
          {c.podeRemover && <button type="button" aria-label={`${bloco.remover} ${i + 1}`} className="rounded p-1 text-red-600 hover:bg-red-50" onClick={() => onRemover(c.chave)}><Trash2 className="h-3.5 w-3.5" /></button>}</div>
        <div className="flex flex-wrap gap-2"><CorpoDoBloco bloco={bloco} lado="adicional" campo={c.campo} /></div>
        {c.erros.length > 0 && <p className="mt-1 text-[11px] text-red-600">{bloco.secao} {i + 1}: {c.erros.join(" · ")}</p>}
      </div>)}</div>}
  </Card>;
}
