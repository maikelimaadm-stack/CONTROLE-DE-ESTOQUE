import { execFileSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import { expect, type Page } from "@playwright/test";
import { normalizarCategoria } from "@agro/domain";
import { api, empresaAtiva, login, uniq } from "./helpers";

/**
 * AS PEÇAS COMUNS DOS E2E DA MAPA-MANEJO-04 (decisão 308) — a tela do mapa operacional em /mapa-de-manejo.
 *
 * Módulo de apoio (não é spec: aqui não há `test(...)`). Os três specs da fatia importam daqui:
 *   mapa-manejo-04-marcador-painel.spec.ts      (T1)  marcador agregado e painel do pasto
 *   mapa-manejo-04-coloracao-controles.spec.ts  (T2)  coloração, legenda, filtros e controles
 *   mapa-manejo-04-mover-lote.spec.ts           (T3)  mover lote pelo mapa
 *
 * DADO SEMEADO, NUNCA TELA VAZIA. Cada caso cria as PRÓPRIAS áreas (com polígono), lotes, rebanho e configurações de
 * ícone, numa REGIÃO só dele (`regiao`) — longe das áreas do seed (que não têm polígono) e das dos outros casos: o
 * banco de e2e acumula o que cada caso grava (nada é apagado, decisão 247).
 *   - pela API, com a sessão do navegador: área (`/api/resources/areas`), lote com área (`/api/resources/batches` — o
 *     gatilho `trg_batches_fechar_ocupacao` abre a ocupação), rebanho por contagem (`/api/livestock/animals`,
 *     `type: "unidentified"`) e configuração de ícone (`/api/mapa/icones`);
 *   - pelo banco (`sqlMm4`), SÓ o que nenhuma rota escreve: o identificador do lote (`erp.batches.identificador_*`,
 *     migration 0062 — a MAPA-MANEJO-02 não abriu rota de escrita para ele) e a leitura dos ids globais do seed
 *     (espécie e categorias, que a API não lista) e das testemunhas.
 *
 * A TELA SE COMPARA COM A RESPOSTA REAL da API (`abrirMapaOperacional` devolve o corpo que a tela recebeu), nunca com
 * número escrito à mão: o que o teste semeou só serve de PREMISSA da resposta.
 *
 * O MAPA é lido pelo gancho de e2e da tela (`window.__mapaManejoE2E`, o MapLibre):
 *   - `dadosDaFonte`   o GeoJSON EXATO da fonte (`getData()`): um registro por feature, sem a repetição por tile de
 *                      `querySourceFeatures` — é ele que conta marcadores e confere coordenadas;
 *   - `renderizadas`   `queryRenderedFeatures` nas camadas pedidas, com o layout e a pintura AVALIADOS para cada feature
 *                      (o texto do contador e do badge, a imagem do ícone, o tamanho, as cores) — prova do desenho;
 *   - `ordemDasCamadas`, `temImagem`, `projetar`, `desprojetar`, `pontoNaPagina` (clique e arraste com o mouse);
 *   - `clicarNoMapa`   clique do usuário numa posição geográfica, recusando ponto coberto por painel, legenda ou barra.
 *
 * A TELA: `abrirMapaOperacional` / `abrirMapaNasAreas` (abre, enquadra só as áreas do caso e devolve a resposta),
 * `escolherColoracao` (troca o "Colorir por" e devolve a resposta nova), `painelDoPasto`, `proximaRespostaOperacional`
 * e `contarRequisicoes` (chamadas a /api/mapa/operacional no fio). Descanso: `descansarArea` (entra, sai e data a saída).
 *
 * IMAGEM DE ÍCONE: gerada EM TEMPO DE EXECUÇÃO (`pngSolido`: zlib + crc32, PNG RGBA de cor sólida) e servida por
 * `servirIcones` numa origem `.invalid` interceptada pela página. Nenhum arquivo de imagem entra no repositório.
 */

// ------------------------------------------------------------------------------------------------------------------
// Navegador e banco
// ------------------------------------------------------------------------------------------------------------------

/**
 * Opções do navegador para WebGL por software (o MapLibre desenha em WebGL): as MESMAS do mapa-geral.spec.ts. Cada
 * spec chama `test.use(OPCOES_WEBGL)`.
 */
export const OPCOES_WEBGL = {
  launchOptions: {
    ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}),
    args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"]
  }
};

const BANCO = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, "/agro_erp_e2e") ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_e2e";

/** `psql` no banco de e2e (o mesmo de mapa-geral.spec.ts e f10-comum.ts). Só o que nenhuma rota faz — ver o cabeçalho. */
export const sqlMm4 = (c: string) => execFileSync("psql", [BANCO, "-v", "ON_ERROR_STOP=1", "-Atc", c], { encoding: "utf8" }).trim();

/** Literal SQL de texto (aspas simples dobradas) ou `null`. */
export const literalSql = (v: string | null | undefined) => (v === null || v === undefined ? "null" : `'${v.replace(/'/g, "''")}'`);

const FORMA_UUID = /^[0-9a-f-]{36}$/;

/** Entra como o admin do seed e devolve a empresa em que os casos semeiam (a da sessão ou a primeira do contexto). */
export async function entrarComoAdmin(page: Page): Promise<string> {
  await login(page);
  return empresaAtiva(page);
}

// ------------------------------------------------------------------------------------------------------------------
// Geometria (só posição: o centróide que vale é SEMPRE o da API)
// ------------------------------------------------------------------------------------------------------------------

/** [lon, lat] em graus. */
export type Posicao = [number, number];
/** GeoJSON Polygon com um anel fechado (o que `erp.areas.geometria` aceita). */
export interface PoligonoGeo {
  type: "Polygon";
  coordinates: Posicao[][];
}

