import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { addDays, isISODate, money } from "@agro/shared";
import {
  CODIGO_DO_TIPO_LCDPR, PERIODO_MAXIMO_CONFERENCIA_LCDPR_DIAS, SITUACOES_CONFERENCIA_LCDPR, TIPOS_LCDPR_NO_LIVRO, TIPO_LCDPR_FORA,
  type TipoLcdprNoLivro
} from "@agro/domain";
import { runService, comPermissaoResolvida } from "../lib/service.js";
import { empresaScope, empresaPermitida, hasPermission } from "../lib/context.js";
import { denied, err, validation } from "../lib/errors.js";
import { paginaComIdGlobal } from "../lib/id-global.js";
import { imoveisRuraisDaEmpresa } from "../lib/imovel-rural.js";

/**
 * O LCDPR (Livro Caixa Digital do Produtor Rural) NA API (OPERACOES-01 F9, decisão 286). Os DADOS desde já — o
 * arquivo oficial fica para depois (fora desta PR). Prefixo próprio (`/api/financeiro/*`); a web só pergunta com a
 * capacidade `lcdpr` declarada em `/auth/context`.
 *
 *   · `GET /financeiro/imoveis-rurais/opcoes?empresa_id=` — os imóveis rurais ativos de UMA empresa, o padrão primeiro
 *     (o campo "Imóvel rural" da baixa e do movimento). Porta dinâmica: quem baixa título ou lança movimento
 *     (`payables.settle`, `receivables.settle` ou `bank_movements.create`), no módulo financeiro; nenhuma → 403. A
 *     empresa é PEDIDO: inexistente, de outro tenant ou fora do escopo → a MESMA 404.
 *   · `GET /financeiro/lcdpr/conferencia` — a CONFERÊNCIA por período (`report.cash_book.view`, a do Livro Caixa).
 *
 * A CONFERÊNCIA LÊ O LIVRO CAIXA: uma linha por RATEIO de movimento bancário CONFIRMADO (o movimento inteiro, quando
 * não tem rateio — sem natureza), sem transferência entre contas nem saldo inicial, no período, sob a RLS e o escopo
 * de empresa do módulo. O tipo da linha é o "Tipo no LCDPR" da natureza; "fora" nunca aparece.
 *   · O VALOR é o do CAIXA (valor + juros, como o fluxo e o saldo): o rateio é gravado sobre o valor SEM os juros
 *     (`createBankMovement`), então os juros do movimento são distribuídos pelas linhas do rateio pelo percentual de
 *     cada uma (2 casas), com a sobra do arredondamento na ÚLTIMA linha — a soma das linhas é exatamente o caixa. A
 *     distribuição é feita sobre TODAS as linhas do movimento, antes do "fora" e do filtro de tipo;
 *   · CONFERIDAS = tipo 1, 2 ou 3 E imóvel rural (o que o livro levaria);
 *   · PENDENTES = sem natureza, sem tipo, sem imóvel ou SEM EMPRESA. O movimento sem empresa nunca terá imóvel (o CHECK
 *     da 0045): ele vai para a pendência própria "sem empresa", e não para "sem imóvel" (que só conta o que se acerta
 *     escolhendo o imóvel).
 * Documento = o do movimento; senão os números dos títulos que ele baixou; senão o código do movimento. Participante =
 * a pessoa do movimento; senão a pessoa ÚNICA dos títulos baixados por ele; senão nenhum. Tudo no MESMO SQL (sem N+1):
 * UMA consulta da página e UMA dos totais (as conferidas por tipo) e das pendências, mais o ID Global da página em lote.
 * Dinheiro em texto decimal.
 */
const UUID = z.string().uuid();
const DATA = z.string().refine(isISODate, "Data inválida");
const opcoesQuery = z.object({ empresa_id: UUID }).strict();
const conferenciaQuery = z.object({
  de: DATA, ate: DATA, empresa_id: UUID.optional(), imovel_rural_id: UUID.optional(),
  // Os tipos que ENTRAM no livro, a lista do domínio ("fora" não é filtro: nunca aparece).
  tipo: z.enum(TIPOS_LCDPR_NO_LIVRO).optional(),
  situacao: z.enum(SITUACOES_CONFERENCIA_LCDPR).default("conferidas"),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50)
}).strict();

