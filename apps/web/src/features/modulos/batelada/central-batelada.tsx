"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { EXIGENCIAS_GERAIS_DOS_MODULOS_TOP, custoPorUnidade, itensDaBatelada } from "@agro/domain";
import { api } from "@/lib/api";
import { brl, todayISO } from "@/lib/utils";
import { Input } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { CampoDaCentral, CampoLeitura, ColunaDeCampos, DataDaCentral } from "@/features/central/campo";
import { useEmpresaPadrao } from "@/features/docs/shared";
import { CentralDoModulo, errosDoServidor, pendenciaDaExigencia, useSalvarDoModulo, type Pendencia } from "../central-do-modulo";
import { ItensDoModulo } from "../itens-do-modulo";
import { CampoTopDoModulo, camposExigidosDaTop, useEscolhaDaTopDoModulo, useTopDoModulo } from "../top-do-modulo";
import { ITENS_DERIVADOS, quantidadePositiva, subtotalDaPrevia, useItensDerivados } from "../itens-derivados";

/**
 * A CENTRAL DA BATELADA (OPERACOES-01 F10, decisão 287) — a rota nova `/confinamento/bateladas/new`.
 *
 * A batelada consome os ingredientes da DIETA do local de estoque do cabeçalho: cada ingrediente sai com
 * `kg × percentual / 100` (4 casas). Os itens são DERIVADOS — o modo "da origem" do motor: quantidade travada, sem
 * Adicionar nem Remover, a coluna "Pela dieta (kg)" e o local do cabeçalho em todas as linhas. A prévia do custo é o
 * custo médio do local (o motor o põe no unitário); o custo final é o do servidor, na hora de gravar.
 *
 * Os ingredientes vêm de `GET /api/modulos/batelada/dietas/:id/ingredientes`, que só existe na API que declara
 * `topNoModulo` — sem a capacidade, a Central NÃO chama a rota (a API anterior responderia 404) e diz que os
 * ingredientes são calculados ao salvar; o corpo é o de hoje, chave por chave. A TOP da batelada (família pelo
 * registry) segue a mesma capacidade.
 */

const PREFIXO = "central-batelada";
const NOME = "Nova batelada";
const LISTA = "/confinamento?tab=hoje&sub=producao";
interface Cabecalho { empresa_id: string; batch_date: string; diet_id: string; warehouse_id: string; equipment_id: string; quantity_kg: string }
interface Ingrediente { product_id: string; percentage: string }

/** O leitor da rota dos ingredientes: `items` com `product_id` e `percentage` em texto. Fora da forma → `null`. */
function lerIngredientes(bruto: unknown): Ingrediente[] | null {
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) return null;
  const itens = (bruto as { items?: unknown }).items;
  if (!Array.isArray(itens)) return null;
  const lidos: Ingrediente[] = [];
  for (const i of itens) {
    if (typeof i !== "object" || i === null) return null;
    const { product_id, percentage } = i as { product_id?: unknown; percentage?: unknown };
    if (typeof product_id !== "string" || !product_id || typeof percentage !== "string") return null;
    lidos.push({ product_id, percentage });
  }
  return lidos;
}

