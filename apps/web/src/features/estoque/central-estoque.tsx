"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LIMITE_CUSTO_ESTOQUE, LIMITE_QUANTIDADE_ESTOQUE, MENSAGEM_APROVACAO_PENDENTE, type EspecieEstoque } from "@agro/domain";
import { api, newIdem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { useTradutor } from "@/lib/i18n";
import { brl, dateBR, dateTimeBR, num, todayISO } from "@/lib/utils";
import { COPY, enumLabel } from "@/lib/copy";
import { Button, Card, CardBody, CardHeader, Confirm, Dialog, Field, Input, LoadingState, StatusBadge, Textarea, statusTone } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { KV, LoadingOr, SimpleTable, useDoc, useEmpresaPadrao, type Row } from "@/features/docs/shared";
import { MensagemTop, podeLancar, type EstadoTop, type TopOperacional } from "@/features/sales/tipo-operacao-select";
import { mensagemDoServidorNoMolde, type ResultadoConfirmacaoAutomatica } from "@/features/aprovacoes/areas-de-aprovacao";
import { LancadorDeTipoOperacao, pedidoImpossivel, topSelecionada } from "@/features/sales/lancador-tipo-operacao";
import { useTopsDaEspecieEstoque, type VarianteDeEstoque } from "./movimentacoes-variantes";
import { descreverCaminhoDeItem, errosDoServidor, numeroDoCampo } from "./central-estoque-campos";
import {
  EditorDeItensEstoque, TabelaDeItensEstoque, camposDaLinha, colunasDeLote, especieInformaValidade, useControleDeLote,
  type ItemLidoEstoque, type LinhaDeEstoque
} from "./central-estoque-itens";
import { chaveDaPreviaEstoque, rotuloDoMovimentoPrevisto, usePreviaDaConfirmacaoEstoque, type PreviaDaConfirmacaoEstoque } from "./previa-confirmacao-estoque";

/**
 * A CENTRAL DE ESTOQUE — lançar, consultar, confirmar e cancelar o DOCUMENTO DE ESTOQUE (ESTOQUE-01, decisão 274).
 *
 * ┌─ O MOLDE ─────────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ A Central de Compras (COMPRAS-01): TOP primeiro, formulário depois; a TOP da URL é PEDIDO e só vale se a  │
 * │ lista que o servidor devolve para AQUELA espécie a confirmar; sem ela, o lançador (o de Vendas, que não    │
 * │ conhece porta). O desenho foi COPIADO, não importado: a Central de Compras é presa à compra em cada campo   │
 * │ (fornecedor, nota, parcelas, layout), e parametrizá-la mudaria compras. Peças genéricas são reusadas.     │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * DOIS MODOS NA MESMA CENTRAL (`data-modo`):
 *   · criação — `/estoque/movimentacoes/<segmento>/new?tipo_operacao_id=…`: cabeçalho (TOP travada, empresa,
 *     armazém — e destino na transferência —, data, observação) e itens por espécie. Salvar grava o documento
 *     ABERTO: NADA de estoque se move ao salvar. Depois de salvo, a Central abre o documento em consulta. A exceção é
 *     do SERVIDOR, não da tela: com a TOP no formato 4 e Confirmação Automática ele tenta confirmar no fim do POST, e a
 *     Central só lê o resultado para escolher o aviso (`avisarSalvo`).
 *   · consulta — `/estoque/movimentacoes/<segmento>/<id>`: o documento como o servidor o leu (situação, código, TOP
 *     e versão congeladas, itens, movimentos), com Confirmar (depois da PRÉVIA, em diálogo) e Cancelar (com motivo).
 *     É só leitura: editar o documento aberto está fora desta fatia.
 *
 * O servidor é a autoridade em tudo: o código e o número são dele; os botões aparecem por capacidade (`can()` só
 * esconde — Confirmar e Cancelar pedem `<recurso>.edit`, como na compra); o 422 cai no campo que o servidor apontou.
 * Os números viajam como TEXTO canônico (vírgula vira ponto; nunca float, nunca arredondado).
 *
 * EMPRESA: a mesma fonte da Central de Compras (`useEmpresaPadrao`: a empresa da sessão, ou a primeira do contexto).
 * Ela é PEDIDO — o servidor confere o escopo. Os armazéns são oferecidos pela empresa escolhida, e trocar de
 * empresa limpa os armazéns: os dois têm de ser DA EMPRESA do documento (transferência entre empresas fica nas
 * telas antigas).
 */
export function CentralEstoque({ variante, id }: { variante: VarianteDeEstoque; id?: string }) {
  return id ? <ConsultaEstoque variante={variante} id={id} /> : <CriacaoEstoque variante={variante} />;
}

const especieDa = (variante: VarianteDeEstoque) => variante.variante as EspecieEstoque;
const VOLTAR = "/estoque?tab=movimentacoes";
const traco = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
/** O rótulo do campo do cabeçalho para o erro que cai na lista (nunca a chave técnica na tela). */
const ROTULO_DO_CAMPO_DO_CABECALHO: Record<string, string> = {
  empresa_id: "Empresa", tipo_operacao_id: "Tipo de Operação", data_documento: "Data do documento", armazem_id: "Armazém",
  armazem_destino_id: "Armazém de destino", observacao: "Observação"
};
const rotuloDoErro = (caminho: string) => (caminho.startsWith("itens") ? descreverCaminhoDeItem(caminho) : ROTULO_DO_CAMPO_DO_CABECALHO[caminho] ?? "Documento");

/* ═══════════════════════════════ CRIAÇÃO ═══════════════════════════════ */

/**
 * TOP PRIMEIRO, FORMULÁRIO DEPOIS (o mesmo desenho das Centrais de Vendas e de Compras):
 *   sem `?tipo_operacao_id`, ou com uma que a lista da espécie não confirma → LANÇADOR: o formulário não existe;
 *   com a TOP que a lista confirma                                          → FORMULÁRIO, com a TOP travada.
 * O formulário mora num componente SEPARADO, com `key` pela TOP: trocar a TOP pela URL nunca herda o que foi digitado.
 *
 * A TRAVA DA SESSÃO (a mesma de Vendas e Compras): uma nova leitura da lista que deixe de confirmar a TOP não desmonta
 * o que a pessoa digitou — o formulário continua, mas a ESCRITA só é autorizada pela lista de AGORA.
 */
function CriacaoEstoque({ variante }: { variante: VarianteDeEstoque }) {
  const router = useRouter(); const sp = useSearchParams(); const tr = useTradutor();
  const { can } = useAuth();
  const pedidaNaUrl = sp.get("tipo_operacao_id") ?? "";
  const estado = useTopsDaEspecieEstoque(variante.segmento, can(`${variante.perm}.create`));
  const topAtual = topSelecionada(estado, pedidaNaUrl);
  const chave = pedidaNaUrl ? `${variante.segmento}:${pedidaNaUrl}` : null;
  const trava = React.useRef<{ chave: string; top: TopOperacional } | null>(null);
  React.useLayoutEffect(() => {
    if (!chave) { trava.current = null; return; }
    if (topAtual) trava.current = { chave, top: topAtual };
  });
  const topDaSessao = chave && trava.current?.chave === chave ? trava.current.top : null;
  const topEfetiva = topAtual ?? topDaSessao;
  if (topEfetiva) {
    return <FormularioEstoque key={topEfetiva.id} variante={variante} estado={estado} top={topEfetiva} escritaTopConfirmada={podeLancar(estado) && topAtual !== null} />;
  }
  return <LancadorDeTipoOperacao
    estado={estado}
    titulo={`Novo documento · ${tr(variante.chaveI18n)}`}
    indisponivel={pedidoImpossivel(estado, pedidaNaUrl)}
    onCancelar={() => router.push(VOLTAR)}
    // `replace`: o lançador e o formulário são duas caras da MESMA etapa de criação (o Voltar do navegador sai dela)
    onContinuar={(t) => router.replace(`/estoque/movimentacoes/${variante.segmento}/new?tipo_operacao_id=${encodeURIComponent(t.id)}`)}
  />;
}

interface Cabecalho { empresa_id: string; armazem_id: string; armazem_destino_id: string; data_documento: string; observacao: string }

/**
 * O 201 do POST. `confirmacaoAutomatica` só vem quando a versão da TOP é formato 4 com Confirmação Automática: o
 * servidor tentou confirmar no fim do POST, por quem salvou (TOP-CONFIG-08, decisão 277). Formato 1 a 3, ou Manual:
 * o corpo de hoje, sem a chave.
 */
interface RespostaDoSalvar { id: string; situacao?: string; confirmacaoAutomatica?: ResultadoConfirmacaoAutomatica }

/**
 * O AVISO DO SALVAR, lido da resposta — nunca suposto pela TOP da tela:
 *   · sem `confirmacaoAutomatica` → "Salvo com sucesso" (o de hoje, byte a byte);
 *   · `{ confirmado: true }` → "Salvo e confirmado.";
 *   · `aguardando_aprovacao` → "Salvo. <a mensagem da aprovação pendente do domínio>";
 *   · `sem_permissao` → "Salvo, mas não confirmado: você não tem permissão para confirmar este documento.";
 *   · `recusada` → "Salvo, mas não confirmado: <mensagem do servidor>." — a MESMA mensagem que o Confirmar daria.
 * Resultado fora do contrato cai no aviso de hoje: o 201 já prova que o documento foi gravado, e a consulta que abre
 * em seguida mostra a situação que o servidor leu. Nenhum texto é inventado para ele.
 */
function avisarSalvo(r: RespostaDoSalvar): void {
  const a = r.confirmacaoAutomatica;
  if (a?.confirmado === true) { toast.success("Salvo e confirmado."); return; }
  if (a?.confirmado === false) {
    if (a.motivo === "aguardando_aprovacao") { toast.info(`Salvo. ${MENSAGEM_APROVACAO_PENDENTE}`); return; }
    if (a.motivo === "sem_permissao") { toast.warning("Salvo, mas não confirmado: você não tem permissão para confirmar este documento."); return; }
    if (a.motivo === "recusada" && typeof a.erro?.message === "string" && a.erro.message.trim()) {
      toast.warning(mensagemDoServidorNoMolde("Salvo, mas não confirmado: ", a.erro.message)); return;
    }
  }
  toast.success("Salvo com sucesso");
}

function FormularioEstoque({ variante, estado, top, escritaTopConfirmada }: {
  variante: VarianteDeEstoque;
  estado: EstadoTop;
  top: TopOperacional;
  /** A lista de AGORA confirma a TOP? Só isso autoriza o POST. */
  escritaTopConfirmada: boolean;
}) {
  const router = useRouter(); const tr = useTradutor(); const qc = useQueryClient();
  const especie = especieDa(variante);
  const ehTransferencia = especie === "transferencia";
  const empresaPadrao = useEmpresaPadrao();
  // O nome da família, guardado ao montar: uma nova leitura da lista não apaga o contexto da tela.
  const [movimento] = React.useState(() => (estado.situacao === "pronto" ? estado.dados.family.label : ""));
  const inicial = React.useRef<Cabecalho>({ empresa_id: "", armazem_id: "", armazem_destino_id: "", data_documento: todayISO(), observacao: "" });
  const [h, setH] = React.useState<Cabecalho>(inicial.current);
  React.useEffect(() => { setH((o) => ({ ...o, empresa_id: o.empresa_id || empresaPadrao })); }, [empresaPadrao]);
  const mudar = (p: Partial<Cabecalho>) => setH((o) => ({ ...o, ...p }));
  const [linhas, setLinhas] = React.useState<LinhaDeEstoque[]>([]);
  const [erros, setErros] = React.useState<Record<string, string>>({});
  const [confirmarTroca, setConfirmarTroca] = React.useState(false);
  const erro = (c: string) => erros[c];

  const lote = useControleDeLote(linhas.map((l) => l.produto_id));
  const colunas = colunasDeLote(especie, linhas, lote);

  /**
   * CONFERÊNCIA LOCAL — só o que a tela sabe sem perguntar (campo vazio, número fora da forma, destino igual à origem),
   * com a MESMA função de número do domínio que a API usa: o que a tela recusa, o servidor recusaria igual. O resto
   * (armazém de outra empresa, produto inativo, lote obrigatório, exigência da TOP) é o servidor quem diz.
   * Devolve o corpo do POST, ou os erros por caminho.
   */
  const montar = (): { corpo: Record<string, unknown> } | { erros: Record<string, string> } => {
    const e: Record<string, string> = {};
    if (!h.empresa_id) e["empresa_id"] = "Informe a empresa";
    if (!h.armazem_id) e["armazem_id"] = ehTransferencia ? "Informe o armazém de origem" : "Informe o armazém";
    if (ehTransferencia) {
      if (!h.armazem_destino_id) e["armazem_destino_id"] = "Informe o armazém de destino da transferência";
      else if (h.armazem_destino_id === h.armazem_id) e["armazem_destino_id"] = "O armazém de destino tem de ser diferente do armazém de origem";
    }
    if (!h.data_documento) e["data_documento"] = "Informe a data do documento";
    if (!linhas.length) e["itens"] = "Inclua ao menos um item";
    const itens = linhas.map((l, i) => {
      const item: Record<string, string> = { produto_id: l.produto_id };
      if (!l.produto_id) e[`itens.${i}.produto_id`] = "Informe o produto";
      const numero = (campo: "quantidade" | "quantidade_contada" | "custo_unitario", r: ReturnType<typeof numeroDoCampo>) => {
        if (r.ok) item[campo] = r.valor; else e[`itens.${i}.${campo}`] = r.mensagem;
      };
      if (especie === "ajuste") numero("quantidade_contada", numeroDoCampo(l.quantidade_contada, LIMITE_QUANTIDADE_ESTOQUE, "naoNegativo", "Informe a quantidade contada"));
      else numero("quantidade", numeroDoCampo(l.quantidade, LIMITE_QUANTIDADE_ESTOQUE, "positivo", "Informe a quantidade"));
      if (especie === "entrada") numero("custo_unitario", numeroDoCampo(l.custo_unitario, LIMITE_CUSTO_ESTOQUE, "naoNegativo", "Informe o custo unitário da entrada"));
      // Lote e validade só viajam quando o produto os controla: o contrato recusa o lote de produto sem lote.
      const c = lote.daLinha(l.produto_id);
      if (c.lote && l.lote.trim()) item["lote"] = l.lote.trim();
      if (especieInformaValidade(especie) && c.validade && l.validade) item["validade"] = l.validade;
      return item;
    });
    if (Object.keys(e).length) return { erros: e };
    return {
      corpo: {
        empresa_id: h.empresa_id,
        tipo_operacao_id: top.id,
        armazem_id: h.armazem_id,
        ...(ehTransferencia ? { armazem_destino_id: h.armazem_destino_id } : {}),
        data_documento: h.data_documento,
        // O contrato é estrito: campo vazio não viaja.
        ...(h.observacao.trim() ? { observacao: h.observacao.trim() } : {}),
        itens
      }
    };
  };

  // Uma chave de idempotência por TENTATIVA de lançamento; renovada só depois de uma recusa.
  const chave = React.useRef(newIdem());
  const salvar = useMutation({
    mutationFn: (corpo: Record<string, unknown>) => api<RespostaDoSalvar>(`/api/estoque/${variante.segmento}`, { method: "POST", body: corpo, idempotencyKey: chave.current }),
    onSuccess: (r) => { avisarSalvo(r); void qc.invalidateQueries(); router.push(`/estoque/movimentacoes/${variante.segmento}/${encodeURIComponent(r.id)}`); },
    onError: (e) => { chave.current = newIdem(); setErros(errosDoServidor(e)); toast.error((e as Error).message); }
  });
  const salvarBloqueado = !escritaTopConfirmada || !linhas.length || salvar.isPending;
  const submit = () => {
    // A defesa no handler, e não só no `disabled` do botão: `disabled` é apresentação.
    if (salvarBloqueado) return;
    const m = montar();
    if ("erros" in m) { setErros(m.erros); return; }
    setErros({});
    salvar.mutate(m.corpo);
  };

  /* "Tem coisa digitada?" — contra o estado inicial, sem a empresa (preenchida por efeito, não por digitação). */
  const semEmpresa = ({ empresa_id: _empresa, ...resto }: Cabecalho) => resto;
  const sujo = linhas.length > 0 || JSON.stringify(semEmpresa(h)) !== JSON.stringify(semEmpresa(inicial.current));
  const voltarAoLancador = () => router.replace(`/estoque/movimentacoes/${variante.segmento}/new`);
  const alterarOperacao = () => { if (sujo) setConfirmarTroca(true); else voltarAoLancador(); };

  /** O erro que não tem campo à vista onde cair (ex.: `itens` vazio, campo de item escondido) vai para a lista. */
  const aVista = new Set<string>(["empresa_id", "armazem_id", "data_documento", "observacao", ...(ehTransferencia ? ["armazem_destino_id"] : [])]);
  linhas.forEach((l, i) => { for (const c of camposDaLinha(especie, l, colunas, lote)) aVista.add(`itens.${i}.${c}`); });
  const semCampo = Object.entries(erros).filter(([c]) => !aVista.has(c));

  return <>
    <Card data-testid="estoque-central" data-especie={especie} data-modo="criacao">
      <CardHeader title={`Novo documento · ${tr(variante.chaveI18n)}`} actions={<>
        <Button variant="outline" size="sm" onClick={() => router.push(VOLTAR)}>Voltar</Button>
        <Button variant="outline" size="sm" data-testid="estoque-alterar-operacao" onClick={alterarOperacao}>Alterar operação</Button>
        <Button size="sm" data-testid="estoque-salvar" loading={salvar.isPending} disabled={salvarBloqueado} onClick={submit}>Salvar</Button>
      </>} />
      <CardBody className="space-y-4">
        {/* A lista de AGORA não confirma mais a TOP desta sessão: o formulário continua, a escrita não. */}
        {!escritaTopConfirmada && <div className="space-y-1 rounded-md bg-amber-50 p-3">
          <MensagemTop estado={estado} />
          {estado.situacao === "pronto" && <p data-testid="top-indisponivel" className="text-sm text-amber-800">O Tipo de Operação selecionado não está disponível para este lançamento.</p>}
          <p className="text-xs text-amber-700">O que já foi preenchido continua aqui. Use “Alterar operação” para escolher outra.</p>
        </div>}
        <p className="text-[12.5px] text-slate-500">O saldo só muda quando o documento for confirmado. Salvar grava o documento aberto.</p>
        <div className="grid grid-cols-12 gap-3">
          {/* A TOP TRAVADA: contexto do lançamento, não campo. Trocar é "Alterar operação" (volta ao lançador). */}
          <Field label="Tipo de Operação" required span={4}>
            <Input data-testid="estoque-central-top" data-tipo-operacao-id={top.id} readOnly disabled value={`${top.code} — ${top.name}`} />
            {movimento && <span className="mt-1 block text-xs text-slate-500">Movimento: {movimento} (o movimento é definido pela espécie)</span>}
          </Field>
          <Field label="Empresa" required span={4} error={erro("empresa_id")}>
            <RefSelect resource="empresas" value={h.empresa_id} onChange={(v) => mudar({ empresa_id: v ?? "", armazem_id: "", armazem_destino_id: "" })} />
          </Field>
          <Field label="Data do documento" required span={2} error={erro("data_documento")}>
            <Input data-testid="estoque-central-data" type="date" value={h.data_documento} onChange={(e) => mudar({ data_documento: e.target.value })} />
          </Field>
          {/* O invólucro só leva o contrato do teste: `display: contents` não ocupa lugar no grid. */}
          <div data-testid="estoque-central-armazem" style={{ display: "contents" }}>
            <Field label={ehTransferencia ? "Armazém de origem" : "Armazém"} required span={4} error={erro("armazem_id")}>
              <RefSelect resource="warehouses" value={h.armazem_id} disabled={!h.empresa_id || undefined} filter={{ empresa_id: h.empresa_id }}
                excluirIds={ehTransferencia && h.armazem_destino_id ? [h.armazem_destino_id] : undefined} onChange={(v) => mudar({ armazem_id: v ?? "" })} />
            </Field>
          </div>
          {ehTransferencia && <div data-testid="estoque-central-armazem-destino" style={{ display: "contents" }}>
            <Field label="Armazém de destino" required span={4} error={erro("armazem_destino_id")}>
              <RefSelect resource="warehouses" value={h.armazem_destino_id} disabled={!h.empresa_id || undefined} filter={{ empresa_id: h.empresa_id }}
                excluirIds={h.armazem_id ? [h.armazem_id] : undefined} onChange={(v) => mudar({ armazem_destino_id: v ?? "" })} />
            </Field>
          </div>}
          <Field label="Observação" span={12} error={erro("observacao")}>
            <Textarea data-testid="estoque-central-observacao" value={h.observacao} onChange={(e) => mudar({ observacao: e.target.value })} />
          </Field>
        </div>
        <div data-testid="estoque-central-itens">
          <EditorDeItensEstoque especie={especie} linhas={linhas} onChange={setLinhas} lote={lote} colunas={colunas} erro={erro} />
          {semCampo.length > 0 && <ul data-testid="estoque-central-erros" className="mt-2 space-y-0.5 text-[12px] text-red-700">
            {semCampo.map(([c, m]) => <li key={c}>{rotuloDoErro(c)}: {m}</li>)}
          </ul>}
        </div>
      </CardBody>
    </Card>

    {/* Trocar a operação descarta o que foi digitado — então pergunta antes, em vez de descobrir depois. */}
    <Confirm open={confirmarTroca} onOpenChange={setConfirmarTroca} title="Alterar o Tipo de Operação?"
      text="Os dados já preenchidos neste lançamento serão descartados." danger
      onConfirm={() => { setConfirmarTroca(false); voltarAoLancador(); }} />
  </>;
}

/* ═══════════════════════════════ CONSULTA ═══════════════════════════════ */

/** O documento como o servidor o lê (`GET /api/estoque/<segmento>/:id`). Números e datas como TEXTO. */
interface DocumentoLidoEstoque {
  id: string;
  codigo: string;
  especie: string;
  situacao: string;
  empresa_nome: string | null;
  armazem_nome: string | null;
  armazem_destino_id: string | null;
  armazem_destino_nome: string | null;
  data_documento: string;
  observacao: string | null;
  criado_por_nome: string | null;
  confirmado_em: string | null;
  confirmado_por_nome: string | null;
  cancelado_em: string | null;
  cancelado_por_nome: string | null;
  motivo_cancelamento: string | null;
  tipo_operacao: { id: string; codigo: string; codigo_base: string | null; nome: string; versao: number | null } | null;
  itens: ItemLidoEstoque[];
  movimentos: Row[];
}

function ConsultaEstoque({ variante, id }: { variante: VarianteDeEstoque; id: string }) {
  const { can } = useAuth(); const tr = useTradutor(); const qc = useQueryClient(); const router = useRouter();
  const especie = especieDa(variante);
  const porta = `/api/estoque/${variante.segmento}/${encodeURIComponent(id)}`;
  const q = useDoc<DocumentoLidoEstoque>(porta);
  const [confirmando, setConfirmando] = React.useState(false);
  const [cancelando, setCancelando] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  /** O 422 da última ação (confirmar ou cancelar), por caminho — cai no item que o servidor apontou. */
  const [errosDaAcao, setErrosDaAcao] = React.useState<Record<string, string>>({});
  const chaveConfirmar = React.useRef(newIdem());
  const chaveCancelar = React.useRef(newIdem());
  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: ["docone", porta] });
    void qc.invalidateQueries({ queryKey: chaveDaPreviaEstoque(variante.segmento, id) });
  };

  const confirmar = useMutation({
    mutationFn: () => api(`${porta}/confirmar`, { method: "POST", idempotencyKey: chaveConfirmar.current }),
    // O saldo mudou: tudo o que o mostra (lista, saldo, ledger) é perguntado de novo.
    onSuccess: () => { toast.success("Documento confirmado"); setConfirmando(false); setErrosDaAcao({}); void qc.invalidateQueries(); },
    onError: (e) => { chaveConfirmar.current = newIdem(); setConfirmando(false); setErrosDaAcao(errosDoServidor(e)); toast.error((e as Error).message); recarregar(); }
  });
  const cancelar = useMutation({
    // Motivo vazio não viaja: o servidor grava o motivo padrão.
    mutationFn: () => api(`${porta}/cancelar`, { method: "POST", body: motivo.trim() ? { motivo: motivo.trim() } : {}, idempotencyKey: chaveCancelar.current }),
    onSuccess: () => { toast.success("Documento cancelado"); setCancelando(false); setMotivo(""); setErrosDaAcao({}); void qc.invalidateQueries(); },
    onError: (e) => { chaveCancelar.current = newIdem(); setCancelando(false); setErrosDaAcao(errosDoServidor(e)); toast.error((e as Error).message); recarregar(); }
  });

  const d = q.data;
  const situacao = d?.situacao ?? "";
  const podeEditar = can(`${variante.perm}.edit`);
  const podeConfirmar = situacao === "aberto" && podeEditar;
  const podeCancelar = (situacao === "aberto" || situacao === "confirmado") && podeEditar;
  const top = d?.tipo_operacao ?? null;
  const ehTransferencia = especie === "transferencia";
  const erroDaAcao = (c: string) => errosDaAcao[c];
  const errosSemItem = Object.entries(errosDaAcao).filter(([c]) => !/^itens\.\d+/.test(c));

  // A raiz leva o contrato do teste e CONTÉM itens e movimentos (os diálogos são portais, fora dela).
  return <LoadingOr q={q}>{d && <>
    <div data-testid="estoque-central" data-especie={especie} data-modo="consulta" data-situacao={situacao} className="space-y-4">
    <Card>
      <CardHeader title={`${tr(variante.chaveI18n)} ${d.codigo}`} actions={<>
        <Button variant="outline" size="sm" onClick={() => router.push(VOLTAR)}>Voltar</Button>
        {podeConfirmar && <Button size="sm" data-testid="estoque-confirmar" onClick={() => setConfirmando(true)}>Confirmar</Button>}
        {podeCancelar && <Button size="sm" variant="outline" data-testid="estoque-cancelar" onClick={() => setCancelando(true)}>Cancelar documento</Button>}
      </>} />
      <CardBody className="space-y-4">
        {errosSemItem.length > 0 && <ul data-testid="estoque-central-erros" className="space-y-0.5 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
          {errosSemItem.map(([c, m]) => <li key={c}>{rotuloDoErro(c)}: {m}</li>)}
        </ul>}
        <KV items={[
          ["Código", <span key="c" data-testid="estoque-central-codigo">{d.codigo}</span>],
          [COPY.situacao, <span key="s" data-testid="estoque-central-situacao" data-situacao={situacao}>
            <StatusBadge domain="situacao_documento_estoque" value={situacao} tone={statusTone(situacao, "situacao_documento_compra")} />
          </span>],
          ["Espécie", enumLabel("especie_documento_estoque", d.especie)],
          ["Tipo de Operação", <span key="t" data-testid="estoque-central-top" data-tipo-operacao-id={top?.id ?? ""}>
            {top ? `${top.codigo} — ${top.nome}${top.versao ? ` (versão ${top.versao})` : ""}` : "—"}
          </span>],
          ["Empresa", traco(d.empresa_nome)],
          [ehTransferencia ? "Armazém de origem" : "Armazém", <span key="a" data-testid="estoque-central-armazem">{traco(d.armazem_nome)}</span>],
          ...(ehTransferencia ? [["Armazém de destino", <span key="ad" data-testid="estoque-central-armazem-destino">{traco(d.armazem_destino_nome)}</span>] as [string, React.ReactNode]] : []),
          ["Data do documento", <span key="d" data-testid="estoque-central-data">{dateBR(d.data_documento)}</span>],
          ["Lançado por", traco(d.criado_por_nome)],
          ...(d.confirmado_em ? [["Confirmado", `${dateTimeBR(d.confirmado_em)} por ${traco(d.confirmado_por_nome)}`] as [string, React.ReactNode]] : []),
          ...(d.cancelado_em ? [
            ["Cancelado", `${dateTimeBR(d.cancelado_em)} por ${traco(d.cancelado_por_nome)}`] as [string, React.ReactNode],
            ["Motivo do cancelamento", <span key="m" data-testid="estoque-central-motivo">{traco(d.motivo_cancelamento)}</span>] as [string, React.ReactNode]
          ] : []),
          ["Observação", <span key="o" data-testid="estoque-central-observacao">{traco(d.observacao)}</span>]
        ]} />
      </CardBody>
    </Card>
    <Card data-testid="estoque-central-itens"><CardHeader title="Itens" /><CardBody>
      <TabelaDeItensEstoque especie={especie} itens={d.itens ?? []} erro={erroDaAcao} />
    </CardBody></Card>
    <Card data-testid="estoque-central-movimentos"><CardHeader title="Movimentos de estoque" /><CardBody>
      {(d.movimentos ?? []).length ? <SimpleTable rows={d.movimentos} cols={[
        { key: "movement_date", label: "Data", render: (r) => (r["movement_date"] ? dateBR(r["movement_date"] as string) : "—") },
        { key: "product_name", label: "Produto", render: (r) => traco(r["product_name"]) },
        { key: "warehouse_name", label: "Armazém", render: (r) => traco(r["warehouse_name"]) },
        { key: "movement_type", label: "Movimento", render: (r) => enumLabel("stock_movement_type", r["movement_type"]) },
        { key: "provider_lot", label: "Lote", render: (r) => traco(r["provider_lot"]) },
        { key: "quantity", label: "Quantidade", align: "right", render: (r) => num(r["quantity"] as string, 4) },
        { key: "unit_cost", label: "Custo unitário", align: "right", render: (r) => brl(r["unit_cost"] as string) },
        { key: "total_cost", label: "Custo total", align: "right", render: (r) => brl(r["total_cost"] as string) }
      ]} /> : <p className="text-[12.5px] text-slate-500">
        {situacao === "aberto" ? "Nenhum movimento: o saldo só muda quando o documento for confirmado." : "Nenhum movimento de estoque gerado."}
      </p>}
    </CardBody></Card>
    </div>

    <DialogoDaPrevia segmento={variante.segmento} id={id} especie={especie} aberto={confirmando} onAberto={setConfirmando}
      ocupado={confirmar.isPending} onConfirmar={() => confirmar.mutate()} />
    <Dialog open={cancelando} onOpenChange={setCancelando} size="sm" testId="estoque-cancelar-dialogo" title="Cancelar documento"
      description={situacao === "confirmado"
        ? "Os movimentos do documento são estornados e o saldo volta ao que era antes da confirmação. Se o que entrou já foi consumido, o cancelamento é recusado."
        : "O documento passa a cancelado e não pode mais ser confirmado. O saldo não muda."}
      footer={<>
        <Button variant="outline" onClick={() => setCancelando(false)}>Voltar</Button>
        <Button variant="danger" data-testid="estoque-cancelar-confirmar" loading={cancelar.isPending} disabled={cancelar.isPending} onClick={() => cancelar.mutate()}>Cancelar documento</Button>
      </>}>
      <Field label="Motivo" span={12}>
        <Textarea data-testid="estoque-cancelar-motivo" maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </Field>
    </Dialog>
  </>}</LoadingOr>;
}