/** Quem pode pedir as opções de imóvel: quem baixa (as duas direções) ou lança movimento. */
const PERMISSOES_DAS_OPCOES = ["payables.settle", "receivables.settle", "bank_movements.create"] as const;

/** O texto é um dos tipos que entram no livro? (A lista do domínio; "fora" e nulo não entram.) */
const ehTipoDoLivro = (v: string | null): v is TipoLcdprNoLivro => v !== null && (TIPOS_LCDPR_NO_LIVRO as readonly string[]).includes(v);

/**
 * A linha está CONFERIDA (tipo do livro e imóvel)? Sobre o alias `l` da CTE; `tipos` é o parâmetro com a lista do
 * domínio. Nunca NULO (o `coalesce`): sem natureza ou sem tipo, `= any(…)` daria NULL, e `not NULL` some do filtro das
 * PENDENTES — a linha não estaria em lado nenhum.
 */
const conferida = (tipos: string) => `(coalesce(l.tipo_lcdpr = any(${tipos}::text[]), false) and l.imovel_rural_id is not null)`;

interface LinhaDaPagina {
  id: string; movimento_id: string; data: string; tipo_movimento: "in" | "out"; valor: string; historico: string | null; documento: string; sem_empresa: boolean;
  imovel_id: string | null; imovel_nome: string | null; imovel_cib: string | null;
  conta_id: string; conta_codigo: string; conta_descricao: string;
  participante_nome: string | null; participante_documento: string | null;
  tipo: string | null; natureza_id: string | null; natureza_codigo: string | null; natureza_nome: string | null;
}
/** Os totais lidos: `e<i>`/`s<i>` = entradas/saídas conferidas do i-ésimo tipo de `TIPOS_LCDPR_NO_LIVRO`. */
interface Totais {
  total: number;
  sem_imovel_n: number; sem_imovel_v: string; sem_empresa_n: number; sem_empresa_v: string; sem_tipo_n: number; sem_tipo_v: string;
  [coluna: `${"e" | "s"}${number}`]: string;
}

