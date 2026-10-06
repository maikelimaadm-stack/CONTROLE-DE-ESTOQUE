# Mapa integrado de condição do pasto

Decisão **302**. Experiência padrão do Mapa geral: **uma classificação categórica**, não um índice científico.

O produtor não escolhe NDVI, EVI2, NDRE, NDMI, MSAVI2 ou BSI para entender o pasto. Esses sinais entram juntos, na **mesma observação**, e saem como um mapa de classes mutuamente exclusivas com hectares estimados.

## Objetivo

Responder, com um clique:

- onde a vegetação está ativa e com boa cobertura;
- onde a cobertura é moderada ou baixa;
- onde há possível estresse hídrico (NDMI);
- onde o solo aparece exposto (estimativa espectral);
- onde há água (SCL);
- onde não foi possível ler;
- quanto isso representa em hectares e em %.

## O que isto não é

Não é biomassa, kg MS/ha, lotação, espécie de capim, praga, doença, invasora confirmada nem diagnóstico agronômico. Vegetação detectada **não** é capim. Hectares por classe são **estimados** pela proporção de pixels classificados — não substituem o cadastro.

## Versão

| Peça | Valor |
|------|--------|
| Classificador | `condicao-pasto-v1` |
| Evalscript | `condicao-pasto-v1` |
| Resolução analítica efetiva | **20 m** (NDRE, NDMI e BSI nativos em 20 m) |
| Saída Process API | PNG UINT8, 1 banda, 0..6 (0 = nodata / sem leitura) |
| Renderização | `nearest` (nunca linear/suavizado para classes) |

Trocar classificador, evalscript, geometria, data ou resolução **invalida** o mapa anterior.

## Classes (mutuamente exclusivas)

| Código | Id | Nome na UI | Cor |
|--------|-----|------------|-----|
| 0 | `sem_leitura` | Sem leitura | `#9E9E9E` |
| 1 | `vegetacao_ativa_boa_cobertura` | Vegetação ativa · boa cobertura | `#1B5E20` |
| 2 | `vegetacao_ativa_cobertura_moderada` | Vegetação ativa · cobertura moderada | `#7CB342` |
| 3 | `baixa_cobertura` | Baixa cobertura | `#F9A825` |
| 4 | `possivel_estresse_hidrico` | Possível estresse hídrico | `#EF6C00` |
| 5 | `solo_exposto_estimado` | Solo exposto estimado | `#BF360C` |
| 6 | `agua` | Água | `#1565C0` |

SSOT: `packages/domain/src/condicao-pasto.ts`. Evalscript, API, UI e testes consomem daqui.

## Combinação dos sinais

| Grupo | Índices |
|-------|---------|
| Cobertura | MSAVI2 + BSI |
| Vigor | EVI2 + NDRE + NDVI |
| Umidade | NDMI |
| Qualidade | SCL + dataMask |

Precedência fail-closed (a primeira regra que casa vence):

1. Sem leitura (`dataMask ≠ 1`, SCL fora de `[2,4,5,7]`, índice não finito)
2. Água (SCL = 6)
3. Solo exposto estimado
4. Possível estresse hídrico
5. Baixa cobertura
6. Vegetação ativa · cobertura moderada
7. Vegetação ativa · boa cobertura

Água nunca vira solo. Pixel mascarado nunca vira classe produtiva. Solo não é reclassificado como estresse.

Água nesta versão usa **só SCL**. Corpos pequenos ou mistos podem não aparecer — limitação documentada, sem NDWI/MNDWI nesta fatia.

## Thresholds

Heurísticas espectrais **v1**, não calibração agronômica. Reusam `LIMIARES_COBERTURA_EXPERIMENTAL` quando aplicável; os demais estão nomeados em `LIMIARES_CLASSIFICADOR_CONDICAO_PASTO`. O evalscript **interpola** esses valores — não redigita números.

## Identidade e persistência

Identidade: organização + empresa + área + `geometria_sha256` + data da imagem + versão do classificador + versão do evalscript + resolução + fonte Sentinel-2 L2A.

Tabelas dedicadas (`erp.satelite_mapas_condicao` + `erp.satelite_mapas_condicao_arquivos`): a classificação combina seis índices da mesma observação. Apontar `analise_id` para um NDVI mentiria sobre a origem. Migration `0059` (trava `(2026,93)`). RLS `tenant_e_empresa` (módulo pecuária). Imutável (UPDATE/DELETE recusados). Sem DELETE de dado de produção.

Todos os sinais do pixel vêm da **mesma** janela `observacao_inicio`..`observacao_fim`. Misturar NDVI de um dia com NDMI de outro é proibido.

## Rotas

- `POST /api/satelite/areas/:areaId/condicao-pasto` — gera ou reaproveita o mapa da observação útil do bundle `pastagem-essencial-v2` (exige análise NDVI desse método no contorno atual). Sem transação aberta durante HTTP externo.
- `GET /api/satelite/areas/:areaId/condicao-pasto` — o mapa já gravado (404 se não).
- `GET /api/mapa/condicao-pasto?area_ids=` — listagem operacional (não gera).
- `GET /api/mapa/condicao-pasto/:mapaId/arquivo?t=` — PNG pela URL assinada (a redação do token também cobre este caminho).

Hectares: método do maior resto; a soma das áreas estimadas fecha a área total (2 casas); percentuais somam 100,0 (1 casa).

## UI

Mapa geral abre em **Condição**. Barra: data, opacidade, Atualizar condição, Dados técnicos. Sem família, índice ou Pixel/Área na experiência padrão.

- Legenda interativa: ha e %; clique destaca a classe; segundo clique ou ESC limpa.
- Lista: badge da condição (atenção se solo+estresse+baixa ≥ 15%); ordenação por atenção/nome/área/classe.
- Zoom distante: cor predominante por área. Zoom adequado: raster categórico (viewport, teto 60, abort).
- Dados técnicos: índices individuais, painel Condição da Área (SATÉLITE COMPLETO), paletas contínuas.

## Worker

`SATELITE_WORKER_ENABLED` permanece desligado por padrão. Lote operacional é etapa separada, depois de Statistical API real comprovada.

## Reversão

Remover a experiência padrão devolve o Mapa geral ao modo técnico (famílias/índices). As tabelas `0059` ficam; mapas já gravados não são apagados.
