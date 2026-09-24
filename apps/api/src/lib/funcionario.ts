/**
 * Regras do FUNCIONÁRIO (CADASTROS Fase 5). O funcionário é o PARCEIRO (erp.people) do tipo Funcionário com a
 * ficha de RH em erp.employee_profiles (1:1). A ficha usa o mecanismo genérico de abas (decisão 253); aqui
 * ficam só as regras próprias, chamadas ANTES de qualquer gravação e dentro da mesma transação:
 *
 *  · `conferirFuncionario` — CPF (regra ÚNICA do parceiro), matrícula repetida (409 com o funcionário que a
 *    usa; o trigger da 0028 é a autoridade), empresa de lotação no escopo de lançamento, usuário do sistema
 *    membro DESTA organização, conta de pagamento = conta adicional viva do PRÓPRIO parceiro;
 *  · `funcionarioPorCpf` — o NOVO funcionário começa pelo CPF: CPF de parceiro vivo existente → marca o tipo
 *    Funcionário nele (não duplica), o que é EDITAR o parceiro e exige também `people.edit` (R1-3); CPF novo →
 *    cria o parceiro (pessoa física, SÓ o tipo Funcionário) e a ficha de RH na MESMA transação. Ficha de RH que JÁ
 *    existe nunca é regravada; a INATIVA recusa (a porta não devolve ninguém à folha — R1-3 × R1-2 item 5).
 */
import { getResource, validarDocumento } from "@agro/domain";
import { DomainError } from "@agro/shared";
import { validation } from "./errors.js";
import { exigirEmpresaDeLancamento, hasPermission, type ServiceCtx } from "./context.js";
import { conferirParceiro } from "./parceiro.js";

/**
 * R1-3 (decisão 255): marcar o tipo Funcionário num parceiro que JÁ existe é editar o parceiro — a capacidade da
 * rota (`employees.create`) não basta. A mensagem revela que o CPF está cadastrado; aceito e declarado: quem chama
 * já tem o CPF em mãos, e o 403 não devolve id, código, nome nem tipos do parceiro.
 */
export const PERMISSAO_MARCAR_FUNCIONARIO = "people.edit";
export const MSG_CPF_JA_E_PARCEIRO = "CPF já cadastrado como parceiro: quem edita parceiros precisa marcar o tipo Funcionário";
export const MSG_PARCEIRO_INATIVO = "parceiro inativo: reative no cadastro de parceiros";
/**
 * Ficha de RH INATIVA (fora da folha: apuração, relatório de ativos, aniversariantes). A porta de novo funcionário
 * tem só `employees.create` e corpo `{document, name}`: reativar a ficha por ela devolveria o funcionário à folha
 * sem ninguém pedir — o mesmo efeito que o R1-2 (item 5) fechou na edição das abas de RH.
 */
export const MSG_FICHA_INATIVA = "ficha de RH inativa: o novo funcionário pelo CPF não reativa a ficha de quem está fora da folha";

