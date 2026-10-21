"use client";
import * as React from "react";
import Link from "next/link";
import { AVISO_PADRAO_INVALIDO_CENTRAL } from "@agro/domain";
import { useAuth } from "@/lib/auth";
import { enumOptions } from "@/lib/copy";
import { Input, LoadingState, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { MensagemTop } from "@/features/sales/tipo-operacao-select";
import { CampoDaCentral, ColunaDeCampos, DataDaCentral, type IconeDoCampo } from "@/features/central/campo";
import { PlanoDaCentral } from "@/features/central/painel";
import type { IdentidadeDoDocumento } from "@/features/central/contrato";
import estilosCv from "@/features/central/moldura.module.css";
import { hrefDoConfigurador, textoDoLayoutQueVale } from "../layout-da-central";
import { opcoesDeNaturezaDeDespesa, type ChaveDoCabecalho, type EstadoDaCriacao } from "./estado";
import { DadosFiscaisDaConsulta, RateioDaConsulta, temDadosFiscais } from "./dados-fiscais";
import { dicaDaIdentidadeNaEdicao } from "./edicao";
import { CAMPOS_DOS_DADOS_PRINCIPAIS } from "./organizacao-do-painel";
import { fiscalNoPainel } from "./rateio-no-rodape";

/**
 * CENTRAL DE COMPRAS — DADOS PRINCIPAIS: só identificar a compra.
 * Geometria = ColunaDeCampos / rótulo à frente (igual à consulta). Redistribuição: financeiro,
 * rateio, fiscal e entrega no rodapé (`organizacao-do-painel.tsx`). Local de estoque na LINHA da grade
 * (`criacao-itens.tsx`).
 */

/** "Novo pedido de compra" / "Nova compra" — o nome do documento ainda sem número; o ponto acende com alteração. */
export function identidadeDaCriacao(e: EstadoDaCriacao): IdentidadeDoDocumento {
  const nome = e.modo === "receber" || e.modo === "edicao" ? e.titulo : e.variante.variante === "pedido" ? "Novo pedido de compra" : "Nova compra";
  return {
    nome,
    alterado: e.alterado,
    // EDITAR-02: a edição não confirma (P4 da 313) — a dica dela diz isso; a da criação e a do receber, as de hoje.
    dica: e.modo === "edicao" ? dicaDaIdentidadeNaEdicao(e.ehCompra) : e.ehCompra
      ? "O que a confirmação faz no estoque e no financeiro depende do Tipo de Operação e é mostrado antes de confirmar."
      : "Pedido de compra: sem efeito em estoque ou financeiro; a compra é lançada ao receber o pedido."
  };
}

/** Os avisos acima dos dados: TOP desta sessão que deixou de valer, layout não carregado e a faixa do receber. */
export function AvisosDaCriacao({ e }: { e: EstadoDaCriacao }) {
  const receber = e.modo === "receber";
  const semTop = !receber && !e.escritaTopConfirmada;
  if (!semTop && !e.layoutNaoCarregado && !receber) return null;
  return <>
    {semTop && <div className="space-y-1 rounded-md bg-amber-50 p-3">
      <MensagemTop estado={e.estadoTop} />
      {e.estadoTop.situacao === "pronto" && <p data-testid="top-indisponivel" className="text-sm text-amber-800">O Tipo de Operação selecionado não está disponível para este lançamento.</p>}
      <p className="text-xs text-amber-700">O que já foi preenchido continua aqui. Use “Alterar operação” para escolher outra.</p>
    </div>}
    {e.layoutNaoCarregado && <div className="rounded-md bg-amber-50 p-3">
      <p data-testid="compras-layout-nao-carregado" className="text-sm text-amber-700">Não foi possível carregar o layout deste Tipo de Operação. O lançamento está bloqueado até ele ser carregado.</p>
    </div>}
    {receber && <div data-testid="compras-central-receber" data-pedido-id={e.pedidoId} data-situacao={e.recebimento.situacao} data-em-partes={e.recebendo ? String(e.emPartes) : undefined} className="space-y-1 text-[12.5px] text-slate-700">
      {e.recebimento.situacao === "carregando" && <LoadingState variant="compact" label="Carregando o pedido de compra…" />}
      {e.recebimento.situacao === "recusado" && <p data-testid="compras-receber-recusado" className="text-sm text-amber-700">{e.recebimento.mensagem}</p>}
      {e.recebendo && <>
        <p>
          Recebendo o <Link className="text-brand-700 underline" data-testid="compras-receber-pedido" href={e.rotaDoPedido}>{e.rotuloDoPedido.toLowerCase()} {e.codigoDoPedido}</Link>
          {" "}pela operação <span className="font-mono font-semibold">{e.recebendo.passo.codigo}</span> — {e.recebendo.passo.nome}.
        </p>
        <p className="text-slate-500" data-testid="compras-receber-regra">
          {e.emPartes
            ? "Em partes: escolha os itens e as quantidades desta compra, cada uma até o saldo do item."
            : "Esta operação recebe o pedido inteiro: cada item com o saldo, sem mudar a quantidade."}
          {" "}Fornecedor, empresa e produto vêm do pedido. Valor unitário e descontos também, e podem mudar: valem os da nota.
        </p>
      </>}
    </div>}
  </>;
}

/** Dados principais — identificar a compra (ColunaDeCampos). Demais campos vão ao rodapé. */
export function DadosDaCriacao({ e }: { e: EstadoDaCriacao }) {
  const { can } = useAuth();
  if (!e.mostrarFormulario) return null;
  const h = e.cabecalho;
  const receber = e.modo === "receber";
  const tiposDoc = enumOptions("document_type");

  const dc = (c: string) => ({
    ...(e.layout ? { "data-campo": c, "data-obrigatorio": String(e.obrigatorio(c)), ...(e.forcados.has(c) ? { "data-forcado": "true" } : {}) } : {}),
    ...(e.semeadoPelaTop(c) ? { "data-padrao-top": "semeado" } : {})
  });
  const aviso = (c: string) => (e.padraoInvalido(c) ? <p data-testid="padrao-invalido-aviso" className="mt-0.5 text-[11px] text-amber-700">{AVISO_PADRAO_INVALIDO_CENTRAL}</p> : null);
  const cc = (c: string, hoje: string, o: { icone?: IconeDoCampo; preenchido: boolean; multilinha?: boolean; desabilitado?: boolean; testId?: string }, controle: React.ReactElement) =>
    <CampoDaCentral rotulo={e.rotulo(c, hoje)} obrigatorio={e.obrigatorio(c)} erro={e.erro(c)} icone={o.icone ?? null} preenchido={o.preenchido} multilinha={o.multilinha}
      estado={o.desabilitado ? "desabilitado" : "editavel"} testId={o.testId} abaixo={aviso(c)} dica={e.motivoNaEdicao(c) ?? undefined} {...dc(c)}>{controle}</CampoDaCentral>;
  const mudar = (c: ChaveDoCabecalho) => (v: string | null | undefined) => e.mudar({ [c]: v ?? "" });
  const data = (c: ChaveDoCabecalho, hoje: string, testId: string) =>
    cc(c, hoje, { icone: "data", preenchido: Boolean(h[c]), testId }, <DataDaCentral rotulo={e.rotulo(c, hoje)} value={h[c]} onChange={mudar(c)} />);
  const numero = (c: ChaveDoCabecalho, hoje: string, testId: string) =>
    cc(c, hoje, { preenchido: h[c] !== "" }, <Input data-testid={testId} type="number" step="0.01" min="0" value={h[c]} onChange={(ev) => e.mudar({ [c]: ev.target.value })} />);
  const texto = (c: ChaveDoCabecalho, hoje: string, testId: string) =>
    cc(c, hoje, { preenchido: Boolean(h[c]) }, <Input data-testid={testId} value={h[c]} onChange={(ev) => e.mudar({ [c]: ev.target.value })} />);
  const pedidoNome = (k: string) => (e.recebendo ? String(e.recebendo.pedido[k] ?? "") || null : undefined);

  const desenhar = (c: string): React.ReactNode => {
    switch (c) {
      case "empresa_id": return cc(c, "Empresa", { icone: "pesquisa", preenchido: Boolean(h.empresa_id), desabilitado: receber },
        <RefSelect resource="empresas" value={h.empresa_id} disabled={receber || undefined} allowEmpty={!receber} labelHint={pedidoNome("empresa_nome")} onChange={mudar("empresa_id")} />);
      case "fornecedor_id": return cc(c, "Fornecedor", { icone: "pesquisa", preenchido: Boolean(h.fornecedor_id), desabilitado: receber },
        <RefSelect resource="people" value={h.fornecedor_id} disabled={receber || undefined} allowEmpty={!receber} labelHint={receber ? pedidoNome("fornecedor_nome") : e.dica("fornecedor_id")} onChange={mudar("fornecedor_id")} filter={{ is_provider: "true" }} />);
      case "data_documento": return data("data_documento", "Data do documento", "compras-data-documento");
      case "data_entrada": return data("data_entrada", "Data de entrada", "compras-data-entrada");
      case "data_vencimento": return data("data_vencimento", "Vencimento", "compras-data-vencimento");
      case "numero_nota": return texto("numero_nota", "Número da nota", "compras-numero-nota");
      case "serie_nota": return texto("serie_nota", "Série", "compras-serie-nota");
      case "transportadora_id": return cc(c, "Transportadora", { icone: "pesquisa", preenchido: Boolean(h.transportadora_id) },
        <RefSelect resource="people" value={h.transportadora_id} onChange={mudar("transportadora_id")} filter={{ is_transporter: "true" }} labelHint={e.dica("transportadora_id")} />);
      case "categoria_financeira_id": return cc(c, "Natureza de despesa", { icone: "pesquisa", preenchido: Boolean(h.categoria_financeira_id) },
        <RefSelect resource="financial_categories" value={h.categoria_financeira_id} onChange={mudar("categoria_financeira_id")} buscarOpcoes={opcoesDeNaturezaDeDespesa} labelHint={e.dica("categoria_financeira_id")} />);
      case "centro_custo_id": return cc(c, "Centro de resultado", { icone: "pesquisa", preenchido: Boolean(h.centro_custo_id) },
        <RefSelect resource="cost_centers" value={h.centro_custo_id} onChange={mudar("centro_custo_id")} filter={{ kind: "analytic" }} labelHint={e.dica("centro_custo_id")} />);
      case "condicao_pagamento_id": return cc(c, "Condição de pagamento", { icone: "pesquisa", preenchido: Boolean(h.condicao_pagamento_id) },
        <RefSelect resource="condicoes_pagamento" somenteIds={e.condicoesPermitidas} value={h.condicao_pagamento_id} onChange={mudar("condicao_pagamento_id")} labelHint={e.dica("condicao_pagamento_id")} />);
      case "forma_pagamento_id": return cc(c, "Forma de pagamento", { icone: "pesquisa", preenchido: Boolean(h.forma_pagamento_id) },
        <RefSelect resource="payment_methods" value={h.forma_pagamento_id} onChange={mudar("forma_pagamento_id")} labelHint={e.dica("forma_pagamento_id")} />);
      case "frete": return numero("frete", "Frete", "compras-frete");
      case "outras_despesas": return numero("outras_despesas", "Outras despesas", "compras-outras-despesas");
      case "desconto": return numero("desconto", "Desconto", "compras-desconto");
      case "plano_parcelas": return <>
        {cc(c, "Parcelas", { icone: "selecao", preenchido: true },
          <NativeSelect data-testid="compras-parcelas" value={e.ajustarParcelas ? "ajustar" : "padrao"} onChange={(ev) => e.setAjustarParcelas(ev.target.value === "ajustar")}>
            <option value="padrao">Pela condição (ou à vista)</option>
            <option value="ajustar">Ajustar parcelas</option>
          </NativeSelect>)}
        {e.ajustarParcelas && <div data-testid="compras-plano"><PlanoDaCentral plano={e.plano} onChange={e.setPlano} /></div>}
      </>;
      case "observacao": return cc(c, "Observação", { preenchido: Boolean(h.observacao), multilinha: true },
        <Textarea data-testid="compras-observacao" value={h.observacao} onChange={(ev) => e.mudar({ observacao: ev.target.value })} />);
      default: return null;
    }
  };
  const render = (c: string) => {
    const n = desenhar(c);
    if (n === null) return null;
    return e.travado(c)
      ? <fieldset key={c} disabled data-editavel="false" data-travado-pela-top={e.travadoPelaTop(c) ? "true" : undefined}
        data-travado-na-edicao={e.travadoNaEdicao(c) ? "true" : undefined} data-motivo={e.motivoNaEdicao(c) ?? undefined} style={{ display: "contents" }}>{n}</fieldset>
      : <React.Fragment key={c}>{n}</React.Fragment>;
  };

  const top = e.top && <CampoDaCentral rotulo="Tipo de Operação" obrigatorio estado="travado" testId="compras-top-travada" data-tipo-operacao-id={e.top.id}
    dica={e.top.movimento ? `Movimento: ${e.top.movimento}` : undefined}>
    <span className={estilosCv.codigo}>{e.top.codigo}</span> <span className={estilosCv.separador}>·</span> <span>{e.top.nome}</span>
  </CampoDaCentral>;

  const linhaDoLayout = e.layoutVale && <div className="mb-1 flex flex-wrap items-baseline gap-x-2" data-testid="compras-layout-acao">
    <p data-testid="compras-layout-efetivo" data-origem={e.layoutVale.origem} data-layout-id={e.layoutVale.id ?? ""} className="text-[11.5px] text-slate-500">{textoDoLayoutQueVale(e.layoutVale)}</p>
    {can("tipos_operacao.edit") && <Link data-testid="compras-layout-configurar" href={hrefDoConfigurador(e.layoutVale)} className="text-[11.5px] font-medium text-emerald-700 hover:underline">Configurar</Link>}
  </div>;

  const { principais } = e.zonas;
  const identidade = new Set(CAMPOS_DOS_DADOS_PRINCIPAIS);
  /* Campo único do painel (frete, parcelas…): só desenha o campo. */
  const soDoPainel = principais.length > 0 && principais.every((c) => !identidade.has(c));
  if (soDoPainel) {
    return <ColunaDeCampos>{principais.map((c) => render(c))}</ColunaDeCampos>;
  }

  const tipoDoc = fiscalNoPainel(e) && <CampoDaCentral key="tipo-documento-fiscal" rotulo="Tipo de documento" icone="selecao" preenchido={e.fiscal.tipo_documento_fiscal !== ""} testId="compras-tipo-documento-fiscal-campo" data-campo-fiscal="tipo_documento_fiscal">
    <NativeSelect data-testid="compras-tipo-documento-fiscal" value={e.fiscal.tipo_documento_fiscal} onChange={(ev) => e.mudarFiscal({ tipo_documento_fiscal: ev.target.value })}>
      <option value="">—</option>
      {tiposDoc.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </NativeSelect>
  </CampoDaCentral>;

  /* EDITAR-02: fiscais em leitura ficam na aba Fiscal do painel quando a criação os teria; na edição sem painel fiscal, mantém nos Dados. */
  const fiscaisEmLeitura = e.modo === "edicao" && e.ehCompra && e.top !== null && e.documentoEmEdicao !== null && temDadosFiscais(e.documentoEmEdicao)
    ? e.documentoEmEdicao : null;

  /* Tipo de documento entra depois da série (ou da nota); observação no fim, como campo normal da coluna. */
  const corpo = principais.flatMap((c) => {
    if (c === "serie_nota") return [render(c), tipoDoc].filter(Boolean);
    if (c === "numero_nota" && !principais.includes("serie_nota")) return [render(c), tipoDoc].filter(Boolean);
    return [render(c)];
  });
  if (tipoDoc && !principais.includes("serie_nota") && !principais.includes("numero_nota")) corpo.push(tipoDoc);

  return <>
    {linhaDoLayout}
    <div data-testid="compras-dados-principais">
      <ColunaDeCampos>
        {top}
        {corpo}
      </ColunaDeCampos>
    </div>
    {fiscaisEmLeitura && !fiscalNoPainel(e) && <div data-testid="compras-edicao-dados-fiscais" className="mt-2 space-y-2">
      <DadosFiscaisDaConsulta d={fiscaisEmLeitura} />
      <RateioDaConsulta d={fiscaisEmLeitura} />
    </div>}
  </>;
}