export function CentralBatelada() {
  const router = useRouter();
  const empresaPadrao = useEmpresaPadrao();
  const [h, setH] = React.useState<Cabecalho>({ empresa_id: "", batch_date: todayISO(), diet_id: "", warehouse_id: "", equipment_id: "", quantity_kg: "" });
  const [alterado, setAlterado] = React.useState(false);
  React.useEffect(() => { setH((o) => (o.empresa_id || !empresaPadrao ? o : { ...o, empresa_id: empresaPadrao })); }, [empresaPadrao]);

  const top = useTopDoModulo("batelada");
  const escolha = useEscolhaDaTopDoModulo(top);
  const comCapacidade = top.estado === "pronto";
  const salvar = useSalvarDoModulo("/api/feedlot/diet-batches", () => router.push(LISTA));
  const erros = errosDoServidor(salvar.error);
  const mudar = (p: Partial<Cabecalho>) => { setH((o) => ({ ...o, ...p })); setAlterado(true); };

  // SÓ com a capacidade: a API anterior não tem a rota (404) — sem ela, nenhum pedido sai daqui
  const ingredientes = useQuery({
    queryKey: ["batelada-ingredientes", h.diet_id],
    queryFn: async () => lerIngredientes(await api<unknown>(`/api/modulos/batelada/dietas/${encodeURIComponent(h.diet_id)}/ingredientes`)),
    enabled: comCapacidade && Boolean(h.diet_id),
    retry: false,
    staleTime: 60_000
  });
  const derivados = React.useMemo(
    () => (comCapacidade && h.diet_id && ingredientes.data ? itensDaBatelada(h.quantity_kg.trim(), ingredientes.data) : []),
    [comCapacidade, h.diet_id, ingredientes.data, h.quantity_kg]
  );
  const { itens, onChange: mudarItens } = useItensDerivados(derivados, h.warehouse_id);

  const exigidos = camposExigidosDaTop(top, escolha.valor);
  const pendencias: Pendencia[] = [];
  if (!h.empresa_id) pendencias.push({ caminho: "empresa_id", rotulo: "Empresa", mensagem: "Informe a empresa." });
  if (!h.batch_date) pendencias.push({ caminho: "batch_date", rotulo: "Data", mensagem: "Informe a data." });
  if (!h.diet_id) pendencias.push({ caminho: "diet_id", rotulo: "Dieta", mensagem: "Informe a dieta." });
  if (!h.warehouse_id) pendencias.push({ caminho: "warehouse_id", rotulo: "Local de estoque", mensagem: "Informe o local de estoque." });
  if (!quantidadePositiva(h.quantity_kg)) pendencias.push({ caminho: "quantity_kg", rotulo: "Quantidade (kg)", mensagem: "Informe a quantidade em kg." });
  // o registro da batelada não tem exigência geral (o mapa do domínio é vazio): o laço segue o mapa, nunca um literal
  for (const e of EXIGENCIAS_GERAIS_DOS_MODULOS_TOP.batelada) if (exigidos.includes(e.caminho)) pendencias.push({ caminho: e.caminho, rotulo: e.rotulo, mensagem: pendenciaDaExigencia(e.rotulo) });

  const enviar = () => salvar.mutate({
    empresa_id: h.empresa_id, batch_date: h.batch_date, diet_id: h.diet_id, warehouse_id: h.warehouse_id,
    equipment_id: h.equipment_id || null, quantity_kg: h.quantity_kg.trim(),
    ...(comCapacidade ? { tipo_operacao_id: escolha.idParaEnviar } : {})
  });

  const dados = <ColunaDeCampos>
    <CampoDaCentral rotulo="Empresa" obrigatorio icone="pesquisa" preenchido={Boolean(h.empresa_id)} erro={erros["empresa_id"]} testId={`${PREFIXO}-campo-empresa`}>
      <RefSelect resource="empresas" value={h.empresa_id} onChange={(v) => mudar({ empresa_id: v ?? "", warehouse_id: "" })} />
    </CampoDaCentral>
    <CampoDaCentral rotulo="Data" obrigatorio icone="data" preenchido={Boolean(h.batch_date)} erro={erros["batch_date"]} testId={`${PREFIXO}-campo-data`}>
      <DataDaCentral rotulo="Data" value={h.batch_date} onChange={(v) => mudar({ batch_date: v })} />
    </CampoDaCentral>
    <CampoTopDoModulo prefixoTestid={PREFIXO} top={top} valor={escolha.valor} onChange={(id) => { escolha.escolher(id); setAlterado(true); }} />
    <CampoDaCentral rotulo="Dieta" obrigatorio icone="pesquisa" preenchido={Boolean(h.diet_id)} erro={erros["diet_id"]} testId={`${PREFIXO}-campo-dieta`}>
      <RefSelect resource="diets" value={h.diet_id} onChange={(v) => mudar({ diet_id: v ?? "" })} />
    </CampoDaCentral>
    <CampoDaCentral rotulo="Local de estoque" obrigatorio icone="pesquisa" preenchido={Boolean(h.warehouse_id)} erro={erros["warehouse_id"]} testId={`${PREFIXO}-campo-local`}
      estado={h.empresa_id ? "editavel" : "desabilitado"} dica="Os ingredientes da dieta saem deste local de estoque.">
      <RefSelect resource="warehouses" value={h.warehouse_id} filter={{ empresa_id: h.empresa_id }} disabled={!h.empresa_id || undefined} onChange={(v) => mudar({ warehouse_id: v ?? "" })} />
    </CampoDaCentral>
    <CampoDaCentral rotulo="Vagão / misturador" icone="pesquisa" preenchido={Boolean(h.equipment_id)} erro={erros["equipment_id"]} testId={`${PREFIXO}-campo-vagao`}>
      <RefSelect resource="equipments" value={h.equipment_id} onChange={(v) => mudar({ equipment_id: v ?? "" })} />
    </CampoDaCentral>
    <CampoDaCentral rotulo="Quantidade (kg)" obrigatorio preenchido={Boolean(h.quantity_kg)} erro={erros["quantity_kg"]} testId={`${PREFIXO}-campo-quantidade`}>
      <Input type="number" step="0.01" min="0" value={h.quantity_kg} onChange={(e) => mudar({ quantity_kg: e.target.value })} />
    </CampoDaCentral>
  </ColunaDeCampos>;

  const itensDaGrade = comCapacidade
    ? <>
      {ingredientes.isError && <p role="alert" className="px-3 pt-2 text-[12px] text-red-600" data-testid={`${PREFIXO}-ingredientes-erro`}>Não foi possível carregar os ingredientes da dieta.</p>}
      {ingredientes.data === null && <p role="alert" className="px-3 pt-2 text-[12px] text-red-600" data-testid={`${PREFIXO}-ingredientes-erro`}>Os ingredientes da dieta vieram fora do formato esperado.</p>}
      {!h.diet_id && <p className="px-3 pt-2 text-[12px] text-slate-500" data-testid={`${PREFIXO}-itens-da-dieta`}>Escolha a dieta: cada ingrediente sai com kg × percentual da dieta.</p>}
      {h.diet_id && ingredientes.data?.length === 0 && <p role="alert" className="px-3 pt-2 text-[12px] text-amber-700" data-testid={`${PREFIXO}-dieta-sem-ingredientes`}>A dieta escolhida não tem ingredientes: a batelada não tem o que consumir.</p>}
      <ItensDoModulo prefixoTestid={PREFIXO} items={itens} onChange={mudarItens} armazemPorItem={false} daOrigem={ITENS_DERIVADOS} rotuloDaOrigem="Pela dieta (kg)" />
    </>
    : top.estado === "ausente"
      ? <p className="p-3 text-[12.5px] text-slate-600" data-testid={`${PREFIXO}-itens-ao-salvar`}>Os ingredientes da dieta são calculados ao salvar.</p>
      : null;

  const subtotal = subtotalDaPrevia(itens);
  const comPrevia = comCapacidade && itens.length > 0;
  const resumo = <>
    <CampoLeitura rotulo="Custo total (prévia)" valor={comPrevia ? brl(subtotal) : ""} testId={`${PREFIXO}-resumo-custo`} />
    <CampoLeitura rotulo="Custo por kg (prévia)" valor={comPrevia ? brl(custoPorUnidade(subtotal, h.quantity_kg.trim())) : ""} testId={`${PREFIXO}-resumo-custo-kg`} />
    <p className="text-[12px] text-slate-500">O custo final é o do estoque na hora de salvar.</p>
  </>;

  return <CentralDoModulo prefixoTestid={PREFIXO} titulo={NOME} nome={NOME} alterado={alterado}
    pendencias={pendencias} salvando={salvar.isPending} podeSalvar={top.estado !== "carregando"} onSalvar={enviar}
    rotaDaLista={LISTA} dados={dados} itens={itensDaGrade} resumo={resumo} />;
}
