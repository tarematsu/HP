import { loadStationheadChannelView } from './stationhead-channel.js?v=20261004.2';

export function loadHinataView(options = {}) {
  return loadStationheadChannelView('hinataView', options);
}
