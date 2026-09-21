"use client";
import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { COPY } from "@/lib/copy";
import { cn } from "@/lib/utils";
import {
  Badge, Button, ConfirmDialog, Dialog, ErrorState, Field, Input, LoadingState, NativeSelect, Textarea
} from "@/components/ui";
import {
  ATUALIZACOES_ESTOQUE, ATUALIZACOES_FINANCEIRO, CALCULOS_TRIBUTARIOS, MODOS_CONFIRMACAO,
  MODOS_FINANCEIRO, MOMENTOS_APROVACAO, MOMENTOS_EFEITO, POLITICAS_ALTERACAO, POLITICAS_APROVACAO,
  POLITICAS_DOCUMENTO_SEM_ITENS, POLITICAS_SALDO_NEGATIVO,
  normalizarConfiguracaoTop, type ConfiguracaoTipoOperacaoV1
} from "@agro/domain";
import {
  MensagemCapacidadesTop, ROTULOS_TOP, assinaturaRascunho, configuracaoInicial,
  ehConflitoDeConcorrencia, lerDetalheTop, limiteDeDestinos, podeConfigurar, podeConfigurarDestinos,
  useCapacidadesTop, useDestinosPossiveis, valorMinimoAceitavel,
  type DestinoEmEdicao, type EstadoCapacidadesTop, type RascunhoTop
} from "./top-contrato";

/**
 * O EDITOR DE TIPO DE OPERAÇÃO — SETE SEÇÕES, UMA GRAVAÇÃO (TOP-CONFIG-03).
 *
 * ┌─ O QUE ESTA TELA DECIDE, E O QUE ELA DELIBERADAMENTE NÃO DECIDE ───────────────────────────────────┐
 * │ Ela COLETA a intenção declarada de uma operação e a envia inteira, uma vez, quando o usuário manda  │
 * │ salvar. Ela NÃO normaliza por autoridade própria, NÃO autoriza nada e NÃO executa efeito nenhum.    │
 * │ As dependências entre campos (estoque desligado zera o resto, aprovação sem política zera o valor)  │
 * │ são aplicadas aqui apenas para o administrador não digitar o que será ignorado — a normalização de  │
 * │ verdade mora no domínio e acontece de novo no servidor, para qualquer cliente, inclusive `curl`.    │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ SEM SALVAMENTO AUTOMÁTICO, E O PORQUÊ ────────────────────────────────────────────────────────────┐
 * │ Cada gravação cria uma VERSÃO imutável. Salvar sozinho a cada tecla encheria o histórico de versões │
 * │ intermediárias que ninguém quis declarar, e o histórico é justamente o que explica, anos depois, a  │
 * │ regra sob a qual um documento nasceu. Então: um Salvar explícito, e confirmação ao fechar com       │
 * │ alteração pendente.                                                                                 │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ CÓDIGO E FAMÍLIA SÃO IMUTÁVEIS NA EDIÇÃO ─────────────────────────────────────────────────────────┐
 * │ Trocá-los reclassificaria retroativamente tudo o que já citou este tipo de operação. O servidor     │
 * │ recusa a troca e o banco também; a tela apenas não oferece o caminho, e diz por quê.                │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

export interface FamiliaTop { codigo: string; rotulo: string; modulo: string | null }

/** As sete seções, na ordem em que a tela as mostra. */
const ABAS = [
  { chave: "identificacao", rotulo: "Identificação" },
  { chave: "geral", rotulo: "Geral" },
  { chave: "destinos", rotulo: "Próximas operações" },
  { chave: "estoque", rotulo: "Estoque" },
  { chave: "financeiro", rotulo: "Financeiro" },
  { chave: "fiscal", rotulo: "Fiscal" },
  { chave: "aprovacao", rotulo: "Aprovação" }
] as const;
type ChaveAba = (typeof ABAS)[number]["chave"];

/** O texto de ajuda de cada seção. Um por aba, cada um explicando o que AQUELA seção decide. */
const AJUDA: Record<ChaveAba, string> = {
  identificacao:
    "Como esta operação é reconhecida: o código que o operador digita, o nome que ele lê e a família do produto que define de que operação se trata. O código e a família são escolhidos na criação e não mudam depois.",
  geral:
    "As regras de preenchimento e de ciclo de vida do documento: quem confirma, o que é obrigatório informar e o que ainda pode ser alterado depois da confirmação.",
  destinos:
    "Para quais operações um documento deste tipo pode ser encaminhado. A lista de opções vem do servidor, já limitada ao que o produto sabe executar; habilitar um caminho aqui não concede permissão a ninguém. Enquanto esta operação não declarar a política, a conversão continua seguindo o caminho anterior do produto.",
  estoque:
    "Se esta operação declara movimentação de estoque e em que sentido, além do que ela exige do operador e do que fazer quando o saldo ficaria negativo.",
  financeiro:
    "Se esta operação declara efeito financeiro, se ele nasce como título firme ou como previsão, e quais dados de cobrança passam a ser obrigatórios.",
  fiscal:
    "Se esta operação é relevante para o fiscal e quais informações fiscais o documento passa a exigir. Nenhum imposto é calculado por esta configuração.",
  aprovacao:
    "Se o documento precisa passar por aprovação antes de ser confirmado e, quando o critério for por valor, a partir de que valor a exigência começa."
};

// ---------------------------------------------------------------------------------------------------
// Campos
// ---------------------------------------------------------------------------------------------------

