"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { EXIGENCIAS_GERAIS_DOS_MODULOS_TOP } from "@agro/domain";
import { D, money } from "@agro/shared";
import { brl, todayISO } from "@/lib/utils";
import { Button, Input, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { useEmpresaPadrao, type ItemRow } from "@/features/docs/shared";
import { CampoDaCentral, CampoLeitura, ColunaDeCampos, DataDaCentral } from "@/features/central/campo";
import { CampoDoLocalPadrao, useLocalDoCabecalho } from "@/features/central/local-padrao";
import { CentralDoModulo, errosDoServidor, pendenciaDaExigencia, useSalvarDoModulo, type Pendencia } from "@/features/modulos/central-do-modulo";
import { ItensDoModulo } from "@/features/modulos/itens-do-modulo";
import { CampoTopDoModulo, camposExigidosDaTop, useEscolhaDaTopDoModulo, useTopDoModulo } from "@/features/modulos/top-do-modulo";

/**
 * A CENTRAL DA MANUTENÇÃO (OPERACOES-01 F10, decisão 287) — `/frota/manutencoes/new`.
 *
 * A moldura do motor com a regra de SEMPRE da manutenção: os itens são POR MÁQUINA. Cada máquina é um bloco na região
 * de Itens — Equipamento, Horímetro, Km, Executor, Pessoa executora, Horas, Valor do serviço, Descrição do serviço — com
 * a SUA grade de peças (a grade do motor, `ItensDoModulo`, uma por máquina no `.map`): o motor não ganha agrupamento
 * (decisão 4 do coordenador da F10). O "Local de estoque" do cabeçalho é estado da TELA: preenche as linhas NOVAS das
 * grades de todas as máquinas e nunca vai ao corpo. Peça com local sai do estoque pelo custo médio; peça sem local
 * grava com o valor unitário informado e não baixa — quem decide é o servidor.
 *
 * O CORPO DO POST é o de antes; `note` (a Observação, que a API anterior descartava) e `tipo_operacao_id` só entram com
 * a capacidade `topNoModulo` da API: sem ela, nem o campo "Tipo de operação" nem a "Observação" aparecem. A TOP pode
 * exigir a observação (a exigência que o registro da manutenção tem): a pendência sai antes de enviar, com o texto da
 * recusa do servidor. Depois de salvar, o MESMO destino de antes: o detalhe da manutenção.
 *
 * Contas só com `D` (decimal), nunca `Number()`: o Resumo é prévia — os totais gravados são os do servidor.
 */

const PREFIXO = "central-manutencao";
const ROTA_DA_LISTA = "/frota?tab=manutencoes";

/** Texto decimal da tela → `Decimal`; vazio ou fora da forma decimal conta zero (só prévia: quem grava é o servidor). */
const decimal = (v: unknown) => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? D(v.trim()) : D(0));

interface Cabecalho { empresa_id: string; maintenance_date: string; harvest_id: string; note: string }
interface Maquina {
  /** Identidade estável do bloco na tela (a chave do React), nunca enviada. */
  chave: number;
  equipment_id: string; hour_meter: string; mileage: string; maintenance_type: string; executor_person_id: string; hours: string;
  service_total: string; service_description: string; items: ItemRow[];
}
const maquinaNova = (chave: number): Maquina => ({
  chave, equipment_id: "", hour_meter: "", mileage: "", maintenance_type: "employee", executor_person_id: "", hours: "",
  service_total: "0", service_description: "", items: []
});

/** As colunas do item no corpo → a coluna da grade do motor (os erros de item do servidor voltam por elas). */
const COLUNA_DA_GRADE: Readonly<Record<string, string>> = Object.freeze({ product_id: "produto", quantity: "quantidade", warehouse_id: "armazem", unit_value: "unitario" });
/** Os erros de campo do servidor de UMA máquina: os do bloco (`equipment_id`, …) e os da grade (`items[<k>].<coluna>`). */
function errosDaMaquina(doServidor: Record<string, string>, i: number): { campos: Record<string, string>; grade: Record<string, string> } {
  const campos: Record<string, string> = {}; const grade: Record<string, string> = {};
  const prefixo = `machines.${i}.`;
  for (const [caminho, msg] of Object.entries(doServidor)) {
    if (!caminho.startsWith(prefixo)) continue;
    const resto = caminho.slice(prefixo.length);
    const item = /^items\.(\d+)\.(\w+)$/.exec(resto);
    if (item) { const col = COLUNA_DA_GRADE[item[2]!]; if (col) grade[`items[${item[1]}].${col}`] = msg; }
    else campos[resto] = msg;
  }
  return { campos, grade };
}

