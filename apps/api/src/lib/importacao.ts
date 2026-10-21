/**
 * Importação de cadastros por modelo XLSX (CADASTROS-IMPORTACAO).
 *
 * O MODELO nasce do Resource Registry (`packages/domain/src/resources/registries.ts`), que é a fonte única
 * dos campos: toda coluna editável do formulário vira coluna do modelo, com o mesmo rótulo. Obrigatório
 * vem destacado; referência, opção fixa e Sim/Não vêm como LISTA com os valores que existem na organização
 * no momento do download (aba "Listas").
 *
 * A IMPORTAÇÃO não confia no modelo — o arquivo pode ter sido editado, copiado de outro lugar ou baixado
 * antes de um cadastro mudar. Cada linha é traduzida (texto da lista → id, "Sim" → true, "1.234,56" →
 * "1234.56") e passa pelo MESMO `createOne` da tela, com todas as regras do cadastro. Uma transação para o
 * arquivo inteiro, um savepoint por linha para listar TODOS os erros. Modo `tudo` (padrão): havendo qualquer
 * erro, nada é gravado. Modo `parcial` (CADASTROS FASE 2): a linha com erro tem o savepoint desfeito e as
 * certas são gravadas na mesma transação; as erradas voltam numa PLANILHA DE ERROS gerada na mesma execução,
 * a partir do arquivo já lido em memória (nunca relido depois do commit). O CRIAR nunca atualiza registro existente. Entrada que não dá para ler sem adivinhar
 * (número ambíguo, célula com erro de fórmula, valor em coluna sem título) é RECUSADA, nunca reinterpretada
 * nem descartada em silêncio.
 *
 * DUAS AÇÕES, ESCOLHA EXPLÍCITA (IMPORTAR-01, decisão 317) — uma nunca faz o trabalho da outra, e "criar ou
 * atualizar" não existe:
 *   · CRIAR (o padrão, o de sempre): `importarPlanilha` + `createOne`, exatamente como antes;
 *   · ATUALIZAR: `atualizarPlanilha` casa cada linha pelo CÓDIGO (só nesta organização, só registro vivo, uma
 *     consulta para o arquivo) e passa pela MESMA porta de edição da tela (`getOne` + `updateOne`, injetadas pela
 *     rota) só com as colunas PRESENTES no arquivo. Coluna ausente não mexe; célula vazia em coluna presente recusa
 *     a linha; código que não casa é erro da linha, nunca criação. Só para cadastro importável COM código.
 */
import { inflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { ZodError } from "zod";
import { DomainError } from "@agro/shared";
import { getResource, moduloDaPermissao, type FieldDef, type ResourceDef } from "@agro/domain";
import { ident } from "./sql.js";
import { fromPgError, validation } from "./errors.js";
import { empresaScope, type ServiceCtx } from "./context.js";
import { atribuirIdGlobalSeAplicavel } from "./id-global.js";
import { translateIssue } from "../plugins/errors.js";

export const IMPORTACAO_LINHAS_MAXIMO = 5000;
/** Registros ativos por cadastro referenciado. Acima disso a lista não cabe no modelo: recusa explícita, nunca corte silencioso. */
export const IMPORTACAO_REFERENCIA_MAXIMO = 20000;
/**
 * Teto do XLSX DESCOMPRIMIDO. O limite de 8 MB da rota vale para o arquivo comprimido, e um zip de poucos KB
 * descomprime em GB. Folga para 5000 linhas cheias mais a aba de listas.
 */
export const IMPORTACAO_DESCOMPRIMIDO_MAXIMO = 48 * 1024 * 1024;
const ABA_DADOS = "Dados";
const ABA_LISTAS = "Listas";
const SIM = "Sim"; const NAO = "Não";
const COR_OBRIGATORIO = "FFC62828";
const COR_CONDICIONAL = "FFEF6C00";
const TIPOS_NUMERICOS = ["money", "quantity", "number", "percent", "integer"];
/** Colunas gravadas como texto: formato Texto no modelo, senão a planilha come o zero à esquerda (CPF, CEP, código). */
const TIPOS_TEXTO = ["text", "textarea", "email", "tags", "ref"];

/** Colunas do modelo: todo campo editável do formulário, na ordem da definição. JSON não cabe numa célula. */
export function camposImportaveis(def: ResourceDef): FieldDef[] {
  return def.fields.filter((f) => !f.readOnly && f.type !== "json");
}

/** Cabeçalho da coluna: o rótulo da tela; `*` marca obrigatório. Rótulo repetido ganha o nome técnico. */
export function cabecalhos(def: ResourceDef): { campo: FieldDef; titulo: string; chave: string }[] {
  return rotular(camposImportaveis(def));
}

function rotular(campos: FieldDef[]): { campo: FieldDef; titulo: string; chave: string }[] {
  const contagem = new Map<string, number>();
  for (const f of campos) contagem.set(f.label, (contagem.get(f.label) ?? 0) + 1);
  return campos.map((f) => {
    const chave = (contagem.get(f.label) ?? 0) > 1 ? `${f.label} [${f.name}]` : f.label;
    return { campo: f, chave, titulo: f.required ? `${chave} *` : chave };
  });
}
type Cabecalho = ReturnType<typeof cabecalhos>[number];

/** A AÇÃO da planilha (decisão 317). `criar` é o padrão e o comportamento de sempre. */
export const ACOES_IMPORTACAO = ["criar", "atualizar"] as const;
export type AcaoImportacao = (typeof ACOES_IMPORTACAO)[number];
export const MSG_SEM_CODIGO = "Este cadastro não tem código: atualizar por planilha não está disponível nele (só criar).";
/** Célula vazia numa coluna PRESENTE (ATUALIZAR): recusa a linha — atualizar nunca apaga valor e nunca ignora a coluna. */
export const MSG_PRESENTE_VAZIA = "Vazio numa coluna presente. Para não mexer neste campo, apague a coluna do arquivo; para mudar, preencha.";

/**
 * O CÓDIGO do cadastro, a chave do ATUALIZAR — do registry (fonte única), nunca uma lista solta. Cadastro importável
 * sem campo `code` (unidades, endereçamentos, locais de estoque, variedades) não tem chave: só CRIAR.
 */
export function campoDoCodigo(def: ResourceDef): FieldDef | null {
  return def.importacao ? def.fields.find((f) => f.name === "code") ?? null : null;
}
export const aceitaAtualizar = (def: ResourceDef) => campoDoCodigo(def) !== null;

/**
 * Colunas do modelo de cada ação. CRIAR: as de sempre (`cabecalhos`). ATUALIZAR: o CÓDIGO primeiro, OBRIGATÓRIO — mesmo
 * onde a tela o mostra só leitura (Produto, Parceiro): aqui ele só IDENTIFICA o registro e nunca é gravado —, e as
 * demais colunas do formulário, nenhuma obrigatória (coluna ausente não mexe).
 */
export function cabecalhosDaAcao(def: ResourceDef, acao: AcaoImportacao): Cabecalho[] {
  if (acao === "criar") return cabecalhos(def);
  const codigo = campoDoCodigo(def);
  if (!codigo) throw validation(MSG_SEM_CODIGO);
  return rotular([{ ...codigo, readOnly: false, required: true }, ...camposImportaveis(def).filter((f) => f.name !== codigo.name).map((f) => ({ ...f, required: false }))]);
}

/**
 * Cabeçalhos com o NOME DE ANTES (OPERACOES-01 F3a, decisão 280): a planilha baixada antes de um rótulo mudar
 * (ex.: "Armazém padrão" do Produto, hoje "Local de estoque padrão") continua importável. A declaração é do campo
 * (`FieldDef.rotulosAnteriores`, domínio), nunca uma lista solta aqui. Chave = o rótulo anterior normalizado como o
 * cabeçalho lido (sem o `*` final, `normal()`); valor = a coluna ATUAL — os erros e a planilha de erros citam o nome
 * atual, e o modelo nunca sai com o antigo. Rótulo anterior que colida com um cabeçalho atual, com o anterior de
 * OUTRA coluna ou com a coluna "Erros" é IGNORADO: o nome antigo nunca decide entre duas colunas.
 */
export function cabecalhosAnteriores(def: ResourceDef, cols: Cabecalho[] = cabecalhos(def)): Map<string, Cabecalho> {
  const atuais = new Set(cols.map((c) => normal(c.chave)));
  const candidatos = new Map<string, Set<Cabecalho>>();
  for (const c of cols) {
    for (const rotulo of c.campo.rotulosAnteriores ?? []) {
      const chave = normal(rotulo.replace(/\s*\*$/, ""));
      if (!chave || atuais.has(chave) || chave === normal(COLUNA_ERROS)) continue;
      candidatos.set(chave, (candidatos.get(chave) ?? new Set<Cabecalho>()).add(c));
    }
  }
  const anteriores = new Map<string, Cabecalho>();
  for (const [chave, colunas] of candidatos) if (colunas.size === 1) anteriores.set(chave, [...colunas][0]!);
  return anteriores;
}

/**
 * Tira o que o XML 1.0 proíbe (controles, U+FFFE/U+FFFF, surrogate solto). Um nome de cadastro com um desses
 * caracteres corromperia o modelo da organização inteira; o mesmo corte vale para o texto lido, para a lista
 * e a importação continuarem falando do mesmo valor.
 */
export function limpar(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0xfffe || c === 0xffff || (c >= 0xd800 && c <= 0xdfff)) continue;
    out += ch;
  }
  return out.trim();
}
const normal = (s: string) => limpar(s).toLocaleLowerCase("pt-BR");
/** Comparação para SUGESTÃO ("você quis dizer"): ignora maiúsculas e acentos. Nunca resolve sozinha. */
const semAcento = (s: string) => normal(s).normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Coluna acrescentada à planilha de erros; na reimportação é IGNORADA (não é campo do cadastro). */
export const COLUNA_ERROS = "Erros";
const letra = (n: number) => { let s = ""; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };
const acrescentar = (mapa: Map<string, string[]>, chave: string, id: string) => { if (!chave) return; const ids = mapa.get(chave) ?? []; if (!ids.includes(id)) ids.push(id); mapa.set(chave, ids); };

