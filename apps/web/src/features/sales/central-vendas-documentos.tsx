"use client";
import * as React from "react";
import { Search, X } from "lucide-react";
import { StatusBadge } from "@/components/ui";
import { statusLabel } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { useWorkspaceTabs, type WsTab } from "@/lib/workspace-tabs";
import { ConfirmarFechamentoDeAba } from "@/components/layout/workspace-tabs";
import { useDoc, type Row } from "@/features/docs/shared";
import { variantesDeVenda } from "./variantes";
import estilos from "./central-vendas-workspace.module.css";

/**
 * DOCUMENTOS ABERTOS — a barra de abas que já existe, vista como lista de documentos (VISUAL-UX-01 R2; aberta pelo
 * leque de Ações rápidas desde a VISUAL-UX-02).
 *
 * ┌─ UMA FONTE, NENHUM SEGUNDO SISTEMA ────────────────────────────────────────────────────────────┐
 * │ Quais documentos estão abertos, qual é o ativo e qual tem alteração não salva: `useWorkspaceTabs`│
 * │ (`tabs`, `active`, `dirty`). Escolher uma linha é `focusTab`; fechar é `closeTab` — a MESMA ação  │
 * │ da barra de abas, com a MESMA regra: `closeTab(chave)` recusa aba suja devolvendo `false`, e só   │
 * │ então a lista pergunta, com o MESMO diálogo da barra (`ConfirmarFechamentoDeAba`); confirmar é   │
 * │ `closeTab(chave, true)` só daquela aba. Não há persistência própria nem cópia da lista de abas.  │
 * │                                                                                                  │
 * │ "Fechar os já salvos" percorre SÓ os documentos de vendas desta lista que não estão sujos e não  │
 * │ são o ativo, e fecha um a um por `closeTab`. Não é `closeOthers`: aquele fecha tudo que não é a   │
 * │ aba ativa — Início à parte —, inclusive telas de outros módulos e abas sujas.                     │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ CÓDIGO, CLIENTE E SITUAÇÃO: DO SERVIDOR, E SÓ ENQUANTO A LISTA ESTÁ ABERTA ───────────────────┐
 * │ A aba guarda só metadados (chave, endereço, rótulo). Para um documento SALVO, código, cliente e   │
 * │ situação vêm da porta de leitura que o detalhe já usa (`/api/sales/<segmento>/<id>`), pela MESMA │
 * │ chave de cache do detalhe (`useDoc`) — abrir o detalhe depois não pergunta de novo. Só aba de    │
 * │ detalhe de vendas pergunta, só com a lista aberta, uma pergunta por documento aberto. Uma aba de  │
 * │ CRIAÇÃO não tem código, cliente salvo nem situação: mostra o nome dela e um traço, nada inventado.│
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/** Segmentos de documento de venda (`/vendas/<segmento>/<id>`) — derivados das variantes do registry, não listados aqui. */
const segmentosDeVenda = () => new Set(variantesDeVenda().map((v) => v.segmento));

export interface Documento { aba: WsTab; porta: string | null; novo: boolean }

/** A aba é um documento de vendas? Criação (`/vendas/<seg>/new`) ou registro (`/vendas/<seg>/<id>`) de uma variante conhecida. */
function documentoDaAba(aba: WsTab, segmentos: Set<string>): Documento | null {
  if (aba.kind !== "new" && aba.kind !== "detail") return null;
  const m = /^\/vendas\/([^/]+)\/([^/]+)$/.exec(aba.key);
  if (!m || !segmentos.has(m[1]!)) return null;
  if (aba.kind === "new") return { aba, porta: null, novo: true };
  return { aba, porta: `/api/sales/${m[1]}/${m[2]}`, novo: false };
}

/** Pesquisa local: sem acento, sem caixa, todas as palavras precisam aparecer. */
const normalizar = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Os documentos de vendas abertos nas abas — a MESMA fonte da barra de abas (`useWorkspaceTabs`). Fora do shell, nada. */
export interface DocumentosDeVendas { ws: NonNullable<ReturnType<typeof useWorkspaceTabs>>; docs: Documento[] }
export function useDocumentosDeVendas(): DocumentosDeVendas | null {
  const ws = useWorkspaceTabs();
  if (!ws) return null;
  const segmentos = segmentosDeVenda();
  return { ws, docs: ws.tabs.map((t) => documentoDaAba(t, segmentos)).filter((d): d is Documento => d !== null) };
}

/**
 * A LISTA (VISUAL-UX-02): quem a abre é o item "N documentos abertos" do leque de Ações rápidas; ela ancora na ponta
 * direita da barra, sob o ⚡ (`botao`), 430px, linhas de 30px, como no desenho. O comportamento é o de antes, linha a
 * linha: pesquisa, `focusTab`, `closeTab` com o MESMO diálogo da barra de abas, "Fechar os já salvos".
 */
