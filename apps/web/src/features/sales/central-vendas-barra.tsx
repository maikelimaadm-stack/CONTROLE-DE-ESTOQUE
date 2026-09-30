"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import * as DropdownP from "@radix-ui/react-dropdown-menu";
import * as PopoverP from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import { useTradutor } from "@/lib/i18n";
import { useTopsDaVariante } from "./tipo-operacao-select";
import { linhasDoGrupo, linhasDoMenuRapido, rotaDeLancamento } from "./launcher-operacoes";
import type { VarianteDeVenda } from "./variantes";
import { ListaDeDocumentosAbertos, useDocumentosDeVendas } from "./central-vendas-documentos";
import estilos from "./central-vendas-barra.module.css";
import estilosCentral from "./central-vendas-workspace.module.css";

/**
 * BARRA DE AÇÕES DA CENTRAL DE VENDAS (VISUAL-UX-02, decisão 270, item 4.1).
 *
 * ┌─ APRESENTAÇÃO, E SÓ ───────────────────────────────────────────────────────────────────────────┐
 * │ Os botões, a pílula, o leque de Ações rápidas, o segmentado da Posição do rótulo e os           │
 * │ indicadores (Salvo, Confirmando…, N pendências) moram aqui. O que cada um FAZ continua na       │
 * │ página: a guarda do Salvar está no handler `submit`, a confirmação e o cancelamento são         │
 * │ `act.mutate` com a chave de idempotência de sempre, e nenhum componente daqui chama a API de     │
 * │ escrita. O único GET é o de `/operation-types` do menu Novo, pela MESMA consulta (e a mesma     │
 * │ chave de cache) do lançador — a lista do menu é o corte do menu rápido do portal.               │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ O LEQUE É UM MENU OFICIAL (Radix) ────────────────────────────────────────────────────────────┐
 * │ `DropdownMenu` dá o papel de menu, as setas, o Esc e a devolução do foco. O conteúdo é um ponto │
 * │ no centro do ⚡ e os itens orbitam dele (raio 60, passo 33°, arco centrado em 138°, como no     │
 * │ desenho). O VÉU com desfoque do desenho NÃO foi feito: nenhum primitivo oficial o oferece, e um  │
 * │ overlay escrito à mão é o que o ui-audit recusa — ficou sem véu, declarado no relatório.         │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/* ── ícones do desenho (traço 2, 24×24; os caminhos são os do desenho, alguns fora do conjunto lucide) ── */
const Icone = ({ tamanho, children }: { tamanho: number; children: React.ReactNode }) =>
  <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>{children}</svg>;
