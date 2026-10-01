"use client";
import * as React from "react";
import type { FieldDef } from "@agro/domain";
import { buildDefaultFormLayout, normalizeFormLayout, type FormLayout, type LayoutFieldInfo } from "@agro/shared";
import { useScreenPrefs, type ScreenPrefs } from "@/lib/preferences";
import { useDirtyTab } from "@/lib/workspace-tabs";
import { toast } from "@/lib/toast";
import { ConfirmDialog } from "@/components/ui";
import { ProvedorArraste, useArraste } from "./configuracao-layout/arraste";
import * as R from "./configuracao-layout/rascunho";
import { Barra } from "./configuracao-layout/barra";
import { Coluna, Trilho } from "./configuracao-layout/coluna";
import { Faixas } from "./configuracao-layout/faixas";
import { Linhas } from "./configuracao-layout/linhas";
import { Inspetor } from "./configuracao-layout/inspetor";
import type { AbaColuna, AlvoBruto, ApiArraste, CampoInfo, EnderecoLinha, ItemArrastado, Modo, Pilha, Previsao } from "./configuracao-layout/tipos";
import estilos from "./configuracao-layout/pagina.module.css";

const paraInfo = (f: FieldDef): LayoutFieldInfo => ({ id: f.name, label: f.label, section: f.section, span: f.span, required: f.required, readOnly: f.readOnly });
export const toLayoutFields = (fields: FieldDef[]): LayoutFieldInfo[] => fields.map(paraInfo);

export type PrefsDoLayout = ScreenPrefs<FormLayout> & { fieldsInfo: LayoutFieldInfo[]; campos: CampoInfo[] };

/** Layout do formulário de um cadastro declarativo (preferência por usuário > organização > padrão derivado da definição). */
export function useFormLayout(resourceKey: string, fields: FieldDef[]): PrefsDoLayout {
  const fieldsInfo = React.useMemo(() => toLayoutFields(fields), [fields]);
  // o tipo só alimenta a pílula do inspetor: o normalizador continua recebendo o LayoutFieldInfo de sempre
  const campos = React.useMemo(() => fields.map((f): CampoInfo => ({ ...paraInfo(f), tipo: f.type })), [fields]);
  const normalize = React.useCallback((raw: unknown) => (raw ? normalizeFormLayout(raw, fieldsInfo).layout : buildDefaultFormLayout(fieldsInfo)), [fieldsInfo]);
  const p = useScreenPrefs<FormLayout>(resourceKey, "form", normalize);
  return { ...p, fieldsInfo, campos };
}

const uid = (prefixo: string) => `${prefixo}_${Math.random().toString(36).slice(2, 7)}`;

/** Lê o arraste em curso: a vista (o layout sem o item na mão) só existe dentro do provedor. */
function ComArraste({ refItem, children }: { refItem: React.RefObject<ItemArrastado | null>; children: (a: ApiArraste) => React.ReactNode }) {
  const a = useArraste();
  React.useEffect(() => { refItem.current = a.item; }, [refItem, a.item]);
  return <>{children(a)}</>;
}

interface PropsDaPagina {
  p: PrefsDoLayout;
  /** a rota ainda passa o nome do cadastro; a barra do desenho não tem lugar para ele (a origem fica no ícone do formulário) */
  resourceLabel: string;
  backHref: string;
}

/**
 * Configuração de layout (decisão 275). Abre na CONSULTA; "Editar layout" abre um rascunho igual ao salvo, toda mudança
 * passa por uma operação pura (rascunho.ts) e entra na pilha de desfazer, e o Salvar grava o MESMO FormLayout de
 * sempre como preferência do usuário. Este componente é o dono do estado da tela; as partes só desenham e avisam.
 */