type Linha = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function conferirFuncionario(ctx: ServiceCtx, id: string | null, data: Linha, atual: Linha | null) {
  // Pessoal: CPF validado, normalizado e único pela MESMA regra do parceiro
  if ("document" in data) await conferirParceiro(ctx, id, data, atual);

  const adm = data["rh_admissao"] as Linha | undefined;
  if (adm && typeof adm["matricula"] === "string") {
    adm["matricula"] = adm["matricula"].trim();
    if (adm["matricula"] === "") adm["matricula"] = null;
    else {
      const dup = await ctx.tx.query<{ id: string; code: string; name: string }>(
        `select p.id::text, p.code, p.name from erp.employee_profiles e join erp.people p on p.id = e.person_id
          where e.organization_id = $1 and e.matricula = $2 and p.deleted_at is null and ($3::uuid is null or e.person_id <> $3::uuid) limit 1`,
        [ctx.orgId, adm["matricula"], id]);
      const x = dup.rows[0];
      if (x) throw new DomainError("CONFLICT", `Matrícula já usada pelo funcionário ${x.code} - ${x.name}`, [{ path: "rh_admissao.matricula", message: `Já usada: ${x.code} - ${x.name}`, aba: "admissao", perfil: "rh_admissao" }]);
    }
  }
  if (adm && typeof adm["empresa_id"] === "string") await exigirEmpresaDeLancamento(ctx, adm["empresa_id"]);

  const usr = data["rh_usuario"] as Linha | undefined;
  if (usr && typeof usr["user_id"] === "string") {
    const m = await ctx.tx.query("select 1 from erp.organization_members where organization_id = $1 and user_id = $2", [ctx.orgId, usr["user_id"]]);
    if (!m.rowCount) throw validation("Usuário do sistema: selecione um usuário desta organização", [{ path: "rh_usuario.user_id", message: "Selecione um usuário desta organização", aba: "usuario", perfil: "rh_usuario" }]);
  }

  const pag = data["rh_pagamento"] as Linha | undefined;
  if (pag && typeof pag["conta_pagamento_id"] === "string") {
    const conta = pag["conta_pagamento_id"];
    const ok = id && UUID.test(conta)
      ? (await ctx.tx.query("select 1 from erp.parceiro_contas where id = $1 and person_id = $2 and organization_id = $3 and deleted_at is null", [conta, id, ctx.orgId])).rowCount
      : 0;
    if (!ok) throw validation("Conta de pagamento: escolha uma conta adicional deste parceiro (vazio = conta principal)", [{ path: "rh_pagamento.conta_pagamento_id", message: "Conta que não é deste parceiro", aba: "pagamento", perfil: "rh_pagamento" }]);
  }
}

/**
 * Novo funcionário pelo CPF. Devolve o id do PARCEIRO (que é o id da ficha de RH) e se ele foi criado agora.
 * Tudo na transação do `runService` de quem chama: erro em qualquer passo desfaz o parceiro e a ficha.
 *
 * Parceiro EXISTENTE = vivo (`deleted_at is null`) desta organização com o mesmo CPF normalizado — o MESMO recorte
 * do índice único `ux_people_documento_normalizado`; o excluído não conta (a porta cria um parceiro novo e não toca
 * no excluído). Com ele, nesta ordem:
 *  1. ainda NÃO é Funcionário e quem chama não tem `people.edit` → 403 `MSG_CPF_JA_E_PARCEIRO`, nada gravado.
 *     A capacidade vem ANTES da situação: quem não edita parceiros não fica sabendo se o parceiro está inativo;
 *  2. inativo → 422 `MSG_PARCEIRO_INATIVO` (a reativação é do cadastro de parceiros, não do RH);
 *  3. ficha de RH que já existe e está INATIVA → 422 `MSG_FICHA_INATIVA`, nada gravado (nem o tipo);
 *  4. marca `is_employee` (se ainda não é) e cria a ficha SÓ se ela não existe. Parceiro que JÁ é Funcionário não
 *     é tocado (não há o que marcar; o RH já o enxerga pela lista) e ficha que JÁ existe também não: nenhum UPDATE,
 *     nenhuma linha na trilha de auditoria da ficha.
 * O parceiro e a ficha ficam travados (`for update`) da leitura até a gravação: a situação conferida é a gravada.
 */
