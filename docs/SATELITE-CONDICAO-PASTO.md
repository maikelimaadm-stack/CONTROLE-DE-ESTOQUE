# Mapa integrado de condição do pasto

Decisão **302** (SAT-COND-01) + correção espacial **MAPA-UX-02**. Experiência padrão do Mapa geral: **uma classificação categórica**, não um índice científico.

O produtor não escolhe NDVI, EVI2, NDRE, NDMI, MSAVI2 ou BSI para entender o pasto. Esses sinais entram juntos, na **mesma observação**, e saem como um mapa de classes mutuamente exclusivas com hectares estimados.

## Objetivo

Responder, com um clique (fluxo **Analisar pastos** em lote):

- onde a vegetação está ativa e com boa cobertura;
- onde a cobertura é moderada ou baixa;
- onde há possível estresse hídrico (NDMI);
- onde o solo aparece exposto (estimativa espectral);
- onde há água (SCL);
- onde não foi possível ler **dentro** do pasto;
- quanto isso representa em hectares e em %.

## Bug corrigido em MAPA-UX-02 — bbox × polígono

A Process API devolve um PNG **retangular** da bbox da grade. Fora do polígono os bytes caíam em classe 0 (SEM_LEITURA), a LUT pintava cinza opaco e o MapLibre estendia a imagem pelos quatro cantos.

**Errado:** retângulo cinza fora da cerca; hectares de “Sem leitura” inflados pela bbox.

**Correto (v2):**

| Conceito | Significado |
|----------|-------------|
| `FORA_DO_POLIGONO` (byte 255) | Não é classe; alpha 0; fora do universo/hectares/% |
| `SEM_LEITURA` (código 0) | Somente pixel **dentro** do polígono sem qualidade/dado |

Máscara geométrica: centro do pixel na grade EPSG:3857, anel externo menos furos. Contagem usa só máscara=1. PNG armazenado já com 255 fora.

## Versão operacional

| Peça | Valor |
|------|--------|
| Classificador corrente | `condicao-pasto-v2` |
| Classificador legado | `condicao-pasto-v1` (histórico; resumo espacial incorreto; **não** reaproveitar) |
| Evalscript espectral | `condicao-pasto-v1` (thresholds iguais — v2 não muda a ciência) |
| Resolução analítica efetiva | **20 m** |
| Saída Process API | PNG UINT8; 0..6 classes; 255 = fora |
| Renderização de classes | `nearest` no dado; apresentação por **zonas** (contornos), sem grade |

Documentação da v2: corrige máscara geométrica; regras espectrais permanecem as da v1.

Trocar classificador, evalscript, geometria, data ou resolução **invalida** o mapa anterior (chave de cache).

## Classes (mutuamente exclusivas)

| Código | Id | Nome na UI | Cor |
|--------|-----|------------|-----|
| 0 | `sem_leitura` | Sem leitura | `#E0E0E0` (alpha baixo) |
| 1 | `vegetacao_ativa_boa_cobertura` | Vegetação ativa · boa cobertura | `#1B5E20` |
| 2 | `vegetacao_ativa_cobertura_moderada` | Vegetação ativa · cobertura moderada | `#7CB342` |
| 3 | `baixa_cobertura` | Baixa cobertura | `#F9A825` |
| 4 | `possivel_estresse_hidrico` | Possível estresse hídrico | `#EF6C00` |
| 5 | `solo_exposto_estimado` | Solo exposto estimado | `#BF360C` |
| 6 | `agua` | Água | `#1565C0` |
| 255 | — | Fora do polígono | transparente |

SSOT: `packages/domain/src/condicao-pasto.ts`.

## Combinação dos sinais

| Grupo | Índices |
|-------|---------|
| Cobertura | MSAVI2 + BSI |
| Vigor | EVI2 + NDRE + NDVI |
| Umidade | NDMI |
| Qualidade | SCL + dataMask |

Precedência fail-closed: Sem leitura → Água → Solo → Estresse → Baixa → Moderada → Boa.

## Thresholds

Heurísticas espectrais **v1** (não alteradas na v2). Evalscript interpola `LIMIARES_CLASSIFICADOR_CONDICAO_PASTO`.

## Identidade e persistência

Identidade: organização + empresa + área + `geometria_sha256` + data + versão classificador + versão evalscript + resolução + fonte.

Tabelas `erp.satelite_mapas_condicao` (+ arquivos). Sem `analise_id`. Migration `0059` (trava `(2026,93)`). Imutável. Mapas v1 **não** são apagados nem atualizados; a listagem operacional filtra a versão corrente v2.

Hectares: maior resto sobre o **universo interno**; soma ≈ `area_total_ha`. Campo opcional `pixels_fora_poligono` só auditoria.

## Dado vs apresentação

- **Dado analítico:** pixels categóricos 20 m (estatística, auditoria).
- **Apresentação:** zonas/contornos derivados dos pixels, clipados ao polígono; suavização visual ≤ ~10 m se ativa; nunca altera contagens.

## Rotas

- `POST /api/satelite/areas/:areaId/condicao-pasto` — gera/reaproveita v2 via serviço interno `lib/satelite/gerar-mapa-condicao.ts`.
- `GET /api/satelite/areas/:areaId/condicao-pasto` — mapa v2 gravado.
- `GET /api/mapa/condicao-pasto?area_ids=` — listagem v2 (filtra `versao_classificador` corrente; não gera). 404 = rota ausente (API anterior).
- `GET /api/mapa/condicao-pasto/:mapaId/arquivo?t=` — PNG.

## UI (MAPA-UX-02 + MAPA-UX-03)

- CTA principal: **Analisar pastos** — default fixo **Todos os pastos** (nunca área aberta nem viewport).
- Modal 3 etapas: seleção → prévia inequívoca → progresso; Opções avançadas fechadas.
- Popup **central** da área e da classe (não painel lateral); sem Analisar/Gerar por área.
- Lista compacta; rótulos só hover/selecionada.
- Apresentação principal: **zonas** GeoJSON (fill-antialias); PNG categórico fica como fallback de baixa opacidade.
- Índices em **Dados técnicos**.
- Após consulta em lote com observação útil: gerar/reutilizar mapa v2 automaticamente (mesmo serviço da rota).
- Estado estável: resumo conhecido ≠ raster do viewport; stale-while-revalidate (resultado não some no refresh); barra de status recupera consulta viva via `GET /api/satelite/consultas`.
- Capacidade: `GET /api/satelite/capacidade` → `{ fila_disponivel, copernicus_disponivel }` (sem secrets). Worker off não finge processamento.

## Worker

`SATELITE_WORKER_ENABLED` permanece desligado por padrão (config; sem mudança de variável Railway nesta fatia). Quando ligado (com Copernicus e credencial), após item `pastagem-essencial-v2` concluir com observação útil o executor chama, em best-effort, `gerarOuReutilizarMapaCondicao` / `tentarGerarMapaCondicaoAposPastagem`. Falha do mapa **não** falha o item estatístico — só log `warn`.

## Reversão

Listagem só v2; v1 fica no banco. Remover a experiência padrão devolve o modo técnico.
