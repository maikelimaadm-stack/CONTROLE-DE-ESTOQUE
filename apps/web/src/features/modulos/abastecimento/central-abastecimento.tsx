"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { EXIGENCIAS_GERAIS_DOS_MODULOS_TOP } from "@agro/domain";
import { D, money } from "@agro/shared";
import { brl, todayISO } from "@/lib/utils";
import { enumLabel } from "@/lib/copy";
import { Input, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { useEmpresaPadrao, type ItemRow } from "@/features/docs/shared";
import { CampoDaCentral, CampoLeitura, ColunaDeCampos, DataDaCentral } from "@/features/central/campo";
import { CentralDoModulo, errosDoServidor, pendenciaDaExigencia, useSalvarDoModulo, type Pendencia } from "@/features/modulos/central-do-modulo";
import { ItensDoModulo } from "@/features/modulos/itens-do-modulo";
import { CampoTopDoModulo, camposExigidosDaTop, useEscolhaDaTopDoModulo, useTopDoModulo } from "@/features/modulos/top-do-modulo";

/**
 * A CENTRAL DO ABASTECIMENTO (OPERACOES-01 F10, decisão 287) — `/frota/abastecimentos/new`.
 *
 * A moldura do motor (Dados principais, Itens e o painel "Resumo") com a regra de SEMPRE do abastecimento: UMA linha
 * (o combustível — `linhaUnica`: sem Adicionar, Duplicar e Remover; a linha nasce com a página), o equipamento
 * obrigatório, o horímetro e o km do lançamento (o servidor sobe o contador do bem). Com local de estoque na linha, o
 * combustível sai do estoque pelo custo médio; sem local, vale o valor unitário informado e nada sai do estoque — quem
 * decide é o servidor.
 *
 * O CORPO DO POST é o de antes, chave por chave; `tipo_operacao_id` só entra com a capacidade `topNoModulo` da API
 * (`useTopDoModulo`): sem ela (a API anterior responde 404 à pergunta), nem o campo "Tipo de operação" aparece nem a
 * chave vai ao servidor. A TOP escolhida pode EXIGIR o centro de resultado e a observação (as exigências que o registro
 * do abastecimento tem): a pendência aparece antes de enviar, com o MESMO texto da recusa do servidor.
 *
 * Contas só com `D` (decimal), nunca `Number()`: o total do Resumo é uma prévia — o valor gravado é o do servidor.
 */

const PREFIXO = "central-abastecimento";
const ROTA_DA_LISTA = "/frota?tab=abastecimentos";
const ORIGENS = ["manual", "cta_smart", "import"] as const;

/** Texto decimal da tela → `Decimal`; vazio ou fora da forma decimal conta zero (só prévia: quem grava é o servidor). */
const decimal = (v: unknown) => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? D(v.trim()) : D(0));

interface Cabecalho {
  empresa_id: string; supply_date: string; equipment_id: string; operator_person_id: string; hour_meter: string; mileage: string;
  cost_center_id: string; harvest_id: string; origin: string; note: string;
}
const cabecalhoInicial = (): Cabecalho => ({
  empresa_id: "", supply_date: todayISO(), equipment_id: "", operator_person_id: "", hour_meter: "", mileage: "",
  cost_center_id: "", harvest_id: "", origin: "manual", note: ""
});
/** A linha que nasce com a página (a única do abastecimento). */
const linhaInicial = (): ItemRow => ({ product_id: "", quantity: "1", unit_value: "0", generate_stock: true });

/** Os erros de campo do servidor que moram na LINHA (o corpo do abastecimento é plano) → o caminho da grade do motor. */
const DO_CORPO_PARA_A_LINHA: Readonly<Record<string, string>> = Object.freeze({
  product_id: "items[0].produto", quantity: "items[0].quantidade", warehouse_id: "items[0].armazem", unit_value: "items[0].unitario"
});

