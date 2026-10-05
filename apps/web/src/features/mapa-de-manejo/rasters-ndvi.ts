/**
 * Compatibilidade com a SAT-07: o cliente de rasters agora é por índice (`rasters-indice.ts`).
 * Estes nomes continuam valendo para o NDVI.
 */
export {
  baixarArquivoRaster,
  desenharMiniaturaRaster,
  gerarRasterDaAnalise,
  liberarEntrada,
  listarRastersPorAreas,
  mensagemDoErroDeRaster,
  recolorirEntrada,
  urlAbsolutaDoArquivo,
  useRastersNdvi,
  type EntradaRasterEmMemoria,
  type RasterNdviDto
} from "./rasters-indice";
