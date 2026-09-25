/**
 * Regras do PARCEIRO (erp.people) — CADASTROS Fase 4, decisão 253. Chamadas pelo `createOne`/`updateOne`
 * genérico ANTES de qualquer gravação, dentro da mesma transação.
 *
 *  · pelo menos UM tipo (Cliente, Fornecedor, Transportadora, Funcionário, Proprietário) — 422;
 *  · CPF/CNPJ válido quando informado (regra ÚNICA de `@agro/domain/documento`, inclusive CNPJ alfanumérico),
 *    gravado NORMALIZADO; estrangeiro: livre (só aparado);
 *  · TIPO DE PESSOA × DOCUMENTO (R1-6): Física usa CPF, Jurídica usa CNPJ (inclusive alfanumérico), Estrangeira
 *    livre — conferido quando o corpo manda o documento OU o tipo, contra o valor que a linha TERÁ;
 *  · a recusa aponta a aba da ficha de QUEM CHAMA (`def`): em Parceiros o documento está em Identificação; na ficha
 *    de RH (`funcionarios`), em Pessoal — e ela não tem o tipo de pessoa, então a mensagem diz onde ele se acerta;
 *  · único entre VIVOS da organização (o índice ux_people_documento_normalizado é a autoridade; aqui o 409
 *    sai antes, com o código e o nome do existente, e com o MESMO filtro do índice: normalizado não vazio);
 *  · situação na Receita: copiada do cache da consulta de CNPJ da própria API (nunca do cliente);
 *  · CAMPOS POR TIPO DE PESSOA (AJUSTES 01, C-6, decisão 257): Matriz só em Jurídica; RG, CAEPF e Sexo só em
 *    Física — 422 no campo, conferidos contra o tipo que a linha TERÁ quando o corpo mexe no tipo ou no campo;
 *    latitude e longitude juntas (ou nenhuma), no principal e em cada endereço adicional (a 0030 tem o CHECK do par
 *    como rede). O e-mail NF-e é `email` no registry (o schema recusa o inválido);
 *  · MATRIZ (AJUSTES 01 R1, A-1), só quando ela MUDA: viva, ativa, Jurídica, desta organização, não ele mesmo e não
 *    filial; parceiro com filiais não vira filial (`conferirMatriz`).
 */
import { getResource, recusaDoTipoDePessoa, validarDocumento, type ResourceDef } from "@agro/domain";
import { DomainError } from "@agro/shared";
import { notFound, validation } from "./errors.js";
import type { ServiceCtx } from "./context.js";
import { abaDe, detalheDoErro } from "./ficha-em-abas.js";

export const TIPOS_DE_PARCEIRO = ["is_client", "is_provider", "is_transporter", "is_employee", "is_proprietary"] as const;
export const MSG_SEM_TIPO = "Marque pelo menos um tipo: Cliente, Fornecedor, Transportadora, Funcionário ou Proprietário.";

type Linha = Record<string, unknown>;
const valor = (data: Linha, atual: Linha | null, campo: string) => (campo in data ? data[campo] : atual?.[campo]);

/** O campo `person_type` do cadastro de parceiros (registry): padrão e rótulos das opções. */
function campoTipoDePessoa() {
  const f = getResource("people")?.fields.find((x) => x.name === "person_type");
  if (!f || typeof f.default !== "string") throw new DomainError("INTERNAL_ERROR", "cadastro de parceiros sem o tipo de pessoa padrão");
  return { padrao: f.default, opcoes: f.options ?? [] };
}
const rotuloDoTipo = (tipo: string) => campoTipoDePessoa().opcoes.find((o) => o.value === tipo)?.label ?? tipo;

/**
 * O tipo de pessoa que a linha TERÁ depois da gravação: o do corpo; na edição, o GRAVADO (lido do banco quando
 * quem chama não o traz em `atual` — ex.: a ficha de `funcionarios`, cuja definição não tem o campo); na criação
 * sem o campo, o PADRÃO do registry, que é o mesmo `default 'legal'` da coluna (0002). `padrao` diz se veio dele.
 */
