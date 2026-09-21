import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ehPreviewDoProjeto, normalizarSufixos, politicaDeOrigem } from "../../src/lib/cors-origem.js";

/**
 * A superfície que esta suíte protege é pequena e perigosa: quem entra, entra AUTENTICADO
 * (`credentials: true`). Por isso os casos abaixo são, em maioria, tentativas de PASSAR — o teste
 * que vale aqui é o que prova a recusa, não o que prova a aceitação.
 */

/** Sufixo de exemplo, no formato que a Vercel gera: hífen + identificador da conta + domínio. */
const SUFIXO = "-contadoprojeto.vercel.app";
const SUFIXOS = [SUFIXO];

/** Ajuda a ler as tabelas: devolve o veredito da política, e não só do casador de sufixo. */
function permitido(origem: string | undefined, sufixos: readonly string[] = SUFIXOS, exatas: readonly string[] = []): boolean {
  let r: boolean | null = null;
  politicaDeOrigem(exatas, sufixos)(origem, (_e, ok) => { r = ok; });
  if (r === null) throw new Error("a política não respondeu — callback nunca chamado");
  return r;
}

describe("CORS · origem de preview", () => {
  it("ACEITA um preview do projeto, em qualquer branch", () => {
    // O nome muda a cada branch; é exatamente por isso que lista exata não servia.
    for (const host of ["app-git-main", "app-git-4703a4", "controle-de-esto-git-abc123", "x"]) {
      expect(permitido(`https://${host}${SUFIXO}`), host).toBe(true);
    }
  });

  it("FAIL-CLOSED: sem sufixo declarado, nenhum preview passa", () => {
    // A ausência de configuração é o estado de quem ainda não decidiu — e não decidir nunca libera.
    expect(permitido(`https://app-git-main${SUFIXO}`, [])).toBe(false);
    expect(ehPreviewDoProjeto(`https://app-git-main${SUFIXO}`, [])).toBe(false);
    expect(normalizarSufixos(undefined)).toEqual([]);
    expect(normalizarSufixos("")).toEqual([]);
  });

  it("RECUSA o preview de outra conta do mesmo provedor", () => {
    // O ataque mais barato: o vizinho de provedor. O sufixo carrega a conta, e é isso que o separa.
    expect(permitido("https://app-git-main-outraconta.vercel.app")).toBe(false);
    expect(permitido("https://qualquercoisa.vercel.app")).toBe(false);
  });

  it("RECUSA domínio de terceiro que só TERMINA parecido", () => {
    // `endsWith` sozinho aceitaria estes. O rótulo sem ponto é o que os barra.
    expect(permitido(`https://atacante.com${SUFIXO}`)).toBe(false);
    expect(permitido(`https://sub.dominio${SUFIXO}`)).toBe(false);
    expect(permitido(`https://a.b${SUFIXO}`)).toBe(false);
  });

  it("RECUSA o sufixo sozinho, sem rótulo na frente", () => {
    expect(permitido(`https://${SUFIXO}`)).toBe(false);
    expect(permitido(`https://${SUFIXO.slice(1)}`)).toBe(false);
  });

  it("RECUSA texto claro, porta e credencial embutida", () => {
    expect(permitido(`http://app-git-main${SUFIXO}`), "http:// nunca").toBe(false);
    expect(permitido(`https://app-git-main${SUFIXO}:8080`), "porta").toBe(false);
    expect(permitido(`https://usuario@app-git-main${SUFIXO}`), "credencial embutida").toBe(false);
    expect(permitido(`https://app-git-main${SUFIXO}/caminho`), "caminho").toBe(false);
  });

  it("RECUSA o sufixo aparecendo no MEIO da origem", () => {
    expect(permitido(`https://app${SUFIXO}.atacante.com`)).toBe(false);
    expect(permitido(`https://app${SUFIXO}.evil`)).toBe(false);
  });

  it("origem exata continua valendo, e continua sendo exata", () => {
    const exatas = ["https://producao.example.com"];
    expect(permitido("https://producao.example.com", [], exatas)).toBe(true);
    expect(permitido("https://producao.example.com.atacante.com", [], exatas)).toBe(false);
    expect(permitido("http://producao.example.com", [], exatas)).toBe(false);
  });

  it("requisição SEM origem passa — CORS não se aplica a ela", () => {
    // `curl`, health check e chamada servidor-a-servidor não mandam `Origin`. Quem protege aquela
    // porta é a autenticação; recusar aqui quebraria o health check sem ganhar segurança nenhuma.
    expect(permitido(undefined, [], [])).toBe(true);
  });

  it("normaliza espaço, caixa e `https://` colado por engano na variável", () => {
    expect(normalizarSufixos(` -A.VERCEL.APP , -b.vercel.app `)).toEqual(["-a.vercel.app", "-b.vercel.app"]);
    expect(normalizarSufixos("https://-c.vercel.app")).toEqual(["-c.vercel.app"]);
    expect(permitido("https://APP-GIT-MAIN-CONTADOPROJETO.VERCEL.APP")).toBe(true);
  });

  it("vários sufixos convivem, e cada um continua ancorado", () => {
    const dois = ["-conta-a.vercel.app", "-conta-b.vercel.app"];
    expect(permitido("https://app-conta-a.vercel.app", dois)).toBe(true);
    expect(permitido("https://app-conta-b.vercel.app", dois)).toBe(true);
    expect(permitido("https://app-conta-c.vercel.app", dois)).toBe(false);
    expect(permitido("https://x.y-conta-a.vercel.app", dois)).toBe(false);
  });
});

describe("CORS · guardrail do servidor", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, "../../src/server.ts"), "utf8");

  it("o registro do CORS usa a política, e não uma lista montada na mão", () => {
    // Se alguém reintroduzir o `split` direto no `origin`, os testes acima passariam e o servidor
    // real voltaria a ignorá-los. Este guardrail é o que impede a suíte de ficar decorativa.
    expect(src).toContain("politicaDeOrigem(");
    expect(src).not.toMatch(/origin:\s*config\.WEB_ORIGIN\.split/);
  });

  it("nenhum curinga de provedor foi deixado no servidor", () => {
    expect(src).not.toMatch(/["'`]\*["'`]/);
    expect(src).not.toMatch(/\*\.vercel\.app/);
  });
});
