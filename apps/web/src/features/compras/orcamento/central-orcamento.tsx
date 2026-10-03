"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AVISO_PADRAO_INVALIDO_CENTRAL, type ColunaDoLayout } from "@agro/domain";
import { useAuth } from "@/lib/auth";
import { brl, dateBR } from "@/lib/utils";
import { Button, Card, CardBody, CardHeader, Input, LoadingState, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import type { ItemRow, Row } from "@/features/docs/shared";
import { CentralDeDocumento, type ControleDaCentral } from "@/features/central/moldura";
import { CampoDaCentral, CampoLeitura, ColunaDeCampos, DadosAdicionais, DataDaCentral, type IconeDoCampo } from "@/features/central/campo";
import { ItensDaCentral as ItensDoMotor, type ItensDaOrigem, type LayoutDosItens } from "@/features/central/itens";
import { AcoesRapidas } from "@/features/central/acoes-rapidas";
import {
  BotaoDaBarra, ConjuntoDaBarra, ConjuntoDireito, IconeDescartar, IconeHistorico, IconeImprimir, IconeSalvar, PendenciasDoDocumento, PosicaoDoRotulo,
  type ItemRapido, type Pendencia, type PosicaoDoRotuloValor
} from "@/features/central/barra";
import { DialogoDescartar } from "@/features/central/dialogos";
import { PainelColuna, PainelLargo } from "@/features/central/painel";
import type { AbaDoPainel, ColunasDosItens } from "@/features/central/contrato";
import estilosCv from "@/features/central/moldura.module.css";
import { useTopsDaEspecie, varianteDeCompra, type VarianteDeCompra } from "../variantes";
import { hrefDoConfigurador, textoDoLayoutQueVale } from "../layout-da-central";
import { PREFIXO_CENTRAL_COMPRAS, colunasDosItensDeCompras, fonteDosDocumentosDeCompras } from "../central/adaptador";
import { irParaPendenciaDaCompra } from "../central/criacao-barra";
import {
  TESTID_DA_RECUSA, cabecalhoDoOrcamentoGravado, dicaDaTravaDoOrcamento, linhasDoOrcamento, testIdDaLinhaDoOrcamento, topDoOrcamentoGravado,
  useEntradaDoOrcamento, useEstadoDoFormularioDoOrcamento, type ChaveDoCabecalhoDoOrcamento, type EstadoDoFormularioDoOrcamento,
  type PropsDoFormularioDoOrcamento
} from "./estado-orcamento";

/**
 * OPERACOES-01 F6b (decisão 283) — O ORÇAMENTO DE COMPRA NA CENTRAL DE COMPRAS (criação e edição no lugar), sobre o
 * MOTOR da Central (`@/features/central`), sem mudar o motor. Só desenha: a lógica mora em `estado-orcamento.ts`.
 *
 * CRIAÇÃO — `/compras/<seg>/new?tipo_operacao_id=<top>&pedido=<pedido>`, aberta pelo "Novo orçamento" do pedido. Antes
 * do formulário, as verificações NA ORDEM do plano, cada uma com a sua mensagem num aviso `compras-orcamento-recusado`
 * (`data-motivo`), e nenhum POST: sem pedido na URL, sem permissão, sem a capacidade da API, o pedido (aberto, aprovado
 * para orçamento, sem vencedor) e o leque de TOPs de orçamento do pedido (com várias e nenhuma escolhida, os botões).
 *
 * O FORMULÁRIO — Dados pelo layout da TOP de orçamento (Empresa do pedido em leitura; Fornecedor; Data; Condição;
 * Prazo de entrega; Validade; Observação), a grade do motor com as linhas do PEDIDO (produto e quantidade travados,
 * sem Local de estoque — o servidor copia o do pedido; só o preço se digita), o painel (Totais e as abas do rodapé do
 * layout) e a barra [Descartar] [Salvar] · [pendências] [Posição do rótulo] [Ações rápidas]. Na EDIÇÃO (pela consulta,
 * sem rota nova), Fornecedor, Empresa e Data ficam em leitura (o PUT não os aceita).
 *
 * A grade: a coluna "Saldo" que o modo "da origem" do motor liga repetiria a quantidade do pedido com um rótulo que não
 * é dela; o adaptador dá à coluna uma chave de catálogo que o layout da grade não cita, e ela não aparece.
 */

const PREFIXO = PREFIXO_CENTRAL_COMPRAS;

/** As colunas da compra, com a chave sintética que mantém a coluna "Saldo" do modo "da origem" fora da grade. */
const CHAVE_DA_QUANTIDADE_DO_PEDIDO = "quantidade_do_pedido";
function colunasDoOrcamento(variante: VarianteDeCompra): ColunasDosItens {
  const daCompra = colunasDosItensDeCompras(variante);
  return { ...daCompra, doCatalogo: { ...daCompra.doCatalogo, [CHAVE_DA_QUANTIDADE_DO_PEDIDO]: "saldo" } };
}

/** O modo "da origem" do motor: as linhas são as do pedido — produto e quantidade travados, sem acrescentar nem remover. */
const ORIGEM_DO_PEDIDO: ItensDaOrigem = { saldo: (it) => it.quantity, quantidadeTravada: true, testIdDaLinha: testIdDaLinhaDoOrcamento };

/** As colunas da grade: Produto, Quantidade, Valor unitário (rótulo e obrigatório do layout) e o Total. */
function layoutDaGrade(unitario: ColunaDoLayout, doLayout: readonly ColunaDoLayout[] | undefined): LayoutDosItens {
  const doSistema = (campo: string): ColunaDoLayout => {
    const x = doLayout?.find((c) => c.campo === campo);
    return { campo, obrigatorio: x?.obrigatorio ?? true, ...(x?.rotulo ? { rotulo: x.rotulo } : {}) };
  };
  return { colunas: [doSistema("produto_id"), doSistema("quantidade"), unitario, { campo: "total", obrigatorio: false }] };
}

const IDENTIDADE_DICA = "Orçamento de compra: os itens e as quantidades vêm do pedido; digite o preço de cada item. Não mexe em estoque nem em financeiro.";

export type PropsDaCentralDoOrcamento =
  | { variante: VarianteDeCompra; modo?: "criacao" }
  | { variante: VarianteDeCompra; modo: "edicao"; orcamento: Row; onFechar: (salvou: boolean) => void };

/** O orçamento na Central de Compras: a criação (pela URL) ou a edição no lugar (pela consulta). */
export function CentralDoOrcamento(props: PropsDaCentralDoOrcamento) {
  if (props.modo === "edicao") return <EdicaoDoOrcamento variante={props.variante} orcamento={props.orcamento} onFechar={props.onFechar} />;
  return <CriacaoDoOrcamento variante={props.variante} />;
}

/* ═════════════════════════════════════ CRIAÇÃO ═════════════════════════════════════ */

function CriacaoDoOrcamento({ variante }: { variante: VarianteDeCompra }) {
  const entrada = useEntradaDoOrcamento(variante);
  const router = useRouter();
  if (entrada.situacao === "formulario") return <FormularioDoOrcamento key={entrada.chave} {...entrada.props} />;
  const voltar = () => router.push("/compras?tab=documentos");
  return <div data-testid="compras-orcamento-central" data-modo="criacao" data-situacao={entrada.situacao}>
    <Card>
      <CardHeader title="Novo orçamento de compra" subtitle="O orçamento de compra nasce do pedido aprovado para orçamento."
        actions={<Button variant="outline" size="sm" onClick={voltar}>Voltar</Button>} />
      <CardBody className="space-y-3">
        {entrada.situacao === "carregando" && <LoadingState label={entrada.rotulo} />}
        {entrada.situacao === "recusado" && <div data-testid="compras-orcamento-recusado" data-motivo={entrada.motivo} className="space-y-2 rounded-md bg-amber-50 p-3">
          <p data-testid={TESTID_DA_RECUSA[entrada.motivo]} className="text-sm text-amber-800">{entrada.mensagem}</p>
          {entrada.motivo === "sem-pedido" && <Link data-testid="compras-orcamento-ir-para-documentos" href="/compras?tab=documentos" className="text-sm font-medium text-emerald-700 hover:underline">Ir para Documentos de compra</Link>}
        </div>}
        {entrada.situacao === "escolher-top" && <div data-testid="compras-orcamento-escolher-top" className="space-y-2">
          <p className="text-sm text-slate-700">
            O pedido de compra <Link data-testid="compras-orcamento-pedido" className="text-brand-700 underline" href={rotaDoPedido(entrada.pedido.id)}>{entrada.pedido.codigo}</Link> oferece mais de uma operação de orçamento. Escolha uma:
          </p>
          <div className="flex flex-wrap gap-2">
            {entrada.tops.map((t) => <Button key={t.tipoOperacaoId} variant="outline" size="sm" data-testid={`compras-orcamento-escolher-top-${t.tipoOperacaoId}`}
              onClick={() => entrada.escolher(t)}>{`Orçamento em ${t.codigo} — ${t.nome}`}</Button>)}
          </div>
        </div>}
      </CardBody>
    </Card>
  </div>;
}

const rotaDoPedido = (pedidoId: string) => `/compras/${varianteDeCompra("pedido")?.segmento ?? "pedidos"}/${encodeURIComponent(pedidoId)}`;

/* ═════════════════════════════════════ EDIÇÃO ═════════════════════════════════════ */

const texto = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

function EdicaoDoOrcamento({ variante, orcamento: d, onFechar }: { variante: VarianteDeCompra; orcamento: Row; onFechar: (salvou: boolean) => void }) {
  const { can } = useAuth();
  // O layout e as regras da TOP só existem para quem LANÇA orçamento (as portas exigem `.create`).
  const portasDaTop = can(`${variante.perm}.create`);
  const estadoTop = useTopsDaEspecie(variante.segmento, portasDaTop);
  const id = texto(d["id"]);
  if (portasDaTop && estadoTop.situacao === "carregando") {
    return <div data-testid="compras-orcamento-central" data-modo="edicao" data-situacao="carregando"><LoadingState label="Carregando as operações de orçamento…" /></div>;
  }
  // As props de ABERTURA: o formulário as lê ao montar (o que se digita é estado dele, não volta daqui).
  const props: PropsDoFormularioDoOrcamento = {
    modo: "edicao", variante, estadoTop,
    top: topDoOrcamentoGravado(d),
    pedido: { id: texto(d["pedido_orcado_id"]), codigo: texto(d["pedido_orcado_codigo"]), empresaId: texto(d["empresa_id"]), empresaNome: texto(d["empresa_nome"]) },
    orcamento: { id, codigo: texto(d["codigo"]), fornecedorNome: texto(d["fornecedor_nome"]) },
    abertura: cabecalhoDoOrcamentoGravado(d),
    linhas: linhasDoOrcamento(d["itens"]),
    onFechar
  };
  return <FormularioDoOrcamento key={`edicao:${id}`} {...props} />;
}

/* ═════════════════════════════════════ O FORMULÁRIO ═════════════════════════════════════ */

/** A aba do painel em que o campo mora (as abas do rodapé do layout), para a pendência levar até ele. */
function abaDoCampo(e: EstadoDoFormularioDoOrcamento, campo: string): string | null {
  const a = e.zonas.abas.find((x) => x.campos.includes(campo));
  return a ? `aba-${a.indice}` : null;
}

function FormularioDoOrcamento(props: PropsDoFormularioDoOrcamento) {
  const e = useEstadoDoFormularioDoOrcamento(props);
  const { can } = useAuth();
  const [densidade, setDensidade] = React.useState<PosicaoDoRotuloValor>("rotulo-a-frente");
  const controle = React.useRef<ControleDaCentral | null>(null);
  const [perguntaDescartar, setPerguntaDescartar] = React.useState(false);
  /* A pílula só aparece depois de um clique em Salvar que não enviou nada (como na compra). */
  const [tentou, setTentou] = React.useState(false);
  const edicao = e.modo === "edicao";
  const temPendencia = e.pendencias.length > 0;
  const fecharPendencias = e.setPendenciasAbertas;
  React.useEffect(() => { if (!temPendencia) fecharPendencias(false); }, [temPendencia, fecharPendencias]);

  const irPara = (p: Pendencia) => {
    const aba = abaDoCampo(e, p.caminho);
    if (aba && controle.current) { controle.current.abrirAba(aba); window.setTimeout(() => irParaPendenciaDaCompra(p), 0); return; }
    irParaPendenciaDaCompra(p);
  };
  const clicarSalvar = () => {
    if (e.salvarDesabilitado) return;
    setTentou(true);
    e.salvar();
  };
  const clicarDescartar = () => { if (e.alterado) setPerguntaDescartar(true); else e.descartar(); };
  const descartar = () => { setPerguntaDescartar(false); setTentou(false); e.descartar(); };
  const dicaTrava = dicaDaTravaDoOrcamento(e.travaDoSalvar);

  /* O leque: Imprimir e Histórico desabilitados enquanto se lança ou edita (o documento salvo é o da consulta). */
  const rapidas: ItemRapido[] = [
    { chave: "imprimir", rotulo: "Imprimir", testId: `${PREFIXO}-imprimir`, icone: <IconeImprimir />, desabilitado: true, onSelect: () => undefined },
    ...(can("audit_logs.view") ? [{ chave: "historico", rotulo: "Histórico de alterações", testId: `${PREFIXO}-historico`, icone: <IconeHistorico />, desabilitado: true, onSelect: () => undefined }] : [])
  ];
  const acoes = <ConjuntoDaBarra>
    <BotaoDaBarra rotulo={edicao && !e.alterado ? "Voltar à consulta" : "Descartar alterações"} disabled={(!e.alterado && !edicao) || e.salvando}
      data-testid={`${PREFIXO}-descartar`} onClick={clicarDescartar}><IconeDescartar /></BotaoDaBarra>
    <BotaoDaBarra rotulo="Salvar" dica={dicaTrava ?? "Salvar"} ocupado={e.salvando} disabled={e.salvarDesabilitado}
      data-testid="compras-salvar" onClick={clicarSalvar}><IconeSalvar /></BotaoDaBarra>
  </ConjuntoDaBarra>;
  const direita = <ConjuntoDireito>
    {tentou && <PendenciasDoDocumento prefixoTestid={PREFIXO} pendencias={e.pendencias} aberta={e.pendenciasAbertas} onAbertaChange={e.setPendenciasAbertas} onIr={irPara} />}
    <PosicaoDoRotulo prefixoTestid={PREFIXO} valor={densidade} onChange={setDensidade} />
    <AcoesRapidas prefixoTestid={PREFIXO} documentosAbertos={fonteDosDocumentosDeCompras} antes={rapidas} desabilitado={e.salvando} />
  </ConjuntoDireito>;

  const nome = edicao ? `Editar orçamento ${e.orcamento?.codigo ?? ""}`.trim() : "Novo orçamento de compra";
  return <div data-testid="compras-orcamento-central" data-modo={e.modo} data-situacao="formulario" data-pedido-id={e.pedido.id} className="contents">
    <CentralDeDocumento
      prefixoTestid={PREFIXO}
      titulo={nome}
      identidade={{ nome, alterado: e.alterado, dica: IDENTIDADE_DICA }}
      densidade={densidade}
      controle={controle}
      acoes={acoes}
      acoesDireita={direita}
      aviso={<FaixaDoPedido e={e} />}
      dados={<DadosDoOrcamento e={e} />}
      itens={<ItensDoOrcamento e={e} />}
      abas={abasDoFormulario(e)}
    />
    <DialogoDescartar aberto={perguntaDescartar} onFechar={() => setPerguntaDescartar(false)} onDescartar={descartar} />
  </div>;
}

/** A faixa do pedido: de onde vêm os itens e as quantidades, com o link para ele. */
function FaixaDoPedido({ e }: { e: EstadoDoFormularioDoOrcamento }) {
  return <div className="space-y-1">
    {e.layoutNaoCarregado && <p data-testid="compras-layout-nao-carregado" className="rounded-md bg-amber-50 p-3 text-sm text-amber-700">
      Não foi possível carregar o layout deste Tipo de Operação. O lançamento está bloqueado até ele ser carregado.
    </p>}
    <p data-testid="compras-orcamento-do-pedido" className="text-[12.5px] text-slate-700">
      Orçamento do <Link data-testid="compras-orcamento-pedido" className="text-brand-700 underline" href={rotaDoPedido(e.pedido.id)}>pedido de compra {e.pedido.codigo}</Link>
      {" "}— os itens e as quantidades vêm do pedido.
    </p>
  </div>;
}

/** Dados principais e Dados adicionais (as zonas do layout; as abas do rodapé vão ao painel). */
function DadosDoOrcamento({ e }: { e: EstadoDoFormularioDoOrcamento }) {
  const { can } = useAuth();
  const [maisDados, setMaisDados] = React.useState(false);
  const desenhar = desenhoDoCampo(e);
  const { principais, adicionais } = e.zonas;
  const erroEscondido = adicionais.some((c) => Boolean(e.erro(c)));
  const aberto = maisDados || erroEscondido;

  const top = <CampoDaCentral rotulo="Tipo de Operação" obrigatorio estado="travado" testId="compras-top-travada" data-tipo-operacao-id={e.top.id}
    dica={e.movimento ? `Movimento: ${e.movimento}` : undefined}>
    <span className={estilosCv.codigo}>{e.top.codigo}</span> <span className={estilosCv.separador}>·</span> <span>{e.top.nome}</span>
  </CampoDaCentral>;
  const linhaDoLayout = e.layoutVale && <div className="flex flex-wrap items-baseline gap-x-2">
    <p data-testid="compras-layout-efetivo" data-origem={e.layoutVale.origem} data-layout-id={e.layoutVale.id ?? ""} className="text-[11.5px] text-slate-500">{textoDoLayoutQueVale(e.layoutVale)}</p>
    {can("tipos_operacao.edit") && <Link data-testid="compras-layout-configurar" href={hrefDoConfigurador(e.layoutVale)} className="text-[11.5px] font-medium text-emerald-700 hover:underline">Configurar</Link>}
  </div>;

  return <>
    {linhaDoLayout}
    <ColunaDeCampos>
      {top}
      {principais.map(desenhar)}
    </ColunaDeCampos>
    <DadosAdicionais quantidade={adicionais.length} aberto={aberto} onAlternar={() => setMaisDados(!aberto)}>
      <div data-testid="compras-zona-adicionais"><ColunaDeCampos>{adicionais.map(desenhar)}</ColunaDeCampos></div>
    </DadosAdicionais>
  </>;
}

/**
 * O DESENHO DE UM CAMPO do cabeçalho (o mesmo nos Dados e nas abas do painel): rótulo, "*", erro e trava do layout.
 * Na edição, Fornecedor, Empresa e Data ficam em leitura; a Empresa é sempre a do pedido.
 */
function desenhoDoCampo(e: EstadoDoFormularioDoOrcamento): (campo: string) => React.ReactNode {
  const h = e.cabecalho;
  const edicao = e.modo === "edicao";
  /* Sem layout nada de `data-campo`; com layout, o invólucro leva o campo, o obrigatório e o forçado pela regra. */
  const dc = (c: string) => (e.layout ? { "data-campo": c, "data-obrigatorio": String(e.obrigatorio(c)), ...(e.forcados.has(c) ? { "data-forcado": "true" } : {}) } : {});
  const aviso = (c: string) => (e.padraoInvalido(c) ? <p data-testid="padrao-invalido-aviso" className="mt-0.5 text-[11px] text-amber-700">{AVISO_PADRAO_INVALIDO_CENTRAL}</p> : null);
  const cc = (c: string, hoje: string, o: { icone?: IconeDoCampo; preenchido: boolean; multilinha?: boolean; testId?: string }, controle: React.ReactElement) =>
    <CampoDaCentral key={c} rotulo={e.rotulo(c, hoje)} obrigatorio={e.obrigatorio(c)} erro={e.erro(c)} icone={o.icone ?? null} preenchido={o.preenchido}
      multilinha={o.multilinha} testId={o.testId} abaixo={aviso(c)} {...dc(c)}>{controle}</CampoDaCentral>;
  /** Campo em LEITURA dentro do formulário (Empresa; e, na edição, Fornecedor e Data). */
  const leitura = (c: string, hoje: string, valor: string, testId: string) =>
    <CampoDaCentral key={c} rotulo={e.rotulo(c, hoje)} obrigatorio={e.obrigatorio(c)} erro={e.erro(c)} estado="travado" testId={testId} {...dc(c)}>{valor}</CampoDaCentral>;
  const mudar = (c: ChaveDoCabecalhoDoOrcamento) => (v: string | null | undefined) => e.mudar({ [c]: v ?? "" });

  const desenhar = (c: string): React.ReactNode => {
    switch (c) {
      case "empresa_id": return leitura(c, "Empresa", e.pedido.empresaNome, "compras-orcamento-empresa");
      case "fornecedor_id": return edicao
        ? leitura(c, "Fornecedor", e.orcamento?.fornecedorNome ?? "", "compras-orcamento-fornecedor")
        : cc(c, "Fornecedor", { icone: "pesquisa", preenchido: Boolean(h.fornecedor_id), testId: "compras-orcamento-fornecedor" },
          <RefSelect resource="people" value={h.fornecedor_id} onChange={mudar("fornecedor_id")} filter={{ is_provider: "true" }} />);
      case "data_documento": return edicao
        ? leitura(c, "Data do documento", dateBR(h.data_documento), "compras-data-documento")
        : cc(c, "Data do documento", { icone: "data", preenchido: Boolean(h.data_documento), testId: "compras-data-documento" },
          <DataDaCentral rotulo={e.rotulo(c, "Data do documento")} value={h.data_documento} onChange={mudar("data_documento")} />);
      case "condicao_pagamento_id": return cc(c, "Condição de pagamento", { icone: "pesquisa", preenchido: Boolean(h.condicao_pagamento_id), testId: "compras-orcamento-condicao" },
        <RefSelect resource="condicoes_pagamento" somenteIds={e.condicoesPermitidas} value={h.condicao_pagamento_id} onChange={mudar("condicao_pagamento_id")} labelHint={e.dica("condicao_pagamento_id")} />);
      case "prazo_entrega_dias": return cc(c, "Prazo de entrega (dias)", { preenchido: h.prazo_entrega_dias !== "", testId: "compras-orcamento-prazo-campo" },
        <Input data-testid="compras-orcamento-prazo-dias" type="number" inputMode="numeric" step="1" min="0" max="3650" value={h.prazo_entrega_dias}
          onChange={(ev) => e.mudar({ prazo_entrega_dias: ev.target.value })} />);
      case "validade_orcamento": return cc(c, "Validade do orçamento", { icone: "data", preenchido: Boolean(h.validade_orcamento), testId: "compras-orcamento-validade-campo" },
        <DataDaCentral rotulo={e.rotulo(c, "Validade do orçamento")} value={h.validade_orcamento} onChange={mudar("validade_orcamento")} />);
      case "observacao": return cc(c, "Observação", { preenchido: Boolean(h.observacao), multilinha: true },
        <Textarea data-testid="compras-observacao" maxLength={2000} value={h.observacao} onChange={(ev) => e.mudar({ observacao: ev.target.value })} />);
      default: return null;
    }
  };
  /* Não editável do layout TRAVA (a decisão é do estado: `travado`), mostrando o valor. */
  return (c: string) => {
    const n = desenhar(c);
    if (n === null) return null;
    return e.travado(c) ? <fieldset key={c} disabled data-editavel="false" style={{ display: "contents" }}>{n}</fieldset> : n;
  };
}

/** A grade do motor com as linhas do pedido: produto e quantidade travados, o preço digitado, sem Local de estoque. */
function ItensDoOrcamento({ e }: { e: EstadoDoFormularioDoOrcamento }) {
  const colunas = React.useMemo(() => colunasDoOrcamento(e.variante), [e.variante]);
  const layout = React.useMemo(() => layoutDaGrade(e.colunaDoUnitario, e.layout?.itens), [e.colunaDoUnitario, e.layout]);
  const itens: ItemRow[] = e.itens;
  const setItens = e.setItens;
  const erros = e.errosNoMotor;
  const daOrigem = ORIGEM_DO_PEDIDO;
  return <div data-testid="compras-itens" data-modo="orcamento">
    <ItensDoMotor prefixoTestid={PREFIXO_CENTRAL_COMPRAS} colunas={colunas} items={itens} onChange={setItens} layout={layout} erros={erros} armazemPorItem={false} custoMedioNoUnitario={false} daOrigem={daOrigem} />
    {e.errosDeItens.length > 0 && <ul data-testid="compras-erros-itens" className="mt-2 space-y-0.5 text-[12px] text-red-700">
      {e.errosDeItens.map(([c, m]) => <li key={`${c}:${m}`}>{c}: {m}</li>)}
    </ul>}
  </div>;
}

/** O painel: Totais (a conta da tela, em decimal: só apresentação) e as abas do rodapé do layout. */
function abasDoFormulario(e: EstadoDoFormularioDoOrcamento): AbaDoPainel[] {
  const total = e.totalDosItens === null ? "" : brl(e.totalDosItens);
  const abas: AbaDoPainel[] = [{
    value: "totais", label: "Totais", content: <PainelColuna>
      <CampoLeitura rotulo="Subtotal dos itens" valor={total} testId="compras-orcamento-subtotal" />
      <CampoLeitura rotulo="Total do documento" adorno="travado" valor={total} testId="compras-total" />
    </PainelColuna>
  }];
  for (const a of e.zonas.abas) {
    abas.push({
      value: `aba-${a.indice}`, label: a.aba, erro: a.campos.some((c) => Boolean(e.erro(c))),
      content: <div data-testid={`compras-zona-aba-${a.indice}`}><CamposDaAba e={e} campos={a.campos} /></div>
    });
  }
  return abas;
}

function CamposDaAba({ e, campos }: { e: EstadoDoFormularioDoOrcamento; campos: readonly string[] }) {
  const desenhar = desenhoDoCampo(e);
  const corpo = campos.map(desenhar);
  return campos.length === 1 && campos[0] === "observacao" ? <PainelLargo>{corpo}</PainelLargo> : <PainelColuna>{corpo}</PainelColuna>;
}