// ------------------------------------------------------------------ referências

/**
 * Cadastro alvo SEM código: o rótulo sozinho repete (armazém entre empresas, a unidade
 * da organização ao lado da padrão do sistema). O texto da lista leva o que distingue o registro na tela.
 * Whitelist ESTÁTICA por chave de cadastro: nenhum identificador de tabela ou coluna vem de entrada.
 */
const QUALIFICACAO: Record<string, { colunas: string[]; join: string; exibir: (rotulo: string, q: (string | null)[]) => string }> = {
  warehouses: { colunas: ["t.initials", "e.name"], join: "left join erp.empresas e on e.id = t.empresa_id and e.organization_id = t.organization_id", exibir: (r, [sigla, empresa]) => `${sigla ? `${sigla} - ` : ""}${r}${empresa ? ` (${empresa})` : ""}` },
  cultivations: { colunas: ["t.crop"], join: "", exibir: (r, [cultura]) => (cultura ? `${r} (${cultura})` : r) },
  measurement_units: { colunas: ["t.name"], join: "", exibir: (r, [nome]) => (nome ? `${r} - ${nome}` : r) },
};

interface Referencia {
  alvo: ResourceDef;
  /** textos da aba Listas, na ordem */
  exibicao: string[];
  /** 1º estágio: texto exato da lista */
  porExibicao: Map<string, string[]>;
  /** 2º estágio: rótulo ou código exatos */
  porTextoExato: Map<string, string[]>;
  /** 3º estágio: qualquer um dos anteriores sem diferenciar maiúsculas */
  porTextoSolto: Map<string, string[]>;
  /** texto-base de cada registro (sem desempate): o caminho do filho criado no próprio arquivo parte dele */
  basePorId: Map<string, string>;
  /** só para a sugestão: texto sem acento e sem maiúsculas → ids */
  porSemAcento: Map<string, string[]>;
  /** texto a sugerir para cada id (o da lista, ou o caminho do criado no próprio arquivo) */
  exibicaoPorId: Map<string, string>;
}

/** `base` = texto sem o desempate: quem o digita sem o sufixo cai em "ambíguo", não em "não encontrado". */
function indexar(ref: Referencia, id: string, exibicao: string, rotulo: string, codigo: string, base = exibicao) {
  acrescentar(ref.porExibicao, exibicao, id);
  for (const t of new Set([base, rotulo, codigo])) if (t !== exibicao) acrescentar(ref.porTextoExato, t, id);
  for (const t of new Set([exibicao, base, rotulo, codigo])) if (t) acrescentar(ref.porTextoSolto, normal(t), id);
  for (const t of new Set([exibicao, base, rotulo, codigo])) if (t) acrescentar(ref.porSemAcento, semAcento(t), id);
  if (!ref.exibicaoPorId.has(id)) ref.exibicaoPorId.set(id, exibicao);
}

type LinhaReferencia = { id: string; rotulo: string | null; codigo: string | null; padrao: boolean; pai: string | null } & Record<string, unknown>;

/**
 * Valores de um cadastro referenciado, como aparecem na lista e como são reconhecidos na importação. Mesmo
 * recorte de `GET /resources/:key/options`: tenant, vivos, ativos e — se o cadastro tem empresa — o escopo do
 * MÓDULO DO CADASTRO APONTADO (armazém → estoque). A importação roda com a permissão de criar do cadastro de
 * origem, cujo módulo pode ser nulo (produto é de organização), e nulo na RLS é a UNIÃO dos módulos.
 */
async function carregarReferencia(ctx: ServiceCtx, alvo: ResourceDef, filtro?: Record<string, string>): Promise<Referencia> {
  const cols = await ctx.tx.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema='erp' and table_name=$1", [alvo.table]);
  const existe = new Set(cols.rows.map((c) => c.column_name));
  const where: string[] = [];
  const params: unknown[] = [];
  if (existe.has("organization_id")) { params.push(ctx.orgId); where.push(alvo.reference || alvo.sharedDefaults ? `(t.organization_id is null or t.organization_id=$${params.length})` : `t.organization_id=$${params.length}`); }
  if (alvo.softDelete && existe.has("deleted_at")) where.push("t.deleted_at is null");
  if (existe.has("is_active")) where.push("t.is_active");
  if ((alvo.empresaScoped || alvo.empresaScopedNulo) && existe.has("empresa_id")) {
    where.push(...empresaScope(ctx, "t.empresa_id", params, { nullable: Boolean(alvo.empresaScopedNulo), ignoreSelected: true, modulo: moduloDaPermissao(`${alvo.permission}.view`) }));
  }
  const temCodigo = existe.has("code");
  const caminho = Boolean(alvo.tree) && !temCodigo && existe.has("parent_id");
  const q = QUALIFICACAO[alvo.key];
  const sel = [
    "t.id::text as id", `t.${ident(alvo.labelField)}::text as rotulo`, temCodigo ? "t.code::text as codigo" : "null::text as codigo",
    existe.has("organization_id") ? "(t.organization_id is null) as padrao" : "false as padrao",
    caminho ? "t.parent_id::text as pai" : "null::text as pai",
    // recorte da LISTA (registry `ref.filtro`, ex.: grupo do produto só analítico). Nome de coluna vem do
    // registry (estático), valor parametrizado. Fora do recorte o registro continua RECONHECIDO: quem digita
    // um grupo sintético recebe a recusa clara da regra do cadastro, não um "não encontrado".
    ...Object.keys(filtro ?? {}).filter((c) => existe.has(c)).map((c, i) => { params.push(filtro![c]); return `(t.${ident(c)}::text = $${params.length}) as f${i}`; }),
    ...(q?.colunas ?? []).map((c, i) => `${c}::text as q${i}`),
  ];
  const r = await ctx.tx.query<LinhaReferencia>(
    `select ${sel.join(", ")} from erp.${ident(alvo.table)} t ${q?.join ?? ""} ${where.length ? "where " + where.join(" and ") : ""} order by ${temCodigo ? "t.code, " : ""}2 limit ${IMPORTACAO_REFERENCIA_MAXIMO + 1}`, params);
  if (r.rows.length > IMPORTACAO_REFERENCIA_MAXIMO) throw validation(`${alvo.labelPlural}: mais de ${IMPORTACAO_REFERENCIA_MAXIMO} registros ativos; a lista não cabe no modelo de importação.`);

  const porId = new Map(r.rows.map((x) => [x.id, x]));
  const rotuloDe = (x: LinhaReferencia) => limpar(x.rotulo ?? "");
  const caminhoDe = (x: LinhaReferencia): string => {
    const partes: string[] = [];
    // subida limitada: dado antigo com ciclo não trava a geração do modelo
    for (let y: LinhaReferencia | undefined = x, k = 0; y && k < 64; y = y.pai ? porId.get(y.pai) : undefined, k++) partes.unshift(rotuloDe(y));
    return partes.join(" > ");
  };
  const qualificadores = (x: LinhaReferencia) => (q?.colunas ?? []).map((_, i) => { const v = x[`q${i}`]; return typeof v === "string" && limpar(v) ? limpar(v) : null; });
  const nosFiltros = Object.keys(filtro ?? {}).filter((c) => existe.has(c)).length;
  const itens = r.rows.map((x) => {
    const rotulo = rotuloDe(x); const codigo = limpar(x.codigo ?? "");
    const naLista = Array.from({ length: nosFiltros }, (_, i) => x[`f${i}`]).every((v) => v === true);
    let base = codigo ? `${codigo} - ${rotulo}` : caminho ? caminhoDe(x) : q ? q.exibir(rotulo, qualificadores(x)) : rotulo;
    if (alvo.sharedDefaults && x.padrao) base = `${base} (padrão)`;
    return { id: x.id, rotulo, codigo, base, naLista };
  }).filter((x) => x.base);
  if (caminho) itens.sort((a, b) => a.base.localeCompare(b.base, "pt-BR"));
  // o que continua repetido depois da qualificação ganha um desempate estável (o começo do UUID): o valor da
  // lista SEMPRE aponta para um registro só
  const repeticoes = new Map<string, number>();
  for (const x of itens) repeticoes.set(normal(x.base), (repeticoes.get(normal(x.base)) ?? 0) + 1);
  const ref: Referencia = { alvo, exibicao: [], porExibicao: new Map(), porTextoExato: new Map(), porTextoSolto: new Map(), basePorId: new Map(), porSemAcento: new Map(), exibicaoPorId: new Map() };
  for (const x of itens) {
    const exibicao = (repeticoes.get(normal(x.base)) ?? 0) > 1 ? `${x.base} [${x.id.slice(0, 8)}]` : x.base;
    if (x.naLista) ref.exibicao.push(exibicao);
    ref.basePorId.set(x.id, x.base);
    indexar(ref, x.id, exibicao, x.rotulo, x.codigo, x.base);
  }
  return ref;
}