function CampoEnum<T extends string>({ rotulo, ajuda, valor, opcoes, rotulos, onChange, desabilitado, testId, span = 4 }: {
  rotulo: string; ajuda?: string; valor: T; opcoes: readonly T[]; rotulos: Record<T, string>;
  onChange: (v: T) => void; desabilitado?: boolean; testId: string; span?: number;
}) {
  return <Field label={rotulo} help={ajuda} span={span}>
    <NativeSelect data-testid={testId} value={valor} disabled={desabilitado} onChange={(e) => onChange(e.target.value as T)}>
      {opcoes.map((o) => <option key={o} value={o}>{rotulos[o]}</option>)}
    </NativeSelect>
  </Field>;
}

/** Booleano como escolha explícita de duas opções: "Sim/Não" é menos ambíguo que uma caixa marcada. */
function CampoSimNao({ rotulo, ajuda, valor, onChange, desabilitado, testId, span = 4 }: {
  rotulo: string; ajuda?: string; valor: boolean; onChange: (v: boolean) => void;
  desabilitado?: boolean; testId: string; span?: number;
}) {
  return <Field label={rotulo} help={ajuda} span={span}>
    <NativeSelect data-testid={testId} value={valor ? "true" : "false"} disabled={desabilitado} onChange={(e) => onChange(e.target.value === "true")}>
      <option value="false">Não</option>
      <option value="true">Sim</option>
    </NativeSelect>
  </Field>;
}

/** Cabeçalho de seção com a ajuda própria daquela aba — nunca um texto genérico reaproveitado. */
const Secao = ({ chave, children }: { chave: ChaveAba; children: React.ReactNode }) => <div>
  <p className="mb-3 text-[12px] leading-relaxed text-slate-500">{AJUDA[chave]}</p>
  <div className="grid grid-cols-12 gap-3">{children}</div>
</div>;

/** Dito uma vez, em toda abertura do editor: configurar não é ligar o efeito. */
const AvisoDeVersionamento = () => <p data-testid="top-aviso-versionamento" className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[11.5px] leading-relaxed text-slate-600">
  O que você definir aqui é guardado e versionado: cada gravação cria uma versão nova e as anteriores
  continuam legíveis no histórico. Os efeitos operacionais de estoque, financeiro e fiscal ainda não são
  executados a partir desta configuração — eles serão ligados em uma etapa posterior do produto. Até lá,
  estas escolhas registram a intenção da operação e não alteram o comportamento dos lançamentos.
</p>;

// ---------------------------------------------------------------------------------------------------
// O editor
// ---------------------------------------------------------------------------------------------------

export function EditorTipoOperacao({ id, revisaoConhecida, familias, onFechar, onPronto }: {
  /** Ausente = criação. */
  id?: string;
  /** A revisão que a listagem viu. Vai na gravação para o servidor recusar escrita sobre versão vencida. */
  revisaoConhecida?: number;
  familias: FamiliaTop[];
  onFechar: () => void;
  onPronto: () => void;
}) {
  const edicao = !!id;
  const capacidades = useCapacidadesTop();

  // Na edição o editor precisa do DETALHE (configuração e destinos), que a listagem não traz.
  const detalhe = useQuery<unknown, ApiError>({
    queryKey: ["tipos-operacao", id, "detalhe"],
    queryFn: () => api<unknown>(`/api/admin/tipos-operacao/${id}`),
    enabled: edicao,
    retry: false
  });
  const lido = React.useMemo(() => (detalhe.data === undefined ? null : lerDetalheTop(detalhe.data)), [detalhe.data]);

  if (edicao && detalhe.isPending) {
    return <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }} title="Editar tipo de operação" size="xl" testId="form-tipo-operacao">
      <LoadingState />
    </Dialog>;
  }
  if (edicao && (detalhe.isError || !lido)) {
    return <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }} title="Editar tipo de operação" size="xl" testId="form-tipo-operacao">
      <ErrorState
        error={detalhe.error}
        message={detalhe.error ? undefined : "Este servidor respondeu o tipo de operação em um formato que esta tela não reconhece. A edição está bloqueada para não gravar sobre dados que não foram lidos."}
      />
    </Dialog>;
  }

  return <CorpoDoEditor
    key={id ?? "novo"}
    id={id}
    revisao={lido?.revisao ?? revisaoConhecida}
    detalhe={lido}
    familias={familias}
    capacidades={capacidades}
    onFechar={onFechar}
    onPronto={onPronto}
  />;
}