export async function funcionarioPorCpf(ctx: ServiceCtx, corpo: { document: string; name?: string | null }, criarParceiro: (dados: Linha) => Promise<{ id: string }>) {
  const r = validarDocumento(corpo.document);
  if (!r.valido || r.normalizado.length !== 11) throw validation(`CPF: ${r.valido ? "informe um CPF (11 dígitos)" : r.motivo}`, [{ path: "document", message: r.valido ? "Informe um CPF" : r.motivo, aba: "pessoal" }]);
  const cpf = r.normalizado;
  const existente = await ctx.tx.query<{ id: string; is_active: boolean; is_employee: boolean }>(
    `select id::text, is_active, is_employee from erp.people where organization_id = $1 and deleted_at is null and document is not null
        and upper(regexp_replace(document, '[^0-9A-Za-z]', '', 'g')) = $2 limit 1 for update`, [ctx.orgId, cpf]);
  const p = existente.rows[0];
  let id = p?.id ?? null;
  const criado = id === null;
  let temFicha = false;
  if (p) {
    if (!p.is_employee && !hasPermission(ctx, PERMISSAO_MARCAR_FUNCIONARIO)) throw new DomainError("PERMISSION_DENIED", MSG_CPF_JA_E_PARCEIRO);
    if (!p.is_active) throw validation(MSG_PARCEIRO_INATIVO, [{ path: "document", message: MSG_PARCEIRO_INATIVO, aba: "pessoal" }]);
    const ficha = await ctx.tx.query<{ is_active: boolean }>(
      "select is_active from erp.employee_profiles where person_id = $1 and organization_id = $2 for update", [p.id, ctx.orgId]);
    temFicha = ficha.rows.length > 0;
    if (temFicha && !ficha.rows[0]!.is_active) throw validation(MSG_FICHA_INATIVA, [{ path: "document", message: MSG_FICHA_INATIVA, aba: "pessoal" }]);
    if (!p.is_employee) {
      // parceiro existente: marca o tipo Funcionário (não duplica)
      const u = await ctx.tx.query("update erp.people set is_employee = true where id = $1 and organization_id = $2 and deleted_at is null", [p.id, ctx.orgId]);
      if (u.rowCount !== 1) throw new DomainError("CONCURRENCY_CONFLICT", "O parceiro mudou durante a gravação; tente de novo");
    }
  } else {
    const nome = (corpo.name ?? "").trim();
    if (!nome) throw validation("Nome: informe o nome do funcionário (CPF ainda não cadastrado)", [{ path: "name", message: "Obrigatório para CPF novo", aba: "pessoal" }]);
    if (!getResource("people")) throw new DomainError("INTERNAL_ERROR", "cadastro de parceiros ausente");
    id = (await criarParceiro({ person_type: "natural", document: cpf, name: nome, is_employee: true })).id;
  }
  if (!temFicha) {
    // ficha NOVA (a existente não é tocada): `do nothing` + ROW COUNT — 0 linha = outra gravação criou a ficha agora
    const f = await ctx.tx.query(
      "insert into erp.employee_profiles (person_id, organization_id, is_active) values ($1, $2, true) on conflict (person_id) do nothing",
      [id, ctx.orgId]);
    if (f.rowCount !== 1) throw new DomainError("CONCURRENCY_CONFLICT", "A ficha de RH mudou durante a gravação; tente de novo");
  }
  return { id, criado };
}

/**
 * Configurações › RH › Funções (Fase 5): o CBO gravado é uma ocupação da CBO OFICIAL (erp.cbo_ocupacoes, 0026).
 * A FK da 0028 é a autoridade; aqui o erro sai antes como 422 no campo. Vazio limpa.
 */
export async function conferirCboDaFuncao(ctx: ServiceCtx, data: Linha) {
  if (!("cbo_code" in data)) return;
  const v = data["cbo_code"];
  if (v === null || v === undefined || String(v).trim() === "") { data["cbo_code"] = null; return; }
  const codigo = String(v).replace(/\D/g, "");
  const r = codigo.length === 6 ? await ctx.tx.query("select 1 from erp.cbo_ocupacoes where codigo = $1", [codigo]) : { rowCount: 0 };
  if (!r.rowCount) throw validation("CBO: escolha uma ocupação da CBO oficial", [{ path: "cbo_code", message: "Ocupação não encontrada na CBO" }]);
  data["cbo_code"] = codigo;
}
