"use client";
import * as React from "react";
import * as DropdownP from "@radix-ui/react-dropdown-menu";
import * as PopoverP from "@radix-ui/react-popover";
import { Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Columns3, EllipsisVertical, FileText, Grid3x3, Lock, Plus, Search } from "lucide-react";
import { cn, brl, num, pct } from "@/lib/utils";
import { StockCell, type Row } from "@/features/docs/shared";
import { ehDecimalDaApi } from "@/features/stock/reserva-estoque";
import estilos from "./central-vendas-workspace.module.css";
import grade from "./central-vendas-grade.module.css";

/**
 * CENTRAL DE VENDAS EM CONSULTA — as peças de LEITURA do documento salvo (VISUAL-UX-01 R3; desenho na VISUAL-UX-02).
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

/*
 * ┌─ OS ITENS DO DOCUMENTO SALVO, NO DESENHO (VISUAL-UX-02) ───────────────────────────────────────────┐
 * │ Barra de 36px: [Ampliar] [Adicionar produto] … [Grade | Formulário] [Configurar colunas].          │
 * │ Grade: cabeçalho de 28px, linha de 23px, zebra e hover; SEM seleção, SEM edição, SEM lixeira —      │
 * │ em consulta não há o que marcar nem o que excluir. Rodapé de 32px: "Itens (N)" e o subtotal DO      │
 * │ SERVIDOR (em consulta nada é somado no cliente).                                                    │
 * │                                                                                                    │
 * │ "Adicionar produto" aparece DESABILITADO, com a dica "Somente leitura", como no desenho: a ação é    │
 * │ do documento (a criação a tem), só não está disponível neste modo — "aplicável, porém indisponível │
 * │ agora" fica desabilitado; o que não se aplica some (`.claude/rules/frontend-web.md`).               │
 * │                                                                                                    │
 * │ Grade | Formulário, "Mostrar grade e formulário" e Configurar colunas são ESTADO DESTA TELA          │
 * │ (`useState`): nada vai para localStorage, sessionStorage, perfil ou API, e remontar devolve o       │
 * │ padrão. Esconder uma coluna ou um campo só muda o que se vê.                                        │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * AS COLUNAS SÃO UMA LISTA SÓ: `colgroup`, cabeçalho, linhas, a largura mínima e o `colSpan` da linha vazia leem a
 * MESMA lista (`.claude/rules/frontend-web.md`: colSpan derivado, nunca contado à mão). Cada coluna opcional entra na
 * lista pela sua marca, e a linha vazia acompanha sozinha. O formulário do item lê a sua própria lista, na mesma forma.
 */
type ChaveDaColuna = "codigo" | "produto" | "armazem" | "estoque" | "quantidade" | "unitario" | "desconto" | "descontoPercentual" | "total" | "faturado" | "saldo" | "reservado";
type ChaveDoCampo = Exclude<ChaveDaColuna, "codigo"> | "unidade";

