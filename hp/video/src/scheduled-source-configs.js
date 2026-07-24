import { collectSourceAMediaUrls } from './source-a.js';
import { collectSourceBMediaUrls } from './source-b.js';
import { collectSourceEMediaUrls } from './source-e.js';

export const COLLECTION_CRON = '30 16 * * *';
export const COLLECTION_SECONDARY_CRON = '45 16 * * *';
export const SOURCE_A_CRON = COLLECTION_CRON;
export const SOURCE_B_CRON = COLLECTION_SECONDARY_CRON;
export const SOURCE_E_CRON = COLLECTION_SECONDARY_CRON;

export const SOURCE_A_CONFIG = Object.freeze({
  method: 'source-a-browser',
  sourceKey: 'A',
  sourceUrl: null,
  collect: collectSourceAMediaUrls
});
export const SOURCE_B_CONFIG = Object.freeze({
  method: 'source-b-browser',
  sourceKey: 'B',
  sourceUrl: null,
  collect: collectSourceBMediaUrls
});
export const SOURCE_E_CONFIG = Object.freeze({
  method: 'source-e-browser',
  sourceKey: 'E',
  sourceUrl: null,
  collect: collectSourceEMediaUrls
});

export const PRIMARY_COLLECTION_CONFIGS = Object.freeze([
  SOURCE_A_CONFIG
]);

export const SECONDARY_COLLECTION_CONFIGS = Object.freeze([
  SOURCE_B_CONFIG,
  SOURCE_E_CONFIG
]);

export const ALL_COLLECTION_CONFIGS = Object.freeze([
  ...PRIMARY_COLLECTION_CONFIGS,
  ...SECONDARY_COLLECTION_CONFIGS
]);

export const COLLECTION_CONFIG_BY_METHOD = new Map(
  ALL_COLLECTION_CONFIGS.map((config) => [config.method, config])
);

export const SCHEDULED_COLLECTION_GROUPS = Object.freeze({
  [COLLECTION_CRON]: PRIMARY_COLLECTION_CONFIGS,
  [COLLECTION_SECONDARY_CRON]: SECONDARY_COLLECTION_CONFIGS
});
