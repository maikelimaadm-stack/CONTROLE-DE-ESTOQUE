"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { EXIGENCIAS_GERAIS_DOS_MODULOS_TOP } from "@agro/domain";
import { brl, todayISO } from "@/lib/utils";
import { enumLabel } from "@/lib/copy";
import { StatusBadge, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { useEmpresaPadrao, type ItemRow, type Row } from "@/features/docs/shared";
import { CampoDaCentral, CampoLeitura, ColunaDeCampos, DataDaCentral } from "@/features/central/campo";
import { CampoDoLocalPadrao, useLocalDoCabecalho } from "@/features/central/local-padrao";
import { CentralDoModulo, errosDoServidor, pendenciaDaExigencia, useAtualizarDoModulo, useSalvarDoModulo, type Pendencia } from "@/features/modulos/central-do-modulo";
import { ItensDoModulo } from "@/features/modulos/itens-do-modulo";
import { CampoTopDoModulo, camposExigidosDaTop, useEscolhaDaTopDoModulo, useTopDoModulo, type TopDoModulo } from "@/features/modulos/top-do-modulo";
import {
  CabecalhoDoBloco, GradeDaSecao, PEDACO_DO_TESTID, corpoDasLinhas, decimal, secoesDoDocumento, secoesVazias, totaisDaOs,
  type SecaoDoMotor, type SecoesDaOs
} from "./blocos-os";

/**
 * A CENTRAL DA ORDEM DE SERVIÇO (OPERACOES-01 F10, decisão 287) — a criação (`/os/new`) e a EDIÇÃO (`/os/<id>/editar`).
 *
 * A moldura do motor com a regra de SEMPRE da OS: os Insumos e os EPIs são a grade do motor (o Local de estoque antes
 * do produto; o "Local de estoque" do cabeçalho preenche as linhas novas e nunca vai ao corpo) e saem do estoque só ao
 * FINALIZAR a OS; Mão de obra, Equipamentos e Produção são grades próprias (`blocos-os.tsx`). O corpo é o de antes
 * (`lines[]` com `section`).
 *
 * A EDIÇÃO usa o PUT de sempre (`/api/service-orders/:id`), aberto enquanto a OS está aberta ou em andamento: o MESMO
 * corpo da criação, SEM `tipo_operacao_id` — a TOP da OS não muda depois do lançamento (o servidor recusa a chave). A
 * empresa fica travada. Com a OS fora de aberta/em andamento, o aviso diz a situação e o Salvar fica desabilitado.
 *
 * A TOP só na CRIAÇÃO e só com a capacidade `topNoModulo` da API (`useTopDoModulo`): sem ela, nem o campo nem a chave.
 * Ela pode exigir o centro de resultado e a descrição (as exigências que o registro da OS tem): a pendência aparece
 * antes de enviar, com o texto da recusa do servidor. Na edição, quem cobra as exigências da versão CONGELADA na OS é o
 * servidor (a recusa volta para o campo).
 */

const PREFIXO = "central-os";

interface Cabecalho {
  empresa_id: string; order_date: string; harvest_id: string; activity_id: string; operation_id: string; cost_center_id: string;
  responsible_person_id: string; team_id: string; description: string; planned_start: string; planned_end: string;
}
const cabecalhoVazio = (): Cabecalho => ({
  empresa_id: "", order_date: todayISO(), harvest_id: "", activity_id: "", operation_id: "", cost_center_id: "", responsible_person_id: "",
  team_id: "", description: "", planned_start: "", planned_end: ""
});
const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const data = (v: unknown) => texto(v).slice(0, 10);

/** O detalhe da OS (`GET /api/service-orders/:id`) com as linhas. */
export type DocumentoDaOs = Row & { lines: Row[] };

/** As chaves do cabeçalho no corpo (POST e PUT): vazio vai como `null`. */
const corpoDoCabecalho = (h: Cabecalho) => ({
  empresa_id: h.empresa_id, order_date: h.order_date, harvest_id: h.harvest_id || null, activity_id: h.activity_id || null,
  operation_id: h.operation_id || null, cost_center_id: h.cost_center_id || null, responsible_person_id: h.responsible_person_id || null,
  team_id: h.team_id || null, description: h.description || null, planned_start: h.planned_start || null, planned_end: h.planned_end || null
});

/** O controle focável dentro de um elemento (o primeiro botão, campo, seleção ou texto habilitado). */
const controleEm = (raiz: Element | null | undefined) =>
  raiz?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)") ?? null;
const semMarca = (t: string) => t.replace(/[*:]/g, "").replace(/\s+/g, " ").trim();

