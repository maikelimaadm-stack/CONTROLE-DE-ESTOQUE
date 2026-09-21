/**
 * QUEM PODE FALAR COM ESTA API, DO NAVEGADOR.
 *
 * ┌─ POR QUE ISTO EXISTE ────────────────────────────────────────────────────────────────────────────┐
 * │ `WEB_ORIGIN` é uma lista de origens EXATAS, e isso basta para produção — o hostname é um só e    │
 * │ não muda. Já cada preview da Vercel nasce com um hostname NOVO, derivado do nome da branch:      │
 * │ nenhuma lista exata acompanha isso, e a consequência prática era toda PR abrir um preview que    │
 * │ falhava em "Failed to fetch" antes do primeiro login.                                            │
 * │                                                                                                  │
 * │ A saída é aceitar preview por PADRÃO. E é exatamente aí que mora o perigo, por isso o padrão é   │
 * │ ancorado e não genérico.                                                                         │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POR QUE NÃO `*.vercel.app` ─────────────────────────────────────────────────────────────────────┐
 * │ Esta API roda com `credentials: true`. Liberar o `.vercel.app` inteiro deixaria QUALQUER pessoa   │
 * │ com uma conta gratuita publicar uma página e emitir requisições AUTENTICADAS contra a API de      │
 * │ produção, com as credenciais do usuário logado. Não é um afrouxamento de conveniência — é        │
 * │ vazamento de credencial entre origens, e o navegador não nos protegeria porque nós é que teríamos │
 * │ dito que aquela origem é confiável.                                                               │
 * │                                                                                                   │
 * │ O sufixo de preview da Vercel carrega o identificador da CONTA. Ancorar nele aceita os previews   │
 * │ do projeto e recusa os de qualquer outra conta — que é a diferença entre "as minhas telas" e "a   │
 * │ internet".                                                                                        │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * FAIL-CLOSED: sufixo não declarado = NENHUM preview aceito. A ausência de configuração nunca vira
 * permissão — o comportamento sem a variável é idêntico ao de antes desta mudança.
 */

/** Rótulo de host: letra, dígito e hífen. Nada de PONTO — é o ponto que separa um domínio de outro. */
const ROTULO = /^[a-z0-9-]+$/;

/**
 * O sufixo declarado é aceito com ou sem o ponto inicial do próprio `.vercel.app`; o que ele precisa
 * ter é a parte que identifica a conta. Normalizar aqui evita que um espaço ou um `https://` colado
 * por engano na variável de ambiente vire um sufixo que nunca casa — silencioso, e portanto pior.
 */
export function normalizarSufixos(bruto: string | undefined): string[] {
  if (!bruto) return [];
  return bruto
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .map((s) => s.replace(/^https?:\/\//, ""))
    .filter((s) => s.length > 0);
}

/**
 * A ORIGEM É DE UM PREVIEW DESTE PROJETO?
 *
 * Exige, em conjunto — e a conjunção é o ponto:
 *  1. esquema `https` literal. `http://` cai fora: preview da Vercel é sempre TLS, e aceitar texto
 *     claro abriria a porta para quem controla a rede.
 *  2. host terminando EXATAMENTE no sufixo declarado. Sufixo é fim de cadeia, não "contém" — senão
 *     `https://<sufixo>.atacante.com` passaria.
 *  3. o que vem antes do sufixo é UM rótulo, sem ponto. Sem isso `https://atacante.com-<sufixo>`
 *     passaria pela regra 2, e um domínio de terceiro viraria origem confiável.
 *  4. nada de porta, nada de caminho, nada de credencial embutida — origem é esquema + host, e
 *     qualquer coisa a mais indica que não estamos olhando uma origem de verdade.
 */
export function ehPreviewDoProjeto(origem: string, sufixos: readonly string[]): boolean {
  if (sufixos.length === 0) return false;              // fail-closed: sem configuração, nenhum preview
  if (!origem.startsWith("https://")) return false;    // (1)
  const host = origem.slice("https://".length).toLowerCase();
  if (host.includes("/") || host.includes(":") || host.includes("@")) return false; // (4)
  for (const sufixo of sufixos) {
    if (!host.endsWith(sufixo)) continue;              // (2)
    const prefixo = host.slice(0, host.length - sufixo.length);
    if (prefixo.length === 0) continue;                // o sufixo sozinho não é preview de ninguém
    if (ROTULO.test(prefixo)) return true;             // (3)
  }
  return false;
}

/**
 * A FUNÇÃO QUE O CORS CONSULTA.
 *
 * Devolve o predicado no formato que o `@fastify/cors` espera. Origem ausente (requisição que não
 * veio de navegador: `curl`, health check, servidor a servidor) é liberada porque CORS não se aplica
 * a ela — o que protege aquela porta é a autenticação, não a política de origem.
 */
export function politicaDeOrigem(exatas: readonly string[], sufixosDePreview: readonly string[]) {
  const permitidas = new Set(exatas.map((s) => s.trim()).filter((s) => s.length > 0));
  return (origem: string | undefined, cb: (erro: Error | null, permitido: boolean) => void): void => {
    if (!origem) return cb(null, true);
    if (permitidas.has(origem)) return cb(null, true);
    if (ehPreviewDoProjeto(origem, sufixosDePreview)) return cb(null, true);
    cb(null, false);
  };
}
