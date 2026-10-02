import { D, money, type Decimal } from "@agro/shared";
import { montarDre, periodosDoIntervalo, type Agrupamento, type Dre, type LinhaDre, type NaturezaParaDre } from "@agro/domain";
import { empresaScope, type ServiceCtx } from "./context.js";
import { EH_ADIANTAMENTO_SQL } from "./financeiro-estorno.js";

/**
 * FLUXO DE CAIXA E RESULTADO DA CENTRAL FINANCEIRA (OPERACOES-01 F8, decisão 285).
 *
 * REALIZADO tem duas portas, e a escolha é do PEDIDO, não do cliente adivinhar:
 *   • da ORGANIZAÇÃO (sem empresa pedida e sem agrupar por empresa): os movimentos de TODAS as empresas das contas,
 *     pela função estreita `erp.extrato_conta_organizacao` (a conta e o saldo dela são da organização —
 *     MULTI-COMPANY §7), com saldo inicial e saldo acumulado;
 *   • por EMPRESA (empresa pedida ou agrupar por empresa): `erp.bank_movements` sob a RLS e o escopo do módulo, SEM
 *     saldo — saldo de conta não se decompõe por empresa sem inventar rateio.
 * Transferência entre contas (e depósito, saque, aplicação, resgate) NÃO é entrada nem saída: fica em
 * `transferencias_liquidas`. O movimento de saldo inicial também não: fica em `saldos_iniciais` e só entra no saldo.
 *
 * PREVISTO = saldo dos títulos abertos (aberto e baixa parcial) por VENCIMENTO, só das direções que o usuário VÊ,
 * sob o escopo de empresa; vencidos antes do início vão para `previsto_em_atraso`. A situação "previsto" (provisão
 * pela TOP) é da F9.
 *
 * A agregação é no SQL, por `date_trunc` de uma lista FECHADA (nunca texto do cliente); os períodos são os do
 * domínio (`periodosDoIntervalo`), alinhados como o `date_trunc` (semana = segunda-feira).
 */
const TRUNC: Readonly<Record<Agrupamento, "day" | "week" | "month">> = { dia: "day", semana: "week", mes: "month" };
type Direcao = "payable" | "receivable";

export interface PedidoFluxo {
  de: string;
  ate: string;
  agrupamento: Agrupamento;
  contas: string[] | null;
  empresaId: string | null;
  agruparPor: "nenhum" | "conta" | "empresa";
  /** Direções cujo previsto o usuário pode ver (`{dir}.view`). */
  direcoes: Direcao[];
}

interface Realizado { entradas: string; saidas: string; transferencias_liquidas: string; saldos_iniciais: string }
interface Previsto { entradas: string; saidas: string }
export interface PeriodoFluxo { inicio: string; fim: string; realizado: Realizado; previsto: Previsto; saldo_realizado: string | null; saldo_projetado: string | null }
export interface RespostaFluxo {
  agrupamento: Agrupamento;
  de: string;
  ate: string;
  modo: "organizacao" | "empresa";
  saldo_inicial: string | null;
  periodos: PeriodoFluxo[];
  previsto_em_atraso: Previsto;
  previstos_incluidos: false;
  direcoes_previstas: Direcao[];
  grupos?: { chave: string | null; rotulo: string; saldo_inicial: string | null; periodos: PeriodoFluxo[] }[];
}

interface LinhaRealizado { inicio: string; chave: string | null; entradas: string; saidas: string; transferencias: string; saldos_iniciais: string }
interface LinhaPrevisto { inicio: string; chave: string | null; entradas: string; saidas: string }

const SOMA_COM_SINAL = (a: string) => `(case when ${a}.type='in' then ${a}.amount + ${a}.interest else -(${a}.amount + ${a}.interest) end)`;
const COLUNAS_REALIZADO = (a: string) => `
  coalesce(sum(${a}.amount + ${a}.interest) filter (where ${a}.type='in' and ${a}.category_type not in ('internal_transfer','opening_balance')),0)::text as entradas,
  coalesce(sum(${a}.amount + ${a}.interest) filter (where ${a}.type='out' and ${a}.category_type not in ('internal_transfer','opening_balance')),0)::text as saidas,
  coalesce(sum(${SOMA_COM_SINAL(a)}) filter (where ${a}.category_type='internal_transfer'),0)::text as transferencias,
  coalesce(sum(${SOMA_COM_SINAL(a)}) filter (where ${a}.category_type='opening_balance'),0)::text as saldos_iniciais`;

const ZERO_REALIZADO = (): { entradas: Decimal; saidas: Decimal; transf: Decimal; aberturas: Decimal } => ({ entradas: D(0), saidas: D(0), transf: D(0), aberturas: D(0) });