interface ColunaDoItemSalvo {
  chave: ChaveDaColuna;
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

interface CampoDoItemSalvo { chave: ChaveDoCampo; rotulo: string; adorno?: Adorno; valor: (it: Row) => React.ReactNode }

const textoDoItem = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const idDe = (v: unknown) => (typeof v === "string" && v ? v : undefined);

function SaldoDoItem({ it }: { it: Row }) {
  return <StockCell warehouseId={idDe(it["warehouse_id"])} productId={idDe(it["product_id"])} onCost={() => { /* consulta: só exibe o saldo */ }} />;
}

/**
 * Colunas na ordem do desenho. Rótulos: os de hoje ("Desconto %" continua até o catálogo do domínio trazer o "Desc. %"
 * do desenho — F1); por isso a coluna mantém a largura que cabe o rótulo de hoje (90), e não os 74 do desenho.
 */
const COLUNAS_DO_ITEM_SALVO: readonly ColunaDoItemSalvo[] = [
  { chave: "codigo", rotulo: "Código", largura: 70, celula: (it) => textoDoItem(it["product_code"]) },
  { chave: "produto", rotulo: "Produto", largura: 170, elastica: true, celula: (it) => textoDoItem(it["product_name"]) },
  { chave: "armazem", rotulo: "Armazém", largura: 108, celula: (it) => textoDoItem(it["warehouse_name"]) },
  { chave: "estoque", rotulo: "Estoque", largura: 74, numero: true, estoque: true, celula: (it) => <SaldoDoItem it={it} /> },
  { chave: "quantidade", rotulo: "Quantidade", largura: 104, numero: true, celula: (it) => <span className={grade.quantidade}>
    <span data-testid="central-vendas-quantidade">{num(String(it["quantity"] ?? "0"), 2)}</span>
    {it["unit"] ? <span className={grade.unidade} data-testid="central-vendas-unidade">{String(it["unit"])}</span> : null}
  </span> },
  { chave: "unitario", rotulo: "Valor unitário", largura: 108, numero: true, celula: (it) => brl(String(it["unit_price"] ?? "0")) },
  { chave: "desconto", rotulo: "Desconto", largura: 88, numero: true, celula: (it) => (Number(it["discount"] || 0) ? brl(String(it["discount"])) : "—") },
  { chave: "descontoPercentual", rotulo: "Desconto %", largura: 90, numero: true, celula: (it) => (Number(it["discount_percent"] || 0) ? pct(String(it["discount_percent"]), 2) : "—") },
  { chave: "total", rotulo: "Total", largura: 102, numero: true, forte: true, celula: (it) => brl(String(it["total"] ?? "0")) }
];

/** TOP-CONFIG-06: documento com parte gerada — Faturado e Saldo, do servidor. */
const COLUNAS_DO_SALDO: readonly ColunaDoItemSalvo[] = [
  { chave: "faturado", rotulo: "Faturado", largura: 100, numero: true, testId: "doc-item-faturado", celula: (it) => num(String(it["faturado"] ?? "0"), 2) },
  { chave: "saldo", rotulo: "Saldo", largura: 100, numero: true, testId: "doc-item-saldo", celula: (it) => num(String(it["saldo"] ?? it["quantity"] ?? "0"), 2) }
];

/**
 * TOP-CONFIG-07: pedido cuja versão congelada reserva estoque — o que cada item ainda segura no armazém (o saldo a
 * faturar enquanto o pedido está aberto; zero depois), do servidor. Valor ausente ou fora da forma decimal: "—".
 */
const COLUNAS_DA_RESERVA: readonly ColunaDoItemSalvo[] = [
  { chave: "reservado", rotulo: "Reservado", largura: 100, numero: true, testId: "doc-item-reservado", celula: (it) => (ehDecimalDaApi(it["reservado"]) ? num(it["reservado"], 2) : "—") }
];

/**
 * Campos do formulário do item, na ordem do desenho; o que o sistema calcula aparece travado. Os valores seguem o
 * formulário do desenho (o mesmo do item em edição): números com 2 casas, o total em reais, o estoque com a unidade.
 */
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
const CAMPOS_DO_SALDO: readonly CampoDoItemSalvo[] = [
  { chave: "faturado", rotulo: "Faturado", adorno: "travado", valor: (it) => num(String(it["faturado"] ?? "0"), 2) },
  { chave: "saldo", rotulo: "Saldo", adorno: "travado", valor: (it) => num(String(it["saldo"] ?? it["quantity"] ?? "0"), 2) }
];
const CAMPOS_DA_RESERVA: readonly CampoDoItemSalvo[] = [
  { chave: "reservado", rotulo: "Reservado", adorno: "travado", valor: (it) => (ehDecimalDaApi(it["reservado"]) ? num(it["reservado"], 2) : "") }
];

/** Uma coluna/campo e se está à vista — a preferência DESTA tela (sem persistência). */
interface Preferencia<K extends string> { chave: K; visivel: boolean }

/**
 * A preferência sobre o que existe AGORA: sem preferência (null) vale a ordem padrão; com ela, o que sumiu sai e o que
 * apareceu (uma coluna opcional que o servidor passou a declarar) entra no fim, à vista.
 */
function aplicarPreferencia<K extends string>(prefs: readonly Preferencia<K>[] | null, disponiveis: readonly K[]): Preferencia<K>[] {
  if (!prefs) return disponiveis.map((chave) => ({ chave, visivel: true }));
  const mantidas = prefs.filter((p) => disponiveis.includes(p.chave));
  const novas = disponiveis.filter((k) => !prefs.some((p) => p.chave === k)).map((chave) => ({ chave, visivel: true }));
  return [...mantidas, ...novas];
}

type Visao = "grade" | "formulario";

/**
 * `mostrarSaldo` (TOP-CONFIG-06): documento com parte gerada ganha as colunas Faturado e Saldo, do servidor.
 * `mostrarReservado` (TOP-CONFIG-07): pedido com reserva de estoque ganha a coluna Reservado, do servidor.
 * `avisos`: avisos funcionais dos itens (saldo encerrado, parte gerada), entre a barra e a grade, com o testid de cada um.
 */
export function ItensSalvos({ itens, subtotal, legenda, mostrarSaldo = false, mostrarReservado = false, avisos = [] }: {
  itens: Row[]; subtotal: string; legenda: string; mostrarSaldo?: boolean; mostrarReservado?: boolean;
  avisos?: readonly { testId: string; conteudo: React.ReactNode }[];
}) {
  const colunas = React.useMemo(() => [...COLUNAS_DO_ITEM_SALVO, ...(mostrarSaldo ? COLUNAS_DO_SALDO : []), ...(mostrarReservado ? COLUNAS_DA_RESERVA : [])], [mostrarSaldo, mostrarReservado]);
  const campos = React.useMemo(() => [...CAMPOS_DO_ITEM_SALVO, ...(mostrarSaldo ? CAMPOS_DO_SALDO : []), ...(mostrarReservado ? CAMPOS_DA_RESERVA : [])], [mostrarSaldo, mostrarReservado]);

  const [visao, setVisao] = React.useState<Visao>("grade");
  const [ambos, setAmbos] = React.useState(false);
  const [prefColunas, setPrefColunas] = React.useState<Preferencia<ChaveDaColuna>[] | null>(null);
  const [prefCampos, setPrefCampos] = React.useState<Preferencia<ChaveDoCampo>[] | null>(null);
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
    <table className={grade.grade} style={{ minWidth: larguraMinima }} aria-label={legenda} data-testid="central-vendas-grade">
      <colgroup>{visiveis.map((c) => <col key={c.chave} style={c.elastica ? undefined : { width: c.largura }} />)}</colgroup>
      <thead><tr>{visiveis.map((c) => <th key={c.chave} scope="col">{c.rotulo}</th>)}</tr></thead>
      <tbody>
        {itens.length === 0 && <tr><td colSpan={visiveis.length} className={grade.vazio}>Nenhum item neste documento.</td></tr>}
        {itens.map((it, n) => <tr key={String(it["id"] ?? n)} className={grade.linha} data-testid="central-vendas-linha">
          {visiveis.map((c) => <td key={c.chave} className={cn(c.numero && grade.numero, c.forte && grade.forte, c.estoque && grade.estoque)} data-testid={c.testId}>{c.celula(it)}</td>)}
        </tr>)}
      </tbody>
    </table>
  </div>;

  const formulario = <div className={grade.form} data-testid="central-vendas-item-form">
    {!item ? <div className={grade.formVazio}>Nenhum item neste documento.</div> : <>
      <div className={grade.formNav}>
        <span className={grade.formNavTitulo} data-testid="central-vendas-item-posicao">Item {i + 1} de {itens.length}</span>
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
      {/* ▶ AMPLIAR (W3): `<BotaoAmpliar regiao="itens" />`, da moldura, entra AQUI — antes de "Adicionar produto". */}
      <button type="button" className={cn(grade.botao, grade.botaoAdicionar, estilos.dicaInicio)} aria-label="Adicionar produto" data-dica="Somente leitura" disabled><Plus aria-hidden /></button>
      <span className={grade.espaco} />
      <div className={grade.segmento} role="group" aria-label="Visualização dos itens">
        <button type="button" aria-pressed={visao === "grade"} aria-label="Grade" data-dica="Grade" onClick={() => escolherVisao("grade")}><Grid3x3 aria-hidden /></button>
        <button type="button" aria-pressed={visao === "formulario"} aria-label="Formulário" data-dica="Formulário" data-visao="formulario" onClick={() => escolherVisao("formulario")}><FileText aria-hidden /></button>
      </div>
      {configDoFormulario
        ? <ConfigurarColunas<ChaveDoCampo> titulo="Visualização do formulário" subtitulo="Campos visíveis e ordem"
            rotulos={Object.fromEntries(campos.map((c) => [c.chave, c.rotulo])) as Record<ChaveDoCampo, string>}
            lista={listaCampos} onLista={setPrefCampos} onRestaurar={() => setPrefCampos(null)} ambos={ambos} onAmbos={alternarAmbos} />
        : <ConfigurarColunas<ChaveDaColuna> titulo="Colunas da grade" subtitulo="Colunas visíveis e ordem"
            rotulos={Object.fromEntries(colunas.map((c) => [c.chave, c.rotulo])) as Record<ChaveDaColuna, string>}
            lista={listaColunas} onLista={setPrefColunas} onRestaurar={() => setPrefColunas(null)} ambos={ambos} onAmbos={alternarAmbos} />}
    </div>
    {avisos.map((a) => <p key={a.testId} className={grade.aviso} data-testid={a.testId}>{a.conteudo}</p>)}
    <div className={grade.corpo} data-visao={ambos ? "ambos" : visao} data-testid="central-vendas-itens-corpo">
      {mostraGrade && tabela}
      {mostraFormulario && formulario}
    </div>
    <div className={grade.rodape} data-testid="central-vendas-itens-rodape">
      <span className={grade.rodapeTitulo}>Itens <span className={grade.rodapeContagem} data-testid="central-vendas-itens-contagem">({itens.length})</span></span>
      {/* subtotal DO SERVIDOR: em consulta nada é somado no cliente */}
      <span>Subtotal dos itens <b className={grade.rodapeValor} data-testid="central-vendas-subtotal">{brl(subtotal)}</b></span>
    </div>
  </>;
}

/**
 * "Configurar colunas": o popover de vidro do desenho (340px, ancorado ao botão, abrindo para baixo), com uma caixa por
 * coluna/campo, subir/descer, "Mostrar grade e formulário" e "Restaurar padrão". Radix Popover entrega o papel, o foco,
 * Esc e o clique fora; aqui só se veste. Só muda a lista que recebe — estado da tela. A última coluna à vista não se
 * desmarca (caixa desabilitada, como o desenho prevê): uma grade sem coluna nenhuma não mostraria item nenhum.
 */
export function ConfigurarColunas<K extends string>({ titulo, subtitulo, rotulos, lista, onLista, onRestaurar, ambos, onAmbos }: {
  titulo: string; subtitulo: string; rotulos: Record<K, string>; lista: readonly Preferencia<K>[];
  onLista: (l: Preferencia<K>[]) => void; onRestaurar: () => void; ambos: boolean; onAmbos: () => void;
}) {
  const [aberta, setAberta] = React.useState(false);
  const visiveis = lista.filter((c) => c.visivel).length;
  const alternar = (i: number) => onLista(lista.map((c, j) => (j === i ? { ...c, visivel: !c.visivel } : c)));
  const mover = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= lista.length) return; const n = lista.slice(); [n[i], n[j]] = [n[j]!, n[i]!]; onLista(n); };
  return <PopoverP.Root open={aberta} onOpenChange={setAberta}>
    <PopoverP.Trigger asChild>
      <button type="button" className={cn(grade.botao, estilos.dicaFim)} aria-label="Configurar colunas" data-dica="Configurar colunas" data-testid="central-vendas-configurar"><Columns3 aria-hidden /></button>
    </PopoverP.Trigger>
    <PopoverP.Content side="bottom" align="end" sideOffset={11} collisionPadding={8} className={grade.config} aria-label={titulo} data-testid="central-vendas-configuracao">
      <div className={grade.configCabecalho}><span className={grade.configTitulo}>{titulo}</span><span className={grade.configSub}>{subtitulo}</span></div>
      <div className={grade.configLista} role="list">
        {lista.map((c, i) => <div key={c.chave} className={grade.configLinha} role="listitem">
          <button type="button" role="checkbox" aria-checked={c.visivel} aria-label={`Mostrar ${rotulos[c.chave]}`} className={grade.caixa}
            disabled={c.visivel && visiveis <= 1} onClick={() => alternar(i)}>{c.visivel && <Check aria-hidden strokeWidth={2} />}</button>
          <span className={grade.configRotulo}>{rotulos[c.chave]}</span>
          <button type="button" className={grade.mover} aria-label={`Subir ${rotulos[c.chave]}`} title="Subir" disabled={i === 0} onClick={() => mover(i, -1)}><ChevronUp aria-hidden /></button>
          <button type="button" className={grade.mover} aria-label={`Descer ${rotulos[c.chave]}`} title="Descer" disabled={i === lista.length - 1} onClick={() => mover(i, 1)}><ChevronDown aria-hidden /></button>
        </div>)}
      </div>
      <div className={grade.configVisao}>
        <div className={grade.configLinha}>
          <button type="button" role="checkbox" aria-checked={ambos} aria-label="Mostrar grade e formulário" className={grade.caixa} onClick={onAmbos}>{ambos && <Check aria-hidden strokeWidth={2} />}</button>
          <span className={grade.configRotulo}>Mostrar grade e formulário</span>
        </div>
      </div>
      <div className={grade.configRodape}>
        <span className={grade.configNota}>Campos disponíveis para esta operação</span>
        <button type="button" className={grade.link} onClick={onRestaurar}>Restaurar padrão</button>
      </div>
    </PopoverP.Content>
  </PopoverP.Root>;
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
