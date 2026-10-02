/**
 * ═══ PORTAL DE ESTOQUE — O QUE AS ROTAS DO DOCUMENTO DE ESTOQUE COMPARTILHAM (ESTOQUE-01, decisão 274) ═══
 *
 * `estoque-documentos.ts` (lista, operações, lançar, consultar) e `estoque-confirmacao.ts` (prévia, confirmar,
 * cancelar) leem o MESMO documento pela MESMA porta. Ficam aqui, e só aqui:
 *   · a tabela espécie × segmento × recurso — DERIVADA do domínio, nunca reescrita ao lado;
 *   · a leitura do documento (`lerDocumentoEstoque`), que é a superfície de recusa do portal: id malformado,
 *     inexistente, de outro tenant, fora do escopo de empresa e de OUTRA ESPÉCIE caem na MESMA 404;
 *   · o corpo do cancelamento e o motivo padrão.
 * Um módulo à parte (e não `estoque-documentos.ts` exportando para a confirmação) porque os dois arquivos se
 * importam: a lista registra a confirmação no fim, e a confirmação lê o documento — o ciclo de import entre
 * duas rotas é o tipo de dependência que só aparece quando alguém reordena o registro.
 *
 * OPERACOES-01 F5a (decisão 282): as SETE espécies (`TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE` — as quatro da Central de
 * hoje e as três da movimentação interna) nascem da MESMA lista, e a leitura traz o que a movimentação interna
 * acrescentou — o destino com os nomes, a origem, os documentos vinculados e o ATENDIMENTO calculado da requisição —
 * pelas junções e subconsultas das MESMAS três consultas. A expressão do atendimento mora aqui, UMA vez
 * (`SQL_ATENDIMENTO_REQUISICAO`), e serve a leitura e a lista.
 */
import { z } from "zod";
import {
  TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE, SEGMENTO_DA_ESPECIE_ESTOQUE, RECURSO_DA_ESPECIE_ESTOQUE,
  type EspecieEstoque, type SegmentoEstoque, type SituacaoDocumentoEstoque, type AtendimentoRequisicaoEstoque,
  type MotivoSaidaEstoque,
} from "@agro/domain";
import { notFound } from "../lib/errors.js";
import { hasPermission, scopedById, type ServiceCtx } from "../lib/context.js";

// ─────────────── espécies ───────────────

export type RecursoEstoque = (typeof RECURSO_DA_ESPECIE_ESTOQUE)[EspecieEstoque];

/**
 * A espécie, o segmento da rota e o recurso de permissão. Uma lista só, montada a partir do domínio — das SETE
 * espécies (a Central de hoje continua oferecendo as quatro dela; as rotas, a lista única e a fila de aprovação
 * servem as sete).
 */
export const ESPECIES_ESTOQUE: readonly { especie: EspecieEstoque; segmento: SegmentoEstoque; recurso: RecursoEstoque }[] =
  Object.freeze(TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE.map((especie) => Object.freeze({
    especie, segmento: SEGMENTO_DA_ESPECIE_ESTOQUE[especie], recurso: RECURSO_DA_ESPECIE_ESTOQUE[especie],
  })));

/**
 * A forma de um UUID. Conferida ANTES de qualquer consulta que receba o id da URL: sem ela, `'abc'::uuid`
 * estoura 22P02 no banco e a resposta vira 500 — e um 500 para "malformado" ao lado de 404 para "inexistente"
 * é um oráculo de formato.
 */
export const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─────────────── cancelamento ───────────────

/** O motivo gravado quando o usuário cancela sem dizer por quê: a coluna nunca fica vazia num cancelado. */
export const MOTIVO_PADRAO_CANCELAMENTO = "Cancelado sem motivo informado";

/**
 * O corpo do cancelamento: motivo opcional, aparado, até 500. Vazio ou só espaços vira `null` (e quem cancela
 * grava o motivo padrão). `.strict()`: chave desconhecida é 422 — nunca descartada em silêncio.
 */
export const cancelarSchema = z.object({
  motivo: z.string().trim().max(500).nullish().transform((v) => (v ? v : null)),
}).strict();

// ─────────────── leitura ───────────────

/** A TOP do documento como a tela a mostra: a identidade e a versão CONGELADA no lançamento. */
export interface TopParaTela { id: string; codigo: string; codigo_base: string | null; nome: string; versao: number | null }

