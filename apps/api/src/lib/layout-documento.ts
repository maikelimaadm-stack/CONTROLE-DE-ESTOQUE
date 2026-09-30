import { FORMA_UUID_PADRAO, padroesRegistroDaEstrutura, removerPadroesRegistro, resolverLayout, type EstruturaLayout, type OrigemDoLayout } from "@agro/domain";
import type { ServiceCtx } from "./context.js";

/**
 * LAYOUT DO DOCUMENTO (VENDAS-A3-1). A escolha é a do domínio (`resolverLayout`): ligado à TOP (ativo, vivo) →
 * padrão ativo da família → LAYOUT DO SISTEMA. UM dono (R1): a Central (rota de vendas), a linha da TOP (rota de
 * Configurações) e, desde a COMPRAS-03, as rotas de compras (layout efetivo e cobrança no lançamento) leem daqui.
 * Documento SEM TOP usa o do sistema (não o padrão da família: sem
 * TOP não há família escolhida, como na criação sem `tipo_operacao_id`). Recorte de organização em toda consulta.
 */
export async function layoutEfetivo(ctx: ServiceCtx, familia: string, tipoOperacaoId: string | null): Promise<{ estrutura: EstruturaLayout; origem: OrigemDoLayout; nome: string | null; id: string | null }> {
  type Linha = { id: string; nome: string; estrutura: EstruturaLayout };
  let ligado: Linha | undefined; let padrao: Linha | undefined;
  if (tipoOperacaoId) {
    ligado = (await ctx.tx.query<Linha>(
      `select l.id, l.nome, l.estrutura from erp.layout_documento_tops lt
         join erp.layouts_documento l on l.id = lt.layout_id and l.organization_id = lt.organization_id
        where lt.tipo_operacao_id = $1 and lt.organization_id = $2 and l.familia = $3 and l.is_active and l.deleted_at is null`,
      [tipoOperacaoId, ctx.orgId, familia])).rows[0];
    if (!ligado) padrao = (await ctx.tx.query<Linha>(
      `select id, nome, estrutura from erp.layouts_documento
        where organization_id = $1 and familia = $2 and padrao and is_active and deleted_at is null order by created_at limit 1`,
      [ctx.orgId, familia])).rows[0];
  }
  const r = resolverLayout(familia, { ligado: ligado?.estrutura ?? null, padraoDaFamilia: padrao?.estrutura ?? null });
  const linha = r.origem === "ligado" ? ligado : r.origem === "padrao_da_familia" ? padrao : undefined;
  return { ...r, nome: linha?.nome ?? null, id: linha?.id ?? null };
}

/* ─────────────── VENDAS-A3-1b: conferência do padrão de CADASTRO (implementação: agente A1) ─────────────── */
/**
 * Consulta ESTÁTICA de um recurso de cadastro (whitelist): nenhum identificador vem de entrada — tabela, colunas e
 * predicados são texto fixo deste arquivo; só os ids (`$1`, uuid[]) e a organização (`$2`) são parâmetros.
 * - recorte de organização IGUAL ao do cadastro (`options` em routes/resources.ts): `sharedDefaults` (Formas de
 *   pagamento) = da organização OU compartilhado (organization_id nulo); os demais, só da organização. O escopo de
 *   EMPRESA do armazém é o do RLS (erp.warehouses: empresa no escopo do módulo) — o papel da API não o ignora;
 * - ativo (`is_active`) e vivo (`deleted_at is null`; Formas de pagamento não têm exclusão lógica);
 * - rótulo = o `labelField` do registry (o `label` que a rota de opções devolve ao RefSelect);
 * - `filtros`: o filtro do CATÁLOGO (`referencia.filtro`, forma canônica de `chaveDoFiltro`) → coluna booleana que a
 *   consulta devolve com o predicado já traduzido em SQL. Filtro que não está aqui = inválido (nunca "sem filtro").
 */
interface ConsultaDoPadrao { sql: string; filtros: ReadonlyMap<string, string>; comEmpresa: boolean }
type LinhaDoPadrao = { id: string; rotulo: string; empresa_id: string | null } & Record<string, unknown>;