/** Levar à pendência: a de Insumos/EPIs vai à grade da seção; as outras, ao campo pelo rótulo. */
function irParaPendencia(p: Pendencia) {
  const central = document.querySelector<HTMLElement>(`[data-testid="${PREFIXO}"]`);
  if (!central) return;
  const m = /^items\.(input|ppe)\./.exec(p.caminho);
  const alvo = m
    ? controleEm(central.querySelector(`[data-testid="${PREFIXO}-${PEDACO_DO_TESTID[m[1] === "ppe" ? "ppe" : "input"]}-itens-corpo"]`))
    : controleEm([...central.querySelectorAll("label")].find((l) => semMarca(l.textContent ?? "") === semMarca(p.rotulo))?.parentElement);
  if (!alvo) return;
  alvo.scrollIntoView({ block: "nearest" });
  alvo.focus();
}

/** O Salvar que a Central recebe (o POST da criação ou o PUT da edição). */
interface SalvarDaOs { mutate: (corpo: unknown) => void; isPending: boolean; error: unknown }

interface PropsDoFormulario {
  nome: string;
  situacao?: React.ReactNode;
  aviso?: React.ReactNode;
  inicial: { cabecalho: Cabecalho; secoes: SecoesDaOs; proximaChave: number };
  edicao: { documento: DocumentoDaOs; editavel: boolean } | null;
  /** A TOP da criação (na edição, `null`: a TOP não muda e o campo é só leitura). */
  top: { lido: TopDoModulo; valor: string; escolher: (id: string) => void; idParaEnviar: string | null } | null;
  salvar: SalvarDaOs;
  rotaDaLista: string;
}

