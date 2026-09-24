import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { normalizarDocumento, validarCnpj, semAcento } from "@agro/domain";
import { runService, audit } from "../lib/service.js";
import { denied, err, notFound, validation } from "../lib/errors.js";
import { hasPermission, type ServiceCtx } from "../lib/context.js";
import { LimitePorMinuto, type BuscarFn } from "../lib/consultas/http.js";
import { consultarCnpjNasFontes, FONTES_CNPJ, PausaDeFontes, type DadosCnpj } from "../lib/consultas/cnpj.js";
import { consultarCepNasFontes, type DadosCep } from "../lib/consultas/cep.js";

declare module "fastify" {
  interface FastifyInstance {
    /** Porta de saída HTTP das consultas externas. Produção: `fetch`; testes: mock (nunca rede real no CI). */
    buscarExterno: BuscarFn;
  }
}

/**
 * CONSULTAS DE CEP E CNPJ (CADASTROS Fase 3).
 *
 *   GET /api/consultas/cep/:cep     ViaCEP → BrasilAPI. Cache global 30 dias. 60/min por organização.
 *   GET /api/consultas/cnpj/:cnpj   fontes GRATUITAS em ordem (CONSULTA_CNPJ_FONTES). Cache global 7 dias;
 *                                   `?atualizar=1` ignora o cache, no máximo 1 vez por minuto por CNPJ.
 *                                   20/min por organização. Auditoria sem a resposta inteira. Nunca QSA.
 *
 * Permissão: people.create OU people.edit — é quem preenche a ficha. As duas consultas só LEEM fontes
 * públicas e gravam apenas o cache global e a auditoria; o cadastro continua gravado pela rota dele.
 * A chamada externa acontece FORA da transação (não segura conexão do banco por até 5 s por fonte).
 */
export const CACHE_CEP_DIAS = 30;
export const CACHE_CNPJ_DIAS = 7;
export const LIMITE_CEP_POR_MINUTO = 60;
export const LIMITE_CNPJ_POR_MINUTO = 20;
export const MSG_CEP_INDISPONIVEL = "consulta de CEP indisponível agora; preencha o endereço";
export const MSG_CNPJ_INDISPONIVEL = "consulta de CNPJ indisponível agora; preencha manualmente";
export const MSG_CNPJ_INEXISTENTE = "CNPJ não encontrado nas fontes gratuitas";
export const MSG_CNPJ_LETRAS = "as fontes gratuitas ainda não consultam CNPJ com letras; preencha manualmente";

const semQuery = z.object({}).strict();
const cnpjQuery = z.object({ atualizar: z.enum(["1"]).optional() }).strict();

function exigirPermissao(app: FastifyInstance, req: FastifyRequest) {
  const ctx = app.requireCtx(req);
  if (!hasPermission(ctx, "people.create") && !hasPermission(ctx, "people.edit")) throw denied("people.create ou people.edit");
  return ctx;
}

/** Município da fonte contra erp.cities: código IBGE; na falta dele, nome (sem acento) + UF. */
async function resolverMunicipio(ctx: ServiceCtx, ibge: number | null, nome: string | null, uf: string | null) {
  if (ibge) {
    const r = await ctx.tx.query<{ id: number; name: string; state_code: string }>("select id, name, state_code from erp.cities where id=$1", [ibge]);
    if (r.rows[0]) return { codigoIbge: r.rows[0].id, nome: r.rows[0].name, uf: r.rows[0].state_code };
  }
  if (nome && uf) {
    const r = await ctx.tx.query<{ id: number; name: string; state_code: string }>("select id, name, state_code from erp.cities where state_code=$1", [uf.toUpperCase()]);
    const alvo = semAcento(nome).replace(/[^a-z0-9]/g, "");
    const achado = r.rows.find((c) => semAcento(c.name).replace(/[^a-z0-9]/g, "") === alvo);
    if (achado) return { codigoIbge: achado.id, nome: achado.name, uf: achado.state_code };
  }
  return null;
}

async function respostaCnpj(ctx: ServiceCtx, dados: DadosCnpj, fonte: string, consultadoEm: string) {
  const { endereco, ...resto } = dados;
  const { municipioIbge, municipioNome, uf, ...end } = endereco;
  return { ...resto, endereco: { ...end, municipio: await resolverMunicipio(ctx, municipioIbge, municipioNome, uf) }, fonte, consultadoEm };
}

async function respostaCep(ctx: ServiceCtx, dados: DadosCep, fonte: string, consultadoEm: string) {
  const { municipioIbge, municipioNome, uf, ...resto } = dados;
  return { ...resto, municipio: await resolverMunicipio(ctx, municipioIbge, municipioNome, uf), fonte, consultadoEm };
}