/** Os três specs da fatia: cada um tem a sua faixa de longitude. */
export type SpecDaFatia = "T1" | "T2" | "T3";
const LONGITUDE_DO_SPEC: Record<SpecDaFatia, number> = { T1: -49, T2: -50, T3: -51 };

/**
 * O canto sudoeste da REGIÃO de um caso: cada spec numa longitude, cada caso 0,05° ao sul do anterior. Uma região
 * comporta uma grade de 6 × 5 áreas de 0,004° com passo de 0,007° — nenhum caso enxerga a área de outro no enquadramento.
 */
export function regiao(spec: SpecDaFatia, caso: number): Posicao {
  return [LONGITUDE_DO_SPEC[spec], -12 - caso * 0.05];
}

/** `origem` deslocada de `dLon`, `dLat` graus. */
export const deslocar = ([lon, lat]: Posicao, dLon: number, dLat = 0): Posicao => [lon + dLon, lat + dLat];

/** Quadrado de `lado` graus com o canto sudoeste em `origem`. */
export function quadrado([lon, lat]: Posicao, lado = 0.004): PoligonoGeo {
  return { type: "Polygon", coordinates: [[[lon, lat], [lon + lado, lat], [lon + lado, lat + lado], [lon, lat + lado], [lon, lat]]] };
}

/**
 * Um L de braço LARGO (o L_LARGO de apps/api/test/integration/mapa-manejo-02-operacional.test.ts, escalado): 10 × 10
 * com braço 4, em décimos de `lado`. O centróide de área cai em (3,875; 3,875) — dentro do L —, enquanto a média dos
 * seis vértices cai em (4,667; 4,667): quem recalculasse o ponto pela média dos vértices erraria por ~0,8 décimo de
 * lado em cada eixo. É a área que torna a reversa R5 observável.
 */
export function emL([lon, lat]: Posicao, lado = 0.006): PoligonoGeo {
  const u = lado / 10;
  const p = (x: number, y: number): Posicao => [lon + x * u, lat + y * u];
  return { type: "Polygon", coordinates: [[p(0, 0), p(10, 0), p(10, 4), p(4, 4), p(4, 10), p(0, 10), p(0, 0)]] };
}

/** Retângulo de `largura` × `altura` graus com o canto sudoeste em `origem`. */
export function retangulo([lon, lat]: Posicao, largura: number, altura: number): PoligonoGeo {
  return { type: "Polygon", coordinates: [[[lon, lat], [lon + largura, lat], [lon + largura, lat + altura], [lon, lat + altura], [lon, lat]]] };
}

/** Triângulo retângulo de catetos `lado` com o ângulo reto em `origem`. */
export function triangulo([lon, lat]: Posicao, lado = 0.004): PoligonoGeo {
  return { type: "Polygon", coordinates: [[[lon, lat], [lon + lado, lat], [lon, lat + lado], [lon, lat]]] };
}

/**
 * MÉDIA DOS VÉRTICES do anel (sem o ponto de fecho). Não é o centróide — é o ERRO que a reversa R5 simula. Só serve
 * à PREMISSA de que o cenário distingue as duas contas (o L afasta uma da outra).
 */
export function mediaDosVertices(g: PoligonoGeo): Posicao {
  const anel = g.coordinates[0] ?? [];
  const pts = anel.length > 1 ? anel.slice(0, -1) : anel;
  const soma = pts.reduce<Posicao>((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]);
  return [soma[0] / pts.length, soma[1] / pts.length];
}

/** Caixa [[oeste, sul], [leste, norte]] dos polígonos. */
export function caixaDe(geometrias: readonly PoligonoGeo[]): [Posicao, Posicao] {
  const pts = geometrias.flatMap((g) => g.coordinates[0] ?? []);
  expect(pts.length, "premissa: há polígono para enquadrar").toBeGreaterThan(0);
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
}

// ------------------------------------------------------------------------------------------------------------------
// Semeadura
// ------------------------------------------------------------------------------------------------------------------

/** Nome da categoria de animal COMO CADASTRADA no seed (`erp.animal_categories`, BEEF_CATEGORIES de packages/db). */
export type CategoriaDoSeed = "Bezerro" | "Bezerra" | "Garrote" | "Novilha" | "Boi Magro" | "Boi Gordo" | "Vaca" | "Touro" | "Matriz";

/** Identificador do lote no marcador (`erp.batches.identificador_*`); campo ausente = nulo. */
export interface IdentificadorPedido {
  nome?: string | null;
  sigla?: string | null;
  cor?: string | null;
}

/** Um lote a semear numa área: as cabeças entram como rebanho por contagem de UMA categoria. */
export interface PedidoDeLote {
  cabecas: number;
  /** padrão "Garrote" */
  categoria?: CategoriaDoSeed;
  identificador?: IdentificadorPedido;
  /** `entry_date` do lote (ISO) = início da ocupação; ausente = o dia de hoje na empresa da área (o gatilho decide). */
  entrada?: string;
}

/** Uma área a semear: polígono, campos extras do cadastro (retiro, módulo, capacidades…) e os lotes nela. */
export interface PedidoDeArea {
  /** parte do nome (o nome final ganha prefixo "MM4" e sufixo único) */
  rotulo: string;
  geometria: PoligonoGeo;
  lotes?: PedidoDeLote[];
  /** campos do cadastro de área além dos padrões (ex.: `retiro_id`, `grazing_module_id`, `usable_area_ha`) */
  campos?: Record<string, unknown>;
}

export interface LoteSemeado {
  id: string;
  descricao: string;
  cabecas: number;
  categoria: CategoriaDoSeed;
}

export interface AreaSemeada {
  id: string;
  nome: string;
  geometria: PoligonoGeo;
  lotes: LoteSemeado[];
  /** soma das cabeças semeadas (PREMISSA da resposta; a tela se compara com a API) */
  cabecas: number;
}

