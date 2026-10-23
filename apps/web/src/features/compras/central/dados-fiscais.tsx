"use client";
import * as React from "react";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { enumLabel, enumOptions } from "@/lib/copy";
import { D } from "@agro/shared";
import { brl, cn, num } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { AVISO_PADRAO_INVALIDO_CENTRAL } from "@agro/domain";
import { Button, Input } from "@/components/ui";
import { MgSelect } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { CampoDaCentral, CampoLeitura, ColunaDeCampos } from "@/features/central/campo";
import grade from "@/features/central/grade.module.css";
import type { Row } from "@/features/docs/shared";
import {
  opcoesDeNaturezaDeDespesa, percentualDoValorDoRateio, valorDoPercentualDoRateio,
  type ChaveDosDadosFiscais, type EstadoDaCriacao
} from "./estado";
import {
  projetarRateioIndependente, somaDasPartes, type ParteDoRateioIndependente
} from "./rateio-independente";

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
 *   · CLASSIFICAÇÃO E RATEIO (`RateioEItensDaCriacao`, decisão 325): duas tabelinhas lado a lado (Natureza × Centro),
 *     cabeçalhos na grade (sem label por campo), “+” no título e “×” na linha; Conta Contábil à parte; Safra nos Dados.
 *     Corpo = produto cruzado das %. RATEIO-01 (316): mora na aba do painel.
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

/** Vista independente a partir do estado (documento = par do cabeçalho a 100%). */
function vistaDoRateio(e: EstadoDaCriacao) {
  const r = e.rateio;
  const h = e.cabecalho;
  if (r.tipo === "por_valor") return projetarRateioIndependente(r.linhas);
  return {
    naturezas: [{ id: h.categoria_financeira_id, percentual: "100" }],
    centros: [{ id: h.centro_custo_id, percentual: "100" }],
    contaId: "",
    safraId: "",
  };
}

type DimensaoDoRateio = "natureza" | "centro";

/** Grade da tabelinha: referência · valor · % · remover — nome com piso largo (Natureza / Centro). */
const GRADE_RATEIO = "grid grid-cols-[minmax(14rem,1.6fr)_96px_64px_28px] items-center gap-1.5";

/**
 * Tabelinha independente (Natureza ou Centro): título + “+”, cabeçalhos na grade, linha com inputs, rodapé Total/Restante.
 * Conta Contábil e Safra ficam fora desta grade.
 */