/** As colunas da TOP que a leitura e a lista trazem pela junção (versão congelada, não a atual). */
export interface ColunasDaTop {
  tipo_operacao_id: string | null; top_codigo: string | null; top_codigo_base: string | null; top_nome: string | null; top_versao: number | null;
}

export const topParaTela = (l: ColunasDaTop): TopParaTela | null =>
  l.tipo_operacao_id && l.top_codigo && l.top_nome
    ? { id: l.tipo_operacao_id, codigo: l.top_codigo, codigo_base: l.top_codigo_base, nome: l.top_nome, versao: l.top_versao }
    : null;

// ─────────────── a conta da movimentação interna (UM dono) ───────────────

/**
 * O que um item da REQUISIÇÃO já teve atendido: a soma das quantidades ligadas a ele em consumos NÃO cancelados
 * (abertos inclusive — a parte deles saiu do saldo pendente e foi para a reserva do consumo). É a MESMA conta da
 * reserva (parte C1, 0043) e da guarda dos itens: o saldo do item é a quantidade menos isto. `item` é o apelido da
 * linha de `erp.documentos_estoque_itens` na consulta de quem chama.
 */
export const sqlAtendidoDoItem = (item: string): string =>
  `coalesce((select sum(ci.quantidade) from erp.documentos_estoque_itens ci
              join erp.documentos_estoque cd on cd.id = ci.documento_id and cd.organization_id = ci.organization_id
             where ci.origem_item_id = ${item}.id and ci.organization_id = ${item}.organization_id
               and cd.especie = 'consumo' and cd.situacao <> 'cancelado'), 0)`;

/** O que um item do CONSUMO já teve devolvido: a soma ligada a ele em devoluções de consumo NÃO canceladas. */
export const sqlDevolvidoDoItem = (item: string): string =>
  `coalesce((select sum(di.quantidade) from erp.documentos_estoque_itens di
              join erp.documentos_estoque dd on dd.id = di.documento_id and dd.organization_id = di.organization_id
             where di.origem_item_id = ${item}.id and di.organization_id = ${item}.organization_id
               and dd.especie = 'devolucao_consumo' and dd.situacao <> 'cancelado'), 0)`;

/**
 * O ATENDIMENTO DA REQUISIÇÃO — calculado, nunca uma situação do banco (D3 do plano da F5a), sobre o cabeçalho de
 * apelido `d`. A expressão mora AQUI, uma vez, e serve a leitura (`lerDocumentoEstoque`) e a lista única (a coluna e o
 * filtro `atendimento`):
 *   · requisição CONFIRMADA (= a pendente) com o saldo encerrado → `encerrado`;
 *   · senão, nenhum item com saldo → `atendido`; nada atendido ainda → `pendente`; o resto → `parcial`;
 *   · qualquer outra espécie ou situação → `null`.
 * Uma subconsulta pelos itens da própria requisição (índice da origem dos itens), nunca uma consulta por linha na API.
 */
export const SQL_ATENDIMENTO_REQUISICAO = `(case when d.especie = 'requisicao' and d.situacao = 'confirmado' then
     case when d.saldo_encerrado_em is not null then 'encerrado'
          else (select case when coalesce(sum(greatest(ri.quantidade - ra.q, 0)), 0) = 0 then 'atendido'
                            when coalesce(sum(ra.q), 0) = 0 then 'pendente'
                            else 'parcial' end
                  from erp.documentos_estoque_itens ri
                  cross join lateral (select ${sqlAtendidoDoItem("ri")} as q) ra
                 where ri.documento_id = d.id and ri.organization_id = d.organization_id) end
   end)`;

/** Um item como a Central o mostra. Números como TEXTO (o `pg` devolve `numeric` como string; nada vira float). */
export interface ItemDocumentoEstoqueLido {
  id: string;
  posicao: number;
  produto_id: string;
  produto_codigo: string | null;
  produto_nome: string;
  unidade: string | null;
  /** `nenhum` | `lote` | `lote_validade` — o controle de HOJE do produto (a confirmação confere de novo). */
  produto_controle_lote: string;
  lote: string | null;
  validade: string | null;
  quantidade: string | null;
  quantidade_contada: string | null;
  custo_unitario: string | null;
  saldo_na_confirmacao: string | null;
  diferenca: string | null;
  observacao: string | null;
  /** O item de origem: o da requisição que esta linha do consumo atende, ou o do consumo que esta devolução devolve. */
  origem_item_id: string | null;
  /** Requisição: quanto já foi atendido (consumos não cancelados). Outras espécies: `null`. */
  quantidade_atendida: string | null;
  /** Requisição confirmada: o saldo pendente (zero com o saldo encerrado). Outras espécies e situações: `null`. */
  saldo_pendente: string | null;
  /** Consumo: quanto já voltou (devoluções não canceladas). Outras espécies: `null`. */
  quantidade_devolvida: string | null;
}