/** Monta os períodos de um grupo (ou do total) a partir das linhas agregadas, com o saldo acumulado quando há saldo. */
function montarPeriodos(periodos: { inicio: string; fim: string }[], realizado: readonly LinhaRealizado[], previsto: readonly LinhaPrevisto[], saldoInicial: string | null): PeriodoFluxo[] {
  const r = new Map<string, ReturnType<typeof ZERO_REALIZADO>>();
  for (const l of realizado) {
    const v = r.get(l.inicio) ?? ZERO_REALIZADO();
    v.entradas = v.entradas.plus(l.entradas); v.saidas = v.saidas.plus(l.saidas);
    v.transf = v.transf.plus(l.transferencias); v.aberturas = v.aberturas.plus(l.saldos_iniciais);
    r.set(l.inicio, v);
  }
  const p = new Map<string, { entradas: Decimal; saidas: Decimal }>();
  for (const l of previsto) {
    const v = p.get(l.inicio) ?? { entradas: D(0), saidas: D(0) };
    v.entradas = v.entradas.plus(l.entradas); v.saidas = v.saidas.plus(l.saidas);
    p.set(l.inicio, v);
  }
  let saldo = saldoInicial === null ? null : D(saldoInicial);
  let projetado = saldo;
  return periodos.map((per) => {
    const re = r.get(per.inicio) ?? ZERO_REALIZADO();
    const pr = p.get(per.inicio) ?? { entradas: D(0), saidas: D(0) };
    const deltaReal = re.entradas.minus(re.saidas).plus(re.transf).plus(re.aberturas);
    if (saldo !== null && projetado !== null) {
      saldo = saldo.plus(deltaReal);
      projetado = projetado.plus(deltaReal).plus(pr.entradas).minus(pr.saidas);
    }
    return {
      inicio: per.inicio, fim: per.fim,
      realizado: { entradas: money(re.entradas), saidas: money(re.saidas), transferencias_liquidas: money(re.transf), saldos_iniciais: money(re.aberturas) },
      previsto: { entradas: money(pr.entradas), saidas: money(pr.saidas) },
      saldo_realizado: saldo === null ? null : money(saldo),
      saldo_projetado: projetado === null ? null : money(projetado)
    };
  });
}

