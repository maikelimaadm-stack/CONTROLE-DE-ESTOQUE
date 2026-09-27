"use client";
import * as React from "react";
import { Search } from "lucide-react";
import { motivoZonaProibida, type CampoDoCatalogo } from "@agro/domain";
import { cn } from "@/lib/utils";
import { MIME_ARRASTE, campoDaChave, chaveDeColuna, useConfigurador, type EstruturaLayout, type ZonaDoLayout } from "./contrato";
import { moverCampo, removerCampo } from "./operacoes";

/**
 * (A) CAMPOS DISPONÍVEIS (VENDAS-A3-1c): o que o catálogo do movimento tem e o layout não usa. Mesmo visual da coluna
 * de disponíveis do configurador dos cadastros (chip verde; vermelho = obrigatório do sistema). Soltar aqui tira o
 * campo do layout (removerCampo — o obrigatório é recusado e o motivo aparece). "Incluir em…" é o caminho sem mouse
 * (moverCampo), oferecendo só as zonas que `motivoZonaProibida` aceita.
 */

interface OpcaoZona { id: string; rotulo: string; zona: ZonaDoLayout }

function zonasDaEstrutura(e: EstruturaLayout): OpcaoZona[] {
  return [
    { id: "principal", rotulo: "Dados principais", zona: { tipo: "principal" } },
    { id: "adicionais", rotulo: "Dados adicionais", zona: { tipo: "adicionais" } },
    ...e.rodape.map((a, indice): OpcaoZona => ({ id: `aba-${indice}`, rotulo: `Aba ${a.aba}`, zona: { tipo: "aba", indice } })),
    { id: "itens", rotulo: "Itens", zona: { tipo: "itens" } },
  ];
}

function chavesNoLayout(e: EstruturaLayout): Set<string> {
  const s = new Set<string>();
  e.cabecalho.forEach((c) => s.add(c.campo));
  e.rodape.forEach((a) => a.campos.forEach((c) => s.add(c.campo)));
  e.itens.forEach((c) => s.add(chaveDeColuna(c.campo)));
  return s;
}