/** Um movimento do ledger produzido pelo documento (inclusive os estornos do cancelamento). */
export interface MovimentoDocumentoEstoqueLido {
  id: string;
  movement_type: string;
  direction: number;
  quantity: string;
  unit_cost: string;
  total_cost: string;
  provider_lot: string | null;
  expiration_date: string | null;
  movement_date: string;
  product_id: string;
  product_name: string;
  warehouse_id: string;
  warehouse_name: string;
}

/** Outro documento de estoque citado por este: a origem, ou um dos que apontam este como origem. */
export interface DocumentoRelacionadoLido {
  id: string;
  codigo: string;
  especie: EspecieEstoque;
  situacao: SituacaoDocumentoEstoque;
}
export interface DocumentoVinculadoLido extends DocumentoRelacionadoLido { data_documento: string }

export interface DocumentoEstoqueLido {
  id: string;
  organization_id: string;
  empresa_id: string;
  especie: EspecieEstoque;
  codigo: string;
  situacao: SituacaoDocumentoEstoque;
  tipo_operacao_id: string;
  tipo_operacao_versao_id: string;
  armazem_id: string;
  armazem_destino_id: string | null;
  data_documento: string;
  observacao: string | null;
  criado_por: string | null;
  confirmado_em: Date | null;
  confirmado_por: string | null;
  cancelado_em: Date | null;
  cancelado_por: string | null;
  motivo_cancelamento: string | null;
  created_at: Date;
  atualizado_em: Date;
  // ── OPERACOES-01 F5a (0043): origem, destino, motivo da saída e saldo encerrado da requisição ──
  origem_documento_id: string | null;
  centro_custo_id: string | null;
  equipamento_id: string | null;
  ordem_servico_id: string | null;
  lote_animais_id: string | null;
  area_id: string | null;
  safra_id: string | null;
  motivo_saida: MotivoSaidaEstoque | null;
  justificativa: string | null;
  saldo_encerrado_em: Date | null;
  saldo_encerrado_por: string | null;
  saldo_encerrado_motivo: string | null;
  empresa_nome: string | null;
  armazem_nome: string | null;
  armazem_destino_nome: string | null;
  criado_por_nome: string | null;
  confirmado_por_nome: string | null;
  cancelado_por_nome: string | null;
  centro_custo_nome: string | null;
  equipamento_nome: string | null;
  ordem_servico_codigo: string | null;
  lote_animais_nome: string | null;
  area_nome: string | null;
  safra_nome: string | null;
  saldo_encerrado_por_nome: string | null;
  /**
   * O documento de origem (a requisição do consumo, o consumo da devolução), ou `null` — também quando quem lê não tem
   * a `.view` da espécie dele (`relacionadosVisiveis`). O `origem_documento_id` do cabeçalho continua: é deste documento.
   */
  origem: DocumentoRelacionadoLido | null;
  /**
   * Os documentos que apontam ESTE como origem (consumos da requisição, devoluções do consumo) e que quem lê pode ver
   * (a `.view` da espécie de cada um); `[]` se nenhum.
   */
  vinculados: DocumentoVinculadoLido[];
  /** O atendimento calculado da requisição confirmada (`SQL_ATENDIMENTO_REQUISICAO`); `null` nas outras. */
  atendimento: AtendimentoRequisicaoEstoque | null;
  tipo_operacao: TopParaTela | null;
  itens: ItemDocumentoEstoqueLido[];
  movimentos: MovimentoDocumentoEstoqueLido[];
}

type CabecalhoLido = Omit<DocumentoEstoqueLido, "tipo_operacao" | "itens" | "movimentos"> & Omit<ColunasDaTop, "tipo_operacao_id">;

/**
 * CAPACIDADE × ESCOPO NOS DOCUMENTOS CITADOS (OPERACOES-01 F5a). A origem e os vinculados são de OUTRA espécie (a
 * requisição de um consumo, os consumos de uma requisição, as devoluções de um consumo), e cada espécie tem o seu
 * recurso: quem lê a requisição sem `consumos_estoque.view` não vê os consumos dela — nem o id, nem o código, nem a
 * situação, nem a data. O ESCOPO já é o mesmo (o gatilho da 0043 prende origem e vinculados à MESMA empresa e ao MESMO
 * local de estoque, e as sete espécies são do módulo estoque); falta só a CAPACIDADE, conferida aqui, em memória, sem
 * consulta. O documento sem a `.view` some da resposta como se não existisse — nunca vira um "sem acesso" que diria que
 * ele existe. O dono da organização vê tudo (`hasPermission`).
 */
