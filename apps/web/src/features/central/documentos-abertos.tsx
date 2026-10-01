"use client";
import * as React from "react";
import { Search, X } from "lucide-react";
import { StatusBadge } from "@/components/ui";
import { statusLabel } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { useWorkspaceTabs, type WsTab } from "@/lib/workspace-tabs";
import { ConfirmarFechamentoDeAba } from "@/components/layout/workspace-tabs";
import { useDoc, type Row } from "@/features/docs/shared";
import type { DocumentoAberto, FonteDosDocumentosAbertos, PropsDaListaDeDocumentosAbertos, UseDocumentosAbertos } from "./contrato";
import estilos from "./moldura.module.css";

/**
 * DOCUMENTOS ABERTOS DA CENTRAL — a barra de abas vista como lista de documentos da espécie. A espécie (adaptador) diz
 * quais abas são documentos dela e qual a porta de leitura (`fonte.documentoDaAba`), qual campo da resposta é a
 * contraparte (`fonte.campoDaContraparte`) e o prefixo dos testids. Uma fonte só: `useWorkspaceTabs` (`focusTab`,
 * `closeTab` com o MESMO diálogo da barra). "Fechar os já salvos" fecha só documentos desta lista, não sujos, não ativos.
 */

export type { DocumentoAberto, DocumentosAbertos } from "./contrato";

/** Pesquisa local: sem acento, sem caixa, todas as palavras precisam aparecer. */
const normalizar = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Os documentos da espécie abertos nas abas — a MESMA fonte da barra de abas (`useWorkspaceTabs`). Fora do shell, nada. */
export const useDocumentosAbertos: UseDocumentosAbertos = (fonte) => {
  const ws = useWorkspaceTabs();
  if (!ws) return null;
  return { ws, docs: ws.tabs.map((t) => fonte.documentoDaAba(t)).filter((d): d is DocumentoAberto => d !== null) };
};

/**
 * A LISTA (VISUAL-UX-02): quem a abre é o item "N documentos abertos" do leque de Ações rápidas; ela ancora na ponta
 * direita da barra, sob o ⚡ (`botao`), 430px, linhas de 30px, como no desenho. O comportamento é o de antes, linha a
 * linha: pesquisa, `focusTab`, `closeTab` com o MESMO diálogo da barra de abas, "Fechar os já salvos".
 */
export function ListaDeDocumentosAbertos({ prefixoTestid, fonte, aberta, onFechar, ancora, botao, documentos }: PropsDaListaDeDocumentosAbertos) {
  const { ws, docs } = documentos;
  const [busca, setBusca] = React.useState("");
  const [confirmar, setConfirmar] = React.useState<WsTab | null>(null);
  const pesquisa = React.useRef<HTMLInputElement>(null);
  /** O texto de cada linha, para a pesquisa — preenchido pelas linhas conforme os dados chegam. */
  const [textos, setTextos] = React.useState<Record<string, string>>({});
  const registrarTexto = React.useCallback((chave: string, texto: string) => setTextos((t) => (t[chave] === texto ? t : { ...t, [chave]: texto })), []);
  const fecharLista = React.useCallback(() => { setBusca(""); onFechar(); }, [onFechar]);

  // Com a confirmação de fechamento aberta, clique e Esc são do DIÁLOGO: a lista não fecha por baixo dele,
  // e cancelar devolve o foco ao × da linha, que continua na tela.
  //
  // O Esc é ouvido na CAPTURA da janela, antes das camadas do Radix (que escutam na captura do documento): a lista abre
  // pelo leque, e o leque continua montado durante a animação de recolher — nesse intervalo a camada dele era a mais alta,
  // consumia o Esc (`preventDefault`) e a lista não fechava (W18). A lista não tem camada por cima dela além do diálogo de
  // fechar, e com ele aberto este ouvinte nem existe. Tratado aqui, o Esc não recolhe mais nada por baixo.
  React.useEffect(() => {
    if (!aberta || confirmar) return;
    const fora = (e: MouseEvent) => { if (!ancora.current?.contains(e.target as Node)) fecharLista(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); fecharLista(); botao.current?.focus(); } };
    document.addEventListener("mousedown", fora); window.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", fora); window.removeEventListener("keydown", esc, true); };
  }, [aberta, confirmar, ancora, botao, fecharLista]);

  const termos = normalizar(busca).split(/\s+/).filter(Boolean);
  const visiveis = docs.filter((d) => { const alvo = normalizar(textos[d.aba.key] ?? d.aba.label); return termos.every((t) => alvo.includes(t)); });

  // o × some com a linha: o foco vai para a pesquisa da lista, e não cai no <body>
  const fechar = (aba: WsTab) => { if (ws.closeTab(aba.key)) pesquisa.current?.focus(); else setConfirmar(aba); };
  const fecharOsJaSalvos = () => {
    for (const d of docs) if (d.aba.key !== ws.active && !ws.dirty.has(d.aba.key)) ws.closeTab(d.aba.key);
    fecharLista(); botao.current?.focus();
  };

  return <>
    {aberta && <div id={`${prefixoTestid}-documentos-lista`} className={cn(estilos.popover, estilos.docs)} role="group" aria-label="Documentos abertos" data-testid={`${prefixoTestid}-documentos-lista`}>
      <div className={estilos.docsBusca}>
        <label className={estilos.pesquisaPilula}>
          <Search aria-hidden />
          <input ref={pesquisa} autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar documento" aria-label="Pesquisar documento aberto" />
        </label>
      </div>
      <ul className={estilos.docsLista} aria-label="Documentos">
        {docs.map((d, i) => <LinhaDoDocumento key={d.aba.key} doc={d} ordem={i} oculto={!visiveis.includes(d)} atual={d.aba.key === ws.active} sujo={ws.dirty.has(d.aba.key)}
          onEscolher={() => { fecharLista(); ws.focusTab(d.aba.key); }} onFechar={() => fechar(d.aba)} onTexto={registrarTexto} prefixoTestid={prefixoTestid} fonte={fonte} />)}
      </ul>
      {visiveis.length === 0 && <div className={estilos.docsVazio} data-testid={`${prefixoTestid}-documentos-vazio`}>Nenhum documento encontrado.</div>}
      <div className={estilos.popoverRodape}>
        <span>Clique para trabalhar no documento</span>
        <button type="button" className={estilos.link} onClick={fecharOsJaSalvos} data-testid={`${prefixoTestid}-documentos-fechar-salvos`}>Fechar os já salvos</button>
      </div>
    </div>}
    <ConfirmarFechamentoDeAba aba={confirmar} onCancelar={() => setConfirmar(null)}
      onConfirmar={(aba) => {
        ws.closeTab(aba.key, true); setConfirmar(null);
        // depois da restauração de foco do diálogo, que mira o × que acabou de sumir
        requestAnimationFrame(() => (pesquisa.current ?? botao.current)?.focus());
      }} />
  </>;
}