export default async function consultaRoutes(app: FastifyInstance) {
  // Estado por INSTÂNCIA da API (limites e pausa de fonte). Com várias réplicas o limite efetivo é por
  // réplica — declarado em docs/DEPLOYMENT.md.
  const limiteCep = new LimitePorMinuto(LIMITE_CEP_POR_MINUTO);
  const limiteCnpj = new LimitePorMinuto(LIMITE_CNPJ_POR_MINUTO);
  const reconsulta = new LimitePorMinuto(1);
  const pausa = new PausaDeFontes();

  app.get("/consultas/cep/:cep", async (req) => {
    const ctx = exigirPermissao(app, req);
    semQuery.parse(req.query);
    const cep = String((req.params as { cep: string }).cep ?? "").replace(/[.\-\s]/g, "");
    if (!/^\d{8}$/.test(cep)) throw validation("CEP inválido", [{ path: ["cep"], message: "CEP deve ter 8 dígitos" }]);
    if (!limiteCep.permitir(ctx.orgId)) throw err("RATE_LIMITED", "Limite de consultas de CEP por minuto atingido; tente em instantes");
    const cache = await runService(app, req, null, async (tx) => {
      const r = await tx.tx.query<{ dados: DadosCep; fonte: string; consultado_em: Date }>(`select dados, fonte, consultado_em from erp.consulta_cep_cache where cep=$1 and consultado_em > now() - interval '${CACHE_CEP_DIAS} days'`, [cep]);
      return r.rows[0] ? respostaCep(tx, r.rows[0].dados, r.rows[0].fonte, r.rows[0].consultado_em.toISOString()) : null;
    });
    if (cache) return cache;
    const r = await consultarCepNasFontes(app.buscarExterno, cep);
    if (r.tipo === "inexistente") throw notFound("CEP");
    if (r.tipo === "indisponivel") throw err("CONSULTA_INDISPONIVEL", MSG_CEP_INDISPONIVEL);
    return runService(app, req, null, async (tx) => {
      const g = await tx.tx.query<{ consultado_em: Date }>("insert into erp.consulta_cep_cache (cep, dados, fonte, consultado_em) values ($1,$2,$3,now()) on conflict (cep) do update set dados=excluded.dados, fonte=excluded.fonte, consultado_em=excluded.consultado_em returning consultado_em", [cep, JSON.stringify(r.dados), r.fonte]);
      if (g.rowCount !== 1) throw new Error("cache de CEP não gravado");
      return respostaCep(tx, r.dados, r.fonte, g.rows[0]!.consultado_em.toISOString());
    });
  });

  app.get("/consultas/cnpj/:cnpj", async (req) => {
    const ctx = exigirPermissao(app, req);
    const q = cnpjQuery.parse(req.query);
    const cnpj = normalizarDocumento(String((req.params as { cnpj: string }).cnpj ?? ""));
    // Validação ANTES de qualquer chamada: caractere fora de [0-9A-Z] ou DV errado nunca sai da API.
    if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj) || !validarCnpj(cnpj)) throw validation("CNPJ inválido", [{ path: ["cnpj"], message: "CNPJ inválido" }]);
    const fontes = app.config.CONSULTA_CNPJ_FONTES;
    if (!fontes.length) throw err("CONSULTA_INDISPONIVEL", MSG_CNPJ_INDISPONIVEL);
    if (/[A-Z]/.test(cnpj) && !fontes.some((f) => FONTES_CNPJ[f].aceitaAlfanumerico)) throw validation(MSG_CNPJ_LETRAS, [{ path: ["cnpj"], message: MSG_CNPJ_LETRAS }]);
    if (!limiteCnpj.permitir(ctx.orgId)) throw err("RATE_LIMITED", "Limite de consultas de CNPJ por minuto atingido; tente em instantes");
    const registrar = (tx: ServiceCtx, fonte: string | null, resultado: string) => audit(tx.tx, tx, "consulta_cnpj", cnpj, "consulta", { fonte, resultado });

    if (q.atualizar) {
      if (!reconsulta.permitir(cnpj)) throw err("RATE_LIMITED", "Este CNPJ foi consultado de novo há menos de 1 minuto; aguarde");
    } else {
      const cache = await runService(app, req, null, async (tx) => {
        const r = await tx.tx.query<{ dados: DadosCnpj; fonte: string; consultado_em: Date }>(`select dados, fonte, consultado_em from erp.consulta_cnpj_cache where cnpj=$1 and consultado_em > now() - interval '${CACHE_CNPJ_DIAS} days'`, [cnpj]);
        if (!r.rows[0]) return null;
        await registrar(tx, r.rows[0].fonte, "cache");
        return respostaCnpj(tx, r.rows[0].dados, r.rows[0].fonte, r.rows[0].consultado_em.toISOString());
      });
      if (cache) return cache;
    }

    const r = await consultarCnpjNasFontes(app.buscarExterno, cnpj, fontes, pausa);
    const saida = await runService(app, req, null, async (tx) => {
      if (r.tipo !== "ok") { await registrar(tx, null, r.tipo); return null; }
      const g = await tx.tx.query<{ consultado_em: Date }>("insert into erp.consulta_cnpj_cache (cnpj, dados, fonte, consultado_em) values ($1,$2,$3,now()) on conflict (cnpj) do update set dados=excluded.dados, fonte=excluded.fonte, consultado_em=excluded.consultado_em returning consultado_em", [cnpj, JSON.stringify(r.dados), r.fonte]);
      if (g.rowCount !== 1) throw new Error("cache de CNPJ não gravado");
      await registrar(tx, r.fonte, "ok");
      return respostaCnpj(tx, r.dados, r.fonte, g.rows[0]!.consultado_em.toISOString());
    });
    if (saida) return saida;
    if (r.tipo === "inexistente") throw err("NOT_FOUND", MSG_CNPJ_INEXISTENTE);
    if (r.tipo === "sem_suporte_alfanumerico") throw validation(MSG_CNPJ_LETRAS, [{ path: ["cnpj"], message: MSG_CNPJ_LETRAS }]);
    throw err("CONSULTA_INDISPONIVEL", MSG_CNPJ_INDISPONIVEL);
  });
}