/** Os ids GLOBAIS do seed de pecuária (espécie e categorias), lidos do banco: a API não os lista. */
export function referenciasDaPecuariaMm4(): { especie: string; categoria: (nome: CategoriaDoSeed) => string } {
  const especie = sqlMm4("select id from erp.animal_species where organization_id is null and name = 'Bovinos de Corte'");
  expect(especie, "premissa: o seed tem a espécie Bovinos de Corte").toMatch(FORMA_UUID);
  const cache = new Map<CategoriaDoSeed, string>();
  const categoria = (nome: CategoriaDoSeed) => {
    const lida = cache.get(nome) ?? sqlMm4(`select id from erp.animal_categories where species_id = '${especie}' and name = ${literalSql(nome)}`);
    expect(lida, `premissa: o seed tem a categoria ${nome}`).toMatch(FORMA_UUID);
    cache.set(nome, lida);
    return lida;
  };
  return { especie, categoria };
}

/** Área NOVA com polígono, pela API do cadastro. Padrões: pastagem, ativa, própria, 50 ha (45 úteis). */
export async function criarArea(page: Page, c: { empresa: string; rotulo: string; geometria: PoligonoGeo; campos?: Record<string, unknown> }): Promise<{ id: string; nome: string }> {
  const nome = uniq(`MM4 ${c.rotulo}`);
  const criada = await api<{ id: string }>(page, "POST", "/api/resources/areas", {
    empresa_id: c.empresa, name: nome, land_use: "pastagem", status: "ativa", tenure: "propria", area_ha: "50", usable_area_ha: "45",
    color: "#16a34a", geometria: c.geometria, ...c.campos
  });
  expect(criada.id, `premissa: a área "${nome}" foi criada`).toMatch(FORMA_UUID);
  return { id: criada.id, nome };
}

/**
 * Lote NOVO na área, pela API do cadastro de lotes, com as cabeças em rebanho por contagem (uma categoria). A
 * ocupação aberta nasce do gatilho de `erp.batches` — conferida no banco como premissa.
 */
export async function criarLoteNaArea(page: Page, c: { empresa: string; area: string; lote: PedidoDeLote }): Promise<LoteSemeado> {
  const ref = referenciasDaPecuariaMm4();
  const categoria = c.lote.categoria ?? "Garrote";
  const descricao = uniq("MM4 Lote");
  const criado = await api<{ id: string }>(page, "POST", "/api/resources/batches", {
    empresa_id: c.empresa, batch_date: "2026-09-01", description: descricao, species_id: ref.especie, batch_type: "pasture",
    area_id: c.area, ...(c.lote.entrada ? { entry_date: c.lote.entrada } : {})
  });
  expect(criado.id, `premissa: o lote "${descricao}" foi criado`).toMatch(FORMA_UUID);
  expect(sqlMm4(`select count(*) from erp.ocupacoes_de_area where batch_id = '${criado.id}' and area_id = '${c.area}' and data_fim is null and deleted_at is null`),
    "premissa: o gatilho abriu a ocupação do lote na área").toBe("1");
  if (c.lote.cabecas > 0) {
    await api(page, "POST", "/api/livestock/animals", {
      empresa_id: c.empresa, species_id: ref.especie, category_id: ref.categoria(categoria), batch_id: criado.id, entry_date: "2026-09-01",
      type: "unidentified", quantity: c.lote.cabecas
    });
  }
  expect(sqlMm4(`select coalesce(sum(quantity), 0) from erp.herd_lots where batch_id = '${criado.id}'`), "premissa: o rebanho por contagem do lote").toBe(String(c.lote.cabecas));
  if (c.lote.identificador) definirIdentificador(criado.id, c.lote.identificador);
  return { id: criado.id, descricao, cabecas: c.lote.cabecas, categoria };
}

/**
 * Grava o identificador do lote DIRETO no banco: nenhuma rota escreve `identificador_*` (MAPA-MANEJO-02 criou só as
 * colunas). As CHECKs da 0062 continuam valendo (cor #RRGGBB, sigla de 1 a 4 caracteres).
 */
export function definirIdentificador(loteId: string, i: IdentificadorPedido): void {
  expect(loteId).toMatch(FORMA_UUID);
  sqlMm4(`update erp.batches set identificador_nome = ${literalSql(i.nome)}, identificador_sigla = ${literalSql(i.sigla)}, identificador_cor = ${literalSql(i.cor)}
           where id = '${loteId}'`);
}

/** O dia do BANCO (`current_date`) deslocado de `dias` (negativo = passado), em ISO — a mesma régua do `hoje` da API. */
export const diaDoBanco = (dias = 0) => sqlMm4(`select (current_date + (${Math.trunc(dias)}))::text`);

/** Tira o lote da área pela API do cadastro de lotes (`area_id` nulo): o gatilho fecha a ocupação aberta hoje. */
export async function retirarLoteDaArea(page: Page, loteId: string): Promise<void> {
  await api(page, "PUT", `/api/resources/batches/${loteId}`, { area_id: null });
  expect(sqlMm4(`select count(*) from erp.ocupacoes_de_area where batch_id = '${loteId}' and data_fim is null and deleted_at is null`),
    "premissa: o gatilho fechou a ocupação do lote").toBe("0");
}

/**
 * Leva para o PASSADO a última ocupação FECHADA do lote (entrada `entradaHaDias` e saída `saidaHaDias` dias antes do
 * dia do banco). Direto no banco: nenhuma rota grava saída com data passada (o gatilho fecha no dia de hoje).
 */