/** Registro criado numa linha anterior do mesmo arquivo passa a valer como superior das seguintes. */
function adicionarCriado(ref: Referencia, def: ResourceDef, criado: Record<string, unknown>) {
  const id = String(criado["id"]);
  const rotulo = limpar(String(criado[def.labelField] ?? ""));
  const codigo = limpar(String(criado["code"] ?? ""));
  const pai = typeof criado["parent_id"] === "string" ? ref.basePorId.get(criado["parent_id"]) : undefined;
  const base = codigo ? `${codigo} - ${rotulo}` : pai ? `${pai} > ${rotulo}` : rotulo;
  if (!base) return;
  ref.basePorId.set(id, base);
  // sem desempate: texto igual ao de um registro existente deixa os dois ambíguos, e a linha que o citar é recusada
  indexar(ref, id, base, rotulo, codigo);
}

/**
 * `falhas`: textos que linhas ANTERIORES com erro teriam criado (só para o próprio cadastro, em árvore). Quem
 * cita uma delas não é "não encontrado": depende de uma linha que não foi gravada, e a mensagem diz qual.
 * `superior`: a coluna é o auto-relacionamento; o que fazer é incluir a linha do superior acima ou cadastrá-lo.
 */
function resolver(ref: Referencia, t: string, opcoes: { superior?: boolean; falhas?: Map<string, number> } = {}): { id: string } | { erro: string } {
  const r = resolverTexto(ref, t);
  if ("id" in r || !r.naoEncontrado) return r;
  const dependencia = opcoes.falhas?.get(semAcento(t));
  if (dependencia !== undefined) return { erro: `"${t}" depende da linha ${dependencia}, que tem erro. Corrija a linha ${dependencia} e importe as duas juntas.` };
  // "você quis dizer" só com UMA correspondência (ignorando maiúsculas e acentos); duas ou mais não sugerem nada
  const parecidos = ref.porSemAcento.get(semAcento(t)) ?? [];
  const sugestao = parecidos.length === 1 ? ref.exibicaoPorId.get(parecidos[0]!) : undefined;
  const oQueFazer = opcoes.superior ? "Inclua a linha do superior acima desta ou cadastre-o antes." : `Use um valor da aba ${ABA_LISTAS}.`;
  return { erro: `"${t}" não encontrado em ${ref.alvo.labelPlural}. ${sugestao ? `Você quis dizer "${sugestao}"? ` : ""}${oQueFazer}` };
}

function resolverTexto(ref: Referencia, t: string): { id: string } | { erro: string; naoEncontrado?: true } {
  const estagios: [Map<string, string[]>, string][] = [[ref.porExibicao, t], [ref.porTextoExato, t], [ref.porTextoSolto, normal(t)]];
  for (const [mapa, chave] of estagios) {
    const ids = mapa.get(chave);
    if (ids?.length === 1) return { id: ids[0]! };
    if (ids && ids.length > 1) return { erro: `"${t}" corresponde a mais de um registro de ${ref.alvo.labelPlural}. Use o valor exatamente como está na aba ${ABA_LISTAS}.` };
  }
  return { erro: `"${t}" não encontrado em ${ref.alvo.labelPlural}. Use um valor da aba ${ABA_LISTAS}.`, naoEncontrado: true };
}

/**
 * O ExcelJS aplica validação a uma FAIXA inteira (uma regra só no XML, em vez de uma por célula), mas a
 * tipagem publicada não declara a propriedade. Interface estreita, sem `any`.
 */
interface ComValidacaoEmFaixa { dataValidations: { add(faixa: string, regra: ExcelJS.DataValidation): void } }

const rotuloDoValor = (f: FieldDef | undefined, v: unknown): string => {
  if (typeof v === "boolean") return v ? SIM : NAO;
  return f?.options?.find((o) => o.value === String(v))?.label ?? String(v);
};
/** Obrigatório condicional (registry `requiredWhen`). Condição vazia vale o `default` do campo, como no banco. */
const condicao = (def: ResourceDef, f: FieldDef) => {
  const w = f.requiredWhen; if (!w) return null;
  const alvo = def.fields.find((x) => x.name === w.field);
  return { campo: w.field, igual: w.equals, texto: `“${alvo?.label ?? w.field}” = ${rotuloDoValor(alvo, w.equals)}`, padrao: alvo?.default };
};

// ------------------------------------------------------------------ modelo

/**
 * `acao` (decisão 317): o modelo do CRIAR é o de sempre. O do ATUALIZAR traz o CÓDIGO primeiro (vermelho, a chave),
 * as mesmas colunas e listas, nenhuma outra obrigatória, e as instruções do ATUALIZAR.
 */
export async function gerarModelo(ctx: ServiceCtx, def: ResourceDef, acao: AcaoImportacao = "criar"): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const dados = wb.addWorksheet(ABA_DADOS, { views: [{ state: "frozen", ySplit: 1 }] });
  const listas = wb.addWorksheet(ABA_LISTAS);
  const instrucoes = wb.addWorksheet("Instruções");
  const cols = cabecalhosDaAcao(def, acao);
  dados.columns = cols.map((c) => ({ header: c.titulo, key: c.campo.name, width: Math.max(14, Math.min(40, c.titulo.length + 4)) }));
  let colunaLista = 0; let temCondicional = false;
  for (const [i, c] of cols.entries()) {
    const f = c.campo;
    const cond = condicao(def, f);
    if (cond) temCondicional = true;
    if (TIPOS_TEXTO.includes(f.type)) dados.getColumn(i + 1).numFmt = "@";
    const cab = dados.getRow(1).getCell(i + 1);
    const destaque = f.required ? COR_OBRIGATORIO : cond ? COR_CONDICIONAL : null;
    cab.font = { bold: true, color: { argb: destaque ? "FFFFFFFF" : "FF1F2937" } };
    cab.fill = { type: "pattern", pattern: "solid", fgColor: { argb: destaque ?? "FFE5E7EB" } };
    // o superior numa linha ANTERIOR do arquivo só existe no CRIAR: no ATUALIZAR nada nasce, o superior já existe
    const autoRef = acao === "criar" && f.type === "ref" && f.ref?.resource === def.key;
    const chaveDoAtualizar = acao === "atualizar" && f.name === "code";
    let valores: string[] | null = null; let dica = chaveDoAtualizar ? "CHAVE: o código do registro desta organização que será atualizado, como na listagem. Ele nunca é alterado." : f.help ?? "";
    const mais = (t: string) => { dica = `${dica ? dica + " " : ""}${t}`; };
    if (f.type === "ref" && f.ref) { const alvo = getResource(f.ref.resource); if (alvo) { valores = (await carregarReferencia(ctx, alvo, f.ref.filtro)).exibicao; mais(autoRef ? `Escolha da lista ou use uma linha ANTERIOR deste arquivo (${alvo.labelPlural}).` : `Escolha da lista (cadastros de ${alvo.labelPlural} existentes).`); } }
    else if (f.type === "select" && f.options) { valores = f.options.map((o) => o.label); mais("Escolha da lista."); }
    else if (f.type === "boolean") { valores = [SIM, NAO]; mais("Sim ou Não."); }
    else if (f.busca === "municipios") mais('Código IBGE (7 dígitos) ou "Nome - UF", ex.: "Gurupi - TO".');
    else if (f.type === "date") mais("Data no formato DD/MM/AAAA.");
    else if (TIPOS_NUMERICOS.includes(f.type)) mais(f.type === "integer" ? "Número inteiro." : "Número com vírgula decimal (1234,56 ou 1.234,56).");
    else if (f.type === "tags" && f.options) mais(`Separe por ";": ${f.options.map((o) => o.label).join("; ")}.`);
    if (f.required) dica = `OBRIGATÓRIO. ${dica}`;
    else if (cond) dica = `OBRIGATÓRIO quando ${cond.texto}. ${dica}`;
    if (dica.trim()) cab.note = dica.trim();
    if (valores) {
      colunaLista += 1;
      const col = letra(colunaLista);
      listas.getCell(`${col}1`).value = c.chave; listas.getCell(`${col}1`).font = { bold: true };
      valores.forEach((v, k) => { listas.getCell(`${col}${k + 2}`).value = v; });
      listas.getColumn(colunaLista).width = 40;
      const fim = Math.max(2, valores.length + 1);
      const coluna = letra(i + 1);
      (dados as unknown as ComValidacaoEmFaixa).dataValidations.add(`${coluna}2:${coluna}${IMPORTACAO_LINHAS_MAXIMO + 1}`, {
        type: "list", allowBlank: !f.required, formulae: [`${ABA_LISTAS}!$${col}$2:$${col}$${fim}`],
        // superior da árvore pode ser uma linha anterior do próprio arquivo, que não está na lista: avisa, não barra
        showErrorMessage: true, errorStyle: autoRef ? "warning" : "stop", errorTitle: c.chave,
        error: autoRef ? "Fora da lista. Vale se for uma linha ANTERIOR deste arquivo; senão, escolha da lista." : valores.length ? "Escolha um valor da lista." : `Não há ${c.chave.toLowerCase()} cadastrado(a). Cadastre antes de importar.`,
      });
    }
  }
  instrucoes.getColumn(1).width = 110;
  const foraDoModelo = def.fields.filter((f) => !f.readOnly && f.type === "json").map((f) => f.label);
  const itens = acao === "atualizar" ? [
    `Preencha a aba "${ABA_DADOS}", uma linha por registro a ATUALIZAR (até ${IMPORTACAO_LINHAS_MAXIMO}). Não altere o título das colunas que ficarem.`,
    `A coluna "${cols[0]!.chave}" (em VERMELHO) é a CHAVE: identifica o registro desta organização que será atualizado. Ela nunca é alterada.`,
    "Só as colunas PRESENTES no arquivo são alteradas. APAGUE as colunas que não quer mudar: coluna ausente não mexe no cadastro.",
    "Célula VAZIA numa coluna presente RECUSA a linha: atualizar nunca apaga valor. Para limpar um campo, use a tela do cadastro.",
    "Código que não existe nesta organização é ERRO da linha: atualizar nunca cria registro (para criar, use \"Criar registros\"). Código repetido no arquivo também é erro.",
    ...(temCondicional ? ["Colunas em LARANJA são obrigatórias numa condição: a nota do cabeçalho diz qual (vale o valor da planilha ou, sem a coluna, o do cadastro)."] : []),
    `Colunas com lista só aceitam valores da lista (aba "${ABA_LISTAS}"), que traz os cadastros existentes no momento do download. Cadastrou algo depois? Baixe o modelo de novo.`,
    "Nomes repetidos vêm na lista com um complemento (empresa, grupo, caminho). Use o valor exatamente como está na lista.",
    "Colunas de texto estão no formato Texto para manter zeros à esquerda (CPF/CNPJ, CEP, códigos). Ao colar de outra planilha, cole só os valores.",
    "Números com vírgula decimal: 1234,56 ou 1.234,56. Ponto sem vírgula (1.000) é recusado por ser ambíguo.",
    "Sim/Não, opções e datas (DD/MM/AAAA) seguem o texto da tela. Célula com erro de fórmula é recusada.",
    "Ao importar, o sistema mostra a PRÉVIA antes de gravar: quantas linhas casaram pelo código, quantas não casaram e QUAIS colunas mudam em cada uma. Cada linha passa pelas mesmas regras da tela de edição.",
    "Nenhum registro é excluído por planilha.",
    ...(foraDoModelo.length ? [`Não vão no modelo (altere pela tela): ${foraDoModelo.join(", ")}.`] : []),
  ] : [
    `Preencha a aba "${ABA_DADOS}", uma linha por registro (até ${IMPORTACAO_LINHAS_MAXIMO}). Não altere nem reordene o cabeçalho.`,
    "Colunas em VERMELHO com * são obrigatórias.",
    ...(temCondicional ? ["Colunas em LARANJA são obrigatórias numa condição: a nota do cabeçalho diz qual."] : []),
    `Colunas com lista só aceitam valores da lista (aba "${ABA_LISTAS}"), que traz os cadastros existentes no momento do download. Cadastrou algo depois? Baixe o modelo de novo.`,
    "Nomes repetidos vêm na lista com um complemento (empresa, grupo, caminho). Use o valor exatamente como está na lista.",
    "Colunas de texto estão no formato Texto para manter zeros à esquerda (CPF/CNPJ, CEP, códigos). Ao colar de outra planilha, cole só os valores.",
    "Números com vírgula decimal: 1234,56 ou 1.234,56. Ponto sem vírgula (1.000) é recusado por ser ambíguo.",
    "Sim/Não, opções e datas (DD/MM/AAAA) seguem o texto da tela. Célula com erro de fórmula é recusada.",
    "Ao importar, o sistema mostra a prévia com os erros linha a linha. \"Importar tudo\" só grava se não houver nenhum erro; \"Importar só as linhas certas\" grava as certas e devolve uma planilha com as linhas de erro (coluna \"Erros\" no fim), que pode ser corrigida e importada de novo.",
    "Importar sempre CRIA registros; não altera cadastros existentes. Código repetido é recusado.",
    ...(def.tree ? ["Cadastro em árvore: o superior pode ser um registro existente ou uma linha ANTERIOR deste mesmo arquivo."] : []),
    ...(foraDoModelo.length ? [`Não vão no modelo (preencha pela tela depois): ${foraDoModelo.join(", ")}.`] : []),
  ];
  const linhas = [`${acao === "atualizar" ? "Modelo de atualização" : "Modelo de importação"} — ${def.labelPlural}`, "", ...itens.map((t, k) => `${k + 1}. ${t}`)];
  linhas.forEach((t, k) => { const c = instrucoes.getCell(`A${k + 1}`); c.value = t; if (k === 0) c.font = { bold: true, size: 13 }; });
  return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
}