async function tipoResultante(ctx: ServiceCtx, id: string | null, data: Linha, atual: Linha | null): Promise<{ tipo: string; padrao: boolean }> {
  const doCorpo = data["person_type"];
  if (typeof doCorpo === "string") return { tipo: doCorpo, padrao: false };
  if (atual && typeof atual["person_type"] === "string") return { tipo: atual["person_type"], padrao: false };
  if (id) {
    const r = await ctx.tx.query<{ person_type: string }>("select person_type from erp.people where id = $1 and organization_id = $2", [id, ctx.orgId]);
    const t = r.rows[0]?.person_type;
    if (!t) throw notFound("Parceiro");
    return { tipo: t, padrao: false };
  }
  return { tipo: campoTipoDePessoa().padrao, padrao: true };
}

export async function conferirParceiro(ctx: ServiceCtx, def: ResourceDef, id: string | null, data: Linha, atual: Linha | null) {
  // Na edição a regra vale quando a gravação mexe nos tipos (a web manda todos); um PUT que só troca o
  // telefone de um parceiro antigo sem tipo não fica refém de uma regra que ele não tocou.
  const mexeNosTipos = atual === null || TIPOS_DE_PARCEIRO.some((t) => t in data);
  if (mexeNosTipos && !TIPOS_DE_PARCEIRO.some((t) => valor(data, atual, t) === true)) throw validation(MSG_SEM_TIPO, [{ path: "is_client", message: MSG_SEM_TIPO, aba: "identificacao" }]);

  await conferirCamposDoTipoDePessoa(ctx, def, id, data, atual);
  conferirCoordenadas(def, data, atual);

  // Documento e tipo só são conferidos quando o corpo manda um dos dois: um PUT que não mexe em nenhum não é
  // recusado por dado antigo (o parceiro gravado antes da regra só é cobrado quando alguém mexer no tipo ou no
  // documento — a web manda os dois em toda gravação da ficha, então a próxima edição pela tela cobra).
  if (!("document" in data) && !("person_type" in data)) return;
  const bruto = valor(data, atual, "document");
  if (bruto === null || bruto === undefined || String(bruto).trim() === "") { if ("document" in data) data["document"] = null; return; }
  const { tipo, padrao } = await tipoResultante(ctx, id, data, atual);
  // aba do erro = a aba em que o campo aparece NA FICHA DE QUEM CHAMA (nunca uma aba que ela não tem)
  const abaDoDocumento = abaDe(def, { campo: "document" });
  let doc: string;
  if (tipo === "foreign") doc = String(bruto).trim();
  else {
    // tipo × documento ANTES do dígito: "Pessoa jurídica usa CNPJ" diz o que fazer; "CPF inválido" não
    const recusa = recusaDoTipoDePessoa(tipo, String(bruto));
    if (recusa) {
      // o campo certo: o documento, quando veio; senão o tipo (só o tipo mudou contra o documento gravado)
      const campo = "document" in data ? "document" : "person_type";
      // ficha SEM o campo do tipo (RH): o tipo gravado não se acerta nela — a mensagem diz qual é e onde se acerta
      const semOTipo = !def.fields.some((f) => f.name === "person_type");
      const msg = padrao ? `${recusa} (tipo de pessoa não informado vale ${rotuloDoTipo(tipo)})`
        : semOTipo ? `${recusa} — o parceiro está como ${rotuloDoTipo(tipo)}; acerte o tipo de pessoa no cadastro de parceiros` : recusa;
      throw validation(`${campo === "document" ? "CPF/CNPJ" : "Tipo de pessoa"}: ${msg}`, [{ path: campo, message: msg, aba: abaDe(def, { campo }) }]);
    }
    const r = validarDocumento(String(bruto));
    if (!r.valido) throw validation(`CPF/CNPJ: ${r.motivo}`, [{ path: "document", message: r.motivo, aba: abaDoDocumento }]);
    doc = r.normalizado;
  }
  data["document"] = doc;

  // mesmo filtro do índice (0027): documento que fica vazio depois de normalizar não conta como duplicado
  const dup = await ctx.tx.query<{ id: string; code: string; name: string }>(
    `select id::text, code, name from erp.people
      where organization_id = $1 and deleted_at is null and document is not null
        and upper(regexp_replace(document, '[^0-9A-Za-z]', '', 'g')) <> ''
        and upper(regexp_replace(document, '[^0-9A-Za-z]', '', 'g')) = upper(regexp_replace($2, '[^0-9A-Za-z]', '', 'g'))
        and ($3::uuid is null or id <> $3::uuid) limit 1`, [ctx.orgId, doc, id]);
  const x = dup.rows[0];
  if (x) throw new DomainError("CONFLICT", `CPF/CNPJ já cadastrado no parceiro ${x.code} - ${x.name}`, [{ path: "document", message: `Já cadastrado: ${x.code} - ${x.name}`, aba: abaDoDocumento, existente: { id: x.id, code: x.code, name: x.name } }]);

}

