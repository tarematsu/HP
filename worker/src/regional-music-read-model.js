// Historical import compatibility only. The canonical producer contract is
// music-service-read-model.js and publishes independent music-service models.
export {
  MUSIC_SERVICE_READ_MODEL_PREFIX as REGIONAL_MUSIC_READ_MODEL_PREFIX,
  MUSIC_SERVICE_READ_MODEL_VERSION as REGIONAL_MUSIC_READ_MODEL_VERSION,
  MUSIC_SERVICE_READ_MODEL_CADENCE_SECONDS as REGIONAL_MUSIC_READ_MODEL_CADENCE_SECONDS,
  MUSIC_SERVICE_READ_MODEL_SERVICES as REGIONAL_MUSIC_READ_MODEL_SERVICES,
  musicServiceReadModelKey as regionalMusicReadModelKey,
  loadMusicServicesReadModel as loadRegionalMusicReadModel,
  loadMusicServiceReadModel as loadRegionalMusicServiceReadModel,
  chartHistoryReadModel as regionalChartHistoryReadModel,
  musicServiceSnapshot as regionalMusicServiceSnapshot,
  musicServiceReadModelPayload as regionalMusicServiceReadModelPayload,
  musicServicesReadModelPayload as regionalMusicReadModelPayload,
  publishMusicServiceReadModels as publishRegionalMusicReadModels,
  publishMusicServiceReadModel as publishRegionalMusicServiceReadModel,
  publishAllMusicServiceReadModels as publishRegionalMusicReadModel,
  qqJapanChartReadModel,
  qqAnimeChartReadModel,
} from './music-service-read-model.js';
