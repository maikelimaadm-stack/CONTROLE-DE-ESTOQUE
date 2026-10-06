/** Compatibilidade com a SAT-07: a camada de raster agora é por índice (`camada-rasters.ts`). */
export {
  ANTES_DO_CONTORNO,
  amostrarPixelCanvas,
  idCamadaRaster,
  idFonteRaster,
  removerRasterDoMapa,
  sincronizarRastersNoMapa
} from "./camada-rasters";
