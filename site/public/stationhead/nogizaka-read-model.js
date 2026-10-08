// Only listening-party data is published for this channel today.
import { fetchJson } from './data-client.js';
import { createStationheadChannelModel } from './source-model.js';

export function nogizakaModel() {
  return createStationheadChannelModel({
    source: 'nogizaka',
    stationUrl: 'https://stationhead.com/c/nogizaka46smej',
    artistFilter: '乃木坂46',
    capabilities: ['broadcasts'],
    broadcastLoader: (options) => fetchJson('/api/nogizaka-listening-party', options),
  });
}
