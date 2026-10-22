"use client";
import * as React from "react";
import Link from "next/link";
import { enumLabel, enumOptions } from "@/lib/copy";
import { D } from "@agro/shared";
import { brl, num } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { AVISO_PADRAO_INVALIDO_CENTRAL } from "@agro/domain";
import { Button, Input } from "@/components/ui";
import { MgSelect } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { CampoDaCentral, CampoLeitura, ColunaDeCampos } from "@/features/central/campo";
import type { Row } from "@/features/docs/shared";
import {
  opcoesDeNaturezaDeDespesa, percentualDoValorDoRateio, somaDoRateio, valorDoPercentualDoRateio,
  type ChaveDosDadosFiscais, type EstadoDaCriacao
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
 *   · CLASSIFICAÇÃO E RATEIO (`RateioEItensDaCriacao`, `compras-rateio-e-itens`, decisão 325): classificação única
 *     (Natureza Financeira + Centro de Resultado) por padrão; “Adicionar rateio por valor” sob demanda. Sem seletor
 *     `Como classificar` / `por_produto` para compras novas; legado por_produto só em leitura. RATEIO-01 (316): mora
 *     na aba do painel (`criacao-painel.tsx` / `rateio-no-rodape.ts`), nunca nos Dados principais.
 */

const TIPOS_DE_DOCUMENTO = enumOptions("document_type");

/** Classificação do gasto (sem cadastro: lista fixa do domínio) — no seletor padrão, nunca no `<select>` nativo. */
const CLASSIFICACOES: { value: string; label: string }[] = [
  { value: "", label: enumLabel("classification", "unclassified") },
  { value: "capex", label: enumLabel("classificacao_gasto", "capex") },
  { value: "opex", label: enumLabel("classificacao_gasto", "opex") }
];

/**
 * O bloco "Dados fiscais" da criação (dentro dos Dados adicionais).
 *
 * LANCAMENTO-01 (decisão 311): o TIPO DE TÍTULO é um padrão da TOP. O estado o semeia no campo vazio (e o tira do corpo
 * enquanto for o semeado: a confirmação usa o da TOP); aqui só se desenha, com os MESMOS recursos dos campos do
 * cabeçalho — a dica ao `RefSelect` (o nome do tipo), `data-padrao-top="semeado"` no invólucro, o aviso de padrão
 * inválido de hoje e a trava da TOP que não deixa trocar pelo mesmo `fieldset` de sempre. Sem a TOP valer, nada muda.
 */
/**
 * Bloco fiscal da criação. Com `noPainel`, vai na aba Fiscal (sem título "DADOS FISCAIS");
 * tipo de documento → Dados principais; classificação → Rateio; seguro → faixa de totais.
 */
export function DadosFiscaisDaCriacao({ e, noPainel = false }: { e: EstadoDaCriacao; noPainel?: boolean }) {
  if (!e.editarFiscal) return null;
  const f = e.fiscal;
  const cc = (c: ChaveDosDadosFiscais, rotulo: string, o: { preenchido: boolean; icone?: "pesquisa" | "selecao"; testId?: string; dica?: string; abaixo?: React.ReactNode }, controle: React.ReactElement) =>
    <CampoDaCentral key={c} rotulo={rotulo} erro={e.erro(c)} icone={o.icone ?? null} preenchido={o.preenchido} testId={o.testId} dica={o.dica} abaixo={o.abaixo} data-campo-fiscal={c}
      {...(e.semeadoPelaTop(c) ? { "data-padrao-top": "semeado" } : {})}>{controle}</CampoDaCentral>;
  const valor = (c: "valor_ipi" | "valor_icms_st" | "seguro", rotulo: string, testId: string) =>
    cc(c, rotulo, { preenchido: f[c] !== "" },
      <Input data-testid={testId} type="number" step="0.01" min="0" inputMode="decimal" value={f[c]} onChange={(ev) => e.mudarFiscal({ [c]: ev.target.value })} />);
  return <div data-testid="compras-dados-fiscais" className="space-y-1">
    <ColunaDeCampos>
      {cc("chave_acesso", "Chave de acesso", { preenchido: f.chave_acesso !== "", dica: "Os 44 dígitos da chave da NF-e (espaços são ignorados)." },
        <Input data-testid="compras-chave-acesso" inputMode="numeric" autoComplete="off" maxLength={60} placeholder="44 dígitos" value={f.chave_acesso}
          onChange={(ev) => e.mudarFiscal({ chave_acesso: ev.target.value })} />)}
      {cc("uf_nota", "UF do emitente", { preenchido: f.uf_nota !== "", dica: "A UF do emitente da nota, com duas letras." },
        <Input data-testid="compras-uf-nota" maxLength={2} autoComplete="off" value={f.uf_nota} onChange={(ev) => e.mudarFiscal({ uf_nota: ev.target.value.toUpperCase() })} />)}
      {!noPainel && cc("tipo_documento_fiscal", "Tipo de documento", { preenchido: f.tipo_documento_fiscal !== "", icone: "selecao" },
        <MgSelect data-testid="compras-tipo-documento-fiscal" value={f.tipo_documento_fiscal} onChange={(v) => e.mudarFiscal({ tipo_documento_fiscal: v })}
          allowEmpty placeholder="—" options={TIPOS_DE_DOCUMENTO} />)}
      {valor("valor_ipi", "IPI", "compras-valor-ipi")}
      {valor("valor_icms_st", "ICMS-ST", "compras-valor-icms-st")}
      {!noPainel && valor("seguro", "Seguro", "compras-seguro")}
      {!noPainel && (() => {
        const tipoTitulo = cc("tipo_titulo_id", "Tipo de título", {
          preenchido: f.tipo_titulo_id !== "", icone: "pesquisa", testId: "compras-tipo-titulo",
          abaixo: e.padraoInvalido("tipo_titulo_id") ? <p data-testid="padrao-invalido-aviso" className="mt-0.5 text-[11px] text-amber-700">{AVISO_PADRAO_INVALIDO_CENTRAL}</p> : undefined
        }, <RefSelect resource="title_types" value={f.tipo_titulo_id} onChange={(v) => e.mudarFiscal({ tipo_titulo_id: v ?? "" })} labelHint={e.dica("tipo_titulo_id")} />);
        return e.travado("tipo_titulo_id")
          ? <fieldset key="tipo_titulo_id" disabled data-editavel="false" data-travado-pela-top="true" style={{ display: "contents" }}>{tipoTitulo}</fieldset>
          : tipoTitulo;
      })()}
      {!noPainel && cc("classificacao_gasto", "Classificação", { preenchido: true, icone: "selecao" },
        <MgSelect data-testid="compras-classificacao-gasto" value={f.classificacao_gasto} onChange={(v) => e.mudarFiscal({ classificacao_gasto: v })} options={CLASSIFICACOES} />)}
    </ColunaDeCampos>
  </div>;
}

/** Tipo de título na aba Financeiro (único local de edição quando o fiscal está no painel). */
export function TipoDeTituloDaCriacao({ e }: { e: EstadoDaCriacao }) {
  if (!e.editarFiscal && !e.editarRateio) return null;
  const f = e.fiscal;
  const campo = <CampoDaCentral rotulo="Tipo de título" erro={e.erro("tipo_titulo_id")} icone="pesquisa" preenchido={f.tipo_titulo_id !== ""} testId="compras-tipo-titulo"
    abaixo={e.padraoInvalido("tipo_titulo_id") ? <p data-testid="padrao-invalido-aviso" className="mt-0.5 text-[11px] text-amber-700">{AVISO_PADRAO_INVALIDO_CENTRAL}</p> : undefined}
    data-campo-fiscal="tipo_titulo_id" {...(e.semeadoPelaTop("tipo_titulo_id") ? { "data-padrao-top": "semeado" } : {})}>
    <RefSelect resource="title_types" value={f.tipo_titulo_id} onChange={(v) => e.mudarFiscal({ tipo_titulo_id: v ?? "" })} labelHint={e.dica("tipo_titulo_id")} />
  </CampoDaCentral>;
  return e.travado("tipo_titulo_id")
    ? <fieldset disabled data-editavel="false" data-travado-pela-top="true" style={{ display: "contents" }}>{campo}</fieldset>
    : campo;
}

type LinhaRateioNaTela = { categoriaId: string; centroId: string; contaId: string; safraId: string; percentual: string };

/**
 * Uma linha do rateio — MESMOS CampoDaCentral da Central (cor, caixa, ícone, rótulo à frente).
 * Conta Contábil e Safra sempre desenhados; sem grade paralela nem rótulo duplicado.
 */
function LinhaDoRateio({
  e, k, l, unica, onMudar, onRemover,
}: {
  e: EstadoDaCriacao; k: number; l: LinhaRateioNaTela; unica: boolean;
  onMudar: (p: Partial<LinhaRateioNaTela>) => void; onRemover?: () => void;
}) {
  const erroEm = (campo: string) => e.erro(`rateio.linhas[${k}].${campo}`) ?? e.erro(`rateio.linhas.${k}.${campo}`)
    ?? (unica && (campo === "categoria_financeira_id" || campo === "centro_custo_id") ? e.erro(campo) : undefined);
  const base = String(e.totalExibido ?? "0");
  const valorExibido = valorDoPercentualDoRateio(base, l.percentual);
  return <div data-testid={`compras-rateio-linha-${k}`} className="space-y-1">
    <ColunaDeCampos>
      <CampoDaCentral rotulo="Natureza Financeira" obrigatorio erro={erroEm("categoria_financeira_id")} icone="pesquisa" preenchido={Boolean(l.categoriaId)}
        testId={unica ? "compras-classificacao-natureza" : `compras-rateio-linha-${k}-natureza`}>
        <RefSelect resource="financial_categories" value={l.categoriaId} buscarOpcoes={opcoesDeNaturezaDeDespesa}
          onChange={(v) => onMudar({ categoriaId: v ?? "" })} labelHint={unica ? e.dica("categoria_financeira_id") : undefined} />
      </CampoDaCentral>
      <CampoDaCentral rotulo="Centro de Resultado" obrigatorio erro={erroEm("centro_custo_id")} icone="pesquisa" preenchido={Boolean(l.centroId)}
        testId={unica ? "compras-classificacao-centro" : `compras-rateio-linha-${k}-centro`}>
        <RefSelect resource="cost_centers" value={l.centroId} filter={{ kind: "analytic" }}
          onChange={(v) => onMudar({ centroId: v ?? "" })} labelHint={unica ? e.dica("centro_custo_id") : undefined} />
      </CampoDaCentral>
      <CampoDaCentral rotulo="Conta Contábil" icone="pesquisa" preenchido={Boolean(l.contaId)}
        testId={`compras-rateio-linha-${k}-conta`}>
        <RefSelect resource="chart_accounts" value={l.contaId} onChange={(v) => onMudar({ contaId: v ?? "" })} />
      </CampoDaCentral>
      <CampoDaCentral rotulo="Safra" icone="pesquisa" erro={erroEm("safra_id")} preenchido={Boolean(l.safraId)}
        testId={`compras-rateio-linha-${k}-safra`}>
        <RefSelect resource="harvests" value={l.safraId} onChange={(v) => onMudar({ safraId: v ?? "" })} />
      </CampoDaCentral>
      <CampoDaCentral rotulo="Percentual (%)" obrigatorio erro={erroEm("percentual")} preenchido={l.percentual !== ""}>
        <Input data-testid={`compras-rateio-linha-${k}-percentual`} inputMode="decimal" value={l.percentual}
          onChange={(ev) => onMudar({ percentual: ev.target.value })} />
      </CampoDaCentral>
      <CampoDaCentral rotulo="Valor" preenchido={valorExibido !== ""}>
        <Input data-testid={`compras-rateio-linha-${k}-valor`} inputMode="decimal" value={valorExibido}
          onChange={(ev) => onMudar({ percentual: percentualDoValorDoRateio(base, ev.target.value) })} />
      </CampoDaCentral>
    </ColunaDeCampos>
    {onRemover && <div className="pt-0.5">
      <Button size="sm" variant="ghost" data-testid={`compras-rateio-linha-${k}-remover`} onClick={onRemover}>Remover linha</Button>
    </div>}
  </div>;
}

/**
 * Rateio e classificação: campos padrão da Central (CampoDaCentral), Conta Contábil/Safra/CAPEX sempre à vista.
 * Sem SimpleTable, sem grade com rótulo duplicado. Sem itens na aba; legado por_produto só em leitura.
 */
export function RateioEItensDaCriacao({ e }: { e: EstadoDaCriacao }) {
  if (!e.editarRateio) return null;
  const r = e.rateio;
  const f = e.fiscal;
  const h = e.cabecalho;
  const legadoPorProduto = r.tipo === "por_produto";
  const porValor = r.tipo === "por_valor";
  /** Uma linha na tela: por_valor usa as linhas; classificação única (documento) = par do cabeçalho a 100%. */
  const linhasNaTela: LinhaRateioNaTela[] = porValor
    ? r.linhas
    : [{
        categoriaId: h.categoria_financeira_id, centroId: h.centro_custo_id,
        contaId: "", safraId: "", percentual: "100",
      }];
  const base = (() => { try { return D(String(e.totalExibido ?? "0")); } catch { return D(0); } })();
  const valorUsado = linhasNaTela.reduce((a, l) => {
    try { return a.plus(base.times(D(l.percentual || "0")).div(100)); } catch { return a; }
  }, D(0));
  const diferenca = base.minus(valorUsado);
  const somaPct = porValor ? somaDoRateio(r) : "100";

  const mudarLinha = (k: number, p: Partial<LinhaRateioNaTela>) => {
    if (!porValor) {
      const precisaDividir = Boolean(p.contaId) || Boolean(p.safraId)
        || (p.percentual !== undefined && p.percentual.trim() !== "" && p.percentual.trim() !== "100");
      if (precisaDividir) {
        e.ativarRateioPorValor({
          ...(p.categoriaId !== undefined ? { categoriaId: p.categoriaId } : {}),
          ...(p.centroId !== undefined ? { centroId: p.centroId } : {}),
          ...(p.contaId !== undefined ? { contaId: p.contaId } : {}),
          ...(p.safraId !== undefined ? { safraId: p.safraId } : {}),
          ...(p.percentual !== undefined ? { percentual: p.percentual } : {}),
        });
        return;
      }
      if (p.categoriaId !== undefined) e.mudar({ categoria_financeira_id: p.categoriaId });
      if (p.centroId !== undefined) e.mudar({ centro_custo_id: p.centroId });
      return;
    }
    e.mudarLinhaDoRateio(k, p);
  };
  const adicionarLinha = () => {
    if (!porValor) {
      e.ativarRateioPorValor(undefined, { categoriaId: "", centroId: "", contaId: "", safraId: "", percentual: "" });
      return;
    }
    e.adicionarLinhaDoRateio();
  };

  return <div data-testid="compras-rateio-e-itens" className="mt-1 space-y-3">
    <div data-testid="compras-rateio" className="space-y-3">
      {legadoPorProduto ? (
        <div data-testid="compras-rateio-legado-por-produto" className="space-y-2 rounded-md border border-amber-100 bg-amber-50/40 px-3 py-2">
          <p className="text-[12px] text-slate-600">
            Esta compra foi gravada com classificação por item. A classificação permanece; novas compras usam os campos de rateio.
          </p>
        </div>
      ) : (
        <div data-testid={porValor ? "compras-rateio-por-valor" : "compras-classificacao-unica"} className="space-y-3">
          {linhasNaTela.map((l, k) => (
            <LinhaDoRateio key={k} e={e} k={k} l={l} unica={linhasNaTela.length === 1}
              onMudar={(p) => mudarLinha(k, p)}
              onRemover={porValor && r.linhas.length > 1 ? () => e.removerLinhaDoRateio(k) : undefined} />
          ))}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            <Button size="sm" variant="outline" data-testid="compras-rateio-adicionar" onClick={adicionarLinha}
              disabled={porValor && r.linhas.length >= 50}>Adicionar linha</Button>
            <span data-testid="compras-rateio-base" className="text-slate-600">Base: {num(e.totalExibido, 2)}</span>
            <span data-testid="compras-rateio-soma" className="ml-auto text-slate-600">
              Soma: {somaPct}% | Valor: {num(valorUsado.toFixed(2), 2)} | Diferença: {num(diferenca.toFixed(2), 2)}
            </span>
          </div>
          {e.erro("rateio") && <p className="text-[12px] text-red-600" data-parte="erro">{e.erro("rateio")}</p>}
        </div>
      )}
    </div>

    <ColunaDeCampos>
      <CampoDaCentral rotulo="Classificação CAPEX/OPEX" erro={e.erro("classificacao_gasto")} icone="selecao" preenchido
        testId="compras-classificacao-gasto-campo">
        <MgSelect data-testid="compras-classificacao-gasto" value={f.classificacao_gasto}
          onChange={(v) => e.mudarFiscal({ classificacao_gasto: v })} options={CLASSIFICACOES} />
      </CampoDaCentral>
    </ColunaDeCampos>
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
  const dinheiro = (c: string) => (temValor(d[c]) ? brl(String(d[c])) : "");
  return <div data-testid="compras-consulta-dados-fiscais" className="space-y-1">
    <ColunaDeCampos>
      <CampoLeitura rotulo="Chave de acesso" adorno="travado" testId="compras-consulta-chave" valor={ehTexto(d["chave_acesso"]) ? chaveFormatada(d["chave_acesso"]) : ""} />
      <CampoLeitura rotulo="UF do emitente" adorno="travado" testId="compras-consulta-uf" valor={texto(d["uf_nota"])} />
      <CampoLeitura rotulo="Tipo de documento" adorno="travado" testId="compras-consulta-tipo-documento" valor={ehTexto(d["tipo_documento_fiscal"]) ? enumLabel("document_type", d["tipo_documento_fiscal"]) : ""} />
      <CampoLeitura rotulo="IPI" testId="compras-consulta-ipi" valor={dinheiro("valor_ipi")} />
      <CampoLeitura rotulo="ICMS-ST" testId="compras-consulta-icms-st" valor={dinheiro("valor_icms_st")} />
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
const codigoENome = (codigo: unknown, nome: unknown) => [texto(codigo), texto(nome)].filter(Boolean).join(" — ") || "";

/** Uma linha do rateio em LEITURA — mesmos rótulos e CampoLeitura da Central (paridade com a edição). */
function LinhaDoRateioEmLeitura({ l, k }: { l: Row; k: number }) {
  return <div data-testid={`compras-consulta-rateio-linha-${k}`} className="space-y-1">
    <ColunaDeCampos>
      <CampoLeitura rotulo="Natureza Financeira" adorno="pesquisa" testId={k === 0 ? "compras-consulta-rateio-natureza" : undefined}
        valor={codigoENome(l["categoria_financeira_codigo"], l["categoria_financeira_nome"])} />
      <CampoLeitura rotulo="Centro de Resultado" adorno="pesquisa" testId={k === 0 ? "compras-consulta-rateio-centro" : undefined}
        valor={codigoENome(l["centro_custo_codigo"], l["centro_custo_nome"])} />
      <CampoLeitura rotulo="Conta Contábil" adorno="pesquisa" testId={k === 0 ? "compras-consulta-rateio-conta" : `compras-consulta-rateio-linha-${k}-conta`}
        valor={codigoENome(l["conta_contabil_codigo"], l["conta_contabil_nome"])} />
      <CampoLeitura rotulo="Safra" adorno="pesquisa" testId={k === 0 ? "compras-consulta-rateio-safra" : `compras-consulta-rateio-linha-${k}-safra`}
        valor={texto(l["safra_nome"])} />
      <CampoLeitura rotulo="Percentual (%)" testId={k === 0 ? "compras-consulta-rateio-percentual" : undefined}
        valor={percentualDaTela(l["percentual"])} />
    </ColunaDeCampos>
  </div>;
}

/**
 * O RATEIO da compra (`compras-consulta-rateio`): mesmos campos padrão da edição (CampoLeitura).
 * Conta Contábil e Safra sempre à vista; classificação única = uma linha do par do documento.
 */
export function RateioDaConsulta({ d }: { d: Row }) {
  const tipo = d["rateio_tipo"];
  const linhas = Array.isArray(d["rateio"]) ? (d["rateio"] as unknown[]).filter(ehObj) as Row[] : [];
  const itens = Array.isArray(d["itens"]) ? (d["itens"] as unknown[]).filter(ehObj) as Row[] : [];
  if (tipo === "por_produto") {
    return <div data-testid="compras-consulta-rateio" data-tipo={tipo} className="space-y-1">
      <ul className="space-y-2 text-[12.5px]" data-testid="compras-consulta-rateio-por-produto">
        {itens.length === 0
          ? <li className="text-slate-600">Cada item leva a própria natureza e o próprio centro; os nomes dos itens não vieram neste detalhe.</li>
          : itens.map((it, k) => {
              const rotulo = codigoENome(it["produto_codigo"], it["produto_nome"]) || `Item ${k + 1}`;
              return <li key={k} data-testid={`compras-consulta-rateio-item-${k}`} className="space-y-1">
                <p className="text-[12px] font-medium text-slate-700">{rotulo}</p>
                <ColunaDeCampos>
                  <CampoLeitura rotulo="Natureza Financeira" adorno="pesquisa"
                    valor={codigoENome(it["categoria_financeira_codigo"], it["categoria_financeira_nome"])} />
                  <CampoLeitura rotulo="Centro de Resultado" adorno="pesquisa"
                    valor={codigoENome(it["centro_custo_codigo"], it["centro_custo_nome"])} />
                </ColunaDeCampos>
              </li>;
            })}
      </ul>
    </div>;
  }
  const linhasDaTela: Row[] = tipo === "por_valor" ? linhas : [{
    categoria_financeira_codigo: d["categoria_financeira_codigo"],
    categoria_financeira_nome: d["categoria_financeira_nome"],
    centro_custo_codigo: d["centro_custo_codigo"],
    centro_custo_nome: d["centro_custo_nome"],
    conta_contabil_codigo: null, conta_contabil_nome: null, safra_nome: null, percentual: "100",
  }];
  return <div data-testid="compras-consulta-rateio" data-tipo={tipo ?? "documento"} className="space-y-3">
    {linhasDaTela.map((l, k) => <LinhaDoRateioEmLeitura key={k} l={l} k={k} />)}
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