function CorpoDoEditor({ id, revisao, detalhe, familias, capacidades, onFechar, onPronto }: {
  id?: string;
  revisao?: number;
  detalhe: ReturnType<typeof lerDetalheTop>;
  familias: FamiliaTop[];
  capacidades: EstadoCapacidadesTop;
  onFechar: () => void;
  onPronto: () => void;
}) {
  const edicao = !!id;
  const configuravel = podeConfigurar(capacidades);
  const destinosConfiguraveis = podeConfigurarDestinos(capacidades);
  const limite = limiteDeDestinos(capacidades);

  /**
   * A configuração de partida.
   *
   * Numa API que confirmou o contrato mas devolveu `suportada: false`, o editor avançado fica BLOQUEADO em
   * vez de abrir no neutro: abrir no neutro convidaria a salvar por cima de uma regra que ninguém leu, e o
   * salvar gravaria "nada declarado" onde havia alguma coisa.
   */
  const configuracaoIlegivel = edicao && !!detalhe && detalhe.configuracao !== null && !detalhe.configuracao.suportada;
  const liberado = configuravel && !configuracaoIlegivel;

  /**
   * A LISTA DE DESTINOS NÃO FOI LIDA — e por isso não pode ser reescrita.
   *
   * O servidor declarou que sustenta próximas operações (`capabilities.destinos.suportado`), mas o detalhe
   * não trouxe a lista numa forma reconhecível. Abrir a aba assim mostraria uma lista VAZIA que não é a
   * política — e a gravação seguinte enviaria `[]`, apagando arestas que ninguém viu. É o mesmo erro de
   * ler ausência como vazio que esta correção existe para desfazer, só que do lado do cliente.
   */
  const destinosIlegiveis = edicao && !!detalhe && destinosConfiguraveis && detalhe.destinos === null;

  const inicial = React.useMemo<RascunhoTop>(() => ({
    nome: detalhe?.nome ?? "",
    descricao: detalhe?.descricao ?? "",
    ativo: detalhe?.ativo ?? true,
    padrao: detalhe?.padrao ?? false,
    codigo: detalhe?.codigo ?? "",
    codigoBase: detalhe?.familia.codigo ?? "",
    configuracao: configuracaoInicial(detalhe?.configuracao ?? null),
    destinos: (detalhe?.destinos ?? []).map((d) => ({
      tipoOperacaoId: d.tipoOperacaoId, codigo: d.codigo, nome: d.nome, familiaRotulo: d.familiaRotulo, disponivel: d.disponivel
    })),
    /**
     * SÓ `true` COMEÇA DECLARADO. `false` (legado) e `null` (servidor que não informou) começam como NÃO
     * declarado — e a gravação então OMITE `destinos`, que é o contrato de "preserve o que está lá".
     *
     * O caminho oposto seria começar sempre declarado "porque o editor sabe editar destinos": aí qualquer
     * gravação de nome ou de configuração converteria, de carona, todo registro legado em "declarado sem
     * nenhuma próxima operação" — e a conversão daquela operação pararia de funcionar sem que ninguém
     * tivesse pedido isso, na edição de um campo que nada tem a ver com o assunto.
     */
    destinosDeclarados: detalhe?.destinosConfigurados === true
  }), [detalhe]);

  const [rascunho, setRascunho] = React.useState<RascunhoTop>(inicial);
  const [aba, setAba] = React.useState<ChaveAba>("identificacao");
  const [confirmandoDescarte, setConfirmandoDescarte] = React.useState(false);
  const [erro, setErro] = React.useState<unknown>(null);
  const [conflito, setConflito] = React.useState(false);

  const assinaturaInicial = React.useMemo(() => assinaturaRascunho(inicial), [inicial]);
  const alterado = assinaturaRascunho(rascunho) !== assinaturaInicial;

  const mudar = React.useCallback((p: Partial<RascunhoTop>) => setRascunho((r) => ({ ...r, ...p })), []);
  /** Toda mudança de configuração passa pela normalização do domínio: o rascunho nunca guarda campo pendurado. */
  const mudarConfig = React.useCallback((f: (c: ConfiguracaoTipoOperacaoV1) => ConfiguracaoTipoOperacaoV1) => {
    setRascunho((r) => ({ ...r, configuracao: normalizarConfiguracaoTop(f(r.configuracao)) }));
  }, []);

  const salvar = useMutation({
    mutationFn: () => {
      const base: Record<string, unknown> = {
        nome: rascunho.nome,
        descricao: rascunho.descricao || null,
        ativo: rascunho.ativo,
        padrao: rascunho.padrao
      };
      // NUNCA ÀS CEGAS: sem contrato confirmado, `configuracao` e `destinos` simplesmente não vão no corpo —
      // e a tela já avisou que essas seções estão bloqueadas, então ninguém lê "salvo" sobre elas.
      if (liberado) base.configuracao = rascunho.configuracao;
      /**
       * A PRESENÇA DA CHAVE `destinos` É A DECLARAÇÃO — no servidor e, portanto, aqui.
       *
       *   ausente  preserve o que já estava (arestas E o estado da política). É o que sai daqui quando o
       *            usuário não declarou nada, e é o que mantém intacto o registro legado.
       *   presente declare. `[]` é uma declaração legítima e VAI como `[]`: "esta operação não gera
       *            próxima operação" é uma decisão, não a falta de uma.
       *
       * Por isso a condição é `destinosDeclarados`, e não `destinos.length` — a lista vazia aparece nos
       * dois estados, e é justamente o que ela NÃO consegue distinguir.
       */
      if (liberado && destinosConfiguraveis && !destinosIlegiveis && rascunho.destinosDeclarados) {
        base.destinos = rascunho.destinos.map((d, i) => ({ tipoOperacaoId: d.tipoOperacaoId, ordem: i + 1 }));
      }
      if (edicao) return api(`/api/admin/tipos-operacao/${id}`, { method: "PUT", body: { ...base, revisao } });
      return api("/api/admin/tipos-operacao", {
        method: "POST",
        body: { ...base, codigo: rascunho.codigo, codigoBase: rascunho.codigoBase }
      });
    },
    onSuccess: onPronto,
    onError: (e) => {
      // Conflito otimista NÃO reenvia e NÃO sobrescreve: o servidor já tem uma versão que esta tela não viu.
      if (ehConflitoDeConcorrencia(e)) { setConflito(true); setErro(null); return; }
      setConflito(false);
      setErro(e);
    }
  });

  const porValor = rascunho.configuracao.aprovacao.politica === "por_valor";
  const valorMinimo = rascunho.configuracao.aprovacao.valorMinimo ?? "";
  const valorMinimoOk = !porValor || valorMinimoAceitavel(valorMinimo);
  const valido = rascunho.nome.trim().length > 0
    && (edicao || (rascunho.codigo.trim().length > 0 && rascunho.codigoBase.length > 0))
    && valorMinimoOk;

  const fechar = () => { if (alterado) setConfirmandoDescarte(true); else onFechar(); };

  return <>
    <Dialog
      open
      onOpenChange={(o) => { if (!o) fechar(); }}
      title={edicao ? `Editar tipo de operação ${rascunho.codigo}` : "Novo tipo de operação"}
      description="As alterações são gravadas de uma vez, ao salvar, e criam uma versão nova."
      size="xl"
      testId="form-tipo-operacao"
      footer={<>
        <Button variant="ghost" data-testid="top-cancelar" onClick={fechar}>{COPY.cancelar}</Button>
        <Button data-testid="top-salvar" onClick={() => salvar.mutate()} disabled={!valido} loading={salvar.isPending}>{COPY.salvar}</Button>
      </>}
    >
      <div role="tablist" aria-label="Seções do tipo de operação" className="mb-3 flex flex-wrap gap-1 border-b">
        {ABAS.map((a) => <button
          key={a.chave}
          type="button"
          role="tab"
          aria-selected={aba === a.chave}
          data-testid={`top-aba-${a.chave}`}
          onClick={() => setAba(a.chave)}
          className={cn(
            "border-b-2 px-3 py-1.5 text-xs font-medium",
            aba === a.chave ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-700"
          )}
        >{a.rotulo}</button>)}
      </div>

      {aba !== "identificacao" && !liberado
        ? <BloqueioDeConfiguracao estado={capacidades} ilegivel={configuracaoIlegivel} />
        : null}

      {aba === "identificacao" && <Secao chave="identificacao">
        <Field label="Código" required span={3} help="Identifica a operação para quem lança. Escolhido na criação e permanente depois dela.">
          <Input data-testid="top-campo-codigo" value={rascunho.codigo} readOnly={edicao} disabled={edicao}
            onChange={(e) => mudar({ codigo: e.target.value })} placeholder="2103" />
        </Field>
        <Field label="Nome" required span={9}>
          <Input data-testid="top-campo-nome" value={rascunho.nome} onChange={(e) => mudar({ nome: e.target.value })} placeholder="Venda de gado a prazo" />
        </Field>
        <Field label="Família operacional" required span={6} help="Define qual operação do produto este tipo representa. Não muda depois da criação.">
          {edicao
            ? <Input data-testid="top-campo-familia" value={detalhe ? `${detalhe.familia.rotulo} (${detalhe.familia.codigo})` : ""} readOnly disabled />
            : <NativeSelect data-testid="top-campo-familia" value={rascunho.codigoBase} onChange={(e) => mudar({ codigoBase: e.target.value, destinos: [] })}>
                <option value="">Selecione…</option>
                {familias.map((f) => <option key={f.codigo} value={f.codigo}>{f.rotulo} — {f.codigo}</option>)}
              </NativeSelect>}
        </Field>
        <CampoSimNao rotulo={COPY.situacao} span={3} testId="top-campo-situacao" valor={rascunho.ativo}
          ajuda="Um tipo inativo continua no histórico, mas deixa de ser oferecido em lançamentos novos."
          onChange={(v) => mudar({ ativo: v, padrao: v ? rascunho.padrao : false })} />
        <CampoSimNao rotulo="Padrão da família" span={3} testId="top-campo-padrao" valor={rascunho.padrao} desabilitado={!rascunho.ativo}
          ajuda="No máximo um tipo padrão por família. Ao marcar este, o anterior deixa de ser o padrão."
          onChange={(v) => mudar({ padrao: v })} />
        <Field label="Descrição" span={12}>
          <Textarea data-testid="top-campo-descricao" rows={3} value={rascunho.descricao} onChange={(e) => mudar({ descricao: e.target.value })} />
        </Field>
      </Secao>}

      {aba === "geral" && liberado && <Secao chave="geral">
        <CampoEnum rotulo="Confirmação" testId="top-campo-geral-confirmacao" valor={rascunho.configuracao.geral.confirmacao}
          opcoes={MODOS_CONFIRMACAO} rotulos={ROTULOS_TOP.confirmacao}
          ajuda="Quem dispara a confirmação do documento."
          onChange={(v) => mudarConfig((c) => ({ ...c, geral: { ...c.geral, confirmacao: v } }))} />
        <CampoEnum rotulo="Alteração após confirmar" testId="top-campo-geral-alteracao" valor={rascunho.configuracao.geral.alteracaoAposConfirmacao}
          opcoes={POLITICAS_ALTERACAO} rotulos={ROTULOS_TOP.alteracao}
          ajuda="Se o documento ainda pode ser alterado depois de confirmado."
          onChange={(v) => mudarConfig((c) => ({ ...c, geral: { ...c.geral, alteracaoAposConfirmacao: v } }))} />
        <CampoEnum rotulo="Documento sem itens" testId="top-campo-geral-sem-itens" valor={rascunho.configuracao.geral.documentoSemItens}
          opcoes={POLITICAS_DOCUMENTO_SEM_ITENS} rotulos={ROTULOS_TOP.documentoSemItens}
          ajuda="Se um documento desta operação pode existir sem nenhum item."
          onChange={(v) => mudarConfig((c) => ({ ...c, geral: { ...c.geral, documentoSemItens: v } }))} />
        <CampoSimNao rotulo="Exigir parceiro" testId="top-campo-geral-parceiro" valor={rascunho.configuracao.geral.exigeParceiro}
          onChange={(v) => mudarConfig((c) => ({ ...c, geral: { ...c.geral, exigeParceiro: v } }))} />
        <CampoSimNao rotulo="Exigir centro de resultado" testId="top-campo-geral-centro" valor={rascunho.configuracao.geral.exigeCentroResultado}
          onChange={(v) => mudarConfig((c) => ({ ...c, geral: { ...c.geral, exigeCentroResultado: v } }))} />
        <CampoSimNao rotulo="Exigir observação" testId="top-campo-geral-observacao" valor={rascunho.configuracao.geral.exigeObservacao}
          onChange={(v) => mudarConfig((c) => ({ ...c, geral: { ...c.geral, exigeObservacao: v } }))} />
      </Secao>}

      {aba === "destinos" && liberado && <Secao chave="destinos">
        <div className="col-span-12">
          <AbaDestinos
            codigoBase={rascunho.codigoBase}
            destinos={rascunho.destinos}
            limite={limite}
            habilitado={destinosConfiguraveis}
            ilegivel={destinosIlegiveis}
            declarado={rascunho.destinosDeclarados}
            estadoNoServidor={edicao ? detalhe?.destinosConfigurados ?? null : false}
            // MEXER NA LISTA É DECLARAR. Incluir, remover ou reordenar são a mesma decisão vista de três
            // ângulos: a partir daí existe uma política escrita por alguém, e ela vai no corpo da gravação.
            onChange={(d) => mudar({ destinos: d, destinosDeclarados: true })}
            onDeclarar={() => mudar({ destinosDeclarados: true })}
          />
        </div>
      </Secao>}

      {aba === "estoque" && liberado && <Secao chave="estoque">
        <CampoEnum rotulo="Movimentação" testId="top-campo-estoque-atualizacao" valor={rascunho.configuracao.estoque.atualizacao}
          opcoes={ATUALIZACOES_ESTOQUE} rotulos={ROTULOS_TOP.estoqueAtualizacao}
          ajuda="O sentido do efeito declarado. Sem movimentação, os demais campos desta seção não decidem nada."
          onChange={(v) => mudarConfig((c) => ({ ...c, estoque: { ...c.estoque, atualizacao: v } }))} />
        <CampoEnum rotulo="Momento do efeito" testId="top-campo-estoque-momento" valor={rascunho.configuracao.estoque.momento}
          opcoes={MOMENTOS_EFEITO} rotulos={ROTULOS_TOP.momentoEfeito}
          desabilitado={rascunho.configuracao.estoque.atualizacao === "nenhuma"}
          onChange={(v) => mudarConfig((c) => ({ ...c, estoque: { ...c.estoque, momento: v } }))} />
        <CampoSimNao rotulo="Exigir armazém" testId="top-campo-estoque-armazem" valor={rascunho.configuracao.estoque.exigeArmazem}
          desabilitado={rascunho.configuracao.estoque.atualizacao === "nenhuma"}
          onChange={(v) => mudarConfig((c) => ({ ...c, estoque: { ...c.estoque, exigeArmazem: v } }))} />
        <CampoEnum rotulo="Saldo negativo" testId="top-campo-estoque-saldo" valor={rascunho.configuracao.estoque.saldoNegativo}
          opcoes={POLITICAS_SALDO_NEGATIVO} rotulos={ROTULOS_TOP.saldoNegativo}
          desabilitado={rascunho.configuracao.estoque.atualizacao === "nenhuma"}
          ajuda="O que fazer quando a operação levaria o saldo abaixo de zero."
          onChange={(v) => mudarConfig((c) => ({ ...c, estoque: { ...c.estoque, saldoNegativo: v } }))} />
        {rascunho.configuracao.estoque.atualizacao === "nenhuma" && <AvisoDeSecaoDesligada texto="Sem movimentação declarada, os demais campos de estoque ficam no estado neutro e não são gravados como exigência." />}
      </Secao>}

      {aba === "financeiro" && liberado && <Secao chave="financeiro">
        <CampoEnum rotulo="Efeito financeiro" testId="top-campo-financeiro-atualizacao" valor={rascunho.configuracao.financeiro.atualizacao}
          opcoes={ATUALIZACOES_FINANCEIRO} rotulos={ROTULOS_TOP.financeiroAtualizacao}
          ajuda="O sentido do efeito declarado. Sem efeito, os demais campos desta seção não decidem nada."
          onChange={(v) => mudarConfig((c) => ({ ...c, financeiro: { ...c.financeiro, atualizacao: v } }))} />
        <CampoEnum rotulo="Forma do lançamento" testId="top-campo-financeiro-modo" valor={rascunho.configuracao.financeiro.modo}
          opcoes={MODOS_FINANCEIRO} rotulos={ROTULOS_TOP.financeiroModo}
          desabilitado={rascunho.configuracao.financeiro.atualizacao === "nenhuma"}
          ajuda="Título firme compõe o saldo realizado; previsão não."
          onChange={(v) => mudarConfig((c) => ({ ...c, financeiro: { ...c.financeiro, modo: v } }))} />
        <CampoEnum rotulo="Momento do efeito" testId="top-campo-financeiro-momento" valor={rascunho.configuracao.financeiro.momento}
          opcoes={MOMENTOS_EFEITO} rotulos={ROTULOS_TOP.momentoEfeito}
          desabilitado={rascunho.configuracao.financeiro.atualizacao === "nenhuma"}
          onChange={(v) => mudarConfig((c) => ({ ...c, financeiro: { ...c.financeiro, momento: v } }))} />
        <CampoSimNao rotulo="Exigir forma de pagamento" testId="top-campo-financeiro-forma" valor={rascunho.configuracao.financeiro.exigeFormaPagamento}
          desabilitado={rascunho.configuracao.financeiro.atualizacao === "nenhuma"}
          onChange={(v) => mudarConfig((c) => ({ ...c, financeiro: { ...c.financeiro, exigeFormaPagamento: v } }))} />
        <CampoSimNao rotulo="Exigir vencimento" testId="top-campo-financeiro-vencimento" valor={rascunho.configuracao.financeiro.exigeVencimento}
          desabilitado={rascunho.configuracao.financeiro.atualizacao === "nenhuma"}
          onChange={(v) => mudarConfig((c) => ({ ...c, financeiro: { ...c.financeiro, exigeVencimento: v } }))} />
        <CampoSimNao rotulo="Exigir centro de resultado" testId="top-campo-financeiro-centro" valor={rascunho.configuracao.financeiro.exigeCentroResultado}
          desabilitado={rascunho.configuracao.financeiro.atualizacao === "nenhuma"}
          onChange={(v) => mudarConfig((c) => ({ ...c, financeiro: { ...c.financeiro, exigeCentroResultado: v } }))} />
        {rascunho.configuracao.financeiro.atualizacao === "nenhuma" && <AvisoDeSecaoDesligada texto="Sem efeito financeiro declarado, os demais campos desta seção ficam no estado neutro e não são gravados como exigência." />}
      </Secao>}

      {aba === "fiscal" && liberado && <Secao chave="fiscal">
        <CampoSimNao rotulo="Relevante para o fiscal" testId="top-campo-fiscal-habilitado" valor={rascunho.configuracao.fiscal.habilitado}
          ajuda="Desligado, os demais campos desta seção não decidem nada."
          onChange={(v) => mudarConfig((c) => ({ ...c, fiscal: { ...c.fiscal, habilitado: v } }))} />
        <CampoSimNao rotulo="Exigir documento fiscal" testId="top-campo-fiscal-documento" valor={rascunho.configuracao.fiscal.exigeDocumentoFiscal}
          desabilitado={!rascunho.configuracao.fiscal.habilitado}
          onChange={(v) => mudarConfig((c) => ({ ...c, fiscal: { ...c.fiscal, exigeDocumentoFiscal: v } }))} />
        <CampoSimNao rotulo="Exigir natureza da operação" testId="top-campo-fiscal-natureza" valor={rascunho.configuracao.fiscal.exigeNaturezaOperacao}
          desabilitado={!rascunho.configuracao.fiscal.habilitado}
          onChange={(v) => mudarConfig((c) => ({ ...c, fiscal: { ...c.fiscal, exigeNaturezaOperacao: v } }))} />
        <CampoSimNao rotulo="Exigir regra tributária" testId="top-campo-fiscal-regra" valor={rascunho.configuracao.fiscal.exigeRegraTributaria}
          desabilitado={!rascunho.configuracao.fiscal.habilitado}
          onChange={(v) => mudarConfig((c) => ({ ...c, fiscal: { ...c.fiscal, exigeRegraTributaria: v } }))} />
        <CampoEnum rotulo="Cálculo de tributos" testId="top-campo-fiscal-calculo" valor={rascunho.configuracao.fiscal.calculoTributario}
          opcoes={CALCULOS_TRIBUTARIOS} rotulos={ROTULOS_TOP.calculoTributario}
          desabilitado={!rascunho.configuracao.fiscal.habilitado}
          ajuda="Declara a intenção. Nenhum tributo é calculado por esta configuração."
          onChange={(v) => mudarConfig((c) => ({ ...c, fiscal: { ...c.fiscal, calculoTributario: v } }))} />
        {!rascunho.configuracao.fiscal.habilitado && <AvisoDeSecaoDesligada texto="Com o fiscal desligado, os demais campos desta seção ficam no estado neutro e não são gravados como exigência." />}
      </Secao>}

      {aba === "aprovacao" && liberado && <Secao chave="aprovacao">
        <CampoEnum rotulo="Critério de aprovação" testId="top-campo-aprovacao-politica" valor={rascunho.configuracao.aprovacao.politica}
          opcoes={POLITICAS_APROVACAO} rotulos={ROTULOS_TOP.aprovacaoPolitica}
          ajuda="Quando o documento precisa passar por aprovação."
          onChange={(v) => mudarConfig((c) => ({
            ...c,
            // Ao passar para "a partir de um valor", o campo nasce vazio e obrigatório: herdar um valor
            // antigo faria a regra entrar em vigor com um limite que ninguém confirmou nesta edição.
            aprovacao: { ...c.aprovacao, politica: v, valorMinimo: v === "por_valor" ? (c.aprovacao.valorMinimo ?? "") : null }
          }))} />
        <Field label="Valor mínimo" required={porValor} span={4}
          help="Valor a partir do qual a aprovação passa a ser exigida. Use ponto como separador decimal."
          error={porValor && valorMinimo.length > 0 && !valorMinimoAceitavel(valorMinimo) ? "Informe um valor maior que zero, com até duas casas decimais." : undefined}>
          <Input data-testid="top-campo-aprovacao-valor" inputMode="decimal" placeholder="0.00"
            value={valorMinimo} disabled={!porValor}
            onChange={(e) => mudarConfig((c) => ({ ...c, aprovacao: { ...c.aprovacao, valorMinimo: e.target.value } }))} />
        </Field>
        <CampoEnum rotulo="Momento da aprovação" testId="top-campo-aprovacao-momento" valor={rascunho.configuracao.aprovacao.momento}
          opcoes={MOMENTOS_APROVACAO} rotulos={ROTULOS_TOP.momentoAprovacao}
          desabilitado={rascunho.configuracao.aprovacao.politica === "nenhuma"}
          onChange={(v) => mudarConfig((c) => ({ ...c, aprovacao: { ...c.aprovacao, momento: v } }))} />
        {rascunho.configuracao.aprovacao.politica === "nenhuma" && <AvisoDeSecaoDesligada texto="Sem critério de aprovação, o valor mínimo fica zerado e não é gravado." />}
      </Secao>}

      {conflito && <p data-testid="top-conflito" className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
        Este tipo de operação foi alterado por outra pessoa enquanto você editava. Nada foi gravado, para
        não apagar o trabalho de ninguém. Feche esta janela, abra o registro de novo e refaça as alterações
        sobre a versão atual.
      </p>}
      {erro ? <div className="mt-3"><ErrorState error={erro} /></div> : null}

      <AvisoDeVersionamento />
    </Dialog>

    <ConfirmDialog
      open={confirmandoDescarte}
      onOpenChange={setConfirmandoDescarte}
      title="Descartar alterações"
      confirmLabel="Descartar"
      danger
      onConfirm={() => { setConfirmandoDescarte(false); onFechar(); }}
    >
      <p data-testid="top-descartar-confirmacao" className="text-sm text-slate-600">
        Há alterações que ainda não foram salvas neste tipo de operação. Ao fechar, elas são perdidas e
        nenhuma versão nova é criada.
      </p>
    </ConfirmDialog>
  </>;
}