export const IconeNovo = () => <Icone tamanho={17}><path d="M5 12h14" /><path d="M12 5v14" /></Icone>;
export const IconeDuplicar = () => <Icone tamanho={16}><path d="M9 9.5A2.5 2.5 0 0 1 11.5 7h6A2.5 2.5 0 0 1 20 9.5v6a2.5 2.5 0 0 1-2.5 2.5h-6A2.5 2.5 0 0 1 9 15.5z" /><path d="M15.5 7V6.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5H9" /></Icone>;
export const IconeConfirmar = () => <Icone tamanho={15}><path d="M20 6 9 17l-5-5" /></Icone>;
export const IconeDescartar = () => <Icone tamanho={16}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Icone>;
export const IconeSalvar = () => <Icone tamanho={16}><path d="M6 4h9.5L20 8.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /><path d="M8 4v4.5h7V4" /><path d="M8 20v-6h8v6" /></Icone>;
export const IconeImprimir = () => <Icone tamanho={16}><path d="M7 9V4h10v5" /><path d="M7 17H5.5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H17" /><path d="M7 14h10v6H7z" /><path d="M17 11.1a0.9 0.9 0 1 1 0 1.8a0.9 0.9 0 1 1 0 -1.8z" fill="currentColor" stroke="none" /></Icone>;
export const IconeHistorico = () => <Icone tamanho={16}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></Icone>;
/** Fora do desenho (Alterar operação, Cancelar): ícones de mesmo traço, no mesmo círculo. */
export const IconeAlterarOperacao = () => <Icone tamanho={16}><path d="m2 9 3-3 3 3" /><path d="M13 18H7a2 2 0 0 1-2-2V6" /><path d="m22 15-3 3-3-3" /><path d="M11 6h6a2 2 0 0 1 2 2v10" /></Icone>;
export const IconeCancelarDocumento = () => <Icone tamanho={16}><path d="M12 3.5a8.5 8.5 0 1 1 0 17a8.5 8.5 0 1 1 0 -17z" /><path d="M9 9l6 6M15 9l-6 6" /></Icone>;
export const IconeConverter = () => <Icone tamanho={15}><path d="m16 3 4 4-4 4" /><path d="M20 7H4" /><path d="m8 21-4-4 4-4" /><path d="M4 17h16" /></Icone>;
export const IconeEncerrarSaldo = () => <Icone tamanho={15}><path d="M14.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5z" /><path d="M14 3v5h5" /><path d="m9.5 12.5 5 5" /><path d="m14.5 12.5-5 5" /></Icone>;
const IconeRaio = () => <Icone tamanho={16}><path d="M13 2 3 14h9l-1 8 10-12h-9z" /></Icone>;
const IconeRotuloAntes = () => <Icone tamanho={16}><path d="M2.5 12h5" /><path d="M12 7h7.5a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-7.5a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2z" /></Icone>;
const IconeRotuloDentro = () => <Icone tamanho={16}><path d="M5 5.5h14a2.5 2.5 0 0 1 2.5 2.5v8a2.5 2.5 0 0 1 -2.5 2.5h-14a2.5 2.5 0 0 1 -2.5 -2.5v-8a2.5 2.5 0 0 1 2.5 -2.5z" /><path d="M6.8 9.8h5" /></Icone>;
const IconeAlerta = () => <Icone tamanho={13}><circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" /></Icone>;
const IconeSalvo = () => <Icone tamanho={13}><circle cx="12" cy="12" r="10" /><path d="m16 9-5.5 5.5L8 12" /></Icone>;
export const IconeGirando = ({ tamanho = 15 }: { tamanho?: number }) => <span className={estilos.girar}><Icone tamanho={tamanho}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></Icone></span>;

/* ── conjuntos ── */
export const ConjuntoDaBarra = ({ children }: { children: React.ReactNode }) => <span className={estilos.conjunto}>{children}</span>;
export const ConjuntoDireito = ({ children }: { children: React.ReactNode }) => <span className={estilos.conjuntoDireito}>{children}</span>;

/**
 * Botão só de ícone (`.tbi`): nome acessível e dica SEMPRE — nunca ícone mudo. `dica` troca só o texto da dica (ex.:
 * "Salvando…", ou o motivo de estar desabilitado); o nome acessível continua sendo `rotulo`.
 */
export const BotaoDaBarra = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & {
  rotulo: string; dica?: string; solido?: boolean; ocupado?: boolean; dicaNoFim?: boolean;
}>(({ rotulo, dica, solido, ocupado, dicaNoFim, className, children, disabled, ...p }, ref) =>
  <button ref={ref} type="button" aria-label={rotulo} data-dica={dica ?? rotulo} aria-busy={ocupado || undefined} disabled={disabled || ocupado}
    className={cn(estilos.botao, solido && estilos.solido, dicaNoFim ? estilosCentral.dicaFim : estilosCentral.dicaInicio, className)} {...p}>
    {ocupado ? <IconeGirando /> : children}
  </button>);
BotaoDaBarra.displayName = "BotaoDaBarra";

/** A pílula (`.tbp`): ícone e texto — Confirmar venda, Converter, Encerrar saldo. */
export const PilulaDaBarra = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { icone: React.ReactNode; dica?: string; ocupado?: boolean }>(
  ({ icone, dica, ocupado, className, children, disabled, ...p }, ref) =>
    <button ref={ref} type="button" data-dica={dica} aria-busy={ocupado || undefined} disabled={disabled || ocupado}
      className={cn(estilos.pilula, estilosCentral.dicaInicio, className)} {...p}>
      {ocupado ? <IconeGirando /> : icone}{children}
    </button>);
