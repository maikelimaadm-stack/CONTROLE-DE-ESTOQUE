"use client";
import * as React from "react";
import { ChevronLeft, ChevronRight, FileText, Grid3x3, Plus } from "lucide-react";
import { cn, brl, num, pct } from "@/lib/utils";
import { StockCell, type Row } from "@/features/docs/shared";
import { ehDecimalDaApi } from "@/features/stock/reserva-estoque";
import estilos from "./moldura.module.css";
import grade from "./grade.module.css";
import { CampoLeitura } from "./campo";
import { BotaoAmpliar } from "./moldura";
import { ConfigurarColunas } from "./configurar-colunas";
import type { AdornoDoCampo, ChaveCampoSalvo, ChaveColunaSalva, Preferencia, PropsDosItensSalvos, Visao } from "./contrato";

export type { AvisoDosItens, ChaveCampoSalvo, ChaveColunaSalva, PropsDosItensSalvos } from "./contrato";

/**
 * ITENS DO DOCUMENTO SALVO — a grade e o formulário de LEITURA do motor da Central.
 *
 * Barra de 36px: [Ampliar] [Adicionar produto (desabilitado, "Somente leitura")] … [Grade | Formulário]
 * [Configurar colunas]. Grade sem seleção, sem edição, sem lixeira; rodapé com "Itens (N)" e o subtotal DO SERVIDOR.
 * Grade | Formulário, "Mostrar grade e formulário" e Configurar colunas são ESTADO DESTA TELA (`useState`).
 *
 * As colunas são UMA lista só: `colgroup`, cabeçalho, linhas, largura mínima e o `colSpan` da linha vazia leem a
 * MESMA lista. A ordem padrão vem do adaptador (`colunas.leitura`); as opcionais entram pela sua marca.
 */
interface ColunaDoItemSalvo {
  chave: ChaveColunaSalva;
  rotulo: string;
  /** largura do desenho; a coluna ELÁSTICA (Produto) usa o valor como mínimo e fica com o que sobrar */
  largura: number;
  elastica?: boolean;
  numero?: boolean;
  forte?: boolean;
  estoque?: boolean;
  testId?: string;
  celula: (it: Row) => React.ReactNode;
}

interface CampoDoItemSalvo { chave: ChaveCampoSalvo; rotulo: string; adorno?: AdornoDoCampo; valor: (it: Row) => React.ReactNode }

const textoDoItem = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const idDe = (v: unknown) => (typeof v === "string" && v ? v : undefined);

function SaldoDoItem({ it }: { it: Row }) {
  return <StockCell warehouseId={idDe(it["warehouse_id"])} productId={idDe(it["product_id"])} onCost={() => { /* consulta: só exibe o saldo */ }} />;
}

/** Colunas fixas que entram por marca, não pela lista do adaptador. */
const OPCIONAIS: ReadonlySet<ChaveColunaSalva> = new Set<ChaveColunaSalva>(["faturado", "saldo", "reservado", "lote", "validade"]);

function catalogoDeColunas(prefixoTestid: string): Partial<Record<ChaveColunaSalva, ColunaDoItemSalvo>> {
  return {
    codigo: { chave: "codigo", rotulo: "Código", largura: 70, celula: (it) => textoDoItem(it["product_code"]) },
    produto: { chave: "produto", rotulo: "Produto", largura: 170, elastica: true, celula: (it) => textoDoItem(it["product_name"]) },
    armazem: { chave: "armazem", rotulo: "Armazém", largura: 108, celula: (it) => textoDoItem(it["warehouse_name"]) },
    estoque: { chave: "estoque", rotulo: "Estoque", largura: 74, numero: true, estoque: true, celula: (it) => <SaldoDoItem it={it} /> },
    quantidade: { chave: "quantidade", rotulo: "Quantidade", largura: 104, numero: true, celula: (it) => <span className={grade.quantidade}>
      <span data-testid={`${prefixoTestid}-quantidade`}>{num(String(it["quantity"] ?? "0"), 2)}</span>
      {it["unit"] ? <span className={grade.unidade} data-testid={`${prefixoTestid}-unidade`}>{String(it["unit"])}</span> : null}
    </span> },
    unitario: { chave: "unitario", rotulo: "Valor unitário", largura: 108, numero: true, celula: (it) => brl(String(it["unit_price"] ?? "0")) },
    desconto: { chave: "desconto", rotulo: "Desconto", largura: 88, numero: true, celula: (it) => (Number(it["discount"] || 0) ? brl(String(it["discount"])) : "—") },
    descontoPercentual: { chave: "descontoPercentual", rotulo: "Desconto %", largura: 90, numero: true, celula: (it) => (Number(it["discount_percent"] || 0) ? pct(String(it["discount_percent"]), 2) : "—") },
    total: { chave: "total", rotulo: "Total", largura: 102, numero: true, forte: true, celula: (it) => brl(String(it["total"] ?? "0")) }
  };
}