// ------------------------------------------------------------------ leitura do arquivo

export interface ErroImportacao { linha: number; coluna: string | null; mensagem: string }
export type ModoImportacao = "tudo" | "parcial";
export interface ResultadoImportacao {
  linhas: number; gravadas: number; erros: ErroImportacao[]; simulacao: boolean;
  modo: ModoImportacao;
  /** linhas que passam (na prévia: seriam gravadas no modo parcial) */
  certas: number;
  /** linhas com ao menos um erro */
  com_erro: number;
  /** XLSX com SÓ as linhas com erro (colunas do modelo + "Erros"), em base64; null sem linha com erro ou acima do limite */
  planilha_erros_base64: string | null;
  /**
   * Total de linhas de dados no arquivo (antes do recorte `offset`/`limit`). Aditivo: a tela usa para progresso
   * em lotes; cliente antigo ignora. Ausente = o pedido processou o arquivo inteiro (`linhas` = o total).
   */
  linhas_arquivo?: number;
}

/** Teto sugerido de linhas por pedido na gravação (a tela usa 40; a API aceita até 500 no `limit`). */
export const LOTE_DA_IMPORTACAO = 40;

/**
 * Recorta as linhas de dados já lidas (`offset`/`limit` 0-based sobre o array, não o número da planilha).
 * Sem os dois parâmetros, devolve a planilha intacta. Fatia vazia (offset além do fim) = linhas [].
 */
export function recortarPlanilha(planilha: PlanilhaLida, offset?: number, limit?: number): PlanilhaLida {
  if (offset === undefined || limit === undefined) return planilha;
  return { ...planilha, linhas: planilha.linhas.slice(offset, offset + limit) };
}
/** O que muda numa linha do ATUALIZAR: a linha, o código e os TÍTULOS das colunas cujo valor gravado mudou. */
export interface AlteracaoImportacao { linha: number; codigo: string; colunas: string[] }
/**
 * Resultado do ATUALIZAR (decisão 317): o do CRIAR mais a ação e a PRÉVIA do que muda. O CRIAR não ganha chave
 * nenhuma — a resposta dele é a de antes. `certas` = casaram e passaram (mudando ou não); `gravadas` = as que MUDARAM
 * e foram gravadas; linha que não muda nada não é gravada (nem auditada).
 */
export interface ResultadoAtualizacao extends ResultadoImportacao {
  acao: "atualizar";
  /** linhas cujo código identificou UM registro vivo desta organização */
  casaram: number;
  /** linhas cujo código não identificou registro (vazio, ilegível, inexistente, de outra organização, excluído) */
  nao_casaram: number;
  /** linhas certas em que nada muda */
  sem_alteracao: number;
  /** linhas certas em que algo muda, e o quê */
  alteracoes: AlteracaoImportacao[];
}
interface Celula { v: ExcelJS.CellValue; formato: string }
/**
 * O arquivo lido e conferido na forma, sem banco: cabeçalho mapeado e só as linhas que existem. `presentes`: os
 * campos cujas colunas ESTÃO no cabeçalho do arquivo (no ATUALIZAR, só eles são alterados).
 */
export interface PlanilhaLida { cols: Cabecalho[]; presentes: Set<string>; linhas: { n: number; celulas: Map<string, Celula>; erros: ErroImportacao[] }[]; erros: ErroImportacao[] }

/**
 * Soma do tamanho DESCOMPRIMIDO das partes do zip, descomprimindo de verdade com teto: o tamanho declarado no
 * cabeçalho do zip vem do próprio arquivo, e o arquivo pode mentir. `null` = não é um zip legível.
 */