const AvisoDeSecaoDesligada = ({ texto }: { texto: string }) => <p className="col-span-12 text-[11.5px] text-slate-500">{texto}</p>;

/** Por que as seções de operação estão bloqueadas. Cada causa tem a sua frase — nunca uma genérica. */
function BloqueioDeConfiguracao({ estado, ilegivel }: { estado: EstadoCapacidadesTop; ilegivel: boolean }) {
  if (estado.situacao === "carregando") return <LoadingState variant="compact" />;
  if (ilegivel && estado.situacao === "pronto") {
    return <p data-testid="top-config-ilegivel" className="text-[12px] text-amber-700">
      A versão atual deste tipo de operação foi gravada em um formato que esta tela não sabe interpretar.
      As seções de operação estão bloqueadas para não substituir a regra existente por valores que não
      foram lidos. O nome, a situação e a descrição continuam editáveis na aba de identificação.
    </p>;
  }
  return <MensagemCapacidadesTop estado={estado} />;
}

// ---------------------------------------------------------------------------------------------------
// Próximas operações
// ---------------------------------------------------------------------------------------------------

/**
 * O grafo de destinos desta versão.
 *
 * A LISTA DE OPÇÕES VEM DO SERVIDOR, sempre. Ele já recorta por tenant, situação, exclusão e compatibilidade
 * de família; refazer esse recorte aqui seria uma segunda cópia das regras do grafo, que envelheceria em
 * silêncio na primeira família nova — e uma tela que decide compatibilidade vira autoridade de coisa que
 * não é dela.
 *
 * ┌─ DOIS ESTADOS QUE A LISTA VAZIA NÃO DISTINGUE (correção R1) ───────────────────────────────────────┐
 * │ "Nenhum destino" é a mesma tela para duas realidades OPOSTAS:                                      │
 * │                                                                                                     │
 * │   POLÍTICA NÃO DECLARADA  ninguém respondeu à pergunta. A conversão segue o caminho anterior do     │
 * │                           produto, e é isso que o operador vê acontecer no documento.               │
 * │   POLÍTICA DECLARADA VAZIA alguém respondeu "esta operação não gera nada". A conversão é recusada.  │
 * │                                                                                                     │
 * │ São frases diferentes porque quem lê precisa decidir coisas diferentes: no primeiro caso falta      │
 * │ configurar; no segundo, está configurado. Uma frase só para os dois faria o administrador "corrigir"│
 * │ uma decisão que já estava certa — ou deixar sem política uma operação que ele achou configurada.    │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
function AbaDestinos({ codigoBase, destinos, limite, habilitado, ilegivel, declarado, estadoNoServidor, onChange, onDeclarar }: {
  codigoBase: string;
  destinos: DestinoEmEdicao[];
  limite: number;
  habilitado: boolean;
  /** O servidor sustenta destinos, mas o detalhe não trouxe a lista de forma legível: bloqueia. */
  ilegivel: boolean;
  /** Este RASCUNHO declara a política? É o que decide se `destinos` vai no corpo da gravação. */
  declarado: boolean;
  /** O que a versão GRAVADA diz: `true`/`false` declarados pelo servidor, `null` quando ele não informou. */
  estadoNoServidor: boolean | null;
  onChange: (d: DestinoEmEdicao[]) => void;
  onDeclarar: () => void;
}) {
  const { itens, carregando, erro } = useDestinosPossiveis(codigoBase, habilitado && !ilegivel);
  const [escolhido, setEscolhido] = React.useState("");

  if (!habilitado) {
    return <p data-testid="top-destinos-nao-suportado" className="text-[12px] text-amber-700">
      Este servidor não confirmou o recurso de próximas operações. A seção está bloqueada e nenhuma
      alteração de encadeamento é enviada ao salvar; as demais seções continuam funcionando.
    </p>;
  }
  if (ilegivel) {
    return <p data-testid="top-destinos-ilegiveis" className="text-[12px] text-amber-700">
      Este servidor não devolveu as próximas operações desta versão em um formato que esta tela reconhece.
      A seção está bloqueada e nada de encadeamento é enviado ao salvar, para não apagar caminhos que não
      chegaram a ser lidos. As demais seções continuam funcionando.
    </p>;
  }
  if (!codigoBase) {
    return <p className="text-[12px] text-slate-500">Escolha a família operacional na aba de identificação para ver os destinos possíveis.</p>;
  }
  if (carregando) return <LoadingState variant="compact" />;
  if (erro) return <ErrorState error={erro} />;
  if (itens === null) {
    return <p data-testid="top-destinos-nao-confirmado" className="text-[12px] text-amber-700">
      Este servidor respondeu a lista de destinos em um formato que esta tela não reconhece. A seção está
      bloqueada para não gravar um encadeamento que não foi lido.
    </p>;
  }

  const jaEscolhidos = new Set(destinos.map((d) => d.tipoOperacaoId));
  const disponiveis = itens.filter((i) => !jaEscolhidos.has(i.id));
  const noLimite = destinos.length >= limite;

  const adicionar = () => {
    const alvo = itens.find((i) => i.id === escolhido);
    if (!alvo || jaEscolhidos.has(alvo.id) || noLimite) return;
    onChange([...destinos, { tipoOperacaoId: alvo.id, codigo: alvo.codigo, nome: alvo.nome, familiaRotulo: alvo.familiaRotulo }]);
    setEscolhido("");
  };
  const remover = (idAlvo: string) => onChange(destinos.filter((d) => d.tipoOperacaoId !== idAlvo));
  const mover = (i: number, passo: number) => {
    const j = i + passo;
    if (j < 0 || j >= destinos.length) return;
    const copia = [...destinos];
    const [item] = copia.splice(i, 1);
    if (item) copia.splice(j, 0, item);
    onChange(copia);
  };

  return <div data-testid="top-destinos">
    <EstadoDaPolitica declarado={declarado} estadoNoServidor={estadoNoServidor} vazio={destinos.length === 0} onDeclarar={onDeclarar} />

    <div className="mb-3 flex flex-wrap items-center gap-2">
      <NativeSelect aria-label="Operação de destino" className="w-80" data-testid="top-destino-escolha"
        value={escolhido} disabled={disponiveis.length === 0 || noLimite} onChange={(e) => setEscolhido(e.target.value)}>
        <option value="">Selecione…</option>
        {disponiveis.map((i) => <option key={i.id} value={i.id}>{i.codigo} — {i.nome} ({i.familiaRotulo})</option>)}
      </NativeSelect>
      <Button size="sm" variant="outline" data-testid="top-destino-adicionar" disabled={!escolhido || noLimite} onClick={adicionar}>
        Adicionar destino
      </Button>
      <span className="text-[11px] text-slate-500">{destinos.length} de {limite}</span>
    </div>

    {/* A LISTA SÓ APARECE QUANDO EXISTE. O que "nenhum destino" significa é decidido acima, por
        `EstadoDaPolitica` — e não por esta ausência de linhas, que é igual nos dois estados. */}
    {destinos.length > 0
      && <ul className="divide-y rounded border">
          {destinos.map((d, i) => <li key={d.tipoOperacaoId} data-testid="top-destino-linha" className="flex items-center gap-2 px-2 py-1.5 text-[12.5px]">
            <span className="w-6 text-right tabular-nums text-slate-400">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{d.codigo} — {d.nome}</span>
              <span className="ml-2 text-[11px] text-slate-400">{d.familiaRotulo}</span>
            </span>
            {d.disponivel === false && <Badge tone="amber">Indisponível hoje</Badge>}
            <Button size="sm" variant="ghost" aria-label="Subir" disabled={i === 0} onClick={() => mover(i, -1)}>↑</Button>
            <Button size="sm" variant="ghost" aria-label="Descer" disabled={i === destinos.length - 1} onClick={() => mover(i, 1)}>↓</Button>
            <Button size="sm" variant="ghost" data-testid="top-destino-remover" aria-label={COPY.remover} onClick={() => remover(d.tipoOperacaoId)}>✕</Button>
          </li>)}
        </ul>}

    <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500">
      Um destino marcado como indisponível continua gravado nesta versão, mas o produto não o oferece hoje —
      normalmente porque o tipo de operação de destino foi desativado. Habilitar um destino aqui não dá
      permissão a ninguém: quem pode criar o documento seguinte continua sendo decidido pelas permissões.
    </p>
  </div>;
}