export function FormLayoutPage({ p, backHref }: PropsDaPagina) {
  const salvo = p.prefs;
  const ctx = React.useMemo(() => R.criarContexto(p.campos), [p.campos]);
  // a consulta mostra o salvo na mesma forma do rascunho, para nada pular ao entrar na edição
  const salvoAberto = React.useMemo(() => R.abrirRascunho(salvo), [salvo]);
  const [modo, setModo] = React.useState<Modo>("consulta");
  const [pilha, setPilha] = React.useState<Pilha | null>(null);
  const edicao = modo === "edicao" && pilha !== null;
  const l = edicao ? pilha.presente : salvoAberto;
  const alterado = edicao && R.alterado(pilha.presente, salvo);
  useDirtyTab(alterado);

  const [painelId, setPainelId] = React.useState("");
  const [cardId, setCardId] = React.useState("");
  const [selecionado, setSelecionado] = React.useState<string | null>(null);
  const [inspetor, setInspetor] = React.useState<string | null>(null);
  const [aba, setAba] = React.useState<AbaColuna>("disponiveis");
  const [busca, setBusca] = React.useState("");
  const [marca, setMarca] = React.useState<EnderecoLinha | null>(null);
  const [preVisualizar, setPreVisualizar] = React.useState(false);
  const [renomeando, setRenomeando] = React.useState<{ tipo: "painel" | "card"; id: string } | null>(null);
  const [confirmarRestaurar, setConfirmarRestaurar] = React.useState(false);
  const [pedidoDeFoco, setPedidoDeFoco] = React.useState(0);
  const refBusca = React.useRef<HTMLInputElement>(null);
  const refItem = React.useRef<ItemArrastado | null>(null);

  // painel e card abertos: o que sumiu (excluído, desfeito) cede o lugar ao vizinho — mesma posição ou o último
  const memoria = React.useRef({ painel: 0, card: { painel: "", indice: 0 } });
  const painel = l.panels.find((x) => x.id === painelId) ?? l.panels[Math.max(0, Math.min(memoria.current.painel, l.panels.length - 1))];
  const cards = painel ? R.cardsDoPainel(l, painel.id) : [];
  const card = cards.find((c) => c.id === cardId)
    ?? (memoria.current.card.painel === painel?.id ? cards[Math.max(0, Math.min(memoria.current.card.indice, cards.length - 1))] : cards[0]);
  React.useEffect(() => {
    if (!painel) return;
    memoria.current.painel = l.panels.indexOf(painel);
    if (painel.id !== painelId) setPainelId(painel.id);
    if (!card) return;
    memoria.current.card = { painel: painel.id, indice: cards.indexOf(card) };
    if (card.id !== cardId) setCardId(card.id);
  });

  // a marca do "+ Campo" é por posição: vale só no card aberto e enquanto a linha tiver vaga
  const posicionados = React.useMemo(() => R.posicionados(l), [l]);
  const marcaValida = edicao && marca && card && marca.cardId === card.id && marca.linha < Math.max(1, card.rows.length)
    && (card.rows[marca.linha]?.fieldIds.length ?? 0) < R.limiteDaLinha(card) ? marca : null;
  const inspetorValido = edicao && inspetor && posicionados.has(inspetor) ? inspetor : null;
  const selecionadoValido = edicao && selecionado && posicionados.has(selecionado) ? selecionado : null;
  React.useEffect(() => { if (marca && !marcaValida) setMarca(null); }, [marca, marcaValida]);
  React.useEffect(() => { if (inspetor && !inspetorValido) setInspetor(null); }, [inspetor, inspetorValido]);
  React.useEffect(() => { if (selecionado && !selecionadoValido) setSelecionado(null); }, [selecionado, selecionadoValido]);
  // Esc solta a marca — mas não no meio de um arraste, em que o Esc é do arraste (captura: lê o item antes de ele sair)
  React.useEffect(() => {
    if (!marca) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape" && !refItem.current) setMarca(null); };
    window.addEventListener("keydown", tecla, true);
    return () => window.removeEventListener("keydown", tecla, true);
  }, [marca]);
  React.useEffect(() => { if (pedidoDeFoco) refBusca.current?.focus(); }, [pedidoDeFoco]);

  /** toda mudança é UMA entrada na pilha; operação que recusa (null) não mexe em nada */
  const alterar = React.useCallback((op: (x: FormLayout) => FormLayout | null, digitacao?: string) => {
    setPilha((atual) => { if (!atual) return atual; const novo = op(atual.presente); return novo ? R.aplicar(atual, novo, digitacao) : atual; });
  }, []);
  const fecharDigitacao = React.useCallback(() => setPilha((atual) => (atual ? R.fecharDigitacao(atual) : atual)), []);

  const limparTela = () => { setSelecionado(null); setInspetor(null); setMarca(null); setRenomeando(null); };
  const voltarAConsulta = () => { setModo("consulta"); setPilha(null); setBusca(""); limparTela(); };
  const editar = () => {
    if (!p.loaded) return;
    setPilha(R.criarPilha(R.abrirRascunho(salvo)));
    setModo("edicao");
    limparTela();
  };
  const salvar = () => {
    if (!pilha) return;
    const doc = R.paraSalvar(pilha.presente);
    p.update(() => doc);
    voltarAConsulta();
    toast.success("Layout salvo");
  };
  const andar = (passo: (x: Pilha) => Pilha) => { setPilha((atual) => (atual ? passo(atual) : atual)); setMarca(null); setSelecionado(null); setRenomeando(null); };
  const restaurar = async () => { setConfirmarRestaurar(false); voltarAConsulta(); await p.reset(); };

  const trocarPainel = (id: string) => {
    if (id === painel?.id) return;
    setPainelId(id); setCardId(R.cardsDoPainel(l, id)[0]?.id ?? "");
    setMarca(null); setSelecionado(null); setRenomeando(null);
  };
  const trocarCard = (id: string) => {
    if (id === card?.id) return;
    setCardId(id); setMarca(null); setSelecionado(null); setRenomeando(null);
  };
  /** destino de quem entra pelo "+" ou pelo Usar todos; painel sem card (layout antigo) ganha o primeiro, na mesma entrada da pilha */
  const noCardAberto = (op: (x: FormLayout, cardId: string) => FormLayout | null) => {
    if (card) { alterar((x) => op(x, card.id)); return; }
    if (!painel) return;
    const id = uid("c");
    alterar((x) => op(R.adicionarCard(x, painel.id, id), id));
    setCardId(id);
  };
  const usar = (fid: string) => {
    if (marcaValida) alterar((x) => R.usarCampo(x, ctx, fid, { cardId: marcaValida.cardId, linha: marcaValida.linha }));
    else noCardAberto((x, cardId) => R.usarCampo(x, ctx, fid, { cardId }));
    setSelecionado(fid);
  };
  const tirar = (fid: string) => { alterar((x) => R.tirarCampo(x, ctx, fid)); setSelecionado(null); };

  const disponiveis = React.useMemo(() => p.campos.filter((c) => !posicionados.has(c.id)), [p.campos, posicionados]);
  const emUso = React.useMemo(() => p.campos.filter((c) => posicionados.has(c.id)), [p.campos, posicionados]);
  const tiraveis = card ? card.rows.flatMap((r) => r.fieldIds).filter((fid) => !ctx.ehDoSistema(fid)).length : 0;
  const rotulo = (fid: string) => l.fieldLabels[fid] || ctx.info(fid)?.label || fid;
  const valorPadrao = (fid: string) => { const v = l.fieldDefaultValues[fid]; return v === undefined || v === null || v === "" ? undefined : String(v); };

  const prever = (item: ItemArrastado, a: AlvoBruto) => R.preverSoltura(l, ctx, item, a);
  const soltar = (item: ItemArrastado, previsao: Previsao) => {
    alterar((x) => R.aplicarSoltura(x, ctx, item, previsao));
    // o campo que pousa fica selecionado, como no desenho; mover linha desfaz a marca (ela é por posição)
    if (item.tipo === "campo" || item.tipo === "disponivel") setSelecionado(previsao.tipo === "coluna" ? null : item.fid);
    if (item.tipo === "linha") setMarca(null);
  };

  const campoDoInspetor = inspetorValido ? ctx.info(inspetorValido) : undefined;

  return <ProvedorArraste ativo={edicao} prever={prever} soltar={soltar}>
    <ComArraste refItem={refItem}>{(arraste) => {
      const vista = arraste.item ? R.vistaDuranteArraste(l, arraste.item) : l;
      // o card aberto é procurado só no painel aberto: id de card não é único entre painéis
      const cardDaVista = card && painel ? R.cardsDoPainel(vista, painel.id).find((c) => c.id === card.id) ?? card : undefined;
      // as lixeiras respondem pelo documento real; com uma linha na mão, o índice da vista pula a que saiu
      const linhaNaMao = arraste.item?.tipo === "linha" ? arraste.item : null;
      const paraOReal = (end: EnderecoLinha): EnderecoLinha => (linhaNaMao && linhaNaMao.cardId === end.cardId && end.linha >= linhaNaMao.linha ? { ...end, linha: end.linha + 1 } : end);
      return <div data-testid="layout-config" data-modo={edicao ? "edicao" : "consulta"} className={estilos.raiz}>
        <Barra modo={edicao ? "edicao" : "consulta"} carregado={p.loaded} alterado={alterado}
          podeDesfazer={pilha ? R.podeDesfazer(pilha) : false} podeRefazer={pilha ? R.podeRefazer(pilha) : false}
          preVisualizar={preVisualizar} temPersonalizacao={p.source === "user"} podeEditarOrg={p.canEditOrg} temPadraoOrg={p.hasOrgDefault}
          voltarHref={backHref} aoEditar={editar} aoSalvar={salvar} aoDescartar={voltarAConsulta}
          aoDesfazer={() => andar(R.desfazer)} aoRefazer={() => andar(R.refazer)}
          aoAlternarPreVisualizar={() => setPreVisualizar((v) => !v)} aoRestaurar={() => setConfirmarRestaurar(true)}
          aoUsarComoPadraoOrg={() => void p.saveAsOrgDefault()} aoRemoverPadraoOrg={() => void p.clearOrgDefault()} />
        <section data-parte="documento" aria-label="Layout do formulário" className={estilos.documento}>
          {edicao && <Coluna aba={aba} aoTrocarAba={(a) => { setAba(a); setBusca(""); }} busca={busca} aoBuscar={setBusca} refBusca={refBusca}
            disponiveis={disponiveis} emUso={emUso} obrigatorio={(fid) => R.obrigatorio(l, ctx, fid)} doSistema={ctx.ehDoSistema}
            aoAdicionar={usar} aoTirar={tirar} />}
          {edicao && <Trilho usarTodos={painel ? disponiveis.length : 0} tirarTodos={tiraveis}
            aoUsarTodos={() => { noCardAberto((x, cardId) => R.usarTodos(x, ctx, cardId)); setSelecionado(null); }}
            aoTirarTodos={() => { if (card) { alterar((x) => R.tirarTodos(x, ctx, card.id)); setSelecionado(null); } }} />}
          <div data-parte="principal" className={estilos.principal}>
            <Faixas modo={edicao ? "edicao" : "consulta"} layout={vista} painelId={painel?.id ?? ""} cardId={card?.id ?? ""}
              aoSelecionarPainel={trocarPainel} aoSelecionarCard={trocarCard} contagemDoPainel={(id) => R.contagemDoPainel(l, id)}
              renomeando={edicao ? renomeando : null} aoIniciarRenomear={(tipo, id) => { if (edicao) setRenomeando({ tipo, id }); }}
              aoRenomear={(tipo, id, nome) => {
                setRenomeando(null);
                if (nome !== null) alterar((x) => (tipo === "painel" ? R.renomearPainel(x, id, nome) : R.renomearCard(x, id, nome)));
              }}
              aoAdicionarPainel={() => {
                const ids = { painel: uid("p"), card: uid("c") };
                alterar((x) => R.adicionarPainel(x, ids));
                setPainelId(ids.painel); setCardId(ids.card); setRenomeando({ tipo: "painel", id: ids.painel }); setMarca(null); setSelecionado(null);
              }}
              aoExcluirPainel={() => { if (painel) { alterar((x) => R.removerPainel(x, ctx, painel.id)); setSelecionado(null); setRenomeando(null); } }}
              motivoNaoExcluirPainel={painel ? R.motivoNaoExcluirPainel(l, ctx, painel.id) : null}
              aoAdicionarCard={() => {
                if (!painel) return;
                const id = uid("c");
                alterar((x) => R.adicionarCard(x, painel.id, id));
                setCardId(id); setRenomeando({ tipo: "card", id }); setMarca(null); setSelecionado(null);
              }}
              aoExcluirCard={() => { if (card) { alterar((x) => R.removerCard(x, ctx, card.id)); setSelecionado(null); setRenomeando(null); } }}
              motivoNaoExcluirCard={card ? R.motivoNaoExcluirCard(l, ctx, card.id) : "O painel precisa de ao menos um card"}
              aoAlternarLargura={() => { if (card) { alterar((x) => R.alternarLargura(x, card.id)); setMarca(null); } }} />
            <Linhas modo={edicao ? "edicao" : "consulta"} layout={vista} card={cardDaVista} rotulo={rotulo} nomeDoSistema={(fid) => ctx.info(fid)?.label ?? fid}
              obrigatorio={(fid) => R.obrigatorio(l, ctx, fid)} doSistema={ctx.ehDoSistema} oculto={(fid) => !R.visivel(l, ctx, fid)}
              somenteLeitura={(fid) => R.somenteLeitura(l, ctx, fid)} temValorPadrao={(fid) => valorPadrao(fid) !== undefined}
              preVisualizar={preVisualizar} selecionado={selecionadoValido} inspetor={inspetorValido} marca={marcaValida}
              aoSelecionar={(fid) => { if (edicao) setSelecionado(fid); }}
              aoAbrirInspetor={(fid) => { if (!edicao) return; fecharDigitacao(); setInspetor(fid); setSelecionado(fid); }}
              aoTirar={tirar}
              aoMarcarLinha={(end) => { if (!edicao) return; setMarca(end); setAba("disponiveis"); setBusca(""); setPedidoDeFoco((n) => n + 1); }}
              aoRemoverLinha={(end) => { alterar((x) => R.removerLinha(x, ctx, end)); setMarca(null); }}
              motivoNaoRemoverLinha={(end) => R.motivoNaoRemoverLinha(l, ctx, paraOReal(end))}
              aoAdicionarLinha={() => { if (card) alterar((x) => R.adicionarLinha(x, card.id)); }} />
          </div>
          {inspetorValido && campoDoInspetor && <Inspetor key={inspetorValido} campo={campoDoInspetor} rotulo={l.fieldLabels[inspetorValido]}
            obrigatorio={R.obrigatorio(l, ctx, inspetorValido)} visivel={R.visivel(l, ctx, inspetorValido)} somenteLeitura={R.somenteLeitura(l, ctx, inspetorValido)}
            valorPadrao={valorPadrao(inspetorValido)} doSistema={ctx.ehDoSistema(inspetorValido)} soLeituraNaDefinicao={ctx.ehSoLeituraNaDefinicao(inspetorValido)}
            aoRotulo={(t) => alterar((x) => R.definirRotulo(x, inspetorValido, t), `rotulo:${inspetorValido}`)}
            aoValorPadrao={(v) => alterar((x) => R.definirValorPadrao(x, inspetorValido, v), `valor:${inspetorValido}`)}
            aoFecharDigitacao={fecharDigitacao}
            aoObrigatorio={(on) => alterar((x) => R.definirObrigatorio(x, ctx, inspetorValido, on))}
            aoVisivel={(on) => alterar((x) => R.definirVisivel(x, ctx, inspetorValido, on))}
            aoSomenteLeitura={(on) => alterar((x) => R.definirSomenteLeitura(x, ctx, inspetorValido, on))}
            aoFechar={() => { fecharDigitacao(); setInspetor(null); }} />}
        </section>
        <ConfirmDialog open={confirmarRestaurar} onOpenChange={setConfirmarRestaurar} title="Restaurar padrão?"
          text="Apaga a sua personalização deste formulário e descarta o que não foi salvo. Você volta ao padrão da organização ou, sem ele, ao do sistema."
          confirmLabel="Restaurar padrão" dismissLabel="Voltar" onConfirm={() => void restaurar()} />
      </div>;
    }}</ComArraste>
  </ProvedorArraste>;
}
