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
 * ┌─ E POR QUE UM COMENTÁRIO NÃO BASTAVA (CORS-PREVIEW-01 R1) ───────────────────────────────────────┐
 * │ A primeira versão desta fatia dizia tudo isso em prosa — e ACEITAVA `.vercel.app` como valor de   │
 * │ configuração. Aviso em comentário não é fronteira: quem escreve a variável na plataforma de       │
 * │ implantação não lê este arquivo, e um curinga digitado ali subia em silêncio e valia em produção. │
 * │ Pior, a normalização de então APAGAVA o `https://` colado por engano, transformando um valor      │
 * │ errado num valor plausível. Agora o formato é VERIFICADO, e configuração inválida DERRUBA O       │
 * │ STARTUP — antes de existir processo servindo requisição.                                          │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * FAIL-CLOSED: sufixo não declarado = NENHUM preview aceito. A ausência de configuração nunca vira
 * permissão — o comportamento sem a variável é idêntico ao de antes desta mudança.
 */

/** Rótulo de host: letra, dígito e hífen. Nada de PONTO — é o ponto que separa um domínio de outro. */
const ROTULO = /^[a-z0-9-]+$/;

/**
 * O FORMATO CANÔNICO DE UM SUFIXO DE PREVIEW — a autoridade única deste contrato.
 *
 *     -<rótulo-da-conta>.vercel.app
 *
 * Três exigências, e cada uma existe por um valor concreto que já apareceu ou apareceria:
 *
 *  1. **Começa com hífen.** É o hífen que separa o nome do deploy do identificador da conta no
 *     hostname que a Vercel gera (`<projeto>-<hash>-<conta>.vercel.app`). Sem ele, `vercel.app` e
 *     `.vercel.app` passariam — e qualquer host de rótulo único daquele provedor viraria origem
 *     confiável, que é exatamente o curinga que esta fatia existe para proibir.
 *  2. **Um rótulo DNS de verdade entre o hífen e o domínio**: 1 a 63 caracteres, começando e
 *     terminando em alfanumérico. Sem isso `-vercel.app` (rótulo vazio) e `-minha.conta.vercel.app`
 *     (dois rótulos) passariam; o segundo é o perigoso, porque alargaria a âncora para um nível
 *     inteiro de subdomínio.
 *  3. **Termina no domínio registrável do provedor**, literal. Isso é o que impede que o sufixo seja
 *     um domínio de terceiro qualquer, e é o que torna a conta a única variável do contrato.
 *
 * Trocar de provedor de preview é mudar ESTA linha, com a decisão registrada — e não configurar um
 * valor novo numa variável de ambiente. Uma fronteira de segurança que se remaneja por variável não é
 * fronteira; é sugestão.
 */
export const FORMATO_SUFIXO_DE_PREVIEW = /^-[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/;

/** O que o erro de startup mostra a quem digitou o valor errado. Um exemplo vale mais que a regex. */
export const EXEMPLO_DE_SUFIXO = "-minhaconta.vercel.app";

/** Configuração de segurança malformada. Existe para derrubar o processo, nunca para ser capturada. */
export class SufixoDePreviewInvalido extends Error {
  constructor(readonly invalidos: readonly string[]) {
    super(
      `WEB_ORIGIN_PREVIEW_SUFFIX inválido: ${invalidos.map((s) => JSON.stringify(s)).join(", ")}. ` +
      `Cada sufixo tem de ser "-<conta>.vercel.app" (ex.: "${EXEMPLO_DE_SUFIXO}") — ` +
      `sufixo genérico de provedor, esquema, porta, caminho, credencial embutida e curinga são RECUSADOS. ` +
      `Para não aceitar nenhum preview, deixe a variável vazia ou ausente.`
    );
    this.name = "SufixoDePreviewInvalido";
  }
}

/**
 * A LISTA DE SUFIXOS, VALIDADA — ou uma exceção que impede o processo de subir.
 *
 * NORMALIZAÇÃO, e o limite dela. Duas coisas são ajustadas, e as duas são identidade, não conteúdo:
 *
 *  - **espaço em volta**, porque `A, B` numa variável de ambiente é a grafia natural de uma lista;
 *  - **caixa**, porque nome de host é case-insensitive por definição de DNS — `-Conta.Vercel.App` e
 *    `-conta.vercel.app` são o MESMO host, e a comparação do lado da origem também minúscula.
 *
 * Nada além disso é "consertado". Esquema, porta, caminho, `@` e `*` REPROVAM em vez de serem
 * removidos, e a diferença entre as duas atitudes é a razão desta função existir: remover o `https://`
 * de `https://-conta.vercel.app` produz um valor VÁLIDO a partir de um valor ERRADO, e quem digitou
 * nunca descobre que digitou errado. Silêncio sobre configuração de segurança é o modo de falha mais
 * caro que existe, porque ele se parece com sucesso.
 *
 * Item VAZIO (vírgula sobrando, variável em branco) é descartado, e só ele. Descartar vazio é seguro
 * porque o conjunto aceito só pode DIMINUIR — nenhuma origem passa a ser aceita por causa disso. É o
 * oposto de descartar um pedaço de um valor: ali o conjunto aceito AUMENTA.
 *
 * @throws {SufixoDePreviewInvalido} em qualquer item fora do formato canônico.
 */
export function sufixosDePreview(bruto: string | undefined | null): string[] {
  if (bruto === undefined || bruto === null) return [];
  const itens = bruto.split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0);
  const invalidos = itens.filter((s) => !FORMATO_SUFIXO_DE_PREVIEW.test(s));
  if (invalidos.length > 0) throw new SufixoDePreviewInvalido(invalidos);
  return itens;
}

/**
 * A ORIGEM É DE UM PREVIEW DESTE PROJETO?
 *
 * Recebe a lista JÁ VALIDADA por `sufixosDePreview`. Exige, em conjunto — e a conjunção é o ponto:
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
 * Recebe o sufixo **BRUTO** da configuração e o valida aqui dentro, de propósito: assim não existe
 * caminho por onde uma lista não verificada chegue à decisão. Quem chamar isto com `.vercel.app`
 * recebe uma exceção antes de existir servidor — não uma política permissiva.
 *
 * Devolve o predicado no formato que o `@fastify/cors` espera. Origem ausente (requisição que não
 * veio de navegador: `curl`, health check, servidor a servidor) é liberada porque CORS não se aplica
 * a ela — o que protege aquela porta é a autenticação, não a política de origem.
 *
 * @throws {SufixoDePreviewInvalido} se o sufixo configurado não estiver no formato canônico.
 */
export function politicaDeOrigem(exatas: readonly string[], sufixoBruto: string | undefined | null) {
  const permitidas = new Set(exatas.map((s) => s.trim()).filter((s) => s.length > 0));
  const sufixos = sufixosDePreview(sufixoBruto);
  return (origem: string | undefined, cb: (erro: Error | null, permitido: boolean) => void): void => {
    if (!origem) return cb(null, true);
    if (permitidas.has(origem)) return cb(null, true);
    if (ehPreviewDoProjeto(origem, sufixos)) return cb(null, true);
    cb(null, false);
  };
}
