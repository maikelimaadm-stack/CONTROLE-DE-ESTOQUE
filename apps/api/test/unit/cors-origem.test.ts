import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FORMATO_SUFIXO_DE_PREVIEW,
  SufixoDePreviewInvalido,
  ehPreviewDoProjeto,
  politicaDeOrigem,
  sufixosDePreview
} from "../../src/lib/cors-origem.js";
import { loadConfig } from "../../src/config.js";

/**
 * A superfície que esta suíte protege é pequena e perigosa: quem entra, entra AUTENTICADO
 * (`credentials: true`). Por isso os casos abaixo são, em maioria, tentativas de PASSAR — o teste
 * que vale aqui é o que prova a recusa, não o que prova a aceitação.
 *
 * A R1 acrescentou a metade que faltava. A R0 tinha a regra de CASAMENTO certa e a regra de
 * CONFIGURAÇÃO ausente: `.vercel.app` era um valor aceito, e a proibição existia só como aviso em
 * comentário. Com `credentials` ligado, isso significa que a fronteira dependia de alguém ler um
 * arquivo que quem preenche a variável no painel da plataforma nunca abre. As duas metades agora
 * estão aqui: o que o SERVIDOR aceita como origem, e o que o PROCESSO aceita como configuração.
 */

/** Sufixo de exemplo, no formato que a Vercel gera: hífen + identificador da conta + domínio. */
const SUFIXO = "-contadoprojeto.vercel.app";

/** Ajuda a ler as tabelas: devolve o veredito da política, e não só do casador de sufixo. */
function permitido(origem: string | undefined, sufixo: string | undefined, exatas: readonly string[] = []): boolean {
  let r: boolean | null = null;
  politicaDeOrigem(exatas, sufixo)(origem, (_e, ok) => { r = ok; });
  if (r === null) throw new Error("a política não respondeu — callback nunca chamado");
  return r;
}

/**
 * O STARTUP de verdade, sem atalho: `loadConfig` é o que o processo chama, e é ele que tem de
 * recusar. Um teste que só exercitasse o parser provaria a regex e não provaria a fronteira — o
 * defeito da R0 era exatamente esse tipo de distância entre a regra e o lugar onde ela é aplicada.
 */
const AMBIENTE_MINIMO = { DATABASE_URL: "postgresql://exemplo-local/banco-de-exemplo" };
const startup = (WEB_ORIGIN_PREVIEW_SUFFIX?: string) =>
  loadConfig({ ...AMBIENTE_MINIMO, ...(WEB_ORIGIN_PREVIEW_SUFFIX === undefined ? {} : { WEB_ORIGIN_PREVIEW_SUFFIX }) });

