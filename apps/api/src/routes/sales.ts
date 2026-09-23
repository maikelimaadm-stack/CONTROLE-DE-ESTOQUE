import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { D, money, isISODate, DomainError } from "@agro/shared";
import { documentTotals, itemTotal, nextSalesKind, assertConvertible, familiaOperacionalDeDocumentoVenda, chaveI18nDaFamiliaOperacional, varianteDeDocumentoVendaDaFamilia, moduloDaPermissao, resolverPoliticaEfetivaDaVenda, resumoDaPoliticaDaVenda, type PoliticaEfetivaDaVenda, type SalesKind } from "@agro/domain";
import { criarTradutor, ptBR } from "@erp/plataforma";
import { runService, nextCode, idempotent, audit, assertPeriodOpen, requirePermission } from "../lib/service.js";
import { notFound, validation, err, denied } from "../lib/errors.js";
import { consultaEscopada, exigirEmpresaDeLancamento, empresaScope, scopedById, hasPermission, type ServiceCtx } from "../lib/context.js";
import { pageQuerySchema } from "../lib/pagination.js";
import { wrapListing } from "../lib/column-filters.js";
import { postStock, reverseStock } from "../services/stock-core.js";
import { createTitles, installmentPlanSchema } from "../services/financial-core.js";
import { atribuirIdGlobal , paginaComIdGlobal } from "../lib/id-global.js";

const dec = z.union([z.number(), z.string()]).transform(String);
const date = z.string().refine(isISODate, "Data inválida");
const uuid = z.string().uuid();
/** Forma canônica de UUID, para conferir ENTRADA DE FILTRO antes de ela virar parâmetro de SQL. */
const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const docSchema = z.object({ empresa_id: uuid, document_date: date, shipping_date: date.optional().nullable(), due_date: date.optional().nullable(), client_id: uuid, transporter_id: uuid.optional().nullable(), proprietary_id: uuid.optional().nullable(), driver_name: z.string().optional().nullable(), payment_method_id: uuid.optional().nullable(), freight: dec.default("0"), freight_icms: dec.default("0"), other_values: dec.default("0"), discount: dec.default("0"), note: z.string().optional().nullable(), installment_plan: installmentPlanSchema.optional().nullable(), is_deductible: z.boolean().default(false), items: z.array(z.object({ product_id: uuid, warehouse_id: uuid.optional().nullable(), quantity: dec, unit_price: dec, discount: dec.default("0"), discount_percent: dec.default("0"), note: z.string().optional().nullable() })).min(1), tipo_operacao_id: uuid.optional().nullable() });
const permOf = (k: SalesKind) => (k === "budget" ? "budgets" : k === "order" ? "orders" : "sales");
/**
 * O CORPO DO CANCELAMENTO — declarado, e não mais descartado.
 *
 * Até este hotfix a rota ignorava `req.body` por INTEIRO, e a web já mandava `{ reason }`. Campo que o
 * cliente envia e o servidor descarta em silêncio é ampliação de escopo pela porta de trás
 * (`.claude/rules/backend-api.md`): quem pede que o motivo fique registrado recebe 200 e o motivo não
 * existe em lugar nenhum. Agora ele é conferido, entra no hash de idempotência e vai para a auditoria.
 *
 * OPCIONAL, ao contrário do `reason` de `/settlements/:sid/cancel`, que é exigido. Torná-lo obrigatório
 * aqui recusaria o cliente que hoje cancela sem corpo nenhum — quebra de contrato numa fatia que promete
 * apenas SERIALIZAR o que já existe. Presente, tem de ser texto com conteúdo: `""` e `"   "` são pedido
 * malformado, não "sem motivo", e traduzir um pelo outro seria decidir pelo cliente.
 *
 * `.strict()` PORQUE O CONTRATO PASSOU A DECLARAR O CORPO. `z.object` sem `.strict()` DESCARTA chave
 * desconhecida em silêncio, e o efeito prático é o defeito que esta fatia acabou de fechar, voltando pela
 * porta ao lado: `{"reasn": "..."}` — um typo de uma letra — vira `{}`, o cancelamento acontece SEM motivo
 * e o cliente recebe 200. Quem pediu que o motivo ficasse registrado não tem como saber que ele se perdeu.
 * Enquanto a rota ignorava o corpo INTEIRO isso era ao menos coerente (nada era lido, nada era prometido);
 * a partir do momento em que `reason` é conferido, entra no hash e vai para a auditoria, aceitar a
 * vizinhança do campo sem conferir é prometer registro e entregar descarte. Contrato de entrada não
 * canônico é RECUSADO (422), nunca traduzido e nunca ignorado — `.claude/rules/backend-api.md`.
 *
 * Os dois clientes reais desta rota (`vendas/[kind]/[id]/page.tsx` e o `DocList` genérico de
 * `features/docs/shared.tsx`) mandam `{ reason }` e nada mais: `.strict()` não quebra nenhum deles.
 */
const cancelSchema = z.object({ reason: z.string().trim().min(1).max(500).optional().nullable() }).strict();

const t = criarTradutor(ptBR);

/**
 * A FAMÍLIA CANÔNICA DA VARIANTE — PERGUNTADA AO REGISTRY, NUNCA ESCRITA AQUI.
 *
 * O caminho curto seria `{ budget: "vendas.orcamento", order: "vendas.pedido", sale: "vendas.venda" }`
 * nestas três linhas. Funcionaria hoje e mentiria no dia em que o registry mudasse — sem quebrar tipo,
 * teste nem tela, que é o modo de falhar que `docs/TIPO-OPERACAO-CONTRACT.md` §10 nomeia. O helper do
 * domínio deriva de `TIPOS_OPERACAO`; esta rota só o consome.
 *
 * Fail-closed: se o registry deixasse de declarar a variante, a criação PARA aqui em vez de gravar um
 * documento com família errada.
 */
function familiaDaVariante(kind: SalesKind): string {
  const familia = familiaOperacionalDeDocumentoVenda(kind);
  if (!familia) throw new DomainError("TIPO_OPERACAO_INDISPONIVEL", "Tipo de operação indisponível para este lançamento", { kind });
  return familia;
}

/** O snapshot que o documento grava: identidade da TOP + a versão exata que valia no instante do lançamento. */
interface TopDoLancamento { tipoOperacaoId: string; tipoOperacaoVersaoId: string; codigo: string; nome: string; versao: number; codigoBase: string }

/**
 * O snapshot como a tela o lê. `null` é resposta LEGÍTIMA — documento do acervo, ou criado por cliente
 * anterior a esta fatia —, e a tela o exibe como "não configurada", nunca como a família canônica
 * disfarçada de TOP.
 *
 * O `nome` sai de `top_nome`, que veio da VERSÃO CONGELADA. Reaproveitar aqui a consulta da rota
 * administrativa (que junta pela `versao_atual` do pai) faria o documento de 2024 exibir o nome de 2026 —
 * exatamente o histórico reescrito que os dois ponteiros existem para impedir.
 */
const topParaTela = (l: { tipo_operacao_id: string | null; top_codigo: string | null; top_codigo_base: string | null; top_nome: string | null; top_versao: number | null }) =>
  l.tipo_operacao_id && l.top_codigo && l.top_nome
    ? { id: l.tipo_operacao_id, codigo: l.top_codigo, nome: l.top_nome, versao: l.top_versao, codigoBase: l.top_codigo_base,
        familiaRotulo: l.top_codigo_base ? t(chaveI18nDaFamiliaOperacional(l.top_codigo_base) ?? l.top_codigo_base) : null }
    : null;

/**
 * RESOLVE A TOP ESCOLHIDA E CONGELA A VERSÃO CORRENTE — a única porta por onde o snapshot nasce.
 *
 * O cliente manda `tipo_operacao_id` e NADA MAIS. Quem decide qual versão vale é o SERVIDOR, aqui, no
 * instante da escrita: deixar o cliente enviar `tipo_operacao_versao_id` seria deixá-lo escolher qual
 * passado citar, e um cliente desatualizado congelaria uma versão que já não é a corrente.
 *
 * `for share of t` — SÓ NO PAI, e isso não é descuido. A linha de versão é IMUTÁVEL por construção: a 0020
 * revogou `update` e `delete` dela do papel da aplicação e pôs um gatilho por cima. Travar uma linha que
 * ninguém pode alterar não protege de nada, e o banco recusaria de todo modo — `for share` exige privilégio
 * de UPDATE/DELETE, que é exatamente o que foi revogado ali. O que MUDA é o pai (`versao_atual`, `ativo`,
 * `excluido_em`), e é ele que o lock segura: enquanto esta transação vive, ninguém desativa, exclui ou
 * versiona esta TOP. Sem isso, um `update` administrativo entre o `select` e o `insert` gravaria um
 * documento apontando para uma versão que deixou de ser a corrente.
 *
 * SUPERFÍCIE ÚNICA DE RECUSA: inexistente, de outro tenant, de outra família, inativa e excluída caem todas
 * no MESMO 422. Distinguir transformaria a mensagem num oráculo — quem varresse UUIDs saberia quais existem
 * na organização vizinha e a que família cada um pertence (`.claude/rules/security.md`).
 */
async function resolverTopParaLancamento(ctx: ServiceCtx, familiaEsperada: string, tipoOperacaoId: string): Promise<TopDoLancamento> {
  const r = await ctx.tx.query<{ id: string; codigo: string; codigo_base: string; versao_id: string; nome: string; versao: number }>(
    `select t.id, t.codigo, t.codigo_base, v.id as versao_id, v.nome, v.versao
       from erp.tipos_operacao t
       join erp.tipos_operacao_versoes v
         on v.tipo_operacao_id = t.id and v.organization_id = t.organization_id and v.versao = t.versao_atual
      where t.id = $1 and t.organization_id = $2 and t.ativo and t.excluido_em is null and t.codigo_base = $3
        for share of t`,
    [tipoOperacaoId, ctx.orgId, familiaEsperada]);
  const top = r.rows[0];
  if (!top) throw new DomainError("TIPO_OPERACAO_INDISPONIVEL", "Tipo de operação indisponível para este lançamento");
  return { tipoOperacaoId: top.id, tipoOperacaoVersaoId: top.versao_id, codigo: top.codigo, nome: top.nome, versao: top.versao, codigoBase: top.codigo_base };
}

