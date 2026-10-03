"use client";
import * as React from "react";
import Link from "next/link";
import { ESPECIES_COM_DESTINO_ESTOQUE, ESPECIE_DE_ORIGEM_ESTOQUE, especieDeOrigemEstoque } from "@agro/domain";
import { StatusBadge, statusTone } from "@/components/ui";
import { enumLabel } from "@/lib/copy";
import { brl, dateBR, dateTimeBR, num } from "@/lib/utils";
import type { Row } from "@/features/docs/shared";
import { CampoLeitura, ColunaDeCampos } from "@/features/central/campo";
import { ItensSalvos, type AvisoDosItens, type ColunaExtraDoItemSalvo } from "@/features/central/itens-salvos";
import { PainelColuna, PainelLargo, Relacao, Selo, type ColunaDaRelacao } from "@/features/central/painel";
import type { AbaDoPainel } from "@/features/central/contrato";
import { rotaDoDocumentoEstoque } from "../movimentacoes-variantes";
import { rotuloDoErro } from "../central-estoque-campos";
import { PREFIXO_CENTRAL_ESTOQUE, colunasDosItensDeEstoque } from "./adaptador";
import { DestinoEmLeitura } from "./destino";
import { destinoDaOrigem, rotuloDoCampoDaOrigem } from "./origem";
import type { EstadoDaConsultaDeEstoque } from "./estado-consulta";

/**
 * O CORPO DA CONSULTA DO DOCUMENTO DE ESTOQUE NO MOTOR (OPERACOES-01 F5b, decisão 282): Dados principais em LEITURA, os
 * itens salvos (grade do motor) e as abas do painel — Movimentos, Destino, Motivo da saída, Atendimento e Observações.
 * Nada aqui calcula, decide ou grava: tudo vem pronto do detalhe (`/api/estoque/<segmento>/<id>`). Os testids
 * `estoque-central-*` de antes continuam no elemento equivalente (no VALOR do campo, como antes).
 */

const t = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(v));
const traco = (v: unknown) => t(v) || "—";
const dataOuVazio = (v: unknown) => (typeof v === "string" && v ? dateBR(v) : "");

/** Os Dados principais da consulta, só leitura. */
export function DadosDaConsulta({ e }: { e: EstadoDaConsultaDeEstoque }) {
  const d = e.documento;
  if (!d) return null;
  const top = d.tipo_operacao;
  const transferencia = e.especie === "transferencia";
  const origem = d.origem;
  const especieDaOrigem = especieDeOrigemEstoque(e.especie);
  return <ColunaDeCampos>
    <CampoLeitura rotulo="Código" adorno="travado" valor={<span data-testid="estoque-central-codigo">{d.codigo}</span>} />
    <CampoLeitura rotulo="Situação" adorno="travado" valor={<span data-testid="estoque-central-situacao" data-situacao={e.situacao}>
      <StatusBadge domain="situacao_documento_estoque" value={e.situacao} tone={statusTone(e.situacao, "situacao_documento_compra")} />
    </span>} />
    {e.especie === "requisicao" && <CampoLeitura rotulo="Atendimento" adorno="travado" valor={<span data-testid="estoque-central-atendimento" data-atendimento={d.atendimento ?? ""}>
      {d.atendimento ? enumLabel("atendimento_requisicao_estoque", d.atendimento) : "—"}
    </span>} />}
    <CampoLeitura rotulo="Tipo de Operação" adorno="travado" valor={<span data-testid="estoque-central-top" data-tipo-operacao-id={top?.id ?? ""}>
      {top ? `${top.codigo} — ${top.nome}${top.versao ? ` (versão ${top.versao})` : ""}` : "—"}
    </span>} />
    <CampoLeitura rotulo="Empresa" adorno="pesquisa" valor={t(d.empresa_nome)} />
    <CampoLeitura rotulo={transferencia ? "Local de estoque de origem" : "Local de estoque"} adorno="pesquisa"
      valor={<span data-testid="estoque-central-armazem">{traco(d.armazem_nome)}</span>} />
    {transferencia && <CampoLeitura rotulo="Local de estoque de destino" adorno="pesquisa"
      valor={<span data-testid="estoque-central-armazem-destino">{traco(d.armazem_destino_nome)}</span>} />}
    <CampoLeitura rotulo="Data do documento" adorno="data" valor={<span data-testid="estoque-central-data">{dateBR(d.data_documento)}</span>} />
    {especieDaOrigem && <CampoLeitura rotulo={rotuloDoCampoDaOrigem(especieDaOrigem)} adorno="travado"
      valor={<span data-testid="estoque-central-origem" data-origem-id={d.origem_documento_id ?? ""}>
        {origem ? <Link className="text-brand-700 underline" href={rotaDoDocumentoEstoque({ id: origem.id, especie: origem.especie })}>{origem.codigo}</Link> : "—"}
      </span>} />}
    <CampoLeitura rotulo="Lançado por" adorno="travado" valor={t(d.criado_por_nome)} />
    {d.confirmado_em && <CampoLeitura rotulo="Confirmado" adorno="travado" valor={`${dateTimeBR(d.confirmado_em)} por ${traco(d.confirmado_por_nome)}`} />}
    {d.cancelado_em && <CampoLeitura rotulo="Cancelado" adorno="travado" valor={`${dateTimeBR(d.cancelado_em)} por ${traco(d.cancelado_por_nome)}`} />}
  </ColunaDeCampos>;
}