export async function montarFluxo(ctx: ServiceCtx, p: PedidoFluxo): Promise<RespostaFluxo> {
  const periodos = periodosDoIntervalo(p.de, p.ate, p.agrupamento);
  const trunc = TRUNC[p.agrupamento];
  const porOrganizacao = !p.empresaId && p.agruparPor !== "empresa";

  // ---------- realizado ----------
  let realizado: LinhaRealizado[];
  let saldoInicial: string | null = null;
  const saldoPorConta = new Map<string, string>();
  const rotuloDaConta = new Map<string, string>();
  if (porOrganizacao) {
    // As contas da organização (vivas; ativas ou não — o dinheiro de uma conta inativa ainda é da organização), já
    // recortadas pelo pedido. A MESMA lista vai para a função: o saldo inicial e os movimentos falam das mesmas contas.
    const contas = await ctx.tx.query<{ id: string; rotulo: string; saldo: string }>(
      `with antes as (select x.bank_account_id, sum(${SOMA_COM_SINAL("x")}) as v
                        from erp.extrato_conta_organizacao(
                               (select coalesce(array_agg(c.id), '{}'::uuid[]) from erp.bank_accounts c where c.organization_id=$1 and c.deleted_at is null and ($2::uuid[] is null or c.id = any($2::uuid[]))),
                               null, ($3::date - 1)) x group by 1)
       select a.id, a.code || ' — ' || a.description as rotulo, (a.opening_balance + coalesce(antes.v,0))::text as saldo
         from erp.bank_accounts a left join antes on antes.bank_account_id=a.id
        where a.organization_id=$1 and a.deleted_at is null and ($2::uuid[] is null or a.id = any($2::uuid[]))
        order by a.code, a.id`, [ctx.orgId, p.contas, p.de]);
    for (const c of contas.rows) { saldoPorConta.set(c.id, c.saldo); rotuloDaConta.set(c.id, c.rotulo); }
    saldoInicial = money(contas.rows.reduce((s, c) => s.plus(c.saldo), D(0)));
    const ids = contas.rows.map((c) => c.id);
    realizado = ids.length ? (await ctx.tx.query<LinhaRealizado>(
      `select to_char(date_trunc($1, x.movement_date::timestamp),'YYYY-MM-DD') as inicio, ${p.agruparPor === "conta" ? "x.bank_account_id::text" : "null::text"} as chave, ${COLUNAS_REALIZADO("x")}
         from erp.extrato_conta_organizacao($2::uuid[], $3::date, $4::date) x group by 1, 2`, [trunc, ids, p.de, p.ate])).rows : [];
  } else {
    const params: unknown[] = [trunc, ctx.orgId, p.de, p.ate];
    const where = ["m.organization_id=$2", "m.status='confirmed'", "m.deleted_at is null", "m.movement_date between $3::date and $4::date"];
    if (p.contas) { params.push(p.contas); where.push(`m.bank_account_id = any($${params.length}::uuid[])`); }
    if (p.empresaId) { params.push(p.empresaId); where.push(`m.empresa_id=$${params.length}`); }
    // Sem empresa pedida (agrupar por empresa), o movimento sem empresa é da organização e continua visível — como a
    // RLS de leitura; com empresa pedida, só os dela.
    where.push(...empresaScope(ctx, "m", params, { nullable: !p.empresaId, ignoreSelected: true }));
    realizado = (await ctx.tx.query<LinhaRealizado>(
      `select to_char(date_trunc($1, m.movement_date::timestamp),'YYYY-MM-DD') as inicio, ${p.agruparPor === "empresa" ? "m.empresa_id::text" : "null::text"} as chave, ${COLUNAS_REALIZADO("m")}
         from erp.bank_movements m where ${where.join(" and ")} group by 1, 2`, params)).rows;
  }

  // ---------- previsto ----------
  const chavePrevisto = p.agruparPor === "conta" ? "t.conta_prevista_id::text" : p.agruparPor === "empresa" ? "t.empresa_id::text" : "null::text";
  /** O recorte dos títulos (organização, situação, direções vistas, empresa, conta prevista e escopo), com placeholders próprios. */
  const filtrosTitulo = (params: unknown[]): string[] => {
    const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const w = [`t.organization_id=${add(ctx.orgId)}`, "t.deleted_at is null", "t.status in ('open','partially_paid')", `t.direction = any(${add(p.direcoes)}::text[])`];
    if (p.empresaId) w.push(`t.empresa_id=${add(p.empresaId)}`);
    if (p.contas) w.push(`t.conta_prevista_id = any(${add(p.contas)}::uuid[])`);
    w.push(...empresaScope(ctx, "t", params, { ignoreSelected: true }));
    return w;
  };
  let previsto: LinhaPrevisto[] = [];
  let emAtraso: Previsto = { entradas: "0.00", saidas: "0.00" };
  if (p.direcoes.length) {
    const pp: unknown[] = [];
    const w = filtrosTitulo(pp);
    pp.push(trunc, p.de, p.ate);
    const [iTrunc, iDe, iAte] = [pp.length - 2, pp.length - 1, pp.length];
    previsto = (await ctx.tx.query<LinhaPrevisto>(
      `select to_char(date_trunc($${iTrunc}, t.due_date::timestamp),'YYYY-MM-DD') as inicio, ${chavePrevisto} as chave,
              coalesce(sum(t.balance) filter (where t.direction='receivable'),0)::text as entradas,
              coalesce(sum(t.balance) filter (where t.direction='payable'),0)::text as saidas
         from erp.financial_titles t where ${w.join(" and ")} and t.due_date between $${iDe}::date and $${iAte}::date group by 1, 2`, pp)).rows;
    const pa: unknown[] = [];
    const wa = filtrosTitulo(pa);
    pa.push(p.de);
    const atraso = await ctx.tx.query<Previsto>(
      `select coalesce(sum(t.balance) filter (where t.direction='receivable'),0)::text as entradas,
              coalesce(sum(t.balance) filter (where t.direction='payable'),0)::text as saidas
         from erp.financial_titles t where ${wa.join(" and ")} and t.due_date < $${pa.length}::date`, pa);
    emAtraso = { entradas: money(atraso.rows[0]!.entradas), saidas: money(atraso.rows[0]!.saidas) };
  }

  const resposta: RespostaFluxo = {
    agrupamento: p.agrupamento, de: p.de, ate: p.ate, modo: porOrganizacao ? "organizacao" : "empresa",
    saldo_inicial: saldoInicial, periodos: montarPeriodos(periodos, realizado, previsto, saldoInicial),
    previsto_em_atraso: emAtraso, previstos_incluidos: false, direcoes_previstas: p.direcoes
  };
  if (p.agruparPor === "nenhum") return resposta;

  // ---------- grupos (por conta ou por empresa) ----------
  const chaves = new Set<string | null>([...realizado.map((l) => l.chave), ...previsto.map((l) => l.chave)]);
  if (p.agruparPor === "conta") for (const id of saldoPorConta.keys()) chaves.add(id);
  const rotulos = new Map<string, string>(rotuloDaConta);
  if (p.agruparPor === "empresa") {
    const ids = [...chaves].filter((c): c is string => c !== null);
    const r = await ctx.tx.query<{ id: string; name: string }>("select id, name from erp.empresas where organization_id=$1 and id = any($2::uuid[])", [ctx.orgId, ids]);
    for (const e of r.rows) rotulos.set(e.id, e.name);
  } else {
    // Conta prevista de um título que não está na lista do saldo (filtrada, inativa…): o rótulo vem do cadastro.
    const faltam = [...chaves].filter((c): c is string => c !== null && !rotulos.has(c));
    if (faltam.length) {
      const r = await ctx.tx.query<{ id: string; rotulo: string }>("select id, code || ' — ' || description as rotulo from erp.bank_accounts where organization_id=$1 and id = any($2::uuid[])", [ctx.orgId, faltam]);
      for (const c of r.rows) rotulos.set(c.id, c.rotulo);
    }
  }
  const semChave = p.agruparPor === "conta" ? "Sem conta prevista" : "Sem empresa";
  resposta.grupos = [...chaves]
    .map((chave) => {
      const saldo = porOrganizacao && chave !== null ? saldoPorConta.get(chave) ?? null : null;
      return {
        chave, rotulo: chave === null ? semChave : rotulos.get(chave) ?? "Não encontrado",
        saldo_inicial: saldo,
        periodos: montarPeriodos(periodos, realizado.filter((l) => l.chave === chave), previsto.filter((l) => l.chave === chave), saldo)
      };
    })
    .sort((a, b) => (a.chave === null ? 1 : b.chave === null ? -1 : a.rotulo.localeCompare(b.rotulo, "pt-BR") || a.chave.localeCompare(b.chave)));
  return resposta;
}

