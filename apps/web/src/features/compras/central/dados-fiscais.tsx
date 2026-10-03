"use client";
import * as React from "react";
import Link from "next/link";
import { enumLabel, enumOptions } from "@/lib/copy";
import { D } from "@agro/shared";
import { brl } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { Button, Input, NativeSelect } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { CampoDaCentral, CampoLeitura, ColunaDeCampos } from "@/features/central/campo";
import { SimpleTable, type Row } from "@/features/docs/shared";
import {
  CAMPOS_DOS_DADOS_FISCAIS, centroDoItem, itemGeraEstoque, itemImobilizado, naturezaDoItem, opcoesDeNaturezaDeDespesa, somaDoRateio,
  type ChaveDosDadosFiscais, type EstadoDaCriacao, type TipoDoRateioDaCompra
} from "./estado";

/**
 * OS DADOS FISCAIS DA COMPRA (OPERACOES-01 F7, decisão 284) — o que a nota antiga tinha no cabeçalho e a compra passou
 * a ter: chave de acesso, UF, tipo de documento, IPI, ICMS-ST, seguro, tipo de título e classificação (CAPEX/OPEX).
 *
 *   · CRIAÇÃO (`DadosFiscaisDaCriacao`): o bloco `compras-dados-fiscais` nos Dados adicionais, SÓ quando o estado diz
 *     `dadosFiscaisAtivos` (criação da compra com a capacidade `importacaoXml` "sim"). Só desenha: o valor, o erro do
 *     servidor e o que vai no corpo moram em `useEstadoDaCriacao`.
 *   · CONSULTA (`DadosFiscaisDaConsulta`, `RateioDaConsulta`, `BensDaConsulta`): leitura do que o detalhe trouxe. Compra
 *     sem nenhum dado fiscal (a de hoje, ou a API anterior) não mostra nada.
 *
 *   · RATEIO E ITENS (`RateioEItensDaCriacao`, `compras-rateio-e-itens`), no mesmo bloco: o rateio (do documento, por
 *     valor ou por produto) e, por item da grade, "Gera estoque", "Imobilizado" e — com o rateio por produto — natureza
 *     e centro. Fora da grade do motor comum (que é a mesma das outras Centrais): a classificação mora na LINHA da grade
 *     (`CLASSIFICACAO_DO_ITEM`), e o corpo só leva o que foge do padrão.
 */

/** Os campos do bloco na criação — a contagem de "Dados adicionais · N campos" (os fiscais e o rateio). */
export const QUANTIDADE_DE_DADOS_FISCAIS = CAMPOS_DOS_DADOS_FISCAIS.length + 1;

const TIPOS_DE_DOCUMENTO = enumOptions("document_type");