const COLUNAS_DO_LOTE: readonly ColunaDoItemSalvo[] = [
  { chave: "lote", rotulo: "Lote", largura: 100, testId: "doc-item-lote", celula: (it) => textoDoItem(it["lote"]) },
  { chave: "validade", rotulo: "Validade", largura: 96, testId: "doc-item-validade", celula: (it) => textoDoItem(it["validade"]) }
];

/** Documento com parte gerada — a parte gerada (o rótulo é da espécie) e o Saldo, do servidor. */
const colunasDoSaldo = (rotuloDoGerado: string): readonly ColunaDoItemSalvo[] => [
  { chave: "faturado", rotulo: rotuloDoGerado, largura: 100, numero: true, testId: "doc-item-faturado", celula: (it) => num(String(it["faturado"] ?? "0"), 2) },
  { chave: "saldo", rotulo: "Saldo", largura: 100, numero: true, testId: "doc-item-saldo", celula: (it) => num(String(it["saldo"] ?? it["quantity"] ?? "0"), 2) }
];

/** Documento cuja versão congelada reserva estoque — o que cada item ainda segura, do servidor. */
const COLUNAS_DA_RESERVA: readonly ColunaDoItemSalvo[] = [
  { chave: "reservado", rotulo: "Reservado", largura: 100, numero: true, testId: "doc-item-reservado", celula: (it) => (ehDecimalDaApi(it["reservado"]) ? num(it["reservado"], 2) : "—") }
];

const CAMPOS_DO_ITEM_SALVO: readonly CampoDoItemSalvo[] = [
  { chave: "produto", rotulo: "Produto", adorno: "pesquisa", valor: (it) => (it["product_code"] ? `${texto(it["product_code"])} · ${texto(it["product_name"])}` : texto(it["product_name"])) },
  { chave: "armazem", rotulo: "Armazém", adorno: "pesquisa", valor: (it) => texto(it["warehouse_name"]) },
  { chave: "estoque", rotulo: "Estoque", adorno: "travado", valor: (it) => <><SaldoDoItem it={it} />{it["unit"] ? ` ${texto(it["unit"])}` : ""}</> },
  { chave: "unidade", rotulo: "Unidade", adorno: "travado", valor: (it) => texto(it["unit"]) },
  { chave: "quantidade", rotulo: "Quantidade", valor: (it) => num(String(it["quantity"] ?? "0"), 2) },
  { chave: "unitario", rotulo: "Valor unitário", valor: (it) => num(String(it["unit_price"] ?? "0"), 2) },
  { chave: "desconto", rotulo: "Desconto", valor: (it) => num(String(it["discount"] || "0"), 2) },
  { chave: "descontoPercentual", rotulo: "Desconto %", valor: (it) => num(String(it["discount_percent"] || "0"), 2) },
  { chave: "total", rotulo: "Total", adorno: "travado", valor: (it) => brl(String(it["total"] ?? "0")) }
];
const CAMPOS_DO_LOTE: readonly CampoDoItemSalvo[] = [
  { chave: "lote", rotulo: "Lote", adorno: "travado", valor: (it) => texto(it["lote"]) },
  { chave: "validade", rotulo: "Validade", adorno: "travado", valor: (it) => texto(it["validade"]) }
];
const camposDoSaldo = (rotuloDoGerado: string): readonly CampoDoItemSalvo[] => [
  { chave: "faturado", rotulo: rotuloDoGerado, adorno: "travado", valor: (it) => num(String(it["faturado"] ?? "0"), 2) },
  { chave: "saldo", rotulo: "Saldo", adorno: "travado", valor: (it) => num(String(it["saldo"] ?? it["quantity"] ?? "0"), 2) }
];
const CAMPOS_DA_RESERVA: readonly CampoDoItemSalvo[] = [
  { chave: "reservado", rotulo: "Reservado", adorno: "travado", valor: (it) => (ehDecimalDaApi(it["reservado"]) ? num(it["reservado"], 2) : "") }
];

/**
 * A preferência sobre o que existe AGORA: sem preferência (null) vale a ordem padrão; com ela, o que sumiu sai e o que
 * apareceu entra no fim, à vista.
 */
