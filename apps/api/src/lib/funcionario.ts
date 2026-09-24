/**
 * Regras do FUNCIONÁRIO (CADASTROS Fase 5). O funcionário é o PARCEIRO (erp.people) do tipo Funcionário com a
 * ficha de RH em erp.employee_profiles (1:1). A ficha usa o mecanismo genérico de abas (decisão 253); aqui
 * ficam só as regras próprias, chamadas ANTES de qualquer gravação e dentro da mesma transação:
 *
 *  · `conferirFuncionario` — CPF (regra ÚNICA do parceiro), matrícula repetida (409 com o funcionário que a
 *    usa; o trigger da 0028 é a autoridade), empresa de lotação no escopo de lançamento, usuário do sistema
 *    membro DESTA organização, conta de pagamento = conta adicional viva do PRÓPRIO parceiro;
 *  · `funcionarioPorCpf` — o NOVO funcionário começa pelo CPF: CPF de parceiro vivo existente → marca o tipo
 *    Funcionário nele (não duplica); CPF novo → cria o parceiro (tipo Funcionário) e a ficha de RH na MESMA
 *    transação.
 */
import { getResource, validarDocumento } from "@agro/domain";
import { DomainError } from "@agro/shared";
import { validation } from "./errors.js";
import { exigirEmpresaDeLancamento, type ServiceCtx } from "./context.js";
import { conferirParceiro } from "./parceiro.js";

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
 */
export async function funcionarioPorCpf(ctx: ServiceCtx, corpo: { document: string; name?: string | null }, criarParceiro: (dados: Linha) => Promise<{ id: string }>) {
  const r = validarDocumento(corpo.document);
  if (!r.valido || r.normalizado.length !== 11) throw validation(`CPF: ${r.valido ? "informe um CPF (11 dígitos)" : r.motivo}`, [{ path: "document", message: r.valido ? "Informe um CPF" : r.motivo, aba: "pessoal" }]);
  const cpf = r.normalizado;
  const existente = await ctx.tx.query<{ id: string }>(
    `select id::text from erp.people where organization_id = $1 and deleted_at is null and document is not null
        and upper(regexp_replace(document, '[^0-9A-Za-z]', '', 'g')) = $2 limit 1`, [ctx.orgId, cpf]);
  let id = existente.rows[0]?.id ?? null;
  const criado = id === null;
  if (id) {
    // parceiro existente: marca o tipo Funcionário (não duplica)
    const u = await ctx.tx.query("update erp.people set is_employee = true where id = $1 and organization_id = $2", [id, ctx.orgId]);
    if (u.rowCount !== 1) throw new DomainError("CONCURRENCY_CONFLICT", "O parceiro mudou durante a gravação; tente de novo");
  } else {
    const nome = (corpo.name ?? "").trim();
    if (!nome) throw validation("Nome: informe o nome do funcionário (CPF ainda não cadastrado)", [{ path: "name", message: "Obrigatório para CPF novo", aba: "pessoal" }]);
    if (!getResource("people")) throw new DomainError("INTERNAL_ERROR", "cadastro de parceiros ausente");
    id = (await criarParceiro({ person_type: "natural", document: cpf, name: nome, is_employee: true })).id;
  }
  const f = await ctx.tx.query(
    "insert into erp.employee_profiles (person_id, organization_id, is_active) values ($1, $2, true) on conflict (person_id) do update set is_active = true",
    [id, ctx.orgId]);
  if (f.rowCount !== 1) throw new DomainError("CONFLICT", "Ficha de RH não gravada");
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
