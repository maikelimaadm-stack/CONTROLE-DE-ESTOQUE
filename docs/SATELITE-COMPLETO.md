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
NDMI indica umidade espectral da vegetação/dossel — **não** umidade volumétrica do solo.

## Observação completa (SAT-BUNDLE-01C)

Uma operação de produto (`pastagem_essencial`) = uma observação canônica:

- Statistical: **1** chamada do bundle `pastagem-essencial-v2` → 6 índices irmãos (estatística completa);
- Process automático a frio: **até 1** chamada multi-output (`Accept: application/tar`) → condição v3 + NDVI + EVI2 + NDRE + NDMI + MSAVI2 + BSI (grade comum 20 m);
- Cache total dos 7 produtos → **0** Process; cache parcial → **1** Process só com faltantes;
- Contrato de leitura: `ObservacaoSatelitalCompleta` + temas (`condicao`, `umidade`, `vigor`, `cobertura_solo`, dados técnicos).

`visual_pronto` / `status_bundle = completo` exigem 6 índices + condição + 6 rasters da mesma observação.

Trocar tema na futura UI **não** cria Statistical nem Process novo.

### Orçamento / reserva (01C)

Ordem obrigatória no worker:

1. Statistical 2xx → persistir análise + consumo Statistical;
2. item permanece `executando` (consulta continua reservando saldo);
3. Process TAR multi-output **fora** de transação DB, com identidade temporal EXATA;
4. gravar produtos + **um** consumo Process;
5. só então fechar item/consulta (`concluido` ou `falho` `produtos_bundle_falharam`).

Falha do Process **não** repete Statistical — reparo materializa só faltantes.
Prova de cache: organização + empresa + área + geometria + versões + `data_imagem` + `observacao_inicio`/`observacao_fim` + `analise_id` (rasters).

Estimativa / orçamento (SSOT `estimarCreditosItem` + `estimarCreditosProcessCondicao`):

- item novo pastagem = Statistical + **1** Process multi-output;
- produtos comprovadamente reutilizáveis **da mesma observação** → Process = 0;
- sem prova de cache → estimativa conservadora (faixa; ledger = PU real);
- Process automático interno grava `consulta_id` / `consulta_item_id` no ledger.

Rotas F1 (sem UI):

- `GET /api/mapa/areas/:areaId/observacao-satelital-completa`
- `GET /api/mapa/observacoes-satelitais-completas/resumo`
- `POST /api/satelite/areas/:areaId/produtos-observacao/reparar` — reparo idempotente dos faltantes (reusa Statistical; 0 Process se cache total); **não** aceita `consulta_id`/`consulta_item_id` (consumo avulso)

Orquestração operacional: `materializarProdutosDaObservacao` / `garantirProdutoCondicaoOperacional` → `pronto | reutilizado | falhou` (fail-closed).
Rota legada de raster individual permanece; não remove pipeline duplicado.

Próxima fatia: **SAT-BUNDLE-01B [F2]** — UI temática consumindo este contrato.

## Segurança

- Secrets Copernicus só no backend.
- CAPACIDADE × ESCOPO × TENANT; cliente manda `area_id`, nunca geometria confiável.
- RLS FORCE em tabelas satélite; 404 uniforme fora de escopo.