/**
 * O ITEM NAS CHAVES DA GRADE DO MOTOR (que lê `product_name`, `quantity`, `unit_price`…): a quantidade da espécie (a
 * contada, no ajuste), o custo do servidor (antes da confirmação, vazio: "—") e a validade em data brasileira. Na
 * requisição, "faturado" carrega o ATENDIDO e "saldo" o PENDENTE do servidor. Nenhum valor é calculado.
 */
export function itemDoEstoqueParaOMotor(it: Row, warehouseId: string, ajuste: boolean): Row {
  return {
    ...it,
    product_id: it["produto_id"], warehouse_id: warehouseId,
    product_code: it["produto_codigo"], product_name: it["produto_nome"],
    quantity: ajuste ? it["quantidade_contada"] : it["quantidade"], unit: it["unidade"],
    unit_price: t(it["custo_unitario"]),
    lote: it["lote"] ?? null,
    validade: dataOuVazio(it["validade"]) || null,
    faturado: it["quantidade_atendida"],
    saldo: it["saldo_pendente"] ?? it["quantidade"]
  };
}

/** As colunas que só a espécie conhece: o saldo na confirmação e a diferença (ajuste); o devolvido (consumo). */
const COLUNAS_DO_AJUSTE: readonly ColunaExtraDoItemSalvo[] = [
  { chave: "saldo-na-confirmacao", rotulo: "Saldo na confirmação", numero: true, testId: "estoque-item-saldo-na-confirmacao", valor: (it) => num(t(it["saldo_na_confirmacao"]), 4) },
  { chave: "diferenca", rotulo: "Diferença", numero: true, testId: "estoque-item-diferenca", valor: (it) => num(t(it["diferenca"]), 4) }
];
const COLUNAS_DO_CONSUMO: readonly ColunaExtraDoItemSalvo[] = [
  { chave: "devolvido", rotulo: "Devolvido", numero: true, testId: "estoque-item-devolvido", valor: (it) => num(t(it["quantidade_devolvida"]), 4) }
];
const SEM_COLUNAS_EXTRAS: readonly ColunaExtraDoItemSalvo[] = [];
const ROTULOS_DO_AJUSTE = Object.freeze({ unitario: "Custo unitário", quantidade: "Quantidade contada" });
const ROTULOS_DAS_OUTRAS = Object.freeze({ unitario: "Custo unitário" });

/**
 * Os itens salvos no motor: sem subtotal (o documento de estoque não tem valor), quantidade em 4 casas, Lote e Validade
 * (menos na requisição), "Custo unitário" (e "Quantidade contada" no ajuste); na requisição, Atendido e Saldo do
 * servidor. O 422 da última ação (confirmar, cancelar) aparece como aviso (`estoque-central-erros`). O formulário de
 * leitura é RECORTADO pelas colunas da espécie (`formularioPelasColunas`): nada de desconto, desconto % e total, nem um
 * Local de estoque por item (o local é do cabeçalho); a requisição, sem custo.
 */