const CONSULTA_DO_PADRAO: ReadonlyMap<string, ConsultaDoPadrao> = new Map<string, ConsultaDoPadrao>([
  // COMPRAS-03 (decisão 269): `is_provider=true` é o filtro do Fornecedor no catálogo de compras. Coluna a MAIS na
  // mesma consulta: as de vendas (cliente, proprietário, transportadora) respondem exatamente como antes.
  ["people", {
    sql: `select t.id::text as id, t.name::text as rotulo, null::text as empresa_id,
                 t.is_client as f_cliente, t.is_proprietary as f_proprietario, t.is_transporter as f_transportadora,
                 t.is_provider as f_fornecedor
            from erp.people t
           where t.id = any($1::uuid[]) and t.organization_id = $2 and t.is_active and t.deleted_at is null`,
    filtros: new Map([["is_client=true", "f_cliente"], ["is_proprietary=true", "f_proprietario"], ["is_transporter=true", "f_transportadora"],
      ["is_provider=true", "f_fornecedor"]]),
    comEmpresa: false
  }],
  ["payment_methods", {
    sql: `select t.id::text as id, t.name::text as rotulo, null::text as empresa_id, true as f_todos
            from erp.payment_methods t
           where t.id = any($1::uuid[]) and (t.organization_id is null or t.organization_id = $2) and t.is_active`,
    filtros: new Map([["", "f_todos"]]),
    comEmpresa: false
  }],
  ["financial_categories", {
    sql: `select t.id::text as id, t.name::text as rotulo, null::text as empresa_id,
                 (t.kind = 'analytic' and t.nature = 'income') as f_analitica_receita
            from erp.financial_categories t
           where t.id = any($1::uuid[]) and t.organization_id = $2 and t.is_active and t.deleted_at is null`,
    filtros: new Map([["kind=analytic&nature=income", "f_analitica_receita"]]),
    comEmpresa: false
  }],
  ["cost_centers", {
    sql: `select t.id::text as id, t.name::text as rotulo, null::text as empresa_id, (t.kind = 'analytic') as f_analitico
            from erp.cost_centers t
           where t.id = any($1::uuid[]) and t.organization_id = $2 and t.is_active and t.deleted_at is null`,
    filtros: new Map([["kind=analytic", "f_analitico"]]),
    comEmpresa: false
  }],
  ["condicoes_pagamento", {
    sql: `select t.id::text as id, t.nome::text as rotulo, null::text as empresa_id, true as f_todos
            from erp.condicoes_pagamento t
           where t.id = any($1::uuid[]) and t.organization_id = $2 and t.is_active and t.deleted_at is null`,
    filtros: new Map([["", "f_todos"]]),
    comEmpresa: false
  }],
  ["warehouses", {
    sql: `select t.id::text as id, t.description::text as rotulo, t.empresa_id::text as empresa_id, true as f_todos
            from erp.warehouses t
           where t.id = any($1::uuid[]) and t.organization_id = $2 and t.is_active and t.deleted_at is null`,
    filtros: new Map([["", "f_todos"]]),
    comEmpresa: true
  }]
]);