PilulaDaBarra.displayName = "PilulaDaBarra";

/* ── Posição do rótulo ── */
/** Os dois valores da densidade da Central (o tipo `Densidade` de `central-vendas-campo.tsx` tem a mesma forma). */
export type PosicaoDoRotuloValor = "rotulo-a-frente" | "compacto";
/**
 * POSIÇÃO DO RÓTULO — estado SÓ da tela: a página o guarda em `useState` e ele morre com ela. Nada vai para
 * localStorage, sessionStorage ou perfil; remontar devolve o padrão ("Rótulo antes do campo").
 */
export function PosicaoDoRotulo({ valor, onChange }: { valor: PosicaoDoRotuloValor; onChange: (v: PosicaoDoRotuloValor) => void }) {
  const opcao = (v: PosicaoDoRotuloValor, rotulo: string, icone: React.ReactNode) =>
    <button type="button" aria-pressed={valor === v} aria-label={rotulo} data-dica={rotulo} className={estilosCentral.dicaFim} onClick={() => onChange(v)}>{icone}</button>;
  return <div role="group" aria-label="Posição do rótulo" data-testid="central-vendas-posicao-rotulo" className={estilos.segmentado}>
    {opcao("rotulo-a-frente", "Rótulo antes do campo", <IconeRotuloAntes />)}
    {opcao("compacto", "Rótulo dentro do campo", <IconeRotuloDentro />)}
  </div>;
}

/* ── indicadores ── */
export const IndicadorSalvo = () => <span className={estilos.salvo} role="status" data-testid="central-vendas-salvo"><IconeSalvo />Salvo</span>;
export const IndicadorConfirmando = () => <span className={estilos.confirmando} role="status" data-testid="central-vendas-confirmando"><IconeGirando tamanho={13} />Confirmando…</span>;

/** Uma pendência do Salvar: o caminho do campo (o mesmo dos erros), o rótulo e a mensagem. */
export interface Pendencia { caminho: string; rotulo: string; mensagem: string }

/**
 * N PENDÊNCIAS — só aparece depois de um clique em Salvar que não enviou nada. A lista leva ao campo: quem sabe ONDE
 * o campo está é a página (`onIr`); aqui só se fecha a lista antes, para o foco não voltar para a pílula.
 */
export function PendenciasDoDocumento({ pendencias, aberta, onAbertaChange, onIr }: {
  pendencias: readonly Pendencia[]; aberta: boolean; onAbertaChange: (a: boolean) => void; onIr: (p: Pendencia) => void;
}) {
  const indo = React.useRef(false);
  if (!pendencias.length) return null;
  const n = pendencias.length;
  return <span className={estilos.pendenciasAncora}>
    <PopoverP.Root open={aberta} onOpenChange={onAbertaChange}>
      <PopoverP.Trigger asChild>
        <button type="button" className={estilos.pendencias} data-testid="central-vendas-pendencias"><IconeAlerta />{n} {n === 1 ? "pendência" : "pendências"}</button>
      </PopoverP.Trigger>
      <PopoverP.Portal>
        <PopoverP.Content align="end" side="bottom" sideOffset={8} className={cn(estilos.pop, estilos.pendenciasLista)} aria-label="Pendências do documento" data-testid="central-vendas-pendencias-lista"
          onCloseAutoFocus={(e) => { if (indo.current) { indo.current = false; e.preventDefault(); } }}>
          {pendencias.map((p) => <button key={p.caminho} type="button" className={estilos.pendencia} data-testid="central-vendas-pendencia" data-caminho={p.caminho}
            onClick={() => { indo.current = true; onAbertaChange(false); requestAnimationFrame(() => onIr(p)); }}>
            <b>{p.rotulo}</b><span>{p.mensagem}</span>
          </button>)}
        </PopoverP.Content>
      </PopoverP.Portal>
    </PopoverP.Root>
  </span>;
}

