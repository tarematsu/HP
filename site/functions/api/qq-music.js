import { musicServiceReadModelResponse } from '../lib/music-service-read-model.js';

export function onRequestGet({ env }) {
  return musicServiceReadModelResponse(env, 'qq_music');
}