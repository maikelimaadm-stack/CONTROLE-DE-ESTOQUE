"use client";
import * as React from "react";
import { Calendar, ChevronDown, ChevronRight, ChevronUp, CircleAlert, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { MgDatePicker, type PainelDoCalendario } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import estilos from "./central-vendas-campo.module.css";

/**
 * CENTRAL DE VENDAS — O CAMPO DO DESENHO (VISUAL-UX-02, decisão 270).
 *
 * Um campo só para a Central inteira, nas DUAS densidades do desenho: "rótulo antes do campo" (padrão — rótulo de
 * 126px à direita, caixa a partir de 136px) e "rótulo dentro do campo" (compacto — rótulo flutuante). A densidade NÃO
 * é prop: ela vem do ancestral `[data-densidade]` que a moldura põe na raiz, e o CSS escolhe. Estado de tela, sem
 * armazenamento nenhum.
 *
 * ┌─ O QUE ESTE ARQUIVO NÃO DECIDE ────────────────────────────────────────────────────────────────────────────────┐
 * │ Nenhum valor, nenhum payload, nenhuma regra. Quem diz se o campo é obrigatório, se tem erro, se está travado e │
 * │ o que vai no POST continua sendo a página — aqui só se desenha o que ela manda. O controle dentro da caixa é o │
 * │ primitive de sempre (`Input`, `RefSelect`, `MgDatePicker`, `Textarea`): a rota, a chave do cache, o           │
 * │ "Cadastrar <x>" e o placeholder da pesquisa ("Pesquisar...") são os de hoje.                                  │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ESTRUTURA PARA OS HELPERS DE E2E: o `<label>` do rótulo e a caixa do controle têm o MESMO pai (`pickRef` sobe do
 * rótulo ao pai e clica no primeiro `button`, que é o do RefSelect). `data-campo`/`data-testid`/`data-exigido-top`
 * vão no invólucro externo, como antes.
 */

export type Densidade = "rotulo-a-frente" | "compacto";
export type IconeDoCampo = "pesquisa" | "data" | "selecao";
export type EstadoDoCampo = "editavel" | "leitura" | "travado" | "desabilitado";
type AtributosDeDados = { [k: `data-${string}`]: string | undefined };

const ICONES: Record<IconeDoCampo, React.ComponentType> = { pesquisa: Search, data: Calendar, selecao: ChevronDown };

function IconeDaCaixa({ icone }: { icone: IconeDoCampo | null | undefined }) {
  if (!icone) return null;
  const Icone = ICONES[icone];
  return <span className={estilos.icone} aria-hidden><Icone /></span>;
}

export type PropsDoCampo = {
  rotulo: string;
  obrigatorio?: boolean;
  /** mensagem sob a caixa, com ícone; também acende a borda de erro */
  erro?: string;
  icone?: IconeDoCampo | null;
  /** editável (padrão), só leitura (#f6f8fa), travado ou desabilitado (#e9edf2) */
  estado?: EstadoDoCampo;
  /** tem valor? A caixa vazia é cinza; a preenchida é branca com borda */
  preenchido?: boolean;
  /** caixa de texto longo (Observação): 80px nas duas densidades */
  multilinha?: boolean;
  testId?: string;
  /** o que fica sob a caixa além do erro (ex.: aviso de padrão inválido) */
  abaixo?: React.ReactNode;
  /** dica do campo (title) — informação que não cabe no rótulo */
  dica?: string;
  children: React.ReactNode;
} & AtributosDeDados;

/**
 * Um campo da Central. Com `estado` "editavel"/"desabilitado", `children` é UM controle: ele recebe o id do rótulo
 * (o RefSelect por `idDaCaixa`) e a classe que o põe dentro da caixa. Com "leitura"/"travado", `children` é o valor.
 */
export function CampoDaCentral({ rotulo, obrigatorio, erro, icone, estado = "editavel", preenchido, multilinha, testId, abaixo, dica, children, ...dados }: PropsDoCampo) {
  const gerado = React.useId();
  const comControle = estado === "editavel" || estado === "desabilitado";
  let conteudo: React.ReactNode = children;
  let id: string | undefined;
  if (comControle && React.isValidElement<{ id?: string; className?: string; idDaCaixa?: string; placeholder?: string; classeDoPainel?: string }>(children)) {
    const p = children.props;
    if (children.type === RefSelect) {
      id = p.idDaCaixa ?? gerado;
      conteudo = React.cloneElement(children, { idDaCaixa: id, className: cn(p.className, estilos.controle), placeholder: p.placeholder ?? "—", classeDoPainel: p.classeDoPainel ?? estilos.painelPesquisa });
    } else {
      id = p.id ?? gerado;
      conteudo = React.cloneElement(children, { id, className: cn(p.className, estilos.controle) });
    }
  }
  const vazio = !comControle && (children === null || children === undefined || children === "");
  const rotuloNo = comControle
    ? <label htmlFor={id} className={estilos.rotulo}>{rotulo}{obrigatorio && <span className={estilos.obrigatorio}> *</span>}</label>
    : <span className={estilos.rotulo}>{rotulo}{obrigatorio && <span className={estilos.obrigatorio}> *</span>}</span>;
  return <div className={estilos.campo} data-testid={testId} {...dados}>
    <div className={estilos.linha} title={dica}
      data-estado={estado === "editavel" ? undefined : estado}
      data-preenchido={comControle && preenchido ? "true" : undefined}
      data-erro={erro ? "true" : undefined}
      data-icone={icone ?? undefined}
      data-multilinha={multilinha ? "" : undefined}>
      {rotuloNo}
      <div className={estilos.caixa} data-controle={comControle ? "" : undefined}>
        {comControle ? conteudo : <span className={cn(estilos.valor, vazio && estilos.vazio)}>{vazio ? "—" : typeof children === "string" || typeof children === "number" ? <span>{children}</span> : children}</span>}
      </div>
      <IconeDaCaixa icone={icone} />
    </div>
    {erro && <span className={estilos.erro}><CircleAlert aria-hidden />{erro}</span>}
    {abaixo && <div className={estilos.abaixo}>{abaixo}</div>}
  </div>;
}

type Adorno = "pesquisa" | "data" | "travado" | "selecao";

/**
 * Um campo preenchido, SÓ DE LEITURA (consulta do documento salvo). Mesma assinatura da versão anterior: `adorno`
 * "travado" é a caixa travada (#e9edf2, sem ícone); os outros são só leitura (#f6f8fa) com o ícone do tipo.
 * `role="group"` + `aria-label` e `data-campo={rotulo}` continuam — os specs e o skew escolhem o campo por eles.
 */
export function CampoLeitura({ rotulo, valor, adorno, testId, multilinha }: { rotulo: string; valor: React.ReactNode; adorno?: Adorno; testId?: string; multilinha?: boolean }) {
  const travado = adorno === "travado";
  const vazio = valor === null || valor === undefined || valor === "";
  return <div className={estilos.campo} role="group" aria-label={rotulo} data-testid={testId} data-campo={rotulo}>
    <div className={estilos.linha} data-estado={travado ? "travado" : "leitura"} data-icone={!travado && adorno ? adorno : undefined} data-multilinha={multilinha ? "" : undefined}>
      <span className={estilos.rotulo}>{rotulo}</span>
      <div className={estilos.caixa}>
        <span className={cn(estilos.valor, vazio && estilos.vazio)}>{vazio ? "—" : typeof valor === "string" || typeof valor === "number" ? <span>{valor}</span> : valor}</span>
      </div>
      {!travado && adorno && <IconeDaCaixa icone={adorno} />}
    </div>
  </div>;
}

/**
 * Chave sim/não do desenho (`role="switch"`): trilho de 42×20 com a bolinha, e o texto "Sim"/"Não" ao lado. Sem
 * `onChange`, ou `desabilitado`, ela só mostra (consulta). O valor e o que ele significa no payload são de quem chama.
 */
export function ChaveSimNao({ rotulo, valor, onChange, desabilitado, testId, ...dados }: { rotulo: string; valor: boolean; onChange?: (v: boolean) => void; desabilitado?: boolean; testId?: string } & AtributosDeDados) {
  const id = React.useId();
  const soLeitura = !onChange;
  return <div className={estilos.campo} data-testid={testId} {...dados}>
    <div className={estilos.linha} data-chave="" data-estado={soLeitura ? "leitura" : desabilitado ? "desabilitado" : undefined}>
      <label htmlFor={id} className={estilos.rotulo}>{rotulo}</label>
      <div className={estilos.caixa}>
        <button id={id} type="button" role="switch" aria-checked={valor} className={estilos.chave}
          disabled={desabilitado || soLeitura} onClick={() => onChange?.(!valor)}><span className={estilos.chaveBotao} /></button>
        <span className={estilos.chaveTexto}>{valor ? "Sim" : "Não"}</span>
      </div>
    </div>
  </div>;
}

/**
 * A coluna de campos de Dados principais (e de Dados adicionais): 6px entre campos, largura máxima de 560px por
 * campo. Com Dados AMPLIADO (a moldura marca `data-ampliado="dados"` na raiz), mais de 3 campos viram duas colunas,
 * de cima para baixo — a conta das linhas é daqui, o resto é CSS. Nada persiste.
 */
export function ColunaDeCampos({ children, id, hidden }: { children: React.ReactNode; id?: string; hidden?: boolean }) {
  const n = React.Children.toArray(children).length;
  return <div id={id} hidden={hidden} className={estilos.coluna} data-muitos={n > 3 ? "true" : undefined} style={{ "--linhas": Math.ceil(n / 2) } as React.CSSProperties}>{children}</div>;
}

/**
 * "Dados adicionais · N campos", recolhível — o mesmo botão na criação e na consulta. O aberto/fechado é de quem chama.
 * `manterMontado` (consulta): fechado, o grupo fica no DOM com `hidden` — o `aria-controls` aponta para algo que existe e
 * o valor continua legível por quem lê o documento; na criação ele sai da árvore, como antes.
 */
export function DadosAdicionais({ quantidade, aberto, onAlternar, manterMontado, children }: { quantidade: number; aberto: boolean; onAlternar: () => void; manterMontado?: boolean; children: React.ReactNode }) {
  if (quantidade < 1) return null;
  return <>
    <button type="button" className={estilos.maisDados} aria-expanded={aberto} aria-controls="dados-adicionais" onClick={onAlternar}>
      <span className={estilos.maisDadosSeta}><ChevronRight aria-hidden /></span>
      Dados adicionais <span className={estilos.mudo}>· {quantidade} {quantidade === 1 ? "campo" : "campos"}</span>
    </button>
    {(aberto || manterMontado) && <ColunaDeCampos id="dados-adicionais" hidden={!aberto}>{children}</ColunaDeCampos>}
  </>;
}

/* ─────────────────────────── calendário do desenho (painel do MgDatePicker) ─────────────────────────── */

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];
const dois = (n: number) => String(n).padStart(2, "0");
const isoDe = (d: Date) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
const brDe = (d: Date) => `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`;
const lerIso = (v: string) => (/^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T00:00:00`) : null);
type Nivel = "dia" | "mes" | "ano";

/**
 * O quadro de 240px do desenho: título "<mês> de <ano>" que sobe para meses e anos, setas (a roda do mouse anda no
 * nível em que o quadro está), 6 semanas fixas (a altura nunca muda), hoje marcado, "Hoje" e "Limpar".
 */
function CalendarioDoDesenho({ valor, escolher }: { valor: string; escolher: (iso: string) => void }) {
  const hoje = new Date();
  const escolhido = lerIso(valor);
  const base = escolhido ?? hoje;
  const [mes, setMes] = React.useState(() => new Date(base.getFullYear(), base.getMonth(), 1));
  const [nivel, setNivel] = React.useState<Nivel>("dia");
  const roda = React.useRef(0);
  const ano = mes.getFullYear(), mesAtual = mes.getMonth();
  const decada = Math.floor(ano / 10) * 10;
  const andar = (p: number) => setMes((m) => nivel === "dia" ? new Date(m.getFullYear(), m.getMonth() + p, 1) : new Date(m.getFullYear() + (nivel === "mes" ? p : p * 10), m.getMonth(), 1));
  const titulo = nivel === "dia" ? `${MESES[mesAtual]} de ${ano}` : nivel === "mes" ? String(ano) : `${decada} – ${decada + 9}`;
  const aoRodar = (e: React.WheelEvent) => {
    roda.current += e.deltaY;
    let passos = 0;
    while (roda.current >= 48) { passos++; roda.current -= 48; }
    while (roda.current <= -48) { passos--; roda.current += 48; }
    if (passos) andar(passos);
  };
  const primeiro = new Date(ano, mesAtual, 1);
  const dias = Array.from({ length: 42 }, (_, i) => new Date(ano, mesAtual, 1 - primeiro.getDay() + i));
  const mesmoDia = (a: Date | null, b: Date) => Boolean(a) && isoDe(a!) === isoDe(b);
  return <div onWheel={aoRodar}>
    <div className={estilos.calCabecalho}>
      <button type="button" className={estilos.calTitulo} disabled={nivel === "ano"} aria-label={nivel === "dia" ? "Ver os meses" : nivel === "mes" ? "Ver os anos" : "Anos"}
        onClick={() => setNivel(nivel === "dia" ? "mes" : "ano")}>{titulo}</button>
      <span className={estilos.calSetas}>
        <button type="button" className={estilos.calSeta} aria-label="Anterior" onClick={() => andar(-1)}><ChevronUp aria-hidden /></button>
        <button type="button" className={estilos.calSeta} aria-label="Próximo" onClick={() => andar(1)}><ChevronDown aria-hidden /></button>
      </span>
    </div>
    {nivel === "dia" && <div className={estilos.calDias}>
      {SEMANA.map((l, i) => <span key={i} className={estilos.calSemana}>{l}</span>)}
      {dias.map((d) => {
        const marcado = mesmoDia(escolhido, d);
        return <button type="button" key={isoDe(d)} className={estilos.calDia} aria-label={brDe(d)} aria-pressed={marcado}
          data-fora={d.getMonth() !== mesAtual ? "" : undefined} data-hoje={!marcado && mesmoDia(hoje, d) ? "" : undefined}
          onClick={() => escolher(isoDe(d))}>{d.getDate()}</button>;
      })}
    </div>}
    {nivel === "mes" && <div className={estilos.calGrade}>
      {MESES.map((m, i) => {
        const marcado = Boolean(escolhido) && escolhido!.getFullYear() === ano && escolhido!.getMonth() === i;
        return <button type="button" key={m} className={estilos.calCelula} aria-label={`${m} de ${ano}`} aria-pressed={marcado}
          data-hoje={!marcado && hoje.getFullYear() === ano && hoje.getMonth() === i ? "" : undefined}
          onClick={() => { setMes(new Date(ano, i, 1)); setNivel("dia"); }}>{m.slice(0, 3)}</button>;
      })}
    </div>}
    {nivel === "ano" && <div className={estilos.calGrade}>
      {Array.from({ length: 12 }, (_, i) => decada - 1 + i).map((a) => {
        const marcado = Boolean(escolhido) && escolhido!.getFullYear() === a;
        return <button type="button" key={a} className={estilos.calCelula} aria-label={String(a)} aria-pressed={marcado}
          data-fora={a < decada || a > decada + 9 ? "" : undefined} data-hoje={!marcado && hoje.getFullYear() === a ? "" : undefined}
          onClick={() => { setMes(new Date(a, mesAtual, 1)); setNivel("mes"); }}>{a}</button>;
      })}
    </div>}
    <div className={estilos.calRodape}>
      <button type="button" className={estilos.calLink} onClick={() => escolher(isoDe(hoje))}>Hoje</button>
      <button type="button" className={estilos.calLink} onClick={() => escolher("")}>Limpar</button>
    </div>
  </div>;
}

const painelDoCalendario = (rotulo?: string): PainelDoCalendario => ({
  className: estilos.calendario,
  rotulo: rotulo ? `Escolher ${rotulo}` : undefined,
  semIcone: true,
  desenhar: ({ valor, escolher }) => <CalendarioDoDesenho valor={valor} escolher={escolher} />
});

/**
 * Campo de data da Central: o `MgDatePicker` de sempre (texto dd/mm/aaaa, teclado, valor ISO) com o calendário do
 * desenho, e — como o `Input type="date"` do barrel — um `<input hidden>` com o valor ISO na frente (os specs leem o
 * primeiro `input` do campo). `id` e `className` chegam do `CampoDaCentral`.
 */
export function DataDaCentral({ id, className, value, onChange, disabled, rotulo }: { id?: string; className?: string; value: string; onChange: (iso: string) => void; disabled?: boolean; rotulo?: string }) {
  const painel = React.useMemo(() => painelDoCalendario(rotulo), [rotulo]);
  return <>
    <input type="hidden" value={value} readOnly />
    <MgDatePicker id={id} className={className} value={value} onChange={onChange} disabled={disabled} painel={painel} />
  </>;
}