/**
 * NOVO DOCUMENTO — o menu "Nova operação · <Espécie>" com as TOPs que o SERVIDOR lista para a variante
 * (`/operation-types`, a mesma consulta e a mesma chave de cache do lançador), no corte do menu rápido do portal
 * (`linhasDoMenuRapido`): até o limite, todas; acima, só as padrão, e "Escolher operação…" leva ao lançador. Escolher
 * uma leva a `/vendas/<seg>/new?tipo_operacao_id=<id>`, que RECONFERE a TOP — URL não autoriza. Quem só vê o botão
 * é quem pode criar (`<perm>.create`, decidido pela página); quem nega é a rota.
 */
export function NovoDocumento({ variante }: { variante: VarianteDeVenda }) {
  const router = useRouter(); const tr = useTradutor();
  const estado = useTopsDaVariante(variante.segmento);
  const rotulo = tr(variante.chaveI18n);
  const todas = linhasDoGrupo({ variante, rotulo, habilitado: true, estado });
  const doMenu = linhasDoMenuRapido(todas);
  const cortou = doMenu.length < todas.length;
  return <DropdownP.Root modal={false}>
    <DropdownP.Trigger asChild>
      <BotaoDaBarra rotulo="Novo documento" solido data-testid="central-vendas-novo"><IconeNovo /></BotaoDaBarra>
    </DropdownP.Trigger>
    <DropdownP.Portal>
      <DropdownP.Content align="start" side="bottom" sideOffset={13} className={cn(estilos.pop, estilos.menuNovo)} aria-label="Novo documento" data-testid="central-vendas-novo-menu">
        <div className={estilos.menuTitulo}>Nova operação · {rotulo}</div>
        {estado.situacao === "carregando" && <div className={estilos.menuAviso}>Carregando os tipos de operação…</div>}
        {estado.situacao !== "carregando" && doMenu.length === 0 && <div className={estilos.menuAviso}>
          {todas.length ? "Nenhuma operação padrão: use Escolher operação." : "Nenhuma operação disponível para lançamento."}
        </div>}
        {doMenu.map((l) => <DropdownP.Item key={l.id} className={estilos.mi} data-testid="central-vendas-novo-top" data-top-id={l.id} onSelect={() => router.push(rotaDeLancamento(l))}>
          <span className={estilos.codigo}>{l.code}</span>
          <span className={estilos.miNome}>{l.name}</span>
          {l.ehPadrao ? <span className={estilos.selo}>Padrão</span> : <span />}
        </DropdownP.Item>)}
        {cortou && <>
          <DropdownP.Separator className={estilos.separador} />
          <DropdownP.Item className={cn(estilos.mi, estilos.miSimples)} data-testid="central-vendas-novo-escolher" onSelect={() => router.push(`/vendas/${variante.segmento}/new`)}>Escolher operação…</DropdownP.Item>
        </>}
      </DropdownP.Content>
    </DropdownP.Portal>
  </DropdownP.Root>;
}

/** Um item do leque. `numero` troca o ícone pelo número (o de "N documentos abertos"). */
export interface ItemRapido {
  chave: string; rotulo: string; testId: string; onSelect: () => void;
  icone?: React.ReactNode; numero?: number; desabilitado?: boolean; perigo?: boolean;
}

/**
 * O ARCO DO LEQUE — o do desenho: raio 60, passo 33°, centrado em 138° (para baixo e para a esquerda do botão, que
 * fica na ponta direita da barra). O primeiro item é o de baixo; os seguintes sobem pela esquerda.
 */
const RAIO = 60, PASSO = 33, MEIO = 138;
export function posicaoNoLeque(i: number, total: number): { x: number; y: number } {
  const angulo = ((MEIO + (i - (total - 1) / 2) * PASSO) * Math.PI) / 180;
  return { x: Math.round(Math.cos(angulo) * RAIO), y: Math.round(Math.sin(angulo) * RAIO) };
}