/** O bloco "Dados fiscais" da criação (dentro dos Dados adicionais). */
export function DadosFiscaisDaCriacao({ e }: { e: EstadoDaCriacao }) {
  if (!e.dadosFiscaisAtivos) return null;
  const f = e.fiscal;
  const cc = (c: ChaveDosDadosFiscais, rotulo: string, o: { preenchido: boolean; icone?: "pesquisa" | "selecao"; testId?: string; dica?: string }, controle: React.ReactElement) =>
    <CampoDaCentral key={c} rotulo={rotulo} erro={e.erro(c)} icone={o.icone ?? null} preenchido={o.preenchido} testId={o.testId} dica={o.dica} data-campo-fiscal={c}>{controle}</CampoDaCentral>;
  const valor = (c: "valor_ipi" | "valor_icms_st" | "seguro", rotulo: string, testId: string) =>
    cc(c, rotulo, { preenchido: f[c] !== "" },
      <Input data-testid={testId} type="number" step="0.01" min="0" inputMode="decimal" value={f[c]} onChange={(ev) => e.mudarFiscal({ [c]: ev.target.value })} />);
  return <div data-testid="compras-dados-fiscais" className="space-y-1">
    <p className="text-[11px] font-semibold uppercase text-slate-500">Dados fiscais</p>
    <ColunaDeCampos>
      {cc("chave_acesso", "Chave de acesso", { preenchido: f.chave_acesso !== "", dica: "Os 44 dígitos da chave da NF-e (espaços são ignorados)." },
        <Input data-testid="compras-chave-acesso" inputMode="numeric" autoComplete="off" maxLength={60} placeholder="44 dígitos" value={f.chave_acesso}
          onChange={(ev) => e.mudarFiscal({ chave_acesso: ev.target.value })} />)}
      {cc("uf_nota", "UF", { preenchido: f.uf_nota !== "", dica: "A UF do emitente da nota, com duas letras." },
        <Input data-testid="compras-uf-nota" maxLength={2} autoComplete="off" value={f.uf_nota} onChange={(ev) => e.mudarFiscal({ uf_nota: ev.target.value.toUpperCase() })} />)}
      {cc("tipo_documento_fiscal", "Tipo de documento", { preenchido: f.tipo_documento_fiscal !== "", icone: "selecao" },
        <NativeSelect data-testid="compras-tipo-documento-fiscal" value={f.tipo_documento_fiscal} onChange={(ev) => e.mudarFiscal({ tipo_documento_fiscal: ev.target.value })}>
          <option value="">—</option>
          {TIPOS_DE_DOCUMENTO.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </NativeSelect>)}
      {valor("valor_ipi", "IPI", "compras-valor-ipi")}
      {valor("valor_icms_st", "ICMS-ST", "compras-valor-icms-st")}
      {valor("seguro", "Seguro", "compras-seguro")}
      {cc("tipo_titulo_id", "Tipo de título", { preenchido: f.tipo_titulo_id !== "", icone: "pesquisa", testId: "compras-tipo-titulo" },
        <RefSelect resource="title_types" value={f.tipo_titulo_id} onChange={(v) => e.mudarFiscal({ tipo_titulo_id: v ?? "" })} />)}
      {cc("classificacao_gasto", "Classificação", { preenchido: true, icone: "selecao" },
        <NativeSelect data-testid="compras-classificacao-gasto" value={f.classificacao_gasto} onChange={(ev) => e.mudarFiscal({ classificacao_gasto: ev.target.value })}>
          <option value="">{enumLabel("classification", "unclassified")}</option>
          <option value="capex">{enumLabel("classificacao_gasto", "capex")}</option>
          <option value="opex">{enumLabel("classificacao_gasto", "opex")}</option>
        </NativeSelect>)}
    </ColunaDeCampos>
    <RateioEItensDaCriacao e={e} />
  </div>;
}

const TIPOS_DE_RATEIO: readonly TipoDoRateioDaCompra[] = ["documento", "por_valor", "por_produto"];

/** O rateio da compra e a classificação de cada item da grade (gera estoque, imobilizado, natureza e centro). */
function RateioEItensDaCriacao({ e }: { e: EstadoDaCriacao }) {
  const r = e.rateio;
  // O caminho da recusa nos dois formatos do servidor (`itens[0].x` das regras, `itens.0.x` do esquema).
  const erroEm = (base: string, k: number, campo: string) => e.erro(`${base}[${k}].${campo}`) ?? e.erro(`${base}.${k}.${campo}`);
  return <div data-testid="compras-rateio-e-itens" className="mt-2 space-y-2">
    <p className="text-[11px] font-semibold uppercase text-slate-500">Rateio e itens</p>
    <CampoDaCentral rotulo="Rateio" erro={e.erro("rateio")} icone="selecao" preenchido testId="compras-rateio">
      <NativeSelect data-testid="compras-rateio-tipo" value={r.tipo}
        onChange={(ev) => e.mudarTipoDoRateio(TIPOS_DE_RATEIO.find((t) => t === ev.target.value) ?? "documento")}>
        {TIPOS_DE_RATEIO.map((t) => <option key={t} value={t}>{enumLabel("rateio_compra", t)}</option>)}
      </NativeSelect>
    </CampoDaCentral>
    {r.tipo !== "documento" && <p className="text-[12px] text-slate-600">Com rateio, a natureza e o centro de resultado do documento ficam em branco: quem classifica as contas a pagar é o rateio.</p>}
    {r.tipo === "por_valor" && <div className="space-y-2">
      {r.linhas.map((l, k) => <div key={k} data-testid={`compras-rateio-linha-${k}`} className="grid grid-cols-12 items-end gap-2 rounded border px-2 py-2 text-[12.5px]">
        <label className="col-span-12 md:col-span-3">Natureza *
          <RefSelect resource="financial_categories" value={l.categoriaId} buscarOpcoes={opcoesDeNaturezaDeDespesa} onChange={(v) => e.mudarLinhaDoRateio(k, { categoriaId: v ?? "" })} />
          {erroEm("rateio.linhas", k, "categoria_financeira_id") && <span className="text-[11px] text-red-600">{erroEm("rateio.linhas", k, "categoria_financeira_id")}</span>}
        </label>
        <label className="col-span-12 md:col-span-3">Centro de resultado *
          <RefSelect resource="cost_centers" value={l.centroId} filter={{ kind: "analytic" }} onChange={(v) => e.mudarLinhaDoRateio(k, { centroId: v ?? "" })} />
          {erroEm("rateio.linhas", k, "centro_custo_id") && <span className="text-[11px] text-red-600">{erroEm("rateio.linhas", k, "centro_custo_id")}</span>}
        </label>
        <label className="col-span-12 md:col-span-2">Conta contábil
          <RefSelect resource="chart_accounts" value={l.contaId} onChange={(v) => e.mudarLinhaDoRateio(k, { contaId: v ?? "" })} />
        </label>
        <label className="col-span-12 md:col-span-2">Safra
          <RefSelect resource="harvests" value={l.safraId} onChange={(v) => e.mudarLinhaDoRateio(k, { safraId: v ?? "" })} />
          {erroEm("rateio.linhas", k, "safra_id") && <span className="text-[11px] text-red-600">{erroEm("rateio.linhas", k, "safra_id")}</span>}
        </label>
        <label className="col-span-8 md:col-span-1">Percentual (%) *
          <Input data-testid={`compras-rateio-linha-${k}-percentual`} inputMode="decimal" value={l.percentual} onChange={(ev) => e.mudarLinhaDoRateio(k, { percentual: ev.target.value })} />
          {erroEm("rateio.linhas", k, "percentual") && <span className="text-[11px] text-red-600">{erroEm("rateio.linhas", k, "percentual")}</span>}
        </label>
        <div className="col-span-4 md:col-span-1">{r.linhas.length > 1 && <Button size="sm" variant="ghost" onClick={() => e.removerLinhaDoRateio(k)}>Remover</Button>}</div>
      </div>)}
      <div className="flex items-center gap-3 text-[12.5px]">
        <Button size="sm" variant="outline" data-testid="compras-rateio-adicionar" onClick={e.adicionarLinhaDoRateio} disabled={r.linhas.length >= 50}>Adicionar linha</Button>
        <span data-testid="compras-rateio-soma">Soma: {somaDoRateio(r)}%</span>
      </div>
    </div>}
    {e.itens.length > 0 && <ul className="space-y-1.5 text-[12.5px]" data-testid="compras-itens-classificacao">
      {e.itens.map((it, k) => <li key={k} data-testid={`compras-item-classificacao-${k}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded border px-2 py-1.5">
        <span className="font-medium">Item {k + 1}</span>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" data-testid={`compras-item-${k}-gera-estoque`} checked={itemGeraEstoque(it)} onChange={(ev) => e.mudarClassificacaoDoItem(k, { geraEstoque: ev.target.checked })} />
          Gera estoque
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" data-testid={`compras-item-${k}-imobilizado`} checked={itemImobilizado(it)} onChange={(ev) => e.mudarClassificacaoDoItem(k, { imobilizado: ev.target.checked })} />
          Imobilizado (cria o bem na confirmação)
        </label>
        {r.tipo === "por_produto" && <>
          <label className="min-w-[14rem] flex-1">Natureza de despesa do item *
            <RefSelect resource="financial_categories" value={naturezaDoItem(it)} buscarOpcoes={opcoesDeNaturezaDeDespesa} onChange={(v) => e.mudarClassificacaoDoItem(k, { natureza: v ?? "" })} />
          </label>
          <label className="min-w-[14rem] flex-1">Centro de resultado do item *
            <RefSelect resource="cost_centers" value={centroDoItem(it)} filter={{ kind: "analytic" }} onChange={(v) => e.mudarClassificacaoDoItem(k, { centro: v ?? "" })} />
          </label>
        </>}
        {(["gera_estoque", "imobilizado", "categoria_financeira_id", "centro_custo_id"] as const).map((c) => erroEm("itens", k, c)
          ? <span key={c} className="w-full text-[11px] text-red-600">{erroEm("itens", k, c)}</span> : null)}
      </li>)}
    </ul>}
  </div>;
}

/* ═════════════════════════════════════ CONSULTA ═════════════════════════════════════ */

const texto = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(v));
const ehTexto = (v: unknown): v is string => typeof v === "string" && v !== "";
const ehObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** "3526 1012 3456 …" — a chave em grupos de 4, como no DANFE (só apresentação; o valor é o do servidor). */
export const chaveFormatada = (chave: string) => (/^\d{44}$/.test(chave) ? chave.replace(/(\d{4})(?=\d)/g, "$1 ") : chave);

/** O valor fiscal que a compra TEM (coluna preenchida no servidor). */
const temValor = (v: unknown) => v !== null && v !== undefined && v !== "";

/** O detalhe da compra traz algum dado fiscal da F7? (Sem nenhum: a compra de hoje, nada novo aparece.) */
export function temDadosFiscais(d: Row | undefined): boolean {
  if (!d) return false;
  return ["chave_acesso", "uf_nota", "tipo_documento_fiscal", "valor_ipi", "valor_icms_st", "seguro", "tipo_titulo_id", "classificacao_gasto", "rateio_tipo", "importacao_id"]
    .some((c) => temValor(d[c])) || ehObj(d["dfe"]);
}

/** A seção "Dados fiscais" da consulta (`compras-consulta-dados-fiscais`), só com algum campo preenchido. */
export function DadosFiscaisDaConsulta({ d }: { d: Row }) {
  const { can } = useAuth();
  if (!temDadosFiscais(d)) return null;
  const dfe = ehObj(d["dfe"]) ? d["dfe"] : null;
  const importacaoId = ehTexto(d["importacao_id"]) ? d["importacao_id"] : "";
  const tipoTitulo = texto(d["tipo_titulo_nome"]) || (temValor(d["tipo_titulo_id"]) ? "Informado" : "");
  const classificacao = ehTexto(d["classificacao_gasto"]) ? enumLabel("classificacao_gasto", d["classificacao_gasto"]) : enumLabel("classification", "unclassified");
  const dinheiro = (c: string) => (temValor(d[c]) ? brl(String(d[c])) : "");
  return <div data-testid="compras-consulta-dados-fiscais" className="space-y-1">
    <p className="text-[11px] font-semibold uppercase text-slate-500">Dados fiscais</p>
    <ColunaDeCampos>
      <CampoLeitura rotulo="Chave de acesso" adorno="travado" testId="compras-consulta-chave" valor={ehTexto(d["chave_acesso"]) ? chaveFormatada(d["chave_acesso"]) : ""} />
      <CampoLeitura rotulo="UF" adorno="travado" testId="compras-consulta-uf" valor={texto(d["uf_nota"])} />
      <CampoLeitura rotulo="Tipo de documento" adorno="travado" testId="compras-consulta-tipo-documento" valor={ehTexto(d["tipo_documento_fiscal"]) ? enumLabel("document_type", d["tipo_documento_fiscal"]) : ""} />
      <CampoLeitura rotulo="IPI" testId="compras-consulta-ipi" valor={dinheiro("valor_ipi")} />
      <CampoLeitura rotulo="ICMS-ST" testId="compras-consulta-icms-st" valor={dinheiro("valor_icms_st")} />
      <CampoLeitura rotulo="Seguro" testId="compras-consulta-seguro" valor={dinheiro("seguro")} />
      <CampoLeitura rotulo="Tipo de título" adorno="pesquisa" testId="compras-consulta-tipo-titulo" valor={tipoTitulo} />
      <CampoLeitura rotulo="Classificação" adorno="travado" testId="compras-consulta-classificacao" valor={classificacao} />
      {importacaoId && <CampoLeitura rotulo="Importação do XML" adorno="travado" testId="compras-consulta-importacao"
        valor={<Link className="text-brand-700 underline" href={`/compras/importacoes/${importacaoId}`}>Abrir a conferência da nota</Link>} />}
      {dfe && <CampoLeitura rotulo="DF-e" adorno="travado" testId="compras-consulta-dfe"
        valor={can("dfe.view")
          ? <Link className="text-brand-700 underline" href="/estoque?tab=recebimentos&sub=dfe">Vinculada · ver a fila de DF-e</Link>
          : "Vinculada"} />}
    </ColunaDeCampos>
  </div>;
}

/** "60.0000" → "60%", "33.3333" → "33,3333%": o decimal do servidor (até 4 casas), sem zeros à direita e com a vírgula da tela. */
export function percentualDaTela(v: unknown): string {
  try { return `${D(String(v ?? "0")).toString().replace(".", ",")}%`; } catch { return "—"; }
}
const codigoENome = (codigo: unknown, nome: unknown) => [texto(codigo), texto(nome)].filter(Boolean).join(" — ") || "—";
const COLUNAS_DO_RATEIO: { key: string; label: string; render: (r: Row) => React.ReactNode; align?: "right" }[] = [
  { key: "categoria", label: "Natureza", render: (r) => codigoENome(r["categoria_financeira_codigo"], r["categoria_financeira_nome"]) },
  { key: "centro", label: "Centro de resultado", render: (r) => codigoENome(r["centro_custo_codigo"], r["centro_custo_nome"]) },
  { key: "conta", label: "Conta contábil", render: (r) => codigoENome(r["conta_contabil_codigo"], r["conta_contabil_nome"]) },
  { key: "safra", label: "Safra", render: (r) => texto(r["safra_nome"]) || "—" },
  { key: "percentual", label: "Percentual", align: "right", render: (r) => percentualDaTela(r["percentual"]) }
];

/**
 * O RATEIO da compra (`compras-consulta-rateio`): por valor, as linhas que o detalhe trouxe; por produto, a frase (a
 * natureza e o centro estão em cada item). Sem rateio, nada.
 */
export function RateioDaConsulta({ d }: { d: Row }) {
  const tipo = d["rateio_tipo"];
  if (tipo !== "por_valor" && tipo !== "por_produto") return null;
  const linhas = Array.isArray(d["rateio"]) ? (d["rateio"] as unknown[]).filter(ehObj) as Row[] : [];
  return <div data-testid="compras-consulta-rateio" data-tipo={tipo} className="space-y-1">
    <p className="text-[11px] font-semibold uppercase text-slate-500">Rateio {tipo === "por_valor" ? "por valor" : "por produto"}</p>
    {tipo === "por_valor"
      ? <SimpleTable rows={linhas} cols={COLUNAS_DO_RATEIO} />
      : <p className="text-[12.5px] text-slate-600">Cada item leva a própria natureza e o próprio centro de resultado; as contas a pagar somam os itens de cada par.</p>}
  </div>;
}

/**
 * Os BENS criados pela confirmação dos itens imobilizados: um por item que tem `bem_codigo` (`compras-consulta-bem-<posicao>`).
 * Sem bem, nada.
 */
export function BensDaConsulta({ itens }: { itens: readonly Row[] }) {
  const { can } = useAuth();
  const comBem = itens.filter((it) => ehTexto(it["bem_codigo"]));
  if (!comBem.length) return null;
  return <div data-testid="compras-consulta-bens" className="space-y-1 text-[12.5px]">
    <p className="text-[11px] font-semibold uppercase text-slate-500">Bens do imobilizado</p>
    <ul className="space-y-0.5">
      {comBem.map((it, i) => {
        const posicao = texto(it["posicao"]) || String(i);
        const bemId = ehTexto(it["bem_id"]) ? it["bem_id"] : "";
        const codigo = String(it["bem_codigo"]);
        return <li key={`${posicao}:${codigo}`} data-testid={`compras-consulta-bem-${posicao}`}>
          Item {Number(posicao) + 1} · {texto(it["produto_nome"]) || "—"}: bem{" "}
          {bemId && can("equipments.view")
            ? <Link className="text-brand-700 underline" href={`/cadastros/equipments/${bemId}`}>{codigo}</Link>
            : <span className="font-mono">{codigo}</span>}
        </li>;
      })}
    </ul>
  </div>;
}