/** Um valor recusado tem de derrubar as TRÊS portas; qualquer uma que aceitasse seria a porta aberta. */
function recusadoEmTodaPorta(valor: string, motivo: string): void {
  expect(() => startup(valor), `${motivo} — loadConfig`).toThrow(/WEB_ORIGIN_PREVIEW_SUFFIX inválido/);
  expect(() => sufixosDePreview(valor), `${motivo} — parser`).toThrow(SufixoDePreviewInvalido);
  expect(() => politicaDeOrigem([], valor), `${motivo} — política do servidor`).toThrow(SufixoDePreviewInvalido);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// C1–C11 · O QUE O PROCESSO ACEITA COMO CONFIGURAÇÃO
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("CORS · o sufixo de preview é VERIFICADO no startup", () => {
  it("C1 · ausente: configuração válida, e ZERO previews aceitos", () => {
    // Fail-closed. A ausência de configuração é o estado de quem ainda não decidiu — e não decidir
    // nunca libera. O comportamento é idêntico ao de antes desta fatia existir.
    expect(() => startup()).not.toThrow();
    expect(startup().WEB_ORIGIN_PREVIEW_SUFFIX).toBeUndefined();
    expect(sufixosDePreview(undefined)).toEqual([]);
    expect(sufixosDePreview("")).toEqual([]);
    expect(permitido(`https://app-git-main${SUFIXO}`, undefined)).toBe(false);
    expect(permitido(`https://app-git-main${SUFIXO}`, "")).toBe(false);
  });

  it("C2 · sufixo de conta válido: startup sobe e o valor sobrevive", () => {
    expect(() => startup(SUFIXO)).not.toThrow();
    expect(startup(SUFIXO).WEB_ORIGIN_PREVIEW_SUFFIX).toBe(SUFIXO);
    for (const bom of ["-minhaconta.vercel.app", "-equipe-erp.vercel.app", "-abc123.vercel.app"]) {
      expect(sufixosDePreview(bom), bom).toEqual([bom]);
      expect(FORMATO_SUFIXO_DE_PREVIEW.test(bom), bom).toBe(true);
    }
  });

  it("C3 · vários sufixos válidos convivem, e cada um continua ancorado na sua conta", () => {
    const dois = "-conta-a.vercel.app,-conta-b.vercel.app";
    expect(() => startup(dois)).not.toThrow();
    expect(sufixosDePreview(dois)).toEqual(["-conta-a.vercel.app", "-conta-b.vercel.app"]);
    expect(permitido("https://app-conta-a.vercel.app", dois)).toBe(true);
    expect(permitido("https://app-conta-b.vercel.app", dois)).toBe(true);
    expect(permitido("https://app-conta-c.vercel.app", dois), "conta que não está na lista").toBe(false);
    expect(permitido("https://x.y-conta-a.vercel.app", dois), "dois rótulos antes do sufixo").toBe(false);
    // Um item inválido entre válidos REPROVA o conjunto: aceitar os bons e descartar o mau em
    // silêncio é o comportamento que faz alguém acreditar que configurou o que não configurou.
    recusadoEmTodaPorta(`${SUFIXO},.vercel.app`, "um mau entre bons");
  });

  it("C4 · `.vercel.app` (raiz do provedor) DERRUBA o startup — este é o defeito que a R1 fecha", () => {
    // Com credentials ligado, isto autorizaria qualquer host de rótulo único daquele provedor,
    // isto é, qualquer pessoa com conta gratuita, a falar AUTENTICADA com a API de produção.
    recusadoEmTodaPorta(".vercel.app", "raiz do provedor");
    // E a prova de que o estrago era real e não teórico: com a raiz aceita, um host de outra conta
    // passaria pelo casador. O casador nunca foi o problema — a configuração era.
    expect(ehPreviewDoProjeto("https://atacante.vercel.app", [".vercel.app"]),
      "o casador aceita a raiz: é por isso que a raiz não pode CHEGAR até ele").toBe(true);
  });

  it("C5 · `vercel.app` sem ponto nem hífen REPROVA", () => {
    recusadoEmTodaPorta("vercel.app", "domínio do provedor cru");
  });

  it("C5b · o hífen inicial é OBRIGATÓRIO — sem ele a âncora deixa de ser âncora", () => {
    // Esta asserção existe por uma mutação específica que C4/C5/C6 NÃO pegariam: trocar `^-` por
    // `^-?` no formato canônico. Nem `.vercel.app` nem `vercel.app` passam a casar com isso (são
    // curtos demais para terminar em `.vercel.app`), então os três testes acima continuariam verdes
    // enquanto `conta.vercel.app` — um sufixo SEM âncora, que aceita qualquer `Xconta.vercel.app` —
    // viraria configuração válida. Um teste que não distingue a regra da sua versão frouxa não está
    // protegendo a regra.
    recusadoEmTodaPorta("conta.vercel.app", "sem o hífen inicial");
    recusadoEmTodaPorta("contadoprojeto.vercel.app", "sem o hífen inicial, nome longo");
    expect(FORMATO_SUFIXO_DE_PREVIEW.source.startsWith("^-["),
      "o `-` do formato canônico não pode ser opcional nem sumir").toBe(true);
  });

  it("C6 · `-vercel.app` (hífen sem conta nenhuma) REPROVA", () => {
    // Parece ancorado e não é: o rótulo da conta está vazio, então a âncora não ancora em ninguém.
    recusadoEmTodaPorta("-vercel.app", "âncora vazia");
    recusadoEmTodaPorta("-.vercel.app", "âncora de um ponto");
  });

  it("C7 · curinga `*.vercel.app` REPROVA — e não vira `.vercel.app`", () => {
    recusadoEmTodaPorta("*.vercel.app", "curinga");
    recusadoEmTodaPorta("*-conta.vercel.app", "curinga com conta");
  });

  it("C8 · esquema colado no valor REPROVA — NÃO é removido em silêncio", () => {
    // A R0 apagava o `https://` e seguia. Isso transforma um valor ERRADO num valor VÁLIDO, e quem
    // digitou nunca descobre. Configuração de segurança que se autocorrige não é configuração.
    recusadoEmTodaPorta("https://-conta.vercel.app", "https colado");
    recusadoEmTodaPorta("http://-conta.vercel.app", "http colado");
    recusadoEmTodaPorta("//-conta.vercel.app", "esquema relativo");
  });

  it("C9 · porta, caminho e credencial embutida REPROVAM", () => {
    recusadoEmTodaPorta("-conta.vercel.app:443", "porta");
    recusadoEmTodaPorta("-conta.vercel.app/", "barra final");
    recusadoEmTodaPorta("-conta.vercel.app/caminho", "caminho");
    recusadoEmTodaPorta("usuario@-conta.vercel.app", "credencial embutida");
  });

  it("C10 · rótulo de conta com PONTO REPROVA — um nível inteiro de subdomínio alargaria a âncora", () => {
    recusadoEmTodaPorta("-minha.conta.vercel.app", "conta com ponto");
    recusadoEmTodaPorta("-a.b.vercel.app", "dois rótulos");
  });

  it("C11 · caixa é normalizada (host é case-insensitive), espaço em volta também", () => {
    // Esta é a regra ESCOLHIDA, e ela é diferente de apagar esquema: `-Conta.Vercel.App` e
    // `-conta.vercel.app` são o MESMO host por definição de DNS — a caixa é identidade, não conteúdo.
    expect(sufixosDePreview(" -CONTADOPROJETO.VERCEL.APP ")).toEqual([SUFIXO]);
    expect(sufixosDePreview(` ${SUFIXO} , -outra.vercel.app `)).toEqual([SUFIXO, "-outra.vercel.app"]);
    expect(() => startup("-CONTADOPROJETO.VERCEL.APP")).not.toThrow();
    expect(permitido("https://APP-GIT-MAIN-CONTADOPROJETO.VERCEL.APP", "-CONTADOPROJETO.VERCEL.APP")).toBe(true);
    // Vírgula sobrando some, e só ela: descartar item VAZIO só pode diminuir o conjunto aceito.
    expect(sufixosDePreview(`${SUFIXO},,`)).toEqual([SUFIXO]);
    expect(sufixosDePreview(" , ")).toEqual([]);
  });

  it("a mensagem do erro localiza o item e ensina o formato — sem NUNCA ecoar o valor", () => {
    // Um erro de startup que não diz o que fazer vira uma reexecução e um `git revert`. E um erro
    // que ecoa o valor vira vazamento: esta variável é preenchida à mão no painel da plataforma, ao
    // lado das que guardam DSN e token, e colar a errada no campo errado é o engano mais comum ali.
    // A primeira versão desta classe imprimia o valor; um DSN colado por engano ia INTEIRO para o
    // log, com senha. `CLAUDE.md` § Segredos: "nem mascarada".
    const SEGREDO_FALSO = "postgresql://erp_app:Tr0ub4dor-FALSO@db.interno:5432/erp";
    try {
      startup(`${SUFIXO},${SEGREDO_FALSO}`);
      throw new Error("deveria ter reprovado");
    } catch (e) {
      const m = (e as Error).message;
      expect(m, "o item errado é o segundo, e a mensagem tem de dizer isso").toMatch(/o item 2 de 2/);
      expect(m, "sem o formato esperado, quem lê não sabe o que corrigir").toContain("-minhaconta.vercel.app");
      expect(m, "quem só quer desligar precisa saber como").toContain("vazia ou ausente");
      // O coração deste teste: nem o valor inteiro, nem a senha, nem o host, nem o usuário.
      for (const pedaco of [SEGREDO_FALSO, "Tr0ub4dor-FALSO", "tr0ub4dor-falso", "db.interno", "erp_app"]) {
        expect(m, `"${pedaco}" não pode aparecer no log de startup`).not.toContain(pedaco);
      }
    }
  });

  it("caixa é dobrada DEPOIS da conferência de ASCII — senão o `toLowerCase` fabrica um host", () => {
    // `U+212A` (SINAL DE KELVIN) minúsculo é `k`. Com a ordem invertida, `-<KELVIN>onta.vercel.app`
    // — que a regex canônica RECUSA — virava `-konta.vercel.app`, que ela ACEITA: o processo subiria
    // confiando num host DIFERENTE do que está escrito na variável. É a correção silenciosa que esta
    // fatia existe para proibir, só que vinda de dentro.
    const kelvin = "-\u212Aonta.vercel.app";
    expect(FORMATO_SUFIXO_DE_PREVIEW.test(kelvin), "a regex sozinha já recusa").toBe(false);
    expect(() => sufixosDePreview(kelvin), "e o parser NÃO pode desfazer essa recusa").toThrow(SufixoDePreviewInvalido);
    expect(() => startup(kelvin)).toThrow(/WEB_ORIGIN_PREVIEW_SUFFIX inválido/);
    // Invisível no MEIO do valor também reprova (nas bordas o `trim` resolve, e isso é identidade).
    for (const ruim of ["-con\u200Bta.vercel.app", "-con\u00ADta.vercel.app", "-cont\u0430.vercel.app"]) {
      expect(() => sufixosDePreview(ruim), JSON.stringify(ruim)).toThrow(SufixoDePreviewInvalido);
    }
    // ASCII legítimo em caixa alta continua passando: a conferência não é xenofobia com maiúscula.
    expect(sufixosDePreview("-CONTA.VERCEL.APP")).toEqual(["-conta.vercel.app"]);
  });
});

/**
 * O LIMITE DECLARADO DA ÂNCORA — o que ela NÃO promete.
 *
 * Um teste que fixa uma limitação conhecida parece estranho até a primeira vez que alguém lê o
 * documento, acredita na promessa larga e desenha em cima dela. A âncora garante "ninguém entra só
 * por ter conta no provedor"; ela NÃO garante "ninguém além de nós consegue um nome que case", porque
 * o rótulo na frente do sufixo é livre e `*.vercel.app` é um namespace global do provedor.
 */
describe("CORS · o que a âncora de conta NÃO garante (limite declarado)", () => {
  it("qualquer rótulo antes do sufixo é aceito — a garantia é sobre o FIM do host, não sobre o começo", () => {
    for (const host of ["umprojetoqualquer", "atacante", "x"]) {
      expect(ehPreviewDoProjeto(`https://${host}${SUFIXO}`, [SUFIXO]), host).toBe(true);
    }
    // O que a âncora DE FATO barra, e que é o motivo de ela existir: o vizinho de provedor.
    expect(permitido("https://atacante.vercel.app", SUFIXO)).toBe(false);
    expect(permitido("https://atacante-outraconta.vercel.app", SUFIXO)).toBe(false);
  });

  it("a limitação está ESCRITA onde quem confia na garantia vai ler", () => {
    // Promessa larga em comentário é pior que ausência de comentário: ela é acreditada.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const lib = fs.readFileSync(path.join(here, "../../src/lib/cors-origem.ts"), "utf8");
    expect(lib, "o limite tem de estar no dono do contrato").toContain("limite declarado");
    expect(lib, "e tem de dizer POR QUE o limite existe").toContain("NAMESPACE GLOBAL");
    // A frase larga só pode aparecer sendo REPUDIADA. Proibi-la por inteiro reprovaria o parágrafo
    // que explica por que ela é falsa — auditor que acusa a própria documentação ensina a apagá-la.
    const usos = lib.split("recusa os de qualquer outra conta").length - 1;
    expect(usos, "a frase larga existe uma vez só, e é a que a desmente").toBe(1);
    expect(lib).toContain('e não "recusa os de qualquer outra conta"');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// C12–C15 · O QUE O SERVIDOR ACEITA COMO ORIGEM
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("CORS · origem de preview", () => {
  it("C13 · ACEITA um preview do projeto, em qualquer branch", () => {
    // O nome muda a cada branch; é exatamente por isso que lista exata não servia.
    for (const host of ["app-git-main", "app-git-4703a4", "controle-de-esto-git-abc123", "x"]) {
      expect(permitido(`https://${host}${SUFIXO}`, SUFIXO), host).toBe(true);
    }
  });

  it("C12 · RECUSA o preview de outra conta do mesmo provedor", () => {
    // O ataque mais barato: o vizinho de provedor. O sufixo carrega a conta, e é isso que o separa.
    expect(permitido("https://app-git-main-outraconta.vercel.app", SUFIXO)).toBe(false);
    expect(permitido("https://qualquercoisa.vercel.app", SUFIXO)).toBe(false);
    expect(permitido("https://app-git-main.vercel.app", SUFIXO)).toBe(false);
  });

  it("C14 · origem exata continua valendo, e continua sendo exata", () => {
    const exatas = ["https://producao.example.com"];
    expect(permitido("https://producao.example.com", undefined, exatas)).toBe(true);
    expect(permitido("https://producao.example.com.atacante.com", undefined, exatas)).toBe(false);
    expect(permitido("http://producao.example.com", undefined, exatas)).toBe(false);
    // E continua valendo junto com o sufixo, sem um anular o outro.
    expect(permitido("https://producao.example.com", SUFIXO, exatas)).toBe(true);
    expect(permitido(`https://app-git-main${SUFIXO}`, SUFIXO, exatas)).toBe(true);
  });

  it("C15 · requisição SEM origem passa — CORS não se aplica a ela", () => {
    // `curl`, health check e chamada servidor-a-servidor não mandam `Origin`. Quem protege aquela
    // porta é a autenticação; recusar aqui quebraria o health check sem ganhar segurança nenhuma.
    expect(permitido(undefined, undefined, [])).toBe(true);
    expect(permitido(undefined, SUFIXO, ["https://producao.example.com"])).toBe(true);
  });

  it("RECUSA domínio de terceiro que só TERMINA parecido", () => {
    // `endsWith` sozinho aceitaria estes. O rótulo sem ponto é o que os barra.
    expect(permitido(`https://atacante.com${SUFIXO}`, SUFIXO)).toBe(false);
    expect(permitido(`https://sub.dominio${SUFIXO}`, SUFIXO)).toBe(false);
    expect(permitido(`https://a.b${SUFIXO}`, SUFIXO)).toBe(false);
  });

  it("RECUSA o sufixo sozinho, sem rótulo na frente", () => {
    expect(permitido(`https://${SUFIXO}`, SUFIXO)).toBe(false);
    expect(permitido(`https://${SUFIXO.slice(1)}`, SUFIXO)).toBe(false);
  });

  it("RECUSA texto claro, porta e credencial embutida na ORIGEM", () => {
    expect(permitido(`http://app-git-main${SUFIXO}`, SUFIXO), "http:// nunca").toBe(false);
    expect(permitido(`https://app-git-main${SUFIXO}:8080`, SUFIXO), "porta").toBe(false);
    expect(permitido(`https://usuario@app-git-main${SUFIXO}`, SUFIXO), "credencial embutida").toBe(false);
    expect(permitido(`https://app-git-main${SUFIXO}/caminho`, SUFIXO), "caminho").toBe(false);
  });

  it("RECUSA o sufixo aparecendo no MEIO da origem", () => {
    expect(permitido(`https://app${SUFIXO}.atacante.com`, SUFIXO)).toBe(false);
    expect(permitido(`https://app${SUFIXO}.evil`, SUFIXO)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// GUARDRAILS ESTRUTURAIS — o que impede esta suíte de virar decoração
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("CORS · guardrail do servidor", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const leia = (p: string) => fs.readFileSync(path.join(here, p), "utf8");
  const src = leia("../../src/server.ts");
  const cfg = leia("../../src/config.ts");
  const lib = leia("../../src/lib/cors-origem.ts");

  it("o registro do CORS usa a política, e não uma lista montada na mão", () => {
    // Se alguém reintroduzir o `split` direto no `origin`, os testes acima passariam e o servidor
    // real voltaria a ignorá-los. Este guardrail é o que impede a suíte de ficar decorativa.
    expect(src).toContain("politicaDeOrigem(");
    expect(src).not.toMatch(/origin:\s*config\.WEB_ORIGIN\.split/);
  });

  it("o servidor entrega o valor BRUTO à política — não existe caminho para uma lista não verificada", () => {
    // `politicaDeOrigem` valida por dentro. Passar o bruto é o que torna impossível construir a
    // política a partir de sufixos que ninguém conferiu — inclusive em quem monta `Config` à mão.
    expect(src).toContain("politicaDeOrigem(config.WEB_ORIGIN.split(\",\"), config.WEB_ORIGIN_PREVIEW_SUFFIX)");
    expect(src, "a normalização silenciosa da R0 não pode voltar").not.toContain("normalizarSufixos");
  });

  it("`loadConfig` é obrigado a conferir o sufixo — a validação não mora só no casador", () => {
    // Validar apenas em `ehPreviewDoProjeto` deixaria a app SUBIR com configuração genérica, e uma
    // fronteira que só reage na primeira requisição já perdeu: o processo está de pé e servindo.
    expect(cfg).toContain("sufixosDePreview");
    expect(cfg).toMatch(/WEB_ORIGIN_PREVIEW_SUFFIX[\s\S]{0,400}superRefine/);
  });

  it("o formato canônico é declarado UMA vez, e exige a âncora da conta", () => {
    // Duas cópias da regra envelhecem em sentidos opostos, e a mais frouxa acaba valendo.
    const ocorrencias = (texto: string) => (texto.match(/\^-\[a-z0-9\]/g) ?? []).length;
    // Esta contagem casa TEXTO, e é deliberadamente frágil quanto à grafia: se você reescreveu a
    // regex (outra classe, `new RegExp`, escape diferente), este teste reprova — e o conserto é
    // atualizar o padrão daqui DEPOIS de conferir que não nasceu uma segunda cópia da regra.
    expect(ocorrencias(lib), "a regex canônica mora só em cors-origem.ts — uma segunda cópia envelheceria em silêncio").toBe(1);
    expect(ocorrencias(src) + ocorrencias(cfg), "nenhuma cópia fora do dono: server e config CONSOMEM a regra, não a redeclaram").toBe(0);
    // A âncora não é opcional: sem o hífen inicial, a raiz do provedor passaria.
    expect(FORMATO_SUFIXO_DE_PREVIEW.test(".vercel.app")).toBe(false);
    expect(FORMATO_SUFIXO_DE_PREVIEW.test("-conta.vercel.app")).toBe(true);
  });

  it("nenhum curinga de provedor foi deixado no servidor", () => {
    expect(src).not.toMatch(/["'`]\*["'`]/);
    expect(src).not.toMatch(/\*\.vercel\.app/);
  });
});
