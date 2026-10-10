import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * MAPA-MANEJO-04 (F2) — guarda estática da barra de controles do mapa operacional (o comportamento no navegador é do
 * E2E). O arquivo .tsx importa `@/…`, que o vitest daqui (ambiente node, sem alias) não resolve: por isso o fonte é
 * lido como texto, como nos outros testes de UI desta pasta.
 */

const barra = readFileSync(resolve(__dirname, "barra-do-mapa-operacional.tsx"), "utf8");
const opcoes = readFileSync(resolve(__dirname, "use-filtros-do-mapa.ts"), "utf8");

/** Fonte sem comentários (o texto explicativo cita nomes que o código não pode usar). */
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const codigoDaBarra = semComentarios(barra);
const codigoDasOpcoes = semComentarios(opcoes);

/** Cada abertura `<Tag …>` do JSX, até o `>` que fecha a tag (atravessa `{…}` e aspas — `=>` não fecha). */
function aberturas(fonte: string, tag: string): string[] {
  const achadas: string[] = [];
  const re = new RegExp(`<${tag}\\b`, "g");
  for (let m = re.exec(fonte); m; m = re.exec(fonte)) {
    let chaves = 0;
    let aspas: string | null = null;
    let i = m.index + 1;
    for (; i < fonte.length; i++) {
      const c = fonte[i];
      if (aspas) { if (c === aspas) aspas = null; continue; }
      if (c === '"' || c === "'" || c === "`") aspas = c;
      else if (c === "{") chaves++;
      else if (c === "}") chaves--;
      else if (c === ">" && chaves === 0) break;
    }
    achadas.push(fonte.slice(m.index, i + 1));
  }
  return achadas;
}

describe("MM4 — barra de controles do mapa operacional", () => {
  it("todo Button e NativeSelect tem o alvo de toque de 44 px (que vence a altura das classes do botão e do campo)", () => {
    expect(codigoDaBarra).toContain('const ALVO_DE_TOQUE = "!min-h-11 sm:!min-h-0";');
    const controles = [...aberturas(codigoDaBarra, "Button"), ...aberturas(codigoDaBarra, "NativeSelect")];
    expect(controles.length).toBe(3); // alternador de camada, "Minha localização" e o select de filtro
    for (const c of controles) expect(c, c).toMatch(/className=\{(?:ALVO_DE_TOQUE|cn\(ALVO_DE_TOQUE\b)/);
    // os botões do SeletorDeBase (compartilhado, não mudado) ganham os 44 px pelo contêiner
    expect(codigoDaBarra).toContain('"[&_button]:min-h-11 sm:[&_button]:min-h-0"');
    expect(codigoDaBarra).toMatch(/<div className=\{ALVO_DE_TOQUE_DO_SELETOR_DE_BASE\}[^>]*>\s*<SeletorDeBase /);
  });

  it("liga/desliga com aria-pressed e os testids combinados", () => {
    const [alternador] = aberturas(codigoDaBarra, "Button");
    expect(alternador).toContain("aria-pressed={ligado}");
    for (const t of ["camada-lotes", "camada-objetos", "camada-rotulos"]) expect(codigoDaBarra).toContain(`testId="${t}"`);
    for (const t of ["filtro-retiro", "filtro-modulo"]) expect(codigoDaBarra).toContain(`testId="${t}"`);
    expect(codigoDaBarra).toContain('<option value="">Todos</option>');
  });

  it("filtro: só os campos que a rota aceita, o objeto inteiro de volta, Todos = null", () => {
    expect(codigoDaBarra).toContain('mudarFiltro("retiro_id", id)');
    expect(codigoDaBarra).toContain('mudarFiltro("grazing_module_id", id)');
    expect(codigoDaBarra).toContain("aoMudarFiltros({ ...filtros, [campo]: id })");
    expect(codigoDaBarra).toContain('e.target.value === "" ? null : e.target.value');
  });

  it("reusa o SeletorDeBase e o GeolocateControl que já existem — nada duplicado", () => {
    expect(codigoDaBarra).toMatch(/import \{ SeletorDeBase, type MapaBase \} from "\.\/mapa-base";/);
    expect(codigoDaBarra).not.toMatch(/GeolocateControl|navigator\.geolocation|import\("maplibre-gl"\)/);
    expect(codigoDaBarra).toContain('querySelector<HTMLButtonElement>("button.maplibregl-ctrl-geolocate")');
  });

  it("camadas: lotes e objetos pelo mostrarGrupo da camada; rótulos ficam com a tela (DOM)", () => {
    expect(codigoDaBarra).toContain('mostrarGrupo(m, "lotes", camadas.lotes);');
    expect(codigoDaBarra).toContain('mostrarGrupo(m, "objetos", camadas.objetos);');
    expect(codigoDaBarra).toContain("CAMADAS_INICIAIS: CamadasVisiveis = { lotes: true, objetos: true, rotulos: true }");
  });

  it("opções dos filtros: as duas listagens, uma vez — a chave não tem os filtros", () => {
    expect(codigoDasOpcoes).toContain("`/api/resources/retiros${qs({ pageSize: 200 })}`");
    expect(codigoDasOpcoes).toContain("`/api/resources/grazing_modules${qs({ pageSize: 200, sort: \"code\" })}`");
    const chaves = [...codigoDasOpcoes.matchAll(/queryKey: (\[[^\]]*\])/g)].map((m) => m[1]);
    expect(chaves).toEqual([
      '["res", "retiros", "mapa-operacional", empresa]',
      '["res", "grazing_modules", "mapa-operacional", empresa]'
    ]);
    // sem a permissão de leitura do cadastro, a listagem nem é pedida
    expect(codigoDasOpcoes).toContain('const podeRetiros = can("retiros.view");');
    expect(codigoDasOpcoes).toContain('const podeModulos = can("grazing_modules.view");');
    expect(codigoDasOpcoes).toContain("enabled: podeRetiros");
    expect(codigoDasOpcoes).toContain("enabled: podeModulos");
  });

  it("nenhuma regra de negócio, nenhum token novo da casa por nome (catraca do naming-audit)", () => {
    for (const fonte of [barra, opcoes]) {
      expect(fonte).not.toMatch(/\bm[g]-[a-z0-9]/i);
      expect(fonte).not.toMatch(/\/\s*450|usable_area_ha|categorias_misto|shoelace/);
    }
  });
});
