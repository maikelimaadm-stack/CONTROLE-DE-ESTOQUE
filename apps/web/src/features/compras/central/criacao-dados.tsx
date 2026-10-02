"use client";
import * as React from "react";
import Link from "next/link";
import { AVISO_PADRAO_INVALIDO_CENTRAL } from "@agro/domain";
import { useAuth } from "@/lib/auth";
import { Input, LoadingState, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { MensagemTop } from "@/features/sales/tipo-operacao-select";
import { CampoDaCentral, ColunaDeCampos, DadosAdicionais, DataDaCentral, type IconeDoCampo } from "@/features/central/campo";
import { PlanoDaCentral } from "@/features/central/painel";
import { CampoDoLocalPadrao } from "@/features/central/local-padrao";
import type { IdentidadeDoDocumento } from "@/features/central/contrato";
import estilosCv from "@/features/central/moldura.module.css";
import { hrefDoConfigurador, textoDoLayoutQueVale } from "../layout-da-central";
import { PREFIXO_CENTRAL_COMPRAS } from "./adaptador";
import { opcoesDeNaturezaDeDespesa, type ChaveDoCabecalho, type EstadoDaCriacao } from "./estado";

/**
 * CENTRAL DE COMPRAS — DADOS PRINCIPAIS DA CRIAÇÃO (VISUAL-UX-04, decisão 276).
 *
 * O cabeçalho de 36 px (Ampliar, nome do documento, ponto de alteração) é da moldura do motor: daqui sai só a
 * `identidade`. O resto é o que a Central de Compras sempre desenhou — a TOP travada, as zonas do layout de compra
 * (COMPRAS-03: principais, adicionais e abas do rodapé), os padrões, a linha do layout e os avisos —, agora no
 * campo do desenho (`CampoDaCentral`). Nada aqui decide valor, obrigatoriedade, erro ou corpo: tudo vem de
 * `useEstadoDaCriacao`. Os testids `compras-*` de hoje continuam no elemento equivalente.
 *
 * OPERACOES-01 F3b (decisão 280): na criação, com a coluna do local na grade, o "Local de estoque" das linhas novas
 * (`CampoDoLocalPadrao`, `central-compras-local-padrao`) logo depois da Empresa, onde ela estiver — estado da tela,
 * fora do corpo; no receber não aparece.
 */

/** "Novo pedido de compra" / "Nova compra" — o nome do documento ainda sem número; o ponto acende com alteração. */
export function identidadeDaCriacao(e: EstadoDaCriacao): IdentidadeDoDocumento {
  const nome = e.modo === "receber" ? e.titulo : e.variante.variante === "pedido" ? "Novo pedido de compra" : "Nova compra";
  return {
    nome,
    alterado: e.alterado,
    dica: e.ehCompra
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

/** Dados principais + Dados adicionais (zonas do layout). Sem o pedido pronto (receber), nada: a faixa diz o que falta. */
export function DadosDaCriacao({ e }: { e: EstadoDaCriacao }) {
  const { can } = useAuth();
  const [maisDados, setMaisDados] = React.useState(false);
  if (!e.mostrarFormulario) return null;
  const h = e.cabecalho;
  const receber = e.modo === "receber";

  /* Sem layout (sem a capacidade) nada de `data-campo`; com layout, o invólucro do campo leva o que levava. */
  const dc = (c: string) => (e.layout ? { "data-campo": c, "data-obrigatorio": String(e.obrigatorio(c)), ...(e.forcados.has(c) ? { "data-forcado": "true" } : {}) } : {});
  const aviso = (c: string) => (e.padraoInvalido(c) ? <p data-testid="padrao-invalido-aviso" className="mt-0.5 text-[11px] text-amber-700">{AVISO_PADRAO_INVALIDO_CENTRAL}</p> : null);
  const cc = (c: string, hoje: string, o: { icone?: IconeDoCampo; preenchido: boolean; multilinha?: boolean; desabilitado?: boolean; testId?: string }, controle: React.ReactElement) =>
    <CampoDaCentral rotulo={e.rotulo(c, hoje)} obrigatorio={e.obrigatorio(c)} erro={e.erro(c)} icone={o.icone ?? null} preenchido={o.preenchido} multilinha={o.multilinha}
      estado={o.desabilitado ? "desabilitado" : "editavel"} testId={o.testId} abaixo={aviso(c)} {...dc(c)}>{controle}</CampoDaCentral>;
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
      /* No receber, Fornecedor e Empresa vêm do pedido, TRAVADOS (o corpo do /convert nem os leva). */
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
        <RefSelect resource="financial_categories" value={h.categoria_financeira_id} onChange={mudar("categoria_financeira_id")} buscarOpcoes={opcoesDeNaturezaDeDespesa} />);
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
  /* Não editável do layout TRAVA (a decisão é do estado: `travado`), mostrando o valor. */
  const render = (c: string) => {
    const n = desenhar(c);
    if (n === null) return null;
    return e.travado(c)
      ? <fieldset key={c} disabled data-editavel="false" style={{ display: "contents" }}>{n}</fieldset>
      : <React.Fragment key={c}>{n}</React.Fragment>;
  };

  /* A TOP TRAVADA: contexto do lançamento, não campo; "<código> · <nome>", o movimento na dica. */
  const top = e.top && <CampoDaCentral rotulo="Tipo de Operação" obrigatorio estado="travado" testId="compras-top-travada" data-tipo-operacao-id={e.top.id}
    dica={e.top.movimento ? `Movimento: ${e.top.movimento}` : undefined}>
    <span className={estilosCv.codigo}>{e.top.codigo}</span> <span className={estilosCv.separador}>·</span> <span>{e.top.nome}</span>
  </CampoDaCentral>;

  /* Só com a capacidade do layout E a resposta conferida. `can` só decide se o atalho aparece (apresentação). */
  const linhaDoLayout = e.layoutVale && <div className="flex flex-wrap items-baseline gap-x-2">
    <p data-testid="compras-layout-efetivo" data-origem={e.layoutVale.origem} data-layout-id={e.layoutVale.id ?? ""} className="text-[11.5px] text-slate-500">{textoDoLayoutQueVale(e.layoutVale)}</p>
    {can("tipos_operacao.edit") && <Link data-testid="compras-layout-configurar" href={hrefDoConfigurador(e.layoutVale)} className="text-[11.5px] font-medium text-emerald-700 hover:underline">Configurar</Link>}
  </div>;

  const { principais, adicionais, abas } = e.zonas;
  /* O "Local de estoque" do cabeçalho vai logo DEPOIS da Empresa (o local é da empresa do documento), na zona onde a
     Empresa estiver desenhada — os principais, os adicionais ou a aba do painel que a recebeu (o painel desenha cada
     campo por este mesmo componente). A Empresa é obrigatória do sistema (todo layout a tem): o campo aparece uma vez
     só, nunca ao lado de outro campo. Não é campo do layout: sem `data-campo`, sem "*", fora das pendências. */
  const comOLocal = (campos: readonly string[]) => campos.flatMap((c) => (c === "empresa_id" && e.localNaGrade
    ? [render(c), <CampoDoLocalPadrao key="local-padrao" prefixoTestid={PREFIXO_CENTRAL_COMPRAS} empresaId={h.empresa_id} valor={e.localDoCabecalho} onChange={e.escolherLocal} />]
    : [render(c)]));
  const recolhidos = [...adicionais, ...abas.flatMap((a) => a.campos)];
  // o Local de estoque conta como campo de Dados adicionais quando a Empresa mora lá
  const quantidade = recolhidos.length + (e.localNaGrade && recolhidos.includes("empresa_id") ? 1 : 0);
  /* Campo com erro numa zona recolhida não ficaria à vista: com erro lá dentro, Dados adicionais abre. */
  const erroEscondido = recolhidos.some((c) => Boolean(e.erro(c)));
  const aberto = maisDados || erroEscondido;

  return <>
    {linhaDoLayout}
    <ColunaDeCampos>
      {top}
      {comOLocal(principais)}
    </ColunaDeCampos>
    <DadosAdicionais quantidade={quantidade} aberto={aberto} onAlternar={() => setMaisDados(!aberto)}>
      {adicionais.length > 0 && <div data-testid="compras-zona-adicionais">
        <ColunaDeCampos>{comOLocal(adicionais)}</ColunaDeCampos>
      </div>}
      {abas.map((a) => <div key={a.indice} data-testid={`compras-zona-aba-${a.indice}`} className="space-y-1">
        <p className="text-[11px] font-semibold uppercase text-slate-500">{a.aba}</p>
        <ColunaDeCampos>{comOLocal(a.campos)}</ColunaDeCampos>
      </div>)}
    </DadosAdicionais>
  </>;
}