export function tamanhoDescomprimido(zip: Buffer, limite: number): number | null {
  const u16 = (p: number) => zip.readUInt16LE(p); const u32 = (p: number) => zip.readUInt32LE(p);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) if (u32(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const partes = u16(eocd + 10);
  let p = u32(eocd + 16);
  let soma = 0;
  for (let k = 0; k < partes; k++) {
    if (p + 46 > zip.length || u32(p) !== 0x02014b50) return null;
    const metodo = u16(p + 10); const comprimido = u32(p + 20); const local = u32(p + 42);
    if (local + 30 > zip.length || u32(local) !== 0x04034b50) return null;
    const inicio = local + 30 + u16(local + 26) + u16(local + 28);
    if (inicio + comprimido > zip.length) return null;
    const parte = zip.subarray(inicio, inicio + comprimido);
    if (metodo === 0) soma += comprimido;
    else if (metodo === 8) {
      try { soma += inflateRawSync(parte, { maxOutputLength: limite - soma + 1 }).length; }
      catch (e) { if ((e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") return limite + 1; return null; }
    } else return null;
    if (soma > limite) return soma;
    p += 46 + u16(p + 28) + u16(p + 30) + u16(p + 32);
  }
  return soma;
}

const ehObjeto = (v: ExcelJS.CellValue): v is Exclude<ExcelJS.CellValue, Date | string | number | boolean | null | undefined> => Boolean(v) && typeof v === "object" && !(v instanceof Date);
const ehFormula = (v: ExcelJS.CellValue) => ehObjeto(v) && ("formula" in v || "sharedFormula" in v);

/** O valor por trás de uma fórmula; o resto passa como está. */
function valorBase(v: ExcelJS.CellValue): ExcelJS.CellValue {
  return ehFormula(v) ? ((v as { result?: ExcelJS.CellValue }).result ?? null) : v;
}

/** Célula que não tem valor legível: erro de fórmula, fórmula sem resultado calculado, data inválida. */
function erroDaCelula(v: ExcelJS.CellValue): string | null {
  if (ehFormula(v)) {
    const r = (v as { result?: ExcelJS.CellValue }).result;
    return r === undefined || r === null ? "Fórmula sem valor calculado. Cole só os valores." : erroDaCelula(r);
  }
  if (ehObjeto(v) && "error" in v) return `Célula com erro (${String(v.error)}). Corrija ou cole só os valores.`;
  if (v instanceof Date && Number.isNaN(v.getTime())) return "Data inválida na célula.";
  return null;
}

function texto(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (ehObjeto(v)) {
    if ("richText" in v) return limpar(v.richText.map((r) => r.text).join(""));
    if (ehFormula(v)) return texto(valorBase(v));
    if ("text" in v) return texto(v.text as ExcelJS.CellValue);
    return "";
  }
  return limpar(String(v));
}

/** Número em pt-BR, sem adivinhar: `1.000` pode ser mil ou um, e é recusado. Célula numérica vale como está. */
function numero(v: ExcelJS.CellValue): string | null {
  const b = valorBase(v);
  if (typeof b === "number") return Number.isFinite(b) ? String(b) : null;
  const s = texto(v).replace(/\s/g, "");
  if (/^-?\d+(,\d+)?$/.test(s)) return s.replace(",", ".");
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) return s.replace(/\./g, "").replace(",", ".");
  return null;
}

function data(v: ExcelJS.CellValue): string | null {
  const b = valorBase(v);
  if (b instanceof Date) return Number.isNaN(b.getTime()) ? null : b.toISOString().slice(0, 10);
  const s = texto(v);
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s); const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const [a, m, d] = br ? [Number(br[3]), Number(br[2]), Number(br[1])] : iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [0, 0, 0];
  if (!a) return null;
  const dt = new Date(Date.UTC(a, m - 1, d));
  // 31/02 não existe: o Date "rola" para março, e a comparação pega
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Formato de número que desenha zeros à esquerda (`00000\-000`, `000\.000\.000\-00`): o arquivo guarda o número SEM eles. */
const formatoDeZeros = (fmt: string) => { const f = fmt.replace(/[\\"]/g, ""); return /^[0\-./() ]+$/.test(f) && (f.match(/0/g) ?? []).length >= 2; };

/**
 * Lê e confere a FORMA do arquivo, sem banco: roda antes de abrir a transação, para nenhuma conexão do pool
 * ficar presa enquanto o XLSX é descompactado e percorrido.
 */
export async function lerPlanilha(def: ResourceDef, arquivo: Buffer, acao: AcaoImportacao = "criar"): Promise<PlanilhaLida> {
  const cols = cabecalhosDaAcao(def, acao);
  const falha = (mensagem: string, linha = 0): PlanilhaLida => ({ cols, presentes: new Set(), linhas: [], erros: [{ linha, coluna: null, mensagem }] });
  const tamanho = tamanhoDescomprimido(arquivo, IMPORTACAO_DESCOMPRIMIDO_MAXIMO);
  if (tamanho === null) return falha("Arquivo inválido: envie o modelo em XLSX.");
  if (tamanho > IMPORTACAO_DESCOMPRIMIDO_MAXIMO) return falha(`Arquivo grande demais depois de descompactado (limite de ${IMPORTACAO_DESCOMPRIMIDO_MAXIMO / 1024 / 1024} MB). Divida em arquivos menores.`);
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(arquivo as unknown as ArrayBuffer); } catch { return falha("Arquivo inválido: envie o modelo em XLSX."); }
  const ws = wb.getWorksheet(ABA_DADOS) ?? wb.worksheets[0];
  // zip bem formado sem nenhuma aba não é planilha
  if (!ws) return falha("Arquivo inválido: envie o modelo em XLSX.");
  // o nome de antes primeiro e o atual por cima (decisão 280): o anterior nunca toma o lugar de um cabeçalho atual
  const porChave = new Map<string, Cabecalho>([...cabecalhosAnteriores(def, cols), ...cols.map((c): [string, Cabecalho] => [normal(c.chave), c])]);
  // cabeçalho: identifica cada coluna pelo rótulo; coluna desconhecida ou repetida é RECUSADA (não descartada em silêncio)
  const mapa = new Map<number, Cabecalho>();
  const erros: ErroImportacao[] = [];
  const vistas = new Set<string>();
  // coluna "Erros" da planilha de erros: na reimportação é ignorada (cabeçalho e células), nunca gravada
  const ignoradas = new Set<number>();
  ws.getRow(1).eachCell((cell, n) => {
    const t = texto(cell.value).replace(/\s*\*$/, "");
    if (!t) return;
    const c = porChave.get(normal(t));
    if (!c && normal(t) === normal(COLUNA_ERROS) && !ignoradas.size) { ignoradas.add(n); return; }
    if (!c) { erros.push({ linha: 1, coluna: t, mensagem: `Coluna desconhecida para ${def.labelPlural}. Baixe o modelo atualizado.` }); return; }
    if (vistas.has(c.campo.name)) { erros.push({ linha: 1, coluna: t, mensagem: "Coluna repetida no arquivo." }); return; }
    vistas.add(c.campo.name); mapa.set(n, c);
  });
  for (const c of cols) if (c.campo.required && !vistas.has(c.campo.name)) erros.push({ linha: 1, coluna: c.chave, mensagem: "Coluna obrigatória ausente no arquivo." });
  // ATUALIZAR com só a chave não muda nada: o arquivo é recusado, nunca "gravado" sem efeito
  if (acao === "atualizar" && vistas.size === 1 && vistas.has(cols[0]!.campo.name)) erros.push({ linha: 1, coluna: null, mensagem: `Nenhuma coluna para atualizar: deixe no arquivo a coluna ${cols[0]!.chave} e só as colunas que vão mudar.` });
  if (erros.length) return { cols, presentes: vistas, linhas: [], erros };

  // Só as linhas que EXISTEM no arquivo (eachRow sem includeEmpty pula os buracos): uma célula na linha
  // 1.048.576 não faz percorrer um milhão de linhas, e eachCell não cria objeto para célula ausente.
  const linhas: PlanilhaLida["linhas"] = [];
  let excedeu = 0;
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1 || excedeu) return;
    const celulas = new Map<string, Celula>();
    const errosDaLinha: ErroImportacao[] = [];
    let preenchida = false;
    row.eachCell((cell, col) => {
      if (ignoradas.has(col)) return;
      const v = cell.value;
      if (texto(v) === "" && erroDaCelula(v) === null) return;
      preenchida = true;
      const c = mapa.get(col);
      if (!c) { errosDaLinha.push({ linha: n, coluna: `Coluna ${letra(col)}`, mensagem: "Valor em coluna sem título. Apague o valor ou use o modelo." }); return; }
      celulas.set(c.campo.name, { v, formato: cell.numFmt ?? "" });
    });
    if (!preenchida) return;
    if (linhas.length >= IMPORTACAO_LINHAS_MAXIMO) { excedeu = n; return; }
    linhas.push({ n, celulas, erros: errosDaLinha });
  });
  if (excedeu) return falha(`Limite de ${IMPORTACAO_LINHAS_MAXIMO} linhas por arquivo.`, excedeu);
  if (!linhas.length) return falha("Nenhuma linha preenchida.");
  return { cols, presentes: vistas, linhas, erros: [] };
}

// ------------------------------------------------------------------ gravação

/**
 * Coluna de um erro do banco. NOT NULL diz a coluna; CHECK de coluna tem o nome padrão `<tabela>_<coluna>_check`.
 * FK e UNIQUE saem do CATÁLOGO pelo nome da restrição (ou do índice único): o detalhe `Key (col)=(valor)` não serve,
 * porque o PostgreSQL o omite para quem não enxerga a linha inteira — e a API roda sob RLS.
 */
async function campoDoErroPg(ctx: ServiceCtx, def: ResourceDef, pe: { code: string; constraint?: string; table?: string; column?: string }): Promise<string | null> {
  const campos = new Set(def.fields.map((f) => f.name));
  if (pe.code === "23502") return pe.column && campos.has(pe.column) ? pe.column : null;
  if ((pe.code === "23503" || pe.code === "23505") && pe.constraint) {
    const r = await ctx.tx.query<{ attname: string }>(
      `select a.attname from pg_attribute a
        where a.attrelid = to_regclass('erp.' || quote_ident($2))
          and a.attnum = any(coalesce(
            (select c.conkey from pg_constraint c where c.conname = $1 and c.conrelid = to_regclass('erp.' || quote_ident($2))),
            (select i.indkey::int2[] from pg_index i join pg_class x on x.oid = i.indexrelid where x.relname = $1 and i.indrelid = to_regclass('erp.' || quote_ident($2)))))
        order by a.attnum desc`, [pe.constraint, pe.table ?? def.table]);
    return r.rows.map((x) => x.attname).find((c) => campos.has(c) && c !== "organization_id") ?? null;
  }
  if (pe.code === "23514" && pe.constraint?.startsWith(`${def.table}_`) && pe.constraint.endsWith("_check")) {
    const c = pe.constraint.slice(def.table.length + 1, -"_check".length);
    return campos.has(c) ? c : null;
  }
  return null;
}

/**
 * Mensagem de um erro do `createOne`, com a coluna quando dá para saber, e em português como na tela. Chamada
 * DEPOIS do `rollback to savepoint`: a consulta ao catálogo precisa da transação viva.
 */
async function errosDaGravacao(ctx: ServiceCtx, e: unknown, def: ResourceDef, rotulo: (campo: string) => string): Promise<{ coluna: string | null; mensagem: string }[]> {
  if (e instanceof ZodError) return e.issues.map((i) => ({ coluna: i.path[0] ? rotulo(String(i.path[0])) : null, mensagem: translateIssue(i) }));
  const pe = e as { code?: unknown; constraint?: string; table?: string; column?: string } | null;
  if (pe && typeof pe === "object" && typeof pe.code === "string" && /^2[23]/.test(pe.code)) {
    const campo = await campoDoErroPg(ctx, def, { ...pe, code: pe.code });
    const coluna = campo ? rotulo(campo) : null;
    if (pe.code === "23503") return [{ coluna, mensagem: "Valor não encontrado no cadastro de referência." }];
    if (pe.code === "23505") return [{ coluna, mensagem: "Já existe um registro com este valor." }];
    if (pe.code === "23502") return [{ coluna, mensagem: "Obrigatório." }];
    if (pe.code === "23514" && coluna) return [{ coluna, mensagem: "Valor fora do que o cadastro aceita." }];
    if (pe.code.startsWith("22")) return [{ coluna: null, mensagem: "Valor fora do limite aceito pelo banco (número grande demais, texto longo demais ou data inválida)." }];
  }
  const d = e instanceof DomainError ? e : fromPgError(e);
  if (d) {
    const det = Array.isArray(d.details) ? (d.details as { path?: unknown; message?: string }[]) : [];
    if (det.length) return det.map((x) => ({ coluna: Array.isArray(x.path) && x.path[0] ? rotulo(String(x.path[0])) : typeof x.path === "string" && x.path ? rotulo(x.path.split(".")[0]!) : null, mensagem: x.message ?? d.message }));
    return [{ coluna: null, mensagem: d.message }];
  }
  throw e;
}

/**
 * `adiarIdGlobal`: o ID Global é reservado no FIM do lote, não linha a linha. A reserva trava a linha do
 * contador da ORGANIZAÇÃO até o commit; dentro do laço, uma importação longa pararia todo cadastro com ID
 * Global da organização (e esgotaria o pool). A prévia, que desfaz tudo, não reserva nada.
 */
export type Criar = (ctx: ServiceCtx, def: ResourceDef, body: unknown, opcoes: { adiarIdGlobal: boolean; importacao?: boolean; /** prévia: confere regras sem INSERT */ simular?: boolean }) => Promise<Record<string, unknown>>;

/** O que fazer quando o código está fora da máscara do cadastro: a regra diz a máscara, a importação diz o formato. */
const comoCorrigir = (mensagem: string) => {
  const m = /máscara ([0-9.]+)\)/.exec(mensagem);
  return m && !mensagem.includes("Use o formato") ? `${mensagem} Use o formato ${m[1]}.` : mensagem;
};

const MSG_ZEROS_A_ESQUERDA = "A célula é um número com formato de zeros à esquerda: o arquivo guarda só o número, sem os zeros. Formate a coluna como Texto e digite de novo.";

/** O que a tradução de uma célula precisa: as referências carregadas, os municípios (sob demanda) e, só no CRIAR, as falhas. */
interface Traducao {
  def: ResourceDef;
  refs: Map<string, Referencia>;
  municipios: () => Promise<{ ids: Set<number>; porNome: Map<string, number> }>;
  /** CRIAR: o que linhas anteriores com erro teriam criado (o superior numa linha anterior). ATUALIZAR: ausente — nada nasce. */
  falhas?: Map<string, number>;
}

/**
 * Traduz UMA célula PREENCHIDA (`t` não vazio) para o valor do corpo da porta, ou a recusa. É a MESMA tradução no
 * CRIAR e no ATUALIZAR (texto da lista → id, "Sim" → true, "1.234,56" → "1234.56"); quem decide a célula vazia é
 * quem chama.
 */
async function traduzirCelula(x: Traducao, f: FieldDef, cel: Celula | undefined, t: string, corpo: Record<string, unknown>, recusa: (m: string) => void): Promise<void> {
  const v = cel?.v ?? null;
  // MUNICÍPIO (CADASTROS Fase 4): código IBGE de 7 dígitos OU "Nome - UF" (sem diferenciar acento/maiúscula)
  if (f.busca === "municipios") {
    const m = await x.municipios();
    const id = /^\d{7}$/.test(t) ? (m.ids.has(Number(t)) ? Number(t) : null) : m.porNome.get(semAcento(t).replace(/\s*[-/]\s*/g, " - ")) ?? null;
    if (id !== null) corpo[f.name] = id; else recusa(`Município "${t}" não encontrado. Use o código IBGE (7 dígitos) ou "Nome - UF", ex.: "Gurupi - TO".`);
    return;
  }
  switch (f.type) {
    case "ref": {
      const ref = f.ref ? x.refs.get(f.ref.resource) : undefined;
      const superior = f.ref?.resource === x.def.key && x.falhas !== undefined;
      const r = ref ? resolver(ref, t, superior ? { superior, falhas: x.falhas } : {}) : { erro: `"${t}" não encontrado.` };
      if ("id" in r) corpo[f.name] = r.id; else recusa(r.erro);
      break;
    }
    case "select": { const o = f.options?.find((x) => normal(x.label) === normal(t) || normal(x.value) === normal(t)); if (o) corpo[f.name] = o.value; else recusa(`"${t}" não é uma opção válida. Opções: ${(f.options ?? []).map((x) => x.label).join("; ")}.`); break; }
    case "boolean": { const b = normal(t); if (["sim", "s", "true", "1"].includes(b)) corpo[f.name] = true; else if (["não", "nao", "n", "false", "0"].includes(b)) corpo[f.name] = false; else recusa("Use Sim ou Não."); break; }
    case "date": { const d = data(v); if (d) corpo[f.name] = d; else recusa("Data inválida (use DD/MM/AAAA)."); break; }
    case "integer": { const n = numero(v); if (n !== null && /^-?\d+$/.test(n)) corpo[f.name] = Number(n); else recusa("Número inteiro inválido."); break; }
    case "number": case "money": case "quantity": case "percent": { const n = numero(v); if (n !== null) corpo[f.name] = n; else recusa("Número inválido. Use vírgula decimal (1234,56 ou 1.234,56)."); break; }
    case "tags": { const partes = t.split(/[;,]/).map((p) => p.trim()).filter(Boolean); const vals = partes.map((p) => f.options?.find((o) => normal(o.label) === normal(p) || normal(o.value) === normal(p))?.value ?? (f.options ? null : p)); if (vals.some((y) => y === null)) recusa("Valor fora da lista."); else corpo[f.name] = vals; break; }
    default:
      if (typeof valorBase(v) === "number" && formatoDeZeros(cel?.formato ?? "")) recusa(MSG_ZEROS_A_ESQUERDA);
      else corpo[f.name] = t;
  }
}

/** As referências das colunas, UMA carga por cadastro apontado. */
async function carregarReferencias(ctx: ServiceCtx, cols: Cabecalho[]): Promise<Map<string, Referencia>> {
  const refs = new Map<string, Referencia>();
  for (const c of cols) if (c.campo.type === "ref" && c.campo.ref && !refs.has(c.campo.ref.resource)) { const alvo = getResource(c.campo.ref.resource); if (alvo) refs.set(c.campo.ref.resource, await carregarReferencia(ctx, alvo)); }
  return refs;
}

/** Municípios (referência global da Fase 3), carregados UMA vez por importação e só se alguma coluna usa. */
function carregadorDeMunicipios(ctx: ServiceCtx): Traducao["municipios"] {
  let cacheMunicipios: { ids: Set<number>; porNome: Map<string, number> } | null = null;
  return async () => {
    if (cacheMunicipios) return cacheMunicipios;
    const r = await ctx.tx.query<{ id: number; name: string; state_code: string | null }>("select id, name, state_code from erp.cities");
    cacheMunicipios = { ids: new Set(r.rows.map((x) => x.id)), porNome: new Map(r.rows.filter((x) => x.state_code).map((x) => [semAcento(`${x.name} - ${x.state_code}`), x.id])) };
    return cacheMunicipios;
  };
}

export async function importarPlanilha(ctx: ServiceCtx, def: ResourceDef, planilha: PlanilhaLida, criar: Criar, simulacao: boolean, modo: ModoImportacao = "tudo"): Promise<ResultadoImportacao> {
  const { cols } = planilha;
  const erros: ErroImportacao[] = [];
  const refs = await carregarReferencias(ctx, cols);
  const rotulo = (campo: string) => cols.find((c) => c.campo.name === campo)?.chave ?? def.fields.find((f) => f.name === campo)?.label ?? campo;
  const condicionais = cols.flatMap((c) => { const cond = condicao(def, c.campo); return cond ? [{ c, cond }] : []; });

  // dependência entre linhas: o que uma linha COM ERRO teria criado (código, nome, caminho) → número da linha
  const propria = refs.get(def.key);
  const colunaSuperior = cols.find((c) => c.campo.type === "ref" && c.campo.ref?.resource === def.key);
  const falhas = new Map<string, number>();
  const registrarFalha = (n: number, celulas: Map<string, Celula>, corpo: Record<string, unknown>) => {
    if (!propria) return;
    const rot = texto(celulas.get(def.labelField)?.v ?? null); const cod = texto(celulas.get("code")?.v ?? null);
    const paiTexto = colunaSuperior ? texto(celulas.get(colunaSuperior.campo.name)?.v ?? null) : "";
    const paiId = colunaSuperior ? corpo[colunaSuperior.campo.name] : undefined;
    const paiBase = typeof paiId === "string" ? propria.basePorId.get(paiId) : undefined;
    const textos = [cod && rot ? `${cod} - ${rot}` : "", rot, cod, paiTexto && rot ? `${paiTexto} > ${rot}` : "", paiBase && rot ? `${paiBase} > ${rot}` : ""];
    for (const t of textos) if (t && !falhas.has(semAcento(t))) falhas.set(semAcento(t), n);
  };

  const municipios = carregadorDeMunicipios(ctx);
  const criados: { linha: number; id: string }[] = [];
  for (const { n, celulas, erros: errosDaLeitura } of planilha.linhas) {
    const corpo: Record<string, unknown> = {};
    const errosDaLinha: ErroImportacao[] = [...errosDaLeitura];
    for (const c of cols) {
      const f = c.campo; const cel = celulas.get(f.name); const v = cel?.v ?? null;
      const recusa = (m: string) => errosDaLinha.push({ linha: n, coluna: c.chave, mensagem: m });
      const erroCel = erroDaCelula(v);
      if (erroCel) { recusa(erroCel); continue; }
      const t = texto(v);
      if (t === "") { if (f.required) recusa("Obrigatório."); continue; }
      await traduzirCelula({ def, refs, municipios, falhas }, f, cel, t, corpo, recusa);
    }
    for (const { c, cond } of condicionais) {
      const atual = cond.campo in corpo ? corpo[cond.campo] : cond.padrao;
      const vazio = corpo[c.campo.name] === undefined || corpo[c.campo.name] === null;
      if (atual === cond.igual && vazio && !errosDaLinha.some((e) => e.coluna === c.chave)) errosDaLinha.push({ linha: n, coluna: c.chave, mensagem: `Obrigatório quando ${cond.texto}.` });
    }
    if (errosDaLinha.length) { erros.push(...errosDaLinha); registrarFalha(n, celulas, corpo); continue; }
    // PRÉVIA (simulação): só confere regras — sem savepoint, sem INSERT. A gravação real é que materializa.
    // Antes a prévia inseria e desfazia cada linha e estourava o tempo (~segundos por dezena de produtos).
    if (simulacao) {
      try {
        const criado = await criar(ctx, def, corpo, { adiarIdGlobal: true, importacao: true, simular: true });
        criados.push({ linha: n, id: String(criado["id"]) });
        if (propria) adicionarCriado(propria, def, criado);
      } catch (e) {
        for (const x of await errosDaGravacao(ctx, e, def, rotulo)) erros.push({ linha: n, ...x, mensagem: comoCorrigir(x.mensagem) });
        registrarFalha(n, celulas, corpo);
      }
      continue;
    }
    await ctx.tx.query("savepoint importacao_linha");
    try {
      const criado = await criar(ctx, def, corpo, { adiarIdGlobal: true, importacao: true });
      await ctx.tx.query("release savepoint importacao_linha");
      criados.push({ linha: n, id: String(criado["id"]) });
      if (propria) adicionarCriado(propria, def, criado);
    } catch (e) {
      // rollback E release: sem o release, cada linha com erro deixaria uma subtransação aninhada viva. No modo
      // parcial é ESTE rollback que tira a linha errada do lote que será gravado.
      await ctx.tx.query("rollback to savepoint importacao_linha");
      await ctx.tx.query("release savepoint importacao_linha");
      for (const x of await errosDaGravacao(ctx, e, def, rotulo)) erros.push({ linha: n, ...x, mensagem: comoCorrigir(x.mensagem) });
      registrarFalha(n, celulas, corpo);
    }
  }
  // ID Global no fim, na mesma transação e na ordem do arquivo; só para o que vai ser gravado (no parcial,
  // só as linhas certas: as erradas já tiveram o savepoint desfeito e não estão em `criados`)
  const vaiGravar = !simulacao && criados.length > 0 && (modo === "parcial" || !erros.length);
  let idGlobalFalhou = false;
  if (vaiGravar) {
    for (const { linha, id } of criados) {
      await ctx.tx.query("savepoint importacao_id_global");
      try { await atribuirIdGlobalSeAplicavel(ctx, def.table, id); await ctx.tx.query("release savepoint importacao_id_global"); }
      catch (e) {
        await ctx.tx.query("rollback to savepoint importacao_id_global");
        await ctx.tx.query("release savepoint importacao_id_global");
        // a linha JÁ foi criada nesta transação: sem o número ela não pode ser gravada, e o lote inteiro é desfeito
        idGlobalFalhou = true;
        for (const x of await errosDaGravacao(ctx, e, def, rotulo)) erros.push({ linha, ...x });
      }
    }
  }
  const linhasComErro = new Set(erros.map((e) => e.linha));
  const certas = criados.filter((c) => !linhasComErro.has(c.linha)).length;
  const gravadas = vaiGravar && !idGlobalFalhou && (modo === "parcial" || !erros.length) ? certas : 0;
  // planilha de erros na MESMA execução, do arquivo já lido em memória: nunca relido depois do commit
  const planilha_erros_base64 = linhasComErro.size ? await gerarPlanilhaErros(planilha, erros) : null;
  return { linhas: planilha.linhas.length, gravadas, erros, simulacao, modo, certas, com_erro: linhasComErro.size, planilha_erros_base64 };
}

/** Anexa `linhas_arquivo` (total antes do recorte) quando o pedido veio em lote. */
export function comTotalDoArquivo<T extends ResultadoImportacao>(r: T, linhasArquivo: number, recortou: boolean): T {
  return recortou ? { ...r, linhas_arquivo: linhasArquivo } : r;
}

// ------------------------------------------------------------------ ATUALIZAR (IMPORTAR-01, decisão 317)

/**
 * A PORTA DE EDIÇÃO DA TELA, injetada pela rota (como o `createOne` do CRIAR): `ler` = `getOne` (a MESMA 404 de
 * inexistente, de outra organização, excluído ou fora do escopo) e `atualizar` = `updateOne` (schema PARCIAL do
 * registry, regras do cadastro, UPDATE só do que veio, auditoria pelo gatilho). Nenhum UPDATE em tabela de cadastro
 * sai deste arquivo.
 */
export interface PortaDeEdicao {
  ler: (ctx: ServiceCtx, def: ResourceDef, id: string) => Promise<Record<string, unknown>>;
  atualizar: (ctx: ServiceCtx, def: ResourceDef, id: string, body: unknown) => Promise<Record<string, unknown>>;
}

/**
 * CASAMENTO PELO CÓDIGO: só nesta organização (o predicado explícito, além da RLS), só registro VIVO, UMA consulta para
 * o arquivo inteiro (nada de N+1). Devolve código → ids: mais de um id é recusado por quem resolve, nunca "o primeiro".
 * Tabela e coluna vêm do registry estático (`ident`), o valor é parametrizado.
 */
export async function casarPorCodigo(ctx: Pick<ServiceCtx, "tx" | "orgId">, def: ResourceDef, codigos: string[]): Promise<Map<string, string[]>> {
  const mapa = new Map<string, string[]>();
  if (!codigos.length) return mapa;
  const r = await ctx.tx.query<{ id: string; codigo: string }>(
    `select id::text as id, code::text as codigo from erp.${ident(def.table)} where organization_id = $1 and code = any($2::text[])${def.softDelete ? " and deleted_at is null" : ""}`,
    [ctx.orgId, codigos]);
  for (const x of r.rows) acrescentar(mapa, x.codigo, x.id);
  return mapa;
}

/** O código resolve para UM registro, ou a linha é recusada: inexistente nunca vira criação, repetido nunca vira "o primeiro". */
export function resolverCodigo(alvos: Map<string, string[]>, codigo: string, def: Pick<ResourceDef, "labelPlural">): { id: string } | { erro: string } {
  const ids = alvos.get(codigo) ?? [];
  if (ids.length === 1) return { id: ids[0]! };
  if (ids.length > 1) return { erro: `"${codigo}" corresponde a ${ids.length} registros de ${def.labelPlural}: nada é atualizado sem saber qual.` };
  return { erro: codigoNaoEncontrado(codigo, def) };
}
const codigoNaoEncontrado = (codigo: string, def: Pick<ResourceDef, "labelPlural">) => `"${codigo}" não encontrado em ${def.labelPlural}. Atualizar não cria registro: para criar, use "Criar registros".`;

/** O código lido de uma célula, com as mesmas recusas da tradução (erro de fórmula, número que perdeu os zeros). */
function codigoDaCelula(cel: Celula | undefined): { codigo: string } | { erro: string } {
  const v = cel?.v ?? null;
  const erroCel = erroDaCelula(v);
  if (erroCel) return { erro: erroCel };
  if (typeof valorBase(v) === "number" && formatoDeZeros(cel?.formato ?? "")) return { erro: MSG_ZEROS_A_ESQUERDA };
  const t = texto(v);
  return t ? { codigo: t } : { erro: "Obrigatório: o código identifica o registro a atualizar." };
}

/**
 * Colunas do modelo cujo valor GRAVADO mudou (a leitura da tela antes × depois da porta) — inclusive as que a planilha
 * não trouxe, se a porta as mudou por regra do cadastro, e a própria chave, se a porta a mudasse: a prévia mostra o
 * efeito, não o pedido.
 */
export function colunasQueMudaram(cols: Cabecalho[], antes: Record<string, unknown>, depois: Record<string, unknown>): string[] {
  return cols.filter((c) => JSON.stringify(antes[c.campo.name] ?? null) !== JSON.stringify(depois[c.campo.name] ?? null)).map((c) => c.chave);
}

/**
 * A VERSÃO FÍSICA da linha (`xmin`): todo UPDATE cria versão nova, mesmo com valores iguais. É como o ATUALIZAR confere
 * o ROW COUNT da porta, que não o confere (`updateOne` descarta o rowCount): versão igual depois da porta = o UPDATE
 * não alcançou a linha (a RLS devolve zero linhas sem erro) = a linha é recusada, nunca "atualizada" sem efeito.
 */
async function versaoDaLinha(ctx: ServiceCtx, def: ResourceDef, id: string): Promise<string | null> {
  const r = await ctx.tx.query<{ v: string }>(`select xmin::text as v from erp.${ident(def.table)} where id = $1 and organization_id = $2`, [id, ctx.orgId]);
  return r.rows[0]?.v ?? null;
}
export const MSG_NAO_GRAVOU = "A gravação não alcançou o registro (fora do escopo de escrita): nada foi alterado nesta linha.";

/**
 * ATUALIZAR em lote: cada linha casa pelo CÓDIGO e passa pela porta de edição da tela com SÓ as colunas presentes.
 * Uma transação para o arquivo (a da rota), um savepoint por linha — como no CRIAR. Linha em que nada muda tem o
 * savepoint desfeito: não grava nem gera auditoria. Prévia, modo `tudo` e `parcial` decidem na rota, como no CRIAR.
 */
export async function atualizarPlanilha(ctx: ServiceCtx, def: ResourceDef, planilha: PlanilhaLida, porta: PortaDeEdicao, simulacao: boolean, modo: ModoImportacao = "tudo"): Promise<ResultadoAtualizacao> {
  const { cols, presentes } = planilha;
  const chave = cols[0]!; // `cabecalhosDaAcao`: no ATUALIZAR, a primeira coluna é o código
  const editaveis = cols.filter((c) => c !== chave && presentes.has(c.campo.name));
  const erros: ErroImportacao[] = [];
  const refs = await carregarReferencias(ctx, editaveis);
  const traducao: Traducao = { def, refs, municipios: carregadorDeMunicipios(ctx) };
  const rotulo = (campo: string) => cols.find((c) => c.campo.name === campo)?.chave ?? def.fields.find((f) => f.name === campo)?.label ?? campo;
  const condicionais = cols.flatMap((c) => { const cond = condicao(def, c.campo); return cond ? [{ c, cond }] : []; });

  // o código de cada linha; o repetido no arquivo é erro em TODAS as linhas que o repetem (qual valeria?)
  const codigos = new Map<number, { codigo: string } | { erro: string }>();
  const linhasDoCodigo = new Map<string, number[]>();
  for (const { n, celulas } of planilha.linhas) {
    const c = codigoDaCelula(celulas.get(chave.campo.name));
    codigos.set(n, c);
    if ("codigo" in c) linhasDoCodigo.set(c.codigo, [...(linhasDoCodigo.get(c.codigo) ?? []), n]);
  }
  const alvos = await casarPorCodigo(ctx, def, [...linhasDoCodigo.keys()]);

  let casaram = 0; let semAlteracao = 0;
  const alteracoes: AlteracaoImportacao[] = [];
  for (const { n, celulas, erros: errosDaLeitura } of planilha.linhas) {
    const errosDaLinha: ErroImportacao[] = [...errosDaLeitura];
    const recusaCodigo = (m: string) => errosDaLinha.push({ linha: n, coluna: chave.chave, mensagem: m });
    const lido = codigos.get(n)!;
    const codigo = "codigo" in lido ? lido.codigo : "";
    let id: string | null = null; let antes: Record<string, unknown> | null = null;
    if ("erro" in lido) recusaCodigo(lido.erro);
    else {
      const r = resolverCodigo(alvos, codigo, def);
      if ("erro" in r) recusaCodigo(r.erro);
      else {
        // a leitura da tela: o que a 404 dela esconde (escopo, filtro fixo) também não casa
        try { antes = await porta.ler(ctx, def, r.id); id = r.id; casaram += 1; }
        catch (e) { if (e instanceof DomainError && e.code === "NOT_FOUND") recusaCodigo(codigoNaoEncontrado(codigo, def)); else throw e; }
      }
      const repetidas = linhasDoCodigo.get(codigo) ?? [];
      if (repetidas.length > 1) recusaCodigo(`Código repetido no arquivo (linhas ${repetidas.join(", ")}): cada registro aparece uma vez.`);
    }
    const corpo: Record<string, unknown> = {};
    for (const c of editaveis) {
      const f = c.campo; const cel = celulas.get(f.name); const v = cel?.v ?? null;
      const recusa = (m: string) => errosDaLinha.push({ linha: n, coluna: c.chave, mensagem: m });
      const erroCel = erroDaCelula(v);
      if (erroCel) { recusa(erroCel); continue; }
      const t = texto(v);
      // coluna PRESENTE e célula vazia: recusa (atualizar não apaga e não ignora); coluna ausente nem entra aqui
      if (t === "") { recusa(MSG_PRESENTE_VAZIA); continue; }
      await traduzirCelula(traducao, f, cel, t, corpo, recusa);
    }
    // obrigatório condicional sobre o registro como FICARIA (a planilha por cima do gravado), só quando a linha mexe
    // na condição ou no campo; o banco continua sendo a última palavra (ex.: chk_product_fin_cat)
    if (antes) for (const { c, cond } of condicionais) {
      if (!(cond.campo in corpo) && !(c.campo.name in corpo)) continue;
      const atual = cond.campo in corpo ? corpo[cond.campo] : antes[cond.campo];
      const valor = c.campo.name in corpo ? corpo[c.campo.name] : antes[c.campo.name];
      if (atual === cond.igual && (valor === undefined || valor === null || valor === "") && !errosDaLinha.some((e) => e.coluna === c.chave)) errosDaLinha.push({ linha: n, coluna: c.chave, mensagem: `Obrigatório quando ${cond.texto}.` });
    }
    if (errosDaLinha.length || !id || !antes) { erros.push(...errosDaLinha); continue; }
    await ctx.tx.query("savepoint importacao_linha");
    try {
      const versao = await versaoDaLinha(ctx, def, id);
      const depois = await porta.atualizar(ctx, def, id, corpo);
      if ((await versaoDaLinha(ctx, def, id)) === versao) throw validation(MSG_NAO_GRAVOU);
      const colunas = colunasQueMudaram(cols, antes, depois);
      if (colunas.length) {
        await ctx.tx.query("release savepoint importacao_linha");
        alteracoes.push({ linha: n, codigo, colunas });
      } else {
        // nada muda: a gravação (e a linha de auditoria dela) é desfeita
        await ctx.tx.query("rollback to savepoint importacao_linha");
        await ctx.tx.query("release savepoint importacao_linha");
        semAlteracao += 1;
      }
    } catch (e) {
      await ctx.tx.query("rollback to savepoint importacao_linha");
      await ctx.tx.query("release savepoint importacao_linha");
      for (const x of await errosDaGravacao(ctx, e, def, rotulo)) erros.push({ linha: n, ...x, mensagem: comoCorrigir(x.mensagem) });
    }
  }
  const linhasComErro = new Set(erros.map((e) => e.linha));
  const certas = alteracoes.length + semAlteracao;
  const vaiGravar = !simulacao && (modo === "parcial" ? certas > 0 : !erros.length);
  // a planilha de erros do ATUALIZAR traz SÓ as colunas presentes: devolvida e corrigida, ela não pode ganhar
  // colunas vazias (que recusariam a linha) nem colunas que a pessoa tirou
  const planilha_erros_base64 = linhasComErro.size ? await gerarPlanilhaErros(planilha, erros, true) : null;
  return {
    linhas: planilha.linhas.length, gravadas: vaiGravar ? alteracoes.length : 0, erros, simulacao, modo, certas, com_erro: linhasComErro.size, planilha_erros_base64,
    acao: "atualizar", casaram, nao_casaram: planilha.linhas.length - casaram, sem_alteracao: semAlteracao, alteracoes,
  };
}

/** Limite da planilha de erros: o mesmo do arquivo enviado (8 MB). Acima disso ela não volta (null), e a lista na tela continua valendo. */
export const PLANILHA_ERROS_MAXIMO = 8 * 1024 * 1024;

/**
 * Planilha com SÓ as linhas com erro: as colunas do modelo (mesmos títulos, mesma ordem, colunas de texto no
 * formato Texto para preservar zeros à esquerda), os valores como o usuário mandou e a coluna "Erros" no fim.
 * Corrigida, ela volta pela mesma importação: a coluna "Erros" é ignorada na leitura.
 */
export async function gerarPlanilhaErros(planilha: PlanilhaLida, erros: ErroImportacao[], soPresentes = false): Promise<string | null> {
  const porLinha = new Map<number, ErroImportacao[]>();
  for (const e of erros) porLinha.set(e.linha, [...(porLinha.get(e.linha) ?? []), e]);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(ABA_DADOS, { views: [{ state: "frozen", ySplit: 1 }] });
  // `soPresentes` (ATUALIZAR): só as colunas que vieram no arquivo, na ordem do modelo
  const cols = soPresentes ? planilha.cols.filter((c) => planilha.presentes.has(c.campo.name)) : planilha.cols;
  ws.columns = [...cols.map((c) => ({ header: c.titulo, width: Math.max(14, Math.min(40, c.titulo.length + 4)) })), { header: COLUNA_ERROS, width: 80 }];
  cols.forEach((c, i) => { if (TIPOS_TEXTO.includes(c.campo.type)) ws.getColumn(i + 1).numFmt = "@"; });
  ws.getRow(1).font = { bold: true };
  let k = 2;
  for (const { n, celulas } of planilha.linhas) {
    const lista = porLinha.get(n);
    if (!lista) continue;
    const row = ws.getRow(k++);
    cols.forEach((c, i) => {
      const cel = celulas.get(c.campo.name);
      if (!cel) return;
      const destino = row.getCell(i + 1);
      // fórmula volta pelo valor calculado (quem corrige edita o valor); o resto, como veio
      destino.value = ehFormula(cel.v) ? valorBase(cel.v) : cel.v;
      if (cel.formato) destino.numFmt = cel.formato;
    });
    row.getCell(cols.length + 1).value = lista.map((e) => (e.coluna ? `${e.coluna}: ${e.mensagem}` : e.mensagem)).join("\n");
    row.getCell(cols.length + 1).alignment = { wrapText: true, vertical: "top" };
    row.commit();
  }
  const buf = Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
  return buf.byteLength > PLANILHA_ERROS_MAXIMO ? null : buf.toString("base64");
}