export default async function financeiroLcdprRoutes(app: FastifyInstance) {
  app.get("/financeiro/imoveis-rurais/opcoes", async (req) => runService(app, req, null, async (ctx0) => {
    const permissao = PERMISSOES_DAS_OPCOES.find((p) => hasPermission(ctx0, p));
    if (!permissao) throw denied(PERMISSOES_DAS_OPCOES[0]);
    const ctx = await comPermissaoResolvida(ctx0, permissao);
    const q = opcoesQuery.parse(req.query);
    if (!(await empresaPermitida(ctx, q.empresa_id))) throw err("NOT_FOUND", "Empresa não encontrada");
    return { itens: await imoveisRuraisDaEmpresa(ctx, q.empresa_id) };
  }));

  app.get("/financeiro/lcdpr/conferencia", async (req) => runService(app, req, "report.cash_book.view", async (ctx) => {
    const q = conferenciaQuery.parse(req.query);
    if (q.de > q.ate) throw validation("Período inválido: o início é depois do fim", [{ path: ["de"], message: "Período inválido" }]);
    if (addDays(q.de, PERIODO_MAXIMO_CONFERENCIA_LCDPR_DIAS - 1) < q.ate) {
      const m = `Período maior que ${PERIODO_MAXIMO_CONFERENCIA_LCDPR_DIAS} dias: confira o livro por ano`;
      throw validation(m, [{ path: ["ate"], message: m }]);
    }
    const params: unknown[] = [ctx.orgId, q.de, q.ate];
    const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const where = ["m.organization_id=$1", "m.status='confirmed'", "m.deleted_at is null", "m.category_type not in ('internal_transfer','opening_balance')", "m.movement_date between $2::date and $3::date"];
    if (q.empresa_id) where.push(`m.empresa_id=${add(q.empresa_id)}`);
    if (q.imovel_rural_id) where.push(`m.imovel_rural_id=${add(q.imovel_rural_id)}`);
    // O movimento sem empresa é da organização e continua visível (como a RLS de leitura); a empresa selecionada no
    // contexto de trabalho não recorta — o livro é filtrado pela empresa PEDIDA na query.
    where.push(...empresaScope(ctx, "m", params, { nullable: true, ignoreSelected: true }));
    const tipo = q.tipo ? ` and fc.tipo_lcdpr=${add(q.tipo)}` : "";
    const fora = add(TIPO_LCDPR_FORA);
    const conferidaAqui = conferida(add([...TIPOS_LCDPR_NO_LIVRO]));
    // `b`: as linhas de TODOS os rateios dos movimentos do período, com os juros distribuídos (pelo percentual, a sobra
    // na última linha por id) — ANTES do "fora" e do filtro de tipo, que tiram linhas mas não mudam a parte de cada uma.
    const linhas = `with b as (
      select m.id as movimento_id, coalesce(a.id, m.id) as linha_id, m.movement_date, m.code, m.type, m.document, m.note, m.person_id,
             m.bank_account_id, m.imovel_rural_id, m.empresa_id, a.financial_category_id as natureza_id,
             case when a.id is null then m.amount + m.interest
                  when row_number() over r = count(*) over (partition by m.id)
                    then a.amount + m.interest - (sum(round(m.interest * a.percentage / 100, 2)) over r - round(m.interest * a.percentage / 100, 2))
                  else a.amount + round(m.interest * a.percentage / 100, 2) end as valor
        from erp.bank_movements m
        left join erp.bank_movement_apportionments a on a.movement_id = m.id
       where ${where.join(" and ")}
      window r as (partition by m.id order by a.id)),
    l as (
      select b.*, fc.tipo_lcdpr
        from b
        left join erp.financial_categories fc on fc.id = b.natureza_id and fc.organization_id = $1
       where fc.tipo_lcdpr is distinct from ${fora}${tipo})`;
    const situacao = q.situacao === "conferidas" ? conferidaAqui : `not ${conferidaAqui}`;
    // Os totais por tipo, um par de colunas por tipo do domínio — parâmetros SÓ desta consulta (a da página não os usa).
    const paramsDosTotais = [...params];
    const somas = TIPOS_LCDPR_NO_LIVRO.map((tipoDoLivro, i) => {
      paramsDosTotais.push(tipoDoLivro);
      const p = `$${paramsDosTotais.length}`;
      return `coalesce(sum(l.valor) filter (where ${conferidaAqui} and l.tipo_lcdpr=${p} and l.type='in'),0)::text as e${i},
              coalesce(sum(l.valor) filter (where ${conferidaAqui} and l.tipo_lcdpr=${p} and l.type='out'),0)::text as s${i}`;
    });
    const t = (await ctx.tx.query<Totais>(
      `${linhas}
       select count(*) filter (where ${situacao})::int as total,
              ${somas.join(",\n              ")},
              count(*) filter (where l.empresa_id is not null and l.imovel_rural_id is null)::int as sem_imovel_n,
              coalesce(sum(l.valor) filter (where l.empresa_id is not null and l.imovel_rural_id is null),0)::text as sem_imovel_v,
              count(*) filter (where l.empresa_id is null)::int as sem_empresa_n, coalesce(sum(l.valor) filter (where l.empresa_id is null),0)::text as sem_empresa_v,
              count(*) filter (where l.tipo_lcdpr is null)::int as sem_tipo_n, coalesce(sum(l.valor) filter (where l.tipo_lcdpr is null),0)::text as sem_tipo_v
         from l`, paramsDosTotais)).rows[0]!;
    const pagina = await ctx.tx.query<LinhaDaPagina>(
      `${linhas},
       p as (
         select l.*,
                coalesce(nullif(l.document, ''),
                  (select string_agg(distinct x.number, ', ' order by x.number) from erp.title_settlements s join erp.financial_titles x on x.id = s.title_id and x.organization_id = s.organization_id
                    where s.bank_movement_id = l.movimento_id and s.status = 'confirmed'),
                  l.code) as documento,
                coalesce(l.person_id,
                  (select case when count(distinct x.person_id) = 1 then (array_agg(x.person_id) filter (where x.person_id is not null))[1] end
                     from erp.title_settlements s join erp.financial_titles x on x.id = s.title_id and x.organization_id = s.organization_id
                    where s.bank_movement_id = l.movimento_id and s.status = 'confirmed')) as participante_id
           from l where ${situacao}
          order by l.movement_date, l.code, l.linha_id
          limit ${add(q.pageSize)} offset ${add((q.page - 1) * q.pageSize)})
       select p.linha_id::text as id, p.movimento_id::text as movimento_id, to_char(p.movement_date, 'YYYY-MM-DD') as data, p.type as tipo_movimento,
              p.valor::text as valor, p.note as historico, p.documento, (p.empresa_id is null) as sem_empresa,
              ir.id::text as imovel_id, ir.nome as imovel_nome, ir.cib as imovel_cib,
              ba.id::text as conta_id, ba.code as conta_codigo, ba.description as conta_descricao,
              pe.name as participante_nome, pe.document as participante_documento,
              p.tipo_lcdpr as tipo, fc.id::text as natureza_id, fc.code as natureza_codigo, fc.name as natureza_nome
         from p
         join erp.bank_accounts ba on ba.id = p.bank_account_id and ba.organization_id = $1
         left join erp.imoveis_rurais ir on ir.id = p.imovel_rural_id and ir.organization_id = $1
         left join erp.financial_categories fc on fc.id = p.natureza_id and fc.organization_id = $1
         left join erp.people pe on pe.id = p.participante_id and pe.organization_id = $1
        order by p.movement_date, p.code, p.linha_id`, params);
    const itens = pagina.rows.map((r) => {
      const tipoDoLivro = ehTipoDoLivro(r.tipo) ? r.tipo : null;
      return {
        id: r.id, movimento_id: r.movimento_id, data: r.data,
        imovel: r.imovel_id && r.imovel_nome !== null ? { id: r.imovel_id, nome: r.imovel_nome, cib: r.imovel_cib } : null,
        // O movimento sem empresa nunca terá imóvel: a tela diz "Sem empresa", não "Sem imóvel".
        sem_empresa: r.sem_empresa,
        conta: { id: r.conta_id, codigo: r.conta_codigo, descricao: r.conta_descricao },
        documento: r.documento,
        participante: r.participante_nome !== null ? { nome: r.participante_nome, documento: r.participante_documento } : null,
        tipo: tipoDoLivro, tipo_codigo: tipoDoLivro ? CODIGO_DO_TIPO_LCDPR[tipoDoLivro] : null,
        natureza: r.natureza_id && r.natureza_codigo !== null && r.natureza_nome !== null ? { id: r.natureza_id, codigo: r.natureza_codigo, nome: r.natureza_nome } : null,
        entrada: r.tipo_movimento === "in" ? money(r.valor) : "0.00",
        saida: r.tipo_movimento === "out" ? money(r.valor) : "0.00",
        historico: r.historico
      };
    });
    const comId = await paginaComIdGlobal(ctx, "bank_movements", { items: itens }, { coluna: "movimento_id" });
    // A coluna `e<i>`/`s<i>` existe por construção (a consulta acima tem um par por tipo); ausente = erro de programação.
    const coluna = (k: `${"e" | "s"}${number}`): string => {
      const v = t[k];
      if (v === undefined) throw new Error(`conferência do LCDPR: coluna ${k} ausente nos totais`);
      return v;
    };
    const totais = Object.fromEntries(TIPOS_LCDPR_NO_LIVRO.map((tipoDoLivro, i) =>
      [tipoDoLivro, { entradas: money(coluna(`e${i}`)), saidas: money(coluna(`s${i}`)) }])) as Record<TipoLcdprNoLivro, { entradas: string; saidas: string }>;
    return {
      de: q.de, ate: q.ate, situacao: q.situacao, itens: comId.items, total: t.total, page: q.page, pageSize: q.pageSize,
      totais,
      pendencias: {
        sem_imovel: { quantidade: t.sem_imovel_n, valor: money(t.sem_imovel_v) },
        sem_tipo: { quantidade: t.sem_tipo_n, valor: money(t.sem_tipo_v) },
        sem_empresa: { quantidade: t.sem_empresa_n, valor: money(t.sem_empresa_v) }
      },
      idGlobal: comId.idGlobal
    };
  }));
}