export function ItensDaConsulta({ e }: { e: EstadoDaConsultaDeEstoque }) {
  const d = e.documento;
  const ajuste = e.especie === "ajuste";
  const itens = React.useMemo(() => (d ? d.itens.map((it) => itemDoEstoqueParaOMotor(it, d.armazem_id, ajuste)) : []), [d, ajuste]);
  const colunas = React.useMemo(() => colunasDosItensDeEstoque(e.variante), [e.variante]);
  if (!d) return null;
  const erros = Object.entries(e.errosDaAcao);
  const avisos: AvisoDosItens[] = erros.length ? [{
    testId: "estoque-central-erros",
    conteudo: <>{erros.map(([c, m]) => <span key={c} className="block">{rotuloDoErro(c)}: {m}</span>)}</>
  }] : [];
  const requisicao = e.especie === "requisicao";
  return <div data-testid="estoque-central-itens" className="contents">
    <ItensSalvos prefixoTestid={PREFIXO_CENTRAL_ESTOQUE} colunas={colunas} itens={itens} subtotal={null}
      legenda={`Itens ${e.rotuloDaEspecie.toLowerCase()} ${d.codigo}`} casasDaQuantidade={4}
      mostrarLote={!requisicao} mostrarSaldo={requisicao} rotuloDoGerado="Atendido" avisos={avisos}
      rotulos={ajuste ? ROTULOS_DO_AJUSTE : ROTULOS_DAS_OUTRAS} formularioPelasColunas
      colunasExtras={ajuste ? COLUNAS_DO_AJUSTE : e.especie === "consumo" ? COLUNAS_DO_CONSUMO : SEM_COLUNAS_EXTRAS} />
  </div>;
}

const COLUNAS_DOS_MOVIMENTOS: readonly ColunaDaRelacao[] = [
  { chave: "movement_date", rotulo: "Data", celula: (r) => dataOuVazio(r["movement_date"]) || "—" },
  { chave: "product_name", rotulo: "Produto", celula: (r) => traco(r["product_name"]) },
  { chave: "warehouse_name", rotulo: "Local de estoque", celula: (r) => traco(r["warehouse_name"]) },
  { chave: "movement_type", rotulo: "Movimento", celula: (r) => enumLabel("stock_movement_type", r["movement_type"]) },
  { chave: "provider_lot", rotulo: "Lote", celula: (r) => traco(r["provider_lot"]) },
  { chave: "quantity", rotulo: "Quantidade", direita: true, celula: (r) => num(t(r["quantity"]), 4) },
  { chave: "unit_cost", rotulo: "Custo unitário", direita: true, celula: (r) => brl(t(r["unit_cost"])) },
  { chave: "total_cost", rotulo: "Custo total", direita: true, celula: (r) => brl(t(r["total_cost"])) }
];

const LEGENDA_DOS_VINCULADOS: Readonly<Record<string, string>> = Object.freeze({
  requisicao: "Consumos desta requisição",
  consumo: "Devoluções deste consumo"
});

const COLUNAS_DOS_VINCULADOS: readonly ColunaDaRelacao[] = [
  { chave: "codigo", rotulo: "Código", celula: (r) => <Link className="text-brand-700 underline" data-testid="estoque-vinculado" data-especie={t(r["especie"])}
    data-codigo={t(r["codigo"])} data-situacao={t(r["situacao"])} href={rotaDoDocumentoEstoque(r)}>{traco(r["codigo"])}</Link> },
  { chave: "especie", rotulo: "Espécie", celula: (r) => enumLabel("especie_documento_estoque", r["especie"]) },
  { chave: "situacao", rotulo: "Situação", celula: (r) => <Selo tom={statusTone(r["situacao"], "situacao_documento_compra")} valor={r["situacao"]}>{enumLabel("situacao_documento_estoque", r["situacao"])}</Selo> },
  { chave: "data_documento", rotulo: "Data", celula: (r) => dataOuVazio(r["data_documento"]) || "—" }
];

/** O texto dos movimentos quando não há nenhum. */
function semMovimentos(e: EstadoDaConsultaDeEstoque): string {
  if (e.situacao === "aberto") return "Nenhum movimento: o saldo só muda quando o documento for confirmado.";
  if (e.especie === "requisicao" && e.situacao === "confirmado") return "Nenhum movimento: a requisição reserva o produto no local de estoque.";
  return "Nenhum movimento de estoque gerado.";
}

/**
 * As abas do painel da consulta, nesta ordem (a 1ª abre por padrão): Movimentos; Destino (as espécies que o levam — a
 * saída, só quando o documento TEM destino); Motivo da saída (a saída com motivo); Atendimento (requisição, consumo e
 * devolução de consumo); Observações. Sem documento: as abas sem conteúdo (estrutura da tela, não dado).
 */
