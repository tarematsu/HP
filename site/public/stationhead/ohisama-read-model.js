// Ohisama uses its own published read-model URL, not a separate renderer.
import { createStationheadChannelModel } from './source-model.js';

export function ohisamaModel() {
  return createStationheadChannelModel({
    source: 'ohisama',
    stationUrl: 'https://stationhead.com/c/ohisama',
    artistFilter: '日向坂46',
    capabilities: ['current', 'history', 'played-tracks', 'likes'],
    currentUrl: '/api/hinata',
    historyUrl: () => '/api/hinata',
  });
}