export function datarUltimaSaida(loteId: string, c: { saidaHaDias: number; entradaHaDias: number }): void {
  expect(loteId).toMatch(FORMA_UUID);
  expect(c.entradaHaDias, "premissa: a entrada vem antes da saída").toBeGreaterThanOrEqual(c.saidaHaDias);
  sqlMm4(`update erp.ocupacoes_de_area set data_inicio = current_date - ${Math.trunc(c.entradaHaDias)}, data_fim = current_date - ${Math.trunc(c.saidaHaDias)}
           where id = (select id from erp.ocupacoes_de_area where batch_id = '${loteId}' and data_fim is not null and deleted_at is null
                        order by data_fim desc, id desc limit 1)`);
}

/**
 * Deixa a área VAZIA e EM DESCANSO há `dias` dias: um lote entra (API), sai (API) e a saída é datada no passado
 * (banco). `dias = 0` deixa a saída de hoje (descanso de 0 dias — diferente de "sem registro"). Devolve o lote.
 */
export async function descansarArea(page: Page, c: { empresa: string; area: string; dias: number }): Promise<LoteSemeado> {
  const lote = await criarLoteNaArea(page, { empresa: c.empresa, area: c.area, lote: { cabecas: 3 } });
  await retirarLoteDaArea(page, lote.id);
  if (c.dias > 0) datarUltimaSaida(lote.id, { saidaHaDias: c.dias, entradaHaDias: c.dias + 10 });
  return lote;
}

/** Semeia as áreas pedidas, na ordem, com os lotes de cada uma. */
export async function semearAreas(page: Page, empresa: string, pedidos: readonly PedidoDeArea[]): Promise<AreaSemeada[]> {
  const semeadas: AreaSemeada[] = [];
  for (const p of pedidos) {
    const area = await criarArea(page, { empresa, rotulo: p.rotulo, geometria: p.geometria, campos: p.campos });
    const lotes: LoteSemeado[] = [];
    for (const l of p.lotes ?? []) lotes.push(await criarLoteNaArea(page, { empresa, area: area.id, lote: l }));
    semeadas.push({ id: area.id, nome: area.nome, geometria: p.geometria, lotes, cabecas: lotes.reduce((s, l) => s + l.cabecas, 0) });
  }
  return semeadas;
}

// ------------------------------------------------------------------------------------------------------------------
// Configuração de ícone (pela API /api/mapa/icones)
// ------------------------------------------------------------------------------------------------------------------

interface ConfiguracaoDeIconeE2E {
  id: string;
  empresa_id: string;
  tipo_entidade: string;
  categoria: string;
  categorias_misto: string[] | null;
  icone_url: string | null;
  cor_padrao: string | null;
  ativo: boolean;
}

const mesmoConjunto = (a: readonly string[] | null, b: readonly string[] | null) =>
  JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());

async function configuracoesDeLote(page: Page, empresa: string): Promise<ConfiguracaoDeIconeE2E[]> {
  const r = await api<{ itens: ConfiguracaoDeIconeE2E[] }>(page, "GET", "/api/mapa/icones?tipo_entidade=lote&pageSize=1000");
  return (r.itens ?? []).filter((c) => c.empresa_id === empresa);
}

/** Pedido de configuração de ícone de LOTE. `categoria` é o nome do seed (ou "MISTO"); a forma canônica é do domínio. */
export interface PedidoDeIcone {
  empresa: string;
  categoria: CategoriaDoSeed | "MISTO";
  /** só no MISTO: as categorias que ele cobre */
  categoriasMisto?: CategoriaDoSeed[];
  icone_url?: string | null;
  cor_padrao?: string | null;
}

/**
 * Deixa ATIVA a configuração de ícone de lote daquela categoria com a imagem e a cor pedidas — EDITA a que já existe
 * (o banco aceita uma viva por empresa e categoria) ou cria. Devolve o id da configuração.
 */
export async function configurarIcone(page: Page, p: PedidoDeIcone): Promise<string> {
  const categoria = normalizarCategoria(p.categoria);
  const misto = p.categoriasMisto ? p.categoriasMisto.map((c) => normalizarCategoria(c)) : null;
  const existente = (await configuracoesDeLote(page, p.empresa))
    .find((c) => c.categoria === categoria && (categoria !== "MISTO" || mesmoConjunto(c.categorias_misto, misto)));
  const corpo = { icone_url: p.icone_url ?? null, cor_padrao: p.cor_padrao ?? null, ativo: true };
  const salva = existente
    ? await api<ConfiguracaoDeIconeE2E>(page, "PATCH", `/api/mapa/icones/${existente.id}`, corpo)
    : await api<ConfiguracaoDeIconeE2E>(page, "POST", "/api/mapa/icones", {
      empresa_id: p.empresa, tipo_entidade: "lote", categoria, ...(misto ? { categorias_misto: misto } : {}), ...corpo
    });
  expect(salva.id, `premissa: a configuração de ícone de ${categoria} está ativa`).toMatch(FORMA_UUID);
  expect(salva.ativo).toBe(true);
  return salva.id;
}

/** DESATIVA toda configuração de ícone de lote (não-MISTO) da categoria: a área dela fica SEM ícone (`config_id` nulo). */
export async function desativarIcones(page: Page, empresa: string, categoria: CategoriaDoSeed): Promise<void> {
  const canonica = normalizarCategoria(categoria);
  for (const c of await configuracoesDeLote(page, empresa)) {
    if (c.categoria === canonica && c.ativo) await api(page, "PATCH", `/api/mapa/icones/${c.id}`, { ativo: false });
  }
  const vivas = (await configuracoesDeLote(page, empresa)).filter((c) => c.categoria === canonica && c.ativo);
  expect(vivas, `premissa: nenhuma configuração ativa de ${canonica}`).toEqual([]);
}

// ------------------------------------------------------------------------------------------------------------------
// Imagem do ícone: PNG gerado em tempo de execução, servido pela própria página
// ------------------------------------------------------------------------------------------------------------------

