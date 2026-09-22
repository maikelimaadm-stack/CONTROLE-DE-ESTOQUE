import { z } from "zod";
import { sufixosDePreview } from "./lib/cors-origem.js";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3333),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),
  API_LOG_LEVEL: z.string().default("info"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  /**
   * Sufixos de host que identificam os previews DESTE projeto (ex.: `-minhaconta.vercel.app`).
   * Lista separada por vírgula. AUSENTE = nenhum preview aceito: a falta de configuração nunca vira
   * permissão.
   *
   * O VALOR É VERIFICADO AQUI, e um valor fora do formato canônico DERRUBA O STARTUP. Sufixo genérico
   * de provedor (`.vercel.app` cru) é o caso que motivou a verificação: com `credentials` ligado ele
   * entrega a API autenticada a qualquer conta daquele provedor, e antes da R1 a proibição existia só
   * como aviso em comentário — texto que nunca é lido por quem preenche a variável no painel da
   * plataforma. O contrato do formato mora em `lib/cors-origem.ts`, e é o mesmo que o servidor aplica.
   */
  WEB_ORIGIN_PREVIEW_SUFFIX: z.string().optional().superRefine((valor, ctx) => {
    try {
      sufixosDePreview(valor);
    } catch (erro) {
      ctx.addIssue({ code: "custom", message: erro instanceof Error ? erro.message : String(erro) });
    }
  }),
  AUTH_MODE: z.enum(["local", "supabase"]).default("local"),
  LOCAL_AUTH_SECRET: z.string().min(8).default("dev-only-secret-change-me"),
  SUPABASE_JWT_SECRET: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  RATE_LIMIT_MAX: z.coerce.number().default(300),
  /** tentativas de login por IP por minuto (proteção contra força bruta) */
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10)
});
export type Config = z.infer<typeof schema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = schema.safeParse(env);
  if (!r.success) throw new Error("Configuração inválida: " + r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  if (r.data.AUTH_MODE === "supabase" && !r.data.SUPABASE_JWT_SECRET) throw new Error("SUPABASE_JWT_SECRET é obrigatório com AUTH_MODE=supabase");
  return r.data;
}