/**
 * DRE GERENCIAL (decisão 285): soma com sinal (+ receita/entrada, − despesa/saída) por natureza, montada pelo
 * domínio (`montarDre`: grupo próprio → herdado do ancestral → derivado da natureza).
 *   • CAIXA: o rateio dos movimentos CONFIRMADOS de entrada e saída pela data do movimento (o principal da baixa
 *     carrega o rateio do título; os componentes separados, a natureza padrão; o desconto não movimenta caixa),
 *     MENOS a parte de cada movimento que pagou ou recebeu um ADIANTAMENTO (o crédito do excedente inclusive): o
 *     adiantamento é financeiro, não resultado — o mesmo princípio da competência. O resultado entra quando o
 *     título é LIQUIDADO SEM CAIXA: a compensação com o crédito de um adiantamento e o encontro de contas, pela
 *     data da baixa, no rateio do título liquidado (escalado ao líquido da baixa; o título-adiantamento nunca).
 *     Sem isso, o excedente de 50 de uma conta de energia de 100 paga com 150 saía como 150 de energia, e a conta
 *     de outra natureza quitada depois com esse crédito nunca aparecia no caixa.
 *   • COMPETÊNCIA: o rateio dos títulos não cancelados e que NÃO são adiantamento (adiantamento é financeiro, não
 *     resultado) pela competência (ou a emissão), + o rateio dos movimentos avulsos (manual/OFX, sem "gera
 *     obrigação" — esse já virou título) e dos componentes separados da baixa (juros, multa, acréscimo, tarifa) pela
 *     data do movimento, + o desconto das baixas confirmadas na natureza gravada nelas (a pagar: desconto obtido, +;
 *     a receber: desconto concedido, −), pela data da baixa.
 * Escopo de empresa em cada bloco (o movimento sem empresa é da organização e entra quando nenhuma empresa é pedida).
 */