/**
 * CARREGA O DOCUMENTO JÁ AMARRADO À VARIANTE DA PORTA (BASE2-03C).
 *
 * `erp.sales_documents` é UMA tabela com TRÊS variantes (`kind`), e cada variante tem a sua própria
 * família de capacidades: `budgets.*` × `orders.*` × `sales.*`. A porta é variante; o registro também
 * precisa ser. Antes desta fatia o carregamento olhava id + organização + exclusão + escopo de empresa e
 * NÃO olhava `kind`: quem tivesse `budgets.view` lia um PEDIDO ou uma VENDA pedindo o UUID pela rota de
 * orçamentos, e `budgets.delete` cancelava documento de outra variante. A conferência tardia que existia
 * no PUT chegava DEPOIS de o registro inteiro já ter sido lido — o que é conferência de apresentação,
 * não de autorização.
 *
 * `expectedKind` entra no WHERE da consulta principal. Variante errada é INEXISTENTE PARA AQUELA ROTA:
 * a mesma 404 de id inexistente, de outro tenant e de fora do escopo de empresa — sem revelar que o UUID
 * existe na variante vizinha, e sem redirecionar para a rota "certa".
 *
 * `opts.lock` acrescenta `for update of d` — e SÓ `of d`. `FOR UPDATE` sem lista de tabelas valeria também
 * para `t`, `pm`, `u`, `toper` e `topv`, que estão no lado NULLABLE dos LEFT JOIN, e o PostgreSQL RECUSA
 * isso já no planejamento (0A000): a rota quebraria em TODA chamada, não só na corrida.
 *
 * O lock existe para quem LÊ E MUTA a mesma linha, e hoje são TRÊS: a conversão (TOP-CONFIG-02) e, desde
 * o hotfix de concorrência, a CONFIRMAÇÃO e o CANCELAMENTO. Sem ele, duas requisições simultâneas leem o
 * MESMO snapshot e ambas executam os efeitos inteiros: a conversão cria DOIS destinos e as duas carimbam
 * a fonte como `converted` (e não há UNIQUE em `origin_document_id` para pegar a sobra); a confirmação
 * posta duas saídas de estoque e dois conjuntos de contas a receber; o cancelamento de venda confirmada
 * lança DOIS estornos da mesma saída. Com o lock, a segunda espera o commit da primeira, reavalia a linha
 * já atualizada e cai na recusa de ESTADO que sempre existiu — `assertConvertible`, ALREADY_CONFIRMED ou
 * ALREADY_CANCELLED, conforme a porta.
 *
 * Leitura pura (detalhe, listagem) continua SEM lock: travar linha para desenhar tela é serializar o que
 * não disputa nada.
 */
/** Uma próxima operação oferecida por um documento, já resolvida para a tela. */
interface ProximoPasso {
  tipoOperacaoId: string; codigo: string; nome: string;
  codigoBase: string; familiaRotulo: string; variante: SalesKind; ordem: number;
}

/**
 * A POLÍTICA DE PRÓXIMAS OPERAÇÕES DE UM DOCUMENTO: o ESTADO dela, e os passos que ela oferece HOJE.
 *
 * ┌─ POR QUE DUAS COISAS, E NÃO SÓ A LISTA ─────────────────────────────────────────────────────────────┐
 * │ `itens.length === 0` tem DUAS causas que pedem comportamentos OPOSTOS, e contar não as separa:      │
 * │                                                                                                      │
 * │   `configurada: false` → ninguém NUNCA declarou política para esta versão. É o acervo inteiro e é o │
 * │                          que o binário antigo grava. Só aqui a cadeia antiga continua valendo.       │
 * │   `configurada: true`  → a política foi declarada, e declarou ZERO destinos. É uma decisão, e o que │
 * │                          ela decide é que este documento NÃO gera próxima operação.                  │
 * │                                                                                                      │
 * │ O discriminador é a coluna `destinos_configurados` da VERSÃO (0022), nunca a cardinalidade. Antes    │
 * │ desta correção a conversão decidia por `passos.length > 0`, e a consequência era que a web obedecia  │
 * │ ao administrador e uma chamada direta à API convertia assim mesmo.                                   │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ AS DUAS PERGUNTAS, DE NOVO, PORQUE É AQUI QUE ELAS SE ENCONTRAM ───────────────────────────────────┐
 * │ A POLÍTICA vem de `tipo_operacao_versao_id` do documento: a versão que valia quando ele nasceu. Ela │
 * │ é história e não muda nunca — editar a TOP amanhã cria a versão N+1 e não mexe neste documento.     │
 * │                                                                                                      │
 * │ A DISPONIBILIDADE vem do estado atual da TOP de destino: `ativo and excluido_em is null`. Uma TOP    │
 * │ desativada some do leque SEM alterar a versão da origem — a política continua registrando que aquele │
 * │ caminho existiu, e é por isso que a conversão que já aconteceu continua explicável.                  │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * E O GRAFO NÃO AUTORIZA NINGUÉM: ele só RESTRINGE o caminho. Quem decide se o usuário pode percorrer o
 * caminho escolhido é a capacidade dele, cobrada na conversão. Habilitar uma aresta não concede permissão.
 *
 * UMA IDA AO BANCO. A versão de origem é o lado FIXO do `left join`: ela responde o estado mesmo quando
 * não há nenhuma aresta, e as arestas viajam na mesma resposta. Duas consultas dariam o mesmo resultado e
 * pagariam um `round trip` por documento aberto.
 */
interface PoliticaDeDestinos { configurada: boolean; itens: ProximoPasso[] }

async function politicaDeDestinos(ctx: ServiceCtx, versaoOrigemId: string | null | undefined): Promise<PoliticaDeDestinos> {
  // DOCUMENTO SEM TOP — acervo, ou criado por cliente anterior a esta fatia. Não há versão para ler, logo
  // não há política declarada: `false` é a descrição do que aconteceu, e é o que preserva a cadeia antiga
  // para esses documentos. Inventar a cadeia fixa como se fosse política seria o contrário do que a fatia
  // veio fazer.
  if (!versaoOrigemId) return { configurada: false, itens: [] };

  const r = await ctx.tx.query<{
    destinos_configurados: boolean; destino_id: string | null; codigo: string | null;
    nome: string | null; codigo_base: string | null; ordem: number | null;
  }>(
    `select vo.destinos_configurados,
            t.id as destino_id, t.codigo, tv.nome, t.codigo_base, d.ordem
       from erp.tipos_operacao_versoes vo
       left join erp.tipos_operacao_versao_destinos d
         on d.origem_versao_id = vo.id and d.organization_id = vo.organization_id
       left join erp.tipos_operacao t
         on t.id = d.destino_tipo_operacao_id and t.organization_id = d.organization_id
        and t.ativo and t.excluido_em is null
       left join erp.tipos_operacao_versoes tv
         on tv.tipo_operacao_id = t.id and tv.organization_id = t.organization_id and tv.versao = t.versao_atual
      where vo.organization_id = $1 and vo.id = $2
      order by d.ordem, t.codigo`,
    [ctx.orgId, versaoOrigemId]);

  const primeira = r.rows[0];
  if (!primeira) {
    // A VERSÃO QUE O DOCUMENTO CITA NÃO FOI LIDA — e aqui NÃO se escolhe uma das duas leituras no escuro.
    // Assumir "nunca declarou" liberaria a cadeia antiga sobre um documento cuja política ninguém
    // conseguiu ler, que é exatamente a conversão que esta correção existe para impedir. A FK composta da
    // 0021 (versão + TOP + organização) e a RLS do mesmo tenant tornam este caminho inalcançável enquanto
    // o documento for visível; se ele for alcançado, é corrupção, e recusar é a única resposta honesta.
    throw new DomainError("TIPO_OPERACAO_INDISPONIVEL", "Tipo de operação indisponível para este documento");
  }

  const itens: ProximoPasso[] = [];
  for (const linha of r.rows) {
    // LINHA SEM DESTINO é o `left join` falando: ou a versão não tem aresta nenhuma (uma linha só, toda
    // nula), ou a aresta existe e o destino NÃO passa no filtro de hoje (desativado, excluído). Nos dois
    // casos não há passo a oferecer — e a aresta continua lá, congelada, explicando o que já aconteceu.
    if (!linha.destino_id || linha.codigo === null || linha.nome === null || linha.codigo_base === null || linha.ordem === null) continue;
    // FAIL-CLOSED na apresentação também: destino cuja família o produto não sabe criar não é oferecido.
    // Poderia existir se uma família saísse do registry depois de a aresta ter sido gravada — e oferecer
    // um botão sem serviço atrás é pior do que oferecer um botão a menos.
    const variante = varianteDeDocumentoVendaDaFamilia(linha.codigo_base);
    if (!variante) continue;
    itens.push({
      tipoOperacaoId: linha.destino_id, codigo: linha.codigo, nome: linha.nome,
      codigoBase: linha.codigo_base, familiaRotulo: t(chaveI18nDaFamiliaOperacional(linha.codigo_base) ?? linha.codigo_base),
      variante: variante as SalesKind, ordem: linha.ordem
    });
  }
  return { configurada: primeira.destinos_configurados, itens };
}

async function getDoc(ctx: ServiceCtx, id: string, expectedKind: SalesKind, opts: { lock?: boolean } = {}) {
  const sc = scopedById(ctx, "d", id); sc.params.push(expectedKind);
  // LEFT JOIN nos dois, e não INNER: documento legado tem os ponteiros nulos, e um INNER o faria SUMIR da
  // própria porta de detalhe — 404 num registro que está lá. O nome sai de `topv` (a versão CONGELADA),
  // nunca da versão corrente do pai: é isso que faz a renomeação administrativa de amanhã não reescrever
  // o que este documento diz que é.
  const r = await ctx.tx.query("select d.*, c.name as client_name, c.document as client_document, t.name as transporter_name, pm.name as payment_method_name, u.name as responsible_name, f.name as empresa_name, toper.codigo as top_codigo, toper.codigo_base as top_codigo_base, topv.nome as top_nome, topv.versao as top_versao from erp.sales_documents d join erp.people c on c.id=d.client_id left join erp.people t on t.id=d.transporter_id left join erp.payment_methods pm on pm.id=d.payment_method_id left join erp.users u on u.id=d.responsible_user_id join erp.empresas f on f.id=d.empresa_id left join erp.tipos_operacao toper on toper.id=d.tipo_operacao_id and toper.organization_id=d.organization_id left join erp.tipos_operacao_versoes topv on topv.id=d.tipo_operacao_versao_id and topv.organization_id=d.organization_id where d.id=$1 and d.organization_id=$2 and d.deleted_at is null and d.kind=$" + sc.params.length + sc.sql + (opts.lock ? " for update of d" : ""), sc.params); if (!r.rows[0]) throw notFound("Documento");
  const items = await ctx.tx.query("select i.*, p.description as product_name, p.code as product_code, mu.symbol as unit, w.description as warehouse_name from erp.sales_document_items i join erp.products p on p.id=i.product_id left join erp.measurement_units mu on mu.id=p.measurement_id left join erp.warehouses w on w.id=i.warehouse_id where i.document_id=$1 order by i.position", [id]);
  const titles = await ctx.tx.query("select id, code, number, due_date, amount, balance, status from erp.financial_titles where organization_id=$1 and source_type='sales_documents' and source_id=$2 order by due_date", [ctx.orgId, id]);
  const derived = await ctx.tx.query("select id, kind, code, status from erp.sales_documents where origin_document_id=$1", [id]);
  const linha = r.rows[0] as Record<string, unknown> & { tipo_operacao_id: string | null; top_codigo: string | null; top_codigo_base: string | null; top_nome: string | null; top_versao: number | null };
  return { ...linha, tipo_operacao: topParaTela(linha), items: items.rows, titles: titles.rows, derived: derived.rows } as Record<string, unknown>;
}