/** O controle focável dentro de um elemento (o primeiro botão, campo, seleção ou texto habilitado). */
const controleEm = (raiz: Element | null | undefined) =>
  raiz?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)") ?? null;
const semMarca = (t: string) => t.replace(/[*:]/g, "").replace(/\s+/g, " ").trim();

/** Levar à pendência: a da máquina vai ao BLOCO dela (o equipamento, ou a grade do item); as outras, ao campo pelo rótulo. */
function irParaPendencia(p: Pendencia) {
  const central = document.querySelector<HTMLElement>(`[data-testid="${PREFIXO}"]`);
  if (!central) return;
  const m = /^machines\.(\d+)\.(items\.)?/.exec(p.caminho);
  const alvo = m
    ? controleEm(central.querySelector(`[data-testid="${PREFIXO}-${m[2] ? `m${m[1]}-itens-corpo` : `maquina-${m[1]}`}"]`))
    : controleEm([...central.querySelectorAll("label")].find((l) => semMarca(l.textContent ?? "") === semMarca(p.rotulo))?.parentElement);
  if (!alvo) return;
  alvo.scrollIntoView({ block: "nearest" });
  alvo.focus();
}

export function CentralDaManutencao() {
  const router = useRouter();
  const empresaPadrao = useEmpresaPadrao();
  const [h, setH] = React.useState<Cabecalho>(() => ({ empresa_id: "", maintenance_date: todayISO(), harvest_id: "", note: "" }));
  const proxima = React.useRef(1);
  const [maquinas, setMaquinas] = React.useState<Maquina[]>(() => [maquinaNova(0)]);
  const [alterado, setAlterado] = React.useState(false);
  React.useEffect(() => { setH((o) => ({ ...o, empresa_id: o.empresa_id || empresaPadrao })); }, [empresaPadrao]);
  const local = useLocalDoCabecalho(null, h.empresa_id);

  const top = useTopDoModulo("manutencao");
  const comCapacidade = top.estado === "pronto";
  const escolha = useEscolhaDaTopDoModulo(top);
  const exige = (campo: string) => camposExigidosDaTop(top, escolha.valor).includes(campo);

  const salvar = useSalvarDoModulo<{ id: string }>(`/api/fleet/maintenances`, (r) => router.push(`/frota/manutencoes/${r.id}`));
  const doServidor = errosDoServidor(salvar.error);

  const mudar = (p: Partial<Cabecalho>) => { setH((o) => ({ ...o, ...p })); setAlterado(true); };
  const mudarMaquina = (i: number, p: Partial<Maquina>) => { setMaquinas((ms) => ms.map((m, j) => (j === i ? { ...m, ...p } : m))); setAlterado(true); };
  const adicionarMaquina = () => { const chave = proxima.current++; setMaquinas((ms) => [...ms, maquinaNova(chave)]); setAlterado(true); };
  const removerMaquina = (i: number) => { setMaquinas((ms) => (ms.length > 1 ? ms.filter((_, j) => j !== i) : ms)); setAlterado(true); };

  const pecas = maquinas.reduce((a, m) => m.items.reduce((b, it) => b.plus(decimal(it.quantity).mul(decimal(it.unit_value))), a), D(0));
  const servicos = maquinas.reduce((a, m) => a.plus(decimal(m.service_total)), D(0));

  const pendencias: Pendencia[] = [];
  if (!h.empresa_id) pendencias.push({ caminho: "empresa_id", rotulo: "Empresa", mensagem: "Informe a empresa." });
  if (!h.maintenance_date) pendencias.push({ caminho: "maintenance_date", rotulo: "Data", mensagem: "Informe a data." });
  maquinas.forEach((m, i) => {
    const n = i + 1;
    if (!m.equipment_id) pendencias.push({ caminho: `machines.${i}.equipment_id`, rotulo: `Máquina ${n}`, mensagem: `Máquina ${n}: informe o equipamento.` });
    m.items.forEach((it, k) => {
      if (!it.product_id) pendencias.push({ caminho: `machines.${i}.items.${k}.produto`, rotulo: `Máquina ${n}`, mensagem: `Máquina ${n}, item ${k + 1}: informe o produto.` });
      if (!decimal(it.quantity).gt(0)) pendencias.push({ caminho: `machines.${i}.items.${k}.quantidade`, rotulo: `Máquina ${n}`, mensagem: `Máquina ${n}, item ${k + 1}: informe a quantidade.` });
    });
  });
  const valorDoCampo: Readonly<Record<string, string>> = { note: h.note.trim() };
  for (const x of EXIGENCIAS_GERAIS_DOS_MODULOS_TOP.manutencao) {
    if (exige(x.caminho) && !valorDoCampo[x.caminho]) pendencias.push({ caminho: x.caminho, rotulo: x.rotulo, mensagem: pendenciaDaExigencia(x.rotulo) });
  }

  const enviar = () => salvar.mutate({
    empresa_id: h.empresa_id, maintenance_date: h.maintenance_date, harvest_id: h.harvest_id || null,
    // só com a capacidade: a API anterior descartaria as duas chaves em silêncio
    ...(comCapacidade ? { note: h.note || null, tipo_operacao_id: escolha.idParaEnviar } : {}),
    machines: maquinas.map((m) => ({
      equipment_id: m.equipment_id, hour_meter: m.hour_meter || null, mileage: m.mileage || null, maintenance_type: m.maintenance_type || null,
      executor_person_id: m.executor_person_id || null, hours: m.hours || null, service_total: m.service_total || "0",
      service_description: m.service_description || null,
      items: m.items.map((it) => ({ warehouse_id: it.warehouse_id || null, product_id: it.product_id, quantity: it.quantity, unit_value: it.unit_value || null, note: null }))
    }))
  });

  const dados = <ColunaDeCampos>
    <CampoDaCentral rotulo="Empresa" obrigatorio icone="pesquisa" preenchido={Boolean(h.empresa_id)} erro={doServidor["empresa_id"]} testId={`${PREFIXO}-empresa`}>
      <RefSelect resource="empresas" value={h.empresa_id} onChange={(v) => mudar({ empresa_id: v ?? "" })} />
    </CampoDaCentral>
    <CampoDaCentral rotulo="Data" obrigatorio icone="data" preenchido={Boolean(h.maintenance_date)} erro={doServidor["maintenance_date"]} testId={`${PREFIXO}-data`}>
      <DataDaCentral rotulo="Data" value={h.maintenance_date} onChange={(v) => mudar({ maintenance_date: v })} />
    </CampoDaCentral>
    <CampoTopDoModulo prefixoTestid={PREFIXO} top={top} valor={escolha.valor} onChange={(id) => { escolha.escolher(id); setAlterado(true); }} />
    <CampoDaCentral rotulo="Safra" icone="pesquisa" preenchido={Boolean(h.harvest_id)} testId={`${PREFIXO}-safra`}>
      <RefSelect resource="harvests" value={h.harvest_id} onChange={(v) => mudar({ harvest_id: v ?? "" })} />
    </CampoDaCentral>
    <CampoDoLocalPadrao prefixoTestid={PREFIXO} empresaId={h.empresa_id} valor={local.local} onChange={local.escolher} />
    {comCapacidade && <CampoDaCentral rotulo="Observação" obrigatorio={exige("note")} multilinha preenchido={Boolean(h.note)} erro={doServidor["note"]}
      testId={`${PREFIXO}-observacao`} data-exigido-top={exige("note") ? "true" : undefined}>
      <Textarea maxLength={2000} value={h.note} onChange={(e) => mudar({ note: e.target.value })} />
    </CampoDaCentral>}
  </ColunaDeCampos>;

  const itens = <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3" data-testid={`${PREFIXO}-maquinas`}>
    {maquinas.map((m, i) => {
      const e = errosDaMaquina(doServidor, i);
      const p = `${PREFIXO}-m${i}`;
      return <section key={m.chave} className="flex flex-col gap-2 rounded border border-slate-200 p-2" aria-label={`Máquina ${i + 1}`} data-testid={`${PREFIXO}-maquina-${i}`}>
        <div className="flex items-center justify-between">
          <h3 className="text-[12px] font-semibold uppercase text-brand-700">Máquina {i + 1}</h3>
          {maquinas.length > 1 && <Button type="button" size="sm" variant="outline" data-testid={`${p}-remover`} onClick={() => removerMaquina(i)}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remover máquina
          </Button>}
        </div>
        <div className="grid grid-cols-1 gap-x-3 gap-y-1.5 md:grid-cols-2 2xl:grid-cols-4">
          <CampoDaCentral rotulo="Equipamento" obrigatorio icone="pesquisa" preenchido={Boolean(m.equipment_id)} erro={e.campos["equipment_id"]} testId={`${p}-equipamento`}>
            <RefSelect resource="equipments" value={m.equipment_id} onChange={(v) => mudarMaquina(i, { equipment_id: v ?? "" })} />
          </CampoDaCentral>
          <CampoDaCentral rotulo="Horímetro" preenchido={m.hour_meter !== ""} erro={e.campos["hour_meter"]} testId={`${p}-horimetro`}>
            <Input type="number" step="0.1" min="0" value={m.hour_meter} onChange={(ev) => mudarMaquina(i, { hour_meter: ev.target.value })} />
          </CampoDaCentral>
          <CampoDaCentral rotulo="Km" preenchido={m.mileage !== ""} erro={e.campos["mileage"]} testId={`${p}-km`}>
            <Input type="number" step="0.1" min="0" value={m.mileage} onChange={(ev) => mudarMaquina(i, { mileage: ev.target.value })} />
          </CampoDaCentral>
          <CampoDaCentral rotulo="Executor" icone="selecao" preenchido={Boolean(m.maintenance_type)} testId={`${p}-executor`}>
            <NativeSelect value={m.maintenance_type} onChange={(ev) => mudarMaquina(i, { maintenance_type: ev.target.value })}>
              <option value="">Não informado</option>
              <option value="employee">Funcionário</option>
              <option value="provider">Terceiro</option>
            </NativeSelect>
          </CampoDaCentral>
          <CampoDaCentral rotulo="Pessoa executora" icone="pesquisa" preenchido={Boolean(m.executor_person_id)} testId={`${p}-pessoa`}>
            <RefSelect resource="people" value={m.executor_person_id}
              filter={m.maintenance_type === "employee" ? { is_employee: "true" } : m.maintenance_type === "provider" ? { is_provider: "true" } : undefined}
              onChange={(v) => mudarMaquina(i, { executor_person_id: v ?? "" })} />
          </CampoDaCentral>
          <CampoDaCentral rotulo="Horas" preenchido={m.hours !== ""} erro={e.campos["hours"]} testId={`${p}-horas`}>
            <Input type="number" step="0.1" min="0" value={m.hours} onChange={(ev) => mudarMaquina(i, { hours: ev.target.value })} />
          </CampoDaCentral>
          <CampoDaCentral rotulo="Valor do serviço" preenchido={m.service_total !== ""} erro={e.campos["service_total"]} testId={`${p}-servico`}>
            <Input type="number" step="0.01" min="0" value={m.service_total} onChange={(ev) => mudarMaquina(i, { service_total: ev.target.value })} />
          </CampoDaCentral>
          <CampoDaCentral rotulo="Descrição do serviço" preenchido={Boolean(m.service_description)} testId={`${p}-descricao`}>
            <Input value={m.service_description} onChange={(ev) => mudarMaquina(i, { service_description: ev.target.value })} />
          </CampoDaCentral>
        </div>
        <div className="flex h-[210px] min-h-0 flex-col rounded border border-slate-100">
          <ItensDoModulo prefixoTestid={p} items={m.items} onChange={(items) => mudarMaquina(i, { items })} erros={e.grade} armazemPadrao={local.local} />
        </div>
      </section>;
    })}
    <div>
      <Button type="button" size="sm" variant="outline" data-testid={`${PREFIXO}-adicionar-maquina`} onClick={adicionarMaquina}>
        <Plus className="h-3.5 w-3.5" aria-hidden /> Adicionar máquina
      </Button>
    </div>
  </div>;

  return <CentralDoModulo
    prefixoTestid={PREFIXO}
    titulo="Nova manutenção"
    nome="Nova manutenção"
    alterado={alterado}
    pendencias={pendencias}
    salvando={salvar.isPending}
    podeSalvar={top.estado !== "carregando"}
    onSalvar={enviar}
    rotaDaLista={ROTA_DA_LISTA}
    onIrParaPendencia={irParaPendencia}
    dados={dados}
    itens={itens}
    resumo={<>
      <CampoLeitura rotulo="Peças" adorno="travado" testId={`${PREFIXO}-pecas`} valor={brl(money(pecas))} />
      <CampoLeitura rotulo="Serviços" adorno="travado" testId={`${PREFIXO}-servicos`} valor={brl(money(servicos))} />
      <CampoLeitura rotulo="Total" adorno="travado" testId={`${PREFIXO}-total`} valor={brl(money(pecas.plus(servicos)))} />
    </>}
  />;
}