function relacionadosVisiveis(ctx: ServiceCtx, origem: DocumentoRelacionadoLido | null, vinculados: DocumentoVinculadoLido[]): { origem: DocumentoRelacionadoLido | null; vinculados: DocumentoVinculadoLido[] } {
  const podeVer = (especie: EspecieEstoque): boolean => hasPermission(ctx, `${RECURSO_DA_ESPECIE_ESTOQUE[especie]}.view`);
  return { origem: origem && podeVer(origem.especie) ? origem : null, vinculados: vinculados.filter((v) => podeVer(v.especie)) };
}

/**
 * CARREGA O DOCUMENTO JÁ AMARRADO À ESPÉCIE DA PORTA — a MESMA leitura do GET, da prévia, da confirmação e do
 * cancelamento. Espécie errada, inexistente, de outro tenant, fora do escopo de empresa (módulo estoque, o da
 * permissão da rota) e id malformado caem na MESMA 404, com a mesma mensagem.
 *
 * `lock` trava SÓ o cabeçalho (`for update of d`): é o que serializa confirmar e cancelar o mesmo documento. Os
 * itens e os movimentos são lidos DEPOIS da trava, então quem travou enxerga o que a transação anterior gravou.
 *
 * TRÊS consultas fixas — cabeçalho, itens, movimentos —, qualquer que seja o número de itens: nada por item. O que a
 * movimentação interna acrescentou (OPERACOES-01 F5a) entra pelas MESMAS três: os nomes do destino, a origem e o
 * atendimento por junção e subconsulta do cabeçalho; os vinculados por `json_agg` numa subconsulta; e, nos itens, o
 * atendido, o saldo pendente e o devolvido por subconsulta de cada linha (números como texto).
 */