function TabelaDoRateioIndependente({
  e, dimensao, partes, unica, onMudar, onAdicionar, onRemover,
}: {
  e: EstadoDaCriacao; dimensao: DimensaoDoRateio; partes: ParteDoRateioIndependente[]; unica: boolean;
  onMudar: (k: number, p: Partial<ParteDoRateioIndependente>) => void;
  onAdicionar: () => void; onRemover: (k: number) => void;
}) {
  const prefixo = dimensao === "natureza" ? "compras-rateio-natureza" : "compras-rateio-centro";
  const titulo = dimensao === "natureza" ? "Rateio Natureza Financeira" : "Rateio Centro de Custo";
  const colRef = dimensao === "natureza" ? "Natureza" : "Centro de Custo";
  const campoDoc = dimensao === "natureza" ? "categoria_financeira_id" : "centro_custo_id";
  const base = (() => { try { return D(String(e.totalExibido ?? "0")); } catch { return D(0); } })();
  const valorUsado = partes.reduce((a, p) => {
    try { return a.plus(base.times(D(p.percentual || "0")).div(100)); } catch { return a; }
  }, D(0));
  const restante = base.minus(valorUsado);

  return <div data-testid={prefixo} className="overflow-hidden rounded-md border border-slate-200">
    <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-100 px-2 py-1.5">
      <p className="text-[12px] font-semibold text-slate-700">
        {titulo} <span className="text-rose-600" aria-hidden>*</span>
      </p>
      <button type="button" className={cn("app-circulo-28", grade.botao, grade.botaoAdicionar)}
        data-testid={`${prefixo}-adicionar`} disabled={partes.length >= 50}
        aria-label={`Adicionar ${dimensao === "natureza" ? "natureza" : "centro de custo"}`}
        title="Adicionar" onClick={onAdicionar}>
        <Plus aria-hidden />
      </button>
    </div>

    <div aria-hidden className={GRADE_RATEIO + " border-b border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-500"}>
      <span>{colRef}</span>
      <span className="text-right">Valor (R$)</span>
      <span className="text-right">%</span>
      <span />
    </div>

    <div className="divide-y divide-slate-100">
      {partes.map((parte, k) => {
        const valorExibido = valorDoPercentualDoRateio(String(e.totalExibido ?? "0"), parte.percentual);
        const erroEm = e.erro(`rateio.linhas[${k}].${campoDoc}`) ?? e.erro(`rateio.linhas.${k}.${campoDoc}`)
          ?? (unica && partes.length === 1 ? e.erro(campoDoc) : undefined);
        const dc = unica && partes.length === 1
          ? {
              "data-campo": campoDoc,
              ...(e.semeadoPelaTop(campoDoc) ? { "data-padrao-top": "semeado" as const } : {}),
              ...(e.layout ? { "data-obrigatorio": String(e.obrigatorio(campoDoc)) } : {}),
            }
          : {};
        const refSelect = dimensao === "natureza"
          ? <RefSelect resource="financial_categories" value={parte.id} buscarOpcoes={opcoesDeNaturezaDeDespesa}
              onChange={(v) => onMudar(k, { id: v ?? "" })} labelHint={unica ? e.dica("categoria_financeira_id") : undefined} />
          : <RefSelect resource="cost_centers" value={parte.id} filter={{ kind: "analytic" }}
              onChange={(v) => onMudar(k, { id: v ?? "" })} labelHint={unica ? e.dica("centro_custo_id") : undefined} />;
        const celulaRef = <div
          data-testid={unica && partes.length === 1
            ? (dimensao === "natureza" ? "compras-classificacao-natureza" : "compras-classificacao-centro")
            : `${prefixo}-linha-${k}-ref`}
          className="min-w-0" {...dc}>
          {refSelect}
          {erroEm && <p className="mt-0.5 text-[11px] text-red-600">{erroEm}</p>}
        </div>;
        const envolvido = unica && partes.length === 1 && e.travado(campoDoc)
          ? <fieldset disabled data-editavel="false"
              data-travado-pela-top={e.travadoPelaTop(campoDoc) ? "true" : undefined}
              data-travado-na-edicao={e.travadoNaEdicao(campoDoc) ? "true" : undefined}
              data-motivo={e.motivoNaEdicao(campoDoc) ?? undefined}
              style={{ display: "contents" }}>{celulaRef}</fieldset>
          : celulaRef;
        return <div key={k} data-testid={`${prefixo}-linha-${k}`} className={GRADE_RATEIO + " px-2 py-1.5"}>
          {envolvido}
          <Input className="min-w-0 text-right tabular-nums" data-testid={`${prefixo}-linha-${k}-valor`}
            inputMode="decimal" placeholder="0,00" value={valorExibido}
            onChange={(ev) => onMudar(k, { percentual: percentualDoValorDoRateio(String(e.totalExibido ?? "0"), ev.target.value) })}
            aria-label={`Valor ${colRef.toLowerCase()} ${k + 1}`} />
          <Input className="min-w-0 text-right tabular-nums" data-testid={`${prefixo}-linha-${k}-percentual`}
            inputMode="decimal" placeholder="0" value={parte.percentual}
            onChange={(ev) => onMudar(k, { percentual: ev.target.value })}
            aria-label={`Percentual ${colRef.toLowerCase()} ${k + 1}`} />
          {partes.length > 1
            ? <Button size="sm" variant="ghost" className="!h-6 !w-6 !min-h-6 !p-0 justify-self-end text-slate-400 hover:text-rose-600"
                data-testid={`${prefixo}-linha-${k}-remover`}
                aria-label={`Remover ${colRef.toLowerCase()} ${k + 1}`} title="Remover"
                onClick={() => onRemover(k)}><X className="h-3.5 w-3.5" aria-hidden /></Button>
            : <span />}
        </div>;
      })}
    </div>

    <div data-testid={`${prefixo}-soma`}
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-emerald-100 bg-emerald-50 px-2 py-1.5 text-[12px] font-semibold text-emerald-800">
      <span>Total: {brl(valorUsado.toFixed(2))}</span>
      <span>Restante: {brl(restante.toFixed(2))}</span>
      <span className="sr-only">Soma: {somaDasPartes(partes)}%</span>
    </div>
  </div>;
}