/**
 * AÇÕES RÁPIDAS (⚡) — o leque do desenho, de baixo para cima: `antes`, "N documentos abertos" (a VISÃO das abas de
 * vendas, que abre a lista de hoje) e `depois`. Escolher um item fecha o leque e devolve o foco ao ⚡ antes de a ação
 * abrir o que for dela (diálogo, lista) — assim quem abre sabe para onde devolver o foco.
 */
export function AcoesRapidas({ antes, depois = [], desabilitado }: { antes: ItemRapido[]; depois?: ItemRapido[]; desabilitado?: boolean }) {
  const documentos = useDocumentosDeVendas();
  const [aberto, setAberto] = React.useState(false);
  const [listaAberta, setListaAberta] = React.useState(false);
  const ancora = React.useRef<HTMLSpanElement>(null);
  const botao = React.useRef<HTMLButtonElement>(null);
  const escolheu = React.useRef(false);
  const total = documentos?.docs.length ?? 0;
  const itens: ItemRapido[] = [
    ...antes,
    ...(documentos ? [{ chave: "documentos", rotulo: total === 1 ? "1 documento aberto" : `${total} documentos abertos`, numero: total, testId: "central-vendas-documentos", onSelect: () => setListaAberta(true) }] : []),
    ...depois
  ];
  return <span className={estilos.leque} ref={ancora}>
    <DropdownP.Root modal={false} open={aberto} onOpenChange={(o) => { setAberto(o); if (o) setListaAberta(false); }}>
      <DropdownP.Trigger asChild disabled={desabilitado}>
        <BotaoDaBarra ref={botao} rotulo="Ações rápidas" dicaNoFim data-testid="central-vendas-acoes-rapidas"><IconeRaio /></BotaoDaBarra>
      </DropdownP.Trigger>
      <DropdownP.Content side="bottom" align="center" sideOffset={-12.5} avoidCollisions={false} loop className={estilos.lequeConteudo}
        aria-label="Ações rápidas" data-testid="central-vendas-acoes-rapidas-leque"
        onCloseAutoFocus={(e) => { if (escolheu.current) { escolheu.current = false; e.preventDefault(); } }}>
        {itens.map((it, i) => {
          const { x, y } = posicaoNoLeque(i, itens.length);
          const posicao = { "--x": `${x}px`, "--y": `${y}px`, "--atraso-entrada": `${i * 34}ms`, "--atraso-saida": `${(itens.length - 1 - i) * 22}ms` } as React.CSSProperties;
          return <DropdownP.Item key={it.chave} asChild disabled={it.desabilitado}
            onSelect={() => { escolheu.current = true; botao.current?.focus(); it.onSelect(); }}>
            <button type="button" className={cn(estilos.lequeItem, it.numero !== undefined && estilos.lequeNumero, it.perigo && estilos.lequePerigo, estilosCentral.dicaFim)} style={posicao}
              aria-label={it.rotulo} data-dica={it.rotulo} data-testid={it.testId} disabled={it.desabilitado}>
              {it.numero !== undefined ? <span data-testid="central-vendas-documentos-contador">{it.numero}</span> : it.icone}
            </button>
          </DropdownP.Item>;
        })}
      </DropdownP.Content>
    </DropdownP.Root>
    {documentos && <ListaDeDocumentosAbertos aberta={listaAberta} onFechar={() => setListaAberta(false)} ancora={ancora} botao={botao} documentos={documentos} />}
  </span>;
}

/**
 * DEPOIS DE SALVAR — o que a criação deixa para a consulta que ela abre: o "Salvo" (✓ por 2,4 s) e, no Confirmar venda
 * da criação, o pedido de abrir o diálogo de Confirmar venda. Vai por `entregarEmMemoria` (chave do Map em memória,
 * com dono): nada na URL, nada no armazenamento do navegador. A consulta consome UMA vez.
 */
export const chaveDepoisDeSalvar = (id: string) => `central-vendas:salvo:${id}`;
export interface DepoisDeSalvar { confirmar: boolean }
/** Quanto tempo o "Salvo" fica na barra, como no desenho. */
export const TEMPO_DO_SALVO_MS = 2400;