/** Origem (inexistente: `.invalid`) das imagens de ícone dos casos. Só a interceptação da página responde por ela. */
export const ORIGEM_DOS_ICONES = "https://icones.e2e.invalid";

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(dados: Buffer): number {
  let c = 0xffffffff;
  for (const b of dados) c = (TABELA_CRC[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function blocoPng(tipo: string, dados: Buffer): Buffer {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tamanho, corpo, crc]);
}

/** PNG RGBA de `largura` × `altura` numa cor sólida, montado em memória (assinatura, IHDR, IDAT com zlib, IEND). */
export function pngSolido(largura: number, altura: number, rgba: [number, number, number, number] = [220, 38, 38, 255]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; // 8 bits por canal
  ihdr[9] = 6; // RGBA
  const linha = Buffer.alloc(1 + largura * 4); // primeiro byte: filtro 0 (nenhum)
  for (let x = 0; x < largura; x++) linha.set(rgba, 1 + x * 4);
  const bruto = Buffer.concat(Array.from({ length: altura }, () => linha));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    blocoPng("IHDR", ihdr),
    blocoPng("IDAT", deflateSync(bruto)),
    blocoPng("IEND", Buffer.alloc(0))
  ]);
}

/** O que a origem dos ícones responde em cada caminho: os bytes de um PNG, ou 404. Caminho fora do mapa = 404. */
export type ImagemServida = Buffer | 404;

/**
 * Serve as imagens de ícone pela página (`page.route` em `ORIGEM_DOS_ICONES`), com CORS aberto como um servidor de
 * imagem público. Chame ANTES de abrir o mapa. `pedidos()` lista os caminhos pedidos (a falha foi exercida de fato).
 */
export async function servirIcones(page: Page, imagens: Record<string, ImagemServida>): Promise<{ pedidos: () => string[] }> {
  const pedidos: string[] = [];
  await page.route(`${ORIGEM_DOS_ICONES}/**`, async (route) => {
    const caminho = new URL(route.request().url()).pathname;
    pedidos.push(caminho);
    const imagem = imagens[caminho];
    const cors = { "access-control-allow-origin": "*" };
    if (imagem === undefined || imagem === 404) {
      await route.fulfill({ status: 404, headers: cors, contentType: "text/plain", body: "imagem inexistente" });
      return;
    }
    await route.fulfill({ status: 200, headers: cors, contentType: "image/png", body: imagem });
  });
  return { pedidos: () => [...pedidos] };
}

// ------------------------------------------------------------------------------------------------------------------
// A resposta de /api/mapa/operacional (o que a tela recebeu)
// ------------------------------------------------------------------------------------------------------------------

/** Lote presente na área, como a API devolve (só o que os testes leem). */
export interface LoteDaApi {
  id: string;
  lote: { id: string; code: string | null; description: string | null };
  cabecas: number;
  ua: string;
  data_inicio: string;
  dias_de_ocupacao: number;
  [campo: string]: unknown;
}

/** Área como a API devolve (os campos que os testes leem; o resto fica acessível pela assinatura de índice). */
export interface AreaDaApi {
  id: string;
  name: string;
  code: string;
  ocupada: boolean;
  lotes: LoteDaApi[];
  cabecas_total: number;
  ua_total: string;
  dias_de_descanso: number | null;
  ua_por_hectare: string | null;
  centroide: { lon: number; lat: number } | null;
  identificador: { misto: false; cor: string; sigla: string; nome: string } | { misto: true } | null;
  icone: { config_id: string | null; categoria: string | null; icone_url: string | null; cor_padrao: string | null; categorias: string[] } | null;
  faixa: { chave: string; rotulo: string; numero: string | number | null; unidade: string | null } | null;
  [campo: string]: unknown;
}

export interface RespostaOperacionalE2E {
  hoje: string;
  coloracao: string;
  capacidades: { objetos: boolean; manejo: boolean; pesagem: boolean; icones: boolean };
  areas: AreaDaApi[];
  objetos: Record<string, unknown>[];
}

/** Caminho da rota que a tela chama. */
export const CAMINHO_OPERACIONAL = "/api/mapa/operacional";

/**
 * A PRÓXIMA resposta 200 de `GET /api/mapa/operacional` que a página receber (chame ANTES da ação que dispara a
 * chamada; aguarde depois). Devolve o corpo e a query pedida.
 */
export async function proximaRespostaOperacional(page: Page): Promise<{ corpo: RespostaOperacionalE2E; query: URLSearchParams }> {
  const r = await page.waitForResponse((x) => x.request().method() === "GET" && new URL(x.url()).pathname === CAMINHO_OPERACIONAL && x.status() === 200,
    { timeout: 30_000 });
  return { corpo: (await r.json()) as RespostaOperacionalE2E, query: new URL(r.url()).searchParams };
}

/**
 * Conta, a partir de agora, as requisições da página para o caminho EXATO (padrão: GET de `/api/mapa/operacional`).
 * `total()` lê a contagem no instante; `urls()` as URLs pedidas, na ordem.
 */
export function contarRequisicoes(page: Page, caminho = CAMINHO_OPERACIONAL, metodo = "GET"): { total: () => number; urls: () => string[] } {
  const urls: string[] = [];
  page.on("request", (r) => { if (r.method() === metodo && new URL(r.url()).pathname === caminho) urls.push(r.url()); });
  return { total: () => urls.length, urls: () => [...urls] };
}

/** A área pelo id na resposta (premissa: ela veio). */
export function areaDaResposta(resposta: RespostaOperacionalE2E, id: string): AreaDaApi {
  const a = resposta.areas.find((x) => x.id === id);
  expect(a, `premissa: a área ${id} veio em /api/mapa/operacional`).toBeTruthy();
  return a!;
}