/** Campos que só existem num tipo de pessoa (C-6). Chaves estáticas; nenhuma vem do cliente. */
export const CAMPOS_SO_DE_FISICA = ["rg", "caepf", "sexo"] as const;
export const CAMPOS_SO_DE_JURIDICA = ["matriz_id"] as const;
const preenchido = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";

/**
 * Matriz só em Jurídica; RG, CAEPF e Sexo só em Física. Conferido quando o corpo traz o tipo ou um desses campos,
 * contra o valor que a linha TERÁ (corpo sobre o gravado): quem troca o tipo precisa limpar o campo do outro tipo no
 * mesmo corpo — a web manda `null` no campo que o tipo esconde. PUT que não toca em nenhum (web anterior) não é
 * cobrado por dado antigo. A matriz em si (viva, ativa, Jurídica, não filial…) só quando MUDA: `conferirMatriz`.
 */
async function conferirCamposDoTipoDePessoa(ctx: ServiceCtx, def: ResourceDef, id: string | null, data: Linha, atual: Linha | null) {
  const campos = [...CAMPOS_SO_DE_FISICA, ...CAMPOS_SO_DE_JURIDICA].filter((c) => def.fields.some((f) => f.name === c));
  if (!campos.length || !("person_type" in data || campos.some((c) => c in data))) return;
  const presentes = campos.filter((c) => preenchido(valor(data, atual, c)));
  if (!presentes.length) return;
  const { tipo } = await tipoResultante(ctx, id, data, atual);
  const erro = (campo: string, msg: string) => validation(`${def.fields.find((f) => f.name === campo)?.label ?? campo}: ${msg}`, [{ path: campo, message: msg, aba: abaDe(def, { campo }) }]);
  for (const c of presentes) {
    if ((CAMPOS_SO_DE_FISICA as readonly string[]).includes(c) && tipo !== "natural") throw erro(c, `Só para pessoa Física (o parceiro está como ${rotuloDoTipo(tipo)}).`);
    if ((CAMPOS_SO_DE_JURIDICA as readonly string[]).includes(c) && tipo !== "legal") throw erro(c, `Só para pessoa Jurídica (o parceiro está como ${rotuloDoTipo(tipo)}).`);
  }
  if (!("matriz_id" in data) || !preenchido(data["matriz_id"])) return;
  // UUID é o mesmo em qualquer caixa (o schema aceita maiúsculas): compara-se — e grava-se — a forma canônica
  const matriz = String(data["matriz_id"]).toLowerCase();
  data["matriz_id"] = matriz;
  // Só quando a matriz MUDA (AJUSTES 01 R1, A-1): a filial cuja matriz foi excluída, inativada ou mudou de tipo DEPOIS
  // continua editável — o PUT que reenvia a mesma matriz não é cobrado pelo que aconteceu com a outra ficha.
  if (atual && typeof atual["matriz_id"] === "string" && atual["matriz_id"].toLowerCase() === matriz) return;
  await conferirMatriz(ctx, id === null ? null : id.toLowerCase(), matriz, (msg) => erro("matriz_id", msg));
}

/**
 * MATRIZ (AJUSTES 01 R1, A-1): parceiro VIVO, ATIVO, JURÍDICA, desta organização, que não é ele mesmo e que NÃO é
 * filial (`matriz_id` nulo); e o parceiro que TEM filiais não vira filial. Um nível só: matriz → filiais — sem
 * cadeia e sem ciclo (A→B e B→A).
 *
 * CONCORRÊNCIA: primeiro o PRÓPRIO registro `for update`, depois a matriz `for share`. "C vira filial de A" (lê A
 * `for share`) e "A vira filial de B" (trava A `for update`) se esperam: quem chega depois relê e vê A já filial, ou
 * a filial C já gravada. Duas gravações cruzadas (A→B e B→A ao mesmo tempo) travam em ordem inversa e o banco derruba
 * uma delas (40P01 → 409); a outra grava, e a repetição da derrubada recebe a recusa legível.
 */
