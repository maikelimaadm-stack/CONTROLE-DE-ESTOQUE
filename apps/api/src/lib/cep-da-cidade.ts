/**
 * CEP × CIDADE (CADASTROS AJUSTES 02): o CEP que a PRÓPRIA API já consultou (cache global `erp.consulta_cep_cache`,
 * dentro de `CACHE_CEP_DIAS`) diz de que município ele é. Se a cidade escolhida for outra, a gravação é recusada —
 * 422 VALIDATION_ERROR no campo da CIDADE:
 *   "O CEP 78250-000 é de Pontes e Lacerda - MT; a cidade escolhida é <Cidade> - <UF>. Corrija o CEP ou a cidade."
 *
 * CEP fora do cache (ou vencido) passa: esta conferência nunca chama fonte externa. Uma consulta para todos os pares.
 * Quem chama decide QUANDO conferir (só quando o CEP ou a cidade mudam naquela gravação) e ONDE apontar o erro.
 */
import { ACENTOS_DE, ACENTOS_PARA } from "@agro/domain";
import { CACHE_CEP_DIAS } from "../routes/consultas.js";
import type { ServiceCtx } from "./context.js";

export interface ParCepCidade { cep: unknown; cityId: unknown }
export interface DivergenciaCepCidade { indice: number; mensagem: string }

const soDigitos = (v: unknown) => (v === null || v === undefined ? "" : String(v).replace(/\D/g, ""));
const formatarCep = (c: string) => `${c.slice(0, 5)}-${c.slice(5)}`;

/** Primeiro par (na ordem recebida) cujo CEP em cache é de outro município; null quando nenhum diverge. */
export async function divergenciaCepCidade(ctx: ServiceCtx, pares: ParCepCidade[]): Promise<DivergenciaCepCidade | null> {
  const ceps: (string | null)[] = []; const cidades: (number | null)[] = [];
  for (const p of pares) {
    const cep = soDigitos(p.cep); const cid = soDigitos(p.cityId);
    const ok = cep.length === 8 && cid !== "" && cid.length <= 9;
    ceps.push(ok ? cep : null); cidades.push(ok ? Number(cid) : null);
  }
  if (!ceps.some((c) => c !== null)) return null;
  // município do cache: pelo código IBGE; sem ele, nome (sem acento) + UF — a mesma regra de `resolverMunicipio`
  const norm = (x: string) => `regexp_replace(translate(lower(${x}), $4, $5), '[^a-z0-9]', '', 'g')`;
  const r = await ctx.tx.query<{ i: number; cep: string; cep_nome: string; cep_uf: string; esc_nome: string; esc_uf: string }>(
    `select (p.i - 1)::int as i, p.cep, m.name as cep_nome, m.state_code as cep_uf, e.name as esc_nome, e.state_code as esc_uf
       from unnest($1::text[], $2::int[]) with ordinality as p(cep, cid, i)
       join erp.consulta_cep_cache k on k.cep = p.cep and k.consultado_em > now() - make_interval(days => $3::int)
       cross join lateral (
         select c.id, c.name, c.state_code from erp.cities c
          where c.id = case when (k.dados->>'municipioIbge') ~ '^[0-9]{7}$' then (k.dados->>'municipioIbge')::int end
         union all
         select c.id, c.name, c.state_code from erp.cities c
          where coalesce(k.dados->>'municipioIbge', '') !~ '^[0-9]{7}$' and c.state_code = upper(k.dados->>'uf')
            and ${norm("c.name")} = ${norm("k.dados->>'municipioNome'")}
         limit 1) m
       join erp.cities e on e.id = p.cid
      where p.cep is not null and m.id <> p.cid
      order by p.i limit 1`,
    [ceps, cidades, CACHE_CEP_DIAS, ACENTOS_DE, ACENTOS_PARA]);
  const x = r.rows[0];
  if (!x) return null;
  return { indice: x.i, mensagem: `O CEP ${formatarCep(x.cep)} é de ${x.cep_nome} - ${x.cep_uf}; a cidade escolhida é ${x.esc_nome} - ${x.esc_uf}. Corrija o CEP ou a cidade.` };
}

/** O CEP ou a cidade MUDAM nesta gravação? Criação (`gravado` null) conta como mudança quando os dois vêm preenchidos. */
export function cepOuCidadeMudou(novo: ParCepCidade, gravado: ParCepCidade | null): boolean {
  if (gravado === null) return soDigitos(novo.cep) !== "" && soDigitos(novo.cityId) !== "";
  return soDigitos(novo.cep) !== soDigitos(gravado.cep) || soDigitos(novo.cityId) !== soDigitos(gravado.cityId);
}