/** O centróide que a API deu à área (premissa: não nulo). */
export function centroideDaApi(a: AreaDaApi): Posicao {
  expect(a.centroide, `premissa: a API deu centróide à área ${a.name}`).not.toBeNull();
  return [a.centroide!.lon, a.centroide!.lat];
}

// ------------------------------------------------------------------------------------------------------------------
// O mapa (gancho de e2e `window.__mapaManejoE2E`)
// ------------------------------------------------------------------------------------------------------------------

/** O pedaço do MapLibre que os testes usam (tipos só para o TypeScript; o objeto é o mapa da página). */
interface CamadaConsultada {
  id: string;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
}
interface MapaE2E {
  getSource(id: string): { getData?: () => Promise<{ features?: { id?: unknown; geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> | null }[] }> } | undefined;
  getLayer(id: string): unknown;
  getStyle(): { layers: { id: string }[] };
  queryRenderedFeatures(geometria?: unknown, opcoes?: unknown): { layer: CamadaConsultada; properties: Record<string, unknown> | null }[];
  hasImage(id: string): boolean;
  project(ll: [number, number]): { x: number; y: number };
  unproject(p: [number, number]): { lng: number; lat: number };
  getContainer(): HTMLElement;
  getCanvas(): HTMLCanvasElement;
  fitBounds(caixa: [Posicao, Posicao], opcoes: Record<string, unknown>): void;
  isMoving(): boolean;
  loaded(): boolean;
  areTilesLoaded(): boolean;
  getZoom(): number;
}
type JanelaE2E = { __mapaManejoE2E?: MapaE2E };

/** As camadas do marcador agregado e dos objetos de mapa (ids da camada 1 da fatia). */
export const CAMADAS = {
  areasFill: "areas-fill",
  areasContorno: "areas-contorno",
  lotesFallback: "lotes-fallback",
  lotesIcone: "lotes-icone",
  lotesBadge: "lotes-badge",
  objetosFallback: "objetos-de-mapa-fallback",
  objetos: "objetos-de-mapa"
} as const;

/** Espera o mapa da tela existir com as camadas do marcador instaladas. */
export async function mapaPronto(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const m = (window as unknown as JanelaE2E).__mapaManejoE2E;
    return Boolean(m && m.getLayer("areas-fill") && m.getLayer("lotes-icone"));
  }), { message: "o mapa montou com as camadas das áreas e dos lotes", timeout: 30_000 }).toBe(true);
}

/**
 * Abre /mapa-de-manejo e devolve a resposta REAL de /api/mapa/operacional que a tela recebeu (a primeira). Só volta
 * com o mapa pronto.
 */
export async function abrirMapaOperacional(page: Page): Promise<RespostaOperacionalE2E> {
  const resposta = proximaRespostaOperacional(page);
  await page.goto("/mapa-de-manejo");
  await expect(page.getByTestId("mapa-de-manejo")).toBeVisible();
  const { corpo } = await resposta;
  await mapaPronto(page);
  return corpo;
}

/**
 * Abre o mapa, confere que as áreas do caso vieram na resposta, espera os polígonos delas na fonte `areas` e enquadra
 * só elas. Devolve a resposta REAL que a tela recebeu.
 */
export async function abrirMapaNasAreas(page: Page, areas: readonly { id: string; geometria: PoligonoGeo }[], maxZoom = 17,
  folga: FolgaDoEnquadramento = 80): Promise<RespostaOperacionalE2E> {
  const resposta = await abrirMapaOperacional(page);
  for (const a of areas) areaDaResposta(resposta, a.id);
  await aguardarAreasNoMapa(page, areas.map((a) => a.id));
  await enquadrar(page, areas.map((a) => a.geometria), maxZoom, folga);
  return resposta;
}

/**
 * Troca o "Colorir por" da barra (`seletor-coloracao`) e devolve a resposta NOVA de /api/mapa/operacional que a troca
 * pediu (premissa: com `?coloracao=` igual ao modo). O valor é a chave do domínio (`MODOS_DE_COLORACAO`).
 */
export async function escolherColoracao(page: Page, modo: string): Promise<RespostaOperacionalE2E> {
  const proxima = proximaRespostaOperacional(page);
  await page.getByTestId("seletor-coloracao").selectOption(modo);
  const { corpo, query } = await proxima;
  expect(query.get("coloracao"), "a troca pediu a coloração escolhida").toBe(modo);
  expect(corpo.coloracao).toBe(modo);
  return corpo;
}

/** O painel do pasto aberto (`<aside data-testid="painel-do-pasto">`). */
export const painelDoPasto = (page: Page) => page.getByTestId("painel-do-pasto");

/**
 * Número em pt-BR com `casas` decimais fixas, formatado pelo MESMO navegador da tela (o formato de exibição do ERP:
 * `Intl.NumberFormat("pt-BR")` com mínimo = máximo de casas).
 */
export const formatoPtBr = (page: Page, valor: number | string, casas = 0) =>
  page.evaluate(({ valor, casas }) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(Number(valor)), { valor, casas });

/** O GeoJSON EXATO de uma fonte do mapa (`getData`): uma entrada por feature, sem repetição por tile. */
export interface FeatureDaFonte {
  coordenadas: unknown;
  tipo: string;
  propriedades: Record<string, unknown>;
}

export async function dadosDaFonte(page: Page, fonte: string): Promise<FeatureDaFonte[]> {
  return page.evaluate(async (fonte) => {
    const m = (window as unknown as JanelaE2E).__mapaManejoE2E;
    const src = m?.getSource(fonte);
    if (!src?.getData) return [];
    const dados = await src.getData();
    return (dados.features ?? []).map((f) => ({ coordenadas: f.geometry.coordinates, tipo: f.geometry.type, propriedades: f.properties ?? {} }));
  }, fonte);
}