export function abasDaConsulta(e: EstadoDaConsultaDeEstoque): AbaDoPainel[] {
  const d = e.documento;
  // as espécies vêm do domínio: as que levam destino, e as que puxam de uma origem ou são a origem de outra.
  // A SAÍDA é uma das quatro de antes: a API sem a movimentação interna (skew sentido 1) nem grava destino nela. Como o
  // Motivo da saída, a aba Destino dela aparece só quando o documento o tem — nunca "Sem destino." de um recurso que
  // aquela API não tem (M-1 da revisão da fase). As três da movimentação interna sempre a têm.
  const destinoDaEspecie = ESPECIES_COM_DESTINO_ESTOQUE.includes(e.especie);
  const comDestino = destinoDaEspecie && (e.especie !== "saida" || (d !== undefined && Object.keys(destinoDaOrigem(d)).length > 0));
  const comAtendimento = especieDeOrigemEstoque(e.especie) !== null || Object.values(ESPECIE_DE_ORIGEM_ESTOQUE).includes(e.especie);
  const comMotivo = e.especie === "saida" && Boolean(d?.motivo_saida);
  if (!d) {
    return [
      { value: "movimentos", label: "Movimentos", content: null },
      ...(comDestino ? [{ value: "destino", label: "Destino", content: null }] : []),
      ...(comAtendimento ? [{ value: "atendimento", label: "Atendimento", content: null }] : []),
      { value: "observacoes", label: "Observações", content: null }
    ];
  }
  const abas: AbaDoPainel[] = [
    { value: "movimentos", label: "Movimentos", contador: d.movimentos.length, content: <PainelLargo><div data-testid="estoque-central-movimentos">
      <Relacao legenda={`Movimentos de estoque do documento ${d.codigo}`} modelo="derivados" colunas={COLUNAS_DOS_MOVIMENTOS} linhas={d.movimentos} vazio={semMovimentos(e)} />
    </div></PainelLargo> }
  ];
  if (comDestino) abas.push({ value: "destino", label: "Destino", content: <DestinoEmLeitura valores={destinoDaOrigem(d)} /> });
  if (comMotivo) abas.push({ value: "motivo", label: "Motivo da saída", content: <div data-testid="estoque-central-motivo-saida"><PainelColuna>
    <CampoLeitura rotulo="Motivo" adorno="selecao" valor={d.motivo_saida ? enumLabel("writeoff_reason", d.motivo_saida) : ""} />
    <CampoLeitura rotulo="Justificativa" multilinha valor={t(d.justificativa)} />
  </PainelColuna></div> });
  if (comAtendimento) {
    const legenda = LEGENDA_DOS_VINCULADOS[e.especie];
    abas.push({ value: "atendimento", label: "Atendimento", contador: d.vinculados.length, content: <PainelLargo><div data-testid="estoque-central-vinculados" className="space-y-2">
      {d.origem && <p className="text-[12.5px] text-slate-600">
        {e.especie === "consumo" ? "Atende a requisição" : "Devolve o consumo"}{" "}
        <Link className="text-brand-700 underline" data-testid="estoque-central-vinculados-origem" href={rotaDoDocumentoEstoque({ id: d.origem.id, especie: d.origem.especie })}>{d.origem.codigo}</Link>.
      </p>}
      {d.saldo_encerrado_em && <p data-testid="estoque-central-saldo-encerrado" className="text-[12.5px] text-slate-600">
        Saldo encerrado em {dateTimeBR(d.saldo_encerrado_em)} por {traco(d.saldo_encerrado_por_nome)}: {traco(d.saldo_encerrado_motivo)}
      </p>}
      {legenda !== undefined
        ? <Relacao legenda={legenda} modelo="derivados" colunas={COLUNAS_DOS_VINCULADOS} linhas={d.vinculados.map((v): Row => ({ ...v }))} vazio="Nenhum documento ligado." />
        : !d.origem && <p className="text-[12.5px] text-slate-500">Nenhum documento ligado.</p>}
    </div></PainelLargo> });
  }
  abas.push({ value: "observacoes", label: "Observações", content: <PainelLargo>
    <CampoLeitura rotulo="Observação" multilinha valor={<span data-testid="estoque-central-observacao">{traco(d.observacao)}</span>} />
    {d.cancelado_em && <CampoLeitura rotulo="Motivo do cancelamento" multilinha valor={<span data-testid="estoque-central-motivo">{traco(d.motivo_cancelamento)}</span>} />}
  </PainelLargo> });
  return abas;
}