export function CentralDoAbastecimento() {
  const router = useRouter();
  const empresaPadrao = useEmpresaPadrao();
  const [h, setH] = React.useState<Cabecalho>(cabecalhoInicial);
  const [itens, setItens] = React.useState<ItemRow[]>(() => [linhaInicial()]);
  const [alterado, setAlterado] = React.useState(false);
  React.useEffect(() => { setH((o) => ({ ...o, empresa_id: o.empresa_id || empresaPadrao })); }, [empresaPadrao]);

  const top = useTopDoModulo("abastecimento");
  const escolha = useEscolhaDaTopDoModulo(top);
  const exigidos = camposExigidosDaTop(top, escolha.valor);
  const exige = (campo: string) => exigidos.includes(campo);

  const salvar = useSalvarDoModulo(`/api/fleet/fuel-supplies`, () => router.push(ROTA_DA_LISTA));
  const doServidor = errosDoServidor(salvar.error);
  const errosDaLinha = Object.fromEntries(Object.entries(DO_CORPO_PARA_A_LINHA).flatMap(([c, g]) => (doServidor[c] ? [[g, doServidor[c]!]] : [])));

  const mudar = (p: Partial<Cabecalho>) => { setH((o) => ({ ...o, ...p })); setAlterado(true); };
  const mudarItens = (i: ItemRow[]) => { setItens(i); setAlterado(true); };
  const linha = itens[0] ?? linhaInicial();
  const total = money(decimal(linha.quantity).mul(decimal(linha.unit_value)));

  const pendencias: Pendencia[] = [];
  if (!h.empresa_id) pendencias.push({ caminho: "empresa_id", rotulo: "Empresa", mensagem: "Informe a empresa." });
  if (!h.supply_date) pendencias.push({ caminho: "supply_date", rotulo: "Data", mensagem: "Informe a data." });
  if (!h.equipment_id) pendencias.push({ caminho: "equipment_id", rotulo: "Equipamento", mensagem: "Informe o equipamento." });
  if (!linha.product_id) pendencias.push({ caminho: "items[0].produto", rotulo: "Produto", mensagem: "Informe o combustível." });
  if (!decimal(linha.quantity).gt(0)) pendencias.push({ caminho: "items[0].quantidade", rotulo: "Quantidade", mensagem: "Informe a quantidade." });
  // as exigências da TOP escolhida, com o rótulo e o texto da recusa do servidor (o mapa do registro do abastecimento)
  const valorDoCampo: Readonly<Record<string, string>> = { cost_center_id: h.cost_center_id, note: h.note.trim() };
  for (const x of EXIGENCIAS_GERAIS_DOS_MODULOS_TOP.abastecimento) {
    if (exige(x.caminho) && !valorDoCampo[x.caminho]) pendencias.push({ caminho: x.caminho, rotulo: x.rotulo, mensagem: pendenciaDaExigencia(x.rotulo) });
  }

  const enviar = () => salvar.mutate({
    empresa_id: h.empresa_id, supply_date: h.supply_date, equipment_id: h.equipment_id, operator_person_id: h.operator_person_id || null,
    warehouse_id: linha.warehouse_id || null, product_id: linha.product_id, quantity: linha.quantity, unit_value: linha.unit_value || null,
    hour_meter: h.hour_meter || null, mileage: h.mileage || null, cost_center_id: h.cost_center_id || null, harvest_id: h.harvest_id || null,
    note: h.note || null, origin: h.origin,
    // só com a capacidade: a API anterior descartaria a chave em silêncio
    ...(top.estado === "pronto" ? { tipo_operacao_id: escolha.idParaEnviar } : {})
  });

  const dados = <ColunaDeCampos>
    <CampoDaCentral rotulo="Empresa" obrigatorio icone="pesquisa" preenchido={Boolean(h.empresa_id)} erro={doServidor["empresa_id"]} testId={`${PREFIXO}-empresa`}>
      <RefSelect resource="empresas" value={h.empresa_id} onChange={(v) => mudar({ empresa_id: v ?? "" })} />
    </CampoDaCentral>
    <CampoDaCentral rotulo="Data" obrigatorio icone="data" preenchido={Boolean(h.supply_date)} erro={doServidor["supply_date"]} testId={`${PREFIXO}-data`}>
      <DataDaCentral rotulo="Data" value={h.supply_date} onChange={(v) => mudar({ supply_date: v })} />
    </CampoDaCentral>
    <CampoTopDoModulo prefixoTestid={PREFIXO} top={top} valor={escolha.valor} onChange={(id) => { escolha.escolher(id); setAlterado(true); }} />
    <CampoDaCentral rotulo="Equipamento" obrigatorio icone="pesquisa" preenchido={Boolean(h.equipment_id)} erro={doServidor["equipment_id"]} testId={`${PREFIXO}-equipamento`}>
      <RefSelect resource="equipments" value={h.equipment_id} onChange={(v) => mudar({ equipment_id: v ?? "" })} />
    </CampoDaCentral>
    <CampoDaCentral rotulo="Operador" icone="pesquisa" preenchido={Boolean(h.operator_person_id)} testId={`${PREFIXO}-operador`}>
      <RefSelect resource="people" value={h.operator_person_id} filter={{ is_employee: "true" }} onChange={(v) => mudar({ operator_person_id: v ?? "" })} />
    </CampoDaCentral>
    <CampoDaCentral rotulo="Horímetro" preenchido={h.hour_meter !== ""} erro={doServidor["hour_meter"]} testId={`${PREFIXO}-horimetro`}>
      <Input type="number" step="0.1" min="0" value={h.hour_meter} onChange={(e) => mudar({ hour_meter: e.target.value })} />
    </CampoDaCentral>
    <CampoDaCentral rotulo="Km" preenchido={h.mileage !== ""} erro={doServidor["mileage"]} testId={`${PREFIXO}-km`}>
      <Input type="number" step="0.1" min="0" value={h.mileage} onChange={(e) => mudar({ mileage: e.target.value })} />
    </CampoDaCentral>
    <CampoDaCentral rotulo="Centro de resultado" obrigatorio={exige("cost_center_id")} icone="pesquisa" preenchido={Boolean(h.cost_center_id)}
      erro={doServidor["cost_center_id"]} testId={`${PREFIXO}-centro`} data-exigido-top={exige("cost_center_id") ? "true" : undefined}>
      <RefSelect resource="cost_centers" value={h.cost_center_id} filter={{ kind: "analytic" }} onChange={(v) => mudar({ cost_center_id: v ?? "" })} />
    </CampoDaCentral>
    <CampoDaCentral rotulo="Safra" icone="pesquisa" preenchido={Boolean(h.harvest_id)} testId={`${PREFIXO}-safra`}>
      <RefSelect resource="harvests" value={h.harvest_id} onChange={(v) => mudar({ harvest_id: v ?? "" })} />
    </CampoDaCentral>
    <CampoDaCentral rotulo="Origem" icone="selecao" preenchido testId={`${PREFIXO}-origem`}>
      <NativeSelect value={h.origin} onChange={(e) => mudar({ origin: e.target.value })}>
        {ORIGENS.map((o) => <option key={o} value={o}>{enumLabel("origin", o)}</option>)}
      </NativeSelect>
    </CampoDaCentral>
    <CampoDaCentral rotulo="Observação" obrigatorio={exige("note")} multilinha preenchido={Boolean(h.note)} erro={doServidor["note"]} testId={`${PREFIXO}-observacao`}
      data-exigido-top={exige("note") ? "true" : undefined}>
      <Textarea value={h.note} onChange={(e) => mudar({ note: e.target.value })} />
    </CampoDaCentral>
  </ColunaDeCampos>;

  return <CentralDoModulo
    prefixoTestid={PREFIXO}
    titulo="Novo abastecimento"
    nome="Novo abastecimento"
    alterado={alterado}
    pendencias={pendencias}
    salvando={salvar.isPending}
    podeSalvar={top.estado !== "carregando"}
    onSalvar={enviar}
    rotaDaLista={ROTA_DA_LISTA}
    dados={dados}
    itens={<ItensDoModulo prefixoTestid={PREFIXO} items={itens} onChange={mudarItens} erros={errosDaLinha} linhaUnica />}
    resumo={<>
      <CampoLeitura rotulo="Total" adorno="travado" testId={`${PREFIXO}-total`} valor={brl(total)} />
      <p className="text-[11.5px] text-slate-500" data-testid={`${PREFIXO}-regra`}>
        Com local de estoque, o combustível sai do estoque pelo custo médio; sem local, vale o valor unitário informado e nada sai do estoque.
      </p>
    </>}
  />;
}