/**
 * O DIÁLOGO DA PRÉVIA: antes de confirmar, o que a confirmação faria no saldo de AGORA, item por item. Falta de saldo
 * na saída ou na transferência, ou uma recusa do documento (a aprovação pendente ou reprovada, a versão da TOP
 * ilegível — TOP-CONFIG-08, decisão 277), BLOQUEIA o Confirmar (`podeConfirmar: false`); prévia indisponível (API
 * anterior) deixa confirmar — o servidor confere de novo, sob a trava.
 */
function DialogoDaPrevia({ segmento, id, especie, aberto, onAberto, ocupado, onConfirmar }: {
  segmento: string; id: string; especie: EspecieEstoque; aberto: boolean; onAberto: (v: boolean) => void; ocupado: boolean; onConfirmar: () => void;
}) {
  const estado = usePreviaDaConfirmacaoEstoque(segmento, id, aberto);
  const bloqueado = estado.situacao === "carregando" || estado.situacao === "erro" || (estado.situacao === "pronta" && !estado.previa.podeConfirmar);
  return <Dialog open={aberto} onOpenChange={onAberto} size="lg" testId="estoque-previa" title="Confirmar documento"
    description="O que a confirmação vai fazer no saldo agora, segundo o servidor."
    footer={<>
      <Button variant="outline" onClick={() => onAberto(false)}>Voltar</Button>
      <Button data-testid="estoque-previa-confirmar" loading={ocupado} disabled={bloqueado || ocupado} onClick={onConfirmar}>Confirmar</Button>
    </>}>
    <div data-testid="estoque-previa-corpo" data-situacao={estado.situacao}>
      {estado.situacao === "carregando" && <LoadingState label="Calculando a prévia…" />}
      {estado.situacao === "indisponivel" && <p className="text-[12.5px] text-amber-700" data-testid="estoque-previa-indisponivel">A prévia não está disponível neste servidor. A confirmação continua conferida pelo servidor.</p>}
      {estado.situacao === "erro" && <p className="text-[12.5px] text-red-700" data-testid="estoque-previa-erro">{estado.mensagem}</p>}
      {estado.situacao === "pronta" && <CorpoDaPrevia previa={estado.previa} especie={especie} />}
    </div>
  </Dialog>;
}

