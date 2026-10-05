# Satélite completo — arquitetura consolidada

Decisão **301**. Programa pré-calibração de monitoramento satelital no Mapa geral.

## Arquitetura

```
erp.areas (SSOT geométrico)
  → geometria_sha256 vigente
  → Copernicus Sentinel-2 L2A
      Statistical API (bundle pastagem_essencial / pastagem-essencial-v2)
      Process API (raster de valores UINT8 por índice)
  → backend ERP (RLS, ledger PU, fila)
  → Mapa geral (Google Map Tiles base + camada Sentinel)
```

Google = base visual. Sentinel = camada analítica. Nunca o inverso.

## Índices (SSOT)

`packages/domain/src/indices-satelitais.ts` — NDVI, EVI2, NDRE, NDMI, MSAVI2, BSI.

| Índice | Nativo | Família UI |
|--------|--------|------------|
| NDVI   | 10 m   | Vigor |
| EVI2   | 10 m   | Vigor |
| NDRE   | 20 m   | Vigor |
| NDMI   | 20 m   | Umidade |
| MSAVI2 | 10 m   | Cobertura/Solo |
| BSI    | 20 m   | Cobertura/Solo |

## Raster / encoding

SSOT: `packages/domain/src/raster-satelital.ts`.

- PNG UINT8 de **valores** (não cor permanente).
- Byte **0 = nodata** (nunca zero do índice).
- Escala fixa por índice; NDVI preserva SAT-06 (`ndvi-valores-v1`).
- Storage no banco (`erp.satelite_raster_arquivos` + metadado); URL assinada temporária; nunca persistir signed URL.
- Migration `0058` amplia índice no CHECK.

## Histórico operacional

`GET /api/satelite/areas/:areaId/historico` — **somente** `geometria_sha256` atual.
Banco preserva análises de contornos antigos. Sem geometria → `itens=[]`.

## Consulta em lote

Reusa `erp.satelite_consultas` / itens / worker SAT-02/03. Sem fila paralela.
429 respeita Retry-After; falha de um item não derruba o lote.

## Anomalia

`sat-anomalia-v1` (`packages/domain/src/anomalia-satelital.ts`): motivos auditáveis, multi-índice, sem praga/biomassa. “Vistoria recomendada” quando moderada/forte.

## Limitações científicas

Vegetação verde ≠ capim útil. Sem kg MS/ha, oferta, lotação ou diagnóstico de praga até calibração de campo.

## Segurança

- Secrets Copernicus só no backend.
- CAPACIDADE × ESCOPO × TENANT; cliente manda `area_id`, nunca geometria confiável.
- RLS FORCE em tabelas satélite; 404 uniforme fora de escopo.