/** Forma canônica do filtro do catálogo: pares `chave=valor` em ordem de chave, unidos por "&"; sem filtro = "". */
function chaveDoFiltro(filtro: Readonly<Record<string, string>> | undefined): string {
  return Object.entries(filtro ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("&");
}

/** Registro padrão que vale AGORA nesta organização: id, o mesmo rótulo que o RefSelect mostra e, no armazém, a empresa. */
export interface RegistroPadraoConferido { id: string; rotulo: string; empresaId?: string | null }
/**
 * Confere TODOS os padrões `registro` da estrutura nesta organização (padroesRegistroDaEstrutura do domínio): mapa
 * ESTÁTICO recurso → SQL (whitelist), o mesmo recorte de organização do cadastro (payment_methods: organização OU
 * compartilhado), ativo e vivo, e o filtro do catálogo. UMA consulta por recurso presente (`= any($ids)`), sem N+1.
 * `validos`: chavePadraoDeCadastro → registro; `invalidos`: os que não valem (inexistente, outra organização, inativo,
 * excluído, fora do filtro, campo sem `referencia`), com o caminho do valorPadrao e o rótulo do campo.
 */
export async function conferirPadroesRegistro(ctx: ServiceCtx, familia: string, estrutura: EstruturaLayout): Promise<{
  validos: Map<string, RegistroPadraoConferido>;
  invalidos: { chave: string; caminho: string; rotulo: string }[];
}> {
  const padroes = padroesRegistroDaEstrutura(familia, estrutura);
  const validos = new Map<string, RegistroPadraoConferido>();
  if (!padroes.length) return { validos, invalidos: [] };
  // veredito por padrão, na ORDEM da estrutura (o primeiro inválido é o primeiro detalhe da recusa)
  const veredito: (RegistroPadraoConferido | null)[] = padroes.map(() => null);
  const porRecurso = new Map<ConsultaDoPadrao, { i: number; id: string; coluna: string }[]>();
  padroes.forEach((p, i) => {
    // campo sem `referencia`, recurso fora da whitelist, filtro desconhecido ou id fora da forma UUID: inválido SEM
    // consulta (discriminador desconhecido NEGA; e um id malformado nunca chega ao cast `::uuid[]` do banco)
    const consulta = p.referencia ? CONSULTA_DO_PADRAO.get(p.referencia.recurso) : undefined;
    const coluna = consulta?.filtros.get(chaveDoFiltro(p.referencia?.filtro));
    if (!consulta || !coluna || !FORMA_UUID_PADRAO.test(p.id)) return;
    const lista = porRecurso.get(consulta) ?? [];
    lista.push({ i, id: p.id.toLowerCase(), coluna });
    porRecurso.set(consulta, lista);
  });
  // UMA consulta por recurso presente (`= any($1)`), com o recorte de organização do cadastro
  for (const [consulta, pedidos] of porRecurso) {
    const r = await ctx.tx.query<LinhaDoPadrao>(consulta.sql, [[...new Set(pedidos.map((x) => x.id))], ctx.orgId]);
    const porId = new Map(r.rows.map((x) => [x.id, x]));
    for (const { i, id, coluna } of pedidos) {
      const linha = porId.get(id);
      if (!linha || linha[coluna] !== true) continue;
      veredito[i] = { id: linha.id, rotulo: linha.rotulo, ...(consulta.comEmpresa ? { empresaId: linha.empresa_id } : {}) };
    }
  }
  const invalidos: { chave: string; caminho: string; rotulo: string }[] = [];
  padroes.forEach((p, i) => {
    const v = veredito[i];
    if (v) validos.set(p.chave, v);
    else invalidos.push({ chave: p.chave, caminho: p.caminho, rotulo: p.rotulo });
  });
  return { validos, invalidos };
}

/* ─────────────── COMPRAS-03: a resposta do `/layout-efetivo` da Central ─────────────── */
/** O contrato do `/layout-efetivo` da Central (VENDAS-A3-1 + A3-1b): os dois mapas só existem com padrão de cadastro. */
export interface LayoutEfetivoDaCentral {
  estrutura: EstruturaLayout; origem: OrigemDoLayout; nome: string | null; id: string | null;
  padroesDeCadastro?: Record<string, RegistroPadraoConferido>; padroesInvalidos?: string[];
}
/**
 * A RESPOSTA do `/layout-efetivo` para a TOP JÁ CONFERIDA pela rota (a 404 uniforme é da rota: cada porta sabe a sua
 * família e a sua permissão). É o contrato do `/layout-efetivo` de vendas (`sales.ts`), escrito aqui para as rotas de
 * compras (COMPRAS-03, decisão 269) — `sales.ts` fica como está nesta fatia, e a web lê as duas respostas com o MESMO
 * leitor. Layout SEM padrão `registro` (inclusive o do sistema) responde só `{ estrutura, origem, nome, id }`, sem
 * consulta a mais; com padrão registro, a `estrutura` sai SEM eles e eles vêm à parte, CONFERIDOS AGORA nesta
 * organização: `padroesDeCadastro` = os que valem, `padroesInvalidos` = as chaves dos que morreram.
 */
export async function respostaDoLayoutEfetivo(ctx: ServiceCtx, familia: string, tipoOperacaoId: string): Promise<LayoutEfetivoDaCentral> {
  const l = await layoutEfetivo(ctx, familia, tipoOperacaoId);
  if (!padroesRegistroDaEstrutura(familia, l.estrutura).length) return { estrutura: l.estrutura, origem: l.origem, nome: l.nome, id: l.id };
  const c = await conferirPadroesRegistro(ctx, familia, l.estrutura);
  const padroesDeCadastro: Record<string, RegistroPadraoConferido> = Object.fromEntries([...c.validos].map(([chave, v]) =>
    [chave, { id: v.id, rotulo: v.rotulo, ...(v.empresaId !== undefined ? { empresaId: v.empresaId } : {}) }]));
  const padroesInvalidos = [...new Set(c.invalidos.map((x) => x.chave))];
  return { estrutura: removerPadroesRegistro(l.estrutura), origem: l.origem, nome: l.nome, id: l.id, padroesDeCadastro, padroesInvalidos };
}