/** Os pontos da fonte `lotes` (o marcador agregado) das áreas pedidas. */
export async function marcadoresNaFonte(page: Page, areaIds: readonly string[]): Promise<FeatureDaFonte[]> {
  const ids = new Set(areaIds);
  return (await dadosDaFonte(page, "lotes")).filter((f) => ids.has(String(f.propriedades["area_id"])));
}

/** Quantos pontos cada área tem na fonte `lotes` (0 para a que não tem). */
export async function marcadoresPorArea(page: Page, areaIds: readonly string[]): Promise<Record<string, number>> {
  const contagem: Record<string, number> = Object.fromEntries(areaIds.map((id) => [id, 0]));
  for (const f of await marcadoresNaFonte(page, areaIds)) {
    const id = String(f.propriedades["area_id"]);
    contagem[id] = (contagem[id] ?? 0) + 1;
  }
  return contagem;
}

/** Espera as áreas pedidas na fonte `areas` (o desenho dos polígonos e o enquadramento inicial da tela já rodaram). */
export async function aguardarAreasNoMapa(page: Page, areaIds: readonly string[]): Promise<void> {
  await expect.poll(async () => {
    const presentes = new Set((await dadosDaFonte(page, "areas")).map((f) => String(f.propriedades["id"])));
    return areaIds.filter((id) => !presentes.has(id));
  }, { message: "as áreas do caso estão na fonte `areas` do mapa", timeout: 20_000 }).toEqual([]);
}

/** Espera o mapa parar (sem movimento, estilo e tiles carregados). */
export async function aguardarMapaParado(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const m = (window as unknown as JanelaE2E).__mapaManejoE2E;
    return Boolean(m && !m.isMoving() && m.loaded() && m.areTilesLoaded());
  }), { message: "o mapa parou e carregou", timeout: 20_000 }).toBe(true);
}

/** Folga do enquadramento em px: igual nos quatro lados, ou por lado (para fugir de painel, legenda e barra). */
export type FolgaDoEnquadramento = number | { top: number; bottom: number; left: number; right: number };

/**
 * Enquadra os polígonos do caso (sem animação) e espera o mapa parar. Chame DEPOIS de `aguardarAreasNoMapa`: o
 * enquadramento inicial da tela (todas as áreas da organização) já rodou e não desfaz este.
 */
export async function enquadrar(page: Page, geometrias: readonly PoligonoGeo[], maxZoom = 17, folga: FolgaDoEnquadramento = 80): Promise<void> {
  const caixa = caixaDe(geometrias);
  await page.evaluate(({ caixa, maxZoom, folga }) => {
    const m = (window as unknown as JanelaE2E).__mapaManejoE2E;
    m?.fitBounds(caixa, { padding: folga, maxZoom, duration: 0 });
  }, { caixa, maxZoom, folga });
  await aguardarMapaParado(page);
}

/**
 * Clica no mapa na posição geográfica (deslocada `dx`, `dy` px na tela), como o usuário: `page.mouse` no ponto da
 * página. Antes, confere que o ponto está DENTRO do contêiner do mapa e que o elemento ali é o canvas (nenhum painel,
 * legenda ou barra por cima) — clique coberto falha alto, com o nome do que cobria.
 */
