"use client";
import * as React from "react";
import type { ZonaDoLayout } from "@agro/domain";
import { useConfigurador } from "./contrato";
import { deslocarCampo, moverCampo, ondeEsta, removerCampo } from "./operacoes";

/**
 * Barra de ações do campo selecionado (VENDAS-A3-1c) — o caminho SEM MOUSE. Dono: W6. Usa as mesmas operações do
 * arrastar; "Mover para…" oferece só as zonas que a regra de zona aceita (e não a zona em que o campo já está).
 */
const valorDaZona = (z: ZonaDoLayout) => (z.tipo === "aba" ? `aba:${z.indice}` : z.tipo);

export function AcoesDoCampo({ chave }: { chave: string }) {
  const ctx = useConfigurador();
  const { estrutura, familia } = ctx;
  const zonas = React.useMemo(() => {
    const atual = ondeEsta(estrutura, chave);
    const todas: Array<{ zona: ZonaDoLayout; rotulo: string }> = [
      { zona: { tipo: "principal" }, rotulo: "Dados principais" },
      { zona: { tipo: "adicionais" }, rotulo: "Dados adicionais" },
      ...estrutura.rodape.map((a, indice): { zona: ZonaDoLayout; rotulo: string } => ({ zona: { tipo: "aba", indice }, rotulo: `Aba: ${a.aba}` })),
      { zona: { tipo: "itens" }, rotulo: "Itens" }
    ];
    return todas.filter((z) => (atual === null || valorDaZona(z.zona) !== valorDaZona(atual)) && moverCampo(familia, estrutura, chave, z.zona).ok);
  }, [estrutura, familia, chave]);
  // A3-1d: sem passo "Editar" — a barra existe só com permissão (`can` só apresenta; quem nega é a rota)
  if (!ctx.podeEditar) return null;
  const parar = (ev: React.SyntheticEvent) => ev.stopPropagation();
  return (
    <div data-testid="config-acoes" className="emp-layout-config-acoes relative z-20 mt-1 flex w-max items-center gap-1 whitespace-nowrap rounded border border-slate-200 bg-white px-1.5 py-1 text-[11.5px] shadow-md [&_button]:rounded [&_button]:px-1.5 [&_button]:py-0.5 [&_button:hover]:bg-slate-100 [&_select]:rounded [&_select]:border [&_select]:border-slate-200 [&_select]:px-1 [&_select]:py-0.5" role="toolbar" aria-label="Ações do campo" onClick={parar} onDoubleClick={parar}>
      <button type="button" data-testid="config-acao-subir" aria-label="Subir" title="Subir" onClick={() => ctx.aplicar(deslocarCampo(estrutura, chave, -1))}>↑</button>
      <button type="button" data-testid="config-acao-descer" aria-label="Descer" title="Descer" onClick={() => ctx.aplicar(deslocarCampo(estrutura, chave, 1))}>↓</button>
      <select
        data-testid="config-acao-mover"
        aria-label="Mover para…"
        value=""
        onChange={(ev) => {
          const z = zonas.find((x) => valorDaZona(x.zona) === ev.target.value);
          if (z) ctx.aplicar(moverCampo(familia, estrutura, chave, z.zona));
        }}
      >
        <option value="">Mover para…</option>
        {zonas.map((z) => <option key={valorDaZona(z.zona)} value={valorDaZona(z.zona)}>{z.rotulo}</option>)}
      </select>
      <button type="button" data-testid="config-acao-configurar" onClick={() => ctx.configurar(chave)}>Configurar</button>
      <button type="button" data-testid="config-acao-remover" onClick={() => ctx.aplicar(removerCampo(familia, estrutura, chave))}>Remover</button>
    </div>
  );
}