export async function montarResultado(ctx: ServiceCtx, p: { de: string; ate: string; regime: "competencia" | "caixa"; empresaId: string | null }): Promise<Dre & { regime: "competencia" | "caixa"; de: string; ate: string }> {
  const params: unknown[] = [ctx.orgId, p.de, p.ate];
  const empresaDe = (col: string, nulo: boolean): string => {
    const w: string[] = [];
    if (p.empresaId) { params.push(p.empresaId); w.push(`${col}.empresa_id=$${params.length}`); }
    w.push(...empresaScope(ctx, col, params, { nullable: nulo && !p.empresaId, ignoreSelected: true }));
    return w.map((x) => ` and ${x}`).join("");
  };
  const movimentos = (filtro: string) => `
    select a.financial_category_id as natureza_id, (case when m.type='in' then a.amount else -a.amount end) as valor
      from erp.bank_movement_apportionments a join erp.bank_movements m on m.id=a.movement_id
     where m.organization_id=$1 and m.status='confirmed' and m.deleted_at is null and m.movement_date between $2::date and $3::date and ${filtro}${empresaDe("m", true)}`;
  const blocos: string[] = [];
  if (p.regime === "caixa") {
    blocos.push(movimentos("m.category_type in ('in','out')"));
    // − a parte do movimento que liquidou um ADIANTAMENTO: o rateio do título-adiantamento escalado ao líquido da
    // baixa dele, com o sinal invertido do movimento (o mesmo recorte de movimento do bloco acima).
    blocos.push(`
      select a.financial_category_id as natureza_id,
             round(a.amount * s.net_amount / nullif(sum(a.amount) over (partition by s.id), 0), 2) * (case when m.type='in' then -1 else 1 end) as valor
        from erp.title_settlements s
        join erp.financial_titles t on t.id=s.title_id and t.organization_id=s.organization_id
        join erp.title_apportionments a on a.title_id=t.id
        join erp.bank_movements m on m.id=s.bank_movement_id and m.organization_id=s.organization_id
       where s.organization_id=$1 and s.status='confirmed' and ${EH_ADIANTAMENTO_SQL("t")}
         and m.status='confirmed' and m.deleted_at is null and m.movement_date between $2::date and $3::date and m.category_type in ('in','out')${empresaDe("m", true)}`);
    // + o título liquidado SEM caixa (crédito de adiantamento ou encontro de contas), que não é adiantamento.
    blocos.push(`
      select a.financial_category_id as natureza_id,
             round(a.amount * s.net_amount / nullif(sum(a.amount) over (partition by s.id), 0), 2) * (case when t.direction='receivable' then 1 else -1 end) as valor
        from erp.title_settlements s
        join erp.financial_titles t on t.id=s.title_id and t.organization_id=s.organization_id
        join erp.title_apportionments a on a.title_id=t.id
       where s.organization_id=$1 and s.status='confirmed' and s.bank_movement_id is null and (s.adiantamento_id is not null or s.cross_title_id is not null)
         and not ${EH_ADIANTAMENTO_SQL("t")} and t.deleted_at is null
         and s.settlement_date between $2::date and $3::date${empresaDe("t", false)}`);
  } else {
    blocos.push(`
      select a.financial_category_id as natureza_id, (case when t.direction='receivable' then a.amount else -a.amount end) as valor
        from erp.title_apportionments a join erp.financial_titles t on t.id=a.title_id
       where t.organization_id=$1 and t.deleted_at is null and t.status<>'cancelled'
         and not (t.payment_type='advance' or exists (select 1 from erp.title_types tt where tt.id=t.title_type_id and tt.is_advance))
         and coalesce(t.data_competencia, t.emission_date) between $2::date and $3::date${empresaDe("t", false)}`);
    blocos.push(movimentos("m.source_type in ('manual','ofx') and not m.generates_obligation and m.category_type in ('in','out') and m.componente_baixa is null"));
    blocos.push(movimentos("m.componente_baixa is not null"));
    blocos.push(`
      select s.natureza_desconto_id as natureza_id, (case when t.direction='payable' then s.discount else -s.discount end) as valor
        from erp.title_settlements s join erp.financial_titles t on t.id=s.title_id and t.organization_id=s.organization_id
       where s.organization_id=$1 and s.status='confirmed' and s.natureza_desconto_id is not null and s.discount > 0
         and s.settlement_date between $2::date and $3::date${empresaDe("t", false)}`);
  }
  const linhas = await ctx.tx.query<{ natureza_id: string; valor: string }>(
    `select x.natureza_id::text as natureza_id, sum(x.valor)::text as valor from (${blocos.join(" union all ")}) x group by 1`, params);
  const naturezas = await ctx.tx.query<{ id: string; parent_id: string | null; code: string; name: string; grupo_dre: string | null; nature: NaturezaParaDre["nature"]; classification: string }>(
    "select id, parent_id, code, name, grupo_dre, nature, classification from erp.financial_categories where organization_id=$1", [ctx.orgId]);
  const dre = montarDre(
    linhas.rows.map((l): LinhaDre => ({ naturezaId: l.natureza_id, valor: l.valor })),
    naturezas.rows.map((n): NaturezaParaDre => ({ id: n.id, parentId: n.parent_id, codigo: n.code, nome: n.name, grupoDre: n.grupo_dre, nature: n.nature, classification: n.classification })));
  return { ...dre, regime: p.regime, de: p.de, ate: p.ate };
}