/**
 * O DOCUMENTO É VISÍVEL NESTE CONTEXTO? — conferido ANTES de entrar no helper de idempotência.
 *
 * `idempotent()` devolve o `response_body` gravado e NÃO executa o handler. Como é o handler que chama
 * `getDoc`, e é `getDoc` que aplica o recorte de EMPRESA, o replay atravessava a autorização DO REGISTRO:
 * `runService` confere autenticação, capacidade da rota e a empresa selecionada em termos gerais, e nada
 * disso olha para ESTE documento.
 *
 * `actorId` no hash fecha o replay entre atores DIFERENTES. Não fecha este, porque o ator é o MESMO: um
 * usuário com acesso às empresas A e B confirma o documento da empresa A com a chave K, troca o contexto
 * explícito para a empresa B e reenvia K. Sem esta conferência o helper devolve 200 com o corpo gravado
 * (`title_ids` inclusive) num contexto em que a chamada normal responde 404 — e a superfície de recusa que
 * `.claude/rules/security.md` exige (fora de escopo indistinguível de inexistente) vaza pela idempotência.
 *
 * REUSA `getDoc`, e é por isso que não carrega consulta própria. Uma variante enxuta (`select 1` com
 * `scopedById`) pouparia três consultas e criaria uma SEGUNDA regra de autorização, livre para divergir da
 * primeira no dia em que uma das duas mudasse — e divergir para o lado permissivo aqui é exatamente o
 * vazamento que esta função existe para fechar. A regra tem de ser a MESMA, não "equivalente".
 *
 * SEM `lock`: é leitura. A ordem de aquisição da parte MUTANTE não muda — `erp.idempotency_keys` continua
 * sendo o primeiro lock, e só depois vem o `for update of d` do handler. Inverter isso criaria aresta de
 * deadlock com toda rota que já reserva a chave antes de tocar o registro.
 */
async function exigirDocumentoVisivel(ctx: ServiceCtx, id: string, expectedKind: SalesKind): Promise<void> {
  await getDoc(ctx, id, expectedKind);
}
/**
 * Grava o documento. `top` tem TRÊS estados, e a diferença entre eles é o contrato de preservação:
 *
 *   `undefined` → NÃO TOCA nas colunas de TOP. É o que um PUT sem o campo faz, e é o que preserva o
 *                 snapshot de um documento antigo quando o usuário salva outro campo qualquer. Sem este
 *                 estado, editar o frete de uma venda de 2024 a re-carimbaria com a versão de hoje.
 *   `null`      → grava NULL/NULL. É a criação por cliente legado, que não declarou TOP nenhuma.
 *   objeto      → grava o snapshot resolvido pelo servidor.
 */
async function writeDoc(ctx: ServiceCtx, kind: SalesKind, d: z.infer<typeof docSchema>, existingId?: string, origin?: string | null, top?: TopDoLancamento | null) {
  const totals = documentTotals(d.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unit_price, discount: i.discount, discountPercent: i.discount_percent })), { freight: d.freight, freightIcms: d.freight_icms, otherValues: d.other_values, discount: d.discount });
  let id = existingId;
  const plan = d.installment_plan ? { ...d.installment_plan, is_deductible: d.is_deductible } : {};
  if (!id) { const code = await nextCode(ctx.tx, ctx.orgId, `sales_${kind}`); id = (await ctx.tx.query<{ id: string }>("insert into erp.sales_documents(organization_id,empresa_id,kind,code,document_date,shipping_date,due_date,responsible_user_id,client_id,transporter_id,proprietary_id,driver_name,payment_method_id,subtotal,freight,freight_icms,other_values,discount,total,note,installment_plan,origin_document_id,tipo_operacao_id,tipo_operacao_versao_id,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$8) returning id", [ctx.orgId, d.empresa_id, kind, code, d.document_date, d.shipping_date ?? null, d.due_date ?? null, ctx.user.id, d.client_id, d.transporter_id ?? null, d.proprietary_id ?? null, d.driver_name ?? null, d.payment_method_id ?? null, totals.subtotal, money(d.freight), money(d.freight_icms), money(d.other_values), money(d.discount), totals.total, d.note ?? null, JSON.stringify(plan), origin ?? null, top?.tipoOperacaoId ?? null, top?.tipoOperacaoVersaoId ?? null])).rows[0]!.id; await atribuirIdGlobal(ctx, "sales_documents", id); }
  else {
    // As colunas de TOP só entram no SET quando houve decisão explícita. `undefined` preserva o snapshot.
    const topSet = top === undefined ? "" : ", tipo_operacao_id=$19, tipo_operacao_versao_id=$20";
    const topParams = top === undefined ? [] : [top?.tipoOperacaoId ?? null, top?.tipoOperacaoVersaoId ?? null];
    await ctx.tx.query(`update erp.sales_documents set document_date=$3, shipping_date=$4, due_date=$5, client_id=$6, transporter_id=$7, proprietary_id=$8, driver_name=$9, payment_method_id=$10, subtotal=$11, freight=$12, freight_icms=$13, other_values=$14, discount=$15, total=$16, note=$17, installment_plan=$18${topSet}, updated_at=now() where id=$1 and organization_id=$2`, [id, ctx.orgId, d.document_date, d.shipping_date ?? null, d.due_date ?? null, d.client_id, d.transporter_id ?? null, d.proprietary_id ?? null, d.driver_name ?? null, d.payment_method_id ?? null, totals.subtotal, money(d.freight), money(d.freight_icms), money(d.other_values), money(d.discount), totals.total, d.note ?? null, JSON.stringify(plan), ...topParams]);
    await ctx.tx.query("delete from erp.sales_document_items where document_id=$1", [id]);
  }
  for (const [i, it] of d.items.entries()) await ctx.tx.query("insert into erp.sales_document_items(document_id,product_id,warehouse_id,quantity,unit_price,discount,discount_percent,total,note,position) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [id, it.product_id, it.warehouse_id ?? null, it.quantity, it.unit_price, money(it.discount), it.discount_percent, itemTotal({ quantity: it.quantity, unitPrice: it.unit_price, discount: it.discount, discountPercent: it.discount_percent }), it.note ?? null, i]);
  return { id, ...totals };
}
/**
 * A POLÍTICA DE ESTOQUE E FINANCEIRO DESTA VENDA — lida da VERSÃO CONGELADA, e só dela (TOP-CONFIG-04A).
 *
 * A autoridade é `sales_documents.tipo_operacao_versao_id` → a linha EXATA de `erp.tipos_operacao_versoes`.
 * Nunca `tipos_operacao.versao_atual`: a TOP pode ter sido editada depois do lançamento, e a venda antiga
 * executaria a regra de hoje sobre um documento emitido sob a de ontem. Por isso a consulta não toca o
 * ponteiro corrente do pai — ela lê do pai só a FAMÍLIA, que é imutável.
 *
 * SEM FILTRO DE ESTADO NO PAI (ativo, excluído): desativar ou excluir a TOP depois do lançamento não troca
 * a versão que o documento cita, e o documento continua sendo confirmado pela regra que ele capturou —
 * o mesmo contrato que `politicaDeDestinos` segue para a conversão. SEM LOCK na versão: ela é imutável
 * (a 0020 revogou `update`/`delete` dela do papel da aplicação), e `for share` exigiria justamente o
 * privilégio revogado.
 *
 * UMA consulta por confirmação, nunca por item: a política é resolvida uma vez e vale para o documento.
 *
 * O GATE (`execucaoConfiguradaHabilitada`) CHEGA COMO PARÂMETRO OBRIGATÓRIO de quem monta a rota, lido de
 * `app.config`. Um valor padrão aqui deixaria um chamador esquecido executar em silêncio o caminho errado.
 */
async function politicaDaVenda(ctx: ServiceCtx, versaoId: string | null, execucaoConfiguradaHabilitada: boolean): Promise<PoliticaEfetivaDaVenda> {
  let versaoCongelada: { codigoBase: string; configuracao: unknown } | null = null;
  if (versaoId) {
    const r = await ctx.tx.query<{ configuracao: unknown; codigo_base: string }>(
      `select v.configuracao, t.codigo_base
         from erp.tipos_operacao_versoes v
         join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.organization_id = v.organization_id
        where v.id = $1 and v.organization_id = $2`,
      [versaoId, ctx.orgId]);
    const linha = r.rows[0];
    // A FK composta da 0021 e a RLS do mesmo tenant tornam este caminho inalcançável enquanto o documento
    // for visível. Alcançado, é corrupção — e decidir "então é legado" seria exatamente o fallback proibido.
    if (!linha) throw new DomainError("TIPO_OPERACAO_INDISPONIVEL", "Tipo de operação indisponível para este documento");
    versaoCongelada = { codigoBase: linha.codigo_base, configuracao: linha.configuracao };
  }
  const r = resolverPoliticaEfetivaDaVenda({ versaoCongelada, execucaoConfiguradaHabilitada });
  if (r.ok) return r.politica;
  // FAIL-CLOSED, SEM EFEITO: esta recusa acontece antes do período, do estoque e do financeiro. A mensagem
  // não carrega identificador de TOP nem de versão — só o que o usuário pode fazer a respeito.
  const mensagem = r.motivo === "execucao_desligada"
    ? "A operação desta venda usa execução configurada, que ainda não está habilitada neste ambiente. A venda não foi confirmada."
    : r.motivo === "configuracao_ilegivel"
      ? "A configuração da operação desta venda está num formato que este servidor não executa. A venda não foi confirmada."
      : "A configuração da operação desta venda pede um efeito que esta versão do produto não executa. A venda não foi confirmada.";
  throw new DomainError("TIPO_OPERACAO_EXECUCAO_INDISPONIVEL", mensagem,
    { motivo: r.motivo, recusas: r.recusas.map(({ motivo, caminho, mensagem: m }) => ({ motivo, caminho, mensagem: m })) });
}