/**
 * Rateio e classificação: duas tabelinhas lado a lado (Natureza × Centro de Custo).
 * Conta Contábil à parte; Safra nos Dados principais; CAPEX à vista.
 */
export function RateioEItensDaCriacao({ e }: { e: EstadoDaCriacao }) {
  if (!e.editarRateio) return null;
  const r = e.rateio;
  const f = e.fiscal;
  const legadoPorProduto = r.tipo === "por_produto";
  const porValor = r.tipo === "por_valor";
  const vista = vistaDoRateio(e);
  const unica = !porValor;

  const aplicar = (
    naturezas: ParteDoRateioIndependente[],
    centros: ParteDoRateioIndependente[],
    contaId: string,
    safraId: string,
    opts?: { forcarPorValor?: boolean },
  ) => e.aplicarRateioIndependente(naturezas, centros, contaId, safraId, opts);

  const mudarNatureza = (k: number, p: Partial<ParteDoRateioIndependente>) => {
    const naturezas = vista.naturezas.map((l, i) => (i === k ? { ...l, ...p } : l));
    aplicar(naturezas, vista.centros, vista.contaId, vista.safraId);
  };
  const mudarCentro = (k: number, p: Partial<ParteDoRateioIndependente>) => {
    const centros = vista.centros.map((l, i) => (i === k ? { ...l, ...p } : l));
    aplicar(vista.naturezas, centros, vista.contaId, vista.safraId);
  };
  const adicionarNatureza = () => {
    aplicar([...vista.naturezas, { id: "", percentual: "" }], vista.centros, vista.contaId, vista.safraId, { forcarPorValor: true });
  };
  const adicionarCentro = () => {
    aplicar(vista.naturezas, [...vista.centros, { id: "", percentual: "" }], vista.contaId, vista.safraId, { forcarPorValor: true });
  };
  const removerNatureza = (k: number) => {
    if (vista.naturezas.length <= 1) return;
    aplicar(vista.naturezas.filter((_, i) => i !== k), vista.centros, vista.contaId, vista.safraId, { forcarPorValor: true });
  };
  const removerCentro = (k: number) => {
    if (vista.centros.length <= 1) return;
    aplicar(vista.naturezas, vista.centros.filter((_, i) => i !== k), vista.contaId, vista.safraId, { forcarPorValor: true });
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
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <TabelaDoRateioIndependente e={e} dimensao="natureza" partes={vista.naturezas} unica={unica}
              onMudar={mudarNatureza} onAdicionar={adicionarNatureza} onRemover={removerNatureza} />
            <TabelaDoRateioIndependente e={e} dimensao="centro" partes={vista.centros} unica={unica}
              onMudar={mudarCentro} onAdicionar={adicionarCentro} onRemover={removerCentro} />
          </div>
          <p className="text-[12px] text-slate-600" data-testid="compras-rateio-base">Base: {num(e.totalExibido, 2)}</p>
          {e.erro("rateio") && <p className="text-[12px] text-red-600" data-parte="erro">{e.erro("rateio")}</p>}
        </div>
      )}
    </div>

    <ColunaDeCampos>
      <CampoDaCentral rotulo="Conta Contábil" icone="pesquisa" preenchido={Boolean(vista.contaId)}
        testId="compras-rateio-conta">
        <RefSelect resource="chart_accounts" value={vista.contaId}
          onChange={(v) => aplicar(vista.naturezas, vista.centros, v ?? "", vista.safraId, { forcarPorValor: Boolean(v) })} />
      </CampoDaCentral>
      <CampoDaCentral rotulo="Classificação CAPEX/OPEX" erro={e.erro("classificacao_gasto")} icone="selecao" preenchido
        testId="compras-classificacao-gasto-campo">
        <MgSelect data-testid="compras-classificacao-gasto" value={f.classificacao_gasto}
          onChange={(v) => e.mudarFiscal({ classificacao_gasto: v })} options={CLASSIFICACOES} />
      </CampoDaCentral>
    </ColunaDeCampos>
  </div>;
}