async function conferirMatriz(ctx: ServiceCtx, proprio: string | null, matriz: string, erro: (msg: string) => Error) {
  if (proprio !== null && matriz === proprio) throw erro("O parceiro não pode ser a matriz dele mesmo.");
  if (proprio !== null) await ctx.tx.query("select 1 from erp.people where id = $1 and organization_id = $2 for update", [proprio, ctx.orgId]);
  // viva e desta organização (a FK composta prova o tenant; a vida e o escopo, esta consulta sob RLS). Inexistente, de
  // outra organização e excluída recebem a MESMA recusa (não revela existência).
  const r = await ctx.tx.query<{ person_type: string; is_active: boolean; e_filial: boolean }>(
    "select person_type, is_active, matriz_id is not null as e_filial from erp.people where id = $1 and organization_id = $2 and deleted_at is null for share",
    [matriz, ctx.orgId]);
  const m = r.rows[0];
  if (!m) throw erro("Matriz não encontrada entre os parceiros ativos.");
  if (!m.is_active) throw erro("A matriz escolhida está inativa.");
  if (m.person_type !== "legal") throw erro(`A matriz precisa ser pessoa Jurídica (a escolhida está como ${rotuloDoTipo(m.person_type)}).`);
  if (m.e_filial) throw erro("A matriz escolhida é filial de outro parceiro: escolha a matriz dela.");
  if (proprio !== null) {
    const f = await ctx.tx.query("select 1 from erp.people where organization_id = $1 and matriz_id = $2 and deleted_at is null limit 1", [ctx.orgId, proprio]);
    if (f.rowCount) throw erro("Este parceiro é matriz de outros parceiros e não pode ser filial.");
  }
}

/** Latitude e longitude andam juntas, no principal e em cada endereço adicional; faixas −90..90 e −180..180. */
function conferirCoordenadas(def: ResourceDef, data: Linha, atual: Linha | null) {
  const faixa = { latitude: 90, longitude: 180 } as const;
  const conferir = (lat: unknown, lon: unknown, caminho: (c: string) => (string | number)[]) => {
    for (const [c, v] of [["latitude", lat], ["longitude", lon]] as const) {
      if (preenchido(v) && !(Math.abs(Number(v)) <= faixa[c])) throw new DomainError("VALIDATION_ERROR", `${c === "latitude" ? "Latitude" : "Longitude"} fora da faixa (−${faixa[c]} a ${faixa[c]})`, [detalheDoErro(def, caminho(c), `Fora da faixa (−${faixa[c]} a ${faixa[c]}).`)]);
    }
    if (preenchido(lat) !== preenchido(lon)) {
      const falta = preenchido(lat) ? "longitude" : "latitude";
      throw new DomainError("VALIDATION_ERROR", "Informe latitude e longitude juntas (ou nenhuma).", [detalheDoErro(def, caminho(falta), "Informe latitude e longitude juntas (ou nenhuma).")]);
    }
  };
  if (def.fields.some((f) => f.name === "latitude") && ("latitude" in data || "longitude" in data)) conferir(valor(data, atual, "latitude"), valor(data, atual, "longitude"), (c) => [c]);
  const linhas = data["enderecos"];
  if (Array.isArray(linhas)) linhas.forEach((l: Linha, i) => conferir(l["latitude"], l["longitude"], (c) => ["enderecos", i, c]));
}

/**
 * Situação na Receita do parceiro gravado: a última consulta de CNPJ que a PRÓPRIA API fez (cache global da
 * Fase 3). Os campos são somente leitura no contrato — o cliente nunca os envia. Sem consulta: fica como está.
 */
export async function atualizarSituacaoReceita(ctx: ServiceCtx, id: string) {
  await ctx.tx.query(
    `update erp.people p set situacao_receita = upper(c.dados->'situacao'->>'descricao'), situacao_receita_consultada_em = c.consultado_em
       from erp.consulta_cnpj_cache c
      where p.id = $1 and p.organization_id = $2 and p.person_type <> 'foreign' and length(p.document) = 14 and c.cnpj = p.document
        and c.dados->'situacao'->>'descricao' is not null
        and p.situacao_receita_consultada_em is distinct from c.consultado_em`, [id, ctx.orgId]);
}
