"use client";
import * as React from "react";
import * as DropdownP from "@radix-ui/react-dropdown-menu";
import { Calendar, EllipsisVertical, Lock, Search } from "lucide-react";
import { cn, brl, num } from "@/lib/utils";
import { StockCell, type Row } from "@/features/docs/shared";
import estilos from "./central-vendas-workspace.module.css";

/**
 * CENTRAL DE VENDAS EM CONSULTA — as peças de LEITURA do documento salvo (VISUAL-UX-01 R3).
 *
 * O documento salvo abre na MESMA Central da criação, no conjunto de CONSULTA do design: os dados
 * principais como campos preenchidos (só leitura), a grade de itens sem lixeira e sem edição, e as
 * ações como ícones. Nada aqui calcula, decide ou grava: os valores vêm prontos do detalhe
 * (`/api/sales/<segmento>/<id>`), inclusive subtotal e total — que continuam sendo do servidor.
 */

type Adorno = "pesquisa" | "data" | "travado";
const ICONE: Record<Exclude<Adorno, "travado">, typeof Search> = { pesquisa: Search, data: Calendar };

/** Um campo preenchido, só de leitura, no formato do campo da criação (rótulo dentro da caixa). */
export function CampoLeitura({ rotulo, valor, adorno, testId }: { rotulo: string; valor: React.ReactNode; adorno?: Adorno; testId?: string }) {
  const vazio = valor === null || valor === undefined || valor === "";
  if (adorno === "travado") {
    return <div className={estilos.travado} role="group" aria-label={rotulo} data-testid={testId} data-campo={rotulo}>
      <span className={estilos.travadoRotulo}>{rotulo}</span>
      <span className={estilos.travadoValor}>{vazio ? "—" : valor}</span>
      <span className={estilos.adorno} aria-hidden><Lock /></span>
    </div>;
  }
  const Icone = adorno ? ICONE[adorno] : null;
  return <div className={cn(estilos.leitura, vazio && estilos.leituraVazia)} role="group" aria-label={rotulo} data-testid={testId} data-campo={rotulo}>
    <span className={estilos.leituraRotulo}>{rotulo}</span>
    <span className={estilos.leituraValor}>{vazio ? "—" : valor}</span>
    {Icone && <span className={estilos.adorno} aria-hidden><Icone /></span>}
  </div>;
}

/**
 * Os itens do documento salvo, na grade da Central — sem lixeira e sem edição: em consulta não há o
 * que excluir (HANDOFF: "a primeira coluna só existe em edição"). O saldo é o mesmo `StockCell` da
 * criação, só para exibir; o preenchimento de custo não existe aqui, porque nada é editável.
 */
export function ItensSalvos({ itens, subtotal, legenda }: { itens: Row[]; subtotal: string; legenda: string }) {
  const texto = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
  return <>
    <div className={estilos.itensBarra} role="toolbar" aria-label="Itens">
      <span className={estilos.itensTitulo}>Itens <span className={estilos.itensContagem} data-testid="central-vendas-itens-contagem">({itens.length})</span></span>
    </div>
    <div className={estilos.itensCorpo} data-testid="central-vendas-itens-corpo">
      <div className={estilos.gradeRolagem}>
        <table className={estilos.grade} style={{ minWidth: 880 }} aria-label={legenda} data-testid="central-vendas-grade">
          <colgroup><col style={{ width: 70 }} /><col style={{ minWidth: 170 }} /><col style={{ width: 120 }} /><col style={{ width: 92 }} /><col style={{ width: 110 }} /><col style={{ width: 108 }} /><col style={{ width: 88 }} /><col style={{ width: 90 }} /><col style={{ width: 106 }} /></colgroup>
          <thead><tr>
            <th>Código</th><th>Produto</th><th>Armazém</th><th className={estilos.numero}>Estoque</th><th className={estilos.numero}>Quantidade</th>
            <th className={estilos.numero}>Valor unitário</th><th className={estilos.numero}>Desconto</th><th className={estilos.numero}>Desconto %</th><th className={estilos.numero}>Total</th>
          </tr></thead>
          <tbody>
            {itens.length === 0 && <tr><td colSpan={9} className={estilos.vazio}>Nenhum item neste documento.</td></tr>}
            {itens.map((it, i) => <tr key={String(it["id"] ?? i)} className={estilos.linhaLeitura} data-testid="central-vendas-linha">
              <td><span className={estilos.codigo}>{texto(it["product_code"])}</span></td>
              <td>{texto(it["product_name"])}</td>
              <td>{texto(it["warehouse_name"])}</td>
              <td className={cn(estilos.numero, estilos.estoque)}><StockCell warehouseId={(it["warehouse_id"] as string | null) ?? undefined} productId={(it["product_id"] as string | null) ?? undefined} onCost={() => { /* consulta: só exibe o saldo */ }} /></td>
              <td className={estilos.numero}><span className={estilos.quantidade}>
                <span data-testid="central-vendas-quantidade">{num(String(it["quantity"] ?? "0"), 2)}</span>
                {it["unit"] ? <span className={estilos.unidade} data-testid="central-vendas-unidade">{String(it["unit"])}</span> : null}
              </span></td>
              <td className={estilos.numero}>{brl(String(it["unit_price"] ?? "0"))}</td>
              <td className={estilos.numero}>{Number(it["discount"] || 0) ? brl(String(it["discount"])) : "—"}</td>
              <td className={estilos.numero}>{Number(it["discount_percent"] || 0) ? `${num(String(it["discount_percent"]), 2)}%` : "—"}</td>
              <td className={cn(estilos.numero, estilos.forte)}>{brl(String(it["total"] ?? "0"))}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>
    {/* subtotal DO SERVIDOR: em consulta nada é somado no cliente */}
    <div className={estilos.itensRodape}>Subtotal dos itens <b data-testid="central-vendas-subtotal">{brl(subtotal)}</b></div>
  </>;
}

export interface ItemDoMenu { rotulo: string; onSelect: () => void; perigo?: boolean; separar?: boolean; testId?: string }

/**
 * "Mais ações" (⋮): o menu do conjunto de consulta do design, no vidro dos popovers da Central.
 * Radix DropdownMenu entrega papéis, teclado e foco; aqui só se veste. Recebe SÓ ações reais — a
 * tela decide quais existem para o documento e para o usuário, e nenhuma aparece "em breve".
 */
export function MaisAcoes({ itens }: { itens: ItemDoMenu[] }) {
  if (!itens.length) return null;
  return <DropdownP.Root modal={false}>
    <DropdownP.Trigger asChild>
      <button type="button" className={cn(estilos.acao, estilos.dicaFim)} aria-label="Mais ações" data-dica="Mais ações" data-testid="central-vendas-mais-acoes"><EllipsisVertical aria-hidden /></button>
    </DropdownP.Trigger>
    <DropdownP.Portal>
      <DropdownP.Content align="end" sideOffset={6} className={cn(estilos.popoverFlutuante, estilos.menu)} data-testid="central-vendas-mais-acoes-menu">
        {itens.map((m, i) => <React.Fragment key={m.rotulo}>
          {m.separar && i > 0 && <DropdownP.Separator className={estilos.menuSeparador} />}
          <DropdownP.Item className={cn(estilos.menuItem, m.perigo && estilos.menuItemPerigo)} onSelect={m.onSelect} data-testid={m.testId}>{m.rotulo}</DropdownP.Item>
        </React.Fragment>)}
      </DropdownP.Content>
    </DropdownP.Portal>
  </DropdownP.Root>;
}