/**
 * O ESTADO DA POLÍTICA, DITO COM TODAS AS LETRAS — nunca deduzido do tamanho da lista.
 *
 * Três saídas, e a terceira é o silêncio: com política declarada E destinos na tela, a própria lista já
 * responde a pergunta e uma frase extra seria ruído. As duas primeiras existem justamente porque a lista
 * vazia não responde nada sozinha.
 */
function EstadoDaPolitica({ declarado, estadoNoServidor, vazio, onDeclarar }: {
  declarado: boolean;
  estadoNoServidor: boolean | null;
  vazio: boolean;
  onDeclarar: () => void;
}) {
  // O SERVIDOR NÃO DISSE, ENTÃO A TELA NÃO AFIRMA. Dizer "ainda não declarou" aqui seria inventar uma
  // resposta em nome de quem não respondeu — o mesmo defeito, do lado do cliente.
  if (!declarado && estadoNoServidor === null) {
    return <p data-testid="top-destinos-estado-desconhecido" className="mb-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-600">
      Este servidor não informou se esta operação já declarou uma política de próximas operações. A lista
      abaixo é o que ele devolveu; enquanto nada for alterado nesta aba, a gravação não toca no encadeamento.
    </p>;
  }
  if (!declarado) {
    return <div data-testid="top-destinos-politica-nao-declarada" className="mb-3 space-y-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
      <p>
        Esta operação ainda não declarou uma política de próximas operações. Por compatibilidade, um
        documento deste tipo continua sendo encaminhado pelo caminho anterior do produto — comportamento
        herdado, e não uma decisão registrada aqui.
      </p>
      <p>
        Adicione um destino abaixo para dizer para onde esta operação encaminha, ou registre que ela não
        encaminha para lugar nenhum.
      </p>
      <Button size="sm" variant="outline" data-testid="top-destinos-declarar" onClick={onDeclarar}>
        Declarar que não há próxima operação
      </Button>
    </div>;
  }
  if (vazio) {
    return <p data-testid="top-destinos-politica-vazia" className="mb-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-700">
      Política declarada: esta operação não gera nenhuma próxima operação. Ao salvar, um documento deste
      tipo deixa de oferecer conversão, e uma conversão pedida fora desta tela é recusada pelo servidor.
    </p>;
  }
  return null;
}