function FormularioDaOs({ nome, situacao, aviso, inicial, edicao, top, salvar, rotaDaLista }: PropsDoFormulario) {
  const empresaPadrao = useEmpresaPadrao();
  const [h, setH] = React.useState<Cabecalho>(inicial.cabecalho);
  const [s, setS] = React.useState<SecoesDaOs>(inicial.secoes);
  const proxima = React.useRef(inicial.proximaChave);
  const novaChave = React.useCallback(() => proxima.current++, []);
  const [alterado, setAlterado] = React.useState(false);
  React.useEffect(() => { if (!edicao) setH((o) => ({ ...o, empresa_id: o.empresa_id || empresaPadrao })); }, [empresaPadrao, edicao]);
  const local = useLocalDoCabecalho(null, h.empresa_id);

  const exigidos = top ? camposExigidosDaTop(top.lido, top.valor) : [];
  const exige = (campo: string) => exigidos.includes(campo);
  const doServidor = errosDoServidor(salvar.error);

  const mudar = (p: Partial<Cabecalho>) => { setH((o) => ({ ...o, ...p })); setAlterado(true); };
  const mudarSecao = <K extends keyof SecoesDaOs>(k: K, v: SecoesDaOs[K]) => { setS((o) => ({ ...o, [k]: v })); setAlterado(true); };
  const totais = totaisDaOs(s);

  const pendencias: Pendencia[] = [];
  if (!h.empresa_id) pendencias.push({ caminho: "empresa_id", rotulo: "Empresa", mensagem: "Informe a empresa." });
  if (!h.order_date) pendencias.push({ caminho: "order_date", rotulo: "Data", mensagem: "Informe a data." });
  // Insumos e EPIs: a grade do motor marca Produto e Quantidade como obrigatórios — a pendência diz o mesmo
  for (const secao of ["input", "ppe"] as const) {
    const rotulo = enumLabel("os_section", secao);
    s[secao].forEach((it, k) => {
      if (!it.product_id) pendencias.push({ caminho: `items.${secao}.${k}.produto`, rotulo, mensagem: `${rotulo}, item ${k + 1}: informe o produto.` });
      if (!decimal(it.quantity).gt(0)) pendencias.push({ caminho: `items.${secao}.${k}.quantidade`, rotulo, mensagem: `${rotulo}, item ${k + 1}: informe a quantidade.` });
    });
  }
  const valorDoCampo: Readonly<Record<string, string>> = { cost_center_id: h.cost_center_id, description: h.description.trim() };
  for (const x of EXIGENCIAS_GERAIS_DOS_MODULOS_TOP.ordem_servico) {
    if (exige(x.caminho) && !valorDoCampo[x.caminho]) pendencias.push({ caminho: x.caminho, rotulo: x.rotulo, mensagem: pendenciaDaExigencia(x.rotulo) });
  }

  const enviar = () => salvar.mutate({
    ...corpoDoCabecalho(h),
    lines: corpoDasLinhas(s),
    // só na criação e só com a capacidade: a API anterior descartaria a chave, e a edição nunca a manda
    ...(top && top.lido.estado === "pronto" ? { tipo_operacao_id: top.idParaEnviar } : {})
  });

  const ref = (rotulo: string, campo: keyof Cabecalho, recurso: string, o: { filtro?: Record<string, string>; dica?: unknown; obrigatorio?: boolean } = {}) =>
    <CampoDaCentral rotulo={rotulo} obrigatorio={o.obrigatorio} icone="pesquisa" preenchido={Boolean(h[campo])} erro={doServidor[campo]} testId={`${PREFIXO}-${campo}`}
      data-exigido-top={o.obrigatorio && top ? "true" : undefined}>
      <RefSelect resource={recurso} value={h[campo]} filter={o.filtro} labelHint={typeof o.dica === "string" && o.dica ? o.dica : undefined} onChange={(v) => mudar({ [campo]: v ?? "" })} />
    </CampoDaCentral>;
  const dataOpcional = (rotulo: string, campo: "planned_start" | "planned_end") =>
    <CampoDaCentral rotulo={rotulo} icone="data" preenchido={Boolean(h[campo])} erro={doServidor[campo]} testId={`${PREFIXO}-${campo}`}>
      <DataDaCentral rotulo={rotulo} value={h[campo]} onChange={(v) => mudar({ [campo]: v })} />
    </CampoDaCentral>;
  const doc = edicao?.documento;
  /** Na edição, a TOP gravada (só com a API que devolve a chave): o nome, ou "Sem tipo de operação". */
  const topGravada = doc && Object.hasOwn(doc, "tipo_operacao_nome")
    ? <CampoLeitura rotulo="Tipo de operação" adorno="travado" testId={`${PREFIXO}-top-gravada`}
      valor={typeof doc["tipo_operacao_nome"] === "string" && doc["tipo_operacao_nome"] ? doc["tipo_operacao_nome"] : "Sem tipo de operação"} />
    : null;

  const dados = <ColunaDeCampos>
    <CampoDaCentral rotulo="Empresa" obrigatorio icone="pesquisa" preenchido={Boolean(h.empresa_id)} estado={edicao ? "desabilitado" : "editavel"} erro={doServidor["empresa_id"]} testId={`${PREFIXO}-empresa`}>
      <RefSelect resource="empresas" value={h.empresa_id} disabled={edicao ? true : undefined} onChange={(v) => mudar({ empresa_id: v ?? "" })} />
    </CampoDaCentral>
    <CampoDaCentral rotulo="Data" obrigatorio icone="data" preenchido={Boolean(h.order_date)} erro={doServidor["order_date"]} testId={`${PREFIXO}-data`}>
      <DataDaCentral rotulo="Data" value={h.order_date} onChange={(v) => mudar({ order_date: v })} />
    </CampoDaCentral>
    {top && <CampoTopDoModulo prefixoTestid={PREFIXO} top={top.lido} valor={top.valor} onChange={(id) => { top.escolher(id); setAlterado(true); }} />}
    {topGravada}
    {ref("Safra", "harvest_id", "harvests")}
    {ref("Atividade", "activity_id", "activities", { dica: doc?.["activity_name"] })}
    {ref("Operação", "operation_id", "operations", { dica: doc?.["operation_name"] })}
    {ref("Centro de resultado", "cost_center_id", "cost_centers", { filtro: { kind: "analytic" }, dica: doc?.["cost_center_name"], obrigatorio: exige("cost_center_id") })}
    {ref("Responsável", "responsible_person_id", "people", { filtro: { is_employee: "true" }, dica: doc?.["responsible_name"] })}
    {ref("Equipe", "team_id", "teams", { dica: doc?.["team_name"] })}
    {dataOpcional("Início previsto", "planned_start")}
    {dataOpcional("Término previsto", "planned_end")}
    <CampoDaCentral rotulo="Descrição" obrigatorio={exige("description")} multilinha preenchido={Boolean(h.description)} erro={doServidor["description"]} testId={`${PREFIXO}-descricao`}
      data-exigido-top={exige("description") ? "true" : undefined}>
      <Textarea value={h.description} onChange={(e) => mudar({ description: e.target.value })} />
    </CampoDaCentral>
    <CampoDoLocalPadrao prefixoTestid={PREFIXO} empresaId={h.empresa_id} valor={local.local} onChange={local.escolher} />
  </ColunaDeCampos>;

  const gradeDoMotor = (secao: SecaoDoMotor) => <section className="flex flex-col gap-2" aria-label={enumLabel("os_section", secao)}>
    <CabecalhoDoBloco secao={secao} />
    <div className="flex h-[200px] min-h-0 flex-col rounded border border-slate-100">
      <ItensDoModulo prefixoTestid={`${PREFIXO}-${PEDACO_DO_TESTID[secao]}`} items={s[secao]} onChange={(v: ItemRow[]) => mudarSecao(secao, v)} armazemPadrao={local.local} />
    </div>
  </section>;
  const itens = <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-3" data-testid={`${PREFIXO}-blocos`}>
    <GradeDaSecao secao="labor" linhas={s.labor} onChange={(v) => mudarSecao("labor", v)} novaChave={novaChave} />
    <GradeDaSecao secao="machine" linhas={s.machine} onChange={(v) => mudarSecao("machine", v)} novaChave={novaChave} />
    {gradeDoMotor("input")}
    {gradeDoMotor("ppe")}
    <GradeDaSecao secao="production" linhas={s.production} onChange={(v) => mudarSecao("production", v)} novaChave={novaChave} />
  </div>;

  return <CentralDoModulo
    prefixoTestid={PREFIXO}
    titulo={nome}
    nome={nome}
    situacao={situacao}
    aviso={aviso}
    alterado={alterado}
    pendencias={pendencias}
    salvando={salvar.isPending}
    podeSalvar={edicao ? edicao.editavel : top?.lido.estado !== "carregando"}
    onSalvar={enviar}
    rotaDaLista={rotaDaLista}
    onIrParaPendencia={irParaPendencia}
    dados={dados}
    itens={itens}
    resumo={<>
      <CampoLeitura rotulo="Mão de obra" adorno="travado" testId={`${PREFIXO}-total-mao-de-obra`} valor={brl(totais.maoDeObra)} />
      <CampoLeitura rotulo="Equipamentos" adorno="travado" testId={`${PREFIXO}-total-equipamentos`} valor={brl(totais.equipamentos)} />
      <CampoLeitura rotulo="Insumos" adorno="travado" testId={`${PREFIXO}-total-insumos`} valor={brl(totais.insumos)} />
      <CampoLeitura rotulo="Total" adorno="travado" testId={`${PREFIXO}-total`} valor={brl(totais.total)} />
      <p className="text-[11.5px] text-slate-500" data-testid={`${PREFIXO}-regra`}>Insumos e EPIs com local de estoque saem do estoque ao finalizar a OS.</p>
    </>}
  />;
}

