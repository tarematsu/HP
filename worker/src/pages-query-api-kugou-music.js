import { musicServiceReadModelResponse } from './pages-query-music-service-read-model.js';

export function onRequestGet({ env }) {
  return musicServiceReadModelResponse(env, 'kugou_music');
}
