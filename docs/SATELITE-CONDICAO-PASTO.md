# Mapa integrado de condição do pasto

Decisão **302** (SAT-COND-01) + correção espacial **MAPA-UX-02** + classificador **v3** (**SAT-BUNDLE-01A**). Experiência padrão do Mapa geral: **uma classificação categórica**, não um índice científico.

O produtor não escolhe NDVI, EVI2, NDRE, NDMI, MSAVI2 ou BSI para entender o pasto. Esses sinais entram juntos, na **mesma observação**, e saem como um mapa de classes mutuamente exclusivas com hectares estimados.

## Objetivo

Responder, com um clique (fluxo **Analisar áreas** em lote):

- onde a vegetação está ativa e com boa cobertura;
- onde a cobertura é moderada ou baixa;
- onde há possível estresse hídrico (NDMI) — só quando cobertura/vigor bastam;
- onde o solo aparece exposto (estimativa espectral);
- onde há água (SCL);
- onde não foi possível ler **dentro** do pasto;
- quanto isso representa em hectares e em %.

## Bug corrigido em MAPA-UX-02 — bbox × polígono

A Process API devolve um PNG **retangular** da bbox da grade. Fora do polígono os bytes caíam em classe 0 (SEM_LEITURA), a LUT pintava cinza opaco e o MapLibre estendia a imagem pelos quatro cantos.

**Correto (desde v2; mantido em v3):**

| Conceito | Significado |
|----------|-------------|
| `FORA_DO_POLIGONO` (byte 255) | Não é classe; alpha 0; fora do universo/hectares/% |
| `SEM_LEITURA` (código 0) | Somente pixel **dentro** do polígono sem qualidade/dado |

## Versão operacional

| Peça | Valor |
|------|--------|
| Classificador corrente | `condicao-pasto-v3` |
| Classificador histórico | `condicao-pasto-v2` (estresse antes de baixa cobertura) |
| Classificador legado | `condicao-pasto-v1` (resumo espacial incorreto; **não** reaproveitar) |
| Evalscript espectral | `condicao-pasto-v3` (precedência alinhada ao classificador) |
| Resolução analítica efetiva | **20 m** |
| Saída Process API | PNG UINT8; 0..6 classes; 255 = fora |

Trocar classificador, evalscript, geometria, data ou resolução **invalida** o mapa anterior (chave de cache). Forward-only: nada apaga v1/v2.

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

### Precedência v3 (conservadora)

1. SEM_LEITURA  
2. ÁGUA  
3. SOLO_EXPOSTO  
4. BAIXA_COBERTURA  
5. POSSÍVEL_ESTRESSE_HÍDRICO  
6. COBERTURA_MODERADA  
7. BOA_COBERTURA  

Estresse hídrico **não** é classe-curinga: exige cobertura suficiente (`MSAVI2 ≥ moderada`) **e** vigor corroborado **e** NDMI abaixo do limiar. Baixa cobertura + NDMI baixo → baixa cobertura, não estresse.

## Thresholds

Heurísticas espectrais experimentais em `LIMIARES_CLASSIFICADOR_CONDICAO_PASTO`. Evalscript interpola o mesmo SSOT.

## Identidade e persistência

Identidade: organização + empresa + área + `geometria_sha256` + data + versão classificador + versão evalscript + resolução + fonte.

Tabelas `erp.satelite_mapas_condicao` (+ arquivos). Sem `analise_id`. Migration `0059` (já aplicada). Imutável. Mapas v1/v2 **não** são apagados; a listagem operacional filtra a versão corrente v3.

## Rotas

- `POST /api/satelite/areas/:areaId/condicao-pasto` — gera/reaproveita v3 via `lib/satelite/gerar-mapa-condicao.ts`.
- `GET /api/satelite/areas/:areaId/condicao-pasto` — mapa v3 gravado.
- `GET /api/mapa/condicao-pasto?area_ids=` — listagem v3 (não gera).
- `GET /api/mapa/condicao-pasto/:mapaId/arquivo?t=` — PNG.

## Worker / bundle (SAT-BUNDLE-01C)

Após Statistical útil do `pastagem-essencial-v2`, o executor **mantém o item em `executando`**
(reserva ativa), chama `garantirProdutoCondicaoOperacional` / `materializarProdutosDaObservacao`
com política **`principal`** e identidade temporal EXATA (`observacao_inicio`/`fim` + `geometria_sha256`),
e só então fecha:

- mapa condição v3 **e** rasters NDVI/EVI2/NDRE/NDMI/MSAVI2/BSI na **mesma** Process TAR multi-output (grade 20 m);
- Process automático a frio: até **1** chamada (`Accept: application/tar`);
- consumo Process do worker atribui `consulta_id` / `consulta_item_id` **uma vez** por request;
- falha do Process / produtos faltantes → item `falho` `produtos_bundle_falharam`; Statistical permanece; reparo não repete Statistical;
- cache total da **mesma observação** → reutilizado (0 Process); parcial → 1 Process só com faltantes;
- reparo: fail-closed (`pronto|reutilizado|falhou`); falha mantém reserva;
- `POST …/produtos-observacao/reparar` público = consumo avulso (sem IDs de ledger do cliente).

## Observação completa (contrato F1)

Ver `docs/SATELITE-COMPLETO.md` e `packages/domain/src/observacao-satelital-completa.ts`.

- `GET /api/mapa/areas/:areaId/observacao-satelital-completa`
- `GET /api/mapa/observacoes-satelitais-completas/resumo`

UI temática (**SAT-BUNDLE-01B [F2]**): cinco temas no Mapa geral (Condição / Umidade / Vigor / Cobertura / Solo)
sobre a mesma observação completa; troca de tema sem nova consulta; mapa vetorial operacional
(poligonização/isobands); raster cru só em Dados técnicos. Ver `docs/SATELITE-COMPLETO.md`.

## Limitações

Vegetação verde ≠ capim útil. Sem kg MS/ha, oferta, lotação ou diagnóstico de praga. NDMI ≠ umidade volumétrica do solo.
