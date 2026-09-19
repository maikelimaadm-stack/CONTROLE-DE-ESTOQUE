import { identidadeDeBuild } from "@erp/plataforma";

/**
 * GET /api/build — QUAL COMMIT ESTÁ SERVINDO ESTA SUPERFÍCIE WEB.
 *
 * O produto publica o web em dois provedores, e os artefatos deles são diferentes POR CONTRATO
 * (`output: "standalone"` só fora da Vercel, ver apps/web/next.config.ts). Por isso comparar HTML ou
 * tamanho entre as superfícies nunca respondeu "as duas estão no mesmo commit?" — e, até esta fatia,
 * nada respondia: nenhuma delas expunha cabeçalho, meta ou endpoint de versão.
 *
 * Esta rota responde, com um GET anônimo, o que o PROVEDOR injetou no processo. É deliberadamente
 * mínima: a lista de campos é fechada por `identidadeDeBuild` (núcleo neutro, testado), então nada do
 * ambiente vaza por aqui. Não há autenticação porque não há nada sensível — SHA de commit e nome de
 * provedor são públicos, e exigir sessão tornaria a verificação de versão dependente de credencial,
 * que é exatamente o que a torna inútil num incidente.
 *
 * `force-dynamic` porque identidade não se cacheia: uma resposta estática responderia o commit do
 * build ANTERIOR depois de um redeploy que reaproveitasse o cache, que é o oposto do propósito.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    { build: identidadeDeBuild(process.env as Record<string, string | undefined>) },
    { headers: { "cache-control": "no-store" } }
  );
}
