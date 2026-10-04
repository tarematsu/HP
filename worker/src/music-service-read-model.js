import { pagesActionsR2ResponseKey, saveMaterializedActionsR2Response } from './pages-response-r2.js';
import {
  REGIONAL_MUSIC_READ_MODEL_SERVICES,
  publishRegionalMusicReadModels,
} from './regional-music-read-model.js';

export const MUSIC_SERVICE_READ_MODEL_PREFIX = 'music-service:';
export const MUSIC_SERVICE_READ_MODEL_SERVICES = REGIONAL_MUSIC_READ_MODEL_SERVICES;

const LEGACY_READ_MODEL_PREFIX = 'regional-music:';

export function musicServiceReadModelKey(service) {
  const serviceId = String(service || '').trim();
  if (!MUSIC_SERVICE_READ_MODEL_SERVICES.includes(serviceId)) {
    throw new Error(`unknown music service: ${serviceId || '(empty)'}`);
  }
  return `${MUSIC_SERVICE_READ_MODEL_PREFIX}${serviceId}`;
}

function serviceFromLegacyModelKey(modelKey) {
  const value = String(modelKey || '');
  return value.startsWith(LEGACY_READ_MODEL_PREFIX)
    ? value.slice(LEGACY_READ_MODEL_PREFIX.length)
    : value;
}

function mappedR2(r2, services) {
  if (!r2 || typeof r2 !== 'object') return r2;
  const redirects = new Map(services.map((service) => [
    pagesActionsR2ResponseKey(`${LEGACY_READ_MODEL_PREFIX}${service}`),
    pagesActionsR2ResponseKey(musicServiceReadModelKey(service)),
  ]));
  return {
    get(key, ...args) {
      return r2.get(redirects.get(String(key)) || key, ...args);
    },
    put(...args) {
      return r2.put(...args);
    },
  };
}

export async function publishMusicServiceReadModels(
  env,
  services = MUSIC_SERVICE_READ_MODEL_SERVICES,
  updatedAt = Date.now(),
  dependencies = {},
) {
  const selected = [...new Set((services || []).map((value) => String(value || '').trim()).filter(Boolean))];
  for (const service of selected) musicServiceReadModelKey(service);

  const baseSave = dependencies.saveR2Response || saveMaterializedActionsR2Response;
  const mappedSave = (r2, legacyModelKey, ...args) => {
    const service = serviceFromLegacyModelKey(legacyModelKey);
    return baseSave(r2, musicServiceReadModelKey(service), ...args);
  };
  const result = await publishRegionalMusicReadModels(
    { ...env, PAGES_RESPONSE_R2: mappedR2(env?.PAGES_RESPONSE_R2, selected) },
    selected,
    updatedAt,
    { ...dependencies, saveR2Response: mappedSave },
  );
  return {
    ...result,
    results: result.results.map((row) => ({
      ...row,
      model_key: musicServiceReadModelKey(row.service),
    })),
  };
}

export async function publishMusicServiceReadModel(env, service, updatedAt = Date.now(), dependencies = {}) {
  const published = await publishMusicServiceReadModels(env, [service], updatedAt, dependencies);
  return published.results[0] || null;
}

export function publishAllMusicServiceReadModels(env, updatedAt = Date.now(), dependencies = {}) {
  return publishMusicServiceReadModels(env, MUSIC_SERVICE_READ_MODEL_SERVICES, updatedAt, dependencies);
}