function aplicarPreferencia<K extends string>(prefs: readonly Preferencia<K>[] | null, disponiveis: readonly K[]): Preferencia<K>[] {
  if (!prefs) return disponiveis.map((chave) => ({ chave, visivel: true }));
  const mantidas = prefs.filter((p) => disponiveis.includes(p.chave));
  const novas = disponiveis.filter((k) => !prefs.some((p) => p.chave === k)).map((chave) => ({ chave, visivel: true }));
  return [...mantidas, ...novas];
}

/**
 * `colunas.leitura`: a ordem padrão da espécie. `mostrarLote`: Lote e Validade gravados (desligado por padrão).
 * `mostrarSaldo`: a parte gerada (`rotuloDoGerado`, padrão "Faturado") e o Saldo, do servidor. `mostrarReservado`: Reservado, do servidor.
 * `avisos`: avisos funcionais dos itens, entre a barra e a grade, com o testid de cada um.
 */
export function ItensSalvos({ prefixoTestid, colunas: colunasDaEspecie, itens, subtotal, legenda, mostrarSaldo = false, mostrarReservado = false, mostrarLote = false, rotuloDoGerado = "Faturado", avisos = [] }: PropsDosItensSalvos) {
  const leitura = colunasDaEspecie.leitura;
  const colunas = React.useMemo(() => {
    const catalogo = catalogoDeColunas(prefixoTestid);
    const base = leitura.filter((k) => !OPCIONAIS.has(k)).map((k) => catalogo[k]).filter((c): c is ColunaDoItemSalvo => c !== undefined);
    return [...base, ...(mostrarLote ? COLUNAS_DO_LOTE : []), ...(mostrarSaldo ? colunasDoSaldo(rotuloDoGerado) : []), ...(mostrarReservado ? COLUNAS_DA_RESERVA : [])];
  }, [prefixoTestid, leitura, mostrarLote, mostrarSaldo, mostrarReservado, rotuloDoGerado]);
  const campos = React.useMemo(() => [...CAMPOS_DO_ITEM_SALVO, ...(mostrarLote ? CAMPOS_DO_LOTE : []), ...(mostrarSaldo ? camposDoSaldo(rotuloDoGerado) : []), ...(mostrarReservado ? CAMPOS_DA_RESERVA : [])], [mostrarLote, mostrarSaldo, mostrarReservado, rotuloDoGerado]);

  const [visao, setVisao] = React.useState<Visao>("grade");
  const [ambos, setAmbos] = React.useState(false);
  const [prefColunas, setPrefColunas] = React.useState<Preferencia<ChaveColunaSalva>[] | null>(null);
  const [prefCampos, setPrefCampos] = React.useState<Preferencia<ChaveCampoSalvo>[] | null>(null);
  const [atual, setAtual] = React.useState(0);

  const listaColunas = aplicarPreferencia(prefColunas, colunas.map((c) => c.chave));
  const listaCampos = aplicarPreferencia(prefCampos, campos.map((c) => c.chave));
  const visiveis = listaColunas.filter((p) => p.visivel).map((p) => colunas.find((c) => c.chave === p.chave)!);
  const camposVisiveis = listaCampos.filter((p) => p.visivel).map((p) => campos.find((c) => c.chave === p.chave)!);
  // largura mínima DERIVADA das colunas visíveis (a elástica conta o seu mínimo), nunca contada à mão
  const larguraMinima = visiveis.reduce((a, c) => a + c.largura, 0);

  const mostraGrade = visao === "grade" || ambos;
  const mostraFormulario = visao === "formulario";
  const configDoFormulario = visao === "formulario";
  const i = Math.min(atual, Math.max(0, itens.length - 1));
  const item = itens[i];

  const tabela = <div className={grade.rolagem}>
    <table className={grade.grade} style={{ minWidth: larguraMinima }} aria-label={legenda} data-testid={`${prefixoTestid}-grade`}>
      <colgroup>{visiveis.map((c) => <col key={c.chave} style={c.elastica ? undefined : { width: c.largura }} />)}</colgroup>
      <thead><tr>{visiveis.map((c) => <th key={c.chave} scope="col">{c.rotulo}</th>)}</tr></thead>
      <tbody>
        {itens.length === 0 && <tr><td colSpan={visiveis.length} className={grade.vazio}>Nenhum item neste documento.</td></tr>}
        {itens.map((it, n) => <tr key={String(it["id"] ?? n)} className={grade.linha} data-testid={`${prefixoTestid}-linha`}>
          {visiveis.map((c) => <td key={c.chave} className={cn(c.numero && grade.numero, c.forte && grade.forte, c.estoque && grade.estoque)} data-testid={c.testId}>{c.celula(it)}</td>)}
        </tr>)}
      </tbody>
    </table>
  </div>;

  const formulario = <div className={grade.form} data-testid={`${prefixoTestid}-item-form`}>
    {!item ? <div className={grade.formVazio}>Nenhum item neste documento.</div> : <>
      <div className={grade.formNav}>
        <span className={grade.formNavTitulo} data-testid={`${prefixoTestid}-item-posicao`}>Item {i + 1} de {itens.length}</span>
        <button type="button" className={cn(grade.botao, grade.botaoItem)} aria-label="Item anterior" data-dica="Item anterior" disabled={i <= 0} onClick={() => setAtual(i - 1)}><ChevronLeft aria-hidden /></button>
        <button type="button" className={cn(grade.botao, grade.botaoItem)} aria-label="Próximo item" data-dica="Próximo item" disabled={i >= itens.length - 1} onClick={() => setAtual(i + 1)}><ChevronRight aria-hidden /></button>
      </div>
      <div className={grade.formCampos}>
        {camposVisiveis.map((c) => <CampoLeitura key={c.chave} rotulo={c.rotulo} adorno={c.adorno} valor={c.valor(item)} />)}
      </div>
    </>}
  </div>;

  const escolherVisao = (v: Visao) => { setVisao(v); if (v === "grade") setAmbos(false); };
  const alternarAmbos = () => { const novo = !ambos; setAmbos(novo); if (novo) setVisao("formulario"); };

  return <>
    <div className={grade.barra} role="toolbar" aria-label="Itens">
      <BotaoAmpliar regiao="itens" />
      <button type="button" className={cn(grade.botao, grade.botaoAdicionar, estilos.dicaInicio)} aria-label="Adicionar produto" data-dica="Somente leitura" disabled><Plus aria-hidden /></button>
      <span className={grade.espaco} />
      <div className={grade.segmento} role="group" aria-label="Visualização dos itens">
        <button type="button" aria-pressed={visao === "grade"} aria-label="Grade" data-dica="Grade" onClick={() => escolherVisao("grade")}><Grid3x3 aria-hidden /></button>
        <button type="button" aria-pressed={visao === "formulario"} aria-label="Formulário" data-dica="Formulário" data-visao="formulario" onClick={() => escolherVisao("formulario")}><FileText aria-hidden /></button>
      </div>
      {configDoFormulario
        ? <ConfigurarColunas<ChaveCampoSalvo> prefixoTestid={prefixoTestid} titulo="Visualização do formulário" subtitulo="Campos visíveis e ordem"
            rotulos={Object.fromEntries(campos.map((c) => [c.chave, c.rotulo])) as Record<ChaveCampoSalvo, string>}
            lista={listaCampos} onLista={setPrefCampos} onRestaurar={() => setPrefCampos(null)} ambos={ambos} onAmbos={alternarAmbos} />
        : <ConfigurarColunas<ChaveColunaSalva> prefixoTestid={prefixoTestid} titulo="Colunas da grade" subtitulo="Colunas visíveis e ordem"
            rotulos={Object.fromEntries(colunas.map((c) => [c.chave, c.rotulo])) as Record<ChaveColunaSalva, string>}
            lista={listaColunas} onLista={setPrefColunas} onRestaurar={() => setPrefColunas(null)} ambos={ambos} onAmbos={alternarAmbos} />}
    </div>
    {avisos.map((a) => <p key={a.testId} className={grade.aviso} data-testid={a.testId}>{a.conteudo}</p>)}
    <div className={grade.corpo} data-visao={ambos ? "ambos" : visao} data-testid={`${prefixoTestid}-itens-corpo`}>
      {mostraGrade && tabela}
      {mostraFormulario && formulario}
    </div>
    <div className={grade.rodape} data-testid={`${prefixoTestid}-itens-rodape`}>
      <span className={grade.rodapeTitulo}>Itens <span className={grade.rodapeContagem} data-testid={`${prefixoTestid}-itens-contagem`}>({itens.length})</span></span>
      {/* subtotal DO SERVIDOR: em consulta nada é somado no navegador */}
      <span>Subtotal dos itens <b className={grade.rodapeValor} data-testid={`${prefixoTestid}-subtotal`}>{brl(subtotal)}</b></span>
    </div>
  </>;
}