/**
 * CONFIRMAÇÃO DE VENDA — a linha da venda é o COORDENADOR da operação, e por isso é travada primeiro.
 *
 * Confirmar não é gravar um campo: é postar saída de estoque de cada item, gerar as contas a receber e
 * só então mover o status. Duas requisições simultâneas liam `open` do MESMO snapshot, passavam as duas
 * pela conferência de status e executavam os efeitos INTEIROS duas vezes — dois conjuntos de movimentos
 * de estoque e dois conjuntos de títulos, ambos com resposta de sucesso. Nada na tela denunciaria; a
 * conferência do mês encontraria o dobro do estoque baixado e a receita duplicada.
 *
 * "Está dentro de uma transação" não resolve: em READ COMMITTED duas transações leem o mesmo estado
 * inicial e ambas são internamente consistentes. O que faltava era SERIALIZAÇÃO, e ela tem de acontecer
 * ANTES da primeira decisão — a de status. Com `lock: true`, a segunda espera o commit da primeira,
 * relê a linha JÁ atualizada e cai em ALREADY_CONFIRMED (409), sem efeito nenhum.
 *
 * A trava vale para a corrida com o CANCELAMENTO pelo mesmo motivo e na mesma linha: quem chegar
 * segundo decide sobre o estado que o primeiro deixou, nunca sobre o que leu antes dele.
 *
 * ┌─ QUEM DECIDE O EFEITO (TOP-CONFIG-04A) ────────────────────────────────────────────────────────────┐
 * │ A política é resolvida UMA vez, da versão congelada, ANTES de qualquer efeito. Cada efeito tem dois │
 * │ caminhos e só dois: LEGADO executa exatamente o código de antes (mesmas consultas, mesma ordem,    │
 * │ mesmo fallback de vencimento); CONFIGURADA executa a MESMA primitiva (`postStock`, `createTitles`) │
 * │ com os mesmos identificadores de origem — é isso que mantém cancelamento, relatórios e conciliação │
 * │ funcionando sem saber de onde veio a decisão — ou não executa nada, quando a versão diz "nenhum".  │
 * │ As exigências da versão (armazém, forma de pagamento, vencimento) são conferidas TODAS antes do    │
 * │ primeiro movimento: recusar no meio deixaria a decisão de rollback nas mãos da transação, e a regra │
 * │ desta fatia é que configuração não cumprida não produz efeito nenhum.                              │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
async function confirmSale(ctx: ServiceCtx, id: string, execucaoConfiguradaHabilitada: boolean) {
  const d = await getDoc(ctx, id, "sale", { lock: true }) as Record<string, unknown> & { id: string; kind: SalesKind; status: string; empresa_id: string; document_date: string; shipping_date: string | null; due_date: string | null; client_id: string; payment_method_id: string | null; total: string; code: string; installment_plan: Record<string, unknown>; tipo_operacao_versao_id: string | null; items: { product_id: string; warehouse_id: string | null; quantity: string; total: string }[] };
  // A variante já foi amarrada no carregamento (`getDoc(..., "sale")`): orçamento e pedido passados aqui
  // respondem 404, como qualquer UUID que a rota de vendas não serve. A conferência antiga
  // (`d.kind !== "sale"` → 422) distinguia "existe na variante vizinha" de "não existe" — diferença que a
  // superfície de recusa não pode expor.
  if (d.status === "confirmed" || d.status === "invoiced") throw err("ALREADY_CONFIRMED", "Venda já confirmada"); if (d.status === "cancelled") throw err("ALREADY_CANCELLED", "Venda cancelada");
  const politica = await politicaDaVenda(ctx, d.tipo_operacao_versao_id, execucaoConfiguradaHabilitada);
  const lerPlano = () => d.installment_plan && (d.installment_plan as { installments?: number }).installments ? installmentPlanSchema.parse(d.installment_plan) : null;

  // AS EXIGÊNCIAS DA VERSÃO CONGELADA — todas conferidas, todas juntas, antes de qualquer efeito.
  const exigencias: { caminho: string; mensagem: string }[] = [];
  if (politica.estoque.autoridade === "configurada" && politica.estoque.efeito === "saida" && politica.estoque.exigeArmazem && d.items.some((it) => !it.warehouse_id)) {
    exigencias.push({ caminho: "estoque.exigeArmazem", mensagem: "Informe o armazém de todos os itens" });
  }
  if (politica.financeiro.autoridade === "configurada" && politica.financeiro.efeito === "receber") {
    if (politica.financeiro.exigeFormaPagamento && !d.payment_method_id) exigencias.push({ caminho: "financeiro.exigeFormaPagamento", mensagem: "Informe a forma de pagamento" });
    if (politica.financeiro.exigeVencimento && !(lerPlano()?.first_due_date ?? d.due_date)) exigencias.push({ caminho: "financeiro.exigeVencimento", mensagem: "Informe o vencimento" });
  }
  if (exigencias.length) {
    throw new DomainError("TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA",
      `A operação desta venda exige dados que o documento não tem: ${exigencias.map((e) => e.mensagem.toLowerCase()).join("; ")}.`,
      { exigencias });
  }

  await assertPeriodOpen(ctx.tx, ctx.orgId, d.empresa_id, d.document_date);

  // ESTOQUE. Legado e "saída" configurada chamam a MESMA primitiva com os MESMOS identificadores; "nenhum"
  // não chama nada. O item sem armazém continua fora da baixa nos dois caminhos que baixam — com
  // `exigeArmazem` ele já foi recusado acima.
  const movimentos: string[] = [];
  const baixaEstoque = politica.estoque.autoridade === "legado" || politica.estoque.efeito === "saida";
  if (baixaEstoque) {
    for (const it of d.items) if (it.warehouse_id) movimentos.push((await postStock(ctx, { empresaId: d.empresa_id, warehouseId: it.warehouse_id, productId: it.product_id, movementType: "sale", direction: -1, quantity: it.quantity, sourceType: "sales_documents", sourceId: id, date: d.shipping_date ?? d.document_date, note: `Venda ${d.code}` })).id);
  }

  // FINANCEIRO. O mesmo desenho: legado e "a receber" configurado geram os títulos pela MESMA porta
  // (`createTitles`), com a mesma categoria, centro, parcelamento, parceiro e origem; "nenhum" não gera
  // título e também não exige categoria nem centro — exigir cadastro para um efeito que não acontece seria
  // recusar a venda por um motivo que não existe.
  let titleIds: string[] = [];
  const geraTitulos = politica.financeiro.autoridade === "legado" || politica.financeiro.efeito === "receber";
  if (geraTitulos) {
    // Receita: categoria padrão de venda de produtos (1ª analítica de receita) e centro de custo padrão da fazenda
    const cat = (await ctx.tx.query<{ id: string }>("select id from erp.financial_categories where organization_id=$1 and nature='income' and kind='analytic' and deleted_at is null order by code limit 1", [ctx.orgId])).rows[0];
    const cc = (await ctx.tx.query<{ id: string }>("select cc.id from erp.cost_centers cc where cc.organization_id=$1 and cc.kind='analytic' and cc.deleted_at is null order by code limit 1", [ctx.orgId])).rows[0];
    if (!cat || !cc) throw validation("Cadastre uma categoria financeira de receita e um centro de custo analítico");
    const plan = lerPlano();
    // O vencimento do legado cai na data do documento quando não há outro; sob `exigeVencimento` configurado
    // esse recuo não existe — a falta já foi recusada acima, antes do primeiro efeito.
    const t = await createTitles(ctx, { empresaId: d.empresa_id, direction: "receivable", number: `VND-${d.code}`, personId: d.client_id, amount: d.total, emissionDate: d.document_date, dueDate: plan?.first_due_date ?? d.due_date ?? d.document_date, note: `Venda ${d.code}`, isDeductible: Boolean((d.installment_plan as { is_deductible?: boolean }).is_deductible), apportionment: [{ financialCategoryId: cat.id, costCenterId: cc.id, percentage: "100" }], sourceType: "sales_documents", sourceId: id, plan });
    titleIds = t.ids;
  }

  // A MARCA DE QUE ESTA TRANSAÇÃO EXECUTOU A POLÍTICA CONFIGURADA. O gatilho da migration 0023 recusa a
  // confirmação de uma venda cuja versão congelada declara execução configurada sem esta marca — que é
  // como um binário anterior a esta fatia (rollback, instância antiga no pool) deixa de confirmá-la pelo
  // legado. `true` no terceiro argumento: vale só até o fim desta transação. O valor é o id CANÔNICO da
  // linha travada (`d.id`), nunca o texto da URL: o Postgres aceita o UUID em maiúsculas e acha a venda, mas
  // o gatilho compara a marca com `NEW.id::text`, e a guarda recusaria a própria confirmação legítima.
  if (politica.estoque.autoridade === "configurada" || politica.financeiro.autoridade === "configurada") {
    await ctx.tx.query("select set_config('app.venda_execucao_configurada', $1, true)", [d.id]);
  }
  // ROW COUNT SOB RLS, e a transição conferida no próprio `where`: sob a trava acima só `open`/`approved`
  // chegam aqui, e zero linha sem conferência seria sucesso sem efeito.
  const u = await ctx.tx.query("update erp.sales_documents set status='confirmed', updated_at=now() where id=$1 and organization_id=$2 and status not in ('confirmed','invoiced','cancelled')", [id, ctx.orgId]);
  if (u.rowCount !== 1) throw notFound("Documento");
  // A EVIDÊNCIA DO DOCUMENTO: qual versão valeu, qual autoridade decidiu cada efeito, e o que foi de fato
  // materializado. `titles` continua com o nome de sempre — é o que leitores anteriores da trilha conhecem.
  await audit(ctx.tx, ctx, "sales_documents", id, "confirm", {
    titles: titleIds, movimentos, tipoOperacaoVersaoId: d.tipo_operacao_versao_id,
    execucao: { origem: politica.origem, ...resumoDaPoliticaDaVenda(politica) }
  });
  return { id, status: "confirmed", title_ids: titleIds };
}

export default async function salesRoutes(app: FastifyInstance) {
  for (const kind of ["budget", "order", "sale"] as const) {
    const base = `/sales/${kind}s`; const perm = permOf(kind);
    app.get(base, async (req) => runService(app, req, `${perm}.view`, async (ctx) => {
      const q = pageQuerySchema.parse(req.query); const f = req.query as Record<string, string>;
      const where = ["d.organization_id=$1", "d.kind=$2", "d.deleted_at is null"]; const params: unknown[] = [ctx.orgId, kind];
      if (f.client_id) { params.push(f.client_id); where.push(`d.client_id=$${params.length}`); }
      if (f.status) { params.push(f.status); where.push(`d.status=$${params.length}`); }
      if (f.empresa_id) { params.push(f.empresa_id); where.push(`d.empresa_id=$${params.length}`); } where.push(...empresaScope(ctx, "d", params, { ignoreSelected: Boolean(f.empresa_id) }));
      if (f.start_date) { params.push(f.start_date); where.push(`d.document_date>=$${params.length}`); } if (f.end_date) { params.push(f.end_date); where.push(`d.document_date<=$${params.length}`); }
      if (f.search) { params.push(`%${f.search}%`); where.push(`(d.code ilike $${params.length} or c.name ilike $${params.length})`); }
      if (f.product_id) { params.push(f.product_id); where.push(`exists (select 1 from erp.sales_document_items i where i.document_id=d.id and i.product_id=$${params.length})`); }
      // FILTRO POR TOP, server-side. Documento histórico de uma TOP hoje DESATIVADA continua casando: o
      // filtro é pelo ponteiro gravado, não pelo estado atual da configuração. Desativar uma TOP não pode
      // fazer lançamento sumir de relatório.
      //
      // A FORMA é conferida ANTES de o valor chegar ao SQL. Sem isso, `?tipo_operacao_id=abc` entra numa
      // comparação com coluna `uuid`, o Postgres devolve 22P02 — que `fromPgError` não mapeia — e o
      // cliente recebe 500: um id malformado passaria a ser DISTINGUÍVEL de um id inexistente, que é
      // exatamente a diferença que `.claude/rules/security.md` proíbe na superfície de recusa. Filtrar
      // por um id que não existe devolve zero linhas; filtrar por um id que não é id faz o mesmo.
      if (f.tipo_operacao_id) {
        if (FORMA_UUID.test(f.tipo_operacao_id)) { params.push(f.tipo_operacao_id); where.push(`d.tipo_operacao_id=$${params.length}`); }
        else where.push("false");
      }
      const w = where.join(" and ");
      // Os dois JOINs são LEFT: documento legado (ponteiros nulos) permanece na listagem, com a TOP vazia.
      const wl = wrapListing(`select d.id, d.code, d.document_date, d.created_at, d.shipping_date, d.due_date, d.status, d.total, d.subtotal, d.nfe_id, c.name as client_name, u.name as responsible_name, f.name as empresa_name, d.tipo_operacao_id, toper.codigo as top_codigo, toper.codigo_base as top_codigo_base, topv.nome as top_nome, topv.versao as top_versao, (select count(*) from erp.sales_document_items i where i.document_id=d.id)::int as item_count from erp.sales_documents d join erp.people c on c.id=d.client_id left join erp.users u on u.id=d.responsible_user_id join erp.empresas f on f.id=d.empresa_id left join erp.tipos_operacao toper on toper.id=d.tipo_operacao_id and toper.organization_id=d.organization_id left join erp.tipos_operacao_versoes topv on topv.id=d.tipo_operacao_versao_id and topv.organization_id=d.organization_id where ${w} order by d.document_date desc, d.created_at desc`, params, req.query as Record<string, unknown>, q, ", coalesce(sum(t.total),0)::text total");
      const tot = await ctx.tx.query<{ n: string; total: string }>(wl.countSql, wl.params);
      const r = await ctx.tx.query(wl.pageSql, wl.params);
      // Em LOTE, sobre as linhas já carregadas: nenhuma consulta por linha. O snapshot veio no mesmo
      // `select` da página, então montar o objeto é trabalho de memória, não de rede.
      const items = (r.rows as (Record<string, unknown> & Parameters<typeof topParaTela>[0])[]).map((l) => ({ ...l, tipo_operacao: topParaTela(l) }));
      return paginaComIdGlobal(ctx, "sales_documents", { items, total: Number(tot.rows[0]!.n), page: q.page, pageSize: q.pageSize, totals: { total: tot.rows[0]!.total } });
    }));
    /**
     * AS TOPs QUE ESTA VARIANTE PODE LANÇAR — porta OPERACIONAL, não administrativa.
     *
     * A capacidade exigida é a de LANÇAR (`${perm}.create`), nunca `tipos_operacao.view`. São perguntas
     * diferentes: "quem pode vender?" e "quem pode configurar tipos de operação?". Se o seletor do
     * vendedor chamasse `/api/admin/tipos-operacao`, todo vendedor sem capacidade administrativa deixaria
     * de conseguir vender — uma tela de configuração derrubando o operacional.
     *
     * Devolve SÓ o que serve a esta variante: mesma organização, ativa, não excluída, da família canônica
     * da rota, com a versão corrente. Nada de campo administrativo.
     *
     * `contractVersion` existe para o cliente distinguir "endpoint ausente porque a API é antiga" de
     * "endpoint presente com outro formato" — é o que sustenta a descoberta de capacidade descrita no §0.2 deste contrato.
     */
    /**
     * OS PRÓXIMOS PASSOS DESTE DOCUMENTO.
     *
     * Capacidade exigida: `${perm}.view` — PERGUNTAR o que se pode gerar é leitura do documento, não
     * criação do destino. A capacidade do DESTINO é cobrada na conversão, que é onde o efeito acontece;
     * cobrá-la aqui esconderia o próximo passo de quem pode ver o documento mas não criar o derivado, e
     * a tela não conseguiria nem explicar por que o botão não aparece.
     *
     * `contractVersion` pelo mesmo motivo da capability da TOP: um 200 de formato desconhecido é o modo de
     * falha mais perigoso, porque parece sucesso.
     *
     * `politicaConfigurada` É O DISCRIMINADOR, e é o que a lista sozinha não consegue dizer: `items: []`
     * tem duas histórias — "ninguém nunca declarou o que vem depois" (e a conversão pela cadeia antiga
     * continua existindo para este documento) e "foi declarado que não vem nada depois" (e a conversão é
     * recusada). A tela precisa das duas separadas para não oferecer um botão que o servidor recusará, nem
     * esconder um que ele aceitaria.
     *
     * PARA POLÍTICA NÃO CONFIGURADA, `items` CONTINUA VAZIO. Seria fácil devolver aqui o destino da cadeia
     * antiga para a tela ter o que mostrar — e seria inventar uma política que ninguém declarou, exibida
     * com a mesma aparência das que foram declaradas de verdade.
     */
    app.get(`${base}/:id/proximos-passos`, async (req) => runService(app, req, `${perm}.view`, async (ctx) => {
      const { id } = req.params as { id: string };
      // AUTORIZAÇÃO ANTES DOS DADOS: `getDoc` já aplica tenant, escopo de empresa e variante, e responde a
      // mesma 404 de inexistente. Sem esta leitura, um id de outro tenant devolveria lista vazia com 200 —
      // resposta diferente de 404 e, portanto, um oráculo de existência.
      const doc = await getDoc(ctx, id, kind) as Record<string, unknown> & { tipo_operacao_versao_id?: string | null };
      const politica = await politicaDeDestinos(ctx, doc.tipo_operacao_versao_id);
      return { contractVersion: 1, politicaConfigurada: politica.configurada, items: politica.itens };
    }));

    app.get(`${base}/operation-types`, async (req) => runService(app, req, `${perm}.create`, async (ctx) => {
      const familia = familiaDaVariante(kind);
      const r = await ctx.tx.query<{ id: string; codigo: string; nome: string; versao: number; padrao: boolean }>(
        `select t.id, t.codigo, v.nome, v.versao, t.padrao
           from erp.tipos_operacao t
           join erp.tipos_operacao_versoes v
             on v.tipo_operacao_id = t.id and v.organization_id = t.organization_id and v.versao = t.versao_atual
          where t.organization_id = $1 and t.codigo_base = $2 and t.ativo and t.excluido_em is null
          order by t.padrao desc, t.codigo, v.nome`,
        [ctx.orgId, familia]);
      return {
        contractVersion: 1,
        family: { code: familia, label: t(chaveI18nDaFamiliaOperacional(familia) ?? familia) },
        defaultId: r.rows.find((x) => x.padrao)?.id ?? null,
        items: r.rows.map((x) => ({ id: x.id, code: x.codigo, name: x.nome, version: x.versao, isDefault: x.padrao }))
      };
    }));
    app.get(`${base}/:id`, async (req) => runService(app, req, `${perm}.view`, (ctx) => getDoc(ctx, (req.params as { id: string }).id, kind)));
    /**
     * CRIAÇÃO. `tipo_operacao_id` é OPCIONAL na API — e isso é compatibilidade de rolling deploy, não
     * frouxidão: durante a janela de implantação a web ANTIGA continua postando sem o campo, e recusá-la
     * derrubaria a criação de vendas no meio do deploy. Ausente ⇒ documento nasce legado (null/null).
     *
     * NÃO SE APLICA O PADRÃO DA FAMÍLIA quando o campo vem ausente. Seria conveniente e estaria errado:
     * um cliente antigo não declarou intenção nenhuma, e o padrão é administrável — atribuí-lo em silêncio
     * faria a mesma chamada significar coisas diferentes conforme a configuração do dia. A web NOVA escolhe
     * explicitamente (podendo PRÉ-SELECIONAR o padrão, com o valor visível).
     */
    app.post(base, async (req, reply) => reply.status(201).send(await runService(app, req, `${perm}.create`, async (ctx) => { const d = docSchema.parse(req.body); await exigirEmpresaDeLancamento(ctx, d.empresa_id); return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined, d, async () => { const top = d.tipo_operacao_id ? await resolverTopParaLancamento(ctx, familiaDaVariante(kind), d.tipo_operacao_id) : null; const r = await writeDoc(ctx, kind, d, undefined, null, top); await audit(ctx.tx, ctx, "sales_documents", r.id!, "create", top ? { tipoOperacaoId: top.tipoOperacaoId, tipoOperacaoVersaoId: top.tipoOperacaoVersaoId, tipoOperacaoCodigo: top.codigo, tipoOperacaoVersao: top.versao } : undefined); return r; })).result; })));
    /**
     * EDIÇÃO. A regra do snapshot está toda nas três linhas de `top` abaixo:
     *
     *   campo AUSENTE            → `undefined` → preserva o que está gravado (cliente antigo, e também o
     *                              caso comum de mexer noutro campo qualquer).
     *   MESMO id já gravado      → `undefined` → preserva a VERSÃO ANTIGA. Salvar de novo não re-carimba o
     *                              documento com a versão de hoje só porque a TOP ganhou uma.
     *   id DIFERENTE (ou anexar
     *   TOP a documento legado)  → resolve e congela a versão corrente da TOP nova, e AUDITA a troca.
     */
    app.put(`${base}/:id`, async (req) => runService(app, req, `${perm}.edit`, async (ctx) => {
      const { id } = req.params as { id: string };
      // `lock: true` — a EDIÇÃO também lê-e-muta a mesma linha, e a decisão que ela toma ("este status
      // permite editar?") é exatamente a que a confirmação concorrente invalida. Sem a trava: a edição lê
      // `open` do snapshot anterior, aprova a transição, e só o seu UPDATE espera o commit da confirmação
      // — que não reavalia status nenhum. O resultado é um documento `confirmed` cujos itens e total foram
      // TROCADOS depois de o estoque ter sido baixado e os títulos gerados pelo conjunto antigo: a venda
      // diz uma coisa e o ledger diz outra, sem que nenhuma das duas respostas seja erro.
      const cur = await getDoc(ctx, id, kind, { lock: true }) as { status: string; kind: string; tipo_operacao_id: string | null; tipo_operacao_versao_id: string | null };
      if (cur.status !== "open" && cur.status !== "approved") throw err("INVALID_STATUS_TRANSITION", "Documento não editável neste status");
      const d = docSchema.parse(req.body);
      /**
       * `null` EXPLÍCITO É RECUSADO — e a diferença para o campo AUSENTE é o contrato inteiro.
       *
       * `z.object` entrega `undefined` nos dois casos depois do parse, então a distinção tem de ser feita
       * ANTES, no corpo cru. Sem ela, `{"tipo_operacao_id": null}` caía no mesmo caminho de "não trocou" e
       * era ignorado em silêncio: o cliente pedia para REMOVER a TOP, recebia 200, e o documento continuava
       * com a que tinha. Descarte silencioso de campo é ampliação de escopo pela porta de trás
       * (`.claude/rules/backend-api.md`), e aqui ainda por cima sobre a identidade do lançamento.
       *
       * Recusar, e não obedecer, é a escolha certa: "sem TOP" é estado de NASCIMENTO (acervo, cliente
       * anterior à fatia), não destino alcançável por edição. Apagar a identidade de um lançamento já
       * classificado reescreveria história pela porta da edição — exatamente o que o snapshot existe para
       * impedir. O campo AUSENTE continua sendo compatibilidade legítima e não muda nada.
       *
       * A recusa é SÓ no PUT, e SÓ quando há o que remover. Num documento que JÁ é legado, `null` não é
       * pedido de remoção — é o estado atual, e o servidor acabou de devolvê-lo assim no `GET`. Recusar
       * aí tornaria o ACERVO inteiro ineditável por qualquer cliente read-modify-write (ler, mudar a
       * observação, devolver o objeto): ele levaria 422 por repetir um campo que o próprio servidor lhe
       * entregou. Seria quebrar exatamente a população que esta fatia promete não quebrar.
       *
       * Na CRIAÇÃO, `null` é legítimo e continua nascendo legado: é o que sustenta o rolling deploy.
       */
      if (cur.tipo_operacao_id !== null && req.body !== null && typeof req.body === "object" && (req.body as Record<string, unknown>)["tipo_operacao_id"] === null) {
        throw err("VALIDATION_ERROR", "tipo_operacao_id não pode ser removido de um documento; omita o campo para preservá-lo");
      }
      const trocouTop = d.tipo_operacao_id != null && d.tipo_operacao_id !== cur.tipo_operacao_id;
      const top = trocouTop ? await resolverTopParaLancamento(ctx, familiaDaVariante(kind), d.tipo_operacao_id!) : undefined;
      const r = await writeDoc(ctx, kind, d, id, undefined, top);
      await audit(ctx.tx, ctx, "sales_documents", id, "update");
      // Mudança de identidade do lançamento é evento PRÓPRIO: quem trocou a TOP de um documento não pode
      // ficar escondido dentro de um `update` genérico sem diff.
      if (top) {
        await audit(ctx.tx, ctx, "sales_documents", id, "operation_type_change",
          { tipoOperacaoCodigo: top.codigo, tipoOperacaoVersao: top.versao },
          { before: { tipoOperacaoId: cur.tipo_operacao_id, tipoOperacaoVersaoId: cur.tipo_operacao_versao_id },
            after: { tipoOperacaoId: top.tipoOperacaoId, tipoOperacaoVersaoId: top.tipoOperacaoVersaoId } });
      }
      return r;
    }));
    /**
     * CANCELAMENTO — LÊ E MUTA A MESMA LINHA, logo TRAVA A LINHA.
     *
     * O caso caro não é o documento aberto: é a VENDA CONFIRMADA. Cancelá-la estorna estoque e cancela os
     * títulos, e `reverseStock` seleciona os movimentos por `reversed_by is null and movement_type<>'reversal'`
     * — coluna que o ledger imutável NUNCA preenche. O estorno é, portanto, REPETÍVEL por construção: o que
     * impede o segundo é exclusivamente o `status='cancelled'` já gravado. Sem trava, duas requisições leem
     * `confirmed` do mesmo snapshot, passam as duas pela conferência e lançam DOIS estornos da mesma saída —
     * o produto reaparece no estoque em dobro, e nenhuma das respostas é erro.
     *
     * A conferência de título com baixa (`paid_amount > 0`) precisa de uma trava PRÓPRIA, e não da do
     * documento: quem baixa um título é `POST /api/financial/<dir>/:id/settle`, que tranca a linha do
     * TÍTULO e nunca toca `erp.sales_documents`. Travar o documento não a serializa. Lida sem trava, a
     * conferência é clássica TOCTOU: o cancelamento lê `paid_amount = 0`, a baixa commita, e o
     * cancelamento segue estornando estoque e carimbando `cancelled` sobre um título que acabou de
     * receber baixa — com o movimento bancário vivo e `erp.refresh_title_status` já desistindo de
     * reconciliar, porque ela retorna cedo para título cancelado. Por isso a leitura abaixo é
     * `for update` SOBRE AS LINHAS DE TÍTULO em que a decisão se apoia. Isso fecha os dois sentidos: se a
     * baixa chega primeiro, o cancelamento lê o `paid_amount` novo e recusa; se chega depois, `settle`
     * espera o commit, relê `status='cancelled'` e recusa com ALREADY_CANCELLED.
     *
     * `order by id` não é enfeite: ordem de travamento arbitrária é o outro jeito de produzir 40P01 contra
     * quem trava as MESMAS linhas — e `settle-batch` as trava na ordem que o CLIENTE mandou. Ordenar deste
     * lado não elimina o ciclo sozinho (o outro lado continua livre), mas tira daqui a metade não
     * determinística; a outra metade está declarada no encerramento da fatia.
     *
     * IDEMPOTÊNCIA pelo helper oficial, o mesmo da conversão e da baixa financeira — não um mecanismo novo.
     * Ela resolve outro problema: o REENVIO (retry de rede, proxy, aba duplicada). A trava serializa; a
     * chave torna o reenvio inócuo. Uma não substitui a outra: chaves DIFERENTES na mesma venda continuam
     * dependendo só da trava, e a mesma chave em voo duplo continua dependendo só da chave.
     *
     * O hash carrega a IDENTIDADE DA OPERAÇÃO — ação, documento, variante, motivo e QUEM PEDIU. A chave é
     * única por (organização, chave) e NADA MAIS: sem `sourceId` no hash, a mesma chave reaproveitada em
     * outro documento devolveria 200 com a resposta do primeiro, e o segundo ficaria aberto para sempre
     * enquanto o usuário lê "cancelado". Com ele, isso é 409 — que é a resposta honesta.
     *
     * `actorId` fecha uma porta diferente, e é o motivo de ele não ser ruído. O REPLAY devolve o corpo
     * gravado ANTES de `getDoc` rodar — e é `getDoc` que aplica o recorte de EMPRESA. Sem o autor no hash,
     * quem tivesse a capacidade mas NÃO o escopo do documento receberia, ao reusar a chave alheia, um 200
     * com dados que a mesma rota lhe responderia 404. Com o autor dentro, chave de outro usuário diverge
     * SEMPRE, para id existente ou não: deixa de ser oráculo e vira apenas "esta chave já está tomada".
     * (A mesma propriedade falta à conversão e às demais rotas idempotentes — é preexistente, está
     * declarada no encerramento da fatia e pede correção própria, fora desta fronteira.)
     *
     * O corpo é conferido ANTES de reservar chave e antes de qualquer leitura de registro: forma do pedido e
     * autorização não dependem de a transação salvar ninguém.
     */
    app.post(`${base}/:id/cancel`, async (req) => runService(app, req, `${perm}.delete`, async (ctx) => {
      const { id } = req.params as { id: string };
      const motivo = cancelSchema.parse(req.body ?? {}).reason ?? null;
      await exigirDocumentoVisivel(ctx, id, kind);
      return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined,
        { action: "cancel_sales_document", sourceId: id, sourceKind: kind, reason: motivo, actorId: ctx.user.id },
        async () => {
      const cur = await getDoc(ctx, id, kind, { lock: true }) as { status: string; kind: string };
      if (cur.status === "cancelled") throw err("ALREADY_CANCELLED", "Já cancelado");
      /**
       * ESTORNA SÓ O QUE FOI MATERIALIZADO (TOP-CONFIG-04A). Uma venda confirmada pode ter estoque e títulos,
       * só um dos dois, ou nenhum — conforme a política da versão congelada. O cancelamento NÃO pergunta à
       * configuração (nem à atual, nem à congelada) o que deveria ter acontecido: ele lê o que EXISTE ligado
       * a esta venda. `reverseStock` estorna exatamente os movimentos de origem deste documento (zero → nada),
       * e os títulos são os da mesma origem. Nenhuma compensação de algo que nunca existiu; nenhuma
       * dependência do gate — cancelar uma venda configurada continua possível com ele desligado.
       */
      let evidencia: { estornos: number; titulosCancelados: number } | null = null;
      if (cur.kind === "sale" && cur.status === "confirmed") {
        const titulos = await ctx.tx.query<{ paid_amount: string }>("select paid_amount from erp.financial_titles where organization_id=$1 and source_type='sales_documents' and source_id=$2 order by id for update", [ctx.orgId, id]);
        if (titulos.rows.some((t) => D(t.paid_amount).gt(0))) throw err("CONFLICT", "Títulos com baixa: cancele as baixas antes");
        const estornos = await reverseStock(ctx, "sales_documents", id, new Date().toISOString().slice(0, 10));
        const tc = await ctx.tx.query("update erp.financial_titles set status='cancelled' where organization_id=$1 and source_type='sales_documents' and source_id=$2 and status <> 'cancelled'", [ctx.orgId, id]);
        evidencia = { estornos, titulosCancelados: tc.rowCount ?? 0 };
      }
      const u = await ctx.tx.query("update erp.sales_documents set status='cancelled', updated_at=now() where id=$1 and organization_id=$2 and status <> 'cancelled'", [id, ctx.orgId]);
      // ROW COUNT SOB RLS: zero linha sem conferência seria "cancelado" sem efeito.
      if (u.rowCount !== 1) throw notFound("Documento");
      // O motivo vai para a auditoria — é o que faz dele um campo do contrato, e não um enfeite do hash.
      // Ausente, `undefined` mantém `metadata` nulo, exatamente como antes deste hotfix. Na venda confirmada
      // vai também o que foi estornado: é a evidência de que o cancelamento reverteu o que existia, e só.
      const metadados = { ...(motivo ? { reason: motivo } : {}), ...(evidencia ?? {}) };
      await audit(ctx.tx, ctx, "sales_documents", id, "cancel", Object.keys(metadados).length ? metadados : undefined);
      return { id, status: "cancelled" };
        })).result;
    }));
    /**
     * CONVERSÃO É OPERAÇÃO COMPOSTA — e por isso exige AS DUAS capacidades (BASE2-03C).
     *
     * Ela MUTA a variante fonte (status → `converted`) e CRIA um documento da variante destino. Autorizar
     * só pela criação do destino dava a quem tem `orders.create` o poder de encerrar um ORÇAMENTO que ele
     * não pode editar — capacidade de uma família virando mutação na outra.
     *
     * Contrato: `source.edit` ∧ `target.create`, combinados com AND. O `runService` cobra a capacidade da
     * FONTE (é a variante da rota, e é o registro que vai ser mutado). A do DESTINO é cobrada LÁ DENTRO,
     * depois de o destino REAL ser conhecido — e ainda antes de qualquer efeito. Sem permissão nova: as
     * duas já existem no catálogo.
     *
     * ┌─ POR QUE A CAPACIDADE DO DESTINO NÃO PODE MAIS SER COBRADA AQUI EM CIMA ────────────────────────┐
     * │ Até esta correção, a primeira linha do handler cobrava `permOf(nextSalesKind(kind)).create` — a  │
     * │ cadeia ANTIGA. Ela NÃO SUBSTITUÍA a cobrança do destino real: o ramo do grafo já cobrava        │
     * │ `permOf(destino).create` lá dentro, depois de resolver qual era o destino. As duas SOMAVAM.      │
     * │                                                                                                  │
     * │ Por isso o estrago tinha UMA direção só. Em orçamento → venda direta o requisito efetivo era     │
     * │ `budgets.edit` ∧ `orders.create` ∧ `sales.create`, e passou a ser `budgets.edit` ∧ `sales.create`.│
     * │ `orders.create` era exigência A MAIS, irrelevante para o que seria criado: ela RECUSAVA QUEM     │
     * │ PODIA — o vendedor com `sales.create` e sem `orders.create` levava 403 numa venda que tinha      │
     * │ direito de criar. E só podia recusar a mais, porque somar exigência estreita o conjunto          │
     * │ autorizado e nunca o alarga.                                                                     │
     * │                                                                                                  │
     * │ NÃO HOUVE ESCALAÇÃO, e é importante não inventá-la: em nenhum ramo do binário anterior um        │
     * │ derivado nascia sem a capacidade do destino real — no ramo da ponte o destino ERA               │
     * │ `nextSalesKind(kind)`, então a própria linha de cima era a cobrança correta daquele destino. É   │
     * │ por isso que a correção REMOVEU a cobrança extra e MANTEVE a do destino nos dois ramos, em vez   │
     * │ de acrescentar uma que faltasse. Qual é o destino só se sabe depois de ler o documento e o       │
     * │ grafo da versão que ele cita.                                                                    │
     * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
     */
    if (kind !== "sale") app.post(`${base}/:id/convert`, async (req, reply) => reply.status(201).send(await runService(app, req, `${perm}.edit`, async (ctx) => {
      const { id } = req.params as { id: string };
      const next = nextSalesKind(kind);
      // A TOP DO DESTINO NÃO SE HERDA DA FONTE — nem podia. `1101 — Orçamento padrão` é da família
      // `vendas.orcamento`; carregá-la para um pedido gravaria um documento cuja TOP é de outra família, e
      // a FK da 0021 nem sequer impediria (ela prova tenant e parentesco, não família). Por isso o corpo é
      // montado campo a campo e `tipo_operacao_id` NÃO entra: ele vem do PEDIDO de conversão.
      //
      // A resolução acontece ANTES de qualquer escrita. Como tudo roda numa transação só do `runService`,
      // uma TOP alvo inválida derruba a operação inteira e a fonte NÃO vira `converted` — nem por um
      // instante, nem em caso de erro no meio.
      const alvo = z.object({ tipo_operacao_id: uuid.optional().nullable() }).parse(req.body ?? {});
      /**
       * IDEMPOTÊNCIA — a web JÁ manda `Idempotency-Key` (`idem: true` no diálogo de conversão) e o
       * servidor IGNORAVA o cabeçalho: duplo clique, retry de rede ou duas abas convertiam DUAS vezes.
       *
       * O hash carrega a IDENTIDADE DA OPERAÇÃO, não só o corpo. A chave é única por (organização, chave)
       * e nada mais, então a MESMA chave reaproveitada em OUTRO documento devolveria, com 201, a resposta
       * do primeiro — uma conversão que nunca aconteceu, reportada como sucesso, e a segunda fonte ficando
       * aberta para sempre. Com fonte e destino dentro do hash isso vira 409, que é a resposta honesta.
       * `?? null` porque `undefined` SOME do JSON: sem ele, `{}` e `{"tipo_operacao_id":null}` — que são o
       * mesmo pedido — gerariam hashes diferentes.
       *
       * FICA DE FORA do bloco o PARSE DO CORPO: forma do pedido não depende de ler registro nenhum, e
       * conferi-la antes de reservar a chave é a mesma ordem que o resto do servidor usa.
       *
       * A CAPACIDADE DO DESTINO, PORÉM, FICA DENTRO — e isto é uma correção do texto que estava aqui, não
       * um afrouxamento. Ela costumava ser cobrada lá em cima porque o destino era uma constante do
       * produto; agora ele depende do documento e da política da versão, que só se leem aqui dentro.
       *
       * ISSO NÃO DEIXA CHAVE ÓRFÃ, e é o mesmo motivo que já derrubava a justificativa antiga ("a chave
       * ficaria gravada sem resposta"): a transação do `runService` desfaz TUDO em qualquer throw, e o
       * INSERT da chave de idempotência vai junto. Um 403 por falta da capacidade do destino não reserva
       * chave nenhuma — a mesma chave pode ser reenviada depois, e será a primeira execução de verdade.
       *
       * O que continua inegociável é a ORDEM DENTRO DO BLOCO: ler e travar a fonte não é efeito; a
       * permissão do destino REAL é cobrada depois de saber qual é o destino e ANTES de `writeDoc`, antes
       * de a fonte virar `converted` e antes de qualquer auditoria.
       */
      return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined,
        // O HASH NÃO MUDA DE FORMA NESTA FATIA, de propósito. `targetKind` continua sendo o destino da
        // cadeia anterior — é um componente de hash, não uma afirmação sobre o que será criado. Mudar a
        // forma faria o binário antigo e o novo calcularem chaves DIFERENTES para o mesmo pedido durante o
        // rolling deploy, e um retry que atravessasse a janela converteria duas vezes. O destino real já
        // entra no hash por `tipo_operacao_id`, que é o que distingue duas escolhas diferentes.
        { action: "convert_sales_document", sourceId: id, sourceKind: kind, targetKind: next, tipo_operacao_id: alvo.tipo_operacao_id ?? null },
        async () => {
      // `lock: true` — a fonte é LIDA E MUTADA na mesma transação, e é a única leitura desta rota que
      // disputa linha com outra requisição. Ver a justificativa inteira no cabeçalho de `getDoc`.
      const cur = await getDoc(ctx, id, kind, { lock: true }) as Record<string, unknown> & { status: string; kind: SalesKind; items: Record<string, unknown>[]; tipo_operacao_versao_id?: string | null };
      assertConvertible({ kind: cur.kind, status: cur.status as "open" });

      /**
       * ┌─ QUEM DECIDE O DESTINO: O GRAFO DA VERSÃO DE ORIGEM (TOP-CONFIG-03) ─────────────────────────┐
       * │ Até aqui a variante de destino saía de `nextSalesKind`, uma constante do produto. Agora ela  │
       * │ sai da TOP ESCOLHIDA, e o que valida a escolha é a política congelada na versão que ESTE     │
       * │ documento cita. Orçamento pode ir direto para venda se a organização configurou assim.       │
       * └──────────────────────────────────────────────────────────────────────────────────────────────┘
       *
       * ┌─ A DECISÃO É PELO ESTADO DA POLÍTICA, NUNCA PELA CARDINALIDADE ──────────────────────────────┐
       * │ `passos.length > 0` colapsava as duas leituras que a versão sabe distinguir, e o efeito era  │
       * │ um servidor que desobedecia ao administrador: quem declarasse "esta operação não tem próximo │
       * │ passo" via a web obedecer e uma chamada direta a esta rota converter assim mesmo. A política │
       * │ vazia deixava de existir na prática.                                                          │
       * │                                                                                               │
       * │   politica.configurada = true   → O GRAFO É AUTORIDADE, INCLUSIVE VAZIO.                      │
       * │                                   zero itens → RECUSA; destino fora da lista → RECUSA.        │
       * │   politica.configurada = false  → PONTE LEGADA: segue a cadeia anterior, e SÓ aqui.           │
       * └───────────────────────────────────────────────────────────────────────────────────────────────┘
       *
       * ┌─ A PONTE, E POR QUE ELA EXISTE (medido, não suposto) ────────────────────────────────────────┐
       * │ Toda versão anterior a esta fatia nasceu com `destinos_configurados = false`: não havia onde  │
       * │ declarar política. Exigir a aresta de imediato quebraria TODA conversão de TODA organização   │
       * │ no instante do deploy, incluindo a do cliente que nunca vai abrir a tela nova.                │
       * │                                                                                               │
       * │ Isto NÃO é "inferir a cadeia por conta própria": é preservar, para quem NUNCA declarou nada,  │
       * │ exatamente o contrato que ele tem hoje. Quem declara — mesmo que declare o vazio — sai da     │
       * │ ponte na mesma hora. A tela NOVA não usa esta ponte: lá, política declarada sem transição     │
       * │ mostra `Próximos passos` vazio e não oferece conversão. A ponte é transitória e tem saída     │
       * │ declarada em docs/DECISIONS.md.                                                               │
       * └───────────────────────────────────────────────────────────────────────────────────────────────┘
       */
      const politica = await politicaDeDestinos(ctx, cur.tipo_operacao_versao_id);
      let destino: SalesKind;
      let topDestino: TopDoLancamento | null = null;

      if (politica.configurada) {
        // POLÍTICA DECLARADA SEM NENHUM DESTINO É UMA DECISÃO, e a decisão é "não converte". Cair na ponte
        // aqui seria desfazer, no servidor, o que o administrador configurou. A recusa não vaza nada: fala
        // sobre a operação do documento que o usuário já está vendo.
        if (politica.itens.length === 0) {
          throw new DomainError("TIPO_OPERACAO_INDISPONIVEL",
            "A operação deste documento não gera nenhuma próxima operação");
        }
        if (!alvo.tipo_operacao_id) {
          throw new DomainError("TIPO_OPERACAO_INDISPONIVEL",
            "Escolha qual próxima operação deve ser gerada a partir deste documento");
        }
        const escolhido = politica.itens.find((x) => x.tipoOperacaoId === alvo.tipo_operacao_id);
        // MESMA recusa para "não está no grafo", "foi desativada", "foi excluída" e "não existe": o diálogo
        // de conversão não pode virar um oráculo de quais TOPs existem na organização.
        if (!escolhido) {
          throw new DomainError("TIPO_OPERACAO_INDISPONIVEL",
            "Esta próxima operação não está disponível para este documento");
        }
        destino = escolhido.variante;
        // A CAPACIDADE DO DESTINO É COBRADA DEPOIS DE SABER QUAL É O DESTINO REAL — e ainda ANTES de
        // qualquer efeito. Ler e travar a fonte não é efeito; a fonte só vira `converted` bem mais abaixo,
        // e um throw aqui desfaz a transação inteira: 403, fonte segue `open`, zero derivado, zero
        // auditoria. O grafo restringe o caminho; quem autoriza percorrê-lo continua sendo a capacidade.
        requirePermission(ctx, `${permOf(destino)}.create`);
        topDestino = await resolverTopParaLancamento(ctx, familiaDaVariante(destino), escolhido.tipoOperacaoId);
      } else {
        // PONTE LEGADA — a versão nunca declarou política, então o destino é o da cadeia anterior. A
        // capacidade cobrada é a DESSE destino, pelo mesmo motivo e no mesmo ponto do ramo de cima.
        destino = next;
        requirePermission(ctx, `${permOf(destino)}.create`);
        topDestino = alvo.tipo_operacao_id ? await resolverTopParaLancamento(ctx, familiaDaVariante(destino), alvo.tipo_operacao_id) : null;
      }
      const body = docSchema.parse({ empresa_id: cur.empresa_id, document_date: new Date().toISOString().slice(0, 10), shipping_date: cur.shipping_date, due_date: cur.due_date, client_id: cur.client_id, transporter_id: cur.transporter_id, proprietary_id: cur.proprietary_id, driver_name: cur.driver_name, payment_method_id: cur.payment_method_id, freight: cur.freight, freight_icms: cur.freight_icms, other_values: cur.other_values, discount: cur.discount, note: cur.note, installment_plan: (cur.installment_plan as { installments?: number })?.installments ? cur.installment_plan : null, items: cur.items.map((i) => ({ product_id: i.product_id, warehouse_id: i.warehouse_id, quantity: i.quantity, unit_price: i.unit_price, discount: i.discount, discount_percent: i.discount_percent, note: i.note })) });
      const r = await writeDoc(ctx, destino, body, undefined, id, topDestino);
      await ctx.tx.query("update erp.sales_documents set status='converted', updated_at=now() where id=$1", [id]);
      await audit(ctx.tx, ctx, "sales_documents", id, "convert", topDestino ? { to: r.id, tipoOperacaoDestinoId: topDestino.tipoOperacaoId, tipoOperacaoDestinoVersaoId: topDestino.tipoOperacaoVersaoId } : { to: r.id });
      if (topDestino) await audit(ctx.tx, ctx, "sales_documents", r.id!, "create", { tipoOperacaoId: topDestino.tipoOperacaoId, tipoOperacaoVersaoId: topDestino.tipoOperacaoVersaoId, tipoOperacaoCodigo: topDestino.codigo, tipoOperacaoVersao: topDestino.versao, from: id });
      return { id: r.id, kind: destino, from: id };
        })).result;
    })));
    /**
     * CONFIRMAÇÃO. A trava mora em `confirmSale`, junto da primeira decisão que ela protege; aqui fica só
     * a idempotência, que resolve o outro problema — o REENVIO do mesmo pedido.
     *
     * O hash passou a declarar a AÇÃO, e não apenas `{ confirm: id }`. Não é cosmética: a chave é
     * escolhida pelo CLIENTE e vale para o servidor inteiro, então o que distingue "confirmar a venda X"
     * de "cancelar a venda X" ou "converter o orçamento X" é exclusivamente o hash. Com as três ações
     * declarando a própria identidade no mesmo formato, a quarta não tem como copiar a errada.
     *
     * O preço está declarado: uma chave reservada pelo binário ANTERIOR e reenviada ao novo durante o
     * rolling deploy computa outro hash e recebe 409 em vez do replay. A direção da falha é a segura —
     * recusa explícita, nenhuma execução, nada duplicado — e a web gera chave nova a cada envio, de modo
     * que quem atravessaria a janela é um cliente programático que guarde a própria chave.
     */
    if (kind === "sale") app.post(`${base}/:id/confirm`, async (req) => runService(app, req, "sales.edit", async (ctx) => { const { id } = req.params as { id: string }; await exigirDocumentoVisivel(ctx, id, "sale"); return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined, { action: "confirm_sales_document", sourceId: id, actorId: ctx.user.id }, () => confirmSale(ctx, id, app.config.TOP_EFFECTS_RUNTIME_V1_ENABLED))).result; }));
  }
  // Curva ABC e relatórios de vendas simples
  /**
   * ═══ A LISTA ÚNICA DE DOCUMENTOS COMERCIAIS DE VENDA (TOP-CONFIG-03) ═══
   *
   * Orçamento, pedido e venda deixam de ser TRÊS PORTAS e passam a ser três valores de uma coluna. O
   * operador pergunta "onde está o documento do cliente X", não "em qual das três telas ele está" — e
   * procurar em três lugares era o sintoma de a arquitetura estar modelada pela tabela, não pelo processo.
   *
   * ┌─ O RECORTE POR CAPACIDADE É A PARTE PERIGOSA, E É FAIL-CLOSED ──────────────────────────────────────┐
   * │ Na tela por etapa, a capacidade fechava a PORTA inteira: sem `orders.view`, a aba não existia. Numa  │
   * │ lista única ela precisa recortar LINHAS, e é aqui que se cometem os dois erros clássicos:            │
   * │                                                                                                      │
   * │   1. recortar DEPOIS de paginar — devolve páginas curtas e vaza a contagem real do que não se pode   │
   * │      ver. Por isso a variante entra no WHERE, antes do `limit`, e não num filtro sobre o resultado.  │
   * │   2. tratar "nenhuma variante autorizada" como "todas" — a lista vazia nunca vira lista completa.    │
   * │      Sem nenhuma capacidade de leitura a resposta é 403, não uma lista sem filtro.                   │
   * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * PORTA DINÂMICA (`permission: null`): a capacidade exigida DEPENDE do que o usuário pode ver, então ela
   * é resolvida aqui dentro, antes de qualquer dado sair — o padrão que `.claude/rules/backend-api.md`
   * descreve para permissão que depende da linha. Com módulo indefinido a RLS de empresa passa a valer
   * pela união das empresas visíveis, que é MAIS LARGA; por isso o recorte de empresa é reaplicado no SQL
   * com o módulo EXPLÍCITO da permissão de vendas. RLS ∧ SQL = o escopo exato, e nenhum dos dois sozinho
   * decide.
   */
  app.get("/sales/documentos", async (req) => runService(app, req, null, async (ctx) => {
    const variantes: SalesKind[] = ["budget", "order", "sale"];
    const permitidas = variantes.filter((k) => hasPermission(ctx, `${permOf(k)}.view`));
    // "Lista vazia" NUNCA é "todas". Sem nenhuma capacidade de leitura, a recusa é explícita.
    if (permitidas.length === 0) throw denied(`${permOf("sale")}.view`);

    const q = pageQuerySchema.parse(req.query);
    const f = req.query as Record<string, string | undefined>;
    const params: unknown[] = [ctx.orgId];
    const where = [`d.organization_id=$1`, `d.deleted_at is null`];

    // A VARIANTE ENTRA NO WHERE — sempre, e antes do limite. Este é o recorte de autorização.
    params.push(permitidas); where.push(`d.kind = any($${params.length}::text[])`);

    // O filtro `kind` do usuário é PEDIDO, nunca autorização: ele só pode DIMINUIR o conjunto já
    // autorizado acima. Variante desconhecida ou não autorizada não alarga nada — a interseção esvazia.
    if (f.kind) {
      const pedidas = f.kind.split(",").map((x) => x.trim()).filter((x) => (permitidas as string[]).includes(x));
      params.push(pedidas); where.push(`d.kind = any($${params.length}::text[])`);
    }

    if (f.client_id) { params.push(f.client_id); where.push(`d.client_id=$${params.length}`); }
    if (f.status) { params.push(f.status); where.push(`d.status=$${params.length}`); }
    if (f.empresa_id) { params.push(f.empresa_id); where.push(`d.empresa_id=$${params.length}`); }
    if (f.start_date) { params.push(f.start_date); where.push(`d.document_date>=$${params.length}`); }
    if (f.end_date) { params.push(f.end_date); where.push(`d.document_date<=$${params.length}`); }
    if (q.search) { params.push(`%${q.search}%`); where.push(`(d.code ilike $${params.length} or c.name ilike $${params.length})`); }
    // Forma conferida ANTES de virar parâmetro, como na listagem por variante: id malformado recorta para
    // zero linhas em vez de virar erro de banco — e não revela nada.
    if (f.tipo_operacao_id) {
      if (FORMA_UUID.test(f.tipo_operacao_id)) { params.push(f.tipo_operacao_id); where.push(`d.tipo_operacao_id=$${params.length}`); }
      else where.push("false");
    }
    where.push(...empresaScope(ctx, "d", params, { ignoreSelected: true, modulo: moduloDaPermissao(`${permOf("sale")}.view`) }));

    const filtro = where.join(" and ");
    const de = `from erp.sales_documents d
                left join erp.people c on c.id = d.client_id
                left join erp.empresas e on e.id = d.empresa_id
                left join erp.tipos_operacao toper on toper.id = d.tipo_operacao_id and toper.organization_id = d.organization_id
                left join erp.tipos_operacao_versoes topv on topv.id = d.tipo_operacao_versao_id and topv.organization_id = d.organization_id
               where ${filtro}`;

    const total = await ctx.tx.query<{ n: string; soma: string }>(
      `select count(*)::text n, coalesce(sum(d.total),0)::text soma ${de}`, params);
    const r = await ctx.tx.query<Record<string, unknown> & {
      kind: string; tipo_operacao_id: string | null; top_codigo: string | null;
      top_codigo_base: string | null; top_nome: string | null; top_versao: number | null;
    }>(
      `select d.id, d.code, d.kind, d.document_date, d.status, d.subtotal, d.discount, d.freight, d.total,
              d.tipo_operacao_id, c.name as client_name, e.name as empresa_name,
              toper.codigo as top_codigo, toper.codigo_base as top_codigo_base, topv.nome as top_nome, topv.versao as top_versao
         ${de}
         order by d.document_date desc, d.created_at desc
         limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`, params);

    const items = r.rows.map((x) => ({
      ...x,
      // O RÓTULO DO TIPO SAI DO REGISTRY, nunca de um mapa literal no servidor ou no cliente: é a mesma
      // fonte que decide qual família cada variante é.
      kind_rotulo: t(chaveI18nDaFamiliaOperacional(familiaOperacionalDeDocumentoVenda(x.kind) ?? "") ?? x.kind),
      tipo_operacao: topParaTela(x)
    }));
    return paginaComIdGlobal(ctx, "sales_documents",
      { items, total: Number(total.rows[0]!.n), page: q.page, pageSize: q.pageSize, totals: { total: total.rows[0]!.soma } });
  }));

  app.get("/sales/abc", async (req) => runService(app, req, "report.sales_abc.view", async (ctx) => { const f = req.query as Record<string, string>; const r = await consultaEscopada<{ product_id: string; product_name: string; value: string; quantity: string }>(ctx, "select i.product_id, p.description as product_name, sum(i.total) as value, sum(i.quantity) as quantity from erp.sales_document_items i join erp.sales_documents d on d.id=i.document_id join erp.products p on p.id=i.product_id where d.organization_id=$1 and d.kind='sale' and d.status in ('confirmed','invoiced') and ($2::date is null or d.document_date>=$2) and ($3::date is null or d.document_date<=$3) and {{escopo:d.empresa_id}} group by 1,2 order by 3 desc", [ctx.orgId, f.start_date ?? null, f.end_date ?? null]); const { abcClassify } = await import("@agro/domain"); return { items: abcClassify(r.rows), total: money(r.rows.reduce((a, x) => a.plus(x.value), D(0))) }; }));
}