/**
 * As recusas do DOCUMENTO vêm primeiro, acima da tabela, com a mensagem do servidor (a mesma que a confirmação daria);
 * o aviso de saldo só aparece quando algum item está insuficiente — com o documento recusado e o saldo coberto, ele
 * diria uma falta que não existe.
 */
function CorpoDaPrevia({ previa, especie }: { previa: PreviaDaConfirmacaoEstoque; especie: EspecieEstoque }) {
  const ehAjuste = especie === "ajuste";
  const faltaSaldo = previa.itens.some((it) => it.insuficiente);
  return <div className="space-y-2 text-[12.5px]">
    {previa.recusas.length > 0 && <ul data-testid="estoque-previa-recusas" className="space-y-0.5 rounded border border-red-200 bg-red-50 px-3 py-2 text-red-800">
      {previa.recusas.map((r, i) => <li key={`${r.code}:${i}`} data-testid="estoque-previa-recusa" data-code={r.code}>{r.message}</li>)}
    </ul>}
    {faltaSaldo && <p data-testid="estoque-previa-bloqueio" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-800">
      Há item sem saldo suficiente no armazém de origem. Ajuste o documento ou o saldo antes de confirmar.
    </p>}
    <div className="overflow-x-auto rounded border"><table className="table-dense w-full text-[12.5px]"><thead><tr>
      <th>Produto</th>
      <th>Lote</th>
      <th className="text-right">Saldo atual</th>
      <th className="text-right">{ehAjuste ? "Saldo contado" : "Saldo depois"}</th>
      {ehAjuste && <th className="text-right">Diferença</th>}
      <th>Movimento</th>
    </tr></thead><tbody>
      {previa.itens.map((it) => <tr key={it.item_id} data-testid="estoque-previa-item" data-insuficiente={String(it.insuficiente)}
        data-diferenca={it.diferenca ?? ""} data-saldo-atual={it.saldo_atual} data-saldo-depois={it.saldo_depois}>
        <td>{it.produto_nome}</td>
        <td>{traco(it.lote)}</td>
        <td className="num">{num(it.saldo_atual, 4)}</td>
        <td className={it.insuficiente ? "num text-red-700" : "num"}>{num(it.saldo_depois, 4)}{it.insuficiente && " — saldo insuficiente"}</td>
        {ehAjuste && <td className="num">{num(it.diferenca, 4)}</td>}
        <td>{rotuloDoMovimentoPrevisto(it.movimento)}</td>
      </tr>)}
    </tbody></table></div>
  </div>;
}