const chaveDoCatalogo = (c: CampoDoCatalogo) => (c.parte === "itens" ? chaveDeColuna(c.chave) : c.chave);
const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function Disponiveis() {
  const ctx = useConfigurador();
  const { estrutura, editando, familia, catalogo, arrastando, selecionado } = ctx;
  const [busca, setBusca] = React.useState("");
  const [soObrigatorios, setSoObrigatorios] = React.useState(false);

  const noLayout = React.useMemo(() => chavesNoLayout(estrutura), [estrutura]);
  const disponiveis = React.useMemo(() => catalogo.filter((c) => !noLayout.has(chaveDoCatalogo(c))), [catalogo, noLayout]);
  const filtrados = React.useMemo(() => {
    const q = normalizar(busca.trim());
    return disponiveis.filter((c) => (!soObrigatorios || Boolean(c.sistema)) && (!q || normalizar(c.rotulo).includes(q) || normalizar(c.chave).includes(q)));
  }, [disponiveis, busca, soObrigatorios]);
  const doDocumento = filtrados.filter((c) => c.parte !== "itens");
  const dosItens = filtrados.filter((c) => c.parte === "itens");

  // "Incluir em…" age sobre o disponível selecionado
  const selDisponivel = selecionado && disponiveis.some((c) => chaveDoCatalogo(c) === selecionado) ? selecionado : null;
  const zonas = React.useMemo(() => {
    if (!selDisponivel) return [];
    const campo = campoDaChave(selDisponivel);
    return zonasDaEstrutura(estrutura).filter((z) => {
      // a regra de zona olha a chave do catálogo; coluna só vale em itens e campo do documento fora dela
      if (z.zona.tipo === "itens" ? selDisponivel !== chaveDeColuna(campo) : selDisponivel !== campo) return false;
      return motivoZonaProibida(familia, campo, z.zona) === null;
    });
  }, [selDisponivel, estrutura, familia]);

  const incluir = (id: string) => {
    const z = zonas.find((x) => x.id === id);
    if (!selDisponivel || !z) return;
    ctx.aplicar(moverCampo(familia, estrutura, selDisponivel, z.zona));
  };

  const arrastandoDoLayout = Boolean(arrastando && noLayout.has(arrastando));

  const chip = (c: CampoDoCatalogo) => {
    const chave = chaveDoCatalogo(c);
    const obrigatorio = Boolean(c.sistema);
    const sel = selecionado === chave;
    return <div key={chave} role="button" tabIndex={0} data-testid={`config-disponivel-${chave}`} aria-label={c.rotulo} aria-disabled={!editando} aria-pressed={sel}
      draggable={editando}
      onDragStart={(e) => { if (!editando) return; e.dataTransfer.setData(MIME_ARRASTE, chave); e.dataTransfer.effectAllowed = "move"; ctx.setArrastando(chave); }}
      onDragEnd={() => ctx.setArrastando(null)}
      onClick={() => { if (editando) ctx.selecionar(sel ? null : chave); }}
      onKeyDown={(e) => { if (editando && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); ctx.selecionar(sel ? null : chave); } }}
      className={cn("emp-layout-config-field emp-layout-config-field-available", obrigatorio ? "emp-layout-config-field-required" : "emp-layout-config-field-optional", sel && "emp-layout-config-field-selected", !editando && "emp-layout-config-field-readonly", arrastando === chave && "emp-layout-config-field--dragging")}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold">{c.rotulo}{obrigatorio && " *"}</div>
        <div className="truncate text-[10px] opacity-75">{c.parte === "itens" ? "Coluna dos itens" : c.parte === "rodape" && c.aba ? `Rodapé · ${c.aba}` : "Cabeçalho"}</div>
      </div>
    </div>;
  };

  const secao = (titulo: string, lista: CampoDoCatalogo[]) => lista.length > 0 && <div className="flex flex-col gap-1">
    <div className="emp-layout-config-sidebar-title">{titulo}</div>
    {lista.map(chip)}
  </div>;

  return <aside className="emp-layout-config-sidebar" data-testid="config-disponiveis"
    onDragOver={(e) => { if (editando && arrastandoDoLayout) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
    onDrop={(e) => {
      e.preventDefault();
      if (!editando) return;
      const chave = e.dataTransfer.getData(MIME_ARRASTE) || arrastando;
      ctx.setArrastando(null);
      if (chave && noLayout.has(chave)) ctx.aplicar(removerCampo(familia, estrutura, chave));
    }}>
    <div className="emp-layout-config-sidebar-title">Campos disponíveis</div>
    <div className="mg-search-pill emp-layout-config-sidebar-search" role="search"><Search className="mg-search-pill-icon" aria-hidden /><input data-testid="config-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procurar campo disponível" aria-label="Procurar campo disponível" /></div>
    <label className="flex items-center gap-1.5 px-1 text-[11px]"><input type="checkbox" data-testid="config-so-obrigatorios" checked={soObrigatorios} onChange={(e) => setSoObrigatorios(e.target.checked)} />Mostrar só obrigatórios</label>
    {editando && <label className="flex flex-col gap-0.5 px-1 text-[11px]">Incluir em…
      <select data-testid="config-incluir-em" aria-label="Incluir em…" value="" disabled={!selDisponivel || zonas.length === 0} onChange={(e) => incluir(e.target.value)} className="rounded border px-1 py-0.5 text-xs">
        <option value="">{selDisponivel ? "Escolha onde incluir" : "Selecione um campo disponível"}</option>
        {zonas.map((z) => <option key={z.id} value={z.id}>{z.rotulo}</option>)}
      </select>
    </label>}
    <div className={cn("emp-layout-config-available-list", arrastandoDoLayout && "emp-layout-config-drop-target")}>
      {secao("Campos do documento", doDocumento)}
      {secao("Colunas dos itens", dosItens)}
      {disponiveis.length === 0 && <div data-testid="config-disponiveis-vazio" className="py-6 text-center text-[11px] text-[var(--mg-text-3)]">Todos os campos já estão no layout.</div>}
      {disponiveis.length > 0 && filtrados.length === 0 && <div className="py-6 text-center text-[11px] text-[var(--mg-text-3)]">Nenhum campo encontrado.</div>}
    </div>
  </aside>;
}