export async function clicarNoMapa(page: Page, posicao: Posicao, dx = 0, dy = 0): Promise<void> {
  // o mapa inteiro na janela, e o canvas já no tamanho do contêiner (o painel lateral muda a largura e o `resize` é adiado)
  await page.evaluate(() => (window as unknown as JanelaE2E).__mapaManejoE2E?.getContainer().scrollIntoView({ block: "nearest", inline: "nearest" }));
  await expect.poll(() => page.evaluate(() => {
    const m = (window as unknown as JanelaE2E).__mapaManejoE2E;
    if (!m) return false;
    const [canvas, conteiner] = [m.getCanvas().getBoundingClientRect(), m.getContainer().getBoundingClientRect()];
    return Math.abs(canvas.width - conteiner.width) < 1 && Math.abs(canvas.height - conteiner.height) < 1;
  }), { message: "o canvas do mapa acompanhou o tamanho do contêiner" }).toBe(true);
  await aguardarMapaParado(page);
  const p = await pontoNaPagina(page, posicao);
  const alvo = { x: p.x + dx, y: p.y + dy };
  const sobre = await page.evaluate(({ x, y }) => {
    const m = (window as unknown as JanelaE2E).__mapaManejoE2E;
    const el = document.elementFromPoint(x, y);
    if (!m || !el) return "nada";
    if (el === m.getCanvas()) return "canvas";
    return `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[data-testid=${el.getAttribute("data-testid")}]` : ""}`;
  }, alvo);
  expect(sobre, `o ponto do clique (${Math.round(alvo.x)}, ${Math.round(alvo.y)}) está livre sobre o canvas do mapa`).toBe("canvas");
  await page.mouse.click(alvo.x, alvo.y);
}

/** Uma feature DESENHADA, com o layout e a pintura avaliados pelo MapLibre para ela. */
export interface FeatureRenderizada {
  camada: string;
  propriedades: Record<string, unknown>;
  /** `text-field` avaliado (o texto que o mapa escreveu), ou nulo sem texto */
  texto: string | null;
  /** nome da imagem de `icon-image` avaliado; nulo = sem imagem (o MapLibre avalia o nome vazio como nulo) */
  imagem: string | null;
  /** `icon-size` avaliado no zoom atual, ou nulo */
  tamanhoDoIcone: number | null;
  /** `circle-color` avaliado, em #rrggbb, ou nulo */
  corDoCirculo: string | null;
  /** `icon-color` avaliado, em #rrggbb, ou nulo */
  corDoIcone: string | null;
}

/**
 * As features DESENHADAS nas camadas pedidas (camada inexistente é ignorada), na tela inteira ou numa caixa de
 * `raioPx` em volta de `perto` (posição geográfica, projetada pelo próprio mapa).
 */
export async function renderizadas(page: Page, camadas: readonly string[], perto?: { posicao: Posicao; raioPx: number }): Promise<FeatureRenderizada[]> {
  return page.evaluate(({ camadas, perto }) => {
    const m = (window as unknown as JanelaE2E).__mapaManejoE2E;
    if (!m) return [];
    const layers = camadas.filter((id) => m.getLayer(id));
    if (layers.length === 0) return [];
    let caixa: [[number, number], [number, number]] | undefined;
    if (perto) {
      const p = m.project(perto.posicao);
      caixa = [[p.x - perto.raioPx, p.y - perto.raioPx], [p.x + perto.raioPx, p.y + perto.raioPx]];
    }
    const fs = caixa ? m.queryRenderedFeatures(caixa, { layers }) : m.queryRenderedFeatures({ layers });
    const texto = (v: unknown): string | null => {
      if (v === undefined || v === null) return null;
      if (typeof v === "string") return v;
      const secoes = (v as { sections?: { text?: string }[] }).sections;
      return Array.isArray(secoes) ? secoes.map((s) => s.text ?? "").join("") : String(v);
    };
    const imagem = (v: unknown): string | null => {
      if (v === undefined || v === null) return null;
      if (typeof v === "string") return v;
      const nome = (v as { name?: unknown }).name;
      return typeof nome === "string" ? nome : String(v);
    };
    const hex = (v: unknown): string | null => {
      if (v === undefined || v === null) return null;
      const c = v as { r?: number; g?: number; b?: number; a?: number };
      if (typeof c.r !== "number" || typeof c.g !== "number" || typeof c.b !== "number") return String(v);
      const a = typeof c.a === "number" && c.a > 0 ? c.a : 1;
      const h = (x: number) => Math.round((x / a) * 255).toString(16).padStart(2, "0");
      return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
    };
    return fs.map((f) => {
      const layout = f.layer.layout ?? {};
      const paint = f.layer.paint ?? {};
      const tamanho = layout["icon-size"];
      return {
        camada: f.layer.id,
        propriedades: f.properties ?? {},
        texto: texto(layout["text-field"]),
        imagem: imagem(layout["icon-image"]),
        tamanhoDoIcone: typeof tamanho === "number" ? tamanho : null,
        corDoCirculo: hex(paint["circle-color"]),
        corDoIcone: hex(paint["icon-color"])
      };
    });
  }, { camadas: [...camadas], perto: perto ?? null });
}

/** As features desenhadas de UMA área nas camadas pedidas. */
export async function renderizadasDaArea(page: Page, areaId: string, camadas: readonly string[]): Promise<FeatureRenderizada[]> {
  return (await renderizadas(page, camadas)).filter((f) => f.propriedades["area_id"] === areaId);
}

/** Ids das camadas do estilo, de BAIXO para CIMA (a ordem z). */
export const ordemDasCamadas = (page: Page) => page.evaluate(() => (window as unknown as JanelaE2E).__mapaManejoE2E?.getStyle().layers.map((l) => l.id) ?? []);

/** A imagem `id` está registrada no mapa (`hasImage`). */
export const temImagem = (page: Page, id: string) => page.evaluate((id) => Boolean((window as unknown as JanelaE2E).__mapaManejoE2E?.hasImage(id)), id);

/** Zoom atual do mapa. */
export const zoomDoMapa = (page: Page) => page.evaluate(() => (window as unknown as JanelaE2E).__mapaManejoE2E?.getZoom() ?? 0);

/** A posição geográfica projetada pelo mapa, em px do contêiner do mapa. */
export const projetar = (page: Page, posicao: Posicao) => page.evaluate((posicao) => {
  const m = (window as unknown as JanelaE2E).__mapaManejoE2E;
  if (!m) throw new Error("mapa ausente");
  const p = m.project(posicao);
  return { x: p.x, y: p.y };
}, posicao);

/** O ponto em px do contêiner do mapa, de volta em posição geográfica (pela projeção atual). */
export const desprojetar = (page: Page, px: { x: number; y: number }) => page.evaluate((px): Posicao => {
  const m = (window as unknown as JanelaE2E).__mapaManejoE2E;
  if (!m) throw new Error("mapa ausente");
  const ll = m.unproject([px.x, px.y]);
  return [ll.lng, ll.lat];
}, px);

/** Caixa do contêiner do mapa na página (`getBoundingClientRect`). */
export const caixaDoMapa = (page: Page) => page.evaluate(() => {
  const m = (window as unknown as JanelaE2E).__mapaManejoE2E;
  if (!m) throw new Error("mapa ausente");
  const c = m.getContainer().getBoundingClientRect();
  return { x: c.left, y: c.top, largura: c.width, altura: c.height };
});

/** A posição geográfica em coordenadas da PÁGINA (para `page.mouse`): contêiner do mapa + projeção. */
export const pontoNaPagina = (page: Page, posicao: Posicao) => page.evaluate((posicao) => {
  const m = (window as unknown as JanelaE2E).__mapaManejoE2E;
  if (!m) throw new Error("mapa ausente");
  const p = m.project(posicao);
  const caixa = m.getContainer().getBoundingClientRect();
  return { x: caixa.left + p.x, y: caixa.top + p.y };
}, posicao);

/** Distância em px de tela entre duas posições geográficas, pela projeção atual do mapa. */
export async function distanciaEmPx(page: Page, a: Posicao, b: Posicao): Promise<number> {
  const [pa, pb] = [await projetar(page, a), await projetar(page, b)];
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}