/** Safra nos Dados principais (criação) — carimba todas as linhas do rateio; fora das tabelas. */
export function SafraDaCriacao({ e }: { e: EstadoDaCriacao }) {
  if (!e.editarRateio) return null;
  const vista = vistaDoRateio(e);
  const erro = e.erro("rateio.linhas[0].safra_id") ?? e.erro("rateio.linhas.0.safra_id");
  return <CampoDaCentral rotulo="Safra" icone="pesquisa" erro={erro} preenchido={Boolean(vista.safraId)} testId="compras-safra">
    <RefSelect resource="harvests" value={vista.safraId}
      onChange={(v) => e.aplicarRateioIndependente(
        vista.naturezas, vista.centros, vista.contaId, v ?? "",
        { forcarPorValor: Boolean(v) },
      )} />
  </CampoDaCentral>;
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

type ParteLeitura = { id: string; rotulo: string; percentual: string };

/** Agrega linhas pareadas da consulta em Natureza × Centro (mesma regra da edição). */
function projetarLeitura(linhas: readonly Row[]): {
  naturezas: ParteLeitura[]; centros: ParteLeitura[]; conta: string; safra: string;
} {
  const natOrdem: string[] = [];
  const cenOrdem: string[] = [];
  const natSoma = new Map<string, ReturnType<typeof D>>();
  const cenSoma = new Map<string, ReturnType<typeof D>>();
  const natRotulo = new Map<string, string>();
  const cenRotulo = new Map<string, string>();
  let conta = "";
  let safra = "";
  for (const l of linhas) {
    let p: ReturnType<typeof D>;
    try { p = D(String(l["percentual"] ?? "0")); } catch { p = D(0); }
    const nid = texto(l["categoria_financeira_id"]);
    const cid = texto(l["centro_custo_id"]);
    if (!natSoma.has(nid)) { natOrdem.push(nid); natSoma.set(nid, D(0)); natRotulo.set(nid, codigoENome(l["categoria_financeira_codigo"], l["categoria_financeira_nome"])); }
    if (!cenSoma.has(cid)) { cenOrdem.push(cid); cenSoma.set(cid, D(0)); cenRotulo.set(cid, codigoENome(l["centro_custo_codigo"], l["centro_custo_nome"])); }
    natSoma.set(nid, (natSoma.get(nid) ?? D(0)).plus(p));
    cenSoma.set(cid, (cenSoma.get(cid) ?? D(0)).plus(p));
    if (!conta) conta = codigoENome(l["conta_contabil_codigo"], l["conta_contabil_nome"]);
    if (!safra) safra = texto(l["safra_nome"]);
  }
  return {
    naturezas: natOrdem.map((id) => ({ id, rotulo: natRotulo.get(id) ?? "", percentual: (natSoma.get(id) ?? D(0)).toFixed() })),
    centros: cenOrdem.map((id) => ({ id, rotulo: cenRotulo.get(id) ?? "", percentual: (cenSoma.get(id) ?? D(0)).toFixed() })),
    conta, safra,
  };
}

const GRADE_RATEIO_LEITURA = "grid grid-cols-[minmax(14rem,1.6fr)_96px_64px] items-center gap-1.5";

function TabelaLeituraDoRateio({
  titulo, testId, partes, colRef, testIdRef, totalDocumento,
}: {
  titulo: string; testId: string; partes: ParteLeitura[]; colRef: string; testIdRef: string; totalDocumento: string;
}) {
  const base = (() => { try { return D(totalDocumento || "0"); } catch { return D(0); } })();
  const valorUsado = partes.reduce((a, p) => {
    try { return a.plus(base.times(D(p.percentual || "0")).div(100)); } catch { return a; }
  }, D(0));
  const restante = base.minus(valorUsado);
  return <div data-testid={testId} className="overflow-hidden rounded-md border border-slate-200">
    <div className="border-b border-slate-200 bg-slate-100 px-2 py-1.5">
      <p className="text-[12px] font-semibold text-slate-700">{titulo}</p>
    </div>
    <div aria-hidden className={GRADE_RATEIO_LEITURA + " border-b border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-500"}>
      <span>{colRef}</span>
      <span className="text-right">Valor (R$)</span>
      <span className="text-right">%</span>
    </div>
    <div className="divide-y divide-slate-100">
      {partes.map((p, k) => {
        let valor = "";
        try { valor = base.times(D(p.percentual || "0")).div(100).toFixed(2); } catch { valor = ""; }
        return <div key={k} data-testid={`${testId}-linha-${k}`} className={GRADE_RATEIO_LEITURA + " px-2 py-1.5"}>
          <span className="min-w-0 text-[12px] text-slate-700" data-testid={k === 0 ? testIdRef : undefined}>{p.rotulo || "—"}</span>
          <span className="text-right text-[12px] tabular-nums text-slate-900">{valor ? brl(valor) : "—"}</span>
          <span className="text-right text-[12px] tabular-nums text-slate-700">{percentualDaTela(p.percentual)}</span>
        </div>;
      })}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-x-3 border-t border-emerald-100 bg-emerald-50 px-2 py-1.5 text-[12px] font-semibold text-emerald-800">
      <span>Total: {brl(valorUsado.toFixed(2))}</span>
      <span>Restante: {brl(restante.toFixed(2))}</span>
    </div>
  </div>;
}

/**
 * O RATEIO da compra (`compras-consulta-rateio`): duas tabelinhas lado a lado (paridade com a edição).
 * Conta Contábil à parte; Safra nos Dados principais (`SafraDaConsulta`).
 */
export function RateioDaConsulta({ d }: { d: Row }) {
  const tipo = d["rateio_tipo"];
  const linhas = Array.isArray(d["rateio"]) ? (d["rateio"] as unknown[]).filter(ehObj) as Row[] : [];
  const itens = Array.isArray(d["itens"]) ? (d["itens"] as unknown[]).filter(ehObj) as Row[] : [];
  const totalDocumento = temValor(d["valor_total"]) ? String(d["valor_total"]) : "0";
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
    categoria_financeira_id: d["categoria_financeira_id"],
    categoria_financeira_codigo: d["categoria_financeira_codigo"],
    categoria_financeira_nome: d["categoria_financeira_nome"],
    centro_custo_id: d["centro_custo_id"],
    centro_custo_codigo: d["centro_custo_codigo"],
    centro_custo_nome: d["centro_custo_nome"],
    conta_contabil_codigo: null, conta_contabil_nome: null, safra_nome: null, percentual: "100",
  }];
  const vista = projetarLeitura(linhasDaTela);
  return <div data-testid="compras-consulta-rateio" data-tipo={tipo ?? "documento"} className="space-y-3">
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
      <TabelaLeituraDoRateio titulo="Rateio Natureza Financeira" testId="compras-consulta-rateio-natureza-tabela"
        partes={vista.naturezas.length ? vista.naturezas : [{ id: "", rotulo: "", percentual: "100" }]}
        colRef="Natureza" testIdRef="compras-consulta-rateio-natureza" totalDocumento={totalDocumento} />
      <TabelaLeituraDoRateio titulo="Rateio Centro de Custo" testId="compras-consulta-rateio-centro-tabela"
        partes={vista.centros.length ? vista.centros : [{ id: "", rotulo: "", percentual: "100" }]}
        colRef="Centro de Custo" testIdRef="compras-consulta-rateio-centro" totalDocumento={totalDocumento} />
    </div>
    <ColunaDeCampos>
      <CampoLeitura rotulo="Conta Contábil" adorno="pesquisa" testId="compras-consulta-rateio-conta" valor={vista.conta} />
    </ColunaDeCampos>
  </div>;
}

/** Safra nos Dados principais (consulta) — valor carimbado nas linhas do rateio. */
export function SafraDaConsulta({ d }: { d: Row }) {
  const tipo = d["rateio_tipo"];
  const linhas = Array.isArray(d["rateio"]) ? (d["rateio"] as unknown[]).filter(ehObj) as Row[] : [];
  const safra = tipo === "por_valor"
    ? (linhas.map((l) => texto(l["safra_nome"])).find(Boolean) ?? "")
    : "";
  return <CampoLeitura rotulo="Safra" adorno="pesquisa" testId="compras-consulta-safra" valor={safra} />;
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