export function ListaDeDocumentosAbertos({ aberta, onFechar, ancora, botao, documentos }: {
  aberta: boolean; onFechar: () => void;
  /** o invólucro do ⚡ e da lista: clique fora dele fecha a lista */
  ancora: React.RefObject<HTMLSpanElement | null>;
  /** o ⚡: é para ele que o foco volta quando a lista fecha */
  botao: React.RefObject<HTMLButtonElement | null>;
  documentos: DocumentosDeVendas;
}) {
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
  React.useEffect(() => {
    if (!aberta || confirmar) return;
    const fora = (e: MouseEvent) => { if (!ancora.current?.contains(e.target as Node)) fecharLista(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) { fecharLista(); botao.current?.focus(); } };
    document.addEventListener("mousedown", fora); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
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
    {aberta && <div id="central-vendas-documentos-lista" className={cn(estilos.popover, estilos.docs)} role="group" aria-label="Documentos abertos" data-testid="central-vendas-documentos-lista">
      <div className={estilos.docsBusca}>
        <label className={estilos.pesquisaPilula}>
          <Search aria-hidden />
          <input ref={pesquisa} autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar documento" aria-label="Pesquisar documento aberto" />
        </label>
      </div>
      <ul className={estilos.docsLista} aria-label="Documentos">
        {docs.map((d, i) => <LinhaDoDocumento key={d.aba.key} doc={d} ordem={i} oculto={!visiveis.includes(d)} atual={d.aba.key === ws.active} sujo={ws.dirty.has(d.aba.key)}
          onEscolher={() => { fecharLista(); ws.focusTab(d.aba.key); }} onFechar={() => fechar(d.aba)} onTexto={registrarTexto} />)}
      </ul>
      {visiveis.length === 0 && <div className={estilos.docsVazio} data-testid="central-vendas-documentos-vazio">Nenhum documento encontrado.</div>}
      <div className={estilos.popoverRodape}>
        <span>Clique para trabalhar no documento</span>
        <button type="button" className={estilos.link} onClick={fecharOsJaSalvos} data-testid="central-vendas-documentos-fechar-salvos">Fechar os já salvos</button>
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
 * Uma linha (`.orow` do desenho): título (código do servidor, ou o nome da aba), cliente, situação, ponto de
 * alteração e ×. A linha inteira escolhe o documento; o × é um botão irmão, nunca um botão dentro de botão. Oculta pela
 * pesquisa, a linha continua montada — a consulta dela não recomeça a cada letra. Entra com atraso escalonado, como o leque.
 */
function LinhaDoDocumento({ doc, ordem, oculto, atual, sujo, onEscolher, onFechar, onTexto }: {
  doc: Documento; ordem: number; oculto: boolean; atual: boolean; sujo: boolean; onEscolher: () => void; onFechar: () => void; onTexto: (chave: string, texto: string) => void;
}) {
  const q = useDoc<Row>(doc.porta ?? "", Boolean(doc.porta));
  const d = q.data;
  const codigo = d && typeof d["code"] === "string" && d["code"] ? d["code"] : null;
  const cliente = d && typeof d["client_name"] === "string" && d["client_name"] ? d["client_name"] : null;
  const situacao = d ? d["status"] : null;
  const temSituacao = situacao !== null && situacao !== undefined && situacao !== "";
  const titulo = codigo ?? doc.aba.label;
  const texto = [titulo, cliente ?? "", temSituacao ? statusLabel(situacao) : ""].join(" ");
  React.useEffect(() => { onTexto(doc.aba.key, texto); }, [doc.aba.key, texto, onTexto]);

  return <li className={estilos.docsLinha} style={{ animationDelay: `${40 + ordem * 32}ms` }} data-atual={atual ? "true" : "false"} hidden={oculto} data-testid="central-vendas-documento" data-chave={doc.aba.key}>
    <button type="button" className={estilos.docsEscolher} aria-current={atual ? "page" : undefined} aria-label={`Trabalhar em ${titulo}${cliente ? ` · ${cliente}` : ""}`} onClick={onEscolher} />
    <span className={cn(estilos.docsTitulo, codigo && estilos.docsCodigo)} data-testid="central-vendas-documento-titulo">{titulo}</span>
    <span className={estilos.docsCliente} data-testid="central-vendas-documento-cliente">{cliente ?? "—"}</span>
    <span className={estilos.docsSituacao} data-testid="central-vendas-documento-situacao">{temSituacao && <StatusBadge value={situacao} />}</span>
    <span className={estilos.docsPonto}>{sujo && <span className={estilos.pontoAlterado} role="img" aria-label="Alterações não salvas" />}</span>
    <span className={estilos.docsFecharCelula}><button type="button" className={estilos.docsFechar} aria-label={`Fechar ${titulo}`} title="Fechar documento" onClick={onFechar} data-testid="central-vendas-documento-fechar"><X aria-hidden /></button></span>
  </li>;
}