export async function lerDocumentoEstoque(ctx: ServiceCtx, id: string, especie: EspecieEstoque, opts: { lock?: boolean } = {}): Promise<DocumentoEstoqueLido> {
  if (typeof id !== "string" || !FORMA_UUID.test(id)) throw notFound("Documento");
  const sc = scopedById(ctx, "d", id); sc.params.push(especie);
  const r = await ctx.tx.query<CabecalhoLido>(
    `select d.*, e.name as empresa_nome, wo.description as armazem_nome, wd.description as armazem_destino_nome,
            uc.name as criado_por_nome, uf.name as confirmado_por_nome, ux.name as cancelado_por_nome,
            toper.codigo as top_codigo, toper.codigo_base as top_codigo_base, topv.nome as top_nome, topv.versao as top_versao,
            cc.name as centro_custo_nome, eq.description as equipamento_nome, os.code as ordem_servico_codigo,
            lt.description as lote_animais_nome, ar.name as area_nome, sf.description as safra_nome, ue.name as saldo_encerrado_por_nome,
            case when o.id is null then null
                 else json_build_object('id', o.id, 'codigo', o.codigo, 'especie', o.especie, 'situacao', o.situacao) end as origem,
            coalesce((select json_agg(json_build_object('id', v.id, 'codigo', v.codigo, 'especie', v.especie, 'situacao', v.situacao,
                                                        'data_documento', to_char(v.data_documento, 'YYYY-MM-DD')) order by v.created_at, v.id)
                        from erp.documentos_estoque v
                       where v.origem_documento_id = d.id and v.organization_id = d.organization_id), '[]'::json) as vinculados,
            ${SQL_ATENDIMENTO_REQUISICAO} as atendimento
       from erp.documentos_estoque d
       left join erp.empresas e on e.id = d.empresa_id
       left join erp.warehouses wo on wo.id = d.armazem_id and wo.organization_id = d.organization_id
       left join erp.warehouses wd on wd.id = d.armazem_destino_id and wd.organization_id = d.organization_id
       left join erp.users uc on uc.id = d.criado_por
       left join erp.users uf on uf.id = d.confirmado_por
       left join erp.users ux on ux.id = d.cancelado_por
       left join erp.users ue on ue.id = d.saldo_encerrado_por
       left join erp.tipos_operacao toper on toper.id = d.tipo_operacao_id and toper.organization_id = d.organization_id
       left join erp.tipos_operacao_versoes topv on topv.id = d.tipo_operacao_versao_id and topv.organization_id = d.organization_id
       left join erp.cost_centers cc on cc.id = d.centro_custo_id and cc.organization_id = d.organization_id
       left join erp.equipments eq on eq.id = d.equipamento_id and eq.organization_id = d.organization_id
       left join erp.service_orders os on os.id = d.ordem_servico_id and os.organization_id = d.organization_id
       left join erp.batches lt on lt.id = d.lote_animais_id and lt.organization_id = d.organization_id
       left join erp.areas ar on ar.id = d.area_id and ar.organization_id = d.organization_id
       left join erp.harvests sf on sf.id = d.safra_id and sf.organization_id = d.organization_id
       left join erp.documentos_estoque o on o.id = d.origem_documento_id and o.organization_id = d.organization_id
      where d.id = $1 and d.organization_id = $2 and d.especie = $${sc.params.length}${sc.sql}${opts.lock ? " for update of d" : ""}`,
    sc.params);
  const linha = r.rows[0];
  if (!linha) throw notFound("Documento");
  // O atendido, o saldo pendente e o devolvido de cada linha: subconsultas pelo índice da origem dos itens, na MESMA
  // consulta dos itens. A espécie, a situação e o saldo encerrado são os do cabeçalho que acabou de ser lido.
  const itens = await ctx.tx.query<ItemDocumentoEstoqueLido>(
    `select i.id, i.posicao, i.produto_id, p.code as produto_codigo, p.description as produto_nome, mu.symbol as unidade,
            coalesce(to_jsonb(p)->>'controle_lote', case when p.has_lot then 'lote' else 'nenhum' end) as produto_controle_lote,
            i.lote, i.validade, i.quantidade, i.quantidade_contada, i.custo_unitario, i.saldo_na_confirmacao, i.diferenca, i.observacao,
            i.origem_item_id,
            case when $3::text = 'requisicao' then lig.atendida::numeric(18,4)::text end as quantidade_atendida,
            case when $3::text = 'requisicao' and $4::text = 'confirmado'
                 then (case when $5::boolean then 0 else greatest(i.quantidade - lig.atendida, 0) end)::numeric(18,4)::text end as saldo_pendente,
            case when $3::text = 'consumo' then lig.devolvida::numeric(18,4)::text end as quantidade_devolvida
       from erp.documentos_estoque_itens i
       join erp.products p on p.id = i.produto_id and p.organization_id = i.organization_id
       left join erp.measurement_units mu on mu.id = p.measurement_id
       cross join lateral (select ${sqlAtendidoDoItem("i")} as atendida, ${sqlDevolvidoDoItem("i")} as devolvida) lig
      where i.documento_id = $1 and i.organization_id = $2
      order by i.posicao, i.id`, [id, ctx.orgId, linha.especie, linha.situacao, linha.saldo_encerrado_em !== null]);
  // Os movimentos do documento, estornos inclusive: a história do saldo que ele mexeu, na ordem em que nasceu.
  const movimentos = await ctx.tx.query<MovimentoDocumentoEstoqueLido>(
    `select m.id, m.movement_type, m.direction, m.quantity, m.unit_cost, m.total_cost,
            m.provider_lot, m.expiration_date, m.movement_date, m.product_id, p.description as product_name,
            m.warehouse_id, w.description as warehouse_name
       from erp.stock_movements m
       join erp.products p on p.id = m.product_id and p.organization_id = m.organization_id
       join erp.warehouses w on w.id = m.warehouse_id and w.organization_id = m.organization_id
      where m.organization_id = $1 and m.source_type = 'documentos_estoque' and m.source_id = $2
      order by m.created_at, m.direction, m.product_id, m.id`, [ctx.orgId, id]);
  const { top_codigo, top_codigo_base, top_nome, top_versao, ...cabecalho } = linha;
  return {
    ...cabecalho,
    // A origem e os vinculados SÓ das espécies que quem lê pode ver (as chaves ficam no mesmo lugar da resposta).
    ...relacionadosVisiveis(ctx, linha.origem, linha.vinculados),
    tipo_operacao: topParaTela({ tipo_operacao_id: linha.tipo_operacao_id, top_codigo, top_codigo_base, top_nome, top_versao }),
    itens: itens.rows,
    movimentos: movimentos.rows,
  };
}