/** A criação: `/os/new`. Depois de salvar, o detalhe da OS (como antes). */
export function NovaOrdemDeServico() {
  const router = useRouter();
  const top = useTopDoModulo("ordem_servico");
  const escolha = useEscolhaDaTopDoModulo(top);
  const salvar = useSalvarDoModulo<{ id: string }>("/api/service-orders", (r) => router.push(`/os/${r.id}`));
  const [inicial] = React.useState(() => ({ cabecalho: cabecalhoVazio(), secoes: secoesVazias(), proximaChave: 1 }));
  return <FormularioDaOs nome="Nova ordem de serviço" inicial={inicial} edicao={null}
    top={{ lido: top, valor: escolha.valor, escolher: escolha.escolher, idParaEnviar: escolha.idParaEnviar }}
    salvar={salvar} rotaDaLista="/os" />;
}

/** As situações em que a OS ainda se edita (as mesmas do PUT). */
const EDITAVEIS = new Set(["open", "in_progress"]);

/** A edição: `/os/<id>/editar`, a partir do detalhe já lido. Depois de salvar, o detalhe da OS. */
export function EdicaoDaOrdemDeServico({ documento }: { documento: DocumentoDaOs }) {
  const router = useRouter();
  const id = texto(documento["id"]);
  const status = texto(documento["status"]);
  const editavel = EDITAVEIS.has(status);
  const salvar = useAtualizarDoModulo(`/api/service-orders/${id}`, () => router.push(`/os/${id}`));
  const [inicial] = React.useState(() => {
    let chave = 1;
    const cabecalho: Cabecalho = {
      empresa_id: texto(documento["empresa_id"]), order_date: data(documento["order_date"]), harvest_id: texto(documento["harvest_id"]),
      activity_id: texto(documento["activity_id"]), operation_id: texto(documento["operation_id"]), cost_center_id: texto(documento["cost_center_id"]),
      responsible_person_id: texto(documento["responsible_person_id"]), team_id: texto(documento["team_id"]), description: texto(documento["description"]),
      planned_start: data(documento["planned_start"]), planned_end: data(documento["planned_end"])
    };
    const secoes = secoesDoDocumento(documento.lines ?? [], () => chave++);
    return { cabecalho, secoes, proximaChave: chave };
  });
  return <FormularioDaOs nome={`Ordem de serviço ${texto(documento["code"])}`} situacao={<StatusBadge value={status} />}
    aviso={editavel ? undefined : <p className="text-[12px] text-amber-700" data-testid={`${PREFIXO}-nao-editavel`}>{`Esta OS não pode ser editada: ela está ${enumLabel("os_status", status).toLocaleLowerCase("pt-BR")}.`}</p>}
    inicial={inicial} edicao={{ documento, editavel }} top={null} salvar={salvar} rotaDaLista={`/os/${id}`} />;
}
