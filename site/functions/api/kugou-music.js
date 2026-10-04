import { musicServiceReadModelResponse } from '../lib/music-service-read-model.js';

export function onRequestGet({ env }) {
  return musicServiceReadModelResponse(env, 'kugou_music');
}