/**
 * Uma linha (`.orow` do desenho): título (código do servidor, ou o nome da aba), contraparte, situação, ponto de
 * alteração e ×. A linha inteira escolhe o documento; o × é um botão irmão, nunca um botão dentro de botão. Oculta pela
 * pesquisa, a linha continua montada — a consulta dela não recomeça a cada letra. Entra com atraso escalonado, como o leque.
 */
function LinhaDoDocumento({ doc, ordem, oculto, atual, sujo, onEscolher, onFechar, onTexto, prefixoTestid, fonte }: {
  prefixoTestid: string; fonte: FonteDosDocumentosAbertos;
  doc: DocumentoAberto; ordem: number; oculto: boolean; atual: boolean; sujo: boolean; onEscolher: () => void; onFechar: () => void; onTexto: (chave: string, texto: string) => void;
}) {
  const q = useDoc<Row>(doc.porta ?? "", Boolean(doc.porta));
  const d = q.data;
  const codigo = d && typeof d["code"] === "string" && d["code"] ? d["code"] : null;
  const campo = fonte.campoDaContraparte;
  const contraparte = d && typeof d[campo] === "string" && d[campo] ? d[campo] : null;
  const situacao = d ? d["status"] : null;
  const temSituacao = situacao !== null && situacao !== undefined && situacao !== "";
  const titulo = codigo ?? doc.aba.label;
  const texto = [titulo, contraparte ?? "", temSituacao ? statusLabel(situacao) : ""].join(" ");
  React.useEffect(() => { onTexto(doc.aba.key, texto); }, [doc.aba.key, texto, onTexto]);

  return <li className={estilos.docsLinha} style={{ animationDelay: `${40 + ordem * 32}ms` }} data-atual={atual ? "true" : "false"} hidden={oculto} data-testid={`${prefixoTestid}-documento`} data-chave={doc.aba.key}>
    <button type="button" className={estilos.docsEscolher} aria-current={atual ? "page" : undefined} aria-label={`Trabalhar em ${titulo}${contraparte ? ` · ${contraparte}` : ""}`} onClick={onEscolher} />
    <span className={cn(estilos.docsTitulo, codigo && estilos.docsCodigo)} data-testid={`${prefixoTestid}-documento-titulo`}>{titulo}</span>
    <span className={estilos.docsCliente} data-testid={`${prefixoTestid}-documento-${fonte.sufixoTestidDaContraparte}`}>{contraparte ?? "—"}</span>
    <span className={estilos.docsSituacao} data-testid={`${prefixoTestid}-documento-situacao`}>{temSituacao && <StatusBadge value={situacao} />}</span>
    <span className={estilos.docsPonto}>{sujo && <span className={estilos.pontoAlterado} role="img" aria-label="Alterações não salvas" />}</span>
    <span className={estilos.docsFecharCelula}><button type="button" className={estilos.docsFechar} aria-label={`Fechar ${titulo}`} title="Fechar documento" onClick={onFechar} data-testid={`${prefixoTestid}-documento-fechar`}><X aria-hidden /></button></span>
  </li>;
}